import { createSolanaWorkflowToolset } from "../chains/solana/workflow-toolset.js";
import { registerChainToolsets } from "../core/register.js";
import type { ToolRegistrar } from "../w3rt-core/index.js";

const SOLANA_WORKFLOW_EXTENSION_REGISTERED = Symbol.for(
	"pi-chain-tools/solana-workflow-extension/registered",
);

export default function solanaWorkflowExtension(pi: ToolRegistrar): void {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	if (globalState[SOLANA_WORKFLOW_EXTENSION_REGISTERED] === true) {
		return;
	}
	globalState[SOLANA_WORKFLOW_EXTENSION_REGISTERED] = true;
	registerChainToolsets(pi, [createSolanaWorkflowToolset()]);
}
