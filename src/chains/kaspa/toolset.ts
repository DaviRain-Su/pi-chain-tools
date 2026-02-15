import type { ChainToolset } from "../../core/types.js";
import { createKaspaComposeTools } from "./tools/compose.js";
import { createKaspaExecuteTools } from "./tools/execute.js";
import { createKaspaReadTools } from "./tools/read.js";
import { createKaspaSignTools } from "./tools/sign.js";
import { createKaspaWorkflowTools } from "./tools/workflow.js";

export function createKaspaToolset(): ChainToolset {
	return {
		chain: "kaspa",
		groups: [
			{ name: "read", tools: createKaspaReadTools() },
			{
				name: "compose",
				tools: [...createKaspaComposeTools(), ...createKaspaSignTools()],
			},
			{
				name: "execute",
				tools: [...createKaspaExecuteTools(), ...createKaspaWorkflowTools()],
			},
		],
	};
}
