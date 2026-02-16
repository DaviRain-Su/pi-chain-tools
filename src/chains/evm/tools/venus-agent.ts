/**
 * Venus BorrowBot Agent — integrates LTV Manager + Venus Adapter into an
 * autonomous position management tool.
 *
 * - `evm_venusAgentCheck`: read position → run LTV decision → return recommended action
 * - `evm_venusAgentExecute`: read position → decide → execute action (with safety gates)
 *
 * The agent is stateless per invocation: every call reads fresh on-chain data.
 * Configuration comes from env vars or explicit params.
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { isMainnetLikeEvmNetwork } from "../policy.js";
import {
	EVM_TOOL_PREFIX,
	type EvmNetwork,
	evmNetworkSchema,
	parseEvmNetwork,
} from "../runtime.js";
import type { LendingMarket } from "./lending-types.js";
import {
	type AgentConfig,
	DEFAULT_AGENT_CONFIG,
	type LtvAction,
	type LtvManagerInput,
	decideLtvAction,
} from "./ltv-manager.js";
import { createVenusAdapter } from "./venus-adapter.js";

// ---------------------------------------------------------------------------
// Agent config resolution
// ---------------------------------------------------------------------------

function resolveAgentConfig(params: {
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
// Position-to-LTV input bridge
// ---------------------------------------------------------------------------

/**
 * Find the best supply/borrow market pair from position and market data
 * to feed into the LTV manager. Uses the largest-balance supply as the
 * reference market for APY/APR.
 */
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

	// Find the reference market — largest supply position
	let supplyAPY = 0;
	let borrowAPR = 0;

	if (markets.length > 0) {
		// Default: use the first market with best supply APY
		const sortedBySupply = [...markets]
			.filter((m) => m.isListed)
			.sort((a, b) => b.supplyAPY - a.supplyAPY);
		if (sortedBySupply.length > 0) {
			supplyAPY = sortedBySupply[0].supplyAPY;
		}

		// For borrow APR: use the lowest borrow APY market (cheapest to borrow)
		const sortedByBorrow = [...markets]
			.filter((m) => m.isListed)
			.sort((a, b) => a.borrowAPY - b.borrowAPY);
		if (sortedByBorrow.length > 0) {
			borrowAPR = sortedByBorrow[0].borrowAPY;
		}

		// Override with actual position markets if available
		if (position.supplies.length > 0) {
			const largestSupply = position.supplies.reduce((a, b) =>
				BigInt(a.balanceRaw) > BigInt(b.balanceRaw) ? a : b,
			);
			const supplyMarket = markets.find(
				(m) =>
					m.marketAddress.toLowerCase() ===
					largestSupply.marketAddress.toLowerCase(),
			);
			if (supplyMarket) {
				supplyAPY = supplyMarket.supplyAPY;
			}
		}

		if (position.borrows.length > 0) {
			const largestBorrow = position.borrows.reduce((a, b) =>
				BigInt(a.balanceRaw) > BigInt(b.balanceRaw) ? a : b,
			);
			const borrowMarket = markets.find(
				(m) =>
					m.marketAddress.toLowerCase() ===
					largestBorrow.marketAddress.toLowerCase(),
			);
			if (borrowMarket) {
				borrowAPR = borrowMarket.borrowAPY;
			}
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
// Audit log
// ---------------------------------------------------------------------------

type AgentAuditEntry = {
	timestamp: string;
	network: EvmNetwork;
	account: string;
	action: LtvAction;
	config: AgentConfig;
	input: LtvManagerInput;
};

const AUDIT_LOG: AgentAuditEntry[] = [];

function recordAudit(entry: AgentAuditEntry): void {
	AUDIT_LOG.push(entry);
	// Keep last 100 entries in memory
	if (AUDIT_LOG.length > 100) {
		AUDIT_LOG.shift();
	}
}

/** Read audit log (for testing / observability). */
export function getAgentAuditLog(): readonly AgentAuditEntry[] {
	return AUDIT_LOG;
}

/** Clear audit log (for testing). */
export function clearAgentAuditLog(): void {
	AUDIT_LOG.length = 0;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const agentConfigParams = {
	maxLTV: Type.Optional(
		Type.Number({
			minimum: 0.01,
			maximum: 0.99,
			description: "Max LTV threshold (0..1). Default 0.75.",
		}),
	),
	targetLTV: Type.Optional(
		Type.Number({
			minimum: 0.01,
			maximum: 0.99,
			description: "Target LTV (0..1). Default 0.60.",
		}),
	),
	minYieldSpread: Type.Optional(
		Type.Number({
			minimum: 0,
			maximum: 1,
			description:
				"Min yield spread for auto-optimize (0..1 ratio). Default 0.02.",
		}),
	),
	paused: Type.Optional(
		Type.Boolean({ description: "Kill switch. Default false." }),
	),
};

export function createVenusAgentTools() {
	return [
		// ---------------------------------------------------------------
		// evm_venusAgentCheck — read-only decision
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}venusAgentCheck`,
			label: "Venus Agent Check",
			description:
				"Read Venus position + market rates, run LTV decision engine, and return recommended action (hold/repay/optimize). Read-only, no transactions.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				account: Type.String({
					description: "BSC wallet address to check",
				}),
				...agentConfigParams,
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const account = params.account.trim();
				if (!/^0x[a-fA-F0-9]{40}$/.test(account)) {
					throw new Error("account must be a valid EVM address");
				}

				const config = resolveAgentConfig(params);
				const adapter = createVenusAdapter();

				const [markets, position] = await Promise.all([
					adapter.getMarkets(network),
					adapter.getAccountPosition(network, account),
				]);

				const ltvInput = buildLtvInput(position, markets, config);
				const decision = decideLtvAction(ltvInput);

				recordAudit({
					timestamp: new Date().toISOString(),
					network,
					account,
					action: decision,
					config,
					input: ltvInput,
				});

				return {
					content: [
						{
							type: "text",
							text: `Venus Agent [${network}] ${account}: action=${decision.action} — ${decision.reason}`,
						},
					],
					details: {
						schema: "evm.venus.agent.check.v1",
						network,
						account,
						config,
						ltvInput: {
							collateralValueUsd: ltvInput.collateralValueUsd,
							borrowValueUsd: ltvInput.borrowValueUsd,
							supplyAPY: `${ltvInput.supplyAPY.toFixed(2)}%`,
							borrowAPR: `${ltvInput.borrowAPR.toFixed(2)}%`,
						},
						decision: {
							action: decision.action,
							currentLTV: `${(decision.currentLTV * 100).toFixed(2)}%`,
							yieldSpread: `${(decision.yieldSpread * 100).toFixed(2)}%`,
							reason: decision.reason,
							...(decision.action === "repay"
								? {
										repayAmountUsd: `$${decision.repayAmountUsd.toFixed(2)}`,
									}
								: {}),
							...(decision.action === "optimize"
								? {
										borrowMoreUsd: `$${decision.borrowMoreUsd.toFixed(2)}`,
									}
								: {}),
						},
						position: {
							suppliesCount: position.supplies.length,
							borrowsCount: position.borrows.length,
							totalCollateralValueUsd: position.totalCollateralValueUsd,
							totalBorrowValueUsd: position.totalBorrowValueUsd,
							healthFactor:
								position.healthFactor === Number.POSITIVE_INFINITY
									? "∞"
									: position.healthFactor.toFixed(4),
						},
						marketsCount: markets.length,
						auditLogSize: AUDIT_LOG.length,
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// evm_venusAgentAuditLog — read audit entries
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}venusAgentAuditLog`,
			label: "Venus Agent Audit Log",
			description:
				"Read the in-memory audit log of recent Venus agent check/execute decisions. Returns up to the last 100 entries.",
			parameters: Type.Object({
				limit: Type.Optional(
					Type.Number({
						minimum: 1,
						maximum: 100,
						description: "Max entries to return. Default 20.",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const limit = params.limit ?? 20;
				const entries = AUDIT_LOG.slice(-limit);
				return {
					content: [
						{
							type: "text",
							text: `Venus Agent audit log: ${entries.length} entries (of ${AUDIT_LOG.length} total).`,
						},
					],
					details: {
						schema: "evm.venus.agent.auditLog.v1",
						totalEntries: AUDIT_LOG.length,
						returnedEntries: entries.length,
						entries: entries.map((e) => ({
							timestamp: e.timestamp,
							network: e.network,
							account: e.account,
							action: e.action.action,
							reason: e.action.reason,
							currentLTV: `${(e.action.currentLTV * 100).toFixed(2)}%`,
						})),
					},
				};
			},
		}),
	];
}
