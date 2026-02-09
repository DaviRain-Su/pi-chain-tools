import { beforeEach, describe, expect, it, vi } from "vitest";

const jupiterMocks = vi.hoisted(() => ({
	createJupiterApiClient: vi.fn(),
	client: {
		programIdToLabelGet: vi.fn(),
		quoteGet: vi.fn(),
		swapPost: vi.fn(),
		swapInstructionsPost: vi.fn(),
	},
}));

const raydiumMocks = vi.hoisted(() => ({
	request: vi.fn(),
	get: vi.fn(),
	constructorArgs: [] as unknown[],
}));

vi.mock("@jup-ag/api", () => ({
	createJupiterApiClient: jupiterMocks.createJupiterApiClient,
}));

vi.mock("@raydium-io/raydium-sdk-v2", () => {
	class MockRaydiumApiClient {
		api = {
			request: raydiumMocks.request,
			get: raydiumMocks.get,
		};

		constructor(config: unknown) {
			raydiumMocks.constructorArgs.push(config);
		}
	}

	return {
		API_URLS: {
			BASE_HOST: "https://api-v3.raydium.io",
			SWAP_HOST: "https://transaction-v1.raydium.io",
			PRIORITY_FEE: "/main/auto-fee",
		},
		Api: MockRaydiumApiClient,
	};
});

import {
	callRaydiumApi,
	getJupiterQuote,
	getKaminoLendingPositions,
	getKaminoMarkets,
	getRaydiumPriorityFee,
} from "./runtime.js";

function jsonResponse(payload: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : "ERROR",
		text: async () => JSON.stringify(payload),
	} as unknown as Response;
}

describe("runtime SDK integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		raydiumMocks.constructorArgs.length = 0;
		jupiterMocks.createJupiterApiClient.mockReturnValue(jupiterMocks.client);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("unexpected fetch");
			}) as unknown as typeof fetch,
		);
	});

	it("uses Jupiter SDK quoteGet for safe integer amount", async () => {
		jupiterMocks.client.quoteGet.mockResolvedValueOnce({ outAmount: "42" });
		const result = await getJupiterQuote({
			inputMint: "inMint",
			outputMint: "outMint",
			amount: "123",
		});

		expect(result).toEqual({ outAmount: "42" });
		expect(jupiterMocks.client.quoteGet).toHaveBeenCalledWith(
			expect.objectContaining({
				inputMint: "inMint",
				outputMint: "outMint",
				amount: 123,
			}),
		);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("falls back to Jupiter REST when amount is not SDK-safe", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			jsonResponse({ outAmount: "99", routePlan: [] }),
		);
		const tooLarge = (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString();
		const result = await getJupiterQuote({
			inputMint: "inMint",
			outputMint: "outMint",
			amount: tooLarge,
		});

		expect(result).toEqual({ outAmount: "99", routePlan: [] });
		expect(jupiterMocks.client.quoteGet).not.toHaveBeenCalled();
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toContain(
			"/swap/v1/quote?",
		);
	});

	it("uses Raydium SDK request for swap compute API", async () => {
		raydiumMocks.request.mockResolvedValueOnce({
			success: true,
			source: "sdk",
		});
		const result = await callRaydiumApi("/compute/swap-base-in", {
			method: "GET",
			query: {
				inputMint: "inMint",
				outputMint: "outMint",
				amount: "1",
			},
		});

		expect(result).toEqual({ success: true, source: "sdk" });
		expect(raydiumMocks.request).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://transaction-v1.raydium.io",
				url: "/compute/swap-base-in",
				method: "GET",
			}),
		);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("falls back to REST when Raydium SDK request fails", async () => {
		raydiumMocks.request.mockRejectedValueOnce(new Error("sdk down"));
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			jsonResponse({ success: true, source: "fallback" }),
		);

		const result = await callRaydiumApi("compute/swap-base-in", {
			method: "GET",
			query: { inputMint: "inMint" },
		});

		expect(result).toEqual({ success: true, source: "fallback" });
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toContain(
			"https://transaction-v1.raydium.io/compute/swap-base-in?inputMint=inMint",
		);
	});

	it("uses Raydium SDK for priority fee and falls back on failure", async () => {
		raydiumMocks.get.mockResolvedValueOnce({ data: { default: { h: 123 } } });
		const sdkResult = await getRaydiumPriorityFee();
		expect(sdkResult).toEqual({ data: { default: { h: 123 } } });
		expect(raydiumMocks.get).toHaveBeenCalledWith("/main/auto-fee");

		raydiumMocks.get.mockRejectedValueOnce(new Error("sdk down"));
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			jsonResponse({ data: { default: { h: 456 } } }),
		);
		const fallbackResult = await getRaydiumPriorityFee();
		expect(fallbackResult).toEqual({ data: { default: { h: 456 } } });
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe(
			"https://api-v3.raydium.io/main/auto-fee",
		);
	});

	it("fetches Kamino markets from v2 API", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			jsonResponse([
				{
					lendingMarket: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
					name: "Main Market",
				},
			]),
		);
		const markets = await getKaminoMarkets();
		expect(markets).toHaveLength(1);
		expect(markets[0]).toMatchObject({
			lendingMarket: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
			name: "Main Market",
		});
		expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe(
			"https://api.kamino.finance/v2/kamino-market",
		);
	});

	it("aggregates Kamino lending positions across markets", async () => {
		vi.mocked(globalThis.fetch)
			.mockResolvedValueOnce(
				jsonResponse([
					{
						lendingMarket: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
						name: "Main Market",
					},
				]),
			)
			.mockResolvedValueOnce(
				jsonResponse([
					{
						obligation: "7VhV9LhDdVZK4fhL4PA4FBNrEFhP7KAMsoNqd7qV3Cy8",
						owner: "8uAPC2UxiBjKmUksVVwUA6q4RctiXkgSAsovBR39cd1i",
						deposits: [
							{
								reserveAddress: "So11111111111111111111111111111111111111112",
								mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
								amountRaw: "1000000",
								amountUi: 1,
								marketValueRefreshed: 1.5,
							},
						],
						borrows: [
							{
								reserveAddress: "So11111111111111111111111111111111111111112",
								mintAddress: "So11111111111111111111111111111111111111112",
								amountRaw: "100000",
								amountUi: 0.1,
								marketValueRefreshed: 0.5,
							},
						],
						refreshedStats: {
							totalDepositValue: 1.5,
							totalBorrowValue: 0.5,
							loanToValue: 0.3333,
						},
					},
				]),
			);

		const result = await getKaminoLendingPositions({
			address: "8uAPC2UxiBjKmUksVVwUA6q4RctiXkgSAsovBR39cd1i",
			network: "mainnet-beta",
			limitMarkets: 1,
		});

		expect(result).toMatchObject({
			protocol: "kamino",
			address: "8uAPC2UxiBjKmUksVVwUA6q4RctiXkgSAsovBR39cd1i",
			marketCountQueried: 1,
			obligationCount: 1,
			depositPositionCount: 1,
			borrowPositionCount: 1,
			totalDepositValueUsd: 1.5,
			totalBorrowValueUsd: 0.5,
			netValueUsd: 1,
			marketCountWithPositions: 1,
		});
		expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
		expect(vi.mocked(globalThis.fetch).mock.calls[1]?.[0]).toContain(
			"/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/users/8uAPC2UxiBjKmUksVVwUA6q4RctiXkgSAsovBR39cd1i/obligations?env=mainnet-beta",
		);
	});
});
