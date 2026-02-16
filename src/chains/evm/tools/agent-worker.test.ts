import { afterEach, describe, expect, it, vi } from "vitest";

// Mock venus-adapter
const mockGetMarkets = vi.fn();
const mockGetAccountPosition = vi.fn();
const mockBuildRepayCalldata = vi.fn();
const mockBuildBorrowCalldata = vi.fn();

vi.mock("./venus-adapter.js", () => ({
	createVenusAdapter: () => ({
		protocolId: "venus",
		getMarkets: mockGetMarkets,
		getAccountPosition: mockGetAccountPosition,
		buildRepayCalldata: mockBuildRepayCalldata,
		buildBorrowCalldata: mockBuildBorrowCalldata,
	}),
}));

// Mock signer
const mockSignAndSend = vi.fn().mockResolvedValue({
	txHash: "0xmocktx",
	from: "0x1234567890123456789012345678901234567890",
});

vi.mock("./signer-resolve.js", () => ({
	resolveEvmSignerForTool: () => ({
		id: "local-key",
		getAddress: vi
			.fn()
			.mockResolvedValue("0x1234567890123456789012345678901234567890"),
		signAndSend: mockSignAndSend,
	}),
}));

import {
	clearAllWorkers,
	createAgentWorkerTools,
	getWorkerIds,
	getWorkerState,
} from "./agent-worker.js";

type ToolResult = {
	content: { type: string; text: string }[];
	details?: Record<string, unknown>;
};

function findTool(name: string) {
	const tools = createAgentWorkerTools();
	const tool = tools.find((t) => t.name.endsWith(name));
	if (!tool) throw new Error(`Tool ${name} not found`);
	return tool as unknown as {
		name: string;
		execute(id: string, params: Record<string, unknown>): Promise<ToolResult>;
	};
}

const ACCOUNT = "0x1234567890123456789012345678901234567890";

function mockEmptyPosition() {
	mockGetMarkets.mockResolvedValueOnce([]);
	mockGetAccountPosition.mockResolvedValueOnce({
		protocol: "venus",
		network: "bsc",
		account: ACCOUNT,
		supplies: [],
		borrows: [],
		totalCollateralValueUsd: "0",
		totalBorrowValueUsd: "0",
		currentLTV: 0,
		liquidationLTV: 0.8,
		healthFactor: Number.POSITIVE_INFINITY,
	});
}

afterEach(() => {
	vi.clearAllMocks();
	clearAllWorkers();
});

// -----------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------
describe("agentWorkerStart", () => {
	it("starts a dry-run worker", async () => {
		mockEmptyPosition();

		const tool = findTool("agentWorkerStart");
		const result = await tool.execute("w1", {
			network: "bsc",
			account: ACCOUNT,
			intervalSeconds: 60,
		});

		expect(result.content[0].text).toContain("started");
		expect(result.content[0].text).toContain("dry-run");
		const d = result.details as Record<string, unknown>;
		expect(d.schema).toBe("evm.agent.worker.start.v1");
		expect(d.dryRun).toBe(true);
		expect(d.signerBackend).toBe("none (dry-run)");

		// Worker should exist
		expect(getWorkerIds()).toHaveLength(1);
	});

	it("starts a live worker with signer", async () => {
		mockEmptyPosition();

		const tool = findTool("agentWorkerStart");
		const result = await tool.execute("w2", {
			network: "bsc",
			account: ACCOUNT,
			dryRun: false,
			intervalSeconds: 60,
		});

		expect(result.content[0].text).toContain("LIVE");
		const d = result.details as Record<string, unknown>;
		expect(d.dryRun).toBe(false);
		expect(d.signerBackend).toBe("local-key");
	});

	it("rejects duplicate worker", async () => {
		mockEmptyPosition();

		const tool = findTool("agentWorkerStart");
		await tool.execute("w3a", {
			network: "bsc",
			account: ACCOUNT,
		});

		mockEmptyPosition();

		await expect(
			tool.execute("w3b", {
				network: "bsc",
				account: ACCOUNT,
			}),
		).rejects.toThrow("already running");
	});

	it("rejects invalid account", async () => {
		const tool = findTool("agentWorkerStart");
		await expect(
			tool.execute("w4", { network: "bsc", account: "bad" }),
		).rejects.toThrow("valid EVM address");
	});

	it("accepts custom config", async () => {
		mockEmptyPosition();

		const tool = findTool("agentWorkerStart");
		const result = await tool.execute("w5", {
			network: "bsc",
			account: ACCOUNT,
			maxLTV: 0.5,
			targetLTV: 0.3,
			minYieldSpread: 0.01,
		});

		const config = (result.details as Record<string, unknown>).config as Record<
			string,
			unknown
		>;
		expect(config.maxLTV).toBe(0.5);
		expect(config.targetLTV).toBe(0.3);
	});

	it("runs first cycle immediately and logs it", async () => {
		mockEmptyPosition();

		const tool = findTool("agentWorkerStart");
		await tool.execute("w6", {
			network: "bsc",
			account: ACCOUNT,
			intervalSeconds: 3600,
		});

		// Wait a tick for the async cycle to complete
		await new Promise((r) => setTimeout(r, 50));

		const state = getWorkerState(`bsc:${ACCOUNT.toLowerCase()}`);
		expect(state).toBeDefined();
		expect(state?.cycleCount).toBeGreaterThanOrEqual(1);
		expect(state?.recentLogs.length).toBeGreaterThanOrEqual(1);
	});
});

