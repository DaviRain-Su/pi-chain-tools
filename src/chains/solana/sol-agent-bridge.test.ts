import { describe, expect, it } from "vitest";
import {
	SOL_AGENT_BRIDGE_ALLOWED_TASK_KINDS,
	SOL_AGENT_BRIDGE_VERSION,
	type SolAgentBridgeAdapter,
	type SolAgentTaskEnvelope,
	assertSolAgentBridgeTaskKind,
	hasExecutePathOverride,
	isSolAgentBridgeTaskKind,
} from "./sol-agent-bridge.js";

describe("sol-agent bridge phase A contract", () => {
	it("exposes a readonly phase version marker", () => {
		expect(SOL_AGENT_BRIDGE_VERSION).toContain("phase-a");
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
});
