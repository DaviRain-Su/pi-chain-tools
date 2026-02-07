import type { ChainToolset, ToolRegistrar } from "./types.js";

export function registerChainToolsets(
	registrar: ToolRegistrar,
	toolsets: ChainToolset[],
): void {
	for (const toolset of toolsets) {
		for (const group of toolset.groups) {
			for (const tool of group.tools) {
				registrar.registerTool(tool);
			}
		}
	}
}
