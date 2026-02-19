/**
 * LI.FI read tools — cross-chain quote and status tracking.
 *
 * - `evm_lifiGetQuote`: get cross-chain bridge/swap quote with route + fees
 * - `evm_lifiGetStatus`: check bridge transaction status
 *
 * Both tools are read-only — no signing or broadcasting.
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	EVM_TOOL_PREFIX,
	evmNetworkSchema,
	getEvmChainId,
	parseEvmNetwork,
} from "../runtime.js";
import { lifiGet, planLifiQuoteRoutes } from "./lifi-planning.js";
import {
	LIFI_DEFAULT_SLIPPAGE,
	type LifiStatusResponse,
} from "./lifi-types.js";

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatAmount(raw: string, decimals: number): string {
	if (!raw || decimals <= 0) return raw;
	const padded = raw.padStart(decimals + 1, "0");
	const intPart = padded.slice(0, -decimals) || "0";
	const fracPart = padded.slice(-decimals).replace(/0+$/, "");
	return fracPart ? `${intPart}.${fracPart}` : intPart;
}

// ---------------------------------------------------------------------------
// Address validation
// ---------------------------------------------------------------------------

function assertAddress(value: string, label: string): string {
	const addr = value.trim();
	if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
		throw new Error(`${label} must be a valid EVM address (0x + 40 hex)`);
	}
	return addr;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function createLifiReadTools() {
	return [
		// ---------------------------------------------------------------
		// evm_lifiGetQuote
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}lifiGetQuote`,
			label: "LI.FI Cross-Chain Quote",
			description:
				"Get a cross-chain bridge/swap quote from LI.FI. Returns route, fees, estimated time, and transaction calldata for execution.",
			parameters: Type.Object({
				fromNetwork: evmNetworkSchema(),
				toNetwork: evmNetworkSchema(),
				fromToken: Type.String({
					description: "Source token address (0x...)",
				}),
				toToken: Type.String({
					description: "Destination token address (0x...)",
				}),
				fromAmount: Type.String({
					description: "Amount in raw integer units",
				}),
				fromAddress: Type.String({
					description: "Sender wallet address",
				}),
				toAddress: Type.Optional(
					Type.String({
						description: "Destination wallet address (defaults to fromAddress)",
					}),
				),
				slippage: Type.Optional(
					Type.Number({
						minimum: 0.001,
						maximum: 0.5,
						description:
							"Slippage tolerance as decimal (e.g. 0.03 = 3%). Default 0.03.",
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
			}),
			async execute(_toolCallId, params) {
				const fromNetwork = parseEvmNetwork(params.fromNetwork ?? "ethereum");
				const toNetwork = parseEvmNetwork(params.toNetwork ?? "ethereum");
				const fromChain = getEvmChainId(fromNetwork);
				const toChain = getEvmChainId(toNetwork);
				const fromToken = assertAddress(params.fromToken, "fromToken");
				const toToken = assertAddress(params.toToken, "toToken");
				const fromAddress = assertAddress(params.fromAddress, "fromAddress");
				const toAddress = params.toAddress
					? assertAddress(params.toAddress, "toAddress")
					: undefined;
				const slippage = params.slippage ?? LIFI_DEFAULT_SLIPPAGE;

				const queryParams: Record<string, string> = {
					fromChain: fromChain.toString(),
					toChain: toChain.toString(),
					fromToken,
					toToken,
					fromAmount: params.fromAmount,
					fromAddress,
					slippage: slippage.toString(),
				};
				if (toAddress) queryParams.toAddress = toAddress;
				const integrator =
					process.env.LIFI_INTEGRATOR?.trim() || "pi-chain-tools";
				queryParams.integrator = integrator;

				const planned = await planLifiQuoteRoutes({
					baseParams: queryParams,
					preferredOrder: params.order,
				});
				const quote = planned.selected.quote;

				const fromDec = quote.action.fromToken.decimals;
				const toDec = quote.action.toToken.decimals;

				return {
					content: [
						{
							type: "text",
							text: `LI.FI quote: ${formatAmount(quote.estimate.fromAmount, fromDec)} ${quote.action.fromToken.symbol} (${fromNetwork}) → ${formatAmount(quote.estimate.toAmount, toDec)} ${quote.action.toToken.symbol} (${toNetwork}) via ${quote.tool}. ETA: ${formatDuration(quote.estimate.executionDuration)}.`,
						},
					],
					details: {
						schema: "evm.lifi.quote.v1",
						quoteId: quote.id,
						tool: quote.tool,
						toolDetails: quote.toolDetails,
						from: {
							network: fromNetwork,
							chainId: fromChain,
							token: quote.action.fromToken.symbol,
							tokenAddress: quote.action.fromToken.address,
							amount: formatAmount(quote.estimate.fromAmount, fromDec),
							amountRaw: quote.estimate.fromAmount,
						},
						to: {
							network: toNetwork,
							chainId: toChain,
							token: quote.action.toToken.symbol,
							tokenAddress: quote.action.toToken.address,
							amount: formatAmount(quote.estimate.toAmount, toDec),
							amountRaw: quote.estimate.toAmount,
							amountMin: formatAmount(quote.estimate.toAmountMin, toDec),
						},
						executionDuration: `${quote.estimate.executionDuration}s`,
						executionDurationHuman: formatDuration(
							quote.estimate.executionDuration,
						),
						slippage,
						feeCosts: quote.estimate.feeCosts.map((f) => ({
							name: f.name,
							amount: f.amount,
							token: f.token.symbol,
						})),
						gasCosts: quote.estimate.gasCosts.map((g) => ({
							type: g.type,
							estimate: g.estimate,
							token: g.token.symbol,
						})),
						stepsCount: quote.includedSteps.length,
						steps: quote.includedSteps.map((s) => ({
							type: s.type,
							tool: s.tool,
							fromChainId: s.action.fromChainId,
							toChainId: s.action.toChainId,
							fromToken: s.action.fromToken.symbol,
							toToken: s.action.toToken.symbol,
						})),
						approvalAddress: quote.estimate.approvalAddress,
						routeSelection: {
							selectedOrder: planned.selected.order,
							score: planned.selected.score,
							rationale: planned.selected.rationale,
							riskHints: planned.selected.riskHints,
							candidateCount: planned.candidates.length,
							candidates: planned.candidates.map((candidate) => ({
								order: candidate.order,
								score: candidate.score,
								effectiveCostBps: candidate.metrics.effectiveCostBps,
								hops: candidate.metrics.hops,
								durationSeconds: candidate.metrics.durationSeconds,
								riskHints: candidate.riskHints,
							})),
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
						transactionRequest: {
							to: quote.transactionRequest.to,
							value: quote.transactionRequest.value,
							gasLimit: quote.transactionRequest.gasLimit,
							chainId: quote.transactionRequest.chainId,
							// data excluded for summary — too large
							hasData: !!quote.transactionRequest.data,
						},
						// Store full tx request for execute phase
						_transactionRequest: quote.transactionRequest,
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// evm_lifiGetStatus
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}lifiGetStatus`,
			label: "LI.FI Bridge Status",
			description:
				"Check the status of a cross-chain bridge transaction. Returns status (PENDING/DONE/FAILED), source and destination tx details.",
			parameters: Type.Object({
				txHash: Type.String({
					description: "Transaction hash on source chain",
				}),
				fromNetwork: evmNetworkSchema(),
				toNetwork: evmNetworkSchema(),
				bridge: Type.Optional(
					Type.String({
						description: "Bridge tool name (optional, improves lookup speed)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const fromNetwork = parseEvmNetwork(params.fromNetwork ?? "ethereum");
				const toNetwork = parseEvmNetwork(params.toNetwork ?? "ethereum");
				const fromChain = getEvmChainId(fromNetwork);
				const toChain = getEvmChainId(toNetwork);

				const queryParams: Record<string, string> = {
					txHash: params.txHash.trim(),
					fromChain: fromChain.toString(),
					toChain: toChain.toString(),
				};
				if (params.bridge) queryParams.bridge = params.bridge;

				const status = await lifiGet<LifiStatusResponse>(
					"/status",
					queryParams,
				);

				return {
					content: [
						{
							type: "text",
							text: `LI.FI bridge status: ${status.status}${status.substatus ? ` (${status.substatus})` : ""}. ${status.substatusMessage || ""}`,
						},
					],
					details: {
						schema: "evm.lifi.status.v1",
						status: status.status,
						substatus: status.substatus ?? null,
						substatusMessage: status.substatusMessage ?? null,
						tool: status.tool ?? null,
						sending: status.sending
							? {
									txHash: status.sending.txHash,
									txLink: status.sending.txLink ?? null,
									amount: status.sending.amount,
									token: status.sending.token.symbol,
									chainId: status.sending.chainId,
								}
							: null,
						receiving: status.receiving
							? {
									txHash: status.receiving.txHash,
									txLink: status.receiving.txLink ?? null,
									amount: status.receiving.amount,
									token: status.receiving.token.symbol,
									chainId: status.receiving.chainId,
								}
							: null,
						bridgeExplorerLink: status.bridgeExplorerLink ?? null,
					},
				};
			},
		}),
	];
}
