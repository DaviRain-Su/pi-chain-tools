import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	getSuiClient: vi.fn(),
	getSuiRpcEndpoint: vi.fn(() => "https://fullnode.mainnet.sui.io:443"),
	parseSuiNetwork: vi.fn(() => "mainnet"),
	suiNetworkSchema: vi.fn(),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		getSuiClient: runtimeMocks.getSuiClient,
		getSuiRpcEndpoint: runtimeMocks.getSuiRpcEndpoint,
		parseSuiNetwork: runtimeMocks.parseSuiNetwork,
		suiNetworkSchema: runtimeMocks.suiNetworkSchema,
	};
});

import { createSuiRpcTools } from "./rpc.js";

type RpcTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(): RpcTool {
	const tool = createSuiRpcTools().find((entry) => entry.name === "sui_rpc");
	if (!tool) throw new Error("sui_rpc not found");
	return tool as unknown as RpcTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
	runtimeMocks.getSuiRpcEndpoint.mockReturnValue(
		"https://fullnode.mainnet.sui.io:443",
	);
	runtimeMocks.getSuiClient.mockReturnValue({
		call: vi.fn().mockResolvedValue({
			ok: true,
		}),
	});
});

describe("sui_rpc", () => {
	it("executes safe JSON-RPC methods", async () => {
		const tool = getTool();
		const result = await tool.execute("sui-rpc-1", {
			method: "suix_getBalance",
			params: [
				"0x1111111111111111111111111111111111111111111111111111111111111111",
				"0x2::sui::SUI",
			],
			network: "mainnet",
		});

		const client = runtimeMocks.getSuiClient.mock.results[0]?.value as {
			call: ReturnType<typeof vi.fn>;
		};
		expect(client.call).toHaveBeenCalledWith("suix_getBalance", [
			"0x1111111111111111111111111111111111111111111111111111111111111111",
			"0x2::sui::SUI",
		]);
		expect(result.details).toMatchObject({
			method: "suix_getBalance",
			dangerous: false,
			network: "mainnet",
			endpoint: "https://fullnode.mainnet.sui.io:443",
		});
	});

	it("blocks unsafe methods by default", async () => {
		const tool = getTool();
		await expect(
			tool.execute("sui-rpc-2", {
				method: "unsafe_transferSui",
			}),
		).rejects.toThrow('RPC method "unsafe_transferSui" is blocked');
	});

	it("blocks executeTransactionBlock by default", async () => {
		const tool = getTool();
		await expect(
			tool.execute("sui-rpc-3", {
				method: "sui_executeTransactionBlock",
			}),
		).rejects.toThrow("allowDangerous=true");
	});

	it("allows dangerous methods when allowDangerous=true", async () => {
		const tool = getTool();
		await tool.execute("sui-rpc-4", {
			method: "sui_executeTransactionBlock",
			params: ["AAECAw==", []],
			allowDangerous: true,
			network: "mainnet",
		});

		const client = runtimeMocks.getSuiClient.mock.results[0]?.value as {
			call: ReturnType<typeof vi.fn>;
		};
		expect(client.call).toHaveBeenCalledWith("sui_executeTransactionBlock", [
			"AAECAw==",
			[],
		]);
	});
});
