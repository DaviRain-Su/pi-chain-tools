import { afterEach, describe, expect, it, vi } from "vitest";

// Mock venus-adapter
const mockGetMarkets = vi.fn();
const mockGetAccountPosition = vi.fn();

vi.mock("./venus-adapter.js", () => ({
	createVenusAdapter: () => ({
		protocolId: "venus",
		getMarkets: mockGetMarkets,
		getAccountPosition: mockGetAccountPosition,
	}),
}));

import {
	clearAgentAuditLog,
	createVenusAgentTools,
	getAgentAuditLog,
} from "./venus-agent.js";

type ToolResult = {
	content: { type: string; text: string }[];
	details?: Record<string, unknown>;
};

function findTool(name: string) {
	const tools = createVenusAgentTools();
	const tool = tools.find((t) => t.name.endsWith(name));
	if (!tool) throw new Error(`Tool ${name} not found`);
	return tool as unknown as {
		name: string;
		execute(id: string, params: Record<string, unknown>): Promise<ToolResult>;
	};
}

const ACCOUNT = "0x1234567890123456789012345678901234567890";

function mockMarkets(supplyAPY = 5.0, borrowAPY = 8.0) {
	mockGetMarkets.mockResolvedValueOnce([
		{
			protocol: "venus",
			network: "bsc",
			marketAddress: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
			underlyingAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
			underlyingSymbol: "USDC",
			underlyingDecimals: 18,
			supplyAPY,
			borrowAPY,
			totalSupply: "1000000",
			totalBorrow: "500000",
			collateralFactor: 0.75,
			isCollateral: true,
			isListed: true,
		},
	]);
}

function mockPosition(opts: {
	collateralUsd?: string;
	borrowUsd?: string;
	supplyBal?: string;
	borrowBal?: string;
}) {
	const supplies =
		opts.supplyBal && BigInt(opts.supplyBal) > 0n
			? [
					{
						marketAddress: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
						underlyingAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
						underlyingSymbol: "USDC",
						underlyingDecimals: 18,
						balanceRaw: opts.supplyBal,
						balanceFormatted: "1000",
					},
				]
			: [];
	const borrows =
		opts.borrowBal && BigInt(opts.borrowBal) > 0n
			? [
					{
						marketAddress: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
						underlyingAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
						underlyingSymbol: "USDC",
						underlyingDecimals: 18,
						balanceRaw: opts.borrowBal,
						balanceFormatted: "500",
					},
				]
			: [];

	mockGetAccountPosition.mockResolvedValueOnce({
		protocol: "venus",
		network: "bsc",
		account: ACCOUNT,
		supplies,
		borrows,
		totalCollateralValueUsd: opts.collateralUsd ?? "0",
		totalBorrowValueUsd: opts.borrowUsd ?? "0",
		currentLTV: 0,
		liquidationLTV: 0.8,
		healthFactor: Number.POSITIVE_INFINITY,
	});
}

afterEach(() => {
	vi.clearAllMocks();
	clearAgentAuditLog();
});

