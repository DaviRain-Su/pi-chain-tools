import { createSolanaWorkflowToolset } from "../chains/solana/workflow-toolset.js";
import { registerChainToolsets } from "../core/register.js";
import type { ToolRegistrar } from "../core/types.js";

export default function solanaWorkflowExtension(pi: ToolRegistrar): void {
	registerChainToolsets(pi, [createSolanaWorkflowToolset()]);
}
