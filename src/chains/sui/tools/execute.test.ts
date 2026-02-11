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
	formatCoinAmount: vi.fn((value: string) => value),
	getSuiClient: vi.fn(),
	getSuiExplorerTransactionUrl: vi.fn(
		() => "https://suivision.xyz/txblock/0x1",
	),
	getSuiRpcEndpoint: vi.fn(() => "https://fullnode.devnet.sui.io:443"),
	normalizeAtPath: vi.fn((value: string) => value),
	parsePositiveBigInt: vi.fn((value: string) => BigInt(value)),
	parseSuiNetwork: vi.fn(() => "devnet"),
	resolveSuiKeypair: vi.fn(() => ({
		toSuiAddress: () =>
			"0x1111111111111111111111111111111111111111111111111111111111111111",
	})),
	suiNetworkSchema: vi.fn(),
	toMist: vi.fn((value: number) => BigInt(Math.round(value * 1_000_000_000))),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		formatCoinAmount: runtimeMocks.formatCoinAmount,
		getSuiClient: runtimeMocks.getSuiClient,
		getSuiExplorerTransactionUrl: runtimeMocks.getSuiExplorerTransactionUrl,
		getSuiRpcEndpoint: runtimeMocks.getSuiRpcEndpoint,
		normalizeAtPath: runtimeMocks.normalizeAtPath,
		parsePositiveBigInt: runtimeMocks.parsePositiveBigInt,
		parseSuiNetwork: runtimeMocks.parseSuiNetwork,
		resolveSuiKeypair: runtimeMocks.resolveSuiKeypair,
		suiNetworkSchema: runtimeMocks.suiNetworkSchema,
		toMist: runtimeMocks.toMist,
	};
});

import { createSuiExecuteTools } from "./execute.js";

type ExecuteTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(name: string): ExecuteTool {
	const tool = createSuiExecuteTools().find((item) => item.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ExecuteTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.parseSuiNetwork.mockReturnValue("devnet");
	runtimeMocks.getSuiRpcEndpoint.mockReturnValue(
		"https://fullnode.devnet.sui.io:443",
	);
	runtimeMocks.getSuiExplorerTransactionUrl.mockReturnValue(
		"https://suivision.xyz/txblock/0x1",
	);
	runtimeMocks.parsePositiveBigInt.mockImplementation((value: string) =>
		BigInt(value),
	);
	runtimeMocks.formatCoinAmount.mockImplementation((value: string) => value);
	aggregatorMocks.findRouters.mockReset();
	aggregatorMocks.fastRouterSwap.mockReset();
	cetusMocks.createAddLiquidityFixTokenPayload.mockReset();
	cetusMocks.removeLiquidityTransactionPayload.mockReset();
});

describe("sui_transferSui", () => {
	const toAddress =
		"0x2222222222222222222222222222222222222222222222222222222222222222";

	it("blocks mainnet execution without confirmMainnet", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
		const tool = getTool("sui_transferSui");

		await expect(
			tool.execute("t1", {
				toAddress,
				amountMist: "1000",
				network: "mainnet",
			}),
		).rejects.toThrow("confirmMainnet=true");

		expect(runtimeMocks.getSuiClient).not.toHaveBeenCalled();
	});

	it("signs and sends transfer using amountMist", async () => {
		const signAndExecuteTransaction = vi.fn().mockResolvedValue({
			digest: "0xabc",
			confirmedLocalExecution: true,
			effects: {
				status: {
					status: "success",
				},
			},
		});
		runtimeMocks.getSuiClient.mockReturnValue({ signAndExecuteTransaction });
		runtimeMocks.formatCoinAmount.mockReturnValue("0.000001");

		const tool = getTool("sui_transferSui");
		const result = await tool.execute("t2", {
			toAddress,
			amountMist: "1000",
			network: "devnet",
		});

		expect(runtimeMocks.parsePositiveBigInt).toHaveBeenCalledWith(
			"1000",
			"amountMist",
		);
		expect(signAndExecuteTransaction).toHaveBeenCalledTimes(1);
		expect(signAndExecuteTransaction.mock.calls[0]?.[0]).toMatchObject({
			requestType: "WaitForLocalExecution",
		});
		expect(result.details).toMatchObject({
			digest: "0xabc",
			status: "success",
			fromAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			toAddress:
				"0x2222222222222222222222222222222222222222222222222222222222222222",
			amountMist: "1000",
			amountSui: "0.000001",
			network: "devnet",
		});
	});

	it("throws when chain execution status is failure", async () => {
		const signAndExecuteTransaction = vi.fn().mockResolvedValue({
			digest: "0xfail",
			effects: {
				status: {
					status: "failure",
					error: "insufficient gas",
				},
			},
		});
		runtimeMocks.getSuiClient.mockReturnValue({ signAndExecuteTransaction });

		const tool = getTool("sui_transferSui");
		await expect(
			tool.execute("t3", {
				toAddress,
				amountMist: "1000",
			}),
		).rejects.toThrow("insufficient gas");
	});
});

