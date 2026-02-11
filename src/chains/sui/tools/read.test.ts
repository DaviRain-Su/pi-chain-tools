import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	formatCoinAmount: vi.fn((value: string) => value),
	getSuiClient: vi.fn(),
	getSuiRpcEndpoint: vi.fn(() => "https://fullnode.devnet.sui.io:443"),
	normalizeAtPath: vi.fn((value: string) => value),
	parseSuiNetwork: vi.fn(() => "devnet"),
	suiNetworkSchema: vi.fn(),
}));

const aggregatorMocks = vi.hoisted(() => {
	const findRouters = vi.fn();
	const AggregatorClient = vi.fn().mockImplementation(() => ({
		findRouters,
	}));
	return {
		findRouters,
		AggregatorClient,
		Env: {
			Mainnet: "Mainnet",
			Testnet: "Testnet",
		},
	};
});

const stableLayerMocks = vi.hoisted(() => ({
	getStableLayerSupply: vi.fn(),
	resolveStableLayerNetwork: vi.fn(() => "mainnet"),
}));

const cetusV2Mocks = vi.hoisted(() => ({
	getCetusFarmsPools: vi.fn(),
	getCetusFarmsPositions: vi.fn(),
	getCetusVaultsBalances: vi.fn(),
	resolveCetusV2Network: vi.fn(() => "mainnet"),
}));

