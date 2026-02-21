import { createSolanaToolset } from "../chains/solana/toolset.js";
import { registerChainToolsets } from "../core/register.js";
import type { ToolRegistrar } from "../w3rt-core/index.js";

export default function solanaExtension(pi: ToolRegistrar): void {
	registerChainToolsets(pi, [createSolanaToolset()]);
}
