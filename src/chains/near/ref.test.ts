import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	callNearRpc: vi.fn(),
	parseNearNetwork: vi.fn((value?: string) =>
		value === "testnet" ? "testnet" : "mainnet",
	),
}));

vi.mock("./runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("./runtime.js")>("./runtime.js");
	return {
		...actual,
		callNearRpc: runtimeMocks.callNearRpc,
		parseNearNetwork: runtimeMocks.parseNearNetwork,
	};
});

import {
	fetchRefPoolById,
	findRefPoolForPair,
	getRefSwapQuote,
	getRefTokenDecimalsHint,
	resolveRefTokenIds,
} from "./ref.js";

function encodeJsonResult(value: unknown): number[] {
	return [...Buffer.from(JSON.stringify(value), "utf8")];
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.parseNearNetwork.mockImplementation((value?: string) =>
		value === "testnet" ? "testnet" : "mainnet",
	);
});

describe("getRefTokenDecimalsHint", () => {
	it("returns defaults for NEAR and USDC symbols", () => {
		expect(
			getRefTokenDecimalsHint({ network: "mainnet", tokenIdOrSymbol: "NEAR" }),
		).toBe(24);
		expect(
			getRefTokenDecimalsHint({ network: "mainnet", tokenIdOrSymbol: "USDC" }),
		).toBe(6);
	});
});

describe("resolveRefTokenIds", () => {
	it("maps symbol to token ids and applies optional pool filter", () => {
		const all = resolveRefTokenIds({
			network: "mainnet",
			tokenIdOrSymbol: "USDC",
		});
		expect(all).toContain("usdc.tether-token.near");

		const filtered = resolveRefTokenIds({
			network: "mainnet",
			tokenIdOrSymbol: "USDC",
			availableTokenIds: ["wrap.near", "usdc.tether-token.near"],
		});
		expect(filtered).toEqual(["usdc.tether-token.near"]);
	});
});

describe("fetchRefPoolById", () => {
	it("fetches a single pool using get_pool", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			block_hash: "200",
			block_height: 10,
			logs: [],
			result: encodeJsonResult({
				token_account_ids: ["wrap.near", "usdc.tether-token.near"],
				amounts: ["1000000000000000000000", "1000000"],
				total_fee: 30,
				pool_kind: "SIMPLE_POOL",
			}),
		});

		const pool = await fetchRefPoolById({
			network: "mainnet",
			poolId: 88,
		});
		expect(pool).toMatchObject({
			id: 88,
			token_account_ids: ["wrap.near", "usdc.tether-token.near"],
			amounts: ["1000000000000000000000", "1000000"],
		});
		expect(runtimeMocks.callNearRpc).toHaveBeenCalledWith({
			method: "query",
			network: "mainnet",
			rpcUrl: undefined,
			params: {
				request_type: "call_function",
				account_id: "v2.ref-finance.near",
				method_name: "get_pool",
				args_base64: Buffer.from(
					JSON.stringify({ pool_id: 88 }),
					"utf8",
				).toString("base64"),
				finality: "final",
			},
		});
	});
});

describe("findRefPoolForPair", () => {
	it("selects best-liquidity pool for a token pair when poolId is omitted", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			block_hash: "300",
			block_height: 20,
			logs: [],
			result: encodeJsonResult([
				{
					id: 5,
					token_account_ids: ["wrap.near", "usdc.tether-token.near"],
					amounts: ["10", "10"],
					total_fee: 30,
					pool_kind: "SIMPLE_POOL",
				},
				{
					id: 6,
					token_account_ids: ["wrap.near", "usdc.tether-token.near"],
					amounts: ["100", "200"],
					total_fee: 30,
					pool_kind: "SIMPLE_POOL",
				},
			]),
		});

		const selected = await findRefPoolForPair({
			network: "mainnet",
			tokenAId: "NEAR",
			tokenBId: "USDC",
		});
		expect(selected).toMatchObject({
			poolId: 6,
			source: "bestLiquidityPool",
			tokenAId: "wrap.near",
			tokenBId: "usdc.tether-token.near",
			candidates: [
				{
					poolId: 6,
					tokenAId: "wrap.near",
					tokenBId: "usdc.tether-token.near",
				},
				{
					poolId: 5,
					tokenAId: "wrap.near",
					tokenBId: "usdc.tether-token.near",
				},
			],
		});
	});

	it("limits returned candidate pools with maxCandidates", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			block_hash: "302",
			block_height: 22,
			logs: [],
			result: encodeJsonResult([
				{
					id: 11,
					token_account_ids: ["wrap.near", "usdc.tether-token.near"],
					amounts: ["5", "5"],
					total_fee: 30,
					pool_kind: "SIMPLE_POOL",
				},
				{
					id: 12,
					token_account_ids: ["wrap.near", "usdc.tether-token.near"],
					amounts: ["10", "10"],
					total_fee: 30,
					pool_kind: "SIMPLE_POOL",
				},
				{
					id: 13,
					token_account_ids: ["wrap.near", "usdc.tether-token.near"],
					amounts: ["20", "20"],
					total_fee: 30,
					pool_kind: "SIMPLE_POOL",
				},
			]),
		});

		const selected = await findRefPoolForPair({
			network: "mainnet",
			tokenAId: "NEAR",
			tokenBId: "USDC",
			maxCandidates: 2,
		});

		expect(selected.poolId).toBe(13);
		expect(selected.candidates).toHaveLength(2);
		expect(selected.candidates[0]?.poolId).toBe(13);
		expect(selected.candidates[1]?.poolId).toBe(12);
	});

	it("validates explicit pool contains the requested pair", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			block_hash: "301",
			block_height: 21,
			logs: [],
			result: encodeJsonResult({
				token_account_ids: ["wrap.near", "usdt.tether-token.near"],
				amounts: ["10", "10"],
				total_fee: 30,
				pool_kind: "SIMPLE_POOL",
			}),
		});

		await expect(
			findRefPoolForPair({
				network: "mainnet",
				tokenAId: "NEAR",
				tokenBId: "USDC",
				poolId: 9,
			}),
		).rejects.toThrow("does not support token pair");
	});
});

