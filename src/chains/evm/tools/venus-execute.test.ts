import { describe, expect, it, vi } from "vitest";

// Mock venus-adapter
const mockBuildSupplyCalldata = vi.fn();
const mockBuildBorrowCalldata = vi.fn();
const mockBuildRepayCalldata = vi.fn();
const mockBuildWithdrawCalldata = vi.fn();
const mockBuildEnterMarketCalldata = vi.fn();

vi.mock("./venus-adapter.js", () => ({
	createVenusAdapter: () => ({
		protocolId: "venus",
		buildSupplyCalldata: mockBuildSupplyCalldata,
		buildBorrowCalldata: mockBuildBorrowCalldata,
		buildRepayCalldata: mockBuildRepayCalldata,
		buildWithdrawCalldata: mockBuildWithdrawCalldata,
		buildEnterMarketCalldata: mockBuildEnterMarketCalldata,
	}),
}));

import { createVenusExecuteTools } from "./venus-execute.js";

type ToolResult = {
	content: { type: string; text: string }[];
	details?: Record<string, unknown>;
};

function findTool(name: string) {
	const tools = createVenusExecuteTools();
	const tool = tools.find((t) => t.name.endsWith(name));
	if (!tool) throw new Error(`Tool ${name} not found`);
	return tool as unknown as {
		name: string;
		execute(id: string, params: Record<string, unknown>): Promise<ToolResult>;
	};
}

const USDC_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const VUSDC_ADDRESS = "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8";

// -----------------------------------------------------------------------
// Supply
// -----------------------------------------------------------------------
describe("venusSupply", () => {
	it("returns preview in dryRun mode (default)", async () => {
		mockBuildSupplyCalldata.mockResolvedValueOnce([
			{ to: USDC_ADDRESS, data: "0xapprove...", description: "Approve USDC" },
			{ to: VUSDC_ADDRESS, data: "0xmint...", description: "Supply USDC" },
		]);

		const tool = findTool("venusSupply");
		const result = await tool.execute("t1", {
			network: "bsc",
			tokenAddress: USDC_ADDRESS,
			amountRaw: "1000000000000000000",
		});

		expect(result.details?.dryRun).toBe(true);
		expect(result.details?.schema).toBe("evm.venus.supply.preview.v1");
		expect(result.content[0].text).toContain("preview");
		const steps = result.details?.steps as unknown[];
		expect(steps).toHaveLength(2);
	});

	it("blocks mainnet execute without confirmMainnet", async () => {
		mockBuildSupplyCalldata.mockResolvedValueOnce([]);
		const tool = findTool("venusSupply");
		await expect(
			tool.execute("t2", {
				network: "bsc",
				tokenAddress: USDC_ADDRESS,
				amountRaw: "1000000000000000000",
				dryRun: false,
			}),
		).rejects.toThrow("confirmMainnet");
	});

	it("rejects invalid tokenAddress", async () => {
		const tool = findTool("venusSupply");
		await expect(
			tool.execute("t3", {
				network: "bsc",
				tokenAddress: "not-an-address",
				amountRaw: "1000",
			}),
		).rejects.toThrow("valid EVM address");
	});
});

// -----------------------------------------------------------------------
// Borrow
// -----------------------------------------------------------------------
describe("venusBorrow", () => {
	it("returns preview in dryRun mode", async () => {
		mockBuildBorrowCalldata.mockResolvedValueOnce({
			to: VUSDC_ADDRESS,
			data: "0xborrow...",
			description: "Borrow 100 USDC",
		});

		const tool = findTool("venusBorrow");
		const result = await tool.execute("t4", {
			network: "bsc",
			marketAddress: VUSDC_ADDRESS,
			amountRaw: "100000000000000000000",
		});

		expect(result.details?.dryRun).toBe(true);
		expect(result.details?.schema).toBe("evm.venus.borrow.preview.v1");
		expect(result.content[0].text).toContain("borrow preview");
	});
});

// -----------------------------------------------------------------------
// Repay
// -----------------------------------------------------------------------
describe("venusRepay", () => {
	it("returns preview in dryRun mode", async () => {
		mockBuildRepayCalldata.mockResolvedValueOnce([
			{ to: USDC_ADDRESS, data: "0xapprove...", description: "Approve USDC" },
			{ to: VUSDC_ADDRESS, data: "0xrepay...", description: "Repay USDC" },
		]);

		const tool = findTool("venusRepay");
		const result = await tool.execute("t5", {
			network: "bsc",
			tokenAddress: USDC_ADDRESS,
			amountRaw: "50000000000000000000",
		});

		expect(result.details?.dryRun).toBe(true);
		expect(result.details?.schema).toBe("evm.venus.repay.preview.v1");
	});
});

// -----------------------------------------------------------------------
// Withdraw
// -----------------------------------------------------------------------
describe("venusWithdraw", () => {
	it("returns preview in dryRun mode", async () => {
		mockBuildWithdrawCalldata.mockResolvedValueOnce({
			to: VUSDC_ADDRESS,
			data: "0xredeem...",
			description: "Withdraw 100 USDC",
		});

		const tool = findTool("venusWithdraw");
		const result = await tool.execute("t6", {
			network: "bsc",
			tokenAddress: USDC_ADDRESS,
			amountRaw: "100000000000000000000",
		});

		expect(result.details?.dryRun).toBe(true);
		expect(result.details?.schema).toBe("evm.venus.withdraw.preview.v1");
	});
});

// -----------------------------------------------------------------------
// Enter Markets
// -----------------------------------------------------------------------
describe("venusEnterMarkets", () => {
	it("returns preview in dryRun mode", async () => {
		mockBuildEnterMarketCalldata.mockResolvedValueOnce({
			to: "0xfD36E2c2a6789Db23113685031d7F16329158384",
			data: "0xenterMarkets...",
			description: "Enable 1 market(s) as collateral",
		});

		const tool = findTool("venusEnterMarkets");
		const result = await tool.execute("t7", {
			network: "bsc",
			marketAddresses: [VUSDC_ADDRESS],
		});

		expect(result.details?.dryRun).toBe(true);
		expect(result.details?.schema).toBe("evm.venus.enterMarkets.preview.v1");
	});

	it("rejects invalid market address in array", async () => {
		const tool = findTool("venusEnterMarkets");
		await expect(
			tool.execute("t8", {
				network: "bsc",
				marketAddresses: ["bad-address"],
			}),
		).rejects.toThrow("valid EVM address");
	});
});
