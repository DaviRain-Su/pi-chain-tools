import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	NEAR_TOOL_PREFIX,
	callNearRpc,
	getNearRpcEndpoint,
	nearNetworkSchema,
	parseNearNetwork,
} from "../runtime.js";

function isDangerousNearRpcMethod(method: string): boolean {
	const normalized = method.trim();
	if (!normalized) return false;
	return normalized.startsWith("broadcast_tx_");
}

export function createNearRpcTools() {
	return [
		defineTool({
			name: `${NEAR_TOOL_PREFIX}rpc`,
			label: "NEAR RPC",
			description:
				"Call NEAR JSON-RPC directly. By default blocks transaction broadcast methods unless allowDangerous=true.",
			parameters: Type.Object({
				method: Type.String({ description: "JSON-RPC method name" }),
				params: Type.Optional(Type.Unknown()),
				allowDangerous: Type.Optional(Type.Boolean()),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const method = params.method.trim();
				if (!method) throw new Error("method is required");

				const dangerous = isDangerousNearRpcMethod(method);
				if (dangerous && params.allowDangerous !== true) {
					throw new Error(
						`RPC method "${method}" is blocked by default; set allowDangerous=true to override`,
					);
				}

				const network = parseNearNetwork(params.network);
				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
				const result = await callNearRpc({
					method,
					network,
					params: params.params ?? {},
					rpcUrl: params.rpcUrl,
				});

				return {
					content: [{ type: "text", text: `RPC ${method} executed` }],
					details: {
						method,
						params: params.params ?? {},
						result,
						dangerous,
						network,
						endpoint,
					},
				};
			},
		}),
	];
}
