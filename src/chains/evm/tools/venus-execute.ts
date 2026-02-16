/**
 * Venus Protocol execute tools — MCP tool wrappers for Venus lending operations.
 *
 * All tools default to `dryRun=true` and require `confirmMainnet=true` for BSC mainnet execution.
 * Signing uses EvmSignerProvider abstraction (LocalKeySigner or PrivyEvmSigner).
 *
 * - `evm_venusSupply`:        Supply (deposit) underlying token to Venus
 * - `evm_venusBorrow`:        Borrow from Venus market
 * - `evm_venusRepay`:         Repay Venus borrow debt
 * - `evm_venusWithdraw`:      Withdraw (redeem) underlying from Venus
 * - `evm_venusEnterMarkets`:  Enable market(s) as collateral
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { isMainnetLikeEvmNetwork } from "../policy.js";
import {
	EVM_TOOL_PREFIX,
	type EvmNetwork,
	evmNetworkSchema,
	parseEvmNetwork,
	parsePositiveIntegerString,
} from "../runtime.js";
import type { EvmCallData } from "./lending-types.js";
import { resolveEvmSignerForTool } from "./signer-resolve.js";
import type { EvmSignerProvider } from "./signer-types.js";
import { createVenusAdapter } from "./venus-adapter.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseEvmAddress(value: string, fieldName: string): string {
	const normalized = value.trim();
	if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
		throw new Error(`${fieldName} must be a valid EVM address (0x + 40 hex)`);
	}
	return normalized;
}

// ---------------------------------------------------------------------------
// Send a batch of EvmCallData txs in sequence via EvmSignerProvider
// ---------------------------------------------------------------------------

type SendCallDataResult = {
	txHashes: string[];
	descriptions: string[];
	from: string;
};

async function sendCalldataViaSigner(params: {
	network: EvmNetwork;
	signer: EvmSignerProvider;
	calldata: EvmCallData[];
}): Promise<SendCallDataResult> {
	const { network, signer, calldata } = params;
	const txHashes: string[] = [];
	const descriptions: string[] = [];
	let from = "";

	for (const cd of calldata) {
		const result = await signer.signAndSend({
			network,
			to: cd.to,
			data: cd.data,
			value: cd.value,
		});
		txHashes.push(result.txHash);
		descriptions.push(cd.description);
		from = result.from;
	}

	return { txHashes, descriptions, from };
}

// ---------------------------------------------------------------------------
// Shared gate checks
// ---------------------------------------------------------------------------

function assertMainnetConfirmed(params: {
	network: string;
	dryRun: boolean;
	confirmMainnet?: boolean;
}): void {
	const mainnetLike = isMainnetLikeEvmNetwork(params.network as "bsc");
	if (!params.dryRun && mainnetLike && params.confirmMainnet !== true) {
		throw new Error(
			"BSC mainnet execution blocked. Re-run with confirmMainnet=true.",
		);
	}
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const venusCommonParams = {
	network: evmNetworkSchema(),
	dryRun: Type.Optional(Type.Boolean()),
	confirmMainnet: Type.Optional(Type.Boolean()),
	fromPrivateKey: Type.Optional(Type.String()),
};

export function createVenusExecuteTools() {
	return [
		// ---------------------------------------------------------------
		// evm_venusSupply
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}venusSupply`,
			label: "Venus Supply",
			description:
				"Supply (deposit) underlying token to Venus Protocol on BSC. Handles ERC-20 approve + mint. BNB uses msg.value. Defaults to dryRun=true.",
			parameters: Type.Object({
				...venusCommonParams,
				tokenAddress: Type.String({
					description:
						"Underlying token address (use 0x0000000000000000000000000000000000000000 for BNB)",
				}),
				amountRaw: Type.String({
					description: "Amount in raw units (e.g. 18 decimals for BSC tokens)",
				}),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				assertMainnetConfirmed({
					network,
					dryRun,
					confirmMainnet: params.confirmMainnet,
				});

				const tokenAddress = parseEvmAddress(
					params.tokenAddress,
					"tokenAddress",
				);
				const amountRaw = parsePositiveIntegerString(
					params.amountRaw,
					"amountRaw",
				);
				const adapter = createVenusAdapter();
				const calldata = await adapter.buildSupplyCalldata({
					network,
					account: "0x0000000000000000000000000000000000000000", // placeholder for dryRun
					tokenAddress,
					amountRaw,
				});

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Venus supply preview (${network}): ${calldata.map((c) => c.description).join(" → ")}`,
							},
						],
						details: {
							schema: "evm.venus.supply.preview.v1",
							dryRun: true,
							network,
							tokenAddress,
							amountRaw,
							steps: calldata.map((c) => ({
								to: c.to,
								data: c.data,
								value: c.value,
								description: c.description,
							})),
						},
					};
				}

				const signer = resolveEvmSignerForTool({
					fromPrivateKey: params.fromPrivateKey,
					network,
				});
				const result = await sendCalldataViaSigner({
					network,
					signer,
					calldata,
				});

				return {
					content: [
						{
							type: "text",
							text: `Venus supply submitted (${network}): ${result.txHashes.join(", ")}`,
						},
					],
					details: {
						schema: "evm.venus.supply.v1",
						dryRun: false,
						network,
						fromAddress: result.from,
						tokenAddress,
						amountRaw,
						txHashes: result.txHashes,
						descriptions: result.descriptions,
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// evm_venusBorrow
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}venusBorrow`,
			label: "Venus Borrow",
			description:
				"Borrow from a Venus Protocol market on BSC. Defaults to dryRun=true.",
			parameters: Type.Object({
				...venusCommonParams,
				marketAddress: Type.String({
					description: "vToken (Venus market) contract address",
				}),
				amountRaw: Type.String({
					description: "Amount to borrow in raw units",
				}),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				assertMainnetConfirmed({
					network,
					dryRun,
					confirmMainnet: params.confirmMainnet,
				});

				const marketAddress = parseEvmAddress(
					params.marketAddress,
					"marketAddress",
				);
				const amountRaw = parsePositiveIntegerString(
					params.amountRaw,
					"amountRaw",
				);
				const adapter = createVenusAdapter();
				const calldata = await adapter.buildBorrowCalldata({
					network,
					account: "0x0000000000000000000000000000000000000000",
					marketAddress,
					amountRaw,
				});

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Venus borrow preview (${network}): ${calldata.description}`,
							},
						],
						details: {
							schema: "evm.venus.borrow.preview.v1",
							dryRun: true,
							network,
							marketAddress,
							amountRaw,
							to: calldata.to,
							data: calldata.data,
							description: calldata.description,
						},
					};
				}

				const signer = resolveEvmSignerForTool({
					fromPrivateKey: params.fromPrivateKey,
					network,
				});
				const result = await sendCalldataViaSigner({
					network,
					signer,
					calldata: [calldata],
				});

				return {
					content: [
						{
							type: "text",
							text: `Venus borrow submitted (${network}): ${result.txHashes[0]}`,
						},
					],
					details: {
						schema: "evm.venus.borrow.v1",
						dryRun: false,
						network,
						fromAddress: result.from,
						marketAddress,
						amountRaw,
						txHash: result.txHashes[0],
						description: result.descriptions[0],
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// evm_venusRepay
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}venusRepay`,
			label: "Venus Repay",
			description:
				"Repay borrow debt on Venus Protocol (BSC). Handles ERC-20 approve + repayBorrow. BNB uses msg.value. Defaults to dryRun=true.",
			parameters: Type.Object({
				...venusCommonParams,
				tokenAddress: Type.String({
					description: "Underlying token address",
				}),
				amountRaw: Type.String({
					description: "Amount to repay in raw units",
				}),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				assertMainnetConfirmed({
					network,
					dryRun,
					confirmMainnet: params.confirmMainnet,
				});

				const tokenAddress = parseEvmAddress(
					params.tokenAddress,
					"tokenAddress",
				);
				const amountRaw = parsePositiveIntegerString(
					params.amountRaw,
					"amountRaw",
				);
				const adapter = createVenusAdapter();
				const calldata = await adapter.buildRepayCalldata({
					network,
					account: "0x0000000000000000000000000000000000000000",
					tokenAddress,
					amountRaw,
				});

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Venus repay preview (${network}): ${calldata.map((c) => c.description).join(" → ")}`,
							},
						],
						details: {
							schema: "evm.venus.repay.preview.v1",
							dryRun: true,
							network,
							tokenAddress,
							amountRaw,
							steps: calldata.map((c) => ({
								to: c.to,
								data: c.data,
								value: c.value,
								description: c.description,
							})),
						},
					};
				}

				const signer = resolveEvmSignerForTool({
					fromPrivateKey: params.fromPrivateKey,
					network,
				});
				const result = await sendCalldataViaSigner({
					network,
					signer,
					calldata,
				});

				return {
					content: [
						{
							type: "text",
							text: `Venus repay submitted (${network}): ${result.txHashes.join(", ")}`,
						},
					],
					details: {
						schema: "evm.venus.repay.v1",
						dryRun: false,
						network,
						fromAddress: result.from,
						tokenAddress,
						amountRaw,
						txHashes: result.txHashes,
						descriptions: result.descriptions,
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// evm_venusWithdraw
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}venusWithdraw`,
			label: "Venus Withdraw",
			description:
				"Withdraw (redeem) underlying token from Venus Protocol on BSC. Defaults to dryRun=true.",
			parameters: Type.Object({
				...venusCommonParams,
				tokenAddress: Type.String({
					description: "Underlying token address",
				}),
				amountRaw: Type.String({
					description: "Amount to withdraw in raw units",
				}),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				assertMainnetConfirmed({
					network,
					dryRun,
					confirmMainnet: params.confirmMainnet,
				});

				const tokenAddress = parseEvmAddress(
					params.tokenAddress,
					"tokenAddress",
				);
				const amountRaw = parsePositiveIntegerString(
					params.amountRaw,
					"amountRaw",
				);
				const adapter = createVenusAdapter();
				const calldata = await adapter.buildWithdrawCalldata({
					network,
					account: "0x0000000000000000000000000000000000000000",
					tokenAddress,
					amountRaw,
				});

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Venus withdraw preview (${network}): ${calldata.description}`,
							},
						],
						details: {
							schema: "evm.venus.withdraw.preview.v1",
							dryRun: true,
							network,
							tokenAddress,
							amountRaw,
							to: calldata.to,
							data: calldata.data,
							description: calldata.description,
						},
					};
				}

				const signer = resolveEvmSignerForTool({
					fromPrivateKey: params.fromPrivateKey,
					network,
				});
				const result = await sendCalldataViaSigner({
					network,
					signer,
					calldata: [calldata],
				});

				return {
					content: [
						{
							type: "text",
							text: `Venus withdraw submitted (${network}): ${result.txHashes[0]}`,
						},
					],
					details: {
						schema: "evm.venus.withdraw.v1",
						dryRun: false,
						network,
						fromAddress: result.from,
						tokenAddress,
						amountRaw,
						txHash: result.txHashes[0],
						description: result.descriptions[0],
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// evm_venusEnterMarkets
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}venusEnterMarkets`,
			label: "Venus Enter Markets",
			description:
				"Enable Venus market(s) as collateral on BSC. Required before borrowing against a supplied asset. Defaults to dryRun=true.",
			parameters: Type.Object({
				...venusCommonParams,
				marketAddresses: Type.Array(Type.String(), {
					description:
						"Array of vToken contract addresses to enable as collateral",
					minItems: 1,
				}),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				assertMainnetConfirmed({
					network,
					dryRun,
					confirmMainnet: params.confirmMainnet,
				});

				const marketAddresses = params.marketAddresses.map((a, i) =>
					parseEvmAddress(a, `marketAddresses[${i}]`),
				);
				const adapter = createVenusAdapter();
				const calldata = await adapter.buildEnterMarketCalldata({
					network,
					account: "0x0000000000000000000000000000000000000000",
					marketAddresses,
				});

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Venus enterMarkets preview (${network}): ${calldata.description}`,
							},
						],
						details: {
							schema: "evm.venus.enterMarkets.preview.v1",
							dryRun: true,
							network,
							marketAddresses,
							to: calldata.to,
							data: calldata.data,
							description: calldata.description,
						},
					};
				}

				const signer = resolveEvmSignerForTool({
					fromPrivateKey: params.fromPrivateKey,
					network,
				});
				const result = await sendCalldataViaSigner({
					network,
					signer,
					calldata: [calldata],
				});

				return {
					content: [
						{
							type: "text",
							text: `Venus enterMarkets submitted (${network}): ${result.txHashes[0]}`,
						},
					],
					details: {
						schema: "evm.venus.enterMarkets.v1",
						dryRun: false,
						network,
						fromAddress: result.from,
						marketAddresses,
						txHash: result.txHashes[0],
						description: result.descriptions[0],
					},
				};
			},
		}),
	];
}
