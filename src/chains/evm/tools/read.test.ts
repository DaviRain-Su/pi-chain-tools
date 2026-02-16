import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = global.fetch;

const TRANSFER_MAP_ENV_KEYS = [
	"EVM_TRANSFER_TOKEN_MAP",
	"EVM_TRANSFER_TOKEN_DECIMALS",
	"EVM_TRANSFER_TOKEN_MAP_ETHEREUM",
	"EVM_TRANSFER_TOKEN_MAP_SEPOLIA",
	"EVM_TRANSFER_TOKEN_MAP_POLYGON",
	"EVM_TRANSFER_TOKEN_MAP_BASE",
	"EVM_TRANSFER_TOKEN_MAP_ARBITRUM",
	"EVM_TRANSFER_TOKEN_MAP_OPTIMISM",
] as const;

const PANCAKE_V2_ENV_KEYS = [
	"EVM_PANCAKE_V2_FACTORY_BSC",
	"EVM_PANCAKE_V2_ROUTER_BSC",
	"EVM_PANCAKE_V2_WRAPPED_NATIVE_BSC",
	"EVM_PANCAKE_V2_CHAIN_ID_BSC",
	"EVM_PANCAKE_V2_FACTORY_POLYGON",
	"EVM_PANCAKE_V2_ROUTER_POLYGON",
	"EVM_PANCAKE_V2_WRAPPED_NATIVE_POLYGON",
	"EVM_PANCAKE_V2_CHAIN_ID_POLYGON",
] as const;

const TRANSFER_MAP_ENV_SNAPSHOT = Object.fromEntries(
	TRANSFER_MAP_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof TRANSFER_MAP_ENV_KEYS)[number], string | undefined>;

const PANCAKE_V2_ENV_SNAPSHOT = Object.fromEntries(
	PANCAKE_V2_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof PANCAKE_V2_ENV_KEYS)[number], string | undefined>;

const polymarketMocks = vi.hoisted(() => ({
	searchPolymarketEvents: vi.fn(),
	getPolymarketMarketBySlug: vi.fn(),
	getPolymarketBtc5mMarkets: vi.fn(),
	getPolymarketOrderBook: vi.fn(),
	getPolymarketBtc5mAdvice: vi.fn(),
	getPolymarketGeoblockStatus: vi.fn(),
}));

vi.mock("../polymarket.js", () => ({
	searchPolymarketEvents: polymarketMocks.searchPolymarketEvents,
	getPolymarketMarketBySlug: polymarketMocks.getPolymarketMarketBySlug,
	getPolymarketBtc5mMarkets: polymarketMocks.getPolymarketBtc5mMarkets,
	getPolymarketOrderBook: polymarketMocks.getPolymarketOrderBook,
	getPolymarketBtc5mAdvice: polymarketMocks.getPolymarketBtc5mAdvice,
	getPolymarketGeoblockStatus: polymarketMocks.getPolymarketGeoblockStatus,
}));

