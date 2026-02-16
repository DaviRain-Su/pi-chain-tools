/**
 * Morpho Blue read tools — MCP tools for reading Morpho lending markets and positions.
 *
 * Uses Morpho Blue GraphQL API (blue-api.morpho.org) for data reads.
 * Supports Monad mainnet (and any future Morpho Blue deployment).
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	EVM_TOOL_PREFIX,
	evmNetworkSchema,
	parseEvmNetwork,
} from "../runtime.js";
import { createMorphoAdapter } from "./morpho-adapter.js";

export function createMorphoReadTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}morphoGetMarkets`,
			label: "Morpho Blue Markets",
			description:
				"Get Morpho Blue lending markets with APY, TVL, and collateral info. " +
				"Supports Monad mainnet. Markets are ordered by supply TVL descending.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				limit: Type.Optional(
					Type.Number({
						minimum: 1,
						maximum: 50,
						description: "Max markets to return (default 20)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const limit = params.limit ?? 20;
				const adapter = createMorphoAdapter();
				const markets = await adapter.getMarkets(network);
				const limited = markets.slice(0, limit);

				const summary = limited
					.map(
						(m) =>
							`${m.underlyingSymbol}: Supply ${Number(m.totalSupply).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}, ` +
							`Borrow ${Number(m.totalBorrow).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}, ` +
							`SupplyAPY=${m.supplyAPY.toFixed(2)}%, BorrowAPY=${m.borrowAPY.toFixed(2)}%`,
					)
					.join("\n");

				return {
					content: [
						{
							type: "text",
							text: `Morpho Blue markets (${network}): ${limited.length} market(s)\n${summary}`,
						},
					],
					details: {
						schema: "evm.morpho.markets.v1",
						network,
						protocol: "morpho-blue",
						marketCount: limited.length,
						markets: limited,
					},
				};
			},
		}),

		defineTool({
			name: `${EVM_TOOL_PREFIX}morphoGetPosition`,
			label: "Morpho Blue Position",
			description:
				"Get account lending position on Morpho Blue — supplies, borrows, LTV, health factor.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				account: Type.String({
					description: "EVM wallet address",
				}),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const account = params.account.trim();
				if (!/^0x[a-fA-F0-9]{40}$/.test(account)) {
					throw new Error("account must be a valid EVM address");
				}

				const adapter = createMorphoAdapter();
				const position = await adapter.getAccountPosition(network, account);

				const supplyCount = position.supplies.length;
				const borrowCount = position.borrows.length;

				return {
					content: [
						{
							type: "text",
							text:
								`Morpho Blue position (${network}): ${supplyCount} supply, ${borrowCount} borrow. ` +
								`Collateral=$${Number(position.totalCollateralValueUsd).toFixed(2)}, ` +
								`Borrow=$${Number(position.totalBorrowValueUsd).toFixed(2)}, ` +
								`LTV=${(position.currentLTV * 100).toFixed(2)}%`,
						},
					],
					details: {
						schema: "evm.morpho.position.v1",
						network,
						protocol: "morpho-blue",
						account,
						position,
					},
				};
			},
		}),
	];
}
