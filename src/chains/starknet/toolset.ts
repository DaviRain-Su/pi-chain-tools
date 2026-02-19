import type { ChainToolset } from "../../core/types.js";
import { createStarknetComposeTools } from "./tools/compose.js";
import { createStarknetExecuteTools } from "./tools/execute.js";
import { createStarknetReadTools } from "./tools/read.js";

export function createStarknetToolset(): ChainToolset {
	return {
		chain: "starknet",
		groups: [
			{ name: "read", tools: createStarknetReadTools() },
			{ name: "compose", tools: createStarknetComposeTools() },
			{ name: "execute", tools: createStarknetExecuteTools() },
		],
	};
}
