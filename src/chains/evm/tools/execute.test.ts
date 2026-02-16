import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEvmTransferPolicy } from "../policy.js";

const clobMocks = vi.hoisted(() => ({
	createOrDeriveApiKey: vi.fn(),
	getOpenOrders: vi.fn(),
	getOrder: vi.fn(),
	getTrades: vi.fn(),
	cancelOrder: vi.fn(),
	cancelOrders: vi.fn(),
	cancelAll: vi.fn(),
	cancelMarketOrders: vi.fn(),
}));

const polymarketMocks = vi.hoisted(() => ({
	resolveBtc5mTradeSelection: vi.fn(),
	getPolymarketMarketBySlug: vi.fn(),
	getPolymarketOrderBook: vi.fn(),
	getPolymarketGeoblockStatus: vi.fn(),
	parseUsdStake: vi.fn((value: number) => value),
	getPolymarketClobBaseUrl: vi.fn(() => "https://clob.polymarket.com"),
	evaluateBtc5mTradeGuards: vi.fn((params: Record<string, unknown>) => {
		const orderbook = params.orderbook as {
			bestAsk?: { price: number };
			bestBid?: { price: number };
		};
		const guards = (params.guards ?? {}) as { maxSpreadBps?: number };
		const ask = orderbook.bestAsk?.price;
		const bid = orderbook.bestBid?.price;
		const spreadBps =
			ask != null && bid != null
				? (((ask - bid) / ((ask + bid) / 2)) * 10_000).toFixed(2)
				: null;
		const issues =
			guards.maxSpreadBps != null &&
			spreadBps != null &&
			Number(spreadBps) > guards.maxSpreadBps
				? [
						{
							code: "max_spread_exceeded",
							message: `Spread too wide: ${spreadBps}`,
						},
					]
				: [];
		return {
			passed: issues.length === 0,
			metrics: {
				spreadBps: spreadBps == null ? null : Number(spreadBps),
				depthUsdAtLimit: 0,
				adviceConfidence: null,
			},
			applied: {
				maxSpreadBps: guards.maxSpreadBps ?? null,
				minDepthUsd: null,
				maxStakeUsd: null,
				minConfidence: null,
			},
			issues,
		};
	}),
}));

vi.mock("@polymarket/clob-client", () => {
	class MockClobClient {
		async createOrDeriveApiKey() {
			return clobMocks.createOrDeriveApiKey();
		}

		async getOpenOrders(params?: unknown, onlyFirstPage?: boolean) {
			return clobMocks.getOpenOrders(params, onlyFirstPage);
		}

		async getOrder(orderId: string) {
			return clobMocks.getOrder(orderId);
		}

		async getTrades(params?: unknown, onlyFirstPage?: boolean) {
			return clobMocks.getTrades(params, onlyFirstPage);
		}

		async cancelOrder(payload: unknown) {
			return clobMocks.cancelOrder(payload);
		}

		async cancelOrders(orderIds: string[]) {
			return clobMocks.cancelOrders(orderIds);
		}

		async cancelAll() {
			return clobMocks.cancelAll();
		}

		async cancelMarketOrders(payload: unknown) {
			return clobMocks.cancelMarketOrders(payload);
		}
	}
	return {
		ClobClient: MockClobClient,
		Side: { BUY: "BUY", SELL: "SELL" },
		OrderType: { GTC: "GTC", FOK: "FOK", GTD: "GTD" },
	};
});

vi.mock("../polymarket.js", () => ({
	resolveBtc5mTradeSelection: polymarketMocks.resolveBtc5mTradeSelection,
	getPolymarketMarketBySlug: polymarketMocks.getPolymarketMarketBySlug,
	getPolymarketOrderBook: polymarketMocks.getPolymarketOrderBook,
	getPolymarketGeoblockStatus: polymarketMocks.getPolymarketGeoblockStatus,
	parseUsdStake: polymarketMocks.parseUsdStake,
	getPolymarketClobBaseUrl: polymarketMocks.getPolymarketClobBaseUrl,
	evaluateBtc5mTradeGuards: polymarketMocks.evaluateBtc5mTradeGuards,
}));

import { createEvmExecuteTools } from "./execute.js";

type ExecuteTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

const ORIGINAL_FETCH = global.fetch;

function getTool(name: string): ExecuteTool {
	const tool = createEvmExecuteTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ExecuteTool;
}

const PANCAKE_TEST_DATA = {
	pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
	routerAddress: "0x10ed43c718714eb63d5aa57b78b54704e256024e",
};

function encodeUint256Word(value: bigint): string {
	return value.toString(16).padStart(64, "0");
}

function encodeAddressWord(address: string): string {
	const normalized = address.toLowerCase().replace(/^0x/, "");
	return `0x${normalized.padStart(64, "0")}`;
}

function mockJsonRpcPancakeSwapFetch() {
	const tokenIn = "0x1111111111111111111111111111111111111111";
	const tokenOut = "0x2222222222222222222222222222222222222222";
	const pairAddress = PANCAKE_TEST_DATA.pairAddress;
	const reserve0 = 2_000_000n;
	const reserve1 = 1_000_000n;
	const txHash = `0x${"2".repeat(64)}`;
	const selectorGetPair = "0xe6a43905";
	const selectorToken0 = "0x0dfe1681";
	const selectorToken1 = "0xd21220a7";
	const selectorReserves = "0x0902f1ac";
	const fetchMock = vi.fn(
		async (_url: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as {
				id?: string | number;
				method?: string;
				params?: Array<{ to?: string; data?: string }>;
			};
			const method = body.method ?? "";
			let result = "0x0";
			if (method === "eth_call") {
				const payload = body.params?.[0];
				const data = payload?.data ?? "";
				switch (data.slice(0, 10)) {
					case selectorGetPair:
						result = encodeAddressWord(pairAddress);
						break;
					case selectorToken0:
						result = encodeAddressWord(tokenIn);
						break;
					case selectorToken1:
						result = encodeAddressWord(tokenOut);
						break;
					case selectorReserves:
						result = `${encodeUint256Word(reserve0)}${encodeUint256Word(reserve1)}${encodeUint256Word(0n)}`;
						break;
					default:
						result = "0x";
				}
			}
			if (method === "eth_getTransactionCount") result = "0x2";
			if (method === "eth_gasPrice") result = "0x3b9aca00";
			if (method === "eth_estimateGas") result = "0x5208";
			if (method === "eth_sendRawTransaction") result = txHash;
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				text: async () =>
					JSON.stringify({
						jsonrpc: "2.0",
						id: body.id ?? 1,
						result,
					}),
			} as Response;
		},
	);
	global.fetch = fetchMock as unknown as typeof fetch;
	return {
		fetchMock,
		tokenIn,
		tokenOut,
		txHash,
	};
}

