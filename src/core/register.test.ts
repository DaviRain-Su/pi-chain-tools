import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { registerChainToolsets } from "./register.js";
import { type RegisteredTool, defineTool } from "./types.js";

function captureRegisteredTools(
	toolset: Parameters<typeof registerChainToolsets>[1][number],
): RegisteredTool[] {
	const tools: RegisteredTool[] = [];
	registerChainToolsets(
		{
			registerTool(tool) {
				tools.push(tool as RegisteredTool);
			},
		},
		[toolset],
	);
	return tools;
}

describe("registerChainToolsets", () => {
	it("prioritizes workflow summary line for w3rt_run_* tools", async () => {
		const summaryLine = "solana.transfer.sol analysis=ready";
		const workflowTool = defineTool({
			name: "w3rt_run_example_workflow_v0",
			label: "Example Workflow",
			description: "example",
			parameters: Type.Object({}),
			async execute() {
				return {
					content: [
						{
							type: "text" as const,
							text: "Workflow analyzed: solana.transfer.sol",
						},
						{ type: "text" as const, text: "runId=wf-01" },
					],
					details: {
						runMode: "analysis",
						artifacts: {
							analysis: {
								summaryLine,
								summary: {
									schema: "w3rt.workflow.summary.v1",
									phase: "analysis",
									intentType: "solana.transfer.sol",
									status: "ready",
									line: summaryLine,
								},
							},
						},
					},
				};
			},
		});
		const [registered] = captureRegisteredTools({
			chain: "mock",
			groups: [{ name: "execute", tools: [workflowTool] }],
		});
		if (!registered) throw new Error("workflow tool was not registered");

		const result = await registered.execute("call-1", {});
		expect(result.content[0]?.text).toBe(summaryLine);
		expect(result.content[1]?.text).toBe("runId=wf-01");
	});

	it("keeps non-workflow tools unchanged", async () => {
		const originalLine = "Balance: 1 SOL";
		const readTool = defineTool({
			name: "solana_getBalance",
			label: "Balance",
			description: "example",
			parameters: Type.Object({}),
			async execute() {
				return {
					content: [{ type: "text" as const, text: originalLine }],
					details: { lamports: 1_000_000_000 },
				};
			},
		});
		const [registered] = captureRegisteredTools({
			chain: "mock",
			groups: [{ name: "read", tools: [readTool] }],
		});
		if (!registered) throw new Error("read tool was not registered");

		const result = await registered.execute("call-2", {});
		expect(result.content[0]?.text).toBe(originalLine);
	});
});
