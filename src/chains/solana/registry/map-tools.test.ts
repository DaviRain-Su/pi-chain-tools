import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import type { RegisteredTool } from "../../../core/types.js";
import {
	createSolanaBridgeRegistryDescriptors,
	createSolanaBridgeRegistryDescriptorsFromTools,
	findSolanaBridgeDescriptorByTaskId,
} from "./map-tools.js";

function stubTool(name: string, label = name): RegisteredTool {
	return {
		name,
		label,
		description: `${name} description`,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: name }] }),
	};
}

describe("solana bridge registry mapping", () => {
	it("maps read+compose+workflow tools into bridge descriptors", () => {
		const readTool = stubTool("solana_getBalance");
		const composeTool = stubTool("solana_buildSolTransferTransaction");
		const workflowTool = stubTool("w3rt_run_workflow_v0");
		const descriptors = createSolanaBridgeRegistryDescriptorsFromTools({
			readTools: [readTool],
			composeTools: [composeTool],
			workflowTools: [workflowTool],
		});

		expect(descriptors).toHaveLength(3);
		expect(descriptors[0]).toMatchObject({
			id: "read:solana_getBalance",
			operationKind: "read",
			group: "read",
			toolName: "solana_getBalance",
		});
		expect(descriptors[1]).toMatchObject({
			id: "plan:solana_buildSolTransferTransaction",
			operationKind: "plan",
			group: "compose",
			toolName: "solana_buildSolTransferTransaction",
		});
		expect(descriptors[2]).toMatchObject({
			id: "plan:w3rt_run_workflow_v0",
			operationKind: "plan",
			group: "workflow",
			toolName: "w3rt_run_workflow_v0",
		});
	});

	it("keeps mapped handler references unchanged", async () => {
		const captured: unknown[] = [];
		const readTool: RegisteredTool = {
			name: "solana_getBalance",
			label: "Read balance",
			description: "Read balance",
			parameters: Type.Object({ account: Type.String() }),
			execute: async (_toolCallId, params) => {
				captured.push(params);
				return { content: [{ type: "text", text: "ok" }] };
			},
		};
		const descriptors = createSolanaBridgeRegistryDescriptorsFromTools({
			readTools: [readTool],
			composeTools: [],
			workflowTools: [],
		});
		const descriptor = findSolanaBridgeDescriptorByTaskId(
			descriptors,
			"read:solana_getBalance",
		);
		expect(descriptor).not.toBeNull();
		expect(descriptor?.tool).toBe(readTool);

		const result = await descriptor?.tool.execute("call-1", {
			account: "demo-account",
		});
		expect(result?.content[0]?.text).toBe("ok");
		expect(captured).toEqual([{ account: "demo-account" }]);
	});

	it("covers real production tool mapping surfaces", () => {
		const descriptors = createSolanaBridgeRegistryDescriptors();
		const read = descriptors.filter((d) => d.operationKind === "read");
		const plan = descriptors.filter((d) => d.operationKind === "plan");

		expect(read.length).toBeGreaterThan(0);
		expect(plan.length).toBeGreaterThan(0);
		expect(
			descriptors.some(
				(descriptor) => descriptor.toolName === "solana_getPortfolio",
			),
		).toBe(true);
		expect(
			descriptors.some(
				(descriptor) =>
					descriptor.toolName === "solana_buildSolTransferTransaction",
			),
		).toBe(true);
		expect(
			descriptors.some(
				(descriptor) => descriptor.toolName === "w3rt_run_workflow_v0",
			),
		).toBe(true);
	});
});
