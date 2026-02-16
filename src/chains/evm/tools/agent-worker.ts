/**
 * Agent Worker Loop — continuous autonomous DeFi position management.
 *
 * Cycle: read position → LTV decision → execute action → log → wait → repeat
 *
 * The worker is protocol-agnostic: it takes a `LendingProtocolAdapter` +
 * `EvmSignerProvider` and manages any lending position on any EVM chain.
 *
 * MCP Tools:
 * - `evm_agentWorkerStart`:  start a worker loop (returns immediately)
 * - `evm_agentWorkerStop`:   stop a running worker
 * - `evm_agentWorkerStatus`: read current worker state + audit log
 *
 * Safety:
 * - paused flag (immediate halt)
 * - maxConsecutiveErrors threshold (auto-pause on persistent failures)
 * - dryRun mode (log decisions without executing)
 * - Only runs on BSC for now (assertBscNetwork in Venus adapter)
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	EVM_TOOL_PREFIX,
	type EvmNetwork,
	evmNetworkSchema,
	parseEvmNetwork,
} from "../runtime.js";
import type { LendingMarket, LendingProtocolAdapter } from "./lending-types.js";
import {
	type AgentConfig,
	DEFAULT_AGENT_CONFIG,
	type LtvAction,
	type LtvManagerInput,
	decideLtvAction,
} from "./ltv-manager.js";
import { resolveEvmSignerForTool } from "./signer-resolve.js";
import type { EvmSignerProvider } from "./signer-types.js";
import { createVenusAdapter } from "./venus-adapter.js";

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

export type WorkerCycleLog = {
	timestamp: string;
	cycleNumber: number;
	action: LtvAction;
	executed: boolean;
	executionResult?: { txHashes: string[] } | { error: string };
	durationMs: number;
};

export type WorkerState = {
	id: string;
	network: EvmNetwork;
	account: string;
	status: "running" | "stopped" | "paused" | "error";
	config: AgentConfig;
	dryRun: boolean;
	intervalMs: number;
	startedAt: string;
	stoppedAt: string | null;
	cycleCount: number;
	consecutiveErrors: number;
	maxConsecutiveErrors: number;
	lastCycleAt: string | null;
	recentLogs: WorkerCycleLog[];
};

// In-memory worker registry
const workers = new Map<
	string,
	WorkerState & { timer: ReturnType<typeof setTimeout> | null }
>();

// ---------------------------------------------------------------------------
// Position → LTV input bridge (shared with venus-agent.ts)
// ---------------------------------------------------------------------------

function buildLtvInput(
	position: {
		supplies: { marketAddress: string; balanceRaw: string }[];
		borrows: { marketAddress: string; balanceRaw: string }[];
		totalCollateralValueUsd: string;
		totalBorrowValueUsd: string;
	},
	markets: LendingMarket[],
	config: AgentConfig,
): LtvManagerInput {
	const collateralValueUsd = Number.parseFloat(
		position.totalCollateralValueUsd,
	);
	const borrowValueUsd = Number.parseFloat(position.totalBorrowValueUsd);

	let supplyAPY = 0;
	let borrowAPR = 0;

	if (markets.length > 0) {
		const listed = markets.filter((m) => m.isListed);
		const bestSupply = [...listed].sort((a, b) => b.supplyAPY - a.supplyAPY);
		if (bestSupply.length > 0) supplyAPY = bestSupply[0].supplyAPY;

		const cheapBorrow = [...listed].sort((a, b) => a.borrowAPY - b.borrowAPY);
		if (cheapBorrow.length > 0) borrowAPR = cheapBorrow[0].borrowAPY;

		if (position.supplies.length > 0) {
			const largest = position.supplies.reduce((a, b) =>
				BigInt(a.balanceRaw) > BigInt(b.balanceRaw) ? a : b,
			);
			const m = markets.find(
				(x) =>
					x.marketAddress.toLowerCase() === largest.marketAddress.toLowerCase(),
			);
			if (m) supplyAPY = m.supplyAPY;
		}

		if (position.borrows.length > 0) {
			const largest = position.borrows.reduce((a, b) =>
				BigInt(a.balanceRaw) > BigInt(b.balanceRaw) ? a : b,
			);
			const m = markets.find(
				(x) =>
					x.marketAddress.toLowerCase() === largest.marketAddress.toLowerCase(),
			);
			if (m) borrowAPR = m.borrowAPY;
		}
	}

	return {
		collateralValueUsd: Number.isNaN(collateralValueUsd)
			? 0
			: collateralValueUsd,
		borrowValueUsd: Number.isNaN(borrowValueUsd) ? 0 : borrowValueUsd,
		supplyAPY,
		borrowAPR,
		config,
	};
}

// ---------------------------------------------------------------------------
// Single cycle
// ---------------------------------------------------------------------------

async function runCycle(
	worker: WorkerState & { timer: ReturnType<typeof setTimeout> | null },
	adapter: LendingProtocolAdapter,
	signer: EvmSignerProvider | null,
): Promise<void> {
	const start = Date.now();
	worker.cycleCount++;
	worker.lastCycleAt = new Date().toISOString();

	const log: WorkerCycleLog = {
		timestamp: new Date().toISOString(),
		cycleNumber: worker.cycleCount,
		action: {
			action: "hold",
			currentLTV: 0,
			yieldSpread: 0,
			reason: "pending",
		},
		executed: false,
		durationMs: 0,
	};

	try {
		// 1. Read position + markets
		const [markets, position] = await Promise.all([
			adapter.getMarkets(worker.network),
			adapter.getAccountPosition(worker.network, worker.account),
		]);

		// 2. Decide
		const ltvInput = buildLtvInput(position, markets, worker.config);
		const decision = decideLtvAction(ltvInput);
		log.action = decision;

		// 3. Execute (if not dryRun and not hold)
		if (!worker.dryRun && decision.action !== "hold" && signer) {
			try {
				const txHashes: string[] = [];

				if (decision.action === "repay" && decision.repayAmountUsd > 0) {
					// Find the borrowed token's vToken market → build repay calldata
					if (position.borrows.length > 0) {
						const borrow = position.borrows[0];
						const amountRaw = BigInt(
							Math.floor(decision.repayAmountUsd * 1e18),
						).toString();
						const calldata = await adapter.buildRepayCalldata({
							network: worker.network,
							account: worker.account,
							tokenAddress: borrow.underlyingAddress,
							amountRaw,
						});
						for (const cd of calldata) {
							const result = await signer.signAndSend({
								network: worker.network,
								to: cd.to,
								data: cd.data,
								value: cd.value,
							});
							txHashes.push(result.txHash);
						}
					}
				}

				if (decision.action === "optimize" && decision.borrowMoreUsd > 0) {
					// Find a market to borrow from
					const bestMarket = markets
						.filter((m) => m.isListed)
						.sort((a, b) => a.borrowAPY - b.borrowAPY)[0];
					if (bestMarket) {
						const amountRaw = BigInt(
							Math.floor(decision.borrowMoreUsd * 1e18),
						).toString();
						const cd = await adapter.buildBorrowCalldata({
							network: worker.network,
							account: worker.account,
							marketAddress: bestMarket.marketAddress,
							amountRaw,
						});
						const result = await signer.signAndSend({
							network: worker.network,
							to: cd.to,
							data: cd.data,
							value: cd.value,
						});
						txHashes.push(result.txHash);
					}
				}

				log.executed = txHashes.length > 0;
				if (txHashes.length > 0) {
					log.executionResult = { txHashes };
				}
			} catch (execErr) {
				log.executionResult = {
					error: execErr instanceof Error ? execErr.message : String(execErr),
				};
			}
		}

		worker.consecutiveErrors = 0;
	} catch (err) {
		worker.consecutiveErrors++;
		log.action = {
			action: "hold",
			currentLTV: 0,
			yieldSpread: 0,
			reason: `Cycle error: ${err instanceof Error ? err.message : String(err)}`,
		};

		if (worker.consecutiveErrors >= worker.maxConsecutiveErrors) {
			worker.status = "error";
			worker.stoppedAt = new Date().toISOString();
			if (worker.timer) {
				clearTimeout(worker.timer);
				worker.timer = null;
			}
		}
	}

	log.durationMs = Date.now() - start;

	// Keep last 50 logs
	worker.recentLogs.push(log);
	if (worker.recentLogs.length > 50) {
		worker.recentLogs.shift();
	}

	// Schedule next cycle if still running
	if (worker.status === "running") {
		worker.timer = setTimeout(() => {
			runCycle(worker, adapter, signer).catch(() => {});
		}, worker.intervalMs);
	}
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveWorkerConfig(params: {
	maxLTV?: number;
	targetLTV?: number;
	minYieldSpread?: number;
	paused?: boolean;
}): AgentConfig {
	const fromEnv = (key: string, fallback: number): number => {
		const val = process.env[key]?.trim();
		if (val) {
			const parsed = Number.parseFloat(val);
			if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
		}
		return fallback;
	};

	return {
		maxLTV:
			params.maxLTV ??
			fromEnv("VENUS_AGENT_MAX_LTV", DEFAULT_AGENT_CONFIG.maxLTV),
		targetLTV:
			params.targetLTV ??
			fromEnv("VENUS_AGENT_TARGET_LTV", DEFAULT_AGENT_CONFIG.targetLTV),
		minYieldSpread:
			params.minYieldSpread ??
			fromEnv(
				"VENUS_AGENT_MIN_YIELD_SPREAD",
				DEFAULT_AGENT_CONFIG.minYieldSpread,
			),
		paused:
			params.paused ??
			(process.env.VENUS_AGENT_PAUSED?.trim()?.toLowerCase() === "true" ||
				DEFAULT_AGENT_CONFIG.paused),
	};
}

// ---------------------------------------------------------------------------
// Exported helpers for testing
// ---------------------------------------------------------------------------

/** Get worker state (for testing) */
export function getWorkerState(workerId: string): WorkerState | undefined {
	const w = workers.get(workerId);
	if (!w) return undefined;
	const { timer: _timer, ...state } = w;
	return state;
}

