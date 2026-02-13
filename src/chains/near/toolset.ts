import type { ChainToolset } from "../../core/types.js";
import { createNearComposeTools } from "./tools/compose.js";
import { createNearExecuteTools } from "./tools/execute.js";
import { createNearReadTools } from "./tools/read.js";
import { createNearRpcTools } from "./tools/rpc.js";
import { createNearWorkflowTools } from "./tools/workflow.js";

export function createNearToolset(): ChainToolset {
	return {
		chain: "near",
		groups: [
			{ name: "read", tools: createNearReadTools() },
			{ name: "compose", tools: createNearComposeTools() },
			{
				name: "execute",
				tools: [...createNearExecuteTools(), ...createNearWorkflowTools()],
			},
			{ name: "rpc", tools: createNearRpcTools() },
		],
	};
}