vi.mock("@cetusprotocol/aggregator-sdk", () => ({
	AggregatorClient: aggregatorMocks.AggregatorClient,
	Env: aggregatorMocks.Env,
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

vi.mock("../stablelayer.js", () => ({
	getStableLayerSupply: stableLayerMocks.getStableLayerSupply,
	resolveStableLayerNetwork: stableLayerMocks.resolveStableLayerNetwork,
}));

vi.mock("../cetus-v2.js", () => ({
	getCetusFarmsPools: cetusV2Mocks.getCetusFarmsPools,
	getCetusFarmsPositions: cetusV2Mocks.getCetusFarmsPositions,
	getCetusVaultsBalances: cetusV2Mocks.getCetusVaultsBalances,
	resolveCetusV2Network: cetusV2Mocks.resolveCetusV2Network,
}));

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
	stableLayerMocks.resolveStableLayerNetwork.mockReturnValue("mainnet");
	stableLayerMocks.getStableLayerSupply.mockResolvedValue({
		totalSupply: "1000000000",
		coinTypeSupply: null,
	});
	cetusV2Mocks.resolveCetusV2Network.mockReturnValue("mainnet");
	cetusV2Mocks.getCetusFarmsPools.mockResolvedValue({
		pools: [],
		hasNextPage: false,
		nextCursor: null,
	});
	cetusV2Mocks.getCetusFarmsPositions.mockResolvedValue({
		positions: [],
		hasNextPage: false,
		nextCursor: null,
	});
	cetusV2Mocks.getCetusVaultsBalances.mockResolvedValue([]);
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

describe("sui_getSwapQuote", () => {
	it("returns routed quote details when path exists", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
		aggregatorMocks.findRouters.mockResolvedValue({
			quoteID: "q1",
			amountIn: {
				toString: () => "1000000",
			},
			amountOut: {
				toString: () => "63800000",
			},
			byAmountIn: true,
			paths: [
				{
					id: "path-1",
					provider: "CETUS",
					from: "0x2::sui::SUI",
					target: "0x...::cetus::CETUS",
					feeRate: 30,
					amountIn: "1000000",
					amountOut: "63800000",
					version: "v3",
					publishedAt: "0xpkg",
				},
			],
			insufficientLiquidity: false,
			deviationRatio: 0.001,
		});

		const tool = getTool("sui_getSwapQuote");
		const result = await tool.execute("q1", {
			fromCoinType: "0x2::sui::SUI",
			toCoinType: "0x...::cetus::CETUS",
			amountRaw: "1000000",
			network: "mainnet",
		});

		expect(aggregatorMocks.AggregatorClient).toHaveBeenCalledWith({
			env: "Mainnet",
			endpoint: undefined,
			apiKey: undefined,
		});
		expect(aggregatorMocks.findRouters).toHaveBeenCalledWith({
			from: "0x2::sui::SUI",
			target: "0x...::cetus::CETUS",
			amount: "1000000",
			byAmountIn: true,
			providers: undefined,
			depth: undefined,
		});
		expect(result.content[0]?.text).toContain("Swap quote");
		expect(result.details).toMatchObject({
			amountIn: "1000000",
			amountOut: "63800000",
			pathCount: 1,
			quoteId: "q1",
			network: "mainnet",
		});
	});

	it("returns no-route result when liquidity is insufficient", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("testnet");
		aggregatorMocks.findRouters.mockResolvedValue({
			amountIn: {
				toString: () => "1000000",
			},
			amountOut: {
				toString: () => "0",
			},
			paths: [],
			insufficientLiquidity: true,
			error: {
				code: 400,
				msg: "insufficient liquidity",
			},
		});

		const tool = getTool("sui_getSwapQuote");
		const result = await tool.execute("q2", {
			fromCoinType: "0x2::sui::SUI",
			toCoinType: "0x...::usdc::USDC",
			amountRaw: "1000000",
			network: "testnet",
		});

		expect(result.content[0]?.text).toContain("No swap quote available");
		expect(result.details).toMatchObject({
			network: "testnet",
			insufficientLiquidity: true,
			pathCount: 0,
			error: {
				code: 400,
			},
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

describe("sui_getStableLayerSupply", () => {
	it("returns total supply and per-coin supply", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
		stableLayerMocks.resolveStableLayerNetwork.mockReturnValue("mainnet");
		stableLayerMocks.getStableLayerSupply.mockResolvedValue({
			totalSupply: "123456789",
			coinTypeSupply: "1000000",
		});

		const tool = getTool("sui_getStableLayerSupply");
		const result = await tool.execute("stable-read-1", {
			network: "mainnet",
			stableCoinType: "0x6d9fc...::btc_usdc::BtcUSDC".replace(
				"...",
				"aaaaaaaa",
			),
		});

		expect(stableLayerMocks.getStableLayerSupply).toHaveBeenCalledTimes(1);
		expect(result.content[0]?.text).toContain("Stable Layer total supply");
		expect(result.details).toMatchObject({
			network: "mainnet",
			stableLayerNetwork: "mainnet",
			totalSupply: "123456789",
			coinTypeSupply: "1000000",
		});
	});
});

describe("sui_getCetusFarmsPools", () => {
	it("returns farms pool summaries", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
		cetusV2Mocks.getCetusFarmsPools.mockResolvedValue({
			pools: [
				{
					id: "0xpool1",
					clmm_pool_id: "0xclmm1",
					rewarders: [{}, {}],
				},
			],
			hasNextPage: false,
			nextCursor: null,
		});
		const tool = getTool("sui_getCetusFarmsPools");
		const result = await tool.execute("cetus-read-1", {
			network: "mainnet",
		});
		expect(cetusV2Mocks.getCetusFarmsPools).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			poolCount: 1,
			pools: [
				{
					poolId: "0xpool1",
					clmmPoolId: "0xclmm1",
					rewarderCount: 2,
				},
			],
		});
	});
});

describe("sui_getCetusFarmsPositions", () => {
	it("returns owner farms position summaries", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
		cetusV2Mocks.getCetusFarmsPositions.mockResolvedValue({
			positions: [
				{
					id: "0xposnft1",
					pool_id: "0xpool1",
					clmm_position_id: "0xclmmpos1",
					clmm_pool_id: "0xclmm1",
					rewards: [{}, {}],
				},
			],
			hasNextPage: false,
			nextCursor: null,
		});
		const tool = getTool("sui_getCetusFarmsPositions");
		const result = await tool.execute("cetus-read-2", {
			owner: "0xowner",
			network: "mainnet",
		});
		expect(cetusV2Mocks.getCetusFarmsPositions).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			owner: "0xowner",
			positionCount: 1,
			positions: [
				{
					positionNftId: "0xposnft1",
					poolId: "0xpool1",
					clmmPositionId: "0xclmmpos1",
					clmmPoolId: "0xclmm1",
					rewardCount: 2,
				},
			],
		});
	});
});

