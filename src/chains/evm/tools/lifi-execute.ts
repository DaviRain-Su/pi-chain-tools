/**
 * LI.FI execute-facing tools — quote planning preview for bridge execution.
 *
 * - `evm_lifiExecuteBridge`: plan approval+bridge steps and return PI SDK handoff artifacts
 *
 * Safety gates:
 * - Defaults to dryRun=true (preview only)
 * - Requires confirmMainnet=true for mainnet intent acknowledgment
 * - Direct mutation is blocked; PI SDK remains execution authority
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { isMainnetLikeEvmNetwork } from "../policy.js";
import {
	EVM_TOOL_PREFIX,
	evmNetworkSchema,
	getEvmChainId,
	parseEvmNetwork,
} from "../runtime.js";
import { planLifiQuoteRoutes } from "./lifi-planning.js";
import { LIFI_DEFAULT_SLIPPAGE } from "./lifi-types.js";
import { resolveEvmSignerForTool } from "./signer-resolve.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertAddress(value: string, label: string): string {
	const addr = value.trim();
	if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
		throw new Error(`${label} must be a valid EVM address (0x + 40 hex)`);
	}
	return addr;
}

// ERC-20 approve selector: approve(address,uint256)
const APPROVE_SELECTOR = "0x095ea7b3";

function buildApproveData(spender: string, amount: string): string {
	const spenderPadded = spender
		.toLowerCase()
		.replace("0x", "")
		.padStart(64, "0");
	const amountHex = BigInt(amount).toString(16).padStart(64, "0");
	return `${APPROVE_SELECTOR}${spenderPadded}${amountHex}`;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function createLifiExecuteTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}lifiExecuteBridge`,
			label: "LI.FI Execute Bridge",
			description:
				"Execute a cross-chain bridge/swap via LI.FI. Gets a quote, handles ERC-20 approval if needed, and sends the bridge transaction. Defaults to dryRun=true.",
			parameters: Type.Object({
				fromNetwork: evmNetworkSchema(),
				toNetwork: evmNetworkSchema(),
				fromToken: Type.String({ description: "Source token address" }),
				toToken: Type.String({ description: "Destination token address" }),
				fromAmount: Type.String({ description: "Amount in raw integer units" }),
				toAddress: Type.Optional(
					Type.String({
						description: "Destination address (defaults to sender)",
					}),
				),
				slippage: Type.Optional(
					Type.Number({
						minimum: 0.001,
						maximum: 0.5,
						description: "Slippage tolerance (decimal). Default 0.03.",
					}),
				),
				order: Type.Optional(
					Type.Union([
						Type.Literal("RECOMMENDED"),
						Type.Literal("FASTEST"),
						Type.Literal("CHEAPEST"),
						Type.Literal("SAFEST"),
					]),
				),
				dryRun: Type.Optional(
					Type.Boolean({ description: "Preview only (default true)" }),
				),
				confirmMainnet: Type.Optional(
					Type.Boolean({ description: "Required for mainnet execution" }),
				),
				fromPrivateKey: Type.Optional(
					Type.String({
						description: "Private key for signing (or use EVM_PRIVATE_KEY)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const fromNetwork = parseEvmNetwork(params.fromNetwork ?? "ethereum");
				const toNetwork = parseEvmNetwork(params.toNetwork ?? "ethereum");
				const fromChain = getEvmChainId(fromNetwork);
				const toChain = getEvmChainId(toNetwork);
				const fromToken = assertAddress(params.fromToken, "fromToken");
				const toToken = assertAddress(params.toToken, "toToken");
				const dryRun = params.dryRun !== false;
				const slippage = params.slippage ?? LIFI_DEFAULT_SLIPPAGE;

				// Resolve signer to get fromAddress
				const signer = resolveEvmSignerForTool({
					fromPrivateKey: params.fromPrivateKey,
					network: fromNetwork,
				});
				const fromAddress = await signer.getAddress(fromNetwork);
				const toAddress = params.toAddress
					? assertAddress(params.toAddress, "toAddress")
					: fromAddress;

				// Get quote
				const queryParams: Record<string, string> = {
					fromChain: fromChain.toString(),
					toChain: toChain.toString(),
					fromToken,
					toToken,
					fromAmount: params.fromAmount,
					fromAddress,
					toAddress,
					slippage: slippage.toString(),
					integrator: process.env.LIFI_INTEGRATOR?.trim() || "pi-chain-tools",
				};
				const planned = await planLifiQuoteRoutes({
					baseParams: queryParams,
					preferredOrder: params.order,
				});
				const quote = planned.selected.quote;
				const tx = quote.transactionRequest;

				// Check if ERC-20 approval is needed
				const isNative =
					fromToken === "0x0000000000000000000000000000000000000000";
				const needsApproval = !isNative && !!quote.estimate.approvalAddress;

				const steps: {
					description: string;
					to: string;
					data: string;
					value: string;
				}[] = [];

				if (needsApproval) {
					steps.push({
						description: `Approve ${quote.action.fromToken.symbol} for LI.FI router`,
						to: fromToken,
						data: buildApproveData(
							quote.estimate.approvalAddress,
							params.fromAmount,
						),
						value: "0x0",
					});
				}

				steps.push({
					description: `Bridge ${quote.action.fromToken.symbol} → ${quote.action.toToken.symbol} via ${quote.tool}`,
					to: tx.to,
					data: tx.data,
					value: tx.value,
				});

				// Dry run — planning preview only
				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `LI.FI bridge preview: ${steps.length} step(s). ${fromNetwork} → ${toNetwork} via ${quote.tool}. Execution remains gated by PI SDK confirm/policy/reconcile flow.`,
							},
						],
						details: {
							schema: "evm.lifi.bridge.preview.v2",
							dryRun: true,
							fromNetwork,
							toNetwork,
							tool: quote.tool,
							fromToken: quote.action.fromToken.symbol,
							toToken: quote.action.toToken.symbol,
							fromAmount: params.fromAmount,
							estimatedToAmount: quote.estimate.toAmount,
							estimatedToAmountMin: quote.estimate.toAmountMin,
							executionDuration: `${quote.estimate.executionDuration}s`,
							needsApproval,
							stepsCount: steps.length,
							steps: steps.map((s) => ({
								description: s.description,
								to: s.to,
							})),
							routeSelection: {
								selectedOrder: planned.selected.order,
								score: planned.selected.score,
								rationale: planned.selected.rationale,
								riskHints: planned.selected.riskHints,
								candidateCount: planned.candidates.length,
							},
							fallback: planned.fallback,
							metrics: {
								lifiQuote: planned.metrics,
							},
							executionBoundary: {
								planningAuthority: "lifi",
								executionAuthority: "pi-sdk",
								mutatingExecutionAllowed: false,
							},
							reconciliation: {
								selectedRouteOrder: planned.selected.order,
								rationale: planned.selected.rationale,
								txPreview: {
									to: tx.to,
									value: tx.value,
									chainId: tx.chainId,
									hasData: !!tx.data,
								},
							},
						},
					};
				}

				const mainnetLike =
					isMainnetLikeEvmNetwork(fromNetwork) ||
					isMainnetLikeEvmNetwork(toNetwork);
				if (mainnetLike && params.confirmMainnet !== true) {
					throw new Error(
						"Mainnet bridge execution requires confirmMainnet=true.",
					);
				}

				throw new Error(
					"LI.FI direct mutation is disabled in this tool. Use PI SDK execution flow after quote planning.",
				);
			},
		}),
	];
}
