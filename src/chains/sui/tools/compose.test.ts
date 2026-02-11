import { beforeEach, describe, expect, it, vi } from "vitest";

const cetusMocks = vi.hoisted(() => {
	const createAddLiquidityFixTokenPayload = vi.fn();
	const removeLiquidityTransactionPayload = vi.fn();
	const initCetusSDK = vi.fn().mockImplementation(() => ({
		Position: {
			createAddLiquidityFixTokenPayload,
			removeLiquidityTransactionPayload,
		},
	}));
	return {
		createAddLiquidityFixTokenPayload,
		removeLiquidityTransactionPayload,
		initCetusSDK,
	};
});

vi.mock("@cetusprotocol/cetus-sui-clmm-sdk", () => ({
	initCetusSDK: cetusMocks.initCetusSDK,
}));

const aggregatorMocks = vi.hoisted(() => {
	const findRouters = vi.fn();
	const fastRouterSwap = vi.fn();
	const AggregatorClient = vi.fn().mockImplementation(() => ({
		findRouters,
		fastRouterSwap,
	}));
	return {
		findRouters,
		fastRouterSwap,
		AggregatorClient,
		Env: {
			Mainnet: "Mainnet",
			Testnet: "Testnet",
		},
	};
});

vi.mock("@cetusprotocol/aggregator-sdk", () => ({
	AggregatorClient: aggregatorMocks.AggregatorClient,
	Env: aggregatorMocks.Env,
}));

const runtimeMocks = vi.hoisted(() => ({
	getSuiClient: vi.fn(),
	getSuiRpcEndpoint: vi.fn(() => "https://fullnode.mainnet.sui.io:443"),
	normalizeAtPath: vi.fn((value: string) => value.replace(/^@/, "")),
	parsePositiveBigInt: vi.fn((value: string) => BigInt(value)),
	parseSuiNetwork: vi.fn(() => "mainnet"),
	suiNetworkSchema: vi.fn(),
	toMist: vi.fn((value: number) => BigInt(Math.round(value * 1_000_000_000))),
}));

const stableLayerMocks = vi.hoisted(() => ({
	STABLE_LAYER_DEFAULT_USDC_COIN_TYPE:
		"0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
	resolveStableLayerNetwork: vi.fn(() => "mainnet"),
	buildStableLayerMintTransaction: vi.fn(),
	buildStableLayerBurnTransaction: vi.fn(),
	buildStableLayerClaimTransaction: vi.fn(),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		getSuiClient: runtimeMocks.getSuiClient,
		getSuiRpcEndpoint: runtimeMocks.getSuiRpcEndpoint,
		normalizeAtPath: runtimeMocks.normalizeAtPath,
		parsePositiveBigInt: runtimeMocks.parsePositiveBigInt,
		parseSuiNetwork: runtimeMocks.parseSuiNetwork,
		suiNetworkSchema: runtimeMocks.suiNetworkSchema,
		toMist: runtimeMocks.toMist,
	};
});

vi.mock("../stablelayer.js", () => ({
	STABLE_LAYER_DEFAULT_USDC_COIN_TYPE:
		stableLayerMocks.STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
	resolveStableLayerNetwork: stableLayerMocks.resolveStableLayerNetwork,
	buildStableLayerMintTransaction:
		stableLayerMocks.buildStableLayerMintTransaction,
	buildStableLayerBurnTransaction:
		stableLayerMocks.buildStableLayerBurnTransaction,
	buildStableLayerClaimTransaction:
		stableLayerMocks.buildStableLayerClaimTransaction,
}));

import { createSuiComposeTools } from "./compose.js";

type ComposeTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(name: string): ComposeTool {
	const tool = createSuiComposeTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ComposeTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
	runtimeMocks.getSuiRpcEndpoint.mockReturnValue(
		"https://fullnode.mainnet.sui.io:443",
	);
	runtimeMocks.parsePositiveBigInt.mockImplementation((value: string) =>
		BigInt(value),
	);
	runtimeMocks.toMist.mockImplementation((value: number) =>
		BigInt(Math.round(value * 1_000_000_000)),
	);
	runtimeMocks.getSuiClient.mockReturnValue({
		getCoins: vi.fn().mockResolvedValue({
			data: [
				{
					coinObjectId:
						"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					balance: "400",
				},
				{
					coinObjectId:
						"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
					balance: "700",
				},
			],
			hasNextPage: false,
			nextCursor: null,
		}),
	});
	aggregatorMocks.findRouters.mockResolvedValue({
		insufficientLiquidity: false,
		error: null,
		quoteID: "quote-1",
		amountIn: "1000",
		amountOut: "990",
		paths: [{ provider: "CETUS" }, { provider: "DEEPBOOKV3" }],
	});
	aggregatorMocks.fastRouterSwap.mockResolvedValue(undefined);
	cetusMocks.createAddLiquidityFixTokenPayload.mockResolvedValue({
		setSender: vi.fn(),
		serialize: vi.fn(() => "serialized-cetus-add"),
	});
	cetusMocks.removeLiquidityTransactionPayload.mockResolvedValue({
		setSender: vi.fn(),
		serialize: vi.fn(() => "serialized-cetus-remove"),
	});
	stableLayerMocks.resolveStableLayerNetwork.mockReturnValue("mainnet");
	stableLayerMocks.buildStableLayerMintTransaction.mockResolvedValue({
		setSender: vi.fn(),
		serialize: vi.fn(() => "serialized-stable-mint"),
	});
	stableLayerMocks.buildStableLayerBurnTransaction.mockResolvedValue({
		setSender: vi.fn(),
		serialize: vi.fn(() => "serialized-stable-burn"),
	});
	stableLayerMocks.buildStableLayerClaimTransaction.mockResolvedValue({
		setSender: vi.fn(),
		serialize: vi.fn(() => "serialized-stable-claim"),
	});
});

