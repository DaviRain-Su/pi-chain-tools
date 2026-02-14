import type { ChainToolset } from "../../core/types.js";
import { createEvmComposeTools } from "./tools/compose.js";
import { createEvmExecuteTools } from "./tools/execute.js";
import { createEvmReadTools } from "./tools/read.js";
import { createEvmRpcTools } from "./tools/rpc.js";
import { createEvmTransferWorkflowTools } from "./tools/transfer-workflow.js";
import { createEvmWorkflowTools } from "./tools/workflow.js";

export function createEvmToolset(): ChainToolset {
	return {
		chain: "evm",
		groups: [
			{ name: "read", tools: createEvmReadTools() },
			{ name: "compose", tools: createEvmComposeTools() },
			{
				name: "execute",
				tools: [
					...createEvmExecuteTools(),
					...createEvmWorkflowTools(),
					...createEvmTransferWorkflowTools(),
				],
			},
			{ name: "rpc", tools: createEvmRpcTools() },
		],
	};
}