function mockJsonRpcFetch() {
	const txHash = `0x${"1".repeat(64)}`;
	const fetchMock = vi.fn(
		async (_url: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as {
				id?: string | number;
				method?: string;
			};
			const method = body.method ?? "";
			let result = "0x0";
			if (method === "eth_getTransactionCount") result = "0x2";
			if (method === "eth_gasPrice") result = "0x3b9aca00";
			if (method === "eth_estimateGas") result = "0x5208";
			if (method === "eth_sendRawTransaction") result = txHash;
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				text: async () =>
					JSON.stringify({
						jsonrpc: "2.0",
						id: body.id ?? 1,
						result,
					}),
			} as Response;
		},
	);
	global.fetch = fetchMock as unknown as typeof fetch;
	return {
		fetchMock,
		txHash,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	global.fetch = ORIGINAL_FETCH;
	setEvmTransferPolicy({
		mode: "open",
		enforceOn: "mainnet_like",
		clearRecipients: true,
		updatedBy: "execute.test.beforeEach",
	});
	process.env.POLYMARKET_PRIVATE_KEY =
		"0x59c6995e998f97a5a0044976f6b5d8f8a3dfcc5f4f2f72f5f6f4f0f6f8f9f0a1";
	process.env.POLYMARKET_FUNDER = "0x0000000000000000000000000000000000000001";
	process.env.EVM_PRIVATE_KEY =
		"0x59c6995e998f97a5a0044976f6b5d8f8a3dfcc5f4f2f72f5f6f4f0f6f8f9f0a1";
	process.env.EVM_PANCAKE_V2_FACTORY_POLYGON = undefined;
	process.env.EVM_PANCAKE_V2_ROUTER_POLYGON = undefined;
	process.env.EVM_PANCAKE_V2_WRAPPED_NATIVE_POLYGON = undefined;
	process.env.EVM_PANCAKE_V2_CHAIN_ID_POLYGON = undefined;
	process.env.EVM_PANCAKE_V2_FACTORY_BSC = undefined;
	process.env.EVM_PANCAKE_V2_ROUTER_BSC = undefined;
	process.env.EVM_PANCAKE_V2_WRAPPED_NATIVE_BSC = undefined;
	process.env.EVM_PANCAKE_V2_CHAIN_ID_BSC = undefined;
	clobMocks.createOrDeriveApiKey.mockResolvedValue({
		key: "k",
		secret: "s",
		passphrase: "p",
	});
	clobMocks.getOpenOrders.mockResolvedValue([]);
	clobMocks.getOrder.mockResolvedValue({
		id: "order-1",
		status: "LIVE",
		market: "m1",
		asset_id: "100001",
		side: "BUY",
		original_size: "20",
		size_matched: "5",
		price: "0.51",
		outcome: "Up",
		created_at: 200,
		order_type: "GTC",
		associate_trades: ["trade-1"],
	});
	clobMocks.getTrades.mockResolvedValue([
		{
			id: "trade-1",
			taker_order_id: "order-1",
			market: "m1",
			asset_id: "100001",
			side: "BUY",
			size: "5",
			price: "0.51",
			status: "MATCHED",
			match_time: "2026-02-14T00:00:00Z",
			transaction_hash: "0xtrade",
		},
	]);
	clobMocks.cancelOrder.mockResolvedValue({ ok: true });
	clobMocks.cancelOrders.mockResolvedValue({ ok: true });
	clobMocks.cancelAll.mockResolvedValue({ ok: true });
	clobMocks.cancelMarketOrders.mockResolvedValue({ ok: true });
	polymarketMocks.resolveBtc5mTradeSelection.mockResolvedValue({
		market: { slug: "btc-updown-5m-test" },
		side: "up",
		tokenId: "100001",
	});
	polymarketMocks.getPolymarketMarketBySlug.mockResolvedValue({
		slug: "btc-updown-5m-test",
		tickSize: 0.001,
		negRisk: false,
	});
	polymarketMocks.getPolymarketOrderBook.mockResolvedValue({
		tokenId: "100001",
		bestBid: { price: 0.49, size: 10 },
		bestAsk: { price: 0.51, size: 9 },
		midpoint: 0.5,
		bids: [{ price: 0.49, size: 10 }],
		asks: [{ price: 0.51, size: 9 }],
	});
	polymarketMocks.getPolymarketGeoblockStatus.mockResolvedValue({
		blocked: false,
		country: "SG",
		region: "01",
		ip: "1.1.1.1",
	});
});

afterEach(() => {
	global.fetch = ORIGINAL_FETCH;
	process.env.EVM_PRIVATE_KEY = undefined;
	process.env.POLYMARKET_PRIVATE_KEY = undefined;
	process.env.POLYMARKET_FUNDER = undefined;
	process.env.EVM_PANCAKE_V2_FACTORY_POLYGON = undefined;
	process.env.EVM_PANCAKE_V2_ROUTER_POLYGON = undefined;
	process.env.EVM_PANCAKE_V2_WRAPPED_NATIVE_POLYGON = undefined;
	process.env.EVM_PANCAKE_V2_CHAIN_ID_POLYGON = undefined;
	process.env.EVM_PANCAKE_V2_FACTORY_BSC = undefined;
	process.env.EVM_PANCAKE_V2_ROUTER_BSC = undefined;
	process.env.EVM_PANCAKE_V2_WRAPPED_NATIVE_BSC = undefined;
	process.env.EVM_PANCAKE_V2_CHAIN_ID_BSC = undefined;
});

