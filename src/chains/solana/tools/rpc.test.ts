import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	callSolanaRpc: vi.fn(),
	getRpcEndpoint: vi.fn(() => "https://rpc.test"),
	isDangerousRpcMethod: vi.fn(),
	parseNetwork: vi.fn(() => "mainnet-beta"),
	solanaNetworkSchema: vi.fn(),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		callSolanaRpc: runtimeMocks.callSolanaRpc,
		getRpcEndpoint: runtimeMocks.getRpcEndpoint,
		isDangerousRpcMethod: runtimeMocks.isDangerousRpcMethod,
		parseNetwork: runtimeMocks.parseNetwork,
		solanaNetworkSchema: runtimeMocks.solanaNetworkSchema,
	};
});

import { createSolanaRpcTools } from "./rpc.js";

type RpcTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ details?: unknown }>;
};

function getRpcTool(): RpcTool {
	const tool = createSolanaRpcTools().find(
		(entry) => entry.name === "solana_rpc",
	);
	if (!tool) throw new Error("solana_rpc not found");
	return tool as unknown as RpcTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.isDangerousRpcMethod.mockReturnValue(false);
	runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
	runtimeMocks.getRpcEndpoint.mockReturnValue("https://rpc.test");
});

describe("solana_rpc", () => {
	it("rejects empty method", async () => {
		const tool = getRpcTool();
		await expect(
			tool.execute("rpc-empty", {
				method: "   ",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("method is required");
		expect(runtimeMocks.callSolanaRpc).not.toHaveBeenCalled();
	});

	it("blocks dangerous methods by default", async () => {
		runtimeMocks.isDangerousRpcMethod.mockReturnValue(true);
		const tool = getRpcTool();
		await expect(
			tool.execute("rpc-danger", {
				method: "sendTransaction",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("allowDangerous=true");
		expect(runtimeMocks.callSolanaRpc).not.toHaveBeenCalled();
	});

	it("allows dangerous methods when allowDangerous=true", async () => {
		runtimeMocks.isDangerousRpcMethod.mockReturnValue(true);
		runtimeMocks.callSolanaRpc.mockResolvedValue({ value: "ok" });
		const tool = getRpcTool();
		const result = await tool.execute("rpc-allow", {
			method: "sendTransaction",
			params: ["signed-tx"],
			allowDangerous: true,
			network: "mainnet-beta",
		});

		expect(runtimeMocks.callSolanaRpc).toHaveBeenCalledWith(
			"sendTransaction",
			["signed-tx"],
			"mainnet-beta",
		);
		expect(result.details).toMatchObject({
			method: "sendTransaction",
			params: ["signed-tx"],
			result: { value: "ok" },
			network: "mainnet-beta",
			endpoint: "https://rpc.test",
		});
	});
});