describe("sui compose tools", () => {
	it("builds SUI transfer transaction", async () => {
		const tool = getTool("sui_buildTransferSuiTransaction");
		const result = await tool.execute("sui-compose-1", {
			fromAddress:
				"@0x1111111111111111111111111111111111111111111111111111111111111111",
			toAddress:
				"0x2222222222222222222222222222222222222222222222222222222222222222",
			amountSui: 0.000001,
			network: "mainnet",
		});

		expect(runtimeMocks.toMist).toHaveBeenCalledWith(0.000001);
		expect(result.details).toMatchObject({
			fromAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			toAddress:
				"0x2222222222222222222222222222222222222222222222222222222222222222",
			amountMist: "1000",
		});
		expect(
			typeof (result.details as { serializedTransaction?: unknown })
				.serializedTransaction,
		).toBe("string");
	});

	it("builds non-SUI coin transfer transaction with coin selection", async () => {
		const tool = getTool("sui_buildTransferCoinTransaction");
		const result = await tool.execute("sui-compose-2", {
			fromAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			toAddress:
				"0x3333333333333333333333333333333333333333333333333333333333333333",
			coinType: "0x2::usdc::USDC",
			amountRaw: "1000",
			network: "mainnet",
		});

		const client = runtimeMocks.getSuiClient.mock.results[0]?.value as {
			getCoins: ReturnType<typeof vi.fn>;
		};
		expect(client.getCoins).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			coinType: "0x2::usdc::USDC",
			amountRaw: "1000",
			selectedCoinObjectIds: [
				"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			],
			selectedBalanceRaw: "1100",
		});
	});

	it("rejects SUI coin type for buildTransferCoin", async () => {
		const tool = getTool("sui_buildTransferCoinTransaction");
		await expect(
			tool.execute("sui-compose-3", {
				fromAddress:
					"0x1111111111111111111111111111111111111111111111111111111111111111",
				toAddress:
					"0x3333333333333333333333333333333333333333333333333333333333333333",
				coinType: "0x2::sui::SUI",
				amountRaw: "1000",
			}),
		).rejects.toThrow("Use sui_buildTransferSuiTransaction");
	});

	it("builds Cetus swap transaction from quote route", async () => {
		const tool = getTool("sui_buildSwapCetusTransaction");
		const result = await tool.execute("sui-compose-4", {
			fromAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			inputCoinType: "0x2::sui::SUI",
			outputCoinType: "0x2::usdc::USDC",
			amountRaw: "1000",
			network: "mainnet",
			slippageBps: 50,
		});

		expect(aggregatorMocks.findRouters).toHaveBeenCalledWith({
			from: "0x2::sui::SUI",
			target: "0x2::usdc::USDC",
			amount: "1000",
			byAmountIn: true,
			providers: undefined,
			depth: undefined,
		});
		expect(aggregatorMocks.fastRouterSwap).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			routeAmountIn: "1000",
			routeAmountOut: "990",
			pathCount: 2,
			providersUsed: ["CETUS", "DEEPBOOKV3"],
		});
	});

	it("builds Cetus add-liquidity transaction payload", async () => {
		const tool = getTool("sui_buildCetusAddLiquidityTransaction");
		const result = await tool.execute("sui-compose-5", {
			fromAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			poolId:
				"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			positionId:
				"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			coinTypeA: "0x2::sui::SUI",
			coinTypeB: "0x2::usdc::USDC",
			tickLower: -100,
			tickUpper: 100,
			amountA: "1000",
			amountB: "2000",
			network: "mainnet",
		});

		expect(cetusMocks.initCetusSDK).toHaveBeenCalledWith({
			network: "mainnet",
			fullNodeUrl: "https://fullnode.mainnet.sui.io:443",
			wallet:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
		});
		expect(cetusMocks.createAddLiquidityFixTokenPayload).toHaveBeenCalledTimes(
			1,
		);
		expect(result.details).toMatchObject({
			poolId:
				"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			positionId:
				"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			serializedTransaction: "serialized-cetus-add",
		});
	});

	it("builds Cetus remove-liquidity transaction payload", async () => {
		const tool = getTool("sui_buildCetusRemoveLiquidityTransaction");
		const result = await tool.execute("sui-compose-6", {
			fromAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			poolId:
				"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			positionId:
				"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			coinTypeA: "0x2::sui::SUI",
			coinTypeB: "0x2::usdc::USDC",
			deltaLiquidity: "999",
			minAmountA: "1",
			minAmountB: "2",
			network: "mainnet",
		});

		expect(cetusMocks.removeLiquidityTransactionPayload).toHaveBeenCalledTimes(
			1,
		);
		expect(result.details).toMatchObject({
			poolId:
				"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			positionId:
				"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			deltaLiquidity: "999",
			serializedTransaction: "serialized-cetus-remove",
		});
	});

	it("builds Stable Layer mint transaction payload", async () => {
		const tool = getTool("sui_buildStableLayerMintTransaction");
		const result = await tool.execute("sui-compose-7", {
			fromAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			stableCoinType:
				"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa::btc_usdc::BtcUSDC",
			amountUsdcRaw: "1000000",
			network: "mainnet",
		});

		expect(stableLayerMocks.buildStableLayerMintTransaction).toHaveBeenCalled();
		expect(result.details).toMatchObject({
			amountUsdcRaw: "1000000",
			serializedTransaction: "serialized-stable-mint",
		});
	});

	it("builds Stable Layer burn transaction payload", async () => {
		const tool = getTool("sui_buildStableLayerBurnTransaction");
		const result = await tool.execute("sui-compose-8", {
			fromAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			stableCoinType:
				"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa::btc_usdc::BtcUSDC",
			amountStableRaw: "500000",
			network: "mainnet",
		});

		expect(stableLayerMocks.buildStableLayerBurnTransaction).toHaveBeenCalled();
		expect(result.details).toMatchObject({
			amountStableRaw: "500000",
			burnAll: false,
			serializedTransaction: "serialized-stable-burn",
		});
	});

	it("builds Stable Layer claim transaction payload", async () => {
		const tool = getTool("sui_buildStableLayerClaimTransaction");
		const result = await tool.execute("sui-compose-9", {
			fromAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			stableCoinType:
				"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa::btc_usdc::BtcUSDC",
			network: "mainnet",
		});

		expect(
			stableLayerMocks.buildStableLayerClaimTransaction,
		).toHaveBeenCalled();
		expect(result.details).toMatchObject({
			serializedTransaction: "serialized-stable-claim",
		});
	});
});
