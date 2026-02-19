import { describe, expect, it } from "vitest";
import {
	SOL_AGENT_BRIDGE_ALLOWED_TASK_KINDS,
	SOL_AGENT_BRIDGE_VERSION,
	type SolAgentBridgeAdapter,
	type SolAgentTaskEnvelope,
	assertSolAgentBridgeTaskKind,
	createSolanaBridgeAdapter,
	hasExecutePathOverride,
	isSolAgentBridgeTaskKind,
} from "./sol-agent-bridge.js";

describe("sol-agent bridge phase A contract", () => {
	it("exposes phase-b registry mapping version marker", () => {
		expect(SOL_AGENT_BRIDGE_VERSION).toContain("phase-b");
	});

	it("only allows read/profile/task_discovery task kinds", () => {
		expect(SOL_AGENT_BRIDGE_ALLOWED_TASK_KINDS).toEqual([
			"read",
			"profile",
			"task_discovery",
		]);
		expect(SOL_AGENT_BRIDGE_ALLOWED_TASK_KINDS).not.toContain("execute");
		expect(SOL_AGENT_BRIDGE_ALLOWED_TASK_KINDS).not.toContain("mutate");
	});

	it("validates task kind shape", () => {
		expect(isSolAgentBridgeTaskKind("read")).toBe(true);
		expect(isSolAgentBridgeTaskKind("profile")).toBe(true);
		expect(isSolAgentBridgeTaskKind("task_discovery")).toBe(true);
		expect(isSolAgentBridgeTaskKind("execute")).toBe(false);
		expect(() => assertSolAgentBridgeTaskKind("execute")).toThrow(
			"sol-agent bridge task kind must be one of",
		);
	});

	it("keeps envelope contract chain-scoped and read-focused", () => {
		const envelope: SolAgentTaskEnvelope = {
			taskId: "task-1",
			kind: "read",
			chain: "solana",
			title: "List wallet balances",
			intent: "inspect portfolio",
			inputs: { account: "demo" },
		};

		expect(envelope.chain).toBe("solana");
		expect(isSolAgentBridgeTaskKind(envelope.kind)).toBe(true);
	});

	it("detects execute-path override requests but does not allow them", () => {
		expect(hasExecutePathOverride(undefined)).toBe(false);
		expect(
			hasExecutePathOverride({
				kind: "read",
				metadata: { executionPath: "standard" },
			}),
		).toBe(false);
		expect(
			hasExecutePathOverride({
				kind: "execute_preview",
			}),
		).toBe(true);
		expect(
			hasExecutePathOverride({
				kind: "read",
				metadata: { executionPath: "override" },
			}),
		).toBe(true);
	});

	it("adapter shape can be implemented without execute mutation methods", async () => {
		const adapter: SolAgentBridgeAdapter = {
			getProfile: () => ({
				id: "sol-agent-bridge",
				label: "Sol Agent Bridge",
				mode: "safe",
				capabilities: ["profile", "task_discovery", "read"],
			}),
			listTasks: () => [
				{
					taskId: "discovery-1",
					kind: "task_discovery",
					chain: "solana",
					title: "Discover balance and position tasks",
				},
			],
			read: () => ({ ok: true }),
		};

		const profile = await adapter.getProfile();
		const tasks = await adapter.listTasks();

		expect(profile.mode).toBe("safe");
		expect(tasks[0]?.kind).toBe("task_discovery");
		expect("execute" in adapter).toBe(false);
	});

	it("registry-backed adapter discovery maps to real handlers", async () => {
		const adapter = createSolanaBridgeAdapter();
		const tasks = await adapter.listTasks();
		expect(tasks.length).toBeGreaterThan(0);
		expect(
			tasks.some(
				(task) =>
					task.metadata?.toolName === "solana_getPortfolio" &&
					task.kind === "read",
			),
		).toBe(true);
		expect(
			tasks.some(
				(task) =>
					task.metadata?.toolName === "solana_buildSolTransferTransaction" &&
					task.kind === "task_discovery",
			),
		).toBe(true);
	});

	it("blocks execute-path override in registry-backed adapter", async () => {
		const adapter = createSolanaBridgeAdapter();
		await expect(
			adapter.read({
				taskId: "read:solana_getBalance",
				kind: "read",
				chain: "solana",
				title: "Read balance",
				metadata: { executionPath: "override" },
			}),
		).rejects.toThrow("execute path overrides are not allowed");
	});
});
