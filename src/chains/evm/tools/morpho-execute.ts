/**
 * Morpho Blue execute tools — MCP tool wrappers for Morpho lending operations.
 *
 * All tools default to `dryRun=true` and require `confirmMainnet=true` for mainnet execution.
 * Signing uses EvmSignerProvider abstraction (LocalKeySigner or PrivyEvmSigner).
 *
 * - `evm_morphoSupply`:              Supply (lend) to Morpho Blue market
 * - `evm_morphoBorrow`:              Borrow from Morpho Blue market
 * - `evm_morphoRepay`:               Repay Morpho Blue borrow debt
 * - `evm_morphoWithdraw`:            Withdraw (redeem) from Morpho Blue market
 * - `evm_morphoSupplyCollateral`:    Deposit collateral (WETH/WBTC) to market
 * - `evm_morphoWithdrawCollateral`:  Withdraw collateral from market
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
import {
	buildMorphoSupplyCollateralCalldata,
	buildMorphoWithdrawCollateralCalldata,
	createMorphoAdapter,
} from "./morpho-adapter.js";
import { resolveEvmSignerForTool } from "./signer-resolve.js";
import type { EvmSignerProvider } from "./signer-types.js";

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

function assertMainnetConfirmed(params: {
	network: string;
	dryRun: boolean;
	confirmMainnet?: boolean;
}): void {
	const mainnetLike = isMainnetLikeEvmNetwork(params.network as EvmNetwork);
	if (!params.dryRun && mainnetLike && params.confirmMainnet !== true) {
		throw new Error(
			`${params.network} mainnet execution blocked. Re-run with confirmMainnet=true.`,
		);
	}
}

async function sendCalldataViaSigner(params: {
	network: EvmNetwork;
	signer: EvmSignerProvider;
	calldata: EvmCallData[];
}): Promise<{ txHashes: string[]; descriptions: string[]; from: string }> {
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
// Common parameter schemas
// ---------------------------------------------------------------------------

const morphoCommonParams = {
	network: evmNetworkSchema(),
	dryRun: Type.Optional(
		Type.Boolean({ description: "Preview only (default true)" }),
	),
	confirmMainnet: Type.Optional(
		Type.Boolean({ description: "Required true for mainnet execution" }),
	),
	fromPrivateKey: Type.Optional(
		Type.String({
			description: "Signer private key (optional if env configured)",
		}),
	),
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function createMorphoExecuteTools() {
	return [
		// ---------------------------------------------------------------
		// evm_morphoSupply
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}morphoSupply`,
			label: "Morpho Supply",
			description:
				"Supply (lend) underlying token to a Morpho Blue market. " +
				"Handles ERC-20 approve + supply. Defaults to dryRun=true.",
			parameters: Type.Object({
				...morphoCommonParams,
				tokenAddress: Type.String({
					description: "Loan token address to supply",
				}),
				amountRaw: Type.String({
					description: "Amount in raw units",
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
				const adapter = createMorphoAdapter();
				const calldata = await adapter.buildSupplyCalldata({
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
								text: `Morpho supply preview (${network}): ${calldata.map((c) => c.description).join(" → ")}`,
							},
						],
						details: {
							schema: "evm.morpho.supply.preview.v1",
							dryRun: true,
							network,
							tokenAddress,
							amountRaw,
							steps: calldata.map((c) => ({
								to: c.to,
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
							text: `Morpho supply submitted (${network}): ${result.txHashes.join(", ")}`,
						},
					],
					details: {
						schema: "evm.morpho.supply.v1",
						dryRun: false,
						network,
						fromAddress: result.from,
						tokenAddress,
						amountRaw,
						txHashes: result.txHashes,
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// evm_morphoBorrow
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}morphoBorrow`,
			label: "Morpho Borrow",
			description:
				"Borrow from a Morpho Blue market. Requires collateral supplied first. " +
				"Pass marketAddress (uniqueKey) to identify the market. Defaults to dryRun=true.",
			parameters: Type.Object({
				...morphoCommonParams,
				marketAddress: Type.String({
					description: "Morpho market uniqueKey (hex string from getMarkets)",
				}),
				amountRaw: Type.String({
					description: "Borrow amount in raw units",
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

				const amountRaw = parsePositiveIntegerString(
					params.amountRaw,
					"amountRaw",
				);
				const adapter = createMorphoAdapter();
				const calldata = await adapter.buildBorrowCalldata({
					network,
					account: "0x0000000000000000000000000000000000000000",
					marketAddress: params.marketAddress.trim(),
					amountRaw,
				});

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Morpho borrow preview (${network}): ${calldata.description}`,
							},
						],
						details: {
							schema: "evm.morpho.borrow.preview.v1",
							dryRun: true,
							network,
							marketAddress: params.marketAddress,
							amountRaw,
							steps: [{ to: calldata.to, description: calldata.description }],
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
							text: `Morpho borrow submitted (${network}): ${result.txHashes.join(", ")}`,
						},
					],
					details: {
						schema: "evm.morpho.borrow.v1",
						dryRun: false,
						network,
						fromAddress: result.from,
						marketAddress: params.marketAddress,
						amountRaw,
						txHashes: result.txHashes,
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// evm_morphoRepay
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}morphoRepay`,
			label: "Morpho Repay",
			description:
				"Repay borrow debt on a Morpho Blue market. " +
				"Handles ERC-20 approve + repay. Defaults to dryRun=true.",
			parameters: Type.Object({
				...morphoCommonParams,
				tokenAddress: Type.String({
					description: "Loan token address to repay",
				}),
				amountRaw: Type.String({
					description: "Repay amount in raw units",
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
				const adapter = createMorphoAdapter();
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
								text: `Morpho repay preview (${network}): ${calldata.map((c) => c.description).join(" → ")}`,
							},
						],
						details: {
							schema: "evm.morpho.repay.preview.v1",
							dryRun: true,
							network,
							tokenAddress,
							amountRaw,
							steps: calldata.map((c) => ({
								to: c.to,
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
							text: `Morpho repay submitted (${network}): ${result.txHashes.join(", ")}`,
						},
					],
					details: {
						schema: "evm.morpho.repay.v1",
						dryRun: false,
						network,
						fromAddress: result.from,
						tokenAddress,
						amountRaw,
						txHashes: result.txHashes,
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// evm_morphoWithdraw
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}morphoWithdraw`,
			label: "Morpho Withdraw",
			description:
				"Withdraw (redeem) supplied assets from a Morpho Blue market. Defaults to dryRun=true.",
			parameters: Type.Object({
				...morphoCommonParams,
				tokenAddress: Type.String({
					description: "Loan token address to withdraw",
				}),
				amountRaw: Type.String({
					description: "Withdraw amount in raw units",
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
				const adapter = createMorphoAdapter();
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
								text: `Morpho withdraw preview (${network}): ${calldata.description}`,
							},
						],
						details: {
							schema: "evm.morpho.withdraw.preview.v1",
							dryRun: true,
							network,
							tokenAddress,
							amountRaw,
							steps: [{ to: calldata.to, description: calldata.description }],
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
							text: `Morpho withdraw submitted (${network}): ${result.txHashes.join(", ")}`,
						},
					],
					details: {
						schema: "evm.morpho.withdraw.v1",
						dryRun: false,
						network,
						fromAddress: result.from,
						tokenAddress,
						amountRaw,
						txHashes: result.txHashes,
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// evm_morphoSupplyCollateral
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}morphoSupplyCollateral`,
			label: "Morpho Supply Collateral",
			description:
				"Deposit collateral (e.g. WETH, WBTC) to a Morpho Blue market. " +
				"This is different from supply (lending) — collateral backs your borrows. " +
				"Handles ERC-20 approve + supplyCollateral. Defaults to dryRun=true.",
			parameters: Type.Object({
				...morphoCommonParams,
				marketId: Type.String({
					description: "Morpho market uniqueKey",
				}),
				collateralTokenAddress: Type.String({
					description: "Collateral token address (e.g. WETH)",
				}),
				amountRaw: Type.String({
					description: "Collateral amount in raw units",
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

				const collateralTokenAddress = parseEvmAddress(
					params.collateralTokenAddress,
					"collateralTokenAddress",
				);
				const amountRaw = parsePositiveIntegerString(
					params.amountRaw,
					"amountRaw",
				);
				const calldata = await buildMorphoSupplyCollateralCalldata({
					network,
					account: "0x0000000000000000000000000000000000000000",
					marketId: params.marketId.trim(),
					collateralTokenAddress,
					amountRaw,
				});

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Morpho supplyCollateral preview (${network}): ${calldata.map((c) => c.description).join(" → ")}`,
							},
						],
						details: {
							schema: "evm.morpho.supplyCollateral.preview.v1",
							dryRun: true,
							network,
							marketId: params.marketId,
							collateralTokenAddress,
							amountRaw,
							steps: calldata.map((c) => ({
								to: c.to,
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
							text: `Morpho supplyCollateral submitted (${network}): ${result.txHashes.join(", ")}`,
						},
					],
					details: {
						schema: "evm.morpho.supplyCollateral.v1",
						dryRun: false,
						network,
						fromAddress: result.from,
						marketId: params.marketId,
						amountRaw,
						txHashes: result.txHashes,
					},
				};
			},
		}),

		// ---------------------------------------------------------------
		// evm_morphoWithdrawCollateral
		// ---------------------------------------------------------------
		defineTool({
			name: `${EVM_TOOL_PREFIX}morphoWithdrawCollateral`,
			label: "Morpho Withdraw Collateral",
			description:
				"Withdraw collateral from a Morpho Blue market. Defaults to dryRun=true.",
			parameters: Type.Object({
				...morphoCommonParams,
				marketId: Type.String({
					description: "Morpho market uniqueKey",
				}),
				amountRaw: Type.String({
					description: "Collateral amount in raw units to withdraw",
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

				const amountRaw = parsePositiveIntegerString(
					params.amountRaw,
					"amountRaw",
				);
				const calldata = await buildMorphoWithdrawCollateralCalldata({
					network,
					account: "0x0000000000000000000000000000000000000000",
					marketId: params.marketId.trim(),
					amountRaw,
				});

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Morpho withdrawCollateral preview (${network}): ${calldata.description}`,
							},
						],
						details: {
							schema: "evm.morpho.withdrawCollateral.preview.v1",
							dryRun: true,
							network,
							marketId: params.marketId,
							amountRaw,
							steps: [{ to: calldata.to, description: calldata.description }],
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
							text: `Morpho withdrawCollateral submitted (${network}): ${result.txHashes.join(", ")}`,
						},
					],
					details: {
						schema: "evm.morpho.withdrawCollateral.v1",
						dryRun: false,
						network,
						fromAddress: result.from,
						marketId: params.marketId,
						amountRaw,
						txHashes: result.txHashes,
					},
				};
			},
		}),
	];
}
