import type { ToolRegistrar } from "../core/types.js";
import evmExtension from "./evm-extension.js";
import kaspaExtension from "./kaspa-extension.js";
import metaExtension from "./meta-extension.js";
import nearExtension from "./near-extension.js";
import solanaWorkflowExtension from "./solana-workflow-extension.js";
import suiExtension from "./sui-extension.js";

const DEFAULT_EXTENSION_REGISTERED = Symbol.for(
	"pi-chain-tools/default-extension/registered",
);

export default function defaultExtension(pi: ToolRegistrar): void {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	if (globalState[DEFAULT_EXTENSION_REGISTERED] === true) {
		return;
	}
	globalState[DEFAULT_EXTENSION_REGISTERED] = true;
	metaExtension(pi);
	solanaWorkflowExtension(pi);
	suiExtension(pi);
	nearExtension(pi);
	evmExtension(pi);
	kaspaExtension(pi);
}