describe("sui_transferCoin", () => {
	const toAddress =
		"0x3333333333333333333333333333333333333333333333333333333333333333";
	const coinType = "0x2::usdc::USDC";
	const coinObjectIdA =
		"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
	const coinObjectIdB =
		"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

	it("rejects SUI coin type for this tool", async () => {
		const tool = getTool("sui_transferCoin");
		await expect(
			tool.execute("c1", {
				toAddress,
				coinType: "0x2::sui::SUI",
				amountRaw: "1000",
			}),
		).rejects.toThrow("Use sui_transferSui");
	});

	it("collects and merges coin objects before sending", async () => {
		const getCoins = vi.fn().mockResolvedValue({
			data: [
				{
					coinObjectId: coinObjectIdA,
					balance: "400",
				},
				{
					coinObjectId: coinObjectIdB,
					balance: "700",
				},
			],
			hasNextPage: false,
			nextCursor: null,
		});
		const signAndExecuteTransaction = vi.fn().mockResolvedValue({
			digest: "0xcoin-ok",
			confirmedLocalExecution: true,
			effects: {
				status: {
					status: "success",
				},
			},
		});
		runtimeMocks.getSuiClient.mockReturnValue({
			getCoins,
			signAndExecuteTransaction,
		});

		const tool = getTool("sui_transferCoin");
		const result = await tool.execute("c2", {
			toAddress,
			coinType,
			amountRaw: "1000",
		});

		expect(getCoins).toHaveBeenCalledWith({
			owner:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			coinType,
			cursor: undefined,
			limit: 20,
		});
		expect(signAndExecuteTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			digest: "0xcoin-ok",
			status: "success",
			coinType,
			amountRaw: "1000",
			selectedCoinObjectIds: [coinObjectIdA, coinObjectIdB],
			selectedCoinObjectCount: 2,
			selectedBalanceRaw: "1100",
		});
	});

	it("throws when selected coin objects are insufficient", async () => {
		const getCoins = vi.fn().mockResolvedValue({
			data: [
				{
					coinObjectId: coinObjectIdA,
					balance: "100",
				},
			],
			hasNextPage: false,
			nextCursor: null,
		});
		runtimeMocks.getSuiClient.mockReturnValue({
			getCoins,
			signAndExecuteTransaction: vi.fn(),
		});

		const tool = getTool("sui_transferCoin");
		await expect(
			tool.execute("c3", {
				toAddress,
				coinType,
				amountRaw: "1000",
				maxCoinObjectsToMerge: 1,
			}),
		).rejects.toThrow("Insufficient balance");
	});
});

describe("sui_swapCetus", () => {
	it("executes swap via aggregator and submits transaction", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
		aggregatorMocks.findRouters.mockResolvedValue({
			quoteID: "sq-1",
			amountIn: { toString: () => "1000000" },
			amountOut: { toString: () => "63800000" },
			paths: [
				{
					id: "p1",
					provider: "CETUS",
					from: "0x2::sui::SUI",
					target: "0x...::cetus::CETUS",
					amountIn: "1000000",
					amountOut: "63800000",
					feeRate: 30,
				},
			],
			insufficientLiquidity: false,
		});
		const signAndExecuteTransaction = vi.fn().mockResolvedValue({
			digest: "0xswap",
			confirmedLocalExecution: true,
			effects: {
				status: {
					status: "success",
				},
			},
		});
		runtimeMocks.getSuiClient.mockReturnValue({ signAndExecuteTransaction });

		const tool = getTool("sui_swapCetus");
		const result = await tool.execute("s1", {
			inputCoinType: "0x2::sui::SUI",
			outputCoinType: "0x...::cetus::CETUS",
			amountRaw: "1000000",
			network: "mainnet",
			confirmMainnet: true,
		});

		expect(aggregatorMocks.AggregatorClient).toHaveBeenCalledWith({
			env: "Mainnet",
			endpoint: undefined,
			apiKey: undefined,
			signer:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
		});
		expect(aggregatorMocks.findRouters).toHaveBeenCalledWith({
			from: "0x2::sui::SUI",
			target: "0x...::cetus::CETUS",
			amount: "1000000",
			byAmountIn: true,
			providers: undefined,
			depth: undefined,
		});
		expect(aggregatorMocks.fastRouterSwap).toHaveBeenCalledTimes(1);
		expect(signAndExecuteTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			digest: "0xswap",
			status: "success",
			quoteId: "sq-1",
			pathCount: 1,
			routeAmountIn: "1000000",
			routeAmountOut: "63800000",
			providersUsed: ["CETUS"],
		});
	});

	it("throws when aggregator returns no route", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("testnet");
		aggregatorMocks.findRouters.mockResolvedValue({
			amountIn: { toString: () => "1000000" },
			amountOut: { toString: () => "0" },
			paths: [],
			insufficientLiquidity: true,
			error: { code: 400, msg: "no route" },
		});
		runtimeMocks.getSuiClient.mockReturnValue({
			signAndExecuteTransaction: vi.fn(),
		});

		const tool = getTool("sui_swapCetus");
		await expect(
			tool.execute("s2", {
				inputCoinType: "0x2::sui::SUI",
				outputCoinType: "0x...::usdc::USDC",
				amountRaw: "1000000",
				network: "testnet",
			}),
		).rejects.toThrow("No swap route available");
	});
});

