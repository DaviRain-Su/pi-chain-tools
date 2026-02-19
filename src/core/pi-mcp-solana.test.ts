import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";

import { createSolanaBridgeRegistryDescriptorsFromTools } from "../chains/solana/registry/index.js";
import {
	PI_MCP_EXECUTE_BLOCKED,
	createPiMcpAdapter,
} from "./pi-mcp-adapter.js";
import {
	PI_MCP_TASK_NOT_FOUND,
	createPiMcpSolanaApi,
} from "./pi-mcp-solana.js";
import type { RegisteredTool } from "./types.js";

function createTool(name: string, executeImpl: RegisteredTool["execute"]) {
	return {
		name,
		label: name,
		description: `${name} tool`,
		parameters: Type.Object({}),
		execute: executeImpl,
	} as RegisteredTool;
}

describe("pi-mcp-solana", () => {
	it("discovers read/plan tasks and routes to underlying handlers", async () => {
		const readExecute = vi.fn(async () => ({
			content: [{ type: "text", text: "read-ok" }],
			details: { channel: "read" },
		}));
		const planExecute = vi.fn(async () => ({
			content: [{ type: "text", text: "plan-ok" }],
			details: { channel: "plan" },
		}));

		const descriptors = createSolanaBridgeRegistryDescriptorsFromTools({
			readTools: [createTool("solana_getBalance", readExecute)],
			composeTools: [createTool("solana_buildTransfer", planExecute)],
			workflowTools: [],
		});

		const api = createPiMcpSolanaApi({ descriptors });
		const discovered = api.discover();
		expect(discovered.taskCount).toBe(2);
		expect(discovered.tasks.map((task) => task.taskId)).toEqual([
			"read:solana_getBalance",
			"plan:solana_buildTransfer",
		]);

		const readRun = await api.run({
			id: "r1",
			phase: "read",
			intent: "read:solana_getBalance",
			payload: { account: "abc" },
		});
		expect(readRun.status).toBe("accepted");
		expect(readRun.message).toBe("PI_MCP_RUN_OK");
		expect(readExecute).toHaveBeenCalledWith("pi-mcp:r1", { account: "abc" });

		const planRun = await api.run({
			id: "p1",
			phase: "plan",
			intent: "plan:solana_buildTransfer",
			payload: { to: "xyz" },
		});
		expect(planRun.status).toBe("accepted");
		expect(planExecute).toHaveBeenCalledWith("pi-mcp:p1", { to: "xyz" });
	});

	it("keeps behavior parity with underlying tool execution result envelope", async () => {
		const directResult = {
			content: [{ type: "text", text: "same-result" }],
			details: { a: 1, nested: { b: 2 } },
		};
		const execute = vi.fn(async () => directResult);
		const descriptors = createSolanaBridgeRegistryDescriptorsFromTools({
			readTools: [createTool("solana_getPortfolio", execute)],
			composeTools: [],
			workflowTools: [],
		});
		const api = createPiMcpSolanaApi({ descriptors });

		const bridged = await api.run({
			id: "r-parity",
			phase: "read",
			intent: "read:solana_getPortfolio",
			payload: { includeDefi: true },
		});
		expect(bridged.status).toBe("accepted");
		expect(bridged.details?.result).toEqual(directResult);
		expect(execute).toHaveBeenCalledWith("pi-mcp:r-parity", {
			includeDefi: true,
		});
	});

	it("hard-blocks execute phase with stable code and tracks dashboard summary", async () => {
		const descriptors = createSolanaBridgeRegistryDescriptorsFromTools({
			readTools: [
				createTool(
					"solana_getBalance",
					vi.fn(async () => ({ content: [] })),
				),
			],
			composeTools: [],
			workflowTools: [],
		});
		const api = createPiMcpSolanaApi({ descriptors, recentRunLimit: 3 });

		const executeRun = await api.run({
			id: "x1",
			phase: "execute",
			intent: "execute:solana_transferSol",
			payload: { to: "abc", amount: "1" },
		});
		expect(executeRun.status).toBe("rejected");
		expect(executeRun.message).toBe(PI_MCP_EXECUTE_BLOCKED);

		const unknownRead = await api.run({
			id: "x2",
			phase: "read",
			intent: "read:not_found",
			payload: {},
		});
		expect(unknownRead.status).toBe("rejected");
		expect(unknownRead.message).toBe(PI_MCP_TASK_NOT_FOUND);

		const summary = api.getDashboardSummary();
		expect(summary.discoveredTaskCount).toBe(1);
		expect(summary.executeRejectionCount).toBe(1);
		expect(summary.recentRuns).toHaveLength(2);
		expect(summary.recentRuns[0]?.id).toBe("x2");
	});

	it("supports endpoint-style internal routes via discover+run API", async () => {
		const descriptors = createSolanaBridgeRegistryDescriptorsFromTools({
			readTools: [
				createTool(
					"solana_getBalance",
					vi.fn(async () => ({ content: [] })),
				),
			],
			composeTools: [
				createTool(
					"solana_buildTx",
					vi.fn(async () => ({ content: [] })),
				),
			],
			workflowTools: [],
		});
		const api = createPiMcpSolanaApi({ descriptors });
		expect(api.discover("read").tasks).toHaveLength(1);
		expect(api.discover("plan").tasks).toHaveLength(1);
	});
});
