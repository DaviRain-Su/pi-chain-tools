import { describe, expect, it, vi } from "vitest";

// Mock venus-adapter
const mockGetMarkets = vi.fn();
const mockGetAccountPosition = vi.fn();
const mockBuildSupplyCalldata = vi.fn();
const mockBuildBorrowCalldata = vi.fn();
const mockBuildRepayCalldata = vi.fn();
const mockBuildWithdrawCalldata = vi.fn();
const mockBuildEnterMarketCalldata = vi.fn();

vi.mock("./venus-adapter.js", () => ({
	createVenusAdapter: () => ({
		protocolId: "venus",
		getMarkets: mockGetMarkets,
		getAccountPosition: mockGetAccountPosition,
		buildSupplyCalldata: mockBuildSupplyCalldata,
		buildBorrowCalldata: mockBuildBorrowCalldata,
		buildRepayCalldata: mockBuildRepayCalldata,
		buildWithdrawCalldata: mockBuildWithdrawCalldata,
		buildEnterMarketCalldata: mockBuildEnterMarketCalldata,
	}),
	VENUS_MARKET_REGISTRY: {
		vUSDC: {
			vToken: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
			underlying: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
			symbol: "USDC",
			decimals: 18,
		},
		vBNB: {
			vToken: "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
			underlying: "0x0000000000000000000000000000000000000000",
			symbol: "BNB",
			decimals: 18,
		},
	},
}));

import { createVenusWorkflowTools } from "./venus-workflow.js";

type ToolResult = {
	content: { type: string; text: string }[];
	details?: Record<string, unknown>;
};

function getWorkflowTool() {
	const tools = createVenusWorkflowTools();
	const tool = tools.find((t) => t.name.endsWith("venusWorkflow"));
	if (!tool) throw new Error("venusWorkflow tool not found");
	return tool as unknown as {
		name: string;
		execute(id: string, params: Record<string, unknown>): Promise<ToolResult>;
	};
}

const USDC_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const VUSDC_ADDRESS = "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8";

// -----------------------------------------------------------------------
// Analysis
// -----------------------------------------------------------------------
describe("venus workflow — analysis", () => {
	it("returns market analysis without position", async () => {
		mockGetMarkets.mockResolvedValueOnce([
			{
				protocol: "venus",
				network: "bsc",
				marketAddress: VUSDC_ADDRESS,
				underlyingSymbol: "USDC",
				supplyAPY: 3.5,
				borrowAPY: 5.2,
				collateralFactor: 0.75,
				isListed: true,
			},
		]);

		const tool = getWorkflowTool();
		const result = await tool.execute("a1", {
			network: "bsc",
			runMode: "analysis",
		});

		expect(result.details?.schema).toBe("evm.venus.workflow.analysis.v1");
		expect(result.details?.runMode).toBe("analysis");
		expect(result.details?.marketsCount).toBe(1);
		expect(result.details?.position).toBeNull();
		expect(result.details?.runId).toBeDefined();
		expect(result.content[0].text).toContain("Venus analysis");
	});

	it("returns analysis with position when account provided", async () => {
		mockGetMarkets.mockResolvedValueOnce([]);
		mockGetAccountPosition.mockResolvedValueOnce({
			protocol: "venus",
			network: "bsc",
			account: "0x1234567890123456789012345678901234567890",
			supplies: [],
			borrows: [],
			currentLTV: 0.5,
			liquidationLTV: 0.8,
			healthFactor: 2.5,
			totalCollateralValueUsd: "1000",
			totalBorrowValueUsd: "500",
		});

		const tool = getWorkflowTool();
		const result = await tool.execute("a2", {
			network: "bsc",
			runMode: "analysis",
			account: "0x1234567890123456789012345678901234567890",
		});

		expect(result.details?.position).not.toBeNull();
		const pos = result.details?.position as Record<string, unknown>;
		expect(pos.currentLTV).toBe("50.00%");
	});
});

// -----------------------------------------------------------------------
// Simulate
// -----------------------------------------------------------------------
describe("venus workflow — simulate", () => {
	it("builds supply calldata and returns confirmToken for mainnet", async () => {
		mockBuildSupplyCalldata.mockResolvedValueOnce([
			{ to: USDC_ADDRESS, data: "0xapprove", description: "Approve USDC" },
			{ to: VUSDC_ADDRESS, data: "0xmint", description: "Supply USDC" },
		]);

		const tool = getWorkflowTool();
		const result = await tool.execute("s1", {
			network: "bsc",
			runMode: "simulate",
			intentType: "evm.venus.supply",
			tokenAddress: USDC_ADDRESS,
			amountRaw: "1000000000000000000",
		});

		expect(result.details?.schema).toBe("evm.venus.workflow.simulate.v1");
		expect(result.details?.runMode).toBe("simulate");
		expect(result.details?.stepsCount).toBe(2);
		expect(result.details?.mainnetLike).toBe(true);
		expect(result.details?.confirmToken).toBeDefined();
		expect(result.details?.approvalRequired).toBe(true);
		expect(typeof result.details?.runId).toBe("string");
	});

	it("builds borrow calldata with tokenSymbol shorthand", async () => {
		mockBuildBorrowCalldata.mockResolvedValueOnce({
			to: VUSDC_ADDRESS,
			data: "0xborrow",
			description: "Borrow USDC",
		});

		const tool = getWorkflowTool();
		const result = await tool.execute("s2", {
			network: "bsc",
			runMode: "simulate",
			intentType: "evm.venus.borrow",
			tokenSymbol: "USDC",
			amountRaw: "500000000000000000000",
		});

		expect(result.details?.stepsCount).toBe(1);
		// Should have resolved tokenSymbol → vToken market address
		const intent = result.details?.intent as Record<string, unknown>;
		expect(intent.type).toBe("evm.venus.borrow");
		expect(intent.marketAddress).toBe(VUSDC_ADDRESS);
	});

	it("rejects missing intentType", async () => {
		const tool = getWorkflowTool();
		await expect(
			tool.execute("s3", {
				network: "bsc",
				runMode: "simulate",
				tokenAddress: USDC_ADDRESS,
				amountRaw: "1000",
			}),
		).rejects.toThrow("intentType is required");
	});

	it("rejects supply without amountRaw", async () => {
		const tool = getWorkflowTool();
		await expect(
			tool.execute("s4", {
				network: "bsc",
				runMode: "simulate",
				intentType: "evm.venus.supply",
				tokenAddress: USDC_ADDRESS,
			}),
		).rejects.toThrow("requires amountRaw");
	});

	it("rejects supply without tokenAddress", async () => {
		const tool = getWorkflowTool();
		await expect(
			tool.execute("s5", {
				network: "bsc",
				runMode: "simulate",
				intentType: "evm.venus.supply",
				amountRaw: "1000",
			}),
		).rejects.toThrow("requires tokenAddress or tokenSymbol");
	});
});

