import type { ChainToolset } from "../../core/types.js";
import { TOOL_PREFIX } from "./runtime.js";
import { createSolanaExecuteTools } from "./tools/execute.js";
import { createSolanaWorkflowTools } from "./tools/workflow.js";

function getConfirmTool() {
	return createSolanaExecuteTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}confirmTransaction`,
	);
}

export function createSolanaWorkflowToolset(): ChainToolset {
	const confirmTool = getConfirmTool();
	return {
		chain: "solana",
		groups: [
			{
				name: "execute",
				tools: [
					...createSolanaWorkflowTools(),
					...(confirmTool ? [confirmTool] : []),
				],
			},
		],
	};
}
