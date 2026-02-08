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
});
