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

import { getRefSwapQuote, getRefTokenDecimalsHint } from "./ref.js";

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
});
