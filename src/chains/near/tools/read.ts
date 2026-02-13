import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	NEAR_TOOL_PREFIX,
	callNearRpc,
	formatNearAmount,
	formatTokenAmount,
	getNearRpcEndpoint,
	nearNetworkSchema,
	parseNearNetwork,
	resolveNearAccountId,
} from "../runtime.js";

type NearViewAccountResult = {
	amount: string;
	locked: string;
	code_hash: string;
	storage_usage: number;
	storage_paid_at: number;
	block_hash: string;
	block_height: number;
};

type NearCallFunctionResult = {
	result: number[];
	logs: string[];
	block_height: number;
	block_hash: string;
};

type NearFtMetadata = {
	spec?: string;
	name?: string;
	symbol?: string;
	decimals?: number;
	icon?: string | null;
	reference?: string | null;
	reference_hash?: string | null;
};

function parseUnsignedBigInt(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	return BigInt(normalized);
}

function toTextBytes(value: number[]): string {
	if (
		!Array.isArray(value) ||
		value.some((entry) => !Number.isInteger(entry))
	) {
		throw new Error("NEAR call_function result bytes are invalid");
	}
	return Buffer.from(Uint8Array.from(value)).toString("utf8");
}

function decodeNearCallFunctionJson<T>(result: NearCallFunctionResult): T {
	const raw = toTextBytes(result.result);
	if (!raw.trim()) {
		throw new Error("NEAR call_function returned empty payload");
	}
	return JSON.parse(raw) as T;
}

function buildViewAccountParams(accountId: string) {
	return {
		account_id: accountId,
		finality: "final",
		request_type: "view_account",
	};
}

function buildCallFunctionParams(params: {
	accountId: string;
	methodName: string;
	args: Record<string, unknown>;
}) {
	return {
		account_id: params.accountId,
		args_base64: Buffer.from(JSON.stringify(params.args), "utf8").toString(
			"base64",
		),
		finality: "final",
		method_name: params.methodName,
		request_type: "call_function",
	};
}

async function queryViewAccount(params: {
	accountId: string;
	network: string;
	rpcUrl?: string;
}): Promise<NearViewAccountResult> {
	return await callNearRpc<NearViewAccountResult>({
		method: "query",
		network: params.network,
		params: buildViewAccountParams(params.accountId),
		rpcUrl: params.rpcUrl,
	});
}

async function queryFtBalance(params: {
	accountId: string;
	ftContractId: string;
	network: string;
	rpcUrl?: string;
}): Promise<{ rawBalance: string; blockHeight: number; blockHash: string }> {
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		params: buildCallFunctionParams({
			accountId: params.ftContractId,
			args: {
				account_id: params.accountId,
			},
			methodName: "ft_balance_of",
		}),
		rpcUrl: params.rpcUrl,
	});

	const rawBalance = decodeNearCallFunctionJson<string>(result);
	if (typeof rawBalance !== "string") {
		throw new Error("ft_balance_of returned an invalid payload");
	}
	parseUnsignedBigInt(rawBalance, "ft_balance_of");

	return {
		blockHash: result.block_hash,
		blockHeight: result.block_height,
		rawBalance,
	};
}

async function queryFtMetadata(params: {
	ftContractId: string;
	network: string;
	rpcUrl?: string;
}): Promise<NearFtMetadata | null> {
	try {
		const result = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			params: buildCallFunctionParams({
				accountId: params.ftContractId,
				args: {},
				methodName: "ft_metadata",
			}),
			rpcUrl: params.rpcUrl,
		});
		const metadata = decodeNearCallFunctionJson<NearFtMetadata>(result);
		if (!metadata || typeof metadata !== "object") {
			return null;
		}
		return metadata;
	} catch {
		return null;
	}
}

function shortAccountId(value: string): string {
	if (value.length <= 28) return value;
	return `${value.slice(0, 14)}...${value.slice(-10)}`;
}

