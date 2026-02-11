import type { ChainToolset } from "../../core/types.js";
import { createSuiComposeTools } from "./tools/compose.js";
import { createSuiExecuteTools } from "./tools/execute.js";
import { createSuiReadTools } from "./tools/read.js";
import { createSuiRpcTools } from "./tools/rpc.js";
import { createSuiWorkflowTools } from "./tools/workflow.js";

export function createSuiToolset(): ChainToolset {
	return {
		chain: "sui",
		groups: [
			{ name: "read", tools: createSuiReadTools() },
			{ name: "compose", tools: createSuiComposeTools() },
			{
				name: "execute",
				tools: [...createSuiExecuteTools(), ...createSuiWorkflowTools()],
			},
			{ name: "rpc", tools: createSuiRpcTools() },
		],
	};
}
