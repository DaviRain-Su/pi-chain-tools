import type { ChainToolset } from "../../core/types.js";
import { createKaspaReadTools } from "./tools/read.js";
import { createKaspaExecuteTools } from "./tools/execute.js";

export function createKaspaToolset(): ChainToolset {
	return {
		chain: "kaspa",
		groups: [
			{ name: "read", tools: createKaspaReadTools() },
			{ name: "execute", tools: createKaspaExecuteTools() },
		],
	};
}