describe("sui_getCetusVaultsBalances", () => {
	it("returns owner vault balance summaries", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
		cetusV2Mocks.getCetusVaultsBalances.mockResolvedValue([
			{
				vault_id: "0xvault1",
				clmm_pool_id: "0xclmm1",
				lp_token_balance: "12345",
			},
		]);
		const tool = getTool("sui_getCetusVaultsBalances");
		const result = await tool.execute("cetus-read-3", {
			owner: "0xowner",
			network: "mainnet",
		});
		expect(cetusV2Mocks.getCetusVaultsBalances).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			owner: "0xowner",
			vaultCount: 1,
			balances: [
				{
					vaultId: "0xvault1",
					clmmPoolId: "0xclmm1",
					lpTokenBalance: "12345",
				},
			],
		});
	});
});

describe("sui_getDefiPositions", () => {
	it("returns aggregated portfolio + cetus farms/vault positions", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
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
		cetusV2Mocks.getCetusFarmsPositions.mockResolvedValue({
			positions: [
				{
					id: "0xposnft1",
					pool_id: "0xpool1",
					clmm_position_id: "0xclmmpos1",
					clmm_pool_id: "0xclmm1",
					rewards: [{}, {}],
				},
			],
			hasNextPage: false,
			nextCursor: null,
		});
		cetusV2Mocks.getCetusVaultsBalances.mockResolvedValue([
			{
				vault_id: "0xvault1",
				clmm_pool_id: "0xclmm1",
				lp_token_balance: "12345",
			},
		]);

		const tool = getTool("sui_getDefiPositions");
		const result = await tool.execute("defi-read-1", {
			owner: "0xowner",
			network: "mainnet",
		});

		expect(cetusV2Mocks.getCetusFarmsPositions).toHaveBeenCalledTimes(1);
		expect(cetusV2Mocks.getCetusVaultsBalances).toHaveBeenCalledTimes(1);
		expect(result.content[0]?.text).toContain("DeFi positions");
		expect(result.details).toMatchObject({
			owner: "0xowner",
			network: "mainnet",
			portfolio: {
				assetCount: 2,
				suiBalance: {
					coinType: "0x2::sui::SUI",
					uiAmount: "2.5",
				},
			},
			defi: {
				cetusNetwork: "mainnet",
				cetusError: null,
				farms: {
					positionCount: 1,
				},
				vaults: {
					vaultCount: 1,
				},
			},
		});
	});

	it("degrades gracefully on unsupported cetus network", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("devnet");
		const getAllBalances = vi.fn().mockResolvedValue([
			{
				coinType: "0x2::sui::SUI",
				coinObjectCount: 1,
				totalBalance: "1000000000",
				lockedBalance: {},
			},
		]);
		runtimeMocks.getSuiClient.mockReturnValue({
			getAllBalances,
			getCoinMetadata: vi.fn().mockResolvedValue(null),
		});
		runtimeMocks.formatCoinAmount.mockReturnValue("1");
		cetusV2Mocks.resolveCetusV2Network.mockImplementationOnce(() => {
			throw new Error(
				"Cetus v2 SDK currently supports network=mainnet or testnet.",
			);
		});

		const tool = getTool("sui_getDefiPositions");
		const result = await tool.execute("defi-read-2", {
			owner: "0xowner",
			network: "devnet",
		});

		expect(cetusV2Mocks.getCetusFarmsPositions).not.toHaveBeenCalled();
		expect(cetusV2Mocks.getCetusVaultsBalances).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			network: "devnet",
			defi: {
				cetusNetwork: null,
				cetusError:
					"Cetus v2 SDK currently supports network=mainnet or testnet.",
				farms: {
					positionCount: 0,
				},
				vaults: {
					vaultCount: 0,
				},
			},
		});
	});
});