/** Clear all workers (for testing) */
export function clearAllWorkers(): void {
	for (const [, w] of workers) {
		if (w.timer) clearTimeout(w.timer);
	}
	workers.clear();
}

/** Get all worker IDs (for testing) */
export function getWorkerIds(): string[] {
	return [...workers.keys()];
}

// ---------------------------------------------------------------------------
// MCP tools
// ---------------------------------------------------------------------------

const configParams = {
	maxLTV: Type.Optional(Type.Number({ minimum: 0.01, maximum: 0.99 })),
	targetLTV: Type.Optional(Type.Number({ minimum: 0.01, maximum: 0.99 })),
	minYieldSpread: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
	paused: Type.Optional(Type.Boolean()),
};

export function createAgentWorkerTools() {
	return [
		// ---------------------------------------------------------------
		// Start worker
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}agentWorkerStart`,
			label: "Agent Worker Start",
			description:
				"Start an autonomous lending position management worker. Continuously monitors position, decides actions (hold/repay/optimize), and optionally executes. Returns immediately — worker runs in background.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				account: Type.String({ description: "BSC wallet address to manage" }),
				dryRun: Type.Optional(
					Type.Boolean({
						description: "Log decisions without executing (default true)",
					}),
				),
				intervalSeconds: Type.Optional(
					Type.Number({
						minimum: 10,
						maximum: 86400,
						description: "Check interval in seconds (default 300 = 5min)",
					}),
				),
				maxConsecutiveErrors: Type.Optional(
					Type.Number({
						minimum: 1,
						maximum: 100,
						description: "Auto-pause after N consecutive errors (default 5)",
					}),
				),
				fromPrivateKey: Type.Optional(Type.String()),
				...configParams,
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const account = params.account.trim();
				if (!/^0x[a-fA-F0-9]{40}$/.test(account)) {
					throw new Error("account must be a valid EVM address");
				}

				const dryRun = params.dryRun !== false;
				const intervalMs = (params.intervalSeconds ?? 300) * 1000;
				const maxConsecutiveErrors = params.maxConsecutiveErrors ?? 5;
				const config = resolveWorkerConfig(params);

				// Check for existing worker on same account
				const workerId = `${network}:${account.toLowerCase()}`;
				const existing = workers.get(workerId);
				if (existing && existing.status === "running") {
					throw new Error(
						`Worker already running for ${account} on ${network}. Stop it first with evm_agentWorkerStop.`,
					);
				}

				// Resolve signer (only needed for non-dryRun)
				let signer: EvmSignerProvider | null = null;
				if (!dryRun) {
					signer = resolveEvmSignerForTool({
						fromPrivateKey: params.fromPrivateKey,
						network,
					});
				}

				const adapter = createVenusAdapter();

				const worker: WorkerState & {
					timer: ReturnType<typeof setTimeout> | null;
				} = {
					id: workerId,
					network,
					account: account.toLowerCase(),
					status: "running",
					config,
					dryRun,
					intervalMs,
					startedAt: new Date().toISOString(),
					stoppedAt: null,
					cycleCount: 0,
					consecutiveErrors: 0,
					maxConsecutiveErrors,
					lastCycleAt: null,
					recentLogs: [],
					timer: null,
				};

				workers.set(workerId, worker);

				// Start first cycle immediately
				runCycle(worker, adapter, signer).catch(() => {});

				return {
					content: [
						{
							type: "text",
							text: `Agent worker started: ${workerId}. Mode: ${dryRun ? "dry-run (observe only)" : "LIVE"}. Interval: ${params.intervalSeconds ?? 300}s. Use evm_agentWorkerStatus to check progress.`,
						},
					],
					details: {
						schema: "evm.agent.worker.start.v1",
						workerId,
						network,
						account: account.toLowerCase(),
						dryRun,
						intervalSeconds: params.intervalSeconds ?? 300,
						maxConsecutiveErrors,
						config,
						signerBackend: signer?.id ?? "none (dry-run)",
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// Stop worker
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}agentWorkerStop`,
			label: "Agent Worker Stop",
			description: "Stop a running agent worker.",
			parameters: Type.Object({
				workerId: Type.Optional(
					Type.String({
						description: "Worker ID (network:account). If omitted, stops all.",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				if (params.workerId) {
					const w = workers.get(params.workerId);
					if (!w) {
						throw new Error(`Worker ${params.workerId} not found.`);
					}
					w.status = "stopped";
					w.stoppedAt = new Date().toISOString();
					if (w.timer) {
						clearTimeout(w.timer);
						w.timer = null;
					}
					return {
						content: [
							{ type: "text", text: `Worker ${params.workerId} stopped.` },
						],
						details: {
							schema: "evm.agent.worker.stop.v1",
							workerId: params.workerId,
							cyclesCompleted: w.cycleCount,
						},
					};
				}

				// Stop all
				let count = 0;
				for (const [id, w] of workers) {
					if (w.status === "running") {
						w.status = "stopped";
						w.stoppedAt = new Date().toISOString();
						if (w.timer) {
							clearTimeout(w.timer);
							w.timer = null;
						}
						count++;
					}
				}
				return {
					content: [{ type: "text", text: `Stopped ${count} worker(s).` }],
					details: { schema: "evm.agent.worker.stop.v1", stoppedCount: count },
				};
			},
		}),

		// ---------------------------------------------------------------
		// Worker status
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}agentWorkerStatus`,
			label: "Agent Worker Status",
			description:
				"Get current status of agent worker(s), including cycle count, recent decisions, and errors.",
			parameters: Type.Object({
				workerId: Type.Optional(
					Type.String({
						description: "Specific worker ID. If omitted, shows all.",
					}),
				),
				logLimit: Type.Optional(
					Type.Number({
						minimum: 1,
						maximum: 50,
						description: "Max recent log entries to return (default 10)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const logLimit = params.logLimit ?? 10;

				if (params.workerId) {
					const w = workers.get(params.workerId);
					if (!w) {
						throw new Error(`Worker ${params.workerId} not found.`);
					}
					const { timer: _t, ...state } = w;
					return {
						content: [
							{
								type: "text",
								text: `Worker ${state.id}: ${state.status}. Cycles: ${state.cycleCount}. Errors: ${state.consecutiveErrors}.`,
							},
						],
						details: {
							schema: "evm.agent.worker.status.v1",
							worker: {
								...state,
								recentLogs: state.recentLogs.slice(-logLimit),
							},
						},
					};
				}

				// All workers
				const all = [...workers.values()].map((w) => {
					const { timer: _t, ...state } = w;
					return {
						...state,
						recentLogs: state.recentLogs.slice(-logLimit),
					};
				});

				return {
					content: [
						{
							type: "text",
							text: `${all.length} worker(s). Running: ${all.filter((w) => w.status === "running").length}.`,
						},
					],
					details: {
						schema: "evm.agent.worker.status.v1",
						totalWorkers: all.length,
						runningCount: all.filter((w) => w.status === "running").length,
						workers: all,
					},
				};
			},
		}),
	];
}
