import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	DANGEROUS_RPC_METHODS,
	TOOL_PREFIX,
	callSolanaRpc,
	getRpcEndpoint,
	parseNetwork,
	solanaNetworkSchema,
} from "../runtime.js";

export function createSolanaRpcTools() {
	return [
		defineTool({
			name: `${TOOL_PREFIX}rpc`,
			label: "Solana RPC",
			description:
				"Call Solana JSON-RPC directly. By default blocks dangerous write methods (sendTransaction/requestAirdrop) unless allowDangerous=true.",
			parameters: Type.Object({
				method: Type.String({ description: "JSON-RPC method name" }),
				params: Type.Optional(Type.Array(Type.Unknown())),
				allowDangerous: Type.Optional(Type.Boolean()),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const method = params.method.trim();
				if (!method) throw new Error("method is required");
				if (
					DANGEROUS_RPC_METHODS.has(method) &&
					params.allowDangerous !== true
				) {
					throw new Error(
						`RPC method "${method}" is blocked by default; set allowDangerous=true to override`,
					);
				}
				const rpcParams = params.params ?? [];
				const result = await callSolanaRpc(method, rpcParams, params.network);
				return {
					content: [{ type: "text", text: `RPC ${method} executed` }],
					details: {
						method,
						params: rpcParams,
						result,
						network: parseNetwork(params.network),
						endpoint: getRpcEndpoint(params.network),
					},
				};
			},
		}),
	];
}
