import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	formatCoinAmount: vi.fn((value: string) => value),
	getSuiClient: vi.fn(),
	getSuiRpcEndpoint: vi.fn(() => "https://fullnode.devnet.sui.io:443"),
	normalizeAtPath: vi.fn((value: string) => value),
	parseSuiNetwork: vi.fn(() => "devnet"),
	suiNetworkSchema: vi.fn(),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		formatCoinAmount: runtimeMocks.formatCoinAmount,
		getSuiClient: runtimeMocks.getSuiClient,
		getSuiRpcEndpoint: runtimeMocks.getSuiRpcEndpoint,
		normalizeAtPath: runtimeMocks.normalizeAtPath,
		parseSuiNetwork: runtimeMocks.parseSuiNetwork,
		suiNetworkSchema: runtimeMocks.suiNetworkSchema,
	};
});

import { createSuiReadTools } from "./read.js";

type ReadTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(name: string): ReadTool {
	const tool = createSuiReadTools().find((item) => item.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ReadTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.parseSuiNetwork.mockReturnValue("devnet");
	runtimeMocks.getSuiRpcEndpoint.mockReturnValue(
		"https://fullnode.devnet.sui.io:443",
	);
	runtimeMocks.formatCoinAmount.mockImplementation((value: string) => value);
});

describe("sui_getBalance", () => {
	it("returns SUI balance with ui amount", async () => {
		const getBalance = vi.fn().mockResolvedValue({
			coinType: "0x2::sui::SUI",
			coinObjectCount: 3,
			lockedBalance: {},
			totalBalance: "1230000000",
		});
		runtimeMocks.getSuiClient.mockReturnValue({ getBalance });
		runtimeMocks.formatCoinAmount.mockReturnValue("1.23");

		const tool = getTool("sui_getBalance");
		const result = await tool.execute("t1", {
			owner: "0xabc",
			network: "devnet",
		});

		expect(getBalance).toHaveBeenCalledWith({
			owner: "0xabc",
			coinType: undefined,
		});
		expect(runtimeMocks.formatCoinAmount).toHaveBeenCalledWith("1230000000", 9);
		expect(result.content[0]?.text).toContain("1.23 SUI");
		expect(result.details).toMatchObject({
			owner: "0xabc",
			coinType: "0x2::sui::SUI",
			totalBalance: "1230000000",
			uiAmount: "1.23",
			network: "devnet",
		});
	});

	it("returns non-SUI coin balance without ui conversion", async () => {
		const getBalance = vi.fn().mockResolvedValue({
			coinType: "0x2::usdc::USDC",
			coinObjectCount: 1,
			lockedBalance: {},
			totalBalance: "987654",
		});
		runtimeMocks.getSuiClient.mockReturnValue({ getBalance });

		const tool = getTool("sui_getBalance");
		const result = await tool.execute("t2", {
			owner: "0xdef",
			coinType: "0x2::usdc::USDC",
		});

		expect(runtimeMocks.formatCoinAmount).not.toHaveBeenCalled();
		expect(result.content[0]?.text).toContain("0x2::usdc::USDC");
		expect(result.details).toMatchObject({
			owner: "0xdef",
			coinType: "0x2::usdc::USDC",
			totalBalance: "987654",
			uiAmount: null,
		});
	});
});

describe("sui_getPortfolio", () => {
	it("returns sorted multi-asset balances with metadata and SUI summary", async () => {
		const getAllBalances = vi.fn().mockResolvedValue([
			{
				coinType: "0x2::sui::SUI",
				coinObjectCount: 2,
				totalBalance: "2500000000",
				lockedBalance: {},
			},
			{
				coinType: "0x2::usdc::USDC",
				coinObjectCount: 1,
				totalBalance: "2000000",
				lockedBalance: {},
			},
			{
				coinType: "0x2::dust::DUST",
				coinObjectCount: 1,
				totalBalance: "0",
				lockedBalance: {},
			},
		]);
		const getCoinMetadata = vi
			.fn()
			.mockImplementation(async ({ coinType }: { coinType: string }) => {
				if (coinType === "0x2::usdc::USDC") {
					return {
						decimals: 6,
						symbol: "USDC",
						name: "USD Coin",
						description: "USD Coin",
						iconUrl: null,
					};
				}
				return null;
			});
		runtimeMocks.getSuiClient.mockReturnValue({
			getAllBalances,
			getCoinMetadata,
		});
		runtimeMocks.formatCoinAmount
			.mockReturnValueOnce("2.5")
			.mockReturnValueOnce("2");

		const tool = getTool("sui_getPortfolio");
		const result = await tool.execute("p1", {
			owner: "0xportfolio",
			network: "devnet",
		});

		expect(getAllBalances).toHaveBeenCalledWith({ owner: "0xportfolio" });
		expect(getCoinMetadata).toHaveBeenCalledTimes(2);
		expect(runtimeMocks.formatCoinAmount).toHaveBeenCalledWith("2500000000", 9);
		expect(runtimeMocks.formatCoinAmount).toHaveBeenCalledWith("2000000", 6);
		expect(result.content[0]?.text).toContain("Portfolio: 2 assets");
		expect(result.details).toMatchObject({
			owner: "0xportfolio",
			assetCount: 2,
			totalCoinObjectCount: 3,
			suiBalance: {
				coinType: "0x2::sui::SUI",
				totalBalance: "2500000000",
				uiAmount: "2.5",
			},
		});
	});

	it("supports disabling metadata and includes zero balances when requested", async () => {
		const getAllBalances = vi.fn().mockResolvedValue([
			{
				coinType: "0x2::dust::DUST",
				coinObjectCount: 1,
				totalBalance: "0",
				lockedBalance: {},
			},
		]);
		const getCoinMetadata = vi.fn();
		runtimeMocks.getSuiClient.mockReturnValue({
			getAllBalances,
			getCoinMetadata,
		});

		const tool = getTool("sui_getPortfolio");
		const result = await tool.execute("p2", {
			owner: "0xportfolio",
			includeMetadata: false,
			includeZeroBalances: true,
		});

		expect(getCoinMetadata).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			assetCount: 1,
			assets: [
				{
					coinType: "0x2::dust::DUST",
					totalBalance: "0",
					uiAmount: null,
					metadata: null,
				},
			],
		});
	});
});
