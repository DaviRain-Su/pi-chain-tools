import { createMetaToolset } from "../chains/meta/toolset.js";
import { registerChainToolsets } from "../core/register.js";
import type { ToolRegistrar } from "../w3rt-core/index.js";

const META_EXTENSION_REGISTERED = Symbol.for(
	"pi-chain-tools/meta-extension/registered",
);

export default function metaExtension(pi: ToolRegistrar): void {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	if (globalState[META_EXTENSION_REGISTERED] === true) {
		return;
	}
	globalState[META_EXTENSION_REGISTERED] = true;
	registerChainToolsets(pi, [createMetaToolset()]);
}
