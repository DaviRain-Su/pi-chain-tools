import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { fetchRefPoolById, getRefContractId, getRefSwapQuote } from "../ref.js";
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

type NearRefDepositAsset = {
	tokenId: string;
	symbol: string;
	rawAmount: string;
	uiAmount: string | null;
	decimals: number | null;
	metadata: NearFtMetadata | null;
};

type NearRefDepositFailure = {
	tokenId: string;
	error: string;
};

type NearRefPoolView = {
	id: number;
	tokenIds: string[];
	poolKind?: string;
};

type NearRefLpPosition = {
	poolId: number;
	poolKind?: string;
	tokenIds: string[];
	tokenSymbols: string[];
	pairLabel: string;
	sharesRaw: string;
	removeHint: string;
};

type NearRefLpFailure = {
	poolId: number;
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

function parsePoolIdList(values?: (number | string)[]): number[] {
	if (!Array.isArray(values) || values.length === 0) return [];
	return [...new Set(values.map((value) => parseOptionalPoolId(value)))].filter(
		(value): value is number => value != null,
	);
}

function parseMaxPools(value?: number): number {
	if (value == null) return 200;
	if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
		throw new Error("maxPools must be a positive integer");
	}
	return Math.min(value, 1_000);
}

function normalizeTokenFilterList(values?: string[]): string[] {
	if (!Array.isArray(values) || values.length === 0) return [];
	return dedupeStrings(
		values.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
	);
}

function formatRefAssetAmount(params: {
	rawAmount: string;
	decimals: number | null;
}): string | null {
	if (params.decimals == null) return null;
	try {
		return formatTokenAmount(params.rawAmount, params.decimals, 8);
	} catch {
		return null;
	}
}

function resolveRefAssetText(asset: NearRefDepositAsset): string {
	const amountText =
		asset.uiAmount == null
			? `${asset.rawAmount} raw`
			: `${asset.uiAmount} (raw ${asset.rawAmount})`;
	return `${asset.symbol}: ${amountText} on ${asset.tokenId}`;
}

function resolveRefPoolPositionText(position: NearRefLpPosition): string[] {
	return [
		`Pool ${position.poolId} (${position.pairLabel}): shares ${position.sharesRaw}`,
		`Tokens: ${position.tokenIds.join(" / ")}`,
		`Hint: ${position.removeHint}`,
	];
}

async function queryRefDeposits(params: {
	accountId: string;
	network: string;
	refContractId: string;
	rpcUrl?: string;
}): Promise<Record<string, string>> {
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: buildCallFunctionParams({
			accountId: params.refContractId,
			methodName: "get_deposits",
			args: {
				account_id: params.accountId,
			},
		}),
	});
	const decoded = decodeNearCallFunctionJson<Record<string, string>>(result);
	if (!decoded || typeof decoded !== "object") {
		return {};
	}
	const deposits: Record<string, string> = {};
	for (const [tokenId, rawAmount] of Object.entries(decoded)) {
		if (typeof tokenId !== "string" || typeof rawAmount !== "string") continue;
		const normalizedTokenId = tokenId.trim().toLowerCase();
		if (!normalizedTokenId) continue;
		deposits[normalizedTokenId] = parseUnsignedBigInt(
			rawAmount,
			`deposits[${normalizedTokenId}]`,
		).toString();
	}
	return deposits;
}

async function queryRefPoolShares(params: {
	accountId: string;
	network: string;
	refContractId: string;
	poolId: number;
	rpcUrl?: string;
}): Promise<string> {
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: buildCallFunctionParams({
			accountId: params.refContractId,
			methodName: "get_pool_shares",
			args: {
				pool_id: params.poolId,
				account_id: params.accountId,
			},
		}),
	});
	const shares = decodeNearCallFunctionJson<string>(result);
	if (typeof shares !== "string") {
		throw new Error("get_pool_shares returned invalid payload");
	}
	return parseUnsignedBigInt(shares, "poolShares").toString();
}