// -----------------------------------------------------------------------
// Stop
// -----------------------------------------------------------------------
describe("agentWorkerStop", () => {
	it("stops a specific worker", async () => {
		mockEmptyPosition();

		const startTool = findTool("agentWorkerStart");
		await startTool.execute("s1a", {
			network: "bsc",
			account: ACCOUNT,
		});

		const stopTool = findTool("agentWorkerStop");
		const result = await stopTool.execute("s1b", {
			workerId: `bsc:${ACCOUNT.toLowerCase()}`,
		});

		expect(result.content[0].text).toContain("stopped");
		const state = getWorkerState(`bsc:${ACCOUNT.toLowerCase()}`);
		expect(state?.status).toBe("stopped");
	});

	it("stops all workers", async () => {
		mockEmptyPosition();

		const startTool = findTool("agentWorkerStart");
		await startTool.execute("s2a", {
			network: "bsc",
			account: ACCOUNT,
		});

		const stopTool = findTool("agentWorkerStop");
		const result = await stopTool.execute("s2b", {});

		expect(result.content[0].text).toContain("1 worker(s)");
	});

	it("throws for nonexistent worker", async () => {
		const tool = findTool("agentWorkerStop");
		await expect(
			tool.execute("s3", { workerId: "bsc:0xnonexistent" }),
		).rejects.toThrow("not found");
	});
});

// -----------------------------------------------------------------------
// Status
// -----------------------------------------------------------------------
describe("agentWorkerStatus", () => {
	it("returns empty state when no workers", async () => {
		const tool = findTool("agentWorkerStatus");
		const result = await tool.execute("st1", {});

		const d = result.details as Record<string, unknown>;
		expect(d.totalWorkers).toBe(0);
		expect(d.runningCount).toBe(0);
	});

	it("returns worker details with logs", async () => {
		mockEmptyPosition();

		const startTool = findTool("agentWorkerStart");
		await startTool.execute("st2a", {
			network: "bsc",
			account: ACCOUNT,
			intervalSeconds: 3600,
		});

		// Wait for cycle
		await new Promise((r) => setTimeout(r, 50));

		const tool = findTool("agentWorkerStatus");
		const result = await tool.execute("st2b", {
			workerId: `bsc:${ACCOUNT.toLowerCase()}`,
		});

		const d = result.details as Record<string, unknown>;
		expect(d.schema).toBe("evm.agent.worker.status.v1");
		const worker = d.worker as Record<string, unknown>;
		expect(worker.status).toBe("running");
		expect(worker.network).toBe("bsc");
	});

	it("respects logLimit", async () => {
		mockEmptyPosition();

		const startTool = findTool("agentWorkerStart");
		await startTool.execute("st3a", {
			network: "bsc",
			account: ACCOUNT,
		});

		await new Promise((r) => setTimeout(r, 50));

		const tool = findTool("agentWorkerStatus");
		const result = await tool.execute("st3b", {
			workerId: `bsc:${ACCOUNT.toLowerCase()}`,
			logLimit: 1,
		});

		const worker = (result.details as Record<string, unknown>).worker as Record<
			string,
			unknown
		>;
		const logs = worker.recentLogs as unknown[];
		expect(logs.length).toBeLessThanOrEqual(1);
	});
});

// -----------------------------------------------------------------------
// Webhook notifications
// -----------------------------------------------------------------------
describe("webhook notifications", () => {
	it("includes webhookUrl in start details when provided", async () => {
		mockEmptyPosition();

		const tool = findTool("agentWorkerStart");
		const result = await tool.execute("wh1", {
			network: "bsc",
			account: ACCOUNT,
			webhookUrl: "https://hooks.example.com/agent",
		});

		const d = result.details as Record<string, unknown>;
		expect(d.webhookUrl).toBe("https://hooks.example.com/agent");
	});

	it("returns null webhookUrl when not configured", async () => {
		mockEmptyPosition();

		const tool = findTool("agentWorkerStart");
		const result = await tool.execute("wh2", {
			network: "bsc",
			account: ACCOUNT,
		});

		const d = result.details as Record<string, unknown>;
		expect(d.webhookUrl).toBeNull();
	});

	it("fires webhook on worker stop", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("ok", { status: 200 }));

		mockEmptyPosition();

		const startTool = findTool("agentWorkerStart");
		await startTool.execute("wh3a", {
			network: "bsc",
			account: ACCOUNT,
			webhookUrl: "https://hooks.example.com/stop-test",
		});

		// Wait for first cycle
		await new Promise((r) => setTimeout(r, 50));

		const stopTool = findTool("agentWorkerStop");
		await stopTool.execute("wh3b", {
			workerId: `bsc:${ACCOUNT.toLowerCase()}`,
		});

		// Wait for async webhook fire
		await new Promise((r) => setTimeout(r, 50));

		const webhookCalls = fetchSpy.mock.calls.filter(
			(c) => String(c[0]) === "https://hooks.example.com/stop-test",
		);
		expect(webhookCalls.length).toBeGreaterThanOrEqual(1);

		const lastCall = webhookCalls[webhookCalls.length - 1];
		const body = JSON.parse((lastCall[1] as RequestInit).body as string);
		expect(body.event).toBe("worker_stopped");
		expect(body.workerId).toContain("bsc:");
		expect(body.data.reason).toBe("manual_stop");

		fetchSpy.mockRestore();
	});

	it("webhook failure does not throw", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("network error"));

		mockEmptyPosition();

		const startTool = findTool("agentWorkerStart");
		// Should not throw despite webhook failure
		await startTool.execute("wh4", {
			network: "bsc",
			account: ACCOUNT,
			webhookUrl: "https://hooks.example.com/fail-test",
		});

		await new Promise((r) => setTimeout(r, 50));

		// Worker should still be running
		const state = getWorkerState(`bsc:${ACCOUNT.toLowerCase()}`);
		expect(state?.status).toBe("running");

		fetchSpy.mockRestore();
	});
});