export function createNearReadTools() {
	return [
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getBalance`,
			label: "NEAR Get Balance",
			description: "Get native NEAR balance (available + locked).",
			parameters: Type.Object({
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = resolveNearAccountId(params.accountId, network);
				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);

				const account = await queryViewAccount({
					accountId,
					network,
					rpcUrl: params.rpcUrl,
				});
				const amount = parseUnsignedBigInt(account.amount, "amount");
				const locked = parseUnsignedBigInt(account.locked, "locked");
				const available = amount > locked ? amount - locked : 0n;

				const lines = [
					`Balance: ${formatNearAmount(amount, 6)} NEAR (${amount.toString()} yoctoNEAR)`,
					`Available: ${formatNearAmount(available, 6)} NEAR`,
				];
				if (locked > 0n) {
					lines.push(
						`Locked: ${formatNearAmount(locked, 6)} NEAR (${locked.toString()} yoctoNEAR)`,
					);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						accountId,
						availableNear: formatNearAmount(available, 8),
						availableYoctoNear: available.toString(),
						blockHash: account.block_hash,
						blockHeight: account.block_height,
						lockedNear: formatNearAmount(locked, 8),
						lockedYoctoNear: locked.toString(),
						network,
						rpcEndpoint: endpoint,
						totalNear: formatNearAmount(amount, 8),
						totalYoctoNear: amount.toString(),
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getAccount`,
			label: "NEAR Get Account",
			description: "Get NEAR account state via view_account.",
			parameters: Type.Object({
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = resolveNearAccountId(params.accountId, network);
				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
				const account = await queryViewAccount({
					accountId,
					network,
					rpcUrl: params.rpcUrl,
				});

				const amount = parseUnsignedBigInt(account.amount, "amount");
				const locked = parseUnsignedBigInt(account.locked, "locked");
				const available = amount > locked ? amount - locked : 0n;

				const text = [
					`Account: ${accountId}`,
					`Total: ${formatNearAmount(amount, 6)} NEAR`,
					`Available: ${formatNearAmount(available, 6)} NEAR`,
					`Storage usage: ${account.storage_usage}`,
					`Code hash: ${account.code_hash}`,
				].join("\n");

				return {
					content: [{ type: "text", text }],
					details: {
						accountId,
						accountState: account,
						availableYoctoNear: available.toString(),
						network,
						rpcEndpoint: endpoint,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getFtBalance`,
			label: "NEAR Get FT Balance",
			description:
				"Get fungible-token balance for an account from a specific FT contract (NEP-141).",
			parameters: Type.Object({
				ftContractId: Type.String({
					description:
						"FT contract account id (for example usdt.tether-token.near)",
				}),
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = resolveNearAccountId(params.accountId, network);
				const ftContractId = params.ftContractId.trim();
				if (!ftContractId) {
					throw new Error("ftContractId is required");
				}

				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
				const ftBalance = await queryFtBalance({
					accountId,
					ftContractId,
					network,
					rpcUrl: params.rpcUrl,
				});
				const metadata = await queryFtMetadata({
					ftContractId,
					network,
					rpcUrl: params.rpcUrl,
				});

				const decimals =
					typeof metadata?.decimals === "number" ? metadata.decimals : null;
				const symbol =
					typeof metadata?.symbol === "string" && metadata.symbol.trim()
						? metadata.symbol.trim()
						: shortAccountId(ftContractId);
				const uiAmount =
					decimals === null
						? null
						: formatTokenAmount(ftBalance.rawBalance, decimals, 8);

				const text =
					uiAmount === null
						? `FT balance: ${ftBalance.rawBalance} raw (${symbol})`
						: `FT balance: ${uiAmount} ${symbol} (raw ${ftBalance.rawBalance})`;

				return {
					content: [{ type: "text", text }],
					details: {
						accountId,
						blockHash: ftBalance.blockHash,
						blockHeight: ftBalance.blockHeight,
						decimals,
						ftContractId,
						metadata: metadata ?? null,
						network,
						rawBalance: ftBalance.rawBalance,
						rpcEndpoint: endpoint,
						symbol,
						uiAmount,
					},
				};
			},
		}),
	];
}
