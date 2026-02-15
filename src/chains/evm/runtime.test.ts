import { afterEach, describe, expect, it, vi } from "vitest";
import { EvmHttpError, evmHttpJson } from "./runtime.js";

const ORIGINAL_FETCH = global.fetch;

const jsonHeaders = { "content-type": "application/json" };

function createResponse(params: {
	status: number;
	statusText?: string;
	body: string;
}): Response {
	return new Response(params.body, {
		status: params.status,
		statusText: params.statusText,
		headers: jsonHeaders,
	});
}

afterEach(() => {
	global.fetch = ORIGINAL_FETCH;
	vi.useRealTimers();
});

describe("evmHttpJson", () => {
	it("parses valid JSON payload", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(createResponse({ status: 200, body: '{"ok":true}' }));
		global.fetch = fetchMock as unknown as typeof fetch;

		const result = await evmHttpJson<{ ok: boolean }>({
			url: "https://example.com/api",
		});
		expect(result).toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("rejects empty body instead of returning null", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(createResponse({ status: 200, body: "   " }));
		global.fetch = fetchMock as unknown as typeof fetch;

		await expect(
			evmHttpJson({ url: "https://example.com/empty" }),
		).rejects.toThrow("Empty response");
	});

	it("retries once on 429 and eventually succeeds", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				createResponse({ status: 429, body: '{"error":"rate limited"}' }),
			)
			.mockResolvedValueOnce(createResponse({ status: 200, body: '{"ok":1}' }));
		global.fetch = fetchMock as unknown as typeof fetch;

		const result = await evmHttpJson<{ ok: number }>({
			url: "https://example.com/rate-limit",
			maxRetries: 1,
			retryBaseMs: 0,
			maxRetryDelayMs: 0,
		});
		expect(result).toEqual({ ok: 1 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("does not retry non-retryable HTTP errors", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				createResponse({ status: 404, body: '{"error":"missing"}' }),
			);
		global.fetch = fetchMock as unknown as typeof fetch;

		const promise = evmHttpJson({
			url: "https://example.com/not-found",
			maxRetries: 3,
			retryBaseMs: 0,
			maxRetryDelayMs: 0,
		});
		await expect(promise).rejects.toBeInstanceOf(EvmHttpError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("throws with parse context on invalid JSON", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(createResponse({ status: 200, body: "not-json" }));
		global.fetch = fetchMock as unknown as typeof fetch;

		await expect(
			evmHttpJson({ url: "https://example.com/invalid-json" }),
		).rejects.toThrow("Invalid JSON");
	});
});