function mockJsonFetch(payload: unknown) {
	const fetchMock = vi.fn(async () => {
		return {
			ok: true,
			status: 200,
			statusText: "OK",
			text: async () => JSON.stringify(payload),
		} as unknown as Response;
	});
	global.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

import { createEvmReadTools } from "./read.js";

type ReadTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(name: string): ReadTool {
	const tool = createEvmReadTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ReadTool;
}

beforeEach(() => {
	global.fetch = ORIGINAL_FETCH;
	for (const key of TRANSFER_MAP_ENV_KEYS) {
		Reflect.deleteProperty(process.env, key);
	}
	for (const key of PANCAKE_V2_ENV_KEYS) {
		Reflect.deleteProperty(process.env, key);
	}
	vi.clearAllMocks();
	polymarketMocks.searchPolymarketEvents.mockResolvedValue([]);
	polymarketMocks.getPolymarketMarketBySlug.mockResolvedValue({
		slug: "btc-updown-5m-1",
		question: "Bitcoin Up or Down - 5m",
		active: true,
		closed: false,
		acceptingOrders: true,
		legs: [
			{ outcome: "Up", tokenId: "1", price: 0.51 },
			{ outcome: "Down", tokenId: "2", price: 0.49 },
		],
	});
	polymarketMocks.getPolymarketBtc5mMarkets.mockResolvedValue([]);
	polymarketMocks.getPolymarketOrderBook.mockResolvedValue({
		tokenId: "1",
		bestBid: { price: 0.49, size: 10 },
		bestAsk: { price: 0.51, size: 9 },
		midpoint: 0.5,
		bids: [{ price: 0.49, size: 10 }],
		asks: [{ price: 0.51, size: 9 }],
	});
	polymarketMocks.getPolymarketBtc5mAdvice.mockResolvedValue({
		recommendedSide: "up",
		confidence: 0.72,
		marketSlug: "btc-updown-5m-1",
		upProbability: 0.57,
		upTokenId: "1",
		downTokenId: "2",
		reasons: ["upProbability=0.57"],
	});
	polymarketMocks.getPolymarketGeoblockStatus.mockResolvedValue({
		blocked: false,
		country: "JP",
		region: "27",
		ip: "1.2.3.4",
	});
});

afterEach(() => {
	global.fetch = ORIGINAL_FETCH;
	for (const key of TRANSFER_MAP_ENV_KEYS) {
		const value = TRANSFER_MAP_ENV_SNAPSHOT[key];
		if (value == null) {
			Reflect.deleteProperty(process.env, key);
		} else {
			process.env[key] = value;
		}
	}
	for (const key of PANCAKE_V2_ENV_KEYS) {
		const value = PANCAKE_V2_ENV_SNAPSHOT[key];
		if (value == null) {
			Reflect.deleteProperty(process.env, key);
		} else {
			process.env[key] = value;
		}
	}
});

describe("evm read tools", () => {
	it("returns effective transfer token map", async () => {
		const tool = getTool("evm_getTransferTokenMap");
		const result = await tool.execute("t0", {
			network: "base",
		});
		expect(result.content[0]?.text).toContain("EVM transfer token map");
		expect(result.content[0]?.text).toContain("USDC");
		expect(result.details).toMatchObject({
			schema: "evm.transfer.token-map.v1",
			network: "base",
			env: {
				globalMapKey: "EVM_TRANSFER_TOKEN_MAP",
				decimalsKey: "EVM_TRANSFER_TOKEN_DECIMALS",
			},
		});
	});

	it("reads builtin PancakeV2 config when env is unset", async () => {
		const tool = getTool("evm_getPancakeV2Config");
		const result = await tool.execute("t0b", {
			network: "bsc",
		});
		expect(result.content[0]?.text).toContain("PancakeV2 config bsc");
		expect(result.content[0]?.text).toContain("source=builtin");
		expect(result.content[0]?.text).toContain("configured=yes");
		expect(result.details).toMatchObject({
			schema: "evm.pancakev2.config.v1",
			targetNetwork: "bsc",
			allRequested: false,
			networks: [
				{
					network: "bsc",
					source: "builtin",
					configured: true,
					config: {
						factoryAddress: "0xca143ce32fe78f1f7019d7d551a6402fc5350c73",
						routerAddress: "0x10ed43c718714eb63d5aa57b78b54704e256024e",
						wrappedNativeAddress: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
					},
				},
			],
		});
	});

	it("validates configured non-BSC PancakeV2 config in read tool", async () => {
		process.env.EVM_PANCAKE_V2_FACTORY_POLYGON =
			"0x1111111111111111111111111111111111111111";
		process.env.EVM_PANCAKE_V2_ROUTER_POLYGON =
			"0x2222222222222222222222222222222222222222";
		process.env.EVM_PANCAKE_V2_WRAPPED_NATIVE_POLYGON =
			"0x3333333333333333333333333333333333333333";
		const tool = getTool("evm_getPancakeV2Config");
		const result = await tool.execute("t0c", {
			network: "polygon",
		});
		expect(result.content[0]?.text).toContain("PancakeV2 config polygon");
		expect(result.content[0]?.text).toContain("source=env");
		expect(result.content[0]?.text).toContain("configured=yes");
		expect(result.details).toMatchObject({
			schema: "evm.pancakev2.config.v1",
			targetNetwork: "polygon",
			allRequested: false,
			networks: [
				{
					network: "polygon",
					source: "env",
					configured: true,
					config: {
						factoryAddress: "0x1111111111111111111111111111111111111111",
						routerAddress: "0x2222222222222222222222222222222222222222",
						wrappedNativeAddress: "0x3333333333333333333333333333333333333333",
					},
				},
			],
		});
	});

	it("applies env override in transfer token map view", async () => {
		process.env.EVM_TRANSFER_TOKEN_MAP_BASE = JSON.stringify({
			USDT: "0x1111111111111111111111111111111111111111",
		});
		const tool = getTool("evm_getTransferTokenMap");
		const result = await tool.execute("t0-1", {
			network: "base",
			symbol: "usdt",
		});
		expect(result.details).toMatchObject({
			schema: "evm.transfer.token-map.v1",
			network: "base",
			symbol: "USDT",
			symbols: [
				{
					symbol: "USDT",
					addresses: {
						base: "0x1111111111111111111111111111111111111111",
					},
				},
			],
		});
	});

	it("returns BTC 5m markets", async () => {
		polymarketMocks.getPolymarketBtc5mMarkets.mockResolvedValue([
			{
				slug: "btc-updown-5m-abc",
				question: "Bitcoin Up or Down - 5m",
				volume24hr: 1000,
				legs: [
					{ outcome: "Up", tokenId: "11", price: 0.6 },
					{ outcome: "Down", tokenId: "22", price: 0.4 },
				],
			},
		]);
		const tool = getTool("evm_polymarketGetBtc5mMarkets");
		const result = await tool.execute("t1", {
			network: "polygon",
		});
		expect(result.content[0]?.text).toContain("BTC 5m markets");
		expect(result.content[0]?.text).toContain("btc-updown-5m-abc");
		expect(result.details).toMatchObject({
			network: "polygon",
			marketCount: 1,
		});
	});

	it("returns orderbook snapshot", async () => {
		const tool = getTool("evm_polymarketGetOrderbook");
		const result = await tool.execute("t2", {
			tokenId: "1",
			depth: 1,
		});
		expect(polymarketMocks.getPolymarketOrderBook).toHaveBeenCalledWith("1");
		expect(result.content[0]?.text).toContain("bestBid=0.49");
		expect(result.details).toMatchObject({
			orderbook: {
				tokenId: "1",
				bids: [{ price: 0.49, size: 10 }],
			},
		});
	});

	it("returns ai advice", async () => {
		const tool = getTool("evm_polymarketGetBtc5mAdvice");
		const result = await tool.execute("t3", {});
		expect(result.content[0]?.text).toContain("side=up");
		expect(result.details).toMatchObject({
			advice: {
				recommendedSide: "up",
				confidence: 0.72,
			},
		});
	});

	it("discovers BSC dexscreener pairs with dex filter", async () => {
		mockJsonFetch({
			pairs: [
				{
					chainId: "bsc",
					pairAddress: "0xpair1",
					dexId: "pancakeswap",
					url: "https://dexscreener.com/bsc/0xpair1",
					baseToken: { symbol: "WBNB", address: "0xwbnb" },
					quoteToken: { symbol: "USDT", address: "0xusdt" },
					priceUsd: "0.5",
					liquidity: { usd: "1200000" },
					volume: { h24: "3400000" },
				},
				{
					chainId: "ethereum",
					pairAddress: "0xpair2",
					dexId: "pancakeswap",
					baseToken: { symbol: "WETH", address: "0xweth" },
					quoteToken: { symbol: "USDT", address: "0xusdt" },
				},
			],
		});
		const tool = getTool("evm_dexscreenerPairs");
		const result = await tool.execute("t4", {
			query: "WBNB",
			network: "bsc",
			dexId: "pancakeswap",
		});
		expect(result.content[0]?.text).toContain(
			"DexScreener pairs (bsc dexId=pancakeswap):",
		);
		expect(result.content[0]?.text).toContain("WBNB/USDT");
		expect(result.details).toMatchObject({
			network: "bsc",
			dexId: "pancakeswap",
			pairCount: 1,
		});
	});

	it("resolves token pairs on BSC from dexscreener token endpoint", async () => {
		mockJsonFetch({
			pairs: [
				{
					chainId: "bsc",
					pairAddress: "0xpair3",
					dexId: "pancakeswap",
					url: "https://dexscreener.com/bsc/0xpair3",
					baseToken: { symbol: "WBNB", address: "0xwbnb" },
					quoteToken: { symbol: "USDT", address: "0xUSDTADDRESS" },
					priceUsd: "0.4",
					liquidity: { usd: 860000 },
				},
				{
					chainId: "bsc",
					pairAddress: "0xpair4",
					dexId: "biswap",
					baseToken: { symbol: "DOGE", address: "0xdoge" },
					quoteToken: { symbol: "CAKE", address: "0xcake" },
				},
			],
		});
		const tool = getTool("evm_dexscreenerTokenPairs");
		const result = await tool.execute("t5", {
			tokenAddress: "0xUSDTADDRESS",
			network: "bsc",
		});
		expect(result.content[0]?.text).toContain("DexScreener token pairs (bsc):");
		const details = result.details as {
			pairs?: unknown[];
			network: string;
			tokenAddress: string;
			pairCount: number;
		};
		expect(details.pairs).toHaveLength(1);
		expect(details).toMatchObject({
			network: "bsc",
			tokenAddress: "0xUSDTADDRESS",
			pairCount: 1,
		});
	});

	it("can inspect all PancakeV2 network configs in one call", async () => {
		process.env.EVM_PANCAKE_V2_FACTORY_POLYGON =
			"0x1111111111111111111111111111111111111111";
		process.env.EVM_PANCAKE_V2_ROUTER_POLYGON =
			"0x2222222222222222222222222222222222222222";
		process.env.EVM_PANCAKE_V2_WRAPPED_NATIVE_POLYGON =
			"0x3333333333333333333333333333333333333333";
		process.env.EVM_PANCAKE_V2_FACTORY_BSC = "undefined";
		const tool = getTool("evm_getPancakeV2Config");
		const result = await tool.execute("t0-all", {
			all: true,
		});
		expect(result.content[0]?.text).toContain("PancakeV2 config bsc");
		expect(result.content[0]?.text).toContain("PancakeV2 config polygon");
		expect(result.content[0]?.text).toContain("source=builtin");
		expect(result.content[0]?.text).toContain("source=env");
		expect(
			Array.isArray((result.details as { networks: unknown[] }).networks),
		).toBe(true);
		expect(
			(
				result.details as {
					networks: { network: string; configured: boolean }[];
				}
			).networks,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ network: "bsc" }),
				expect.objectContaining({ network: "polygon" }),
				expect.objectContaining({ network: "ethereum" }),
			]),
		);
	});
});
