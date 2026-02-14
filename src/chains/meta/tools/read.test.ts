import { describe, expect, it, vi } from "vitest";

vi.mock("../../evm/toolset.js", () => ({
	createEvmToolset: () => ({
		chain: "evm",
		groups: [
			{
				name: "read",
				tools: [{ name: "evm_polymarketGetBtc5mMarkets" }],
			},
			{
				name: "execute",
				tools: [{ name: "w3rt_run_evm_polymarket_workflow_v0" }],
			},
		],
	}),
}));

vi.mock("../../near/toolset.js", () => ({
	createNearToolset: () => ({
		chain: "near",
		groups: [
			{ name: "read", tools: [{ name: "near_getBalance" }] },
			{ name: "execute", tools: [{ name: "w3rt_run_near_workflow_v0" }] },
		],
	}),
}));

vi.mock("../../sui/toolset.js", () => ({
	createSuiToolset: () => ({
		chain: "sui",
		groups: [
			{ name: "read", tools: [{ name: "sui_getBalance" }] },
			{ name: "execute", tools: [{ name: "w3rt_run_sui_defi_workflow_v0" }] },
		],
	}),
}));

vi.mock("../../solana/workflow-toolset.js", () => ({
	createSolanaWorkflowToolset: () => ({
		chain: "solana",
		groups: [
			{ name: "read", tools: [{ name: "solana_getBalance" }] },
			{ name: "execute", tools: [{ name: "w3rt_run_workflow_v0" }] },
		],
	}),
}));

import { createMetaReadTools } from "./read.js";

type ReadTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(): ReadTool {
	const tool = createMetaReadTools().find(
		(entry) => entry.name === "w3rt_getCapabilities_v0",
	);
	if (!tool) throw new Error("w3rt_getCapabilities_v0 not found");
	return tool as unknown as ReadTool;
}

describe("meta capability tools", () => {
	it("returns all chains by default", async () => {
		const tool = getTool();
		const result = await tool.execute("meta-1", {});
		expect(result.content[0]?.text).toContain("ACP capability catalog");
		expect(result.details).toMatchObject({
			schema: "w3rt.capabilities.v1",
			query: {
				chain: "all",
				includeExamples: true,
				includeToolNames: true,
			},
			chains: expect.arrayContaining([
				expect.objectContaining({ chain: "solana" }),
				expect.objectContaining({ chain: "sui" }),
				expect.objectContaining({ chain: "near" }),
				expect.objectContaining({ chain: "evm" }),
			]),
		});
	});

	it("supports chain filter and hides examples/tool names", async () => {
		const tool = getTool();
		const result = await tool.execute("meta-2", {
			chain: "evm",
			includeExamples: false,
			includeToolNames: false,
		});
		expect(result.content[0]?.text).toContain("evm");
		expect(result.details).toMatchObject({
			query: {
				chain: "evm",
				includeExamples: false,
				includeToolNames: false,
			},
			chains: [
				expect.objectContaining({
					chain: "evm",
					workflows: [
						expect.objectContaining({
							nlExamples: [],
						}),
					],
				}),
			],
			toolsets: [
				expect.objectContaining({
					chain: "evm",
					groups: expect.arrayContaining([
						expect.objectContaining({ tools: [] }),
					]),
				}),
			],
		});
	});
});
