import { Type } from "@sinclair/typebox";
import bs58 from "bs58";
import {
	type Action,
	PublicKey,
	actions,
	createTransaction,
	encodeTransaction,
} from "near-api-js";
import { defineTool } from "../../../core/types.js";
import type { RegisteredTool } from "../../../core/types.js";
import { getRefContractId, resolveRefTokenIds } from "../ref.js";
import {
	NEAR_TOOL_PREFIX,
	callNearRpc,
	getNearRpcEndpoint,
	nearNetworkSchema,
	parseNearNetwork,
	resolveNearAccountId,
	toYoctoNear,
} from "../runtime.js";

type NearBuildTransferNearTransactionParams = {
	toAccountId: string;
	amountYoctoNear?: string;
	amountNear?: string | number;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
};

type NearBuildTransferFtTransactionParams = {
	ftContractId: string;
	toAccountId: string;
	amountRaw: string;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBuildRefWithdrawTransactionParams = {
	tokenId: string;
	amountRaw?: string;
	withdrawAll?: boolean;
	refContractId?: string;
	autoRegisterReceiver?: boolean;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearCallFunctionResult = {
	result: number[];
	logs: string[];
	block_height: number;
	block_hash: string;
};

type NearAccessKeyPermission = unknown;

type NearAccessKeyEntry = {
	public_key?: string;
	access_key?: {
		nonce?: string | number | bigint;
		permission?: NearAccessKeyPermission;
	};
};

type NearViewAccessKeyListResult = {
	keys?: NearAccessKeyEntry[];
	block_hash?: string;
	block_height?: number;
};

type NearViewAccessKeyResult = {
	nonce?: string | number | bigint;
	permission?: NearAccessKeyPermission;
	block_hash?: string;
	block_height?: number;
};

type NearStorageBalance = {
	total: string;
	available?: string;
};

type NearStorageBalanceBounds = {
	min: string;
	max?: string;
};

type ActionSummary =
	| {
			type: "Transfer";
			depositYoctoNear: string;
	  }
	| {
			type: "FunctionCall";
			methodName: string;
			args: Record<string, unknown>;
			gas: string;
			depositYoctoNear: string;
	  };

type WalletSelectorAction =
	| {
			type: "Transfer";
			params: {
				deposit: string;
			};
	  }
	| {
			type: "FunctionCall";
			params: {
				methodName: string;
				args: Record<string, unknown>;
				gas: string;
				deposit: string;
			};
	  };

type UnsignedTransactionArtifact = {
	label: string;
	receiverId: string;
	nonce: string;
	blockHash: string;
	unsignedPayload: string;
	transactionBase64: string;
	actionSummaries: ActionSummary[];
	walletSelectorTransaction: {
		signerId: string;
		receiverId: string;
		actions: WalletSelectorAction[];
	};
};

type ComposeAccessKeyState = {
	signerPublicKey: string;
	source: "provided" | "rpc_full_access" | "rpc_first_key";
	nextNonce: bigint;
	blockHash: string;
	blockHeight: number | null;
	permission: NearAccessKeyPermission;
};

type StorageRegistrationStatus =
	| {
			status: "registered";
	  }
	| {
			status: "needs_registration";
			estimatedDepositYoctoNear: string;
	  }
	| {
			status: "unknown";
			reason: string;
	  };

const DEFAULT_FUNCTION_CALL_GAS = 30_000_000_000_000n;
const DEFAULT_REF_WITHDRAW_GAS = 180_000_000_000_000n;
const DEFAULT_ATTACHED_DEPOSIT = 1n;
const DEFAULT_FT_STORAGE_DEPOSIT_YOCTO_NEAR = 1_250_000_000_000_000_000_000n;
const DEFAULT_STORAGE_DEPOSIT_GAS = 30_000_000_000_000n;

function parsePositiveBigInt(value: string, fieldName: string): bigint {
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

function parseNonNegativeBigInt(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	return BigInt(normalized);
}

function parseNonce(value: unknown, fieldName: string): bigint {
	if (typeof value === "bigint") {
		if (value < 0n) throw new Error(`${fieldName} must be non-negative`);
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
			throw new Error(`${fieldName} must be a non-negative integer`);
		}
		return BigInt(value);
	}
	if (typeof value === "string") {
		const normalized = value.trim();
		if (!/^\d+$/.test(normalized)) {
			throw new Error(`${fieldName} must be a non-negative integer`);
		}
		return BigInt(normalized);
	}
	throw new Error(`${fieldName} is missing`);
}

function normalizeNonEmptyText(value: string, fieldName: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

function normalizeAccountId(value: string, fieldName: string): string {
	const normalized = normalizeNonEmptyText(value, fieldName).replace(/^@/, "");
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

function isFullAccessPermission(permission: unknown): boolean {
	if (permission === "FullAccess") return true;
	if (!permission || typeof permission !== "object") return false;
	const record = permission as Record<string, unknown>;
	return (
		"FullAccess" in record || "fullAccess" in record || "full_access" in record
	);
}

function resolveTransferAmountYoctoNear(
	params: NearBuildTransferNearTransactionParams,
): string {
	if (
		typeof params.amountYoctoNear === "string" &&
		params.amountYoctoNear.trim()
	) {
		return parsePositiveBigInt(
			params.amountYoctoNear,
			"amountYoctoNear",
		).toString();
	}
	if (params.amountNear != null) {
		return toYoctoNear(params.amountNear).toString();
	}
	throw new Error("Provide amountYoctoNear or amountNear");
}

function resolveRequestGas(value?: string): string {
	if (typeof value !== "string" || !value.trim()) {
		return DEFAULT_FUNCTION_CALL_GAS.toString();
	}
	return parsePositiveBigInt(value, "gas").toString();
}

function resolveRefWithdrawGas(value?: string): string {
	if (typeof value !== "string" || !value.trim()) {
		return DEFAULT_REF_WITHDRAW_GAS.toString();
	}
	return parsePositiveBigInt(value, "gas").toString();
}

function resolveAttachedDeposit(value?: string): string {
	if (typeof value !== "string" || !value.trim()) {
		return DEFAULT_ATTACHED_DEPOSIT.toString();
	}
	return parseNonNegativeBigInt(value, "attachedDepositYoctoNear").toString();
}

function encodeNearCallArgs(args: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(args), "utf8").toString("base64");
}

function decodeNearCallResultJson<T>(payload: NearCallFunctionResult): T {
	if (!Array.isArray(payload.result)) {
		throw new Error("Invalid call_function result payload");
	}
	const utf8 = Buffer.from(Uint8Array.from(payload.result)).toString("utf8");
	if (!utf8.trim()) {
		throw new Error("call_function returned empty payload");
	}
	return JSON.parse(utf8) as T;
}

function extractErrorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function isMissingMethodError(error: unknown): boolean {
	const lower = extractErrorText(error).toLowerCase();
	return (
		lower.includes("methodnotfound") ||
		lower.includes("does not exist while viewing") ||
		lower.includes("unknown method")
	);
}

function decodeBlockHash(blockHash: string): Uint8Array {
	const normalized = normalizeNonEmptyText(blockHash, "block_hash");
	const decoded = bs58.decode(normalized);
	if (decoded.length !== 32) {
		throw new Error("block_hash must decode to 32 bytes");
	}
	return decoded;
}

async function resolveComposeAccessKeyState(params: {
	accountId: string;
	publicKey?: string;
	network: string;
	rpcUrl?: string;
}): Promise<ComposeAccessKeyState> {
	const providedPublicKey =
		typeof params.publicKey === "string" && params.publicKey.trim()
			? params.publicKey.trim()
			: undefined;
	if (providedPublicKey) {
		// Validate user-provided key format early for clearer errors.
		PublicKey.from(providedPublicKey);
		const result = await callNearRpc<NearViewAccessKeyResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "view_access_key",
				finality: "final",
				account_id: params.accountId,
				public_key: providedPublicKey,
			},
		});
		const nonce = parseNonce(result.nonce, "accessKey.nonce") + 1n;
		const blockHash = normalizeNonEmptyText(
			typeof result.block_hash === "string" ? result.block_hash : "",
			"block_hash",
		);
		return {
			signerPublicKey: providedPublicKey,
			source: "provided",
			nextNonce: nonce,
			blockHash,
			blockHeight:
				typeof result.block_height === "number" &&
				Number.isFinite(result.block_height)
					? result.block_height
					: null,
			permission: result.permission ?? null,
		};
	}

	const keyList = await callNearRpc<NearViewAccessKeyListResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			request_type: "view_access_key_list",
			finality: "final",
			account_id: params.accountId,
		},
	});
	const entries = Array.isArray(keyList.keys) ? keyList.keys : [];
	if (entries.length === 0) {
		throw new Error(
			`No access keys found for signer ${params.accountId}. Provide publicKey explicitly or add an access key.`,
		);
	}
	const selectedEntry =
		entries.find((entry) =>
			isFullAccessPermission(entry.access_key?.permission ?? null),
		) ?? entries[0];
	const publicKey = normalizeNonEmptyText(
		typeof selectedEntry.public_key === "string"
			? selectedEntry.public_key
			: "",
		"accessKey.public_key",
	);
	PublicKey.from(publicKey);
	const nonce =
		parseNonce(selectedEntry.access_key?.nonce, "accessKey.nonce") + 1n;
	const blockHash = normalizeNonEmptyText(
		typeof keyList.block_hash === "string" ? keyList.block_hash : "",
		"block_hash",
	);
	return {
		signerPublicKey: publicKey,
		source: isFullAccessPermission(selectedEntry.access_key?.permission ?? null)
			? "rpc_full_access"
			: "rpc_first_key",
		nextNonce: nonce,
		blockHash,
		blockHeight:
			typeof keyList.block_height === "number" &&
			Number.isFinite(keyList.block_height)
				? keyList.block_height
				: null,
		permission: selectedEntry.access_key?.permission ?? null,
	};
}

