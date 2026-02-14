import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("evm read tools", () => {
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
});
