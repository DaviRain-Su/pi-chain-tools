import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearAllYieldWorkers,
	createNearYieldWorkerTools,
	getYieldWorkerIds,
	getYieldWorkerState,
} from "./yield-worker.js";

// Mock the read tools to avoid real RPC calls
vi.mock("./read.js", () => {
	const mockStableYieldPlan = {
		selected: {
			tokenId: "usdc.token.near",
			symbol: "USDC",
			supplyApr: "4.25",
		},
		candidates: [
			{
				tokenId: "usdc.token.near",
				symbol: "USDC",
				supplyApr: "4.25",
			},
			{
				tokenId: "usdt.token.near",
				symbol: "USDT",
				supplyApr: "3.80",
			},
		],
	};

	const mockPosition = {
		supplied: [
			{
				tokenId: "usdt.token.near",
				symbol: "USDT",
				apr: "3.10",
			},
		],
	};

	return {
		createNearReadTools: () => [
			{
				name: "near_getStableYieldPlan",
				execute: async () => ({
					details: mockStableYieldPlan,
				}),
			},
			{
				name: "near_getLendingPositionsBurrow",
				execute: async () => ({
					details: mockPosition,
				}),
			},
		],
	};
});

describe("NEAR yield worker", () => {
	afterEach(() => {
		clearAllYieldWorkers();
	});

	function findTool(name: string) {
		const tools = createNearYieldWorkerTools();
		const tool = tools.find((t) => t.name === name);
		if (!tool) throw new Error(`Tool not found: ${name}`);
		return {
			...tool,
			execute: tool.execute as (
				id: string,
				params: Record<string, unknown>,
			) => Promise<{
				content: { type: string; text: string }[];
				details?: Record<string, unknown>;
			}>,
		};
	}

	it("starts a yield worker and returns immediately", async () => {
		const tool = findTool("near_yieldWorkerStart");
		const result = await tool.execute("test-1", {
			network: "testnet",
			accountId: "alice.testnet",
			dryRun: true,
			intervalSeconds: 9999, // don't auto-cycle in test
		});

		expect(result.details).toBeDefined();
		expect((result.details as Record<string, unknown>).workerId).toBe(
			"near:testnet:alice.testnet",
		);
		expect((result.details as Record<string, unknown>).dryRun).toBe(true);
		expect(getYieldWorkerIds()).toContain("near:testnet:alice.testnet");
	});

	it("rejects duplicate start for same account", async () => {
		const tool = findTool("near_yieldWorkerStart");
		await tool.execute("test-2a", {
			network: "testnet",
			accountId: "bob.testnet",
			intervalSeconds: 9999,
		});

		await expect(
			tool.execute("test-2b", {
				network: "testnet",
				accountId: "bob.testnet",
				intervalSeconds: 9999,
			}),
		).rejects.toThrow("already running");
	});

	it("stops a running worker", async () => {
		const startTool = findTool("near_yieldWorkerStart");
		await startTool.execute("test-3a", {
			network: "testnet",
			accountId: "carol.testnet",
			intervalSeconds: 9999,
		});

		const stopTool = findTool("near_yieldWorkerStop");
		const result = await stopTool.execute("test-3b", {
			network: "testnet",
			accountId: "carol.testnet",
		});

		expect((result.details as Record<string, unknown>).found).toBe(true);
		const state = getYieldWorkerState("near:testnet:carol.testnet");
		expect(state?.status).toBe("stopped");
	});

	it("returns not-found for non-existent worker stop", async () => {
		const stopTool = findTool("near_yieldWorkerStop");
		const result = await stopTool.execute("test-4", {
			network: "testnet",
			accountId: "nobody.testnet",
		});
		expect((result.details as Record<string, unknown>).found).toBe(false);
	});

	it("returns status for running worker after first cycle", async () => {
		const startTool = findTool("near_yieldWorkerStart");
		await startTool.execute("test-5a", {
			network: "testnet",
			accountId: "dave.testnet",
			intervalSeconds: 9999,
		});

		// Wait for first cycle to complete
		await new Promise((r) => setTimeout(r, 100));

		const statusTool = findTool("near_yieldWorkerStatus");
		const result = await statusTool.execute("test-5b", {
			network: "testnet",
			accountId: "dave.testnet",
		});

		const details = result.details as Record<string, unknown>;
		expect(details.found).toBe(true);
		expect(details.status).toBe("running");
		expect((details.cycleCount as number) >= 1).toBe(true);
	});

	function lastLogOf(workerId: string) {
		const state = getYieldWorkerState(workerId);
		expect(state).toBeDefined();
		const logs = state?.recentLogs ?? [];
		expect(logs.length).toBeGreaterThan(0);
		return logs[logs.length - 1];
	}

	it("detects rebalance opportunity when better APR exists", async () => {
		const startTool = findTool("near_yieldWorkerStart");
		await startTool.execute("test-6", {
			network: "testnet",
			accountId: "eve.testnet",
			intervalSeconds: 9999,
			minAprDelta: 0.5,
		});

		// Wait for first cycle
		await new Promise((r) => setTimeout(r, 100));

		const lastLog = lastLogOf("near:testnet:eve.testnet");
		// Mock: USDC 4.25% vs current USDT 3.10% = delta 1.15% > 0.5% threshold
		expect(lastLog.decision.action).toBe("rebalance");
		expect(lastLog.decision.bestSymbol).toBe("USDC");
		expect(lastLog.decision.currentSymbol).toBe("USDT");
		expect(lastLog.decision.aprDelta).toBeCloseTo(1.15, 1);
	});

	it("holds when APR delta is below threshold", async () => {
		const startTool = findTool("near_yieldWorkerStart");
		await startTool.execute("test-7", {
			network: "testnet",
			accountId: "frank.testnet",
			intervalSeconds: 9999,
			minAprDelta: 5.0, // Very high threshold
		});

		await new Promise((r) => setTimeout(r, 100));

		const lastLog = lastLogOf("near:testnet:frank.testnet");
		expect(lastLog.decision.action).toBe("hold");
		expect(lastLog.decision.reason).toContain("below threshold");
	});

	it("respects paused config", async () => {
		const startTool = findTool("near_yieldWorkerStart");
		await startTool.execute("test-8", {
			network: "testnet",
			accountId: "grace.testnet",
			intervalSeconds: 9999,
			paused: true,
		});

		await new Promise((r) => setTimeout(r, 100));

		const lastLog = lastLogOf("near:testnet:grace.testnet");
		expect(lastLog.decision.action).toBe("hold");
		expect(lastLog.decision.reason).toContain("paused");
	});

	it("reports dryRun correctly — no execution in dry mode", async () => {
		const startTool = findTool("near_yieldWorkerStart");
		await startTool.execute("test-9", {
			network: "testnet",
			accountId: "heidi.testnet",
			dryRun: true,
			intervalSeconds: 9999,
			minAprDelta: 0.5,
		});

		await new Promise((r) => setTimeout(r, 100));

		const lastLog = lastLogOf("near:testnet:heidi.testnet");
		// Decision should be rebalance, but executed should be false (dryRun)
		expect(lastLog.decision.action).toBe("rebalance");
		expect(lastLog.executed).toBe(false);
	});

	it("clears all workers", async () => {
		const startTool = findTool("near_yieldWorkerStart");
		await startTool.execute("test-10a", {
			network: "testnet",
			accountId: "ivan.testnet",
			intervalSeconds: 9999,
		});
		await startTool.execute("test-10b", {
			network: "testnet",
			accountId: "judy.testnet",
			intervalSeconds: 9999,
		});

		expect(getYieldWorkerIds().length).toBe(2);
		clearAllYieldWorkers();
		expect(getYieldWorkerIds().length).toBe(0);
	});
});