async function queryRefPoolsPage(params: {
	network: string;
	refContractId: string;
	fromIndex: number;
	limit: number;
	rpcUrl?: string;
}): Promise<{ pools: NearRefPoolView[]; rawCount: number }> {
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: buildCallFunctionParams({
			accountId: params.refContractId,
			methodName: "get_pools",
			args: {
				from_index: params.fromIndex,
				limit: params.limit,
			},
		}),
	});
	const decoded = decodeNearCallFunctionJson<unknown[]>(result);
	if (!Array.isArray(decoded)) {
		throw new Error("get_pools returned invalid payload");
	}
	const pools: NearRefPoolView[] = [];
	for (const [index, entry] of decoded.entries()) {
		if (!entry || typeof entry !== "object") continue;
		const rawPool = entry as {
			id?: number;
			token_account_ids?: unknown;
			pool_kind?: unknown;
		};
		const tokenIds = Array.isArray(rawPool.token_account_ids)
			? rawPool.token_account_ids
					.filter((tokenId): tokenId is string => typeof tokenId === "string")
					.map((tokenId) => tokenId.toLowerCase())
			: [];
		if (tokenIds.length < 2) continue;
		const poolId =
			typeof rawPool.id === "number" &&
			Number.isInteger(rawPool.id) &&
			rawPool.id >= 0
				? rawPool.id
				: params.fromIndex + index;
		pools.push({
			id: poolId,
			tokenIds,
			poolKind:
				typeof rawPool.pool_kind === "string" ? rawPool.pool_kind : undefined,
		});
	}
	return {
		pools,
		rawCount: decoded.length,
	};
}

async function mapConcurrently<T, U>(
	inputs: T[],
	concurrency: number,
	mapper: (input: T, index: number) => Promise<U>,
): Promise<U[]> {
	if (inputs.length === 0) return [];
	const workers = Math.max(1, Math.min(concurrency, inputs.length));
	const output = new Array<U>(inputs.length);
	let cursor = 0;
	await Promise.all(
		Array.from({ length: workers }, async () => {
			while (true) {
				const index = cursor;
				cursor += 1;
				if (index >= inputs.length) return;
				output[index] = await mapper(inputs[index], index);
			}
		}),
	);
	return output;
}

