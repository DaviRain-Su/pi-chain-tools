import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	SUI_TOOL_PREFIX,
	getSuiClient,
	getSuiRpcEndpoint,
	parseSuiNetwork,
	suiNetworkSchema,
} from "../runtime.js";

const EXPLICIT_DANGEROUS_METHODS = new Set<string>([
	"sui_executeTransactionBlock",
	"suix_executeTransactionBlock",
]);

function isDangerousSuiRpcMethod(method: string): boolean {
	const normalized = method.trim();
	if (!normalized) return false;
	if (normalized.startsWith("unsafe_")) return true;
	return EXPLICIT_DANGEROUS_METHODS.has(normalized);
}

export function createSuiRpcTools() {
	return [
		defineTool({
			name: `${SUI_TOOL_PREFIX}rpc`,
			label: "Sui RPC",
			description:
				"Call Sui JSON-RPC directly. By default blocks dangerous write methods (unsafe_* and executeTransactionBlock) unless allowDangerous=true.",
			parameters: Type.Object({
				method: Type.String({ description: "JSON-RPC method name" }),
				params: Type.Optional(Type.Array(Type.Unknown())),
				allowDangerous: Type.Optional(Type.Boolean()),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override Sui JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const method = params.method.trim();
				if (!method) throw new Error("method is required");
				const dangerous = isDangerousSuiRpcMethod(method);
				if (dangerous && params.allowDangerous !== true) {
					throw new Error(
						`RPC method "${method}" is blocked by default; set allowDangerous=true to override`,
					);
				}

				const network = parseSuiNetwork(params.network);
				const endpoint = getSuiRpcEndpoint(network, params.rpcUrl);
				const client = getSuiClient(network, params.rpcUrl);
				const rpcParams = params.params ?? [];
				const result = await client.call(method, rpcParams);

				return {
					content: [{ type: "text", text: `RPC ${method} executed` }],
					details: {
						method,
						params: rpcParams,
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
