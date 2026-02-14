import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	getPolymarketOrderBook,
	parseUsdStake,
	resolveBtc5mTradeSelection,
} from "../polymarket.js";
import {
	EVM_TOOL_PREFIX,
	evmNetworkSchema,
	parseEvmNetwork,
} from "../runtime.js";

export function createEvmComposeTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketBuildBtc5mOrder`,
			label: "EVM Build BTC 5m Order",
			description:
				"Build an unsigned BTC 5m Polymarket order intent (no signing, no broadcast).",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				marketSlug: Type.Optional(Type.String()),
				side: Type.Optional(
					Type.Union([Type.Literal("up"), Type.Literal("down")]),
				),
				stakeUsd: Type.Number({
					description: "Order size in USDC/USD notional",
					minimum: 0.01,
				}),
				maxEntryPrice: Type.Optional(
					Type.Number({
						description: "Max acceptable entry price per share (0~1)",
						minimum: 0.001,
						maximum: 0.999,
					}),
				),
				useAiAssist: Type.Optional(
					Type.Boolean({
						description:
							"Use AI-style heuristic to auto-pick side when side is omitted (default true)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const trade = await resolveBtc5mTradeSelection({
					marketSlug: params.marketSlug,
					side: params.side,
					useAiAssist: params.useAiAssist,
				});
				const orderbook = await getPolymarketOrderBook(trade.tokenId);
				const bestAsk = orderbook.bestAsk?.price ?? null;
				if (bestAsk == null) {
					throw new Error(
						`No ask liquidity for token=${trade.tokenId}; cannot build BUY order intent`,
					);
				}
				if (params.maxEntryPrice != null && bestAsk > params.maxEntryPrice) {
					throw new Error(
						`bestAsk ${bestAsk} exceeds maxEntryPrice ${params.maxEntryPrice}`,
					);
				}
				const stakeUsd = parseUsdStake(params.stakeUsd);
				const estimatedShares = stakeUsd / bestAsk;
				const text = `Built BTC 5m order intent (${network}): market=${trade.market.slug} side=${trade.side} token=${trade.tokenId} entry=${bestAsk} stakeUsd=${stakeUsd} shares~=${estimatedShares.toFixed(4)}`;
				return {
					content: [{ type: "text", text }],
					details: {
						network,
						orderIntent: {
							intentType: "evm.polymarket.btc5m.buy",
							marketSlug: trade.market.slug,
							side: trade.side,
							tokenId: trade.tokenId,
							entryPrice: bestAsk,
							stakeUsd,
							estimatedShares,
							maxEntryPrice: params.maxEntryPrice ?? null,
						},
						advice: trade.advice,
						market: trade.market,
					},
				};
			},
		}),
	];
}