// -----------------------------------------------------------------------
// Agent Check
// -----------------------------------------------------------------------
describe("venusAgentCheck", () => {
	it("returns hold when no position", async () => {
		mockMarkets();
		mockPosition({});

		const tool = findTool("venusAgentCheck");
		const result = await tool.execute("c1", {
			network: "bsc",
			account: ACCOUNT,
		});

		expect(result.content[0].text).toContain("action=hold");
		const details = result.details as Record<string, unknown>;
		expect(details.schema).toBe("evm.venus.agent.check.v1");
		const decision = details.decision as Record<string, unknown>;
		expect(decision.action).toBe("hold");
		expect(decision.reason).toContain("No active position");
	});

	it("returns hold when LTV is in safe range", async () => {
		mockMarkets(5.0, 8.0);
		mockPosition({
			collateralUsd: "1000",
			borrowUsd: "500",
			supplyBal: "1000000000000000000000",
			borrowBal: "500000000000000000000",
		});

		const tool = findTool("venusAgentCheck");
		const result = await tool.execute("c2", {
			network: "bsc",
			account: ACCOUNT,
		});

		const decision = (result.details as Record<string, unknown>)
			.decision as Record<string, unknown>;
		expect(decision.action).toBe("hold");
		// LTV = 500/1000 = 0.50 which is in [0.48..0.7125] safe range
		expect(decision.currentLTV).toBe("50.00%");
	});

	it("returns repay when LTV near liquidation", async () => {
		mockMarkets(5.0, 8.0);
		mockPosition({
			collateralUsd: "1000",
			borrowUsd: "730",
			supplyBal: "1000000000000000000000",
			borrowBal: "730000000000000000000",
		});

		const tool = findTool("venusAgentCheck");
		const result = await tool.execute("c3", {
			network: "bsc",
			account: ACCOUNT,
		});

		const decision = (result.details as Record<string, unknown>)
			.decision as Record<string, unknown>;
		expect(decision.action).toBe("repay");
		expect(decision.currentLTV).toBe("73.00%");
		expect(decision.repayAmountUsd).toBeDefined();
	});

	it("returns optimize when LTV low and yield spread positive", async () => {
		// Supply APY > Borrow APR → positive spread
		mockMarkets(10.0, 5.0);
		mockPosition({
			collateralUsd: "1000",
			borrowUsd: "100",
			supplyBal: "1000000000000000000000",
			borrowBal: "100000000000000000000",
		});

		const tool = findTool("venusAgentCheck");
		const result = await tool.execute("c4", {
			network: "bsc",
			account: ACCOUNT,
		});

		const decision = (result.details as Record<string, unknown>)
			.decision as Record<string, unknown>;
		expect(decision.action).toBe("optimize");
		expect(decision.borrowMoreUsd).toBeDefined();
	});

	it("returns hold when paused=true regardless of position", async () => {
		mockMarkets(10.0, 5.0);
		mockPosition({
			collateralUsd: "1000",
			borrowUsd: "730",
			supplyBal: "1000000000000000000000",
			borrowBal: "730000000000000000000",
		});

		const tool = findTool("venusAgentCheck");
		const result = await tool.execute("c5", {
			network: "bsc",
			account: ACCOUNT,
			paused: true,
		});

		const decision = (result.details as Record<string, unknown>)
			.decision as Record<string, unknown>;
		expect(decision.action).toBe("hold");
		expect(decision.reason).toContain("paused");
	});

	it("uses custom config params", async () => {
		mockMarkets(10.0, 5.0);
		mockPosition({
			collateralUsd: "1000",
			borrowUsd: "100",
			supplyBal: "1000000000000000000000",
			borrowBal: "100000000000000000000",
		});

		const tool = findTool("venusAgentCheck");
		const result = await tool.execute("c6", {
			network: "bsc",
			account: ACCOUNT,
			maxLTV: 0.5,
			targetLTV: 0.3,
			minYieldSpread: 0.01,
		});

		const details = result.details as Record<string, unknown>;
		const config = details.config as Record<string, unknown>;
		expect(config.maxLTV).toBe(0.5);
		expect(config.targetLTV).toBe(0.3);
		expect(config.minYieldSpread).toBe(0.01);
	});

	it("rejects invalid account address", async () => {
		const tool = findTool("venusAgentCheck");
		await expect(
			tool.execute("c7", { network: "bsc", account: "bad" }),
		).rejects.toThrow("valid EVM address");
	});

	it("records audit log entry", async () => {
		mockMarkets();
		mockPosition({});

		expect(getAgentAuditLog()).toHaveLength(0);

		const tool = findTool("venusAgentCheck");
		await tool.execute("c8", { network: "bsc", account: ACCOUNT });

		expect(getAgentAuditLog()).toHaveLength(1);
		expect(getAgentAuditLog()[0].account).toBe(ACCOUNT);
		expect(getAgentAuditLog()[0].action.action).toBe("hold");
	});
});

// -----------------------------------------------------------------------
// Audit Log Tool
// -----------------------------------------------------------------------
describe("venusAgentAuditLog", () => {
	it("returns empty log initially", async () => {
		const tool = findTool("venusAgentAuditLog");
		const result = await tool.execute("al1", {});

		const details = result.details as Record<string, unknown>;
		expect(details.totalEntries).toBe(0);
		expect(details.returnedEntries).toBe(0);
	});

	it("returns entries after check calls", async () => {
		// Do two checks
		mockMarkets();
		mockPosition({});
		const checkTool = findTool("venusAgentCheck");
		await checkTool.execute("al2a", { network: "bsc", account: ACCOUNT });

		mockMarkets();
		mockPosition({});
		await checkTool.execute("al2b", { network: "bsc", account: ACCOUNT });

		const tool = findTool("venusAgentAuditLog");
		const result = await tool.execute("al2c", { limit: 10 });

		const details = result.details as Record<string, unknown>;
		expect(details.totalEntries).toBe(2);
		expect(details.returnedEntries).toBe(2);
	});

	it("respects limit param", async () => {
		mockMarkets();
		mockPosition({});
		const checkTool = findTool("venusAgentCheck");
		await checkTool.execute("al3a", { network: "bsc", account: ACCOUNT });

		mockMarkets();
		mockPosition({});
		await checkTool.execute("al3b", { network: "bsc", account: ACCOUNT });

		mockMarkets();
		mockPosition({});
		await checkTool.execute("al3c", { network: "bsc", account: ACCOUNT });

		const tool = findTool("venusAgentAuditLog");
		const result = await tool.execute("al3d", { limit: 2 });

		const details = result.details as Record<string, unknown>;
		expect(details.totalEntries).toBe(3);
		expect(details.returnedEntries).toBe(2);
	});
});