function createUnsignedTransactionArtifact(params: {
	label: string;
	signerAccountId: string;
	signerPublicKey: string;
	receiverId: string;
	nonce: bigint;
	blockHash: string;
	actions: Action[];
	actionSummaries: ActionSummary[];
}): UnsignedTransactionArtifact {
	const transaction = createTransaction(
		params.signerAccountId,
		PublicKey.from(params.signerPublicKey),
		params.receiverId,
		params.nonce,
		params.actions,
		decodeBlockHash(params.blockHash),
	);
	const transactionBytes = encodeTransaction(transaction);
	const transactionBase64 = Buffer.from(transactionBytes).toString("base64");
	const walletActions: WalletSelectorAction[] = params.actionSummaries.map(
		(summary) =>
			summary.type === "Transfer"
				? {
						type: "Transfer",
						params: {
							deposit: summary.depositYoctoNear,
						},
					}
				: {
						type: "FunctionCall",
						params: {
							methodName: summary.methodName,
							args: summary.args,
							gas: summary.gas,
							deposit: summary.depositYoctoNear,
						},
					},
	);

	return {
		label: params.label,
		receiverId: params.receiverId,
		nonce: params.nonce.toString(),
		blockHash: params.blockHash,
		unsignedPayload: transactionBase64,
		transactionBase64,
		actionSummaries: params.actionSummaries,
		walletSelectorTransaction: {
			signerId: params.signerAccountId,
			receiverId: params.receiverId,
			actions: walletActions,
		},
	};
}

