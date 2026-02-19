import { Type } from "@sinclair/typebox";

export const STARKNET_TOOL_PREFIX = "starknet";

export const starknetNetworkSchema = Type.Union([
	Type.Literal("mainnet"),
	Type.Literal("sepolia"),
]);

export type StarknetNetwork = "mainnet" | "sepolia";

export function parseStarknetNetwork(value?: unknown): StarknetNetwork {
	const v = String(value || "mainnet")
		.trim()
		.toLowerCase();
	return v === "sepolia" ? "sepolia" : "mainnet";
}

export function getStarknetRpcEndpoint(network: StarknetNetwork): string {
	if (network === "sepolia") {
		return (
			process.env.STARKNET_RPC_URL_SEPOLIA ||
			process.env.STARKNET_RPC_URL ||
			"https://starknet-sepolia.public.blastapi.io/rpc/v0_8"
		);
	}
	return (
		process.env.STARKNET_RPC_URL_MAINNET ||
		process.env.STARKNET_RPC_URL ||
		"https://starknet-mainnet.public.blastapi.io/rpc/v0_8"
	);
}

export async function callStarknetRpc(
	method: string,
	params: unknown[] = [],
	network: StarknetNetwork = "mainnet",
): Promise<unknown> {
	const endpoint = getStarknetRpcEndpoint(network);
	const res = await fetch(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	if (!res.ok) {
		throw new Error(`starknet rpc http ${res.status}`);
	}
	const payload = (await res.json()) as {
		result?: unknown;
		error?: { code?: number; message?: string };
	};
	if (payload?.error) {
		throw new Error(
			`starknet rpc error ${payload.error.code ?? "unknown"}: ${payload.error.message || "unknown"}`,
		);
	}
	return payload?.result;
}
