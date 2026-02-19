import { createStarknetToolset } from "../chains/starknet/toolset.js";
import { registerChainToolsets } from "../core/register.js";

export const id = "pi-starknet-chain-tools";
export const name = "Pi Starknet Chain Tools";
export const description =
	"Register Starknet read/compose tools for privacy+bitcoin hackathon workflows.";

export function register(pi: Parameters<typeof registerChainToolsets>[0]) {
	registerChainToolsets(pi, [createStarknetToolset()]);
}
