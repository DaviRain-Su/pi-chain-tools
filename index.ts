import { createNearToolset } from "./src/chains/near/toolset.js";
import { registerChainToolsets } from "./src/core/register.js";
import type { ToolRegistrar } from "./src/core/types.js";

const OPENCLAW_NEAR_REGISTERED = Symbol.for(
	"pi-chain-tools/openclaw-near/registered",
);

export default function openclawNearExtension(pi: ToolRegistrar): void {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	if (globalState[OPENCLAW_NEAR_REGISTERED] === true) return;
	globalState[OPENCLAW_NEAR_REGISTERED] = true;
	registerChainToolsets(pi, [createNearToolset()]);
}
