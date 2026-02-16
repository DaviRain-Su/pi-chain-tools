import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	getPolymarketBtc5mAdvice,
	getPolymarketBtc5mMarkets,
	getPolymarketGeoblockStatus,
	getPolymarketMarketBySlug,
	getPolymarketOrderBook,
	searchPolymarketEvents,
} from "../polymarket.js";
import {
	EVM_TOOL_PREFIX,
	type EvmNetwork,
	evmHttpJson,
	evmNetworkSchema,
	parseEvmNetwork,
} from "../runtime.js";
import {
	type PancakeV2ConfigStatus,
	getPancakeV2ConfigStatus,
} from "./execute.js";
import {
	EVM_TRANSFER_TOKEN_DECIMALS_ENV,
	EVM_TRANSFER_TOKEN_MAP_ENV,
	EVM_TRANSFER_TOKEN_MAP_ENV_BY_NETWORK,
	type TokenSymbolMetadata,
	resolveTokenMetadataBySymbol,
} from "./transfer-workflow.js";

function shortId(value: string): string {
	if (value.length <= 16) return value;
	return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function toOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function toNormalizedAddress(value: string): string {
	return value.trim().toLowerCase();
}

function toOptionalNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value.trim());
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function maskAddress(value: string): string {
	if (value.length <= 12) return value;
	return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function summarizePancakeV2ConfigText(status: PancakeV2ConfigStatus): string {
	const cfg = status.config;
	const chainId = cfg?.chainId ?? "n/a";
	if (cfg) {
		return `PancakeV2 config ${status.network}: source=${status.source} configured=yes chainId=${chainId} factory=${maskAddress(cfg.factoryAddress)} router=${maskAddress(cfg.routerAddress)} wrappedNative=${maskAddress(cfg.wrappedNativeAddress)}`;
	}
	const issue = status.issues[0] ?? "not configured";
	return `PancakeV2 config ${status.network}: source=${status.source} configured=no issue=${issue}`;
}

const EVM_NETWORKS_FOR_CONFIG_CHECK: EvmNetwork[] = [
	"ethereum",
	"sepolia",
	"polygon",
	"base",
	"arbitrum",
	"optimism",
	"bsc",
];

type DexscreenerToken = {
	address?: string;
	symbol?: string;
	name?: string;
};

type DexscreenerPair = {
	chainId: string;
	pairAddress: string;
	dexId?: string;
	url?: string;
	labels?: string[];
	baseToken?: DexscreenerToken;
	quoteToken?: DexscreenerToken;
	priceNative?: string;
	priceUsd?: string;
	liquidity?: { usd?: string | number };
	volume?: {
		h24?: string | number;
		h6?: string | number;
		h1?: string | number;
		m5?: string | number;
	};
};

function parseDexscreenerPair(value: unknown): DexscreenerPair | null {
	if (!isRecord(value)) return null;
	const chainId = toOptionalString(value.chainId);
	const pairAddress = toOptionalString(value.pairAddress);
	if (!chainId || !pairAddress) return null;
	const baseToken = isRecord(value.baseToken)
		? {
				address: toOptionalString(value.baseToken.address),
				symbol: toOptionalString(value.baseToken.symbol),
				name: toOptionalString(value.baseToken.name),
			}
		: undefined;
	const quoteToken = isRecord(value.quoteToken)
		? {
				address: toOptionalString(value.quoteToken.address),
				symbol: toOptionalString(value.quoteToken.symbol),
				name: toOptionalString(value.quoteToken.name),
			}
		: undefined;
	return {
		chainId,
		pairAddress,
		dexId: toOptionalString(value.dexId),
		url: toOptionalString(value.url),
		labels: Array.isArray(value.labels)
			? value.labels
					.filter((entry): entry is string => typeof entry === "string")
					.map((entry) => entry.trim())
					.filter(Boolean)
			: undefined,
		baseToken,
		quoteToken,
		priceNative: toOptionalString(value.priceNative),
		priceUsd: toOptionalString(value.priceUsd),
		liquidity: isRecord(value.liquidity)
			? {
					usd: value.liquidity.usd as string | number | undefined,
				}
			: undefined,
		volume: isRecord(value.volume)
			? {
					h24: value.volume.h24 as string | number | undefined,
					h6: value.volume.h6 as string | number | undefined,
					h1: value.volume.h1 as string | number | undefined,
					m5: value.volume.m5 as string | number | undefined,
				}
			: undefined,
	};
}

function extractDexscreenerPairs(value: unknown): DexscreenerPair[] {
	if (!isRecord(value)) return [];
	const rawPairs = value.pairs;
	if (!Array.isArray(rawPairs)) return [];
	const parsed: DexscreenerPair[] = [];
	for (const rawPair of rawPairs) {
		const pair = parseDexscreenerPair(rawPair);
		if (pair) parsed.push(pair);
	}
	return parsed;
}

function dexscreenerPairLiquidity(pair: DexscreenerPair): number {
	return toOptionalNumber(pair.liquidity?.usd) ?? 0;
}

function matchesAddressInPair(
	pair: DexscreenerPair,
	normalizedToken: string,
): boolean {
	const baseAddress = toOptionalString(pair.baseToken?.address);
	const quoteAddress = toOptionalString(pair.quoteToken?.address);
	return (
		(baseAddress != null &&
			toNormalizedAddress(baseAddress) === normalizedToken) ||
		(quoteAddress != null &&
			toNormalizedAddress(quoteAddress) === normalizedToken)
	);
}

function summarizeDexscreenerPairsText(params: {
	network: string;
	query: string;
	pairs: DexscreenerPair[];
	dexId?: string;
	limit: number;
}): string {
	const dexText = params.dexId ? ` dexId=${params.dexId}` : "";
	const lines = [
		`DexScreener pairs (${params.network}${dexText}): query="${params.query}", shown=${params.pairs.length}`,
	];
	if (params.pairs.length === 0) {
		lines.push("No matching pair found.");
		return lines.join("\n");
	}
	for (const [index, pair] of params.pairs.entries()) {
		const pairLabel =
			pair.baseToken?.symbol && pair.quoteToken?.symbol
				? `${pair.baseToken.symbol}/${pair.quoteToken.symbol}`
				: pair.pairAddress;
		lines.push(
			`${index + 1}. ${pairLabel} @ ${pair.dexId ?? "dex"} (${pair.chainId}) liq=${pair.liquidity?.usd ?? "n/a"} usd=${pair.priceUsd ?? "n/a"} vol24h=${pair.volume?.h24 ?? "n/a"} ${pair.url ?? pair.pairAddress}`,
		);
	}
	if (params.pairs.length > params.limit) {
		lines.push(`... truncated to ${params.limit}`);
	}
	return lines.join("\n");
}

function summarizeDexscreenerTokenPairsText(params: {
	network: string;
	tokenAddress: string;
	pairs: DexscreenerPair[];
	dexId?: string;
	limit: number;
}): string {
	const dexText = params.dexId ? ` dexId=${params.dexId}` : "";
	const lines = [
		`DexScreener token pairs (${params.network}${dexText}): token=${params.tokenAddress}, shown=${params.pairs.length}`,
	];
	if (params.pairs.length === 0) {
		lines.push("No matching pair found.");
		return lines.join("\n");
	}
	for (const [index, pair] of params.pairs.entries()) {
		const pairLabel =
			pair.baseToken?.symbol && pair.quoteToken?.symbol
				? `${pair.baseToken.symbol}/${pair.quoteToken.symbol}`
				: pair.pairAddress;
		lines.push(
			`${index + 1}. ${pairLabel} @ ${pair.dexId ?? "dex"} (${pair.chainId}) liq=${pair.liquidity?.usd ?? "n/a"} usd=${pair.priceUsd ?? "n/a"} ${pair.url ?? pair.pairAddress}`,
		);
	}
	if (params.pairs.length > params.limit) {
		lines.push(`... truncated to ${params.limit}`);
	}
	return lines.join("\n");
}

function summarizeBtc5mMarketsText(
	network: string,
	markets: Awaited<ReturnType<typeof getPolymarketBtc5mMarkets>>,
): string {
	const lines = [
		`Polymarket BTC 5m markets (${network}): ${markets.length} market(s)`,
	];
	if (markets.length === 0) {
		lines.push("No active BTC 5m market found.");
		return lines.join("\n");
	}
	for (const [index, market] of markets.entries()) {
		const upLeg = market.legs.find((leg) => /^(up|yes)$/i.test(leg.outcome));
		const downLeg = market.legs.find((leg) => /^(down|no)$/i.test(leg.outcome));
		lines.push(
			`${index + 1}. ${market.question} (${market.slug}) volume24h=${market.volume24hr ?? "n/a"}`,
		);
		lines.push(
			`   up=${upLeg?.price ?? "n/a"} down=${downLeg?.price ?? "n/a"} tokenUp=${upLeg?.tokenId ? shortId(upLeg.tokenId) : "n/a"} tokenDown=${downLeg?.tokenId ? shortId(downLeg.tokenId) : "n/a"}`,
		);
	}
	return lines.join("\n");
}

function normalizeTokenSymbolFilter(value?: string): string | undefined {
	if (!value?.trim()) return undefined;
	const normalized = value
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");
	if (normalized === "USDCE") return "USDC";
	return normalized;
}

function summarizeTransferTokenMapText(params: {
	network?: EvmNetwork;
	symbolFilter?: string;
	entries: Array<{
		symbol: string;
		decimals: number;
		addresses: Partial<Record<EvmNetwork, string>>;
	}>;
	includeAddresses: boolean;
}): string {
	const scope = params.network ? `network=${params.network}` : "all networks";
	const symbolText = params.symbolFilter
		? ` symbol=${params.symbolFilter}`
		: "";
	const lines = [
		`EVM transfer token map (${scope}${symbolText}): ${params.entries.length} symbol(s)`,
	];
	if (params.entries.length === 0) {
		lines.push("No symbol mapping matched current filters.");
		return lines.join("\n");
	}
	for (const [index, entry] of params.entries.entries()) {
		const networks = Object.keys(entry.addresses);
		lines.push(
			`${index + 1}. ${entry.symbol} decimals=${entry.decimals} networks=${networks.length ? networks.join(",") : "(none)"}`,
		);
		if (params.includeAddresses) {
			for (const network of networks) {
				lines.push(
					`   ${network}: ${entry.addresses[network as EvmNetwork] ?? "(none)"}`,
				);
			}
		}
	}
	return lines.join("\n");
}

function filterTokenMapEntries(params: {
	metadataBySymbol: Record<string, TokenSymbolMetadata>;
	network?: EvmNetwork;
	symbolFilter?: string;
}): Array<{
	symbol: string;
	decimals: number;
	addresses: Partial<Record<EvmNetwork, string>>;
}> {
	const symbols = Object.keys(params.metadataBySymbol)
		.filter((symbol) =>
			params.symbolFilter ? symbol === params.symbolFilter : true,
		)
		.sort();
	const entries: Array<{
		symbol: string;
		decimals: number;
		addresses: Partial<Record<EvmNetwork, string>>;
	}> = [];
	for (const symbol of symbols) {
		const metadata = params.metadataBySymbol[symbol];
		if (!metadata) continue;
		if (!params.network) {
			entries.push({
				symbol,
				decimals: metadata.decimals,
				addresses: { ...metadata.addresses },
			});
			continue;
		}
		const address = metadata.addresses[params.network];
		if (!address) continue;
		const networkDecimals =
			metadata.decimalsByNetwork?.[params.network] ?? metadata.decimals;
		entries.push({
			symbol,
			decimals: networkDecimals,
			addresses: { [params.network]: address },
		});
	}
	return entries;
}

export function createEvmReadTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}getPancakeV2Config`,
			label: "EVM Get PancakeV2 Config",
			description:
				"Read PancakeSwap V2 routing config resolution status for one or all EVM networks (env override or built-in fallback).",
			parameters: Type.Object({
				network: Type.Optional(evmNetworkSchema()),
				all: Type.Optional(
					Type.Boolean({
						description:
							"Return all known network statuses when true or when network is omitted; default false means only requested network.",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const requestedNetwork = params.network
					? parseEvmNetwork(params.network)
					: undefined;
				const includeAll = Boolean(params.all) || !requestedNetwork;
				const targetNetworks = includeAll
					? EVM_NETWORKS_FOR_CONFIG_CHECK
					: [requestedNetwork];
				const statuses = targetNetworks.map((network) =>
					getPancakeV2ConfigStatus(network),
				);
				const text = statuses.map(summarizePancakeV2ConfigText).join("\n");
				return {
					content: [{ type: "text", text }],
					details: {
						schema: "evm.pancakev2.config.v1",
						networks: statuses,
						allRequested: includeAll,
						targetNetwork: requestedNetwork ?? null,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}getTransferTokenMap`,
			label: "EVM Get Transfer Token Map",
			description:
				"Read effective symbol->address/decimals mapping used by EVM transfer workflow (includes env overrides).",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				symbol: Type.Optional(Type.String()),
				includeAddresses: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const network = params.network
					? parseEvmNetwork(params.network)
					: undefined;
				const symbolFilter = normalizeTokenSymbolFilter(params.symbol);
				const metadataBySymbol = resolveTokenMetadataBySymbol();
				const entries = filterTokenMapEntries({
					metadataBySymbol,
					network,
					symbolFilter,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeTransferTokenMapText({
								network,
								symbolFilter,
								entries,
								includeAddresses: params.includeAddresses !== false,
							}),
						},
					],
					details: {
						schema: "evm.transfer.token-map.v1",
						network: network ?? null,
						symbol: symbolFilter ?? null,
						env: {
							globalMapKey: EVM_TRANSFER_TOKEN_MAP_ENV,
							decimalsKey: EVM_TRANSFER_TOKEN_DECIMALS_ENV,
							networkMapKeys: EVM_TRANSFER_TOKEN_MAP_ENV_BY_NETWORK,
						},
						symbols: entries,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketSearchMarkets`,
			label: "EVM Polymarket Search Markets",
			description:
				"Search Polymarket events/markets via Gamma public-search API.",
			parameters: Type.Object({
				query: Type.String({ description: "Search keywords, e.g. bitcoin" }),
				network: evmNetworkSchema(),
				limitPerType: Type.Optional(
					Type.Number({ minimum: 1, maximum: 200, default: 50 }),
				),
				page: Type.Optional(
					Type.Number({ minimum: 1, maximum: 100, default: 1 }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const events = await searchPolymarketEvents({
					query: params.query.trim(),
					limitPerType: params.limitPerType,
					page: params.page,
					eventsStatus: "active",
					keepClosedMarkets: false,
				});
				const marketCount = events.reduce(
					(sum, event) => sum + event.markets.length,
					0,
				);
				const preview = events.slice(0, 8);
				const lines = [
					`Polymarket search (${network}): events=${events.length} markets=${marketCount}`,
				];
				for (const [index, event] of preview.entries()) {
					lines.push(
						`${index + 1}. ${event.title || event.slug} (${event.slug}) markets=${event.markets.length}`,
					);
				}
				if (events.length > preview.length) {
					lines.push(`... and ${events.length - preview.length} more event(s)`);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						network,
						query: params.query.trim(),
						eventCount: events.length,
						marketCount,
						events,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketGetMarket`,
			label: "EVM Polymarket Get Market",
			description:
				"Get a single Polymarket market by slug with outcomes, prices and tokenIds.",
			parameters: Type.Object({
				slug: Type.String({ description: "Market slug" }),
				network: evmNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const market = await getPolymarketMarketBySlug(params.slug);
				const lines = [
					`Polymarket market (${network}): ${market.slug}`,
					`question: ${market.question}`,
					`active=${market.active} closed=${market.closed} acceptingOrders=${market.acceptingOrders}`,
				];
				for (const [index, leg] of market.legs.entries()) {
					lines.push(
						`${index + 1}. ${leg.outcome}: price=${leg.price ?? "n/a"} tokenId=${leg.tokenId ?? "n/a"}`,
					);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						network,
						market,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketGetBtc5mMarkets`,
			label: "EVM Polymarket BTC 5m Markets",
			description: "List active BTC 5-minute Up/Down markets on Polymarket.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				limit: Type.Optional(
					Type.Number({ minimum: 1, maximum: 50, default: 10 }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const markets = await getPolymarketBtc5mMarkets({
					limit: params.limit,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeBtc5mMarketsText(network, markets),
						},
					],
					details: {
						network,
						marketCount: markets.length,
						markets,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketGetOrderbook`,
			label: "EVM Polymarket Orderbook",
			description:
				"Get orderbook levels for a Polymarket CLOB token_id (asset id).",
			parameters: Type.Object({
				tokenId: Type.String({ description: "CLOB token_id (asset id)" }),
				network: evmNetworkSchema(),
				depth: Type.Optional(
					Type.Number({ minimum: 1, maximum: 100, default: 10 }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const depth = params.depth ?? 10;
				const orderbook = await getPolymarketOrderBook(params.tokenId);
				const bids = orderbook.bids.slice(0, depth);
				const asks = orderbook.asks.slice(0, depth);
				const lines = [
					`Polymarket orderbook (${network}) token=${orderbook.tokenId}`,
					`bestBid=${orderbook.bestBid?.price ?? "n/a"} bestAsk=${orderbook.bestAsk?.price ?? "n/a"} midpoint=${orderbook.midpoint ?? "n/a"}`,
					`levels: bids=${bids.length} asks=${asks.length}`,
				];
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						network,
						orderbook: {
							...orderbook,
							bids,
							asks,
						},
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketGetBtc5mAdvice`,
			label: "EVM Polymarket BTC 5m Advice",
			description:
				"AI-style explainable trade suggestion for BTC 5m market (side/confidence/reasons).",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				marketSlug: Type.Optional(
					Type.String({
						description:
							"Optional specific market slug. If omitted, picks highest-volume active BTC 5m market.",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const advice = await getPolymarketBtc5mAdvice({
					marketSlug: params.marketSlug,
				});
				const lines = [
					`BTC 5m advice (${network}): side=${advice.recommendedSide} confidence=${advice.confidence}`,
					`market=${advice.marketSlug} upProbability=${advice.upProbability}`,
					...advice.reasons.map((reason, index) => `${index + 1}. ${reason}`),
				];
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						network,
						advice,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketGetGeoblock`,
			label: "EVM Polymarket Geoblock",
			description:
				"Check whether current IP is geoblocked by Polymarket web endpoint.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const status = await getPolymarketGeoblockStatus();
				const text = `Polymarket geoblock (${network}): blocked=${status.blocked} country=${status.country ?? "unknown"} region=${status.region ?? "unknown"}`;
				return {
					content: [{ type: "text", text }],
					details: {
						network,
						...status,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}dexscreenerPairs`,
			label: "EVM DexScreener Pair Search",
			description:
				"Search DexScreener pairs by query and optional dex/network filters.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				query: Type.String({
					description: "Search text, token symbol, or pair/address keywords.",
				}),
				dexId: Type.Optional(
					Type.String({
						description:
							"Optional DEX ID filter, e.g. pancakeswap, uniswap, raydium.",
					}),
				),
				limit: Type.Optional(
					Type.Number({
						minimum: 1,
						maximum: 50,
						default: 10,
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network ?? "bsc");
				const query = params.query.trim();
				if (!query) throw new Error("query is required");
				const url = `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(query)}`;
				const payload = await evmHttpJson<unknown>({
					url,
					timeoutMs: 15_000,
				});
				const allPairs = extractDexscreenerPairs(payload);
				const lowerDexId = toOptionalString(params.dexId)?.toLowerCase();
				const limit = params.limit ?? 10;
				const filtered = allPairs
					.filter(
						(pair) =>
							pair.chainId === network &&
							(!lowerDexId || pair.dexId?.toLowerCase() === lowerDexId),
					)
					.sort(
						(a, b) => dexscreenerPairLiquidity(b) - dexscreenerPairLiquidity(a),
					)
					.slice(0, limit);

				return {
					content: [
						{
							type: "text",
							text: summarizeDexscreenerPairsText({
								network,
								query,
								pairs: filtered,
								dexId: lowerDexId,
								limit,
							}),
						},
					],
					details: {
						network,
						query,
						dexId: lowerDexId,
						pairCount: filtered.length,
						pairs: filtered,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}dexscreenerTokenPairs`,
			label: "EVM DexScreener Token Pairs",
			description:
				"Lookup DexScreener pairs for a BSC/ERC token address and optional dex/network filter.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				tokenAddress: Type.String({
					description:
						"Token address in 0x... format (mainly BSC/ERC-20 style).",
				}),
				dexId: Type.Optional(
					Type.String({
						description: "Optional DEX ID filter, e.g. pancakeswap",
					}),
				),
				limit: Type.Optional(
					Type.Number({
						minimum: 1,
						maximum: 50,
						default: 10,
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network ?? "bsc");
				const tokenAddress = params.tokenAddress.trim();
				const normalizedToken = toNormalizedAddress(tokenAddress);
				if (!normalizedToken.startsWith("0x") || normalizedToken.length < 10) {
					throw new Error("tokenAddress must be a valid 0x-style address");
				}
				const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`;
				const payload = await evmHttpJson<unknown>({
					url,
					timeoutMs: 15_000,
				});
				const allPairs = extractDexscreenerPairs(payload);
				const lowerDexId = toOptionalString(params.dexId)?.toLowerCase();
				const limit = params.limit ?? 10;
				const filtered = allPairs
					.filter(
						(pair) =>
							pair.chainId === network &&
							(!lowerDexId || pair.dexId?.toLowerCase() === lowerDexId) &&
							matchesAddressInPair(pair, normalizedToken),
					)
					.sort(
						(a, b) => dexscreenerPairLiquidity(b) - dexscreenerPairLiquidity(a),
					)
					.slice(0, limit);
				return {
					content: [
						{
							type: "text",
							text: summarizeDexscreenerTokenPairsText({
								network,
								tokenAddress,
								pairs: filtered,
								dexId: lowerDexId,
								limit,
							}),
						},
					],
					details: {
						network,
						tokenAddress,
						dexId: lowerDexId,
						pairCount: filtered.length,
						pairs: filtered,
					},
				};
			},
		}),
	];
}