describe("sui_cetusAddLiquidity", () => {
	it("blocks mainnet without confirmMainnet", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
		const tool = getTool("sui_cetusAddLiquidity");
		await expect(
			tool.execute("l1", {
				poolId: "0xpool",
				positionId: "0xpos",
				coinTypeA: "0x2::sui::SUI",
				coinTypeB: "0x...::usdc::USDC",
				tickLower: -100,
				tickUpper: 100,
				amountA: "1000",
				amountB: "1000",
			}),
		).rejects.toThrow("confirmMainnet=true");
	});

	it("builds cetus add-liquidity tx and sends it", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
		const tx = { tx: "add-liquidity-tx" };
		cetusMocks.createAddLiquidityFixTokenPayload.mockResolvedValue(tx);
		const signAndExecuteTransaction = vi.fn().mockResolvedValue({
			digest: "0xlpadd",
			confirmedLocalExecution: true,
			effects: {
				status: {
					status: "success",
				},
			},
		});
		runtimeMocks.getSuiClient.mockReturnValue({ signAndExecuteTransaction });

		const tool = getTool("sui_cetusAddLiquidity");
		const result = await tool.execute("l2", {
			poolId: "0xpool",
			positionId: "0xpos",
			coinTypeA: "0x2::sui::SUI",
			coinTypeB: "0x...::usdc::USDC",
			tickLower: -100,
			tickUpper: 100,
			amountA: "1000",
			amountB: "2000",
			network: "mainnet",
			confirmMainnet: true,
		});

		expect(cetusMocks.initCetusSDK).toHaveBeenCalledWith({
			network: "mainnet",
			fullNodeUrl: "https://fullnode.devnet.sui.io:443",
			wallet:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
		});
		expect(cetusMocks.createAddLiquidityFixTokenPayload).toHaveBeenCalledWith({
			pool_id: "0xpool",
			pos_id: "0xpos",
			coinTypeA: "0x2::sui::SUI",
			coinTypeB: "0x...::usdc::USDC",
			tick_lower: -100,
			tick_upper: 100,
			amount_a: "1000",
			amount_b: "2000",
			slippage: 0.01,
			fix_amount_a: true,
			is_open: false,
			collect_fee: false,
			rewarder_coin_types: [],
		});
		expect(signAndExecuteTransaction).toHaveBeenCalledWith(
			expect.objectContaining({
				transaction: tx,
				requestType: "WaitForLocalExecution",
			}),
		);
		expect(result.details).toMatchObject({
			digest: "0xlpadd",
			status: "success",
			poolId: "0xpool",
			positionId: "0xpos",
		});
	});
});

describe("sui_cetusRemoveLiquidity", () => {
	it("builds cetus remove-liquidity tx and sends it", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("testnet");
		const tx = { tx: "remove-liquidity-tx" };
		cetusMocks.removeLiquidityTransactionPayload.mockResolvedValue(tx);
		const signAndExecuteTransaction = vi.fn().mockResolvedValue({
			digest: "0xlprem",
			confirmedLocalExecution: true,
			effects: {
				status: {
					status: "success",
				},
			},
		});
		runtimeMocks.getSuiClient.mockReturnValue({ signAndExecuteTransaction });

		const tool = getTool("sui_cetusRemoveLiquidity");
		const result = await tool.execute("l3", {
			poolId: "0xpool",
			positionId: "0xpos",
			coinTypeA: "0x2::sui::SUI",
			coinTypeB: "0x...::usdc::USDC",
			deltaLiquidity: "12345",
			minAmountA: "1",
			minAmountB: "1",
			network: "testnet",
		});

		expect(cetusMocks.initCetusSDK).toHaveBeenCalledWith({
			network: "testnet",
			fullNodeUrl: "https://fullnode.devnet.sui.io:443",
			wallet:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
		});
		expect(cetusMocks.removeLiquidityTransactionPayload).toHaveBeenCalledWith({
			pool_id: "0xpool",
			pos_id: "0xpos",
			coinTypeA: "0x2::sui::SUI",
			coinTypeB: "0x...::usdc::USDC",
			delta_liquidity: "12345",
			min_amount_a: "1",
			min_amount_b: "1",
			collect_fee: true,
			rewarder_coin_types: [],
		});
		expect(result.details).toMatchObject({
			digest: "0xlprem",
			status: "success",
			deltaLiquidity: "12345",
		});
	});
});
