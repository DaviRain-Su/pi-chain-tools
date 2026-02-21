import { createNearToolset } from "../chains/near/toolset.js";
import { registerChainToolsets } from "../core/register.js";
import type { ToolRegistrar } from "../w3rt-core/index.js";

const NEAR_EXTENSION_REGISTERED = Symbol.for(
	"pi-chain-tools/near-extension/registered",
);

export default function nearExtension(pi: ToolRegistrar): void {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	if (globalState[NEAR_EXTENSION_REGISTERED] === true) {
		return;
	}
	globalState[NEAR_EXTENSION_REGISTERED] = true;
	registerChainToolsets(pi, [createNearToolset()]);
}
