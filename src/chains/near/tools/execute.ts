import { Type } from "@sinclair/typebox";
import { Account, JsonRpcProvider } from "near-api-js";
import type { RegisteredTool } from "../../../core/types.js";
import { defineTool } from "../../../core/types.js";
import { getRefContractId, getRefSwapQuote } from "../ref.js";
import {
	NEAR_TOOL_PREFIX,
	formatNearAmount,
	getNearExplorerTransactionUrl,
	getNearRpcEndpoint,
	nearNetworkSchema,
	parseNearNetwork,
	resolveNearSigner,
	toYoctoNear,
} from "../runtime.js";

type NearTransferParams = {
	toAccountId: string;
	amountYoctoNear?: string;
	amountNear?: string | number;
	fromAccountId?: string;
	privateKey?: string;
	network?: string;
	rpcUrl?: string;
	confirmMainnet?: boolean;
};

type NearFtTransferParams = {
	ftContractId: string;
	toAccountId: string;
	amountRaw: string;
	fromAccountId?: string;
	privateKey?: string;
	network?: string;
	rpcUrl?: string;
	confirmMainnet?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearRefSwapParams = {
	tokenInId: string;
	tokenOutId: string;
	amountInRaw: string;
	minAmountOutRaw?: string;
	poolId?: number | string;
	slippageBps?: number;
	refContractId?: string;
	fromAccountId?: string;
	privateKey?: string;
	network?: string;
	rpcUrl?: string;
	confirmMainnet?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

function parsePositiveYocto(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	const parsed = BigInt(normalized);
	if (parsed <= 0n) {
		throw new Error(`${fieldName} must be greater than 0`);
	}
	return parsed;
}

function parseNonNegativeYocto(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	return BigInt(normalized);
}

function resolveNearTransferAmount(params: NearTransferParams): bigint {
	if (
		typeof params.amountYoctoNear === "string" &&
		params.amountYoctoNear.trim()
	) {
		return parsePositiveYocto(params.amountYoctoNear, "amountYoctoNear");
	}
	if (params.amountNear != null) {
		return toYoctoNear(params.amountNear);
	}
	throw new Error("Provide amountYoctoNear or amountNear");
}

function resolveRequestGas(value?: string): bigint {
	if (typeof value !== "string" || !value.trim()) {
		return 30_000_000_000_000n;
	}
	return parsePositiveYocto(value, "gas");
}

function resolveAttachedDeposit(value?: string): bigint {
	if (typeof value !== "string" || !value.trim()) {
		return 1n;
	}
	return parseNonNegativeYocto(value, "attachedDepositYoctoNear");
}

function resolveRefSwapGas(value?: string): bigint {
	if (typeof value !== "string" || !value.trim()) {
		return 180_000_000_000_000n;
	}
	return parsePositiveYocto(value, "gas");
}

function parseOptionalPoolId(value?: number | string): number | undefined {
	if (value == null) return undefined;
	if (typeof value === "string" && !value.trim()) return undefined;
	const normalized = typeof value === "number" ? value : Number(value.trim());
	if (
		!Number.isFinite(normalized) ||
		!Number.isInteger(normalized) ||
		normalized < 0
	) {
		throw new Error("poolId must be a non-negative integer");
	}
	return normalized;
}

function normalizeReceiverAccountId(value: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error("toAccountId is required");
	}
	return normalized.startsWith("@") ? normalized.slice(1) : normalized;
}

function extractTxHash(details: unknown): string | null {
	if (!details || typeof details !== "object") return null;
	const candidate = details as {
		transaction_outcome?: { id?: unknown };
		final_execution_status?: unknown;
	};
	const txId = candidate.transaction_outcome?.id;
	return typeof txId === "string" && txId.trim() ? txId : null;
}

function assertMainnetExecutionConfirmed(
	network: string,
	confirmMainnet?: boolean,
): void {
	if (network === "mainnet" && confirmMainnet !== true) {
		throw new Error(
			"Mainnet execution is blocked. Set confirmMainnet=true to continue.",
		);
	}
}

function createNearAccountClient(params: {
	accountId?: string;
	privateKey?: string;
	network?: string;
	rpcUrl?: string;
}) {
	const network = parseNearNetwork(params.network);
	const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
	const provider = new JsonRpcProvider({ url: endpoint });
	const resolvedSigner = resolveNearSigner({
		accountId: params.accountId,
		network,
		privateKey: params.privateKey,
	});
	const account = new Account(
		resolvedSigner.accountId,
		provider,
		resolvedSigner.signer,
	);
	return {
		account,
		network,
		endpoint,
		signerAccountId: resolvedSigner.accountId,
	};
}

export function createNearExecuteTools(): RegisteredTool[] {
	return [
		defineTool({
			name: `${NEAR_TOOL_PREFIX}transferNear`,
			label: "NEAR Transfer Native",
			description:
				"Transfer native NEAR from signer account to another account id.",
			parameters: Type.Object({
				toAccountId: Type.String({
					description: "Destination NEAR account id",
				}),
				amountYoctoNear: Type.Optional(
					Type.String({
						description: "Amount in yoctoNEAR (raw integer string)",
					}),
				),
				amountNear: Type.Optional(
					Type.Union([
						Type.String({ description: "Amount in NEAR decimal string" }),
						Type.Number({ description: "Amount in NEAR" }),
					]),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				privateKey: Type.Optional(
					Type.String({
						description:
							"Optional signer private key ed25519:... (otherwise from env/credentials).",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({
						description: "Override NEAR RPC endpoint URL",
					}),
				),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const amountYoctoNear = resolveNearTransferAmount(params);
				const receiverId = normalizeReceiverAccountId(params.toAccountId);
				const { account, network, endpoint, signerAccountId } =
					createNearAccountClient({
						accountId: params.fromAccountId,
						privateKey: params.privateKey,
						network: params.network,
						rpcUrl: params.rpcUrl,
					});

				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const tx = await account.transfer({
					receiverId,
					amount: amountYoctoNear,
				});
				const txHash = extractTxHash(tx);
				const explorerUrl = txHash
					? getNearExplorerTransactionUrl(txHash, network)
					: null;

				return {
					content: [
						{
							type: "text",
							text: `Transfer submitted: ${formatNearAmount(amountYoctoNear, 8)} NEAR -> ${receiverId}`,
						},
					],
					details: {
						amountNear: formatNearAmount(amountYoctoNear, 10),
						amountYoctoNear: amountYoctoNear.toString(),
						explorerUrl,
						fromAccountId: signerAccountId,
						network,
						rawResult: tx,
						rpcEndpoint: endpoint,
						toAccountId: receiverId,
						txHash,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}transferFt`,
			label: "NEAR Transfer FT",
			description:
				"Transfer NEP-141 fungible tokens via ft_transfer from signer account.",
			parameters: Type.Object({
				ftContractId: Type.String({
					description: "FT contract account id",
				}),
				toAccountId: Type.String({
					description: "Destination NEAR account id",
				}),
				amountRaw: Type.String({
					description: "FT amount as raw integer string",
				}),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				privateKey: Type.Optional(
					Type.String({
						description:
							"Optional signer private key ed25519:... (otherwise from env/credentials).",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({
						description: "Override NEAR RPC endpoint URL",
					}),
				),
				confirmMainnet: Type.Optional(Type.Boolean()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas to attach in yoctoGas (default 30000000000000 / 30 Tgas)",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit in yoctoNEAR (default 1 for ft_transfer)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const amountRaw = parsePositiveYocto(params.amountRaw, "amountRaw");
				const receiverId = normalizeReceiverAccountId(params.toAccountId);
				const ftContractId = normalizeReceiverAccountId(params.ftContractId);
				const gas = resolveRequestGas(params.gas);
				const deposit = resolveAttachedDeposit(params.attachedDepositYoctoNear);
				const { account, network, endpoint, signerAccountId } =
					createNearAccountClient({
						accountId: params.fromAccountId,
						privateKey: params.privateKey,
						network: params.network,
						rpcUrl: params.rpcUrl,
					});

				assertMainnetExecutionConfirmed(network, params.confirmMainnet);

				const tx = await account.callFunction({
					contractId: ftContractId,
					methodName: "ft_transfer",
					args: {
						receiver_id: receiverId,
						amount: amountRaw.toString(),
					},
					deposit,
					gas,
				});

				const txHash = extractTxHash(tx);
				const explorerUrl = txHash
					? getNearExplorerTransactionUrl(txHash, network)
					: null;

				return {
					content: [
						{
							type: "text",
							text: `FT transfer submitted: ${amountRaw.toString()} raw from ${signerAccountId} -> ${receiverId} on ${ftContractId}`,
						},
					],
					details: {
						amountRaw: amountRaw.toString(),
						attachedDepositYoctoNear: deposit.toString(),
						explorerUrl,
						fromAccountId: signerAccountId,
						ftContractId,
						gas: gas.toString(),
						network,
						rawResult: tx,
						rpcEndpoint: endpoint,
						toAccountId: receiverId,
						txHash,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}swapRef`,
			label: "NEAR Ref Swap",
			description:
				"Execute token swap on Ref (Rhea route) via ft_transfer_call with mainnet safety gate.",
			parameters: Type.Object({
				tokenInId: Type.String({
					description: "Input token contract id (NEP-141)",
				}),
				tokenOutId: Type.String({
					description: "Output token contract id (NEP-141)",
				}),
				amountInRaw: Type.String({
					description: "Input amount as raw integer string",
				}),
				minAmountOutRaw: Type.Optional(
					Type.String({
						description:
							"Minimum output as raw integer string. If omitted, auto-quote with slippage.",
					}),
				),
				poolId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				slippageBps: Type.Optional(
					Type.Number({
						description:
							"Slippage bps used when minAmountOutRaw is omitted (default 50).",
					}),
				),
				refContractId: Type.Optional(
					Type.String({
						description:
							"Ref contract id override (default mainnet v2.ref-finance.near).",
					}),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				privateKey: Type.Optional(
					Type.String({
						description:
							"Optional signer private key ed25519:... (otherwise from env/credentials).",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({
						description: "Override NEAR RPC endpoint URL",
					}),
				),
				confirmMainnet: Type.Optional(Type.Boolean()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas to attach in yoctoGas (default 180000000000000 / 180 Tgas)",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit in yoctoNEAR (default 1 for ft_transfer_call)",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearRefSwapParams;
				const tokenInId = normalizeReceiverAccountId(params.tokenInId);
				const tokenOutId = normalizeReceiverAccountId(params.tokenOutId);
				if (tokenInId === tokenOutId) {
					throw new Error("tokenInId and tokenOutId must be different");
				}
				const amountInRaw = parsePositiveYocto(
					params.amountInRaw,
					"amountInRaw",
				);
				const gas = resolveRefSwapGas(params.gas);
				const deposit = resolveAttachedDeposit(params.attachedDepositYoctoNear);
				const { account, network, endpoint, signerAccountId } =
					createNearAccountClient({
						accountId: params.fromAccountId,
						privateKey: params.privateKey,
						network: params.network,
						rpcUrl: params.rpcUrl,
					});
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);

				const refContractId = getRefContractId(network, params.refContractId);
				const poolId = parseOptionalPoolId(params.poolId);
				const quote = await getRefSwapQuote({
					network,
					rpcUrl: params.rpcUrl,
					refContractId,
					tokenInId,
					tokenOutId,
					amountInRaw: amountInRaw.toString(),
					poolId,
					slippageBps: params.slippageBps,
				});
				const minAmountOutRaw =
					typeof params.minAmountOutRaw === "string" &&
					params.minAmountOutRaw.trim()
						? parsePositiveYocto(
								params.minAmountOutRaw,
								"minAmountOutRaw",
							).toString()
						: quote.minAmountOutRaw;

				const tx = await account.callFunction({
					contractId: tokenInId,
					methodName: "ft_transfer_call",
					args: {
						receiver_id: refContractId,
						amount: amountInRaw.toString(),
						msg: JSON.stringify({
							force: 0,
							actions: [
								{
									pool_id: quote.poolId,
									token_in: tokenInId,
									amount_in: amountInRaw.toString(),
									token_out: tokenOutId,
									min_amount_out: minAmountOutRaw,
								},
							],
						}),
					},
					deposit,
					gas,
				});

				const txHash = extractTxHash(tx);
				const explorerUrl = txHash
					? getNearExplorerTransactionUrl(txHash, network)
					: null;

				return {
					content: [
						{
							type: "text",
							text: `Ref swap submitted: ${amountInRaw.toString()} raw ${tokenInId} -> ${tokenOutId} (pool ${quote.poolId})`,
						},
					],
					details: {
						amountInRaw: amountInRaw.toString(),
						attachedDepositYoctoNear: deposit.toString(),
						explorerUrl,
						fromAccountId: signerAccountId,
						gas: gas.toString(),
						minAmountOutRaw,
						network,
						poolId: quote.poolId,
						rawResult: tx,
						refContractId,
						rpcEndpoint: endpoint,
						slippageBps:
							typeof params.slippageBps === "number"
								? Math.floor(params.slippageBps)
								: 50,
						source: quote.source,
						tokenInId,
						tokenOutId,
						txHash,
					},
				};
			},
		}),
	];
}
