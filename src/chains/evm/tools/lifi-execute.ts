/**
 * LI.FI execute tools — cross-chain bridge execution with approval handling.
 *
 * - `evm_lifiExecuteBridge`: approve (if needed) + send bridge transaction
 *
 * Safety gates:
 * - Defaults to dryRun=true (preview only)
 * - Requires confirmMainnet=true for mainnet chains
 * - Uses EvmSignerProvider for pluggable signing (Local/Privy)
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
import type {
	LifiQuoteResponse,
	LifiTransactionRequest,
} from "./lifi-types.js";
import { LIFI_API_BASE, LIFI_DEFAULT_SLIPPAGE } from "./lifi-types.js";
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

async function lifiGet<T>(
	path: string,
	params: Record<string, string>,
): Promise<T> {
	const apiBase = process.env.LIFI_API_BASE?.trim() || LIFI_API_BASE;
	const url = new URL(path, apiBase);
	for (const [k, v] of Object.entries(params)) {
		if (v) url.searchParams.set(k, v);
	}
	const headers: Record<string, string> = { Accept: "application/json" };
	const apiKey = process.env.LIFI_API_KEY?.trim();
	if (apiKey) headers["x-lifi-api-key"] = apiKey;

	const res = await fetch(url.toString(), { headers });
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(
			`LI.FI API error ${res.status}: ${res.statusText}. ${body}`,
		);
	}
	return (await res.json()) as T;
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
				if (params.order) queryParams.order = params.order;

				const quote = await lifiGet<LifiQuoteResponse>("/quote", queryParams);
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

				// Dry run — preview only
				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `LI.FI bridge preview: ${steps.length} step(s). ${fromNetwork} → ${toNetwork} via ${quote.tool}. Set dryRun=false to execute.`,
							},
						],
						details: {
							schema: "evm.lifi.bridge.preview.v1",
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
						},
					};
				}

				// Mainnet safety gate
				const mainnetLike =
					isMainnetLikeEvmNetwork(fromNetwork) ||
					isMainnetLikeEvmNetwork(toNetwork);
				if (mainnetLike && params.confirmMainnet !== true) {
					throw new Error(
						"Mainnet bridge execution requires confirmMainnet=true.",
					);
				}

				// Execute
				const txHashes: string[] = [];

				// Step 1: Approve (if needed)
				if (needsApproval) {
					const approveResult = await signer.signAndSend({
						network: fromNetwork,
						to: steps[0].to,
						data: steps[0].data,
						value: "0x0",
					});
					txHashes.push(approveResult.txHash);
				}

				// Step 2: Bridge transaction
				const bridgeStep = steps[steps.length - 1];
				const bridgeResult = await signer.signAndSend({
					network: fromNetwork,
					to: bridgeStep.to,
					data: bridgeStep.data,
					value: bridgeStep.value,
					gasLimit: tx.gasLimit,
				});
				txHashes.push(bridgeResult.txHash);

				return {
					content: [
						{
							type: "text",
							text: `LI.FI bridge submitted: ${txHashes.length} tx(es). Bridge tx: ${bridgeResult.txHash}. Track with evm_lifiGetStatus.`,
						},
					],
					details: {
						schema: "evm.lifi.bridge.execute.v1",
						dryRun: false,
						fromNetwork,
						toNetwork,
						tool: quote.tool,
						fromToken: quote.action.fromToken.symbol,
						toToken: quote.action.toToken.symbol,
						fromAmount: params.fromAmount,
						fromAddress,
						toAddress,
						txHashes,
						bridgeTxHash: bridgeResult.txHash,
						needsApproval,
						quoteId: quote.id,
					},
				};
			},
		}),
	];
}
