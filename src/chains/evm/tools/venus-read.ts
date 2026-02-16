/**
 * Venus Protocol read tools — MCP tool wrappers for Venus adapter read operations.
 *
 * - `evm_venusGetMarkets`: list Venus lending markets with live rates
 * - `evm_venusGetPosition`: get account lending position
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	EVM_TOOL_PREFIX,
	evmNetworkSchema,
	parseEvmNetwork,
} from "../runtime.js";
import { createVenusAdapter } from "./venus-adapter.js";

export function createVenusReadTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}venusGetMarkets`,
			label: "Venus Get Markets",
			description:
				"List Venus Protocol lending markets on BSC with live supply/borrow APY, collateral factors, and listing status.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const adapter = createVenusAdapter();
				const markets = await adapter.getMarkets(network);
				return {
					content: [
						{
							type: "text",
							text: `Venus markets on ${network}: ${markets.length} market(s) found.`,
						},
					],
					details: {
						schema: "evm.venus.markets.v1",
						network,
						protocol: "venus",
						marketsCount: markets.length,
						markets: markets.map((m) => ({
							marketAddress: m.marketAddress,
							underlyingSymbol: m.underlyingSymbol,
							underlyingAddress: m.underlyingAddress,
							underlyingDecimals: m.underlyingDecimals,
							supplyAPY: `${m.supplyAPY.toFixed(2)}%`,
							borrowAPY: `${m.borrowAPY.toFixed(2)}%`,
							collateralFactor: `${(m.collateralFactor * 100).toFixed(0)}%`,
							isCollateral: m.isCollateral,
							isListed: m.isListed,
						})),
					},
				};
			},
		}),

		defineTool({
			name: `${EVM_TOOL_PREFIX}venusGetPosition`,
			label: "Venus Get Position",
			description:
				"Get an account's Venus Protocol lending position on BSC: supplies, borrows, LTV, and health factor.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				account: Type.String({
					description: "BSC wallet address",
				}),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const account = params.account.trim();
				if (!/^0x[a-fA-F0-9]{40}$/.test(account)) {
					throw new Error("account must be a valid EVM address");
				}
				const adapter = createVenusAdapter();
				const position = await adapter.getAccountPosition(network, account);
				const ltvPct = `${(position.currentLTV * 100).toFixed(2)}%`;
				const hf =
					position.healthFactor === Number.POSITIVE_INFINITY
						? "∞"
						: position.healthFactor.toFixed(4);

				return {
					content: [
						{
							type: "text",
							text: `Venus position for ${account} on ${network}: ${position.supplies.length} supply, ${position.borrows.length} borrow. LTV=${ltvPct}, HF=${hf}`,
						},
					],
					details: {
						schema: "evm.venus.position.v1",
						network,
						protocol: "venus",
						account,
						supplies: position.supplies.map((s) => ({
							underlyingSymbol: s.underlyingSymbol,
							underlyingAddress: s.underlyingAddress,
							balanceRaw: s.balanceRaw,
							balanceFormatted: s.balanceFormatted,
						})),
						borrows: position.borrows.map((b) => ({
							underlyingSymbol: b.underlyingSymbol,
							underlyingAddress: b.underlyingAddress,
							balanceRaw: b.balanceRaw,
							balanceFormatted: b.balanceFormatted,
						})),
						totalCollateralValueUsd: position.totalCollateralValueUsd,
						totalBorrowValueUsd: position.totalBorrowValueUsd,
						currentLTV: ltvPct,
						liquidationLTV: `${(position.liquidationLTV * 100).toFixed(0)}%`,
						healthFactor: hf,
					},
				};
			},
		}),
	];
}