async function queryRefUserDeposits(params: {
	network: string;
	rpcUrl?: string;
	refContractId: string;
	accountId: string;
}): Promise<Record<string, string>> {
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			request_type: "call_function",
			account_id: params.refContractId,
			method_name: "get_deposits",
			args_base64: encodeNearCallArgs({
				account_id: params.accountId,
			}),
			finality: "final",
		},
	});
	const parsed = decodeNearCallResultJson<Record<string, string>>(result);
	if (!parsed || typeof parsed !== "object") {
		return {};
	}
	const deposits: Record<string, string> = {};
	for (const [tokenId, rawAmount] of Object.entries(parsed)) {
		if (typeof tokenId !== "string" || typeof rawAmount !== "string") continue;
		const normalizedTokenId = tokenId.trim().toLowerCase();
		if (!normalizedTokenId) continue;
		deposits[normalizedTokenId] = parseNonNegativeBigInt(
			rawAmount,
			`deposits[${normalizedTokenId}]`,
		).toString();
	}
	return deposits;
}

function resolveRefWithdrawTokenId(params: {
	network: string;
	tokenInput: string;
	availableTokenIds: string[];
}): string {
	const tokenInput = normalizeNonEmptyText(
		params.tokenInput,
		"tokenId",
	).toLowerCase();
	const matches = resolveRefTokenIds({
		network: params.network,
		tokenIdOrSymbol: tokenInput,
		availableTokenIds: params.availableTokenIds.map((tokenId) =>
			tokenId.toLowerCase(),
		),
	});
	if (matches[0]) return matches[0];
	if (tokenInput.includes(".")) return tokenInput;
	const fallback = resolveRefTokenIds({
		network: params.network,
		tokenIdOrSymbol: tokenInput,
	});
	if (fallback[0]) return fallback[0];
	throw new Error(`Cannot resolve tokenId: ${params.tokenInput}`);
}

