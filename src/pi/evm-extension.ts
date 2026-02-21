import { createEvmToolset } from "../chains/evm/toolset.js";
import { registerChainToolsets } from "../core/register.js";
import type { ToolRegistrar } from "../w3rt-core/index.js";

const EVM_EXTENSION_REGISTERED = Symbol.for(
	"pi-chain-tools/evm-extension/registered",
);

export default function evmExtension(pi: ToolRegistrar): void {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	if (globalState[EVM_EXTENSION_REGISTERED] === true) {
		return;
	}
	globalState[EVM_EXTENSION_REGISTERED] = true;
	registerChainToolsets(pi, [createEvmToolset()]);
}
