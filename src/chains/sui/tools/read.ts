import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	SUI_COIN_TYPE,
	SUI_TOOL_PREFIX,
	formatCoinAmount,
	getSuiClient,
	getSuiRpcEndpoint,
	normalizeAtPath,
	parseSuiNetwork,
	suiNetworkSchema,
} from "../runtime.js";

export function createSuiReadTools() {
	return [
		defineTool({
			name: `${SUI_TOOL_PREFIX}getBalance`,
			label: "Sui Get Balance",
			description:
				"Get owner balance for SUI or a specific coin type on Sui (mainnet/testnet/devnet/localnet)",
			parameters: Type.Object({
				owner: Type.String({ description: "Sui wallet/account address" }),
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
				const owner = normalizeAtPath(params.owner);
				const network = parseSuiNetwork(params.network);
				const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
				const client = getSuiClient(network, params.rpcUrl);
				const balance = await client.getBalance({
					owner,
					coinType: params.coinType,
				});
				const coinType = balance.coinType || params.coinType || SUI_COIN_TYPE;
				const totalBalance = balance.totalBalance;
				const uiAmount =
					coinType === SUI_COIN_TYPE ? formatCoinAmount(totalBalance, 9) : null;

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
					},
				};
			},
		}),
	];
}