async function resolveTokenMetadataCached(
	tokenId: string,
	cache: Map<string, Promise<NearFtMetadata | null>>,
	params: {
		network: string;
		rpcUrl?: string;
	},
): Promise<NearFtMetadata | null> {
	const normalized = tokenId.toLowerCase();
	if (!cache.has(normalized)) {
		cache.set(
			normalized,
			queryFtMetadata({
				ftContractId: normalized,
				network: params.network,
				rpcUrl: params.rpcUrl,
			}),
		);
	}
	const metadataPromise = cache.get(normalized);
	if (!metadataPromise) return null;
	return await metadataPromise;
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
			name: `${NEAR_TOOL_PREFIX}getRefDeposits`,
			label: "NEAR Ref Deposits",
			description:
				"Get deposited token balances on Ref exchange for an account.",
			parameters: Type.Object({
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				refContractId: Type.Optional(
					Type.String({
						description:
							"Ref exchange contract id override (default mainnet v2.ref-finance.near).",
					}),
				),
				tokenIds: Type.Optional(
					Type.Array(
						Type.String({
							description:
								"Optional token contract ids to filter (case-insensitive).",
						}),
					),
				),
				includeZeroBalances: Type.Optional(
					Type.Boolean({
						description: "Include zero deposits (default false).",
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
				const refContractId = getRefContractId(network, params.refContractId);
				const includeZero = params.includeZeroBalances === true;
				const tokenFilters = new Set(normalizeTokenFilterList(params.tokenIds));
				const metadataCache = new Map<string, Promise<NearFtMetadata | null>>();
				const deposits = await queryRefDeposits({
					accountId,
					network,
					refContractId,
					rpcUrl: params.rpcUrl,
				});

				const assets: NearRefDepositAsset[] = [];
				const failures: NearRefDepositFailure[] = [];
				const sortedEntries = Object.entries(deposits).sort((left, right) => {
					const leftValue = parseUnsignedBigInt(
						left[1],
						`deposits[${left[0]}]`,
					);
					const rightValue = parseUnsignedBigInt(
						right[1],
						`deposits[${right[0]}]`,
					);
					if (leftValue === rightValue) return left[0].localeCompare(right[0]);
					return leftValue > rightValue ? -1 : 1;
				});
				for (const [tokenId, rawAmount] of sortedEntries) {
					const rawAmountValue = parseUnsignedBigInt(
						rawAmount,
						`deposits[${tokenId}]`,
					);
					if (tokenFilters.size > 0 && !tokenFilters.has(tokenId)) {
						continue;
					}
					if (!includeZero && rawAmountValue === 0n) {
						continue;
					}
					try {
						const metadata = await resolveTokenMetadataCached(
							tokenId,
							metadataCache,
							{
								network,
								rpcUrl: params.rpcUrl,
							},
						);
						const decimals =
							typeof metadata?.decimals === "number" ? metadata.decimals : null;
						const symbol =
							typeof metadata?.symbol === "string" && metadata.symbol.trim()
								? metadata.symbol.trim()
								: shortAccountId(tokenId);
						assets.push({
							tokenId,
							symbol,
							rawAmount: rawAmountValue.toString(),
							uiAmount: formatRefAssetAmount({
								rawAmount: rawAmountValue.toString(),
								decimals,
							}),
							decimals,
							metadata: metadata ?? null,
						});
					} catch (error) {
						failures.push({
							tokenId,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}

				const lines = [
					`Ref deposits: ${assets.length} token(s) on ${refContractId} (account ${accountId})`,
				];
				if (assets.length === 0) {
					lines.push("No deposited token balances found.");
				}
				for (const asset of assets) {
					lines.push(resolveRefAssetText(asset));
				}
				if (failures.length > 0) {
					lines.push(
						`Skipped ${failures.length} token(s) due to metadata/query errors.`,
					);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						accountId,
						network,
						rpcEndpoint: endpoint,
						refContractId,
						assets,
						failures,
						tokenFilters: [...tokenFilters],
						includeZeroBalances: includeZero,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getRefLpPositions`,
			label: "NEAR Ref LP Positions",
			description:
				"Get Ref LP share positions for an account (by explicit pool ids or scanned pools).",
			parameters: Type.Object({
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				poolId: Type.Optional(
					Type.Union([Type.Number(), Type.String()], {
						description: "Optional single pool id.",
					}),
				),
				poolIds: Type.Optional(
					Type.Array(
						Type.Union([Type.Number(), Type.String()], {
							description: "Optional pool ids.",
						}),
					),
				),
				maxPools: Type.Optional(
					Type.Number({
						description:
							"When poolId/poolIds are omitted, scan up to this many pools (default 200).",
					}),
				),
				includeZeroBalances: Type.Optional(
					Type.Boolean({
						description:
							"Include zero-share pools in the response (default false).",
					}),
				),
				refContractId: Type.Optional(
					Type.String({
						description:
							"Ref exchange contract id override (default mainnet v2.ref-finance.near).",
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
				const refContractId = getRefContractId(network, params.refContractId);
				const includeZero = params.includeZeroBalances === true;
				const maxPools = parseMaxPools(params.maxPools);
				const poolIds = dedupeStrings(
					[
						parseOptionalPoolId(params.poolId),
						...parsePoolIdList(params.poolIds),
					]
						.filter((value): value is number => value != null)
						.map((value) => value.toString()),
				).map((value) => Number(value));
				const metadataCache = new Map<string, Promise<NearFtMetadata | null>>();

				let scannedPoolCount = 0;
				const pools: NearRefPoolView[] = [];

				if (poolIds.length > 0) {
					const resolvedPools = await Promise.all(
						poolIds.map(async (poolId) => {
							const pool = await fetchRefPoolById({
								network,
								rpcUrl: params.rpcUrl,
								refContractId,
								poolId,
							});
							return {
								id: pool.id,
								tokenIds: pool.token_account_ids.map((tokenId) =>
									tokenId.toLowerCase(),
								),
								poolKind: pool.pool_kind,
							} satisfies NearRefPoolView;
						}),
					);
					pools.push(...resolvedPools);
					scannedPoolCount = resolvedPools.length;
				} else {
					let fromIndex = 0;
					while (pools.length < maxPools) {
						const pageLimit = Math.min(100, maxPools - pools.length);
						const page = await queryRefPoolsPage({
							network,
							refContractId,
							fromIndex,
							limit: pageLimit,
							rpcUrl: params.rpcUrl,
						});
						if (page.rawCount === 0) break;
						pools.push(...page.pools);
						scannedPoolCount += page.rawCount;
						if (page.rawCount < pageLimit) break;
						fromIndex += page.rawCount;
					}
					if (pools.length > maxPools) {
						pools.length = maxPools;
					}
				}

				const shareResults = await mapConcurrently(
					pools,
					8,
					async (
						pool,
					): Promise<
						| {
								status: "ok";
								position: NearRefLpPosition;
								sharesRawValue: bigint;
						  }
						| {
								status: "error";
								failure: NearRefLpFailure;
						  }
					> => {
						try {
							const sharesRaw = await queryRefPoolShares({
								accountId,
								network,
								refContractId,
								poolId: pool.id,
								rpcUrl: params.rpcUrl,
							});
							const sharesRawValue = parseUnsignedBigInt(
								sharesRaw,
								`poolShares[${pool.id}]`,
							);
							if (!includeZero && sharesRawValue === 0n) {
								return {
									status: "ok",
									position: {
										poolId: pool.id,
										poolKind: pool.poolKind,
										tokenIds: pool.tokenIds,
										tokenSymbols: [],
										pairLabel: pool.tokenIds.join("/"),
										sharesRaw: sharesRawValue.toString(),
										removeHint: `在 Ref 移除 LP，pool ${pool.id}，shares ${sharesRawValue.toString()}，minA 0，minB 0，先模拟`,
									},
									sharesRawValue,
								};
							}

							const tokenSymbols = await Promise.all(
								pool.tokenIds.map(async (tokenId) => {
									const metadata = await resolveTokenMetadataCached(
										tokenId,
										metadataCache,
										{
											network,
											rpcUrl: params.rpcUrl,
										},
									);
									return typeof metadata?.symbol === "string" &&
										metadata.symbol.trim()
										? metadata.symbol.trim()
										: shortAccountId(tokenId);
								}),
							);
							const pairLabel = tokenSymbols.join("/");
							return {
								status: "ok",
								position: {
									poolId: pool.id,
									poolKind: pool.poolKind,
									tokenIds: pool.tokenIds,
									tokenSymbols,
									pairLabel,
									sharesRaw: sharesRawValue.toString(),
									removeHint: `在 Ref 移除 LP，pool ${pool.id}，shares ${sharesRawValue.toString()}，minA 0，minB 0，先模拟`,
								},
								sharesRawValue,
							};
						} catch (error) {
							return {
								status: "error",
								failure: {
									poolId: pool.id,
									error: error instanceof Error ? error.message : String(error),
								},
							};
						}
					},
				);

				const failures: NearRefLpFailure[] = [];
				const positions: NearRefLpPosition[] = [];
				for (const entry of shareResults) {
					if (entry.status === "error") {
						failures.push(entry.failure);
						continue;
					}
					if (!includeZero && entry.sharesRawValue === 0n) {
						continue;
					}
					positions.push(entry.position);
				}
				positions.sort((left, right) => {
					const leftShares = parseUnsignedBigInt(
						left.sharesRaw,
						`shares[${left.poolId}]`,
					);
					const rightShares = parseUnsignedBigInt(
						right.sharesRaw,
						`shares[${right.poolId}]`,
					);
					if (leftShares === rightShares) return left.poolId - right.poolId;
					return leftShares > rightShares ? -1 : 1;
				});

				const lines = [
					`Ref LP positions: ${positions.length} pool(s) on ${refContractId} (account ${accountId})`,
					`Scanned pools: ${scannedPoolCount}${poolIds.length > 0 ? " (explicit)" : ""}`,
				];
				if (positions.length === 0) {
					lines.push("No LP shares found in scanned pools.");
				}
				for (const [index, position] of positions.entries()) {
					const block = resolveRefPoolPositionText(position);
					lines.push(`${index + 1}. ${block[0]}`);
					lines.push(`   ${block[1]}`);
					lines.push(`   ${block[2]}`);
				}
				if (failures.length > 0) {
					lines.push(`Skipped ${failures.length} pool(s) due to query errors.`);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						accountId,
						network,
						rpcEndpoint: endpoint,
						refContractId,
						poolIdsExplicit: poolIds.length > 0 ? poolIds : undefined,
						maxPoolsScanned: maxPools,
						scannedPoolCount,
						includeZeroBalances: includeZero,
						positions,
						failures,
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
