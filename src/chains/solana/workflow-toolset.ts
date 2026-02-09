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

function getPortfolioTool() {
	return createSolanaReadTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}getPortfolio`,
	);
}

function getDefiPositionsTool() {
	return createSolanaReadTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}getDefiPositions`,
	);
}

function getOrcaWhirlpoolPositionsTool() {
	return createSolanaReadTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}getOrcaWhirlpoolPositions`,
	);
}

function getMeteoraPositionsTool() {
	return createSolanaReadTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}getMeteoraPositions`,
	);
}

function getOrcaQuoteTool() {
	return createSolanaReadTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}getOrcaQuote`,
	);
}

function getMeteoraQuoteTool() {
	return createSolanaReadTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}getMeteoraQuote`,
	);
}

function getOrcaSwapTool() {
	return createSolanaExecuteTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}orcaSwap`,
	);
}

function getMeteoraSwapTool() {
	return createSolanaExecuteTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}meteoraSwap`,
	);
}

function getStakeDelegateTool() {
	return createSolanaExecuteTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}stakeDelegate`,
	);
}

function getStakeDeactivateTool() {
	return createSolanaExecuteTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}stakeDeactivate`,
	);
}

function getStakeWithdrawTool() {
	return createSolanaExecuteTools().find(
		(tool) => tool.name === `${TOOL_PREFIX}stakeWithdraw`,
	);
}

export function createSolanaWorkflowToolset(): ChainToolset {
	const confirmTool = getConfirmTool();
	const balanceTool = getBalanceTool();
	const tokenAccountsTool = getTokenAccountsTool();
	const tokenBalanceTool = getTokenBalanceTool();
	const portfolioTool = getPortfolioTool();
	const defiPositionsTool = getDefiPositionsTool();
	const orcaWhirlpoolPositionsTool = getOrcaWhirlpoolPositionsTool();
	const meteoraPositionsTool = getMeteoraPositionsTool();
	const orcaQuoteTool = getOrcaQuoteTool();
	const meteoraQuoteTool = getMeteoraQuoteTool();
	const orcaSwapTool = getOrcaSwapTool();
	const meteoraSwapTool = getMeteoraSwapTool();
	const stakeDelegateTool = getStakeDelegateTool();
	const stakeDeactivateTool = getStakeDeactivateTool();
	const stakeWithdrawTool = getStakeWithdrawTool();
	return {
		chain: "solana",
		groups: [
			{
				name: "read",
				tools: [
					...(balanceTool ? [balanceTool] : []),
					...(tokenAccountsTool ? [tokenAccountsTool] : []),
					...(tokenBalanceTool ? [tokenBalanceTool] : []),
					...(portfolioTool ? [portfolioTool] : []),
					...(defiPositionsTool ? [defiPositionsTool] : []),
					...(orcaWhirlpoolPositionsTool ? [orcaWhirlpoolPositionsTool] : []),
					...(meteoraPositionsTool ? [meteoraPositionsTool] : []),
					...(orcaQuoteTool ? [orcaQuoteTool] : []),
					...(meteoraQuoteTool ? [meteoraQuoteTool] : []),
				],
			},
			{
				name: "execute",
				tools: [
					...createSolanaWorkflowTools(),
					...(confirmTool ? [confirmTool] : []),
					...(orcaSwapTool ? [orcaSwapTool] : []),
					...(meteoraSwapTool ? [meteoraSwapTool] : []),
					...(stakeDelegateTool ? [stakeDelegateTool] : []),
					...(stakeDeactivateTool ? [stakeDeactivateTool] : []),
					...(stakeWithdrawTool ? [stakeWithdrawTool] : []),
				],
			},
		],
	};
}