async function queryStorageRegistrationStatus(params: {
	network: string;
	rpcUrl?: string;
	ftContractId: string;
	accountId: string;
}): Promise<StorageRegistrationStatus> {
	try {
		const balanceResult = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "call_function",
				account_id: params.ftContractId,
				method_name: "storage_balance_of",
				args_base64: encodeNearCallArgs({
					account_id: params.accountId,
				}),
				finality: "final",
			},
		});
		const balance = decodeNearCallResultJson<NearStorageBalance | null>(
			balanceResult,
		);
		if (
			balance &&
			typeof balance.total === "string" &&
			parseNonNegativeBigInt(balance.total, "storageBalance.total") > 0n
		) {
			return {
				status: "registered",
			};
		}
	} catch (error) {
		if (isMissingMethodError(error)) {
			return {
				status: "unknown",
				reason: "token does not expose storage_balance_of",
			};
		}
		throw error;
	}

	try {
		const boundsResult = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "call_function",
				account_id: params.ftContractId,
				method_name: "storage_balance_bounds",
				args_base64: encodeNearCallArgs({}),
				finality: "final",
			},
		});
		const bounds =
			decodeNearCallResultJson<NearStorageBalanceBounds>(boundsResult);
		const minDeposit =
			bounds && typeof bounds.min === "string" && bounds.min.trim()
				? parseNonNegativeBigInt(bounds.min, "storageBalanceBounds.min")
				: DEFAULT_FT_STORAGE_DEPOSIT_YOCTO_NEAR;
		return {
			status: "needs_registration",
			estimatedDepositYoctoNear: minDeposit.toString(),
		};
	} catch (error) {
		if (isMissingMethodError(error)) {
			return {
				status: "unknown",
				reason: "token does not expose storage_balance_bounds",
			};
		}
		throw error;
	}
}

