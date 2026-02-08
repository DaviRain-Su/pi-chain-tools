import type { ChainToolset } from "../../core/types.js";
import { TOOL_PREFIX } from "./runtime.js";
import { createSolanaExecuteTools } from "./tools/execute.js";
import { createSolanaReadTools } from "./tools/read.js";
import { createSolanaWorkflowTools } from "./tools/workflow.js";

function getConfirmTool() {
	return createSolanaExecuteTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}confirmTransaction`,
	);
}

function getBalanceTool() {
	return createSolanaReadTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}getBalance`,
	);
}

function getTokenAccountsTool() {
	return createSolanaReadTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}getTokenAccounts`,
	);
}

function getTokenBalanceTool() {
	return createSolanaReadTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}getTokenBalance`,
	);
}

export function createSolanaWorkflowToolset(): ChainToolset {
	const confirmTool = getConfirmTool();
	const balanceTool = getBalanceTool();
	const tokenAccountsTool = getTokenAccountsTool();
	const tokenBalanceTool = getTokenBalanceTool();
	return {
		chain: "solana",
		groups: [
			{
				name: "read",
				tools: [
					...(balanceTool ? [balanceTool] : []),
					...(tokenAccountsTool ? [tokenAccountsTool] : []),
					...(tokenBalanceTool ? [tokenBalanceTool] : []),
				],
			},
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
