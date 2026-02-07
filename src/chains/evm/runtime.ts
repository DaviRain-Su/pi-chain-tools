import { Type } from "@sinclair/typebox";

export type EvmNetwork =
	| "ethereum"
	| "sepolia"
	| "polygon"
	| "base"
	| "arbitrum"
	| "optimism";

export const EVM_TOOL_PREFIX = "evm_";

export function evmNetworkSchema() {
	return Type.Optional(
		Type.Union([
			Type.Literal("ethereum"),
			Type.Literal("sepolia"),
			Type.Literal("polygon"),
			Type.Literal("base"),
			Type.Literal("arbitrum"),
			Type.Literal("optimism"),
		]),
	);
}

export function parseEvmNetwork(value?: string): EvmNetwork {
	if (
		value === "ethereum" ||
		value === "sepolia" ||
		value === "polygon" ||
		value === "base" ||
		value === "arbitrum" ||
		value === "optimism"
	) {
		return value;
	}
	return "ethereum";
}