export function createNearComposeTools(): RegisteredTool[] {
	return [
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildTransferNearTransaction`,
			label: "NEAR Build Transfer Native Transaction",
			description:
				"Build an unsigned NEAR native transfer transaction payload for local signing.",
			parameters: Type.Object({
				toAccountId: Type.String({
					description: "Destination NEAR account id.",
				}),
				amountYoctoNear: Type.Optional(
					Type.String({
						description: "Amount in yoctoNEAR (raw integer string).",
					}),
				),
				amountNear: Type.Optional(
					Type.Union([
						Type.String({ description: "Amount in NEAR decimal string." }),
						Type.Number({ description: "Amount in NEAR." }),
					]),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				publicKey: Type.Optional(
					Type.String({
						description:
							"Public key used for nonce/access-key lookup, e.g. ed25519:.... If omitted, auto-select from account access keys.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const receiverId = normalizeAccountId(
					params.toAccountId,
					"toAccountId",
				);
				const amountYoctoNear = resolveTransferAmountYoctoNear(params);
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const artifact = createUnsignedTransactionArtifact({
					label: "transfer_near",
					signerAccountId,
					signerPublicKey: keyState.signerPublicKey,
					receiverId,
					nonce: keyState.nextNonce,
					blockHash: keyState.blockHash,
					actions: [actions.transfer(BigInt(amountYoctoNear))],
					actionSummaries: [
						{
							type: "Transfer",
							depositYoctoNear: amountYoctoNear,
						},
					],
				});
				return {
					content: [
						{
							type: "text",
							text: `Unsigned NEAR transfer built: ${amountYoctoNear} yoctoNEAR -> ${receiverId}.`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						transactionCount: 1,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly.",
						transaction: artifact,
						transactions: [artifact],
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildTransferFtTransaction`,
			label: "NEAR Build Transfer FT Transaction",
			description:
				"Build an unsigned NEP-141 ft_transfer transaction payload for local signing.",
			parameters: Type.Object({
				ftContractId: Type.String({
					description: "FT contract account id.",
				}),
				toAccountId: Type.String({
					description: "Destination NEAR account id.",
				}),
				amountRaw: Type.String({
					description: "FT amount in raw integer string.",
				}),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				publicKey: Type.Optional(
					Type.String({
						description:
							"Public key used for nonce/access-key lookup, e.g. ed25519:.... If omitted, auto-select from account access keys.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas in yoctoGas for ft_transfer (default 30000000000000 / 30 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit in yoctoNEAR (default 1 for ft_transfer).",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const ftContractId = normalizeAccountId(
					params.ftContractId,
					"ftContractId",
				);
				const toAccountId = normalizeAccountId(
					params.toAccountId,
					"toAccountId",
				);
				const amountRaw = parsePositiveBigInt(
					params.amountRaw,
					"amountRaw",
				).toString();
				const gas = resolveRequestGas(params.gas);
				const deposit = resolveAttachedDeposit(params.attachedDepositYoctoNear);
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const artifact = createUnsignedTransactionArtifact({
					label: "transfer_ft",
					signerAccountId,
					signerPublicKey: keyState.signerPublicKey,
					receiverId: ftContractId,
					nonce: keyState.nextNonce,
					blockHash: keyState.blockHash,
					actions: [
						actions.functionCall(
							"ft_transfer",
							{
								receiver_id: toAccountId,
								amount: amountRaw,
							},
							BigInt(gas),
							BigInt(deposit),
						),
					],
					actionSummaries: [
						{
							type: "FunctionCall",
							methodName: "ft_transfer",
							args: {
								receiver_id: toAccountId,
								amount: amountRaw,
							},
							gas,
							depositYoctoNear: deposit,
						},
					],
				});
				return {
					content: [
						{
							type: "text",
							text: `Unsigned FT transfer built: ${amountRaw} raw ${ftContractId} -> ${toAccountId}.`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						transactionCount: 1,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly.",
						transaction: artifact,
						transactions: [artifact],
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildRefWithdrawTransaction`,
			label: "NEAR Build Ref Withdraw Transaction",
			description:
				"Build unsigned Ref withdraw transaction payload(s) for local signing. Can include an optional storage_deposit pre-transaction when receiver storage is missing.",
			parameters: Type.Object({
				tokenId: Type.String({
					description: "Token contract id or symbol to withdraw from Ref.",
				}),
				amountRaw: Type.Optional(
					Type.String({
						description:
							"Withdraw amount in raw units. If omitted and withdrawAll=true, use full deposited balance.",
					}),
				),
				withdrawAll: Type.Optional(
					Type.Boolean({
						description:
							"If true and amountRaw is omitted, withdraw full deposited balance (default true).",
					}),
				),
				refContractId: Type.Optional(
					Type.String({
						description:
							"Ref contract id override (default mainnet v2.ref-finance.near).",
					}),
				),
				autoRegisterReceiver: Type.Optional(
					Type.Boolean({
						description:
							"If true, include a storage_deposit pre-transaction when receiver storage is missing (default true).",
					}),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				publicKey: Type.Optional(
					Type.String({
						description:
							"Public key used for nonce/access-key lookup, e.g. ed25519:.... If omitted, auto-select from account access keys.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas in yoctoGas for withdraw (default 180000000000000 / 180 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit in yoctoNEAR for withdraw (default 1).",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const refContractId = getRefContractId(network, params.refContractId);
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const deposits = await queryRefUserDeposits({
					network,
					rpcUrl: params.rpcUrl,
					refContractId,
					accountId: signerAccountId,
				});
				const tokenId = resolveRefWithdrawTokenId({
					network,
					tokenInput: params.tokenId,
					availableTokenIds: Object.keys(deposits),
				});
				const depositBeforeRaw = parseNonNegativeBigInt(
					deposits[tokenId] ?? "0",
					`deposits[${tokenId}]`,
				).toString();
				const requestedAmountRaw =
					typeof params.amountRaw === "string" && params.amountRaw.trim()
						? parsePositiveBigInt(params.amountRaw, "amountRaw").toString()
						: null;
				const withdrawAll = params.withdrawAll !== false;
				const amountRaw =
					requestedAmountRaw ??
					(withdrawAll
						? depositBeforeRaw
						: (() => {
								throw new Error("Provide amountRaw or set withdrawAll=true");
							})());
				if (parseNonNegativeBigInt(amountRaw, "amountRaw") <= 0n) {
					throw new Error(
						`No withdrawable deposit for ${tokenId} on ${refContractId}`,
					);
				}
				if (
					parseNonNegativeBigInt(amountRaw, "amountRaw") >
					parseNonNegativeBigInt(depositBeforeRaw, "depositBeforeRaw")
				) {
					throw new Error(
						`Withdraw amount exceeds Ref deposit for ${tokenId}: ${amountRaw} > ${depositBeforeRaw}`,
					);
				}

				const autoRegisterReceiver = params.autoRegisterReceiver !== false;
				const storageRegistration = await queryStorageRegistrationStatus({
					network,
					rpcUrl: params.rpcUrl,
					ftContractId: tokenId,
					accountId: signerAccountId,
				});
				const artifacts: UnsignedTransactionArtifact[] = [];
				let nextNonce = keyState.nextNonce;

				if (
					autoRegisterReceiver &&
					storageRegistration.status === "needs_registration"
				) {
					const storageDepositActionSummary: ActionSummary = {
						type: "FunctionCall",
						methodName: "storage_deposit",
						args: {
							account_id: signerAccountId,
							registration_only: true,
						},
						gas: DEFAULT_STORAGE_DEPOSIT_GAS.toString(),
						depositYoctoNear: storageRegistration.estimatedDepositYoctoNear,
					};
					artifacts.push(
						createUnsignedTransactionArtifact({
							label: "storage_deposit",
							signerAccountId,
							signerPublicKey: keyState.signerPublicKey,
							receiverId: tokenId,
							nonce: nextNonce,
							blockHash: keyState.blockHash,
							actions: [
								actions.functionCall(
									"storage_deposit",
									{
										account_id: signerAccountId,
										registration_only: true,
									},
									DEFAULT_STORAGE_DEPOSIT_GAS,
									parseNonNegativeBigInt(
										storageRegistration.estimatedDepositYoctoNear,
										"estimatedDepositYoctoNear",
									),
								),
							],
							actionSummaries: [storageDepositActionSummary],
						}),
					);
					nextNonce += 1n;
				}

				const withdrawGas = resolveRefWithdrawGas(params.gas);
				const withdrawDeposit = resolveAttachedDeposit(
					params.attachedDepositYoctoNear,
				);
				artifacts.push(
					createUnsignedTransactionArtifact({
						label: "ref_withdraw",
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						receiverId: refContractId,
						nonce: nextNonce,
						blockHash: keyState.blockHash,
						actions: [
							actions.functionCall(
								"withdraw",
								{
									token_id: tokenId,
									amount: amountRaw,
								},
								BigInt(withdrawGas),
								BigInt(withdrawDeposit),
							),
						],
						actionSummaries: [
							{
								type: "FunctionCall",
								methodName: "withdraw",
								args: {
									token_id: tokenId,
									amount: amountRaw,
								},
								gas: withdrawGas,
								depositYoctoNear: withdrawDeposit,
							},
						],
					}),
				);

				return {
					content: [
						{
							type: "text",
							text: `Unsigned Ref withdraw built: ${amountRaw} raw ${tokenId} (txCount=${artifacts.length}).`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						refContractId,
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						tokenId,
						depositBeforeRaw,
						amountRaw,
						withdrawAll,
						autoRegisterReceiver,
						storageRegistration,
						transactionCount: artifacts.length,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly in listed order.",
						transaction: artifacts[artifacts.length - 1] ?? null,
						transactions: artifacts,
					},
				};
			},
		}),
	];
}
