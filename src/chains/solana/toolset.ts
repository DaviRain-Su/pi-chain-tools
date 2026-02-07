import type { ChainToolset } from "../../core/types.js";
import { createSolanaComposeTools } from "./tools/compose.js";
import { createSolanaExecuteTools } from "./tools/execute.js";
import { createSolanaReadTools } from "./tools/read.js";
import { createSolanaRpcTools } from "./tools/rpc.js";

export function createSolanaToolset(): ChainToolset {
	return {
		chain: "solana",
		groups: [
			{ name: "read", tools: createSolanaReadTools() },
			{ name: "compose", tools: createSolanaComposeTools() },
			{ name: "execute", tools: createSolanaExecuteTools() },
			{ name: "rpc", tools: createSolanaRpcTools() },
		],
	};
}
