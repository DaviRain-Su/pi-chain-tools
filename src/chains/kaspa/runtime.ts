import { Type } from "@sinclair/typebox";

export type KaspaNetwork = "mainnet" | "testnet";

export const KASPA_TOOL_PREFIX = "kaspa_";

const KASPA_API_TIMEOUT_MS = 15_000;

export function kaspaNetworkSchema() {
	return Type.Optional(Type.Union([Type.Literal("mainnet"), Type.Literal("testnet")]));
}

export function parseKaspaNetwork(value?: string): KaspaNetwork {
	if (value === "testnet") return "testnet";
	return "mainnet";
}

export function getKaspaApiBaseUrl(overrideUrl?: string): string {
	if (overrideUrl?.trim()) return overrideUrl.trim();
	const env = process.env.KASPA_API_BASE_URL?.trim();
	if (env) return env;
	return "https://api.kas.fyi";
}

export function getKaspaApiKey(overrideApiKey?: string): string | undefined {
	const explicit = overrideApiKey?.trim();
	if (explicit) return explicit;
	return process.env.KASPA_API_KEY?.trim();
}

export function normalizeKaspaAddress(value: string): string {
	const normalized = value.trim();
	if (!/^kaspa:[a-z0-9]+$/i.test(normalized)) {
		throw new Error("address must be a valid Kaspa address (starting with kaspa:). ");
	}
	return normalized;
}

export type KaspaApiQueryValue = string | number | boolean;

function normalizeApiQuery(params: Record<string, KaspaApiQueryValue | undefined>) {
	const result: Record<string, string> = {};
	for (const [key, rawValue] of Object.entries(params)) {
		if (rawValue === undefined) continue;
		result[key] = String(rawValue);
	}
	return result;
}

export async function kaspaApiJsonGet<T>(params: {
	baseUrl: string;
	path: string;
	query?: Record<string, KaspaApiQueryValue | undefined>;
	apiKey?: string;
	timeoutMs?: number;
}): Promise<T> {
	const base = params.baseUrl.trim().replace(/\/$/, "");
	const path = params.path.startsWith("/") ? params.path : `/${params.path}`;
	const url = new URL(`${base}${path}`);
	const query = normalizeApiQuery(params.query ?? {});
	for (const [key, rawValue] of Object.entries(query)) {
		url.searchParams.set(key, rawValue);
	}

	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		params.timeoutMs ?? KASPA_API_TIMEOUT_MS,
	);
	try {
		const headers: Record<string, string> = {
			accept: "application/json",
		};
		if (params.apiKey?.trim()) {
			headers["x-api-key"] = params.apiKey.trim();
		}
		const response = await fetch(url, {
			method: "GET",
			headers,
			signal: controller.signal,
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(
				`Kaspa API request failed: HTTP ${response.status} ${response.statusText} (${url}) ${text || "no body"}`,
			);
		}
		try {
			return JSON.parse(text) as T;
		} catch (error) {
			const details = error instanceof Error ? error.message : String(error);
			throw new Error(`Invalid JSON response from Kaspa API: ${details}`);
		}
	} finally {
		clearTimeout(timeout);
	}
}

export function parseKaspaLimit(value: unknown): number | undefined {
	if (value == null) return undefined;
	if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseInt(value.trim(), 10);
		if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) {
			return parsed;
		}
	}
	throw new Error("limit must be an integer between 1 and 100");
}

export function parseKaspaBoolean(value: unknown): boolean | undefined {
	if (value == null) return undefined;
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		if (value === "true") return true;
		if (value === "false") return false;
	}
	throw new Error("boolean flag must be true or false");
}
