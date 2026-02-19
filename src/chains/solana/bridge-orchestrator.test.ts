import { describe, expect, it } from "vitest";
import {
	discoverBridgeReadPlanTasks,
	filterBridgeTasksForMode,
	runBridgeBatchReadPlanTasks,
} from "./bridge-orchestrator.js";
import type {
	SolAgentBridgeAdapter,
	SolAgentTaskEnvelope,
} from "./sol-agent-bridge.js";

function stubAdapter(tasks: SolAgentTaskEnvelope[]): SolAgentBridgeAdapter {
	return {
		getProfile: () => ({
			id: "sol-agent-bridge",
			label: "Sol Agent Bridge",
			mode: "safe",
			capabilities: ["profile", "task_discovery", "read"],
		}),
		listTasks: () => tasks,
		read: async (task) => ({
			content: [{ type: "text", text: `ok:${task.taskId}` }],
		}),
	};
}

describe("solana bridge orchestrator", () => {
	it("filters safe-mode tasks to read/plan and blocks execute intents", () => {
		const tasks: SolAgentTaskEnvelope[] = [
			{
				taskId: "read:solana_getPortfolio",
				kind: "read",
				chain: "solana",
				title: "Read portfolio",
				metadata: { operationKind: "read" },
			},
			{
				taskId: "plan:solana_buildSolTransferTransaction",
				kind: "task_discovery",
				chain: "solana",
				title: "Build transfer tx",
				metadata: { operationKind: "plan" },
			},
			{
				taskId: "execute:solana_transferSol",
				kind: "task_discovery",
				chain: "solana",
				title: "Execute transfer",
				metadata: { operationKind: "execute" },
			},
		];
		const results = filterBridgeTasksForMode({ tasks, mode: "safe" });

		expect(results).toHaveLength(3);
		expect(results[0]).toMatchObject({
			taskId: "read:solana_getPortfolio",
			accepted: true,
			status: "executed",
		});
		expect(results[1]).toMatchObject({
			taskId: "plan:solana_buildSolTransferTransaction",
			accepted: false,
			status: "rejected",
		});
		expect(results[2]).toMatchObject({
			taskId: "execute:solana_transferSol",
			accepted: false,
			status: "rejected",
		});
	});

	it("keeps research mode opt-in but still blocks mutate/execute intents", () => {
		const tasks: SolAgentTaskEnvelope[] = [
			{
				taskId: "plan:solana_buildSwapTransaction",
				kind: "task_discovery",
				chain: "solana",
				title: "Plan Jupiter swap",
				metadata: { operationKind: "plan" },
			},
			{
				taskId: "read:solana_getBalance",
				kind: "read",
				chain: "solana",
				title: "Read balance",
				metadata: { operationKind: "read" },
			},
		];
		const results = filterBridgeTasksForMode({ tasks, mode: "research" });
		expect(results[0]?.accepted).toBe(false);
		expect(results[0]?.reason).toContain("blocked");
		expect(results[1]?.accepted).toBe(true);
	});

	it("runs batch wrappers and preserves compatibility with bridge handlers", async () => {
		const tasks: SolAgentTaskEnvelope[] = [
			{
				taskId: "read:solana_getBalance",
				kind: "read",
				chain: "solana",
				title: "Read balance",
				metadata: { operationKind: "read" },
				inputs: { address: "demo" },
			},
			{
				taskId: "plan:solana_buildStakeTransaction",
				kind: "task_discovery",
				chain: "solana",
				title: "Plan stake",
				metadata: { operationKind: "plan" },
			},
		];
		const adapter = stubAdapter(tasks);
		const result = await runBridgeBatchReadPlanTasks({ adapter, mode: "safe" });
		expect(result.mode).toBe("safe");
		expect(result.totalTasks).toBe(2);
		expect(result.executed).toBe(2);
		expect(result.rejected).toBe(0);
		expect(result.results[0]?.result).toEqual({
			content: [{ type: "text", text: "ok:read:solana_getBalance" }],
		});
	});

	it("discovers only safe-mode compatible tasks for heartbeat/cron wrappers", async () => {
		const tasks: SolAgentTaskEnvelope[] = [
			{
				taskId: "read:solana_getPortfolio",
				kind: "read",
				chain: "solana",
				title: "Read portfolio",
				metadata: { operationKind: "read" },
			},
			{
				taskId: "plan:solana_buildRepayTx",
				kind: "task_discovery",
				chain: "solana",
				title: "Plan repay",
				metadata: { operationKind: "plan" },
			},
		];
		const discovered = await discoverBridgeReadPlanTasks({
			adapter: stubAdapter(tasks),
			mode: "safe",
		});
		expect(discovered).toHaveLength(1);
		expect(discovered[0]?.taskId).toBe("read:solana_getPortfolio");
	});
});
