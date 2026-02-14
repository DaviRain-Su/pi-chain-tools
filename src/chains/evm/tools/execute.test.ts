import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEvmTransferPolicy } from "../policy.js";

const clobMocks = vi.hoisted(() => ({
	createOrDeriveApiKey: vi.fn(),
	getOpenOrders: vi.fn(),
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
}));

vi.mock("@polymarket/clob-client", () => {
	class MockClobClient {
		async createOrDeriveApiKey() {
			return clobMocks.createOrDeriveApiKey();
		}

		async getOpenOrders(params?: unknown, onlyFirstPage?: boolean) {
			return clobMocks.getOpenOrders(params, onlyFirstPage);
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
	clobMocks.createOrDeriveApiKey.mockResolvedValue({
		key: "k",
		secret: "s",
		passphrase: "p",
	});
	clobMocks.getOpenOrders.mockResolvedValue([]);
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
});

describe("evm execute tools", () => {
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
});
