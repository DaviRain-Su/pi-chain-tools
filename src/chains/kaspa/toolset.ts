import type { ChainToolset } from "../../core/types.js";
import { createKaspaReadTools } from "./tools/read.js";

export function createKaspaToolset(): ChainToolset {
	return {
		chain: "kaspa",
		groups: [{ name: "read", tools: createKaspaReadTools() }],
	};
}
