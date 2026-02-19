import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	STARKNET_TOOL_PREFIX,
	callStarknetRpc,
	parseStarknetNetwork,
	starknetNetworkSchema,
} from "../runtime.js";

export function createStarknetReadTools() {
	return [
		defineTool({
			name: `${STARKNET_TOOL_PREFIX}_getChainStatus`,
			label: "Starknet Chain Status",
			description:
				"Read Starknet chain id and latest block number (mainnet/sepolia)",
			parameters: Type.Object({
				network: Type.Optional(starknetNetworkSchema),
			}),
			execute: async (_id, params) => {
				const network = parseStarknetNetwork(params.network);
				const [chainId, blockNumber] = await Promise.all([
					callStarknetRpc("starknet_chainId", [], network),
					callStarknetRpc("starknet_blockNumber", [], network),
				]);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								ok: true,
								network,
								chainId,
								blockNumber,
							}),
						},
					],
					details: { ok: true, network, chainId, blockNumber },
				};
			},
		}),
		defineTool({
			name: `${STARKNET_TOOL_PREFIX}_getAccountNonce`,
			label: "Starknet Account Nonce",
			description:
				"Read Starknet account nonce by account address for latest block",
			parameters: Type.Object({
				address: Type.String({ minLength: 3 }),
				network: Type.Optional(starknetNetworkSchema),
			}),
			execute: async (_id, params) => {
				const network = parseStarknetNetwork(params.network);
				const nonce = await callStarknetRpc(
					"starknet_getNonce",
					[{ block_tag: "latest" }, String(params.address)],
					network,
				);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								ok: true,
								network,
								address: params.address,
								nonce,
							}),
						},
					],
					details: { ok: true, network, address: params.address, nonce },
				};
			},
		}),
	];
}
