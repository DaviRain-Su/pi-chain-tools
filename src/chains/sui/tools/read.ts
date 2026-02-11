import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";
import { normalizeStructTag, parseStructTag } from "@mysten/sui/utils";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	getCetusFarmsPools,
	getCetusFarmsPositions,
	getCetusVaultsBalances,
	resolveCetusV2Network,
} from "../cetus-v2.js";
import {
	SUI_COIN_TYPE,
	SUI_TOOL_PREFIX,
	formatCoinAmount,
	getSuiClient,
	getSuiRpcEndpoint,
	parsePositiveBigInt,
	parseSuiNetwork,
	resolveSuiOwnerAddress,
	suiNetworkSchema,
} from "../runtime.js";
import {
	getStableLayerSupply,
	resolveStableLayerNetwork,
} from "../stablelayer.js";

type SuiBalanceEntry = {
	coinType: string;
	coinObjectCount: number;
	totalBalance: string;
	lockedBalance: Record<string, string>;
	fundsInAddressBalance?: string;
};

type SuiStableLayerSupplyParams = {
	stableCoinType?: string;
	network?: string;
	sender?: string;
};

type SuiCetusFarmsPoolsParams = {
	network?: string;
	rpcUrl?: string;
	limit?: number;
};

type SuiCetusFarmsPositionsParams = {
	owner?: string;
	network?: string;
	rpcUrl?: string;
	calculateRewards?: boolean;
	limit?: number;
};

type SuiCetusVaultsBalancesParams = {
	owner?: string;
	network?: string;
	rpcUrl?: string;
	limit?: number;
};

type SuiDefiPositionsParams = {
	owner?: string;
	network?: string;
	rpcUrl?: string;
	limit?: number;
	includeZeroBalances?: boolean;
	includeMetadata?: boolean;
	includeCetusFarms?: boolean;
	includeCetusVaults?: boolean;
	calculateFarmsRewards?: boolean;
	farmsLimit?: number;
	vaultLimit?: number;
};

type SuiPortfolioAsset = {
	coinType: string;
	totalBalance: string;
	uiAmount: string | null;
	decimals: number | null;
	coinObjectCount: number;
	lockedBalance: Record<string, string>;
	fundsInAddressBalance: string | null;
	metadata: {
		symbol: string;
		name: string;
		description: string;
		iconUrl: string | null;
	} | null;
};

type SuiPortfolioSummary = {
	assetCount: number;
	totalCoinObjectCount: number;
	assets: SuiPortfolioAsset[];
	suiBalance: SuiPortfolioAsset | null;
};

type CetusFarmsPoolSummary = {
	poolId: string;
	clmmPoolId: string;
	pairSymbol: string | null;
	coinTypeA: string | null;
	coinTypeB: string | null;
	rewarderCount: number;
	effectiveTickLower: number | null;
	effectiveTickUpper: number | null;
	totalShare: string | null;
};

type CetusFarmsPositionSummary = {
	positionNftId: string;
	poolId: string;
	clmmPositionId: string | null;
	clmmPoolId: string | null;
	rewardCount: number;
};

type CetusVaultBalanceSummary = {
	vaultId: string | null;
	clmmPoolId: string | null;
	lpTokenBalance: string | null;
};

const HUMAN_READABLE_LIMIT = 12;

function parseNonNegativeBigInt(value: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error("balance must be a non-negative integer string");
	}
	return BigInt(normalized);
}

function resolveAggregatorEnv(network: string): Env {
	if (network === "mainnet") return Env.Mainnet;
	if (network === "testnet") return Env.Testnet;
	throw new Error(
		"sui_getSwapQuote currently supports network=mainnet or testnet.",
	);
}

function clampLimit(value: number | undefined, fallback: number): number {
	if (typeof value !== "number") return fallback;
	return Math.max(1, Math.min(200, Math.floor(value)));
}