describe("evm execute tools", () => {
	it("marks guard blocked in polymarket place-order preview when spread exceeds threshold", async () => {
		const tool = getTool("evm_polymarketPlaceOrder");
		const result = await tool.execute("guard-preview", {
			network: "polygon",
			stakeUsd: 20,
			maxSpreadBps: 100,
		});
		expect(result.content[0]?.text).toContain("guard=blocked");
		expect(result.details).toMatchObject({
			dryRun: true,
			orderPreview: {
				guardEvaluation: {
					passed: false,
					issues: [
						{
							code: "max_spread_exceeded",
						},
					],
				},
			},
		});
	});

	it("blocks polymarket place-order execute when guard checks fail", async () => {
		const tool = getTool("evm_polymarketPlaceOrder");
		await expect(
			tool.execute("guard-execute", {
				network: "polygon",
				stakeUsd: 20,
				maxSpreadBps: 100,
				dryRun: false,
			}),
		).rejects.toThrow("Polymarket guard check failed");
		expect(clobMocks.createOrDeriveApiKey).not.toHaveBeenCalled();
	});

	it("reads polymarket order status with fill summary", async () => {
		const tool = getTool("evm_polymarketGetOrderStatus");
		const result = await tool.execute("order-status", {
			network: "polygon",
			orderId: "order-1",
		});
		expect(clobMocks.getOrder).toHaveBeenCalledWith("order-1");
		expect(result.content[0]?.text).toContain("state=partially_filled");
		expect(result.details).toMatchObject({
			orderState: "partially_filled",
			orderId: "order-1",
			tradeSummary: {
				tradeCount: 1,
			},
		});
	});

	it("lists open orders in token scope", async () => {
		clobMocks.getOpenOrders.mockResolvedValue([
			{
				id: "order-1",
				status: "LIVE",
				market: "m1",
				asset_id: "100001",
				side: "BUY",
				original_size: "20",
				size_matched: "5",
				price: "0.51",
				outcome: "Up",
				created_at: 200,
				order_type: "GTC",
			},
			{
				id: "order-2",
				status: "LIVE",
				market: "m1",
				asset_id: "100001",
				side: "BUY",
				original_size: "10",
				size_matched: "2",
				price: "0.50",
				outcome: "Up",
				created_at: 100,
				order_type: "GTC",
			},
		]);
		const tool = getTool("evm_polymarketGetOpenOrders");
		const result = await tool.execute("t1", {
			network: "polygon",
			marketSlug: "btc-updown-5m-test",
			side: "up",
		});
		expect(result.content[0]?.text).toContain("open orders");
		expect(result.content[0]?.text).toContain("2 order(s)");
		expect(clobMocks.getOpenOrders).toHaveBeenCalledWith(
			{ asset_id: "100001" },
			true,
		);
		expect(result.details).toMatchObject({
			orderCount: 2,
			tokenId: "100001",
		});
	});

	it("returns cancel preview for explicit order ids", async () => {
		clobMocks.getOpenOrders.mockResolvedValue([
			{
				id: "order-1",
				status: "LIVE",
				market: "m1",
				asset_id: "100001",
				side: "BUY",
				original_size: "20",
				size_matched: "0",
				price: "0.51",
				outcome: "Up",
				created_at: 200,
				order_type: "GTC",
			},
		]);
		const tool = getTool("evm_polymarketCancelOrder");
		const result = await tool.execute("t2", {
			network: "polygon",
			orderId: "order-1",
			dryRun: true,
		});
		expect(result.content[0]?.text).toContain("cancel preview");
		expect(clobMocks.cancelOrder).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			dryRun: true,
			targetOrderIds: ["order-1"],
		});
	});

	it("submits cancel-all when dryRun=false", async () => {
		clobMocks.getOpenOrders.mockResolvedValue([
			{
				id: "order-1",
				status: "LIVE",
				market: "m1",
				asset_id: "100001",
				side: "BUY",
				original_size: "20",
				size_matched: "0",
				price: "0.51",
				outcome: "Up",
				created_at: 200,
				order_type: "GTC",
			},
		]);
		const tool = getTool("evm_polymarketCancelOrder");
		const result = await tool.execute("t3", {
			network: "polygon",
			cancelAll: true,
			dryRun: false,
		});
		expect(clobMocks.cancelAll).toHaveBeenCalledTimes(1);
		expect(result.content[0]?.text).toContain("cancel submitted");
		expect(result.details).toMatchObject({
			dryRun: false,
			cancelAll: true,
			targetOrderIds: ["order-1"],
		});
	});

	it("filters stale orders in cancel preview by age/fill ratio", async () => {
		const nowSec = Math.floor(Date.now() / 1000);
		clobMocks.getOpenOrders.mockResolvedValue([
			{
				id: "order-old",
				status: "LIVE",
				market: "m1",
				asset_id: "100001",
				side: "BUY",
				original_size: "20",
				size_matched: "1",
				price: "0.51",
				outcome: "Up",
				created_at: nowSec - 3600,
				order_type: "GTC",
			},
			{
				id: "order-fresh",
				status: "LIVE",
				market: "m1",
				asset_id: "100001",
				side: "BUY",
				original_size: "20",
				size_matched: "19",
				price: "0.51",
				outcome: "Up",
				created_at: nowSec - 120,
				order_type: "GTC",
			},
		]);
		const tool = getTool("evm_polymarketCancelOrder");
		const result = await tool.execute("t3-stale-preview", {
			network: "polygon",
			tokenId: "100001",
			maxAgeMinutes: 30,
			maxFillRatio: 0.5,
			dryRun: true,
		});
		expect(result.content[0]?.text).toContain("targetOrders=1");
		expect(result.details).toMatchObject({
			dryRun: true,
			targetOrderIds: ["order-old"],
			filteredOrderCount: 1,
		});
	});

	it("submits stale-filtered cancel via cancelOrders", async () => {
		const nowSec = Math.floor(Date.now() / 1000);
		clobMocks.getOpenOrders.mockResolvedValue([
			{
				id: "order-old",
				status: "LIVE",
				market: "m1",
				asset_id: "100001",
				side: "BUY",
				original_size: "20",
				size_matched: "1",
				price: "0.51",
				outcome: "Up",
				created_at: nowSec - 7200,
				order_type: "GTC",
			},
			{
				id: "order-fresh",
				status: "LIVE",
				market: "m1",
				asset_id: "100001",
				side: "BUY",
				original_size: "20",
				size_matched: "0",
				price: "0.51",
				outcome: "Up",
				created_at: nowSec - 30,
				order_type: "GTC",
			},
		]);
		const tool = getTool("evm_polymarketCancelOrder");
		const result = await tool.execute("t3-stale-exec", {
			network: "polygon",
			tokenId: "100001",
			maxAgeMinutes: 30,
			dryRun: false,
		});
		expect(clobMocks.cancelOrders).toHaveBeenCalledWith(["order-old"]);
		expect(clobMocks.cancelMarketOrders).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			dryRun: false,
			targetOrderIds: ["order-old"],
		});
	});

	it("rejects cancel without selector", async () => {
		const tool = getTool("evm_polymarketCancelOrder");
		await expect(
			tool.execute("t4", {
				network: "polygon",
				dryRun: true,
			}),
		).rejects.toThrow("Provide cancelAll=true");
	});

	it("previews native transfer in dryRun", async () => {
		const tool = getTool("evm_transferNative");
		const result = await tool.execute("t5", {
			network: "polygon",
			toAddress: "0x000000000000000000000000000000000000dEaD",
			amountNative: 0.01,
		});
		expect(result.content[0]?.text).toContain("transfer preview");
		expect(result.details).toMatchObject({
			dryRun: true,
			amountWei: "10000000000000000",
			network: "polygon",
		});
	});

	it("submits native transfer when confirmed", async () => {
		const { fetchMock, txHash } = mockJsonRpcFetch();
		const tool = getTool("evm_transferNative");
		const result = await tool.execute("t6", {
			network: "polygon",
			toAddress: "0x000000000000000000000000000000000000dEaD",
			amountNative: 0.001,
			dryRun: false,
			confirmMainnet: true,
		});
		expect(result.content[0]?.text).toContain("transfer submitted");
		expect(result.details).toMatchObject({
			dryRun: false,
			txHash,
		});
		const methods = fetchMock.mock.calls.map((call) => {
			const body = JSON.parse(String(call[1]?.body ?? "{}")) as {
				method?: string;
			};
			return body.method;
		});
		expect(methods).toContain("eth_sendRawTransaction");
	});

	it("submits erc20 transfer when confirmed", async () => {
		const { fetchMock, txHash } = mockJsonRpcFetch();
		const tool = getTool("evm_transferErc20");
		const result = await tool.execute("t7", {
			network: "polygon",
			tokenAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
			toAddress: "0x000000000000000000000000000000000000dEaD",
			amountRaw: "1000000",
			dryRun: false,
			confirmMainnet: true,
		});
		expect(result.content[0]?.text).toContain("ERC20 transfer submitted");
		expect(result.details).toMatchObject({
			dryRun: false,
			txHash,
			amountRaw: "1000000",
		});
		const methods = fetchMock.mock.calls.map((call) => {
			const body = JSON.parse(String(call[1]?.body ?? "{}")) as {
				method?: string;
			};
			return body.method;
		});
		expect(methods).toContain("eth_sendRawTransaction");
	});

	it("blocks mainnet transfer execute without confirmMainnet", async () => {
		const tool = getTool("evm_transferNative");
		await expect(
			tool.execute("t8", {
				network: "polygon",
				toAddress: "0x000000000000000000000000000000000000dEaD",
				amountNative: 0.001,
				dryRun: false,
			}),
		).rejects.toThrow("Mainnet transfer blocked");
	});

	it("blocks transfer when allowlist policy denies recipient", async () => {
		setEvmTransferPolicy({
			mode: "allowlist",
			enforceOn: "mainnet_like",
			allowedRecipients: ["0x000000000000000000000000000000000000beef"],
			updatedBy: "execute.test.policy",
		});
		const tool = getTool("evm_transferNative");
		await expect(
			tool.execute("t9", {
				network: "polygon",
				toAddress: "0x000000000000000000000000000000000000dEaD",
				amountNative: 0.001,
				dryRun: false,
				confirmMainnet: true,
			}),
		).rejects.toThrow("Transfer blocked by policy");
	});

	it("previews BSC PancakeSwap V2 quote and swap tx", async () => {
		const { fetchMock, tokenIn, tokenOut } = mockJsonRpcPancakeSwapFetch();
		const tool = getTool("evm_pancakeV2Swap");
		const result = await tool.execute("swap-preview", {
			network: "bsc",
			tokenInAddress: tokenIn,
			tokenOutAddress: tokenOut,
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dEaD",
			slippageBps: 50,
			dryRun: true,
		});
		expect(result.content[0]?.text).toContain("PancakeSwap V2 swap preview");
		if (typeof result.details === "object" && result.details !== null) {
			expect((result.details as { amountOutRaw?: string }).amountOutRaw).toBe(
				"4960",
			);
		}
		expect(result.details).toMatchObject({
			dryRun: true,
			network: "bsc",
			tokenInAddress: tokenIn,
			tokenOutAddress: tokenOut,
			pairAddress: PANCAKE_TEST_DATA.pairAddress,
			tx: {
				toAddress: PANCAKE_TEST_DATA.routerAddress,
			},
		});
		const methods = fetchMock.mock.calls.map((call) => {
			const body = JSON.parse(String(call[1]?.body ?? "{}")) as {
				method?: string;
			};
			return body.method;
		});
		expect(methods).toContain("eth_call");
		expect(methods).not.toContain("eth_sendRawTransaction");
	});

	it("submits BSC PancakeSwap V2 swap when confirmed", async () => {
		const { fetchMock, tokenIn, tokenOut, txHash } =
			mockJsonRpcPancakeSwapFetch();
		const tool = getTool("evm_pancakeV2Swap");
		const result = await tool.execute("swap-submit", {
			network: "bsc",
			tokenInAddress: tokenIn,
			tokenOutAddress: tokenOut,
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dEaD",
			deadlineMinutes: 10,
			confirmMainnet: true,
			dryRun: false,
		});
		expect(result.content[0]?.text).toContain("swap submitted");
		expect(result.details).toMatchObject({
			dryRun: false,
			network: "bsc",
			txHash,
		});
		if (typeof result.details === "object" && result.details !== null) {
			expect((result.details as { amountOutRaw?: string }).amountOutRaw).toBe(
				"4960",
			);
		}
		const methods = fetchMock.mock.calls.map((call) => {
			const body = JSON.parse(String(call[1]?.body ?? "{}")) as {
				method?: string;
			};
			return body.method;
		});
		expect(methods).toContain("eth_sendRawTransaction");
	});

	it("rejects PancakeSwap V2 swap on unsupported network config", async () => {
		const { tokenIn, tokenOut } = mockJsonRpcPancakeSwapFetch();
		const tool = getTool("evm_pancakeV2Swap");
		await expect(
			tool.execute("swap-unsupported", {
				network: "polygon",
				tokenInAddress: tokenIn,
				tokenOutAddress: tokenOut,
				amountInRaw: "10000",
				toAddress: "0x000000000000000000000000000000000000dEaD",
				dryRun: true,
			}),
		).rejects.toThrow(
			"PancakeSwap v2 execution is not configured for network=polygon. Configure EVM_PANCAKE_V2_FACTORY_POLYGON",
		);
	});

	it("falls back to built-in config when env values are literal 'undefined'", async () => {
		process.env.EVM_PANCAKE_V2_FACTORY_BSC = "undefined";
		process.env.EVM_PANCAKE_V2_ROUTER_BSC = "undefined";
		process.env.EVM_PANCAKE_V2_WRAPPED_NATIVE_BSC = "undefined";
		const { fetchMock, tokenIn, tokenOut } = mockJsonRpcPancakeSwapFetch();
		const tool = getTool("evm_pancakeV2Swap");
		const result = await tool.execute("swap-legacy-fallback-bsc", {
			network: "bsc",
			tokenInAddress: tokenIn,
			tokenOutAddress: tokenOut,
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dEaD",
			slippageBps: 50,
			dryRun: true,
		});
		expect(result.content[0]?.text).toContain("PancakeSwap V2 swap preview");
		expect(result.details).toMatchObject({
			dryRun: true,
			network: "bsc",
			tx: {
				toAddress: PANCAKE_TEST_DATA.routerAddress,
			},
		});
		if (typeof result.details === "object" && result.details !== null) {
			expect((result.details as { amountOutRaw?: string }).amountOutRaw).toBe(
				"4960",
			);
		}
		const methods = fetchMock.mock.calls.map((call) => {
			const body = JSON.parse(String(call[1]?.body ?? "{}")) as {
				method?: string;
			};
			return body.method;
		});
		expect(methods).toContain("eth_call");
	});

	it("previews PancakeSwap V2 swap on configured non-BSC network", async () => {
		process.env.EVM_PANCAKE_V2_FACTORY_POLYGON =
			"0x1111111111111111111111111111111111111111";
		process.env.EVM_PANCAKE_V2_ROUTER_POLYGON =
			"0x2222222222222222222222222222222222222222";
		process.env.EVM_PANCAKE_V2_WRAPPED_NATIVE_POLYGON =
			"0x3333333333333333333333333333333333333333";
		const { fetchMock, tokenIn, tokenOut } = mockJsonRpcPancakeSwapFetch();
		const tool = getTool("evm_pancakeV2Swap");
		const result = await tool.execute("swap-preview-configured", {
			network: "polygon",
			tokenInAddress: tokenIn,
			tokenOutAddress: tokenOut,
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dEaD",
			slippageBps: 50,
			dryRun: true,
		});
		expect(result.content[0]?.text).toContain("PancakeSwap V2 swap preview");
		expect(result.details).toMatchObject({
			dryRun: true,
			network: "polygon",
			tx: {
				toAddress: "0x2222222222222222222222222222222222222222",
			},
		});
		if (typeof result.details === "object" && result.details !== null) {
			expect((result.details as { amountOutRaw?: string }).amountOutRaw).toBe(
				"4960",
			);
		}
		const methods = fetchMock.mock.calls.map((call) => {
			const body = JSON.parse(String(call[1]?.body ?? "{}")) as {
				method?: string;
			};
			return body.method;
		});
		expect(methods).toContain("eth_call");
	});
});
