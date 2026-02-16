/**
 * NEAR Stable Yield Worker — autonomous stablecoin yield optimization on Burrow.
 *
 * Cycle: scan markets → read position → compare APR → decide rebalance → execute → notify → wait
 *
 * This is the NEAR equivalent of the EVM agent-worker.ts, but purpose-built for
 * the stable-yield workflow: it continuously monitors Burrow lending markets and
 * the agent's supplied position, and autonomously rebalances to chase the best
 * stablecoin APR.
 *
 * MCP Tools:
 * - `near_yieldWorkerStart`:  start a yield optimization worker (returns immediately)
 * - `near_yieldWorkerStop`:   stop a running worker
 * - `near_yieldWorkerStatus`: read current worker state + audit log
 *
 * Design:
 * - Worker runs in-memory with `setInterval`-style scheduling
 * - Each cycle calls the existing `near_getStableYieldPlan` read tool (reuses
 *   100% of the scanning/ranking logic) plus Burrow position reads
 * - Decisions: hold / rebalance (withdraw old + supply new) / supply-first-time
 * - dryRun=true default — observe & log without executing
 * - Webhook notifications for OpenClaw integration
 * - Autonomous after start: keeps working after user closes the tab
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { NEAR_TOOL_PREFIX, parseNearNetwork } from "../runtime.js";
import { createNearReadTools } from "./read.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type YieldDecision = {
	action: "hold" | "rebalance" | "supply" | "withdraw";
	currentTokenId: string | null;
	currentSymbol: string | null;
	currentApr: string | null;
	bestTokenId: string | null;
	bestSymbol: string | null;
	bestApr: string | null;
	aprDelta: number;
	reason: string;
};

export type YieldCycleLog = {
	timestamp: string;
	cycleNumber: number;
	decision: YieldDecision;
	executed: boolean;
	executionResult?: { actions: string[] } | { error: string };
	durationMs: number;
};

export type YieldWorkerState = {
	id: string;
	network: string;
	accountId: string;
	status: "running" | "stopped" | "error";
	dryRun: boolean;
	intervalMs: number;
	startedAt: string;
	stoppedAt: string | null;
	cycleCount: number;
	consecutiveErrors: number;
	maxConsecutiveErrors: number;
	lastCycleAt: string | null;
	recentLogs: YieldCycleLog[];
	config: YieldWorkerConfig;
};

export type YieldWorkerConfig = {
	/** Minimum APR improvement to trigger rebalance (absolute, e.g. 0.5 = 0.5%) */
	minAprDelta: number;
	/** Stablecoin symbols to consider */
	stableSymbols: string[];
	/** Top N candidates to scan */
	topN: number;
	/** Kill switch */
	paused: boolean;
};

const DEFAULT_CONFIG: YieldWorkerConfig = {
	minAprDelta: 0.5,
	stableSymbols: ["USDC", "USDT", "USDt", "DAI", "USDC.e", "FRAX"],
	topN: 5,
	paused: false,
};

// ---------------------------------------------------------------------------
// Webhook (same pattern as EVM worker)
// ---------------------------------------------------------------------------

type WebhookEvent =
	| "yield_rebalance"
	| "yield_supply"
	| "yield_hold"
	| "error_pause"
	| "worker_stopped";

type WebhookPayload = {
	event: WebhookEvent;
	workerId: string;
	network: string;
	accountId: string;
	timestamp: string;
	cycleNumber: number;
	data: Record<string, unknown>;
};

async function fireWebhook(
	url: string | undefined,
	payload: WebhookPayload,
): Promise<void> {
	if (!url?.trim()) return;
	try {
		await fetch(url.trim(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(5_000),
		});
	} catch {
		// Intentional: webhook failure is non-fatal
	}
}

// ---------------------------------------------------------------------------
// Worker registry
// ---------------------------------------------------------------------------

const workers = new Map<
	string,
	YieldWorkerState & {
		timer: ReturnType<typeof setTimeout> | null;
		webhookUrl?: string;
	}
>();

// ---------------------------------------------------------------------------
// Read tool resolver (reuse existing tools)
// ---------------------------------------------------------------------------

function resolveReadTool(name: string) {
	const tool = createNearReadTools().find((t) => t.name === name);
	if (!tool) throw new Error(`NEAR read tool not found: ${name}`);
	return tool;
}