function shortId(value: string): string {
	if (value.length <= 20) return value;
	return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function fallbackCoinSymbol(coinType: string): string {
	const segments = coinType.split("::").filter((entry) => entry.length > 0);
	const last = segments[segments.length - 1];
	if (last) return last;
	return shortId(coinType);
}

function shortCoinType(coinType: string): string {
	const segments = coinType.split("::");
	if (segments.length !== 3) return shortId(coinType);
	const [address, module, name] = segments;
	const shortAddress =
		address.length > 18
			? `${address.slice(0, 10)}...${address.slice(-6)}`
			: address;
	return `${shortAddress}::${module}::${name}`;
}

function parsePoolCoinTypes(
	value: unknown,
): { coinTypeA: string; coinTypeB: string } | null {
	if (typeof value !== "string" || !value.includes("::")) return null;
	try {
		const parsed = parseStructTag(value);
		if (parsed.name !== "Pool" || parsed.typeParams.length < 2) {
			return null;
		}
		const [coinA, coinB] = parsed.typeParams;
		const coinTypeA =
			typeof coinA === "string" ? coinA : normalizeStructTag(coinA);
		const coinTypeB =
			typeof coinB === "string" ? coinB : normalizeStructTag(coinB);
		if (!coinTypeA.includes("::") || !coinTypeB.includes("::")) {
			return null;
		}
		return { coinTypeA, coinTypeB };
	} catch {
		return null;
	}
}

async function resolveCetusPoolPairMap(params: {
	network: string;
	rpcUrl?: string;
	clmmPoolIds: string[];
}): Promise<
	Map<
		string,
		{
			coinTypeA: string;
			coinTypeB: string;
			pairSymbol: string;
		}
	>
> {
	const pairMap = new Map<
		string,
		{
			coinTypeA: string;
			coinTypeB: string;
			pairSymbol: string;
		}
	>();
	const uniqueClmmPoolIds = [...new Set(params.clmmPoolIds)];
	if (uniqueClmmPoolIds.length === 0) return pairMap;

	try {
		const client = getSuiClient(params.network, params.rpcUrl) as {
			multiGetObjects?: (params: {
				ids: string[];
				options?: { showType?: boolean };
			}) => Promise<unknown[]>;
			getCoinMetadata?: (params: {
				coinType: string;
			}) => Promise<{ symbol?: string } | null>;
		};
		if (typeof client.multiGetObjects !== "function") {
			return pairMap;
		}

		const poolObjects = await client.multiGetObjects({
			ids: uniqueClmmPoolIds,
			options: { showType: true },
		});
		const coinTypes = new Set<string>();
		const coinTypesByClmmPoolId = new Map<
			string,
			{
				coinTypeA: string;
				coinTypeB: string;
			}
		>();

		for (const [index, clmmPoolId] of uniqueClmmPoolIds.entries()) {
			const objectEntry = poolObjects[index] as {
				data?: { type?: unknown };
			};
			const parsed = parsePoolCoinTypes(objectEntry?.data?.type);
			if (!parsed) continue;
			coinTypesByClmmPoolId.set(clmmPoolId, parsed);
			coinTypes.add(parsed.coinTypeA);
			coinTypes.add(parsed.coinTypeB);
		}

		const symbolByCoinType = new Map<string, string>();
		for (const coinType of coinTypes) {
			symbolByCoinType.set(coinType, fallbackCoinSymbol(coinType));
		}

		if (typeof client.getCoinMetadata === "function") {
			await Promise.all(
				[...coinTypes].map(async (coinType) => {
					try {
						const metadata = await client.getCoinMetadata?.({ coinType });
						const symbol = metadata?.symbol?.trim();
						if (symbol) {
							symbolByCoinType.set(coinType, symbol);
						}
					} catch {
						// keep fallback symbol for this coin type
					}
				}),
			);
		}

		for (const [
			clmmPoolId,
			coinTypesEntry,
		] of coinTypesByClmmPoolId.entries()) {
			const symbolA =
				symbolByCoinType.get(coinTypesEntry.coinTypeA) ??
				fallbackCoinSymbol(coinTypesEntry.coinTypeA);
			const symbolB =
				symbolByCoinType.get(coinTypesEntry.coinTypeB) ??
				fallbackCoinSymbol(coinTypesEntry.coinTypeB);
			pairMap.set(clmmPoolId, {
				coinTypeA: coinTypesEntry.coinTypeA,
				coinTypeB: coinTypesEntry.coinTypeB,
				pairSymbol: `${symbolA}/${symbolB}`,
			});
		}
	} catch {
		return pairMap;
	}

	return pairMap;
}

function formatCetusPoolsText(params: {
	network: string;
	pools: CetusFarmsPoolSummary[];
	hasNextPage: boolean;
	nextCursor: string | null;
}): string {
	const lines = [
		`Cetus farms pools (${params.network}): ${params.pools.length} item(s)`,
	];
	if (params.pools.length === 0) {
		lines.push("No pools found.");
		return lines.join("\n");
	}

	const visible = params.pools.slice(0, HUMAN_READABLE_LIMIT);
	for (const [index, pool] of visible.entries()) {
		const pairLabel = pool.pairSymbol ?? "unknown-pair";
		lines.push(`${index + 1}. ${pairLabel} rewards=${pool.rewarderCount}`);
		if (pool.coinTypeA && pool.coinTypeB) {
			lines.push(
				`   pairTypes: ${shortCoinType(pool.coinTypeA)} / ${shortCoinType(pool.coinTypeB)}`,
			);
		}
		lines.push(`   poolId: ${pool.poolId}`);
		lines.push(`   clmmPoolId: ${pool.clmmPoolId}`);
		if (
			typeof pool.effectiveTickLower === "number" &&
			typeof pool.effectiveTickUpper === "number"
		) {
			lines.push(
				`   effectiveTicks: [${pool.effectiveTickLower}, ${pool.effectiveTickUpper}]`,
			);
		}
		if (pool.totalShare) {
			lines.push(`   totalShare: ${pool.totalShare}`);
		}
	}

	const hiddenCount = params.pools.length - visible.length;
	if (hiddenCount > 0) {
		lines.push(`... and ${hiddenCount} more pool(s) in details.pools`);
	}
	if (params.hasNextPage) {
		lines.push(
			`hasNextPage: true${params.nextCursor ? ` (nextCursor=${params.nextCursor})` : ""}`,
		);
	}
	return lines.join("\n");
}

function formatCetusPositionsText(params: {
	owner: string;
	network: string;
	positions: CetusFarmsPositionSummary[];
	hasNextPage: boolean;
	nextCursor: string | null;
}): string {
	const lines = [
		`Cetus farms positions (${params.network}): ${params.positions.length} item(s)`,
		`owner: ${params.owner}`,
	];
	if (params.positions.length === 0) {
		lines.push("No positions found.");
		return lines.join("\n");
	}

	const visible = params.positions.slice(0, HUMAN_READABLE_LIMIT);
	for (const [index, position] of visible.entries()) {
		lines.push(
			`${index + 1}. ${shortId(position.positionNftId)} rewards=${position.rewardCount}`,
		);
		lines.push(`   positionNftId: ${position.positionNftId}`);
		lines.push(`   poolId: ${position.poolId}`);
		if (position.clmmPositionId) {
			lines.push(`   clmmPositionId: ${position.clmmPositionId}`);
		}
		if (position.clmmPoolId) {
			lines.push(`   clmmPoolId: ${position.clmmPoolId}`);
		}
	}

	const hiddenCount = params.positions.length - visible.length;
	if (hiddenCount > 0) {
		lines.push(`... and ${hiddenCount} more position(s) in details.positions`);
	}
	if (params.hasNextPage) {
		lines.push(
			`hasNextPage: true${params.nextCursor ? ` (nextCursor=${params.nextCursor})` : ""}`,
		);
	}
	return lines.join("\n");
}

function formatCetusVaultBalancesText(params: {
	owner: string;
	network: string;
	balances: CetusVaultBalanceSummary[];
}): string {
	const lines = [
		`Cetus vault balances (${params.network}): ${params.balances.length} item(s)`,
		`owner: ${params.owner}`,
	];
	if (params.balances.length === 0) {
		lines.push("No vault balances found.");
		return lines.join("\n");
	}

	const visible = params.balances.slice(0, HUMAN_READABLE_LIMIT);
	for (const [index, balance] of visible.entries()) {
		lines.push(`${index + 1}. ${shortId(balance.vaultId ?? "unknown-vault")}`);
		lines.push(`   vaultId: ${balance.vaultId ?? "unknown"}`);
		if (balance.clmmPoolId) {
			lines.push(`   clmmPoolId: ${balance.clmmPoolId}`);
		}
		if (balance.lpTokenBalance) {
			lines.push(`   lpTokenBalance: ${balance.lpTokenBalance}`);
		}
	}

	const hiddenCount = params.balances.length - visible.length;
	if (hiddenCount > 0) {
		lines.push(
			`... and ${hiddenCount} more balance item(s) in details.balances`,
		);
	}
	return lines.join("\n");
}

async function buildPortfolioSummary(params: {
	owner: string;
	network: string;
	rpcUrl?: string;
	limit?: number;
	includeZeroBalances?: boolean;
	includeMetadata?: boolean;
}): Promise<{ rpcUrl: string; portfolio: SuiPortfolioSummary }> {
	const client = getSuiClient(params.network, params.rpcUrl);
	const rpcUrl = getSuiRpcEndpoint(params.network, params.rpcUrl);
	const includeZeroBalances = params.includeZeroBalances === true;
	const includeMetadata = params.includeMetadata !== false;
	const limit = clampLimit(params.limit, 50);

	const allBalances = await client.getAllBalances({ owner: params.owner });
	const filteredBalances = allBalances
		.filter((entry) => {
			const amount = parseNonNegativeBigInt(entry.totalBalance);
			return includeZeroBalances || amount > 0n;
		})
		.sort((a, b) => {
			const aAmount = parseNonNegativeBigInt(a.totalBalance);
			const bAmount = parseNonNegativeBigInt(b.totalBalance);
			if (aAmount === bAmount) return a.coinType.localeCompare(b.coinType);
			return aAmount > bAmount ? -1 : 1;
		})
		.slice(0, limit);

	const metadataByCoinType = new Map<
		string,
		Awaited<ReturnType<typeof client.getCoinMetadata>>
	>();

	if (includeMetadata) {
		await Promise.all(
			filteredBalances.map(async (entry) => {
				try {
					const metadata = await client.getCoinMetadata({
						coinType: entry.coinType,
					});
					metadataByCoinType.set(entry.coinType, metadata);
				} catch {
					metadataByCoinType.set(entry.coinType, null);
				}
			}),
		);
	}

	const assets = filteredBalances.map((entry) => {
		const metadata = metadataByCoinType.get(entry.coinType) ?? null;
		const entryWithFunds = entry as unknown as {
			fundsInAddressBalance?: unknown;
		};
		const fundsInAddressBalance =
			typeof entryWithFunds.fundsInAddressBalance === "string"
				? entryWithFunds.fundsInAddressBalance
				: null;
		const decimals =
			entry.coinType === SUI_COIN_TYPE
				? 9
				: typeof metadata?.decimals === "number"
					? metadata.decimals
					: null;
		const uiAmount =
			typeof decimals === "number"
				? formatCoinAmount(entry.totalBalance, decimals)
				: null;
		return {
			coinType: entry.coinType,
			totalBalance: entry.totalBalance,
			uiAmount,
			decimals,
			coinObjectCount: entry.coinObjectCount,
			lockedBalance: entry.lockedBalance,
			fundsInAddressBalance,
			metadata: metadata
				? {
						symbol: metadata.symbol,
						name: metadata.name,
						description: metadata.description,
						iconUrl: metadata.iconUrl ?? null,
					}
				: null,
		};
	});

	const suiAsset =
		assets.find((entry) => entry.coinType === SUI_COIN_TYPE) ?? null;
	const totalCoinObjectCount = (filteredBalances as SuiBalanceEntry[]).reduce(
		(sum, entry) => sum + entry.coinObjectCount,
		0,
	);

	return {
		rpcUrl,
		portfolio: {
			assetCount: assets.length,
			totalCoinObjectCount,
			assets,
			suiBalance: suiAsset,
		},
	};
}

export function createSuiReadTools() {
	return [
		defineTool({
			name: `${SUI_TOOL_PREFIX}getBalance`,
			label: "Sui Get Balance",
			description:
				"Get owner balance for SUI or a specific coin type on Sui (mainnet/testnet/devnet/localnet). If owner is omitted, uses local Sui CLI active wallet.",
			parameters: Type.Object({
				owner: Type.Optional(
					Type.String({
						description:
							"Sui wallet/account address. Optional: defaults to local active wallet",
					}),
				),
				coinType: Type.Optional(
					Type.String({
						description:
							"Coin type, defaults to 0x2::sui::SUI (e.g. 0x2::sui::SUI)",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override Sui JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const owner = resolveSuiOwnerAddress(params.owner);
				const network = parseSuiNetwork(params.network);
				const requestedCoinType = params.coinType?.trim();
				if (requestedCoinType) {
					const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
					const client = getSuiClient(network, params.rpcUrl);
					const balance = await client.getBalance({
						owner,
						coinType: requestedCoinType,
					});
					const coinType =
						balance.coinType || requestedCoinType || SUI_COIN_TYPE;
					const totalBalance = balance.totalBalance;
					const uiAmount =
						coinType === SUI_COIN_TYPE
							? formatCoinAmount(totalBalance, 9)
							: null;

					const text =
						coinType === SUI_COIN_TYPE
							? `Balance: ${uiAmount} SUI (${totalBalance} MIST)`
							: `Balance: ${totalBalance} (${coinType})`;

					return {
						content: [{ type: "text", text }],
						details: {
							owner,
							coinType,
							totalBalance,
							uiAmount,
							coinObjectCount: balance.coinObjectCount,
							lockedBalance: balance.lockedBalance,
							network,
							rpcUrl,
							mode: "singleCoin",
						},
					};
				}

				const { rpcUrl, portfolio } = await buildPortfolioSummary({
					owner,
					network,
					rpcUrl: params.rpcUrl,
					includeZeroBalances: false,
					includeMetadata: true,
					limit: 50,
				});
				const previewAssets = portfolio.assets.slice(0, HUMAN_READABLE_LIMIT);
				const lines = [
					`Balances (${network}) for ${owner}: ${portfolio.assetCount} asset(s)`,
				];

				for (const [index, asset] of previewAssets.entries()) {
					const symbol =
						asset.metadata?.symbol || fallbackCoinSymbol(asset.coinType);
					if (asset.uiAmount) {
						lines.push(
							`${index + 1}. ${symbol}: ${asset.uiAmount} (${asset.totalBalance} raw)`,
						);
						continue;
					}
					lines.push(
						`${index + 1}. ${shortCoinType(asset.coinType)}: ${asset.totalBalance}`,
					);
				}
				if (portfolio.assetCount > previewAssets.length) {
					lines.push(
						`... and ${portfolio.assetCount - previewAssets.length} more asset(s)`,
					);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						owner,
						network,
						rpcUrl,
						mode: "allAssets",
						...portfolio,
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}getSwapQuote`,
			label: "Sui Get Swap Quote",
			description:
				"Get Sui swap quote via Cetus aggregator (mainnet/testnet), with route/provider details",
			parameters: Type.Object({
				fromCoinType: Type.String({
					description: "Input coin type, e.g. 0x2::sui::SUI",
				}),
				toCoinType: Type.String({
					description: "Output coin type, e.g. 0x...::usdc::USDC",
				}),
				amountRaw: Type.String({
					description: "Raw integer amount (u64-style string)",
				}),
				byAmountIn: Type.Optional(
					Type.Boolean({
						description:
							"true=fixed input amount (default), false=fixed output amount",
					}),
				),
				providers: Type.Optional(
					Type.Array(
						Type.String({
							description:
								"Optional provider filter (e.g. CETUS, TURBOS, DEEPBOOKV3)",
						}),
						{ minItems: 1, maxItems: 50 },
					),
				),
				depth: Type.Optional(
					Type.Number({
						description: "Optional route search depth",
						minimum: 1,
						maximum: 8,
					}),
				),
				network: suiNetworkSchema(),
				endpoint: Type.Optional(
					Type.String({
						description:
							"Optional Cetus aggregator endpoint override (defaults to SDK endpoint)",
					}),
				),
				apiKey: Type.Optional(
					Type.String({
						description:
							"Optional API key (falls back to CETUS_AGGREGATOR_API_KEY env)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseSuiNetwork(params.network);
				const env = resolveAggregatorEnv(network);
				const amountRaw = parsePositiveBigInt(params.amountRaw, "amountRaw");
				const byAmountIn = params.byAmountIn !== false;
				const endpoint = params.endpoint?.trim() || undefined;
				const apiKey =
					params.apiKey?.trim() || process.env.CETUS_AGGREGATOR_API_KEY?.trim();
				const quoteClient = new AggregatorClient({
					env,
					endpoint,
					apiKey,
				});

				const route = await quoteClient.findRouters({
					from: params.fromCoinType.trim(),
					target: params.toCoinType.trim(),
					amount: amountRaw.toString(),
					byAmountIn,
					providers: params.providers?.length ? params.providers : undefined,
					depth: params.depth,
				});

				if (!route || route.insufficientLiquidity || route.paths.length === 0) {
					const errorMessage = route?.error
						? `${route.error.code}: ${route.error.msg}`
						: "No route found";
					return {
						content: [
							{
								type: "text",
								text: `No swap quote available (${errorMessage})`,
							},
						],
						details: {
							network,
							env,
							endpoint: endpoint ?? null,
							fromCoinType: params.fromCoinType.trim(),
							toCoinType: params.toCoinType.trim(),
							amountRaw: amountRaw.toString(),
							byAmountIn,
							insufficientLiquidity: route?.insufficientLiquidity ?? true,
							error: route?.error ?? null,
							pathCount: route?.paths.length ?? 0,
						},
					};
				}

				const amountIn = route.amountIn.toString();
				const amountOut = route.amountOut.toString();
				const routes = route.paths.map((path) => ({
					id: path.id,
					provider: path.provider,
					from: path.from,
					to: path.target,
					amountIn: path.amountIn,
					amountOut: path.amountOut,
					feeRate: path.feeRate,
					version: path.version ?? null,
					publishedAt: path.publishedAt ?? null,
				}));

				return {
					content: [
						{
							type: "text",
							text: `Swap quote: in=${amountIn} out=${amountOut} via ${routes.length} path(s)`,
						},
					],
					details: {
						network,
						env,
						endpoint: endpoint ?? null,
						fromCoinType: params.fromCoinType.trim(),
						toCoinType: params.toCoinType.trim(),
						requestAmountRaw: amountRaw.toString(),
						byAmountIn,
						amountIn,
						amountOut,
						insufficientLiquidity: false,
						deviationRatio: route.deviationRatio,
						overlayFee: route.overlayFee ?? null,
						quoteId: route.quoteID ?? null,
						pathCount: routes.length,
						routes,
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}getStableLayerSupply`,
			label: "Sui Get Stable Layer Supply",
			description:
				"Get Stable Layer total supply and optional per-stable-coin supply (mainnet/testnet)",
			parameters: Type.Object({
				stableCoinType: Type.Optional(
					Type.String({
						description:
							"Stable Layer coin type, e.g. 0x...::btc_usdc::BtcUSDC",
					}),
				),
				network: suiNetworkSchema(),
				sender: Type.Optional(
					Type.String({
						description:
							"Optional sender address used for SDK initialization (read-only call)",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiStableLayerSupplyParams;
				const network = parseSuiNetwork(params.network);
				const stableLayerNetwork = resolveStableLayerNetwork(network);
				const stableCoinType = params.stableCoinType?.trim() || undefined;
				const sender = params.sender?.trim() || undefined;
				const supply = await getStableLayerSupply({
					network: stableLayerNetwork,
					stableCoinType,
					sender,
				});

				const lines = [
					`Stable Layer total supply: ${supply.totalSupply ?? "unknown"}`,
				];
				if (stableCoinType) {
					lines.push(
						`${stableCoinType} supply: ${supply.coinTypeSupply ?? "unknown"}`,
					);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						network,
						stableLayerNetwork,
						stableCoinType: stableCoinType ?? null,
						totalSupply: supply.totalSupply,
						coinTypeSupply: supply.coinTypeSupply,
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}getCetusFarmsPools`,
			label: "Sui Get Cetus Farms Pools",
			description:
				"Get Cetus v2 farms pool list from SDK (mainnet/testnet only).",
			parameters: Type.Object({
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({
						description: "Optional fullnode URL override passed to Cetus SDK",
					}),
				),
				limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiCetusFarmsPoolsParams;
				const network = parseSuiNetwork(params.network);
				const cetusNetwork = resolveCetusV2Network(network);
				const limit =
					typeof params.limit === "number"
						? Math.max(1, Math.min(200, Math.floor(params.limit)))
						: 50;
				const result = await getCetusFarmsPools({
					network: cetusNetwork,
					rpcUrl: params.rpcUrl?.trim(),
				});
				const pairMap = await resolveCetusPoolPairMap({
					network,
					rpcUrl: params.rpcUrl?.trim(),
					clmmPoolIds: result.pools
						.slice(0, limit)
						.map((pool) => pool.clmm_pool_id),
				});
				const pools = result.pools.slice(0, limit).map((pool) => {
					const extra = pool as {
						effective_tick_lower?: unknown;
						effective_tick_upper?: unknown;
						total_share?: unknown;
					};
					const pair = pairMap.get(pool.clmm_pool_id);
					return {
						poolId: pool.id,
						clmmPoolId: pool.clmm_pool_id,
						pairSymbol: pair?.pairSymbol ?? null,
						coinTypeA: pair?.coinTypeA ?? null,
						coinTypeB: pair?.coinTypeB ?? null,
						rewarderCount: Array.isArray(pool.rewarders)
							? pool.rewarders.length
							: 0,
						effectiveTickLower:
							typeof extra.effective_tick_lower === "number"
								? extra.effective_tick_lower
								: null,
						effectiveTickUpper:
							typeof extra.effective_tick_upper === "number"
								? extra.effective_tick_upper
								: null,
						totalShare:
							typeof extra.total_share === "string" ? extra.total_share : null,
					} satisfies CetusFarmsPoolSummary;
				});
				const summaryText = formatCetusPoolsText({
					network,
					pools,
					hasNextPage: result.hasNextPage,
					nextCursor: result.nextCursor,
				});
				return {
					content: [
						{
							type: "text",
							text: summaryText,
						},
					],
					details: {
						network,
						cetusNetwork,
						poolCount: pools.length,
						hasNextPage: result.hasNextPage,
						nextCursor: result.nextCursor,
						pools,
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}getCetusFarmsPositions`,
			label: "Sui Get Cetus Farms Positions",
			description:
				"Get owner Cetus v2 farms staked positions from SDK (mainnet/testnet only).",
			parameters: Type.Object({
				owner: Type.Optional(
					Type.String({
						description:
							"Sui wallet/account address. Optional: defaults to local active wallet",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({
						description: "Optional fullnode URL override passed to Cetus SDK",
					}),
				),
				calculateRewards: Type.Optional(
					Type.Boolean({
						description: "Whether to include calculated farming rewards",
					}),
				),
				limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiCetusFarmsPositionsParams;
				const owner = resolveSuiOwnerAddress(params.owner);
				const network = parseSuiNetwork(params.network);
				const cetusNetwork = resolveCetusV2Network(network);
				const limit =
					typeof params.limit === "number"
						? Math.max(1, Math.min(200, Math.floor(params.limit)))
						: 50;
				const result = await getCetusFarmsPositions({
					network: cetusNetwork,
					rpcUrl: params.rpcUrl?.trim(),
					owner,
					calculateRewards: params.calculateRewards !== false,
				});
				const positions = result.positions.slice(0, limit).map(
					(position) =>
						({
							positionNftId: position.id,
							poolId: position.pool_id,
							clmmPositionId: position.clmm_position_id ?? null,
							clmmPoolId: position.clmm_pool_id ?? null,
							rewardCount: Array.isArray(position.rewards)
								? position.rewards.length
								: 0,
						}) satisfies CetusFarmsPositionSummary,
				);
				const summaryText = formatCetusPositionsText({
					owner,
					network,
					positions,
					hasNextPage: result.hasNextPage,
					nextCursor: result.nextCursor,
				});
				return {
					content: [
						{
							type: "text",
							text: summaryText,
						},
					],
					details: {
						owner,
						network,
						cetusNetwork,
						positionCount: positions.length,
						hasNextPage: result.hasNextPage,
						nextCursor: result.nextCursor,
						positions,
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}getCetusVaultsBalances`,
			label: "Sui Get Cetus Vaults Balances",
			description:
				"Get owner Cetus v2 vault balances from SDK (mainnet/testnet only).",
			parameters: Type.Object({
				owner: Type.Optional(
					Type.String({
						description:
							"Sui wallet/account address. Optional: defaults to local active wallet",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({
						description: "Optional fullnode URL override passed to Cetus SDK",
					}),
				),
				limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiCetusVaultsBalancesParams;
				const owner = resolveSuiOwnerAddress(params.owner);
				const network = parseSuiNetwork(params.network);
				const cetusNetwork = resolveCetusV2Network(network);
				const limit =
					typeof params.limit === "number"
						? Math.max(1, Math.min(200, Math.floor(params.limit)))
						: 50;
				const balances = await getCetusVaultsBalances({
					network: cetusNetwork,
					rpcUrl: params.rpcUrl?.trim(),
					owner,
				});
				const items = balances.slice(0, limit).map(
					(entry) =>
						({
							vaultId: entry.vault_id ?? null,
							clmmPoolId: entry.clmm_pool_id ?? null,
							lpTokenBalance: entry.lp_token_balance ?? null,
						}) satisfies CetusVaultBalanceSummary,
				);
				const summaryText = formatCetusVaultBalancesText({
					owner,
					network,
					balances: items,
				});
				return {
					content: [
						{
							type: "text",
							text: summaryText,
						},
					],
					details: {
						owner,
						network,
						cetusNetwork,
						vaultCount: items.length,
						balances: items,
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}getDefiPositions`,
			label: "Sui Get DeFi Positions",
			description:
				"Get owner DeFi position snapshot on Sui: portfolio + Cetus farms/vault positions (mainnet/testnet only for Cetus).",
			parameters: Type.Object({
				owner: Type.Optional(
					Type.String({
						description:
							"Sui wallet/account address. Optional: defaults to local active wallet",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override Sui JSON-RPC endpoint URL" }),
				),
				limit: Type.Optional(
					Type.Number({
						description:
							"Max number of assets returned after sorting by balance",
						minimum: 1,
						maximum: 200,
					}),
				),
				includeZeroBalances: Type.Optional(
					Type.Boolean({
						description: "Include zero-balance assets (default false)",
					}),
				),
				includeMetadata: Type.Optional(
					Type.Boolean({
						description:
							"Fetch coin metadata (symbol/decimals/name) (default true)",
					}),
				),
				includeCetusFarms: Type.Optional(
					Type.Boolean({
						description: "Include Cetus farms staked positions (default true)",
					}),
				),
				includeCetusVaults: Type.Optional(
					Type.Boolean({
						description: "Include Cetus vault LP balances (default true)",
					}),
				),
				calculateFarmsRewards: Type.Optional(
					Type.Boolean({
						description: "Whether to include calculated farms rewards",
					}),
				),
				farmsLimit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
				vaultLimit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiDefiPositionsParams;
				const owner = resolveSuiOwnerAddress(params.owner);
				const network = parseSuiNetwork(params.network);
				const { rpcUrl, portfolio } = await buildPortfolioSummary({
					owner,
					network,
					rpcUrl: params.rpcUrl,
					limit: params.limit,
					includeZeroBalances: params.includeZeroBalances,
					includeMetadata: params.includeMetadata,
				});

				const includeCetusFarms = params.includeCetusFarms !== false;
				const includeCetusVaults = params.includeCetusVaults !== false;
				const farmsLimit = clampLimit(params.farmsLimit, 50);
				const vaultLimit = clampLimit(params.vaultLimit, 50);

				let cetusNetwork: "mainnet" | "testnet" | null = null;
				let cetusError: string | null = null;
				let farmsData: Awaited<
					ReturnType<typeof getCetusFarmsPositions>
				> | null = null;
				let vaultsData: Awaited<
					ReturnType<typeof getCetusVaultsBalances>
				> | null = null;

				if (includeCetusFarms || includeCetusVaults) {
					try {
						cetusNetwork = resolveCetusV2Network(network);
						const [farmsResult, vaultsResult] = await Promise.all([
							includeCetusFarms
								? getCetusFarmsPositions({
										network: cetusNetwork,
										rpcUrl: params.rpcUrl?.trim(),
										owner,
										calculateRewards: params.calculateFarmsRewards !== false,
									})
								: Promise.resolve(null),
							includeCetusVaults
								? getCetusVaultsBalances({
										network: cetusNetwork,
										rpcUrl: params.rpcUrl?.trim(),
										owner,
									})
								: Promise.resolve(null),
						]);
						farmsData = farmsResult;
						vaultsData = vaultsResult;
					} catch (error) {
						cetusError =
							error instanceof Error ? error.message : "Unknown Cetus error";
					}
				}

				const farmsPositions = (farmsData?.positions ?? [])
					.slice(0, farmsLimit)
					.map((position) => ({
						positionNftId: position.id,
						poolId: position.pool_id,
						clmmPositionId: position.clmm_position_id ?? null,
						clmmPoolId: position.clmm_pool_id ?? null,
						rewardCount: Array.isArray(position.rewards)
							? position.rewards.length
							: 0,
					}));
				const vaultBalances = (vaultsData ?? [])
					.slice(0, vaultLimit)
					.map((entry) => ({
						vaultId: entry.vault_id ?? null,
						clmmPoolId: entry.clmm_pool_id ?? null,
						lpTokenBalance: entry.lp_token_balance ?? null,
					}));
				const summary = `DeFi positions: assets=${portfolio.assetCount} farms=${farmsPositions.length} vaults=${vaultBalances.length}`;

				return {
					content: [{ type: "text", text: summary }],
					details: {
						owner,
						network,
						rpcUrl,
						portfolio,
						defi: {
							cetusNetwork,
							cetusError,
							farms: {
								enabled: includeCetusFarms,
								positionCount: farmsPositions.length,
								hasNextPage: farmsData?.hasNextPage ?? false,
								nextCursor: farmsData?.nextCursor ?? null,
								positions: farmsPositions,
							},
							vaults: {
								enabled: includeCetusVaults,
								vaultCount: vaultBalances.length,
								balances: vaultBalances,
							},
						},
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}getPortfolio`,
			label: "Sui Get Portfolio",
			description:
				"Get aggregated multi-asset balances for a Sui owner, with optional coin metadata",
			parameters: Type.Object({
				owner: Type.Optional(
					Type.String({
						description:
							"Sui wallet/account address. Optional: defaults to local active wallet",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override Sui JSON-RPC endpoint URL" }),
				),
				limit: Type.Optional(
					Type.Number({
						description:
							"Max number of assets returned after sorting by balance",
						minimum: 1,
						maximum: 200,
					}),
				),
				includeZeroBalances: Type.Optional(
					Type.Boolean({
						description: "Include zero-balance assets (default false)",
					}),
				),
				includeMetadata: Type.Optional(
					Type.Boolean({
						description:
							"Fetch coin metadata (symbol/decimals/name) (default true)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const owner = resolveSuiOwnerAddress(params.owner);
				const network = parseSuiNetwork(params.network);
				const { rpcUrl, portfolio } = await buildPortfolioSummary({
					owner,
					network,
					rpcUrl: params.rpcUrl,
					limit: params.limit,
					includeZeroBalances: params.includeZeroBalances,
					includeMetadata: params.includeMetadata,
				});
				const previewAssets = portfolio.assets.slice(0, HUMAN_READABLE_LIMIT);
				const lines = [
					`Portfolio (${network}) for ${owner}: ${portfolio.assetCount} asset(s)`,
				];

				for (const [index, asset] of previewAssets.entries()) {
					const symbol =
						asset.metadata?.symbol || fallbackCoinSymbol(asset.coinType);
					if (asset.uiAmount) {
						lines.push(
							`${index + 1}. ${symbol}: ${asset.uiAmount} (${asset.totalBalance} raw)`,
						);
						continue;
					}
					lines.push(
						`${index + 1}. ${shortCoinType(asset.coinType)}: ${asset.totalBalance}`,
					);
				}
				if (portfolio.assetCount > previewAssets.length) {
					lines.push(
						`... and ${portfolio.assetCount - previewAssets.length} more asset(s)`,
					);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						owner,
						network,
						rpcUrl,
						...portfolio,
					},
				};
			},
		}),
	];
}
