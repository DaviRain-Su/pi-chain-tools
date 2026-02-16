/**
 * ERC-4626 Vault MCP tools — read vault info/balance, deposit, withdraw, redeem.
 *
 * Read tools:
 * - `evm_vaultGetInfo`:    Vault metadata (name, symbol, underlying, totalAssets)
 * - `evm_vaultGetBalance`: Account shares + underlying value in vault
 *
 * Execute tools:
 * - `evm_vaultDeposit`:    Approve + deposit underlying to vault (dryRun default)
 * - `evm_vaultWithdraw`:   Withdraw underlying from vault (dryRun default)
 * - `evm_vaultRedeem`:     Redeem vault shares (dryRun default)
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
import {
	buildVaultDepositCalldata,
	buildVaultRedeemCalldata,
	buildVaultWithdrawCalldata,
	getVaultBalance,
	getVaultInfo,
} from "./vault-adapter.js";

function parseEvmAddress(value: string, fieldName: string): string {
	const normalized = value.trim();
	if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
		throw new Error(`${fieldName} must be a valid EVM address`);
	}
	return normalized;
}

function assertMainnetConfirmed(params: {
	network: string;
	dryRun: boolean;
	confirmMainnet?: boolean;
}): void {
	if (
		!params.dryRun &&
		isMainnetLikeEvmNetwork(params.network as EvmNetwork) &&
		params.confirmMainnet !== true
	) {
		throw new Error(
			`${params.network} mainnet execution blocked. Re-run with confirmMainnet=true.`,
		);
	}
}

async function sendCalldataViaSigner(params: {
	network: EvmNetwork;
	signer: EvmSignerProvider;
	calldata: EvmCallData[];
}): Promise<{ txHashes: string[]; from: string }> {
	const txHashes: string[] = [];
	let from = "";
	for (const cd of params.calldata) {
		const result = await params.signer.signAndSend({
			network: params.network,
			to: cd.to,
			data: cd.data,
			value: cd.value,
		});
		txHashes.push(result.txHash);
		from = result.from;
	}
	return { txHashes, from };
}

const vaultCommonParams = {
	network: evmNetworkSchema(),
	vaultAddress: Type.String({ description: "ERC-4626 vault contract address" }),
};

export function createVaultReadTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}vaultGetInfo`,
			label: "Vault Info",
			description:
				"Get ERC-4626 vault metadata: name, symbol, underlying asset, totalAssets. Works on any EVM chain.",
			parameters: Type.Object(vaultCommonParams),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const vaultAddress = parseEvmAddress(
					params.vaultAddress,
					"vaultAddress",
				);
				const info = await getVaultInfo(network, vaultAddress);

				return {
					content: [
						{
							type: "text",
							text: `Vault ${info.vaultName} (${info.vaultSymbol}) on ${network}: underlying=${info.underlyingAsset}, totalAssets=${info.totalAssets}`,
						},
					],
					details: { schema: "evm.vault.info.v1", ...info },
				};
			},
		}),

		defineTool({
			name: `${EVM_TOOL_PREFIX}vaultGetBalance`,
			label: "Vault Balance",
			description:
				"Get account's vault share balance and equivalent underlying asset value.",
			parameters: Type.Object({
				...vaultCommonParams,
				account: Type.String({ description: "EVM wallet address" }),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const vaultAddress = parseEvmAddress(
					params.vaultAddress,
					"vaultAddress",
				);
				const account = parseEvmAddress(params.account, "account");
				const balance = await getVaultBalance(network, vaultAddress, account);

				return {
					content: [
						{
							type: "text",
							text: `Vault balance for ${account}: ${balance.shares} shares = ${balance.assets} underlying`,
						},
					],
					details: {
						schema: "evm.vault.balance.v1",
						network,
						vaultAddress,
						account,
						...balance,
					},
				};
			},
		}),
	];
}

export function createVaultExecuteTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}vaultDeposit`,
			label: "Vault Deposit",
			description:
				"Deposit underlying token into ERC-4626 vault. Handles approve + deposit. Defaults to dryRun=true.",
			parameters: Type.Object({
				...vaultCommonParams,
				underlyingTokenAddress: Type.String({
					description: "Underlying token address (the asset the vault accepts)",
				}),
				amountRaw: Type.String({ description: "Deposit amount in raw units" }),
				dryRun: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				fromPrivateKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				assertMainnetConfirmed({
					network,
					dryRun,
					confirmMainnet: params.confirmMainnet,
				});

				const vaultAddress = parseEvmAddress(
					params.vaultAddress,
					"vaultAddress",
				);
				const underlyingTokenAddress = parseEvmAddress(
					params.underlyingTokenAddress,
					"underlyingTokenAddress",
				);
				const amountRaw = parsePositiveIntegerString(
					params.amountRaw,
					"amountRaw",
				);

				const calldata = buildVaultDepositCalldata({
					network,
					vaultAddress,
					underlyingTokenAddress,
					account: "0x0000000000000000000000000000000000000000",
					amountRaw,
				});

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Vault deposit preview: ${calldata.map((c) => c.description).join(" → ")}`,
							},
						],
						details: {
							schema: "evm.vault.deposit.preview.v1",
							dryRun: true,
							network,
							vaultAddress,
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
							text: `Vault deposit submitted: ${result.txHashes.join(", ")}`,
						},
					],
					details: {
						schema: "evm.vault.deposit.v1",
						dryRun: false,
						network,
						vaultAddress,
						amountRaw,
						txHashes: result.txHashes,
						from: result.from,
					},
				};
			},
		}),

		defineTool({
			name: `${EVM_TOOL_PREFIX}vaultWithdraw`,
			label: "Vault Withdraw",
			description:
				"Withdraw underlying assets from ERC-4626 vault. Defaults to dryRun=true.",
			parameters: Type.Object({
				...vaultCommonParams,
				amountRaw: Type.String({
					description: "Underlying amount to withdraw in raw units",
				}),
				dryRun: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				fromPrivateKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				assertMainnetConfirmed({
					network,
					dryRun,
					confirmMainnet: params.confirmMainnet,
				});

				const vaultAddress = parseEvmAddress(
					params.vaultAddress,
					"vaultAddress",
				);
				const amountRaw = parsePositiveIntegerString(
					params.amountRaw,
					"amountRaw",
				);

				const calldata = buildVaultWithdrawCalldata({
					network,
					vaultAddress,
					account: "0x0000000000000000000000000000000000000000",
					amountRaw,
				});

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Vault withdraw preview: ${calldata.description}`,
							},
						],
						details: {
							schema: "evm.vault.withdraw.preview.v1",
							dryRun: true,
							network,
							vaultAddress,
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
							text: `Vault withdraw submitted: ${result.txHashes.join(", ")}`,
						},
					],
					details: {
						schema: "evm.vault.withdraw.v1",
						dryRun: false,
						network,
						vaultAddress,
						amountRaw,
						txHashes: result.txHashes,
						from: result.from,
					},
				};
			},
		}),

		defineTool({
			name: `${EVM_TOOL_PREFIX}vaultRedeem`,
			label: "Vault Redeem",
			description:
				"Redeem vault shares for underlying assets. Defaults to dryRun=true.",
			parameters: Type.Object({
				...vaultCommonParams,
				sharesRaw: Type.String({
					description: "Number of vault shares to redeem",
				}),
				dryRun: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				fromPrivateKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				assertMainnetConfirmed({
					network,
					dryRun,
					confirmMainnet: params.confirmMainnet,
				});

				const vaultAddress = parseEvmAddress(
					params.vaultAddress,
					"vaultAddress",
				);
				const sharesRaw = parsePositiveIntegerString(
					params.sharesRaw,
					"sharesRaw",
				);

				const calldata = buildVaultRedeemCalldata({
					network,
					vaultAddress,
					account: "0x0000000000000000000000000000000000000000",
					sharesRaw,
				});

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Vault redeem preview: ${calldata.description}`,
							},
						],
						details: {
							schema: "evm.vault.redeem.preview.v1",
							dryRun: true,
							network,
							vaultAddress,
							sharesRaw,
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
							text: `Vault redeem submitted: ${result.txHashes.join(", ")}`,
						},
					],
					details: {
						schema: "evm.vault.redeem.v1",
						dryRun: false,
						network,
						vaultAddress,
						sharesRaw,
						txHashes: result.txHashes,
						from: result.from,
					},
				};
			},
		}),
	];
}
