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
	evmNetworkSchema,
	parseEvmNetwork,
} from "../runtime.js";
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
		entries.push({
			symbol,
			decimals: metadata.decimals,
			addresses: { [params.network]: address },
		});
	}
	return entries;
}

export function createEvmReadTools() {
	return [
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
	];
}
