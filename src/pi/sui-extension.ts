import { createSuiToolset } from "../chains/sui/toolset.js";
import { registerChainToolsets } from "../core/register.js";
import type { ToolRegistrar } from "../core/types.js";

const SUI_EXTENSION_REGISTERED = Symbol.for(
	"pi-chain-tools/sui-extension/registered",
);

export default function suiExtension(pi: ToolRegistrar): void {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	if (globalState[SUI_EXTENSION_REGISTERED] === true) {
		return;
	}
	globalState[SUI_EXTENSION_REGISTERED] = true;
	registerChainToolsets(pi, [createSuiToolset()]);
}