describe("getRefSwapQuote", () => {
	it("resolves symbol pair in explicit pool mode", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "111",
				block_height: 1,
				logs: [],
				result: encodeJsonResult([
					{
						id: 42,
						token_account_ids: ["wrap.near", "usdc.tether-token.near"],
						amounts: ["1000000000000000000000000", "5000000000"],
						total_fee: 30,
						pool_kind: "SIMPLE_POOL",
					},
				]),
			})
			.mockResolvedValueOnce({
				block_hash: "112",
				block_height: 2,
				logs: [],
				result: encodeJsonResult("2500000"),
			});

		const quote = await getRefSwapQuote({
			network: "mainnet",
			tokenInId: "NEAR",
			tokenOutId: "USDC",
			amountInRaw: "10000000000000000000000",
			poolId: 42,
			slippageBps: 100,
		});

		expect(quote).toMatchObject({
			poolId: 42,
			tokenInId: "wrap.near",
			tokenOutId: "usdc.tether-token.near",
			amountOutRaw: "2500000",
			minAmountOutRaw: "2475000",
			source: "explicitPool",
		});
	});

	it("selects best direct simple pool when poolId is omitted", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			block_hash: "121",
			block_height: 3,
			logs: [],
			result: encodeJsonResult([
				{
					id: 1,
					token_account_ids: ["wrap.near", "usdt.tether-token.near"],
					amounts: ["1000000000000000000000000", "2000000000000"],
					total_fee: 30,
					pool_kind: "SIMPLE_POOL",
				},
				{
					id: 2,
					token_account_ids: ["wrap.near", "usdt.tether-token.near"],
					amounts: ["1000000000000000000000000", "1500000000000"],
					total_fee: 30,
					pool_kind: "SIMPLE_POOL",
				},
			]),
		});

		const quote = await getRefSwapQuote({
			network: "mainnet",
			tokenInId: "NEAR",
			tokenOutId: "USDT",
			amountInRaw: "10000000000000000000000",
		});

		expect(quote.poolId).toBe(1);
		expect(quote.tokenInId).toBe("wrap.near");
		expect(quote.tokenOutId).toBe("usdt.tether-token.near");
		expect(quote.source).toBe("bestDirectSimplePool");
	});

	it("falls back to best two-hop route when direct route is missing", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "131",
				block_height: 4,
				logs: [],
				result: encodeJsonResult([
					{
						id: 11,
						token_account_ids: ["wrap.near", "usdt.tether-token.near"],
						amounts: ["1000000000000000000000000", "2500000000000"],
						total_fee: 30,
						pool_kind: "STABLE_SWAP",
					},
					{
						id: 12,
						token_account_ids: [
							"usdt.tether-token.near",
							"usdc.tether-token.near",
						],
						amounts: ["2000000000000", "2000000000000"],
						total_fee: 30,
						pool_kind: "STABLE_SWAP",
					},
				]),
			})
			.mockResolvedValueOnce({
				block_hash: "132",
				block_height: 5,
				logs: [],
				result: encodeJsonResult("2100000"),
			})
			.mockResolvedValueOnce({
				block_hash: "133",
				block_height: 6,
				logs: [],
				result: encodeJsonResult("2050000"),
			});

		const quote = await getRefSwapQuote({
			network: "mainnet",
			tokenInId: "NEAR",
			tokenOutId: "USDC",
			amountInRaw: "10000000000000000000000",
		});

		expect(quote.source).toBe("bestTwoHopPoolRoute");
		expect(quote.poolId).toBe(11);
		expect(quote.tokenInId).toBe("wrap.near");
		expect(quote.tokenOutId).toBe("usdc.tether-token.near");
		expect(quote.actions).toEqual([
			{
				poolId: 11,
				tokenInId: "wrap.near",
				tokenOutId: "usdt.tether-token.near",
				amountInRaw: "10000000000000000000000",
			},
			{
				poolId: 12,
				tokenInId: "usdt.tether-token.near",
				tokenOutId: "usdc.tether-token.near",
				amountInRaw: "2100000",
			},
		]);
	});
});
