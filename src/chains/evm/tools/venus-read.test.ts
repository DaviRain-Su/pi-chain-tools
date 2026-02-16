import { describe, expect, it, vi } from "vitest";

// Mock the venus-adapter module
const mockGetMarkets = vi.fn();
const mockGetAccountPosition = vi.fn();

vi.mock("./venus-adapter.js", () => ({
	createVenusAdapter: () => ({
		protocolId: "venus",
		getMarkets: mockGetMarkets,
		getAccountPosition: mockGetAccountPosition,
	}),
}));

import { createVenusReadTools } from "./venus-read.js";

function findTool(name: string) {
	const tools = createVenusReadTools();
	const tool = tools.find((t) => t.name.endsWith(name));
	if (!tool) throw new Error(`Tool ${name} not found`);
	return tool as unknown as {
		name: string;
		execute(
			id: string,
			params: Record<string, unknown>,
		): Promise<{
			content: { type: string; text: string }[];
			details?: unknown;
		}>;
	};
}

describe("venusGetMarkets", () => {
	it("returns market list on success", async () => {
		mockGetMarkets.mockResolvedValueOnce([
			{
				protocol: "venus",
				network: "bsc",
				marketAddress: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
				underlyingAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
				underlyingSymbol: "USDC",
				underlyingDecimals: 18,
				supplyAPY: 3.5,
				borrowAPY: 5.2,
				totalSupply: "1000000",
				totalBorrow: "500000",
				collateralFactor: 0.75,
				isCollateral: true,
				isListed: true,
			},
		]);

		const tool = findTool("venusGetMarkets");
		const result = await tool.execute("test-1", { network: "bsc" });

		expect(result.content[0].text).toContain("Venus markets on bsc");
		expect(result.content[0].text).toContain("1 market(s)");
		const details = result.details as Record<string, unknown>;
		expect(details.schema).toBe("evm.venus.markets.v1");
		expect(details.marketsCount).toBe(1);
		expect(mockGetMarkets).toHaveBeenCalledWith("bsc");
	});

	it("rejects non-BSC network (adapter throws)", async () => {
		mockGetMarkets.mockRejectedValueOnce(
			new Error(
				"Venus Protocol is only available on BSC. Got network=ethereum.",
			),
		);
		const tool = findTool("venusGetMarkets");
		await expect(
			tool.execute("test-2", { network: "ethereum" }),
		).rejects.toThrow("only available on BSC");
	});
});

describe("venusGetPosition", () => {
	it("returns position on success", async () => {
		mockGetAccountPosition.mockResolvedValueOnce({
			protocol: "venus",
			network: "bsc",
			account: "0x1234567890123456789012345678901234567890",
			supplies: [
				{
					marketAddress: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
					underlyingAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
					underlyingSymbol: "USDC",
					underlyingDecimals: 18,
					balanceRaw: "1000000000000000000000",
					balanceFormatted: "1000",
				},
			],
			borrows: [],
			totalCollateralValueUsd: "1000.00",
			totalBorrowValueUsd: "0.00",
			currentLTV: 0,
			liquidationLTV: 0.8,
			healthFactor: Number.POSITIVE_INFINITY,
		});

		const tool = findTool("venusGetPosition");
		const result = await tool.execute("test-3", {
			network: "bsc",
			account: "0x1234567890123456789012345678901234567890",
		});

		expect(result.content[0].text).toContain("Venus position");
		expect(result.content[0].text).toContain("1 supply");
		expect(result.content[0].text).toContain("0 borrow");
		const details = result.details as Record<string, unknown>;
		expect(details.schema).toBe("evm.venus.position.v1");
		expect(details.healthFactor).toBe("∞");
	});

	it("rejects invalid address", async () => {
		const tool = findTool("venusGetPosition");
		await expect(
			tool.execute("test-4", { network: "bsc", account: "invalid" }),
		).rejects.toThrow("valid EVM address");
	});
});