// -----------------------------------------------------------------------
// Execute
// -----------------------------------------------------------------------
describe("venus workflow — execute", () => {
	it("rejects when no session exists", async () => {
		const tool = getWorkflowTool();
		await expect(
			tool.execute("e1", {
				network: "bsc",
				runMode: "execute",
				runId: "nonexistent-run-id",
				confirmMainnet: true,
			}),
		).rejects.toThrow("No simulate session found");
	});

	it("rejects mainnet execute without confirmMainnet", async () => {
		// First simulate to create session
		mockBuildSupplyCalldata.mockResolvedValueOnce([
			{ to: VUSDC_ADDRESS, data: "0xmint", description: "Supply" },
		]);

		const tool = getWorkflowTool();
		const simResult = await tool.execute("e2-sim", {
			network: "bsc",
			runMode: "simulate",
			intentType: "evm.venus.supply",
			tokenAddress: USDC_ADDRESS,
			amountRaw: "1000000000000000000",
		});

		const runId = simResult.details?.runId as string;

		await expect(
			tool.execute("e2-exec", {
				network: "bsc",
				runMode: "execute",
				runId,
				// missing confirmMainnet
			}),
		).rejects.toThrow("confirmMainnet");
	});

	it("rejects mainnet execute with wrong confirmToken", async () => {
		mockBuildSupplyCalldata.mockResolvedValueOnce([
			{ to: VUSDC_ADDRESS, data: "0xmint", description: "Supply" },
		]);

		const tool = getWorkflowTool();
		const simResult = await tool.execute("e3-sim", {
			network: "bsc",
			runMode: "simulate",
			intentType: "evm.venus.supply",
			tokenAddress: USDC_ADDRESS,
			amountRaw: "1000000000000000000",
		});

		const runId = simResult.details?.runId as string;

		await expect(
			tool.execute("e3-exec", {
				network: "bsc",
				runMode: "execute",
				runId,
				confirmMainnet: true,
				confirmToken: "WRONG-TOKEN",
			}),
		).rejects.toThrow("Invalid confirmToken");
	});

	it("builds enterMarkets calldata", async () => {
		mockBuildEnterMarketCalldata.mockResolvedValueOnce({
			to: "0xfD36E2c2a6789Db23113685031d7F16329158384",
			data: "0xenter",
			description: "Enter 1 market",
		});

		const tool = getWorkflowTool();
		const result = await tool.execute("e4-sim", {
			network: "bsc",
			runMode: "simulate",
			intentType: "evm.venus.enterMarkets",
			marketAddresses: [VUSDC_ADDRESS],
		});

		expect(result.details?.stepsCount).toBe(1);
		const intent = result.details?.intent as Record<string, unknown>;
		expect(intent.type).toBe("evm.venus.enterMarkets");
	});

	it("builds withdraw calldata", async () => {
		mockBuildWithdrawCalldata.mockResolvedValueOnce({
			to: VUSDC_ADDRESS,
			data: "0xredeem",
			description: "Withdraw 100 USDC",
		});

		const tool = getWorkflowTool();
		const result = await tool.execute("e5-sim", {
			network: "bsc",
			runMode: "simulate",
			intentType: "evm.venus.withdraw",
			tokenAddress: USDC_ADDRESS,
			amountRaw: "100000000000000000000",
		});

		expect(result.details?.stepsCount).toBe(1);
	});

	it("builds repay calldata", async () => {
		mockBuildRepayCalldata.mockResolvedValueOnce([
			{ to: USDC_ADDRESS, data: "0xapprove", description: "Approve" },
			{ to: VUSDC_ADDRESS, data: "0xrepay", description: "Repay" },
		]);

		const tool = getWorkflowTool();
		const result = await tool.execute("e6-sim", {
			network: "bsc",
			runMode: "simulate",
			intentType: "evm.venus.repay",
			tokenAddress: USDC_ADDRESS,
			amountRaw: "50000000000000000000",
		});

		expect(result.details?.stepsCount).toBe(2);
	});
});
