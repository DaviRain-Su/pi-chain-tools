import { createKaspaToolset } from "../chains/kaspa/toolset.js";
import { registerChainToolsets } from "../core/register.js";
import type { ToolRegistrar } from "../core/types.js";

const KASPA_EXTENSION_REGISTERED = Symbol.for(
	"pi-chain-tools/kaspa-extension/registered",
);

export default function kaspaExtension(pi: ToolRegistrar): void {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	if (globalState[KASPA_EXTENSION_REGISTERED] === true) {
		return;
	}
	globalState[KASPA_EXTENSION_REGISTERED] = true;
	registerChainToolsets(pi, [createKaspaToolset()]);
}

