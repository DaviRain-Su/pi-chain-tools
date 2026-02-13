import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { getRefSwapQuote } from "../ref.js";
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

type NearPortfolioAsset = {
	kind: "native" | "ft";
	symbol: string;
	contractId: string | null;
	rawAmount: string;
	uiAmount: string | null;
	decimals: number | null;
};

type NearPortfolioFailure = {
	ftContractId: string;
	error: string;
};

const NEAR_PORTFOLIO_ENV_BY_NETWORK: Record<"mainnet" | "testnet", string> = {
	mainnet: "NEAR_PORTFOLIO_FT_MAINNET_CONTRACTS",
	testnet: "NEAR_PORTFOLIO_FT_TESTNET_CONTRACTS",
};

const DEFAULT_NEAR_PORTFOLIO_FT_BY_NETWORK: Record<
	"mainnet" | "testnet",
	string[]
> = {
	mainnet: [
		"usdt.tether-token.near",
		"a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
		"usdc.tether-token.near",
	],
	testnet: ["usdt.fakes.testnet", "usdc.fakes.near"],
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

function parseFtContractList(value: string | undefined): string[] {
	const normalized = value?.trim();
	if (!normalized) return [];
	return normalized
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

function normalizeFtContractIds(values: string[] | undefined): string[] {
	if (!Array.isArray(values) || values.length === 0) return [];
	return values.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function dedupeStrings(values: string[]): string[] {
	return [...new Set(values)];
}

function resolvePortfolioFtContracts(params: {
	network: "mainnet" | "testnet";
	ftContractIds?: string[];
}): string[] {
	const explicit = normalizeFtContractIds(params.ftContractIds);
	if (explicit.length > 0) return dedupeStrings(explicit);

	const globalFromEnv = parseFtContractList(
		process.env.NEAR_PORTFOLIO_FT_CONTRACTS,
	);
	const networkFromEnv = parseFtContractList(
		process.env[NEAR_PORTFOLIO_ENV_BY_NETWORK[params.network]],
	);
	const defaults = DEFAULT_NEAR_PORTFOLIO_FT_BY_NETWORK[params.network];

	return dedupeStrings([...globalFromEnv, ...networkFromEnv, ...defaults]);
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
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getPortfolio`,
			label: "NEAR Get Portfolio",
			description:
				"Get portfolio snapshot for native NEAR and selected NEP-141 tokens.",
			parameters: Type.Object({
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				ftContractIds: Type.Optional(
					Type.Array(
						Type.String({
							description:
								"Optional FT contract ids to query. If omitted, use defaults/env list.",
						}),
					),
				),
				includeZeroBalances: Type.Optional(
					Type.Boolean({
						description: "Include zero FT balances (default false).",
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
				const includeZero = params.includeZeroBalances === true;
				const ftContractIds = resolvePortfolioFtContracts({
					network,
					ftContractIds: params.ftContractIds,
				});

				const account = await queryViewAccount({
					accountId,
					network,
					rpcUrl: params.rpcUrl,
				});
				const totalYoctoNear = parseUnsignedBigInt(account.amount, "amount");
				const lockedYoctoNear = parseUnsignedBigInt(account.locked, "locked");
				const availableYoctoNear =
					totalYoctoNear > lockedYoctoNear
						? totalYoctoNear - lockedYoctoNear
						: 0n;

				const assets: NearPortfolioAsset[] = [
					{
						kind: "native",
						symbol: "NEAR",
						contractId: null,
						rawAmount: totalYoctoNear.toString(),
						uiAmount: formatNearAmount(totalYoctoNear, 8),
						decimals: 24,
					},
				];
				const failures: NearPortfolioFailure[] = [];

				for (const ftContractId of ftContractIds) {
					try {
						const ftBalance = await queryFtBalance({
							accountId,
							ftContractId,
							network,
							rpcUrl: params.rpcUrl,
						});
						const rawBalance = parseUnsignedBigInt(
							ftBalance.rawBalance,
							"ft_balance_of",
						);
						if (!includeZero && rawBalance === 0n) {
							continue;
						}

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
							decimals == null
								? null
								: formatTokenAmount(ftBalance.rawBalance, decimals, 8);
						assets.push({
							kind: "ft",
							symbol,
							contractId: ftContractId,
							rawAmount: ftBalance.rawBalance,
							uiAmount,
							decimals,
						});
					} catch (error) {
						failures.push({
							ftContractId,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}

				const lines = [
					`Portfolio: ${assets.length} assets (account ${accountId})`,
					`NEAR: ${formatNearAmount(totalYoctoNear, 8)} (available ${formatNearAmount(availableYoctoNear, 8)}, locked ${formatNearAmount(lockedYoctoNear, 8)})`,
				];
				for (const asset of assets) {
					if (asset.kind === "native") continue;
					const amountText =
						asset.uiAmount == null
							? `${asset.rawAmount} raw`
							: `${asset.uiAmount} (raw ${asset.rawAmount})`;
					lines.push(
						`${asset.symbol}: ${amountText} on ${asset.contractId ?? "unknown"}`,
					);
				}
				if (failures.length > 0) {
					lines.push(
						`Skipped ${failures.length} token(s) due to query errors.`,
					);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						accountId,
						assets,
						blockHash: account.block_hash,
						blockHeight: account.block_height,
						failures,
						network,
						rpcEndpoint: endpoint,
						ftContractsQueried: ftContractIds,
						includeZeroBalances: includeZero,
						totalYoctoNear: totalYoctoNear.toString(),
						availableYoctoNear: availableYoctoNear.toString(),
						lockedYoctoNear: lockedYoctoNear.toString(),
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getSwapQuoteRef`,
			label: "NEAR Ref Swap Quote",
			description:
				"Get swap quote from Ref (Rhea route) using direct simple pool best-route or explicit pool.",
			parameters: Type.Object({
				tokenInId: Type.String({
					description: "Input token contract id or symbol (e.g. NEAR/USDC)",
				}),
				tokenOutId: Type.String({
					description: "Output token contract id or symbol",
				}),
				amountInRaw: Type.String({
					description: "Input amount as raw integer string",
				}),
				poolId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				slippageBps: Type.Optional(
					Type.Number({ description: "Slippage in bps (default 50)" }),
				),
				refContractId: Type.Optional(
					Type.String({
						description:
							"Ref exchange contract id override (default mainnet v2.ref-finance.near)",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
				const tokenInId = params.tokenInId.trim();
				const tokenOutId = params.tokenOutId.trim();
				if (!tokenInId || !tokenOutId) {
					throw new Error("tokenInId and tokenOutId are required");
				}
				const quote = await getRefSwapQuote({
					network,
					rpcUrl: params.rpcUrl,
					refContractId: params.refContractId,
					tokenInId,
					tokenOutId,
					amountInRaw: params.amountInRaw,
					poolId: parseOptionalPoolId(params.poolId),
					slippageBps: params.slippageBps,
				});
				const slippageBps =
					typeof params.slippageBps === "number" &&
					Number.isFinite(params.slippageBps)
						? Math.max(0, Math.floor(params.slippageBps))
						: 50;
				const text = [
					`Ref quote: ${quote.amountInRaw} raw ${tokenInId} -> ${quote.amountOutRaw} raw ${tokenOutId}`,
					`Min output (${slippageBps} bps): ${quote.minAmountOutRaw} raw`,
					`Pool: ${quote.poolId} (${quote.source})`,
					`Contract: ${quote.refContractId}`,
				].join("\n");
				return {
					content: [{ type: "text", text }],
					details: {
						network,
						rpcEndpoint: endpoint,
						quote,
					},
				};
			},
		}),
	];
}