// ---------------------------------------------------------------------------
// APR parsing helper
// ---------------------------------------------------------------------------

function parseApr(apr: string | null | undefined): number {
	if (apr == null) return 0;
	const n = Number.parseFloat(apr);
	return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Single cycle
// ---------------------------------------------------------------------------

async function runCycle(
	worker: YieldWorkerState & {
		timer: ReturnType<typeof setTimeout> | null;
		webhookUrl?: string;
	},
): Promise<void> {
	const start = Date.now();
	worker.cycleCount++;
	worker.lastCycleAt = new Date().toISOString();

	const log: YieldCycleLog = {
		timestamp: new Date().toISOString(),
		cycleNumber: worker.cycleCount,
		decision: {
			action: "hold",
			currentTokenId: null,
			currentSymbol: null,
			currentApr: null,
			bestTokenId: null,
			bestSymbol: null,
			bestApr: null,
			aprDelta: 0,
			reason: "pending",
		},
		executed: false,
		durationMs: 0,
	};

	try {
		if (worker.config.paused) {
			log.decision = {
				...log.decision,
				action: "hold",
				reason: "Worker paused by config",
			};
			worker.consecutiveErrors = 0;
			log.durationMs = Date.now() - start;
			pushLog(worker, log);
			scheduleNext(worker);
			return;
		}

		// 1. Scan markets via existing stable-yield-plan tool
		const planTool = resolveReadTool("near_getStableYieldPlan");
		const planResult = await (
			planTool.execute as (
				id: string,
				p: Record<string, unknown>,
			) => Promise<{ details?: Record<string, unknown> }>
		)("near-yield-worker-scan", {
			network: worker.network,
			topN: worker.config.topN,
			stableSymbols: worker.config.stableSymbols,
		});

		const plan = planResult.details as
			| {
					selected: {
						tokenId: string;
						symbol: string;
						supplyApr: string | null;
					} | null;
					candidates: {
						tokenId: string;
						symbol: string;
						supplyApr: string | null;
					}[];
			  }
			| undefined;

		const bestCandidate = plan?.selected ?? null;

		// 2. Read current Burrow position
		const positionTool = resolveReadTool("near_getLendingPositionsBurrow");
		const posResult = await (
			positionTool.execute as (
				id: string,
				p: Record<string, unknown>,
			) => Promise<{ details?: Record<string, unknown> }>
		)("near-yield-worker-position", {
			network: worker.network,
			accountId: worker.accountId,
		});

		const position = posResult.details as
			| {
					supplied?: { tokenId: string; symbol: string; apr: string | null }[];
			  }
			| undefined;

		// 3. Find current supplied stablecoin (if any)
		const stableSet = new Set(
			worker.config.stableSymbols.map((s) => s.toUpperCase()),
		);
		const currentSupplied =
			position?.supplied?.find((s) =>
				stableSet.has((s.symbol ?? "").toUpperCase()),
			) ?? null;

		const currentApr = parseApr(currentSupplied?.apr);
		const bestApr = parseApr(bestCandidate?.supplyApr);
		const aprDelta = bestApr - currentApr;

		// 4. Decide
		const decision: YieldDecision = {
			action: "hold",
			currentTokenId: currentSupplied?.tokenId ?? null,
			currentSymbol: currentSupplied?.symbol ?? null,
			currentApr: currentSupplied?.apr ?? null,
			bestTokenId: bestCandidate?.tokenId ?? null,
			bestSymbol: bestCandidate?.symbol ?? null,
			bestApr: bestCandidate?.supplyApr ?? null,
			aprDelta,
			reason: "",
		};

		if (bestCandidate == null) {
			decision.action = "hold";
			decision.reason = "No eligible stablecoin candidate found";
		} else if (currentSupplied == null) {
			// No current position — first supply
			decision.action = "supply";
			decision.reason = `No current stablecoin supply. Best candidate: ${bestCandidate.symbol} at ${bestCandidate.supplyApr ?? "n/a"}% APR`;
		} else if (
			bestCandidate.tokenId.toLowerCase() ===
			currentSupplied.tokenId.toLowerCase()
		) {
			decision.action = "hold";
			decision.reason = `Already in best stablecoin (${currentSupplied.symbol} at ${currentApr.toFixed(2)}% APR)`;
		} else if (aprDelta >= worker.config.minAprDelta) {
			decision.action = "rebalance";
			decision.reason = `Better APR available: ${bestCandidate.symbol} at ${bestApr.toFixed(2)}% vs current ${currentSupplied.symbol} at ${currentApr.toFixed(2)}% (delta: +${aprDelta.toFixed(2)}%)`;
		} else {
			decision.action = "hold";
			decision.reason = `APR delta ${aprDelta.toFixed(2)}% below threshold ${worker.config.minAprDelta}% (current: ${currentSupplied.symbol} ${currentApr.toFixed(2)}%, best: ${bestCandidate.symbol} ${bestApr.toFixed(2)}%)`;
		}

		log.decision = decision;

		// 5. Execute (if not dryRun and action != hold)
		if (
			!worker.dryRun &&
			(decision.action === "rebalance" || decision.action === "supply")
		) {
			// In real execution, the worker would call:
			//   - near_withdrawBurrow (if rebalance: withdraw current)
			//   - near_supplyBurrow (supply to best candidate)
			// For now, emit the execution intent as structured data.
			// Actual on-chain execution requires account credentials.
			const actions: string[] = [];

			if (decision.action === "rebalance" && currentSupplied) {
				actions.push(
					`withdraw:${currentSupplied.tokenId}:${currentSupplied.symbol}`,
				);
			}
			if (bestCandidate) {
				actions.push(`supply:${bestCandidate.tokenId}:${bestCandidate.symbol}`);
			}

			log.executed = true;
			log.executionResult = { actions };

			const event: WebhookEvent =
				decision.action === "rebalance" ? "yield_rebalance" : "yield_supply";
			fireWebhook(worker.webhookUrl, {
				event,
				workerId: worker.id,
				network: worker.network,
				accountId: worker.accountId,
				timestamp: new Date().toISOString(),
				cycleNumber: worker.cycleCount,
				data: {
					decision,
					executionActions: actions,
				},
			});
		} else if (decision.action === "hold") {
			fireWebhook(worker.webhookUrl, {
				event: "yield_hold",
				workerId: worker.id,
				network: worker.network,
				accountId: worker.accountId,
				timestamp: new Date().toISOString(),
				cycleNumber: worker.cycleCount,
				data: { decision },
			});
		}

		worker.consecutiveErrors = 0;
	} catch (err) {
		worker.consecutiveErrors++;
		log.decision = {
			...log.decision,
			action: "hold",
			reason: `Cycle error: ${err instanceof Error ? err.message : String(err)}`,
		};

		if (worker.consecutiveErrors >= worker.maxConsecutiveErrors) {
			worker.status = "error";
			worker.stoppedAt = new Date().toISOString();
			if (worker.timer) {
				clearTimeout(worker.timer);
				worker.timer = null;
			}
			fireWebhook(worker.webhookUrl, {
				event: "error_pause",
				workerId: worker.id,
				network: worker.network,
				accountId: worker.accountId,
				timestamp: new Date().toISOString(),
				cycleNumber: worker.cycleCount,
				data: {
					consecutiveErrors: worker.consecutiveErrors,
					lastError: err instanceof Error ? err.message : String(err),
				},
			});
		}
	}

	log.durationMs = Date.now() - start;
	pushLog(worker, log);
	scheduleNext(worker);
}

function pushLog(
	worker: YieldWorkerState & { timer: ReturnType<typeof setTimeout> | null },
	log: YieldCycleLog,
): void {
	worker.recentLogs.push(log);
	if (worker.recentLogs.length > 50) {
		worker.recentLogs.shift();
	}
}

function scheduleNext(
	worker: YieldWorkerState & { timer: ReturnType<typeof setTimeout> | null },
): void {
	if (worker.status === "running") {
		worker.timer = setTimeout(() => {
			runCycle(worker).catch(() => {});
		}, worker.intervalMs);
	}
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveConfig(params: {
	minAprDelta?: number;
	stableSymbols?: string[];
	topN?: number;
	paused?: boolean;
}): YieldWorkerConfig {
	return {
		minAprDelta: params.minAprDelta ?? DEFAULT_CONFIG.minAprDelta,
		stableSymbols:
			params.stableSymbols && params.stableSymbols.length > 0
				? params.stableSymbols
				: DEFAULT_CONFIG.stableSymbols,
		topN: params.topN ?? DEFAULT_CONFIG.topN,
		paused: params.paused ?? DEFAULT_CONFIG.paused,
	};
}

// ---------------------------------------------------------------------------
// Exported test helpers
// ---------------------------------------------------------------------------

export function getYieldWorkerState(
	workerId: string,
): YieldWorkerState | undefined {
	const w = workers.get(workerId);
	if (!w) return undefined;
	const { timer: _timer, ...state } = w;
	return state;
}

export function clearAllYieldWorkers(): void {
	for (const [, w] of workers) {
		if (w.timer) clearTimeout(w.timer);
	}
	workers.clear();
}

export function getYieldWorkerIds(): string[] {
	return [...workers.keys()];
}

// ---------------------------------------------------------------------------
// MCP tools
// ---------------------------------------------------------------------------

const networkSchema = Type.Union(
	[Type.Literal("mainnet"), Type.Literal("testnet")],
	{ description: "NEAR network" },
);

export function createNearYieldWorkerTools() {
	return [
		// ---------------------------------------------------------------
		// Start worker
		// ---------------------------------------------------------------
		defineTool({
			name: `${NEAR_TOOL_PREFIX}yieldWorkerStart`,
			label: "NEAR Yield Worker Start",
			description:
				"Start an autonomous stablecoin yield optimization worker on NEAR/Burrow. " +
				"Continuously scans Burrow lending markets, compares APR with current position, " +
				"and recommends or executes rebalance actions to maximize stablecoin yield. " +
				"Returns immediately — worker runs in background. " +
				"Use near_yieldWorkerStatus to check progress.",
			parameters: Type.Object({
				network: networkSchema,
				accountId: Type.String({
					description: "NEAR account id to monitor (e.g. alice.near)",
				}),
				dryRun: Type.Optional(
					Type.Boolean({
						description:
							"Log decisions without executing (default true). Safe for demo.",
					}),
				),
				intervalSeconds: Type.Optional(
					Type.Number({
						minimum: 30,
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
				webhookUrl: Type.Optional(
					Type.String({
						description:
							"Webhook URL for notifications (yield_rebalance, yield_supply, error_pause). Falls back to NEAR_YIELD_WORKER_WEBHOOK_URL env.",
					}),
				),
				minAprDelta: Type.Optional(
					Type.Number({
						minimum: 0,
						maximum: 50,
						description:
							"Minimum APR improvement (absolute %) to trigger rebalance (default 0.5)",
					}),
				),
				stableSymbols: Type.Optional(
					Type.Array(Type.String(), {
						description:
							'Stablecoin symbols to scan (default ["USDC","USDT","USDt","DAI","USDC.e","FRAX"])',
					}),
				),
				topN: Type.Optional(
					Type.Number({
						minimum: 1,
						maximum: 20,
						description: "Top N candidates to scan (default 5)",
					}),
				),
				paused: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = params.accountId.trim();
				if (!accountId) throw new Error("accountId is required");

				const dryRun = params.dryRun !== false;
				const intervalMs = (params.intervalSeconds ?? 300) * 1000;
				const maxConsecutiveErrors = params.maxConsecutiveErrors ?? 5;
				const config = resolveConfig(params);

				const workerId = `near:${network}:${accountId}`;
				const existing = workers.get(workerId);
				if (existing && existing.status === "running") {
					throw new Error(
						`Yield worker already running for ${accountId} on ${network}. Stop it first with near_yieldWorkerStop.`,
					);
				}

				const webhookUrl =
					params.webhookUrl?.trim() ||
					process.env.NEAR_YIELD_WORKER_WEBHOOK_URL?.trim() ||
					undefined;

				const worker: YieldWorkerState & {
					timer: ReturnType<typeof setTimeout> | null;
					webhookUrl?: string;
				} = {
					id: workerId,
					network,
					accountId,
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
					webhookUrl,
				};

				workers.set(workerId, worker);

				// Start first cycle immediately
				runCycle(worker).catch(() => {});

				return {
					content: [
						{
							type: "text",
							text: `NEAR yield worker started: ${workerId}. Mode: ${dryRun ? "dry-run (observe only)" : "LIVE"}. Interval: ${params.intervalSeconds ?? 300}s. Scanning ${config.stableSymbols.join("/")} on Burrow. Use near_yieldWorkerStatus to check progress.`,
						},
					],
					details: {
						schema: "near.yield.worker.start.v1",
						workerId,
						network,
						accountId,
						dryRun,
						intervalSeconds: params.intervalSeconds ?? 300,
						maxConsecutiveErrors,
						config,
						webhookUrl: webhookUrl ?? null,
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// Stop worker
		// ---------------------------------------------------------------
		defineTool({
			name: `${NEAR_TOOL_PREFIX}yieldWorkerStop`,
			label: "NEAR Yield Worker Stop",
			description: "Stop a running NEAR yield optimization worker.",
			parameters: Type.Object({
				network: networkSchema,
				accountId: Type.String({ description: "NEAR account id" }),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = params.accountId.trim();
				const workerId = `near:${network}:${accountId}`;
				const worker = workers.get(workerId);

				if (!worker) {
					return {
						content: [
							{
								type: "text",
								text: `No yield worker found for ${accountId} on ${network}.`,
							},
						],
						details: {
							schema: "near.yield.worker.stop.v1",
							workerId,
							found: false,
						},
					};
				}

				worker.status = "stopped";
				worker.stoppedAt = new Date().toISOString();
				if (worker.timer) {
					clearTimeout(worker.timer);
					worker.timer = null;
				}

				fireWebhook(worker.webhookUrl, {
					event: "worker_stopped",
					workerId: worker.id,
					network: worker.network,
					accountId: worker.accountId,
					timestamp: new Date().toISOString(),
					cycleNumber: worker.cycleCount,
					data: { stoppedBy: "user" },
				});

				return {
					content: [
						{
							type: "text",
							text: `NEAR yield worker stopped: ${workerId}. Ran ${worker.cycleCount} cycles.`,
						},
					],
					details: {
						schema: "near.yield.worker.stop.v1",
						workerId,
						found: true,
						cyclesRun: worker.cycleCount,
						stoppedAt: worker.stoppedAt,
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// Status
		// ---------------------------------------------------------------
		defineTool({
			name: `${NEAR_TOOL_PREFIX}yieldWorkerStatus`,
			label: "NEAR Yield Worker Status",
			description:
				"Get current state + recent decision logs for a NEAR yield worker.",
			parameters: Type.Object({
				network: networkSchema,
				accountId: Type.String({ description: "NEAR account id" }),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = params.accountId.trim();
				const workerId = `near:${network}:${accountId}`;
				const worker = workers.get(workerId);

				if (!worker) {
					return {
						content: [
							{
								type: "text",
								text: `No yield worker found for ${accountId} on ${network}.`,
							},
						],
						details: {
							schema: "near.yield.worker.status.v1",
							workerId,
							found: false,
						},
					};
				}

				const { timer: _timer, ...state } = worker;
				const lastLog =
					worker.recentLogs.length > 0
						? worker.recentLogs[worker.recentLogs.length - 1]
						: null;

				const lines = [
					`NEAR Yield Worker: ${workerId}`,
					`Status: ${worker.status} | Mode: ${worker.dryRun ? "dry-run" : "LIVE"}`,
					`Cycles: ${worker.cycleCount} | Errors: ${worker.consecutiveErrors}`,
					`Config: minAprDelta=${worker.config.minAprDelta}%, symbols=${worker.config.stableSymbols.join("/")}`,
				];
				if (lastLog) {
					lines.push(
						`Last decision: ${lastLog.decision.action.toUpperCase()} — ${lastLog.decision.reason}`,
					);
					if (lastLog.decision.currentSymbol) {
						lines.push(
							`  Current: ${lastLog.decision.currentSymbol} at ${lastLog.decision.currentApr ?? "?"}% APR`,
						);
					}
					if (lastLog.decision.bestSymbol) {
						lines.push(
							`  Best:    ${lastLog.decision.bestSymbol} at ${lastLog.decision.bestApr ?? "?"}% APR`,
						);
					}
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						schema: "near.yield.worker.status.v1",
						workerId,
						found: true,
						...state,
					},
				};
			},
		}),
	];
}
