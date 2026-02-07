import { createEvmToolset } from "../chains/evm/toolset.js";
import { registerChainToolsets } from "../core/register.js";
import type { ToolRegistrar } from "../core/types.js";

export default function evmExtension(pi: ToolRegistrar): void {
	registerChainToolsets(pi, [createEvmToolset()]);
}
