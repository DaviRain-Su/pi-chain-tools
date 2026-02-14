import type { ChainToolset } from "../../core/types.js";
import { createMetaReadTools } from "./tools/read.js";

export function createMetaToolset(): ChainToolset {
	return {
		chain: "meta",
		groups: [{ name: "read", tools: createMetaReadTools() }],
	};
}
