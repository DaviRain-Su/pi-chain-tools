import { createSuiToolset } from "../chains/sui/toolset.js";
import { registerChainToolsets } from "../core/register.js";
import type { ToolRegistrar } from "../core/types.js";

export default function suiExtension(pi: ToolRegistrar): void {
	registerChainToolsets(pi, [createSuiToolset()]);
}
