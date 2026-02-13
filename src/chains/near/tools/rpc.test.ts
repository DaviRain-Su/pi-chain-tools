import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	callNearRpc: vi.fn(),
	getNearRpcEndpoint: vi.fn(() => "https://rpc.mainnet.near.org"),
	nearNetworkSchema: vi.fn(),
	parseNearNetwork: vi.fn(() => "mainnet"),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		callNearRpc: runtimeMocks.callNearRpc,
		getNearRpcEndpoint: runtimeMocks.getNearRpcEndpoint,
		nearNetworkSchema: runtimeMocks.nearNetworkSchema,
		parseNearNetwork: runtimeMocks.parseNearNetwork,
	};
});

import { createNearRpcTools } from "./rpc.js";

type RpcTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(): RpcTool {
	const tool = createNearRpcTools().find((entry) => entry.name === "near_rpc");
	if (!tool) throw new Error("near_rpc not found");
	return tool as unknown as RpcTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.parseNearNetwork.mockReturnValue("mainnet");
	runtimeMocks.getNearRpcEndpoint.mockReturnValue(
		"https://rpc.mainnet.near.org",
	);
	runtimeMocks.callNearRpc.mockResolvedValue({
		ok: true,
	});
});

describe("near_rpc", () => {
	it("executes safe methods", async () => {
		const tool = getTool();
		const result = await tool.execute("near-rpc-1", {
			method: "status",
			network: "mainnet",
			params: {},
		});

		expect(runtimeMocks.callNearRpc).toHaveBeenCalledWith({
			method: "status",
			network: "mainnet",
			params: {},
			rpcUrl: undefined,
		});
		expect(result.details).toMatchObject({
			method: "status",
			dangerous: false,
			network: "mainnet",
			endpoint: "https://rpc.mainnet.near.org",
		});
	});

	it("blocks broadcast methods by default", async () => {
		const tool = getTool();
		await expect(
			tool.execute("near-rpc-2", {
				method: "broadcast_tx_commit",
				params: ["signedtx"],
			}),
		).rejects.toThrow('RPC method "broadcast_tx_commit" is blocked');
	});

	it("allows dangerous methods when allowDangerous=true", async () => {
		const tool = getTool();
		await tool.execute("near-rpc-3", {
			method: "broadcast_tx_async",
			params: ["signedtx"],
			allowDangerous: true,
		});

		expect(runtimeMocks.callNearRpc).toHaveBeenCalledWith({
			method: "broadcast_tx_async",
			network: "mainnet",
			params: ["signedtx"],
			rpcUrl: undefined,
		});
	});
});
