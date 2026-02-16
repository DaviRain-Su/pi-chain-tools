import { Type } from "@sinclair/typebox";

export type EvmNetwork =
	| "ethereum"
	| "sepolia"
	| "polygon"
	| "base"
	| "arbitrum"
	| "optimism"
	| "bsc"
	| "berachain";

export type EvmHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type EvmHttpRequestParams = {
	url: string;
	method?: EvmHttpMethod;
	headers?: Record<string, string>;
	body?: unknown;
	timeoutMs?: number;
	maxRetries?: number;
	retryBaseMs?: number;
	maxRetryDelayMs?: number;
};

export class EvmHttpError extends Error {
	status: number;
	url: string;
	responseText: string;

	constructor(params: {
		message: string;
		status: number;
		url: string;
		responseText: string;
	}) {
		super(params.message);
		this.name = "EvmHttpError";
		this.status = params.status;
		this.url = params.url;
		this.responseText = params.responseText;
	}
}

const EVM_RPC_ENDPOINTS: Record<EvmNetwork, string> = {
	ethereum: "https://ethereum.publicnode.com",
	sepolia: "https://ethereum-sepolia.publicnode.com",
	polygon: "https://polygon-bor.publicnode.com",
	base: "https://base.publicnode.com",
	arbitrum: "https://arbitrum-one.publicnode.com",
	optimism: "https://optimism.publicnode.com",
	bsc: "https://bsc.publicnode.com",
	berachain: "https://rpc.berachain.com",
};

const EVM_CHAIN_IDS: Record<EvmNetwork, number> = {
	ethereum: 1,
	sepolia: 11155111,
	polygon: 137,
	base: 8453,
	arbitrum: 42161,
	optimism: 10,
	bsc: 56,
	berachain: 80094,
};

export const EVM_TOOL_PREFIX = "evm_";

export function evmNetworkSchema() {
	return Type.Optional(
		Type.Union([
			Type.Literal("ethereum"),
			Type.Literal("sepolia"),
			Type.Literal("polygon"),
			Type.Literal("base"),
			Type.Literal("arbitrum"),
			Type.Literal("optimism"),
			Type.Literal("bsc"),
			Type.Literal("berachain"),
		]),
	);
}

export function parseEvmNetwork(value?: string): EvmNetwork {
	if (
		value === "ethereum" ||
		value === "sepolia" ||
		value === "polygon" ||
		value === "base" ||
		value === "arbitrum" ||
		value === "optimism" ||
		value === "bsc" ||
		value === "berachain"
	) {
		return value;
	}
	return "polygon";
}

export function getEvmChainId(network: EvmNetwork): number {
	return EVM_CHAIN_IDS[network];
}

export function getEvmRpcEndpoint(
	network: EvmNetwork,
	overrideUrl?: string,
): string {
	if (overrideUrl?.trim()) return overrideUrl.trim();
	const envKey = `EVM_RPC_${network.toUpperCase()}_URL`;
	const envOverride = process.env[envKey]?.trim();
	if (envOverride) return envOverride;
	return EVM_RPC_ENDPOINTS[network];
}

export function parsePositiveNumber(
	value: number | string,
	fieldName: string,
): number {
	const parsed =
		typeof value === "number" ? value : Number.parseFloat(value.trim());
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${fieldName} must be a positive number`);
	}
	return parsed;
}

export function parsePositiveIntegerString(
	value: string,
	fieldName: string,
): string {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be a positive integer string`);
	}
	if (normalized === "0") {
		throw new Error(`${fieldName} must be greater than 0`);
	}
	return normalized;
}

export function stringifyUnknown(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof Error) return value.message;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function sleep(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function computeRetryDelay(params: {
	attemp: number;
	baseMs: number;
	maxMs: number;
}): number {
	const exponential = params.baseMs * 2 ** params.attemp;
	return Math.min(Math.max(params.baseMs, exponential), params.maxMs);
}

function isRetryableStatus(status: number): boolean {
	if (status === 429) return true;
	if (status >= 500 && status <= 599) return true;
	return false;
}

function isRetryableFetchError(error: unknown): boolean {
	if (error instanceof EvmHttpError) {
		return isRetryableStatus(error.status);
	}
	if (error instanceof DOMException && error.name === "AbortError") {
		return true;
	}
	if (error instanceof TypeError) {
		return true;
	}
	return false;
}
function encodeQueryValue(value: string | number | boolean): string {
	return encodeURIComponent(String(value));
}

export function buildUrlWithQuery(
	baseUrl: string,
	query: Record<string, string | number | boolean | undefined>,
): string {
	const normalizedBase = baseUrl.trim();
	const parts: string[] = [];
	for (const [key, value] of Object.entries(query)) {
		if (value == null) continue;
		parts.push(`${encodeURIComponent(key)}=${encodeQueryValue(value)}`);
	}
	if (parts.length === 0) return normalizedBase;
	const joiner = normalizedBase.includes("?") ? "&" : "?";
	return `${normalizedBase}${joiner}${parts.join("&")}`;
}

export async function evmHttpJson<T>(params: EvmHttpRequestParams): Promise<T> {
	const method = params.method ?? "GET";
	const headers: Record<string, string> = {
		accept: "application/json",
		...(params.headers ?? {}),
	};
	const maxRetries = Math.max(0, Math.trunc(params.maxRetries ?? 2));
	const retryBaseMs = Math.max(0, Math.trunc(params.retryBaseMs ?? 250));
	const maxRetryDelayMs = Math.max(
		retryBaseMs,
		params.maxRetryDelayMs ?? 2_000,
	);
	const timeoutMs = params.timeoutMs ?? 15_000;

	let bodyText: string | undefined;
	if (params.body != null) {
		headers["content-type"] = headers["content-type"] ?? "application/json";
		bodyText =
			typeof params.body === "string"
				? params.body
				: JSON.stringify(params.body);
	}

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(params.url, {
				method,
				headers,
				body: bodyText,
				signal: controller.signal,
			});
			const responseText = await response.text();
			if (!response.ok) {
				if (isRetryableStatus(response.status) && attempt < maxRetries) {
					await sleep(
						computeRetryDelay({
							attemp: attempt,
							baseMs: retryBaseMs,
							maxMs: maxRetryDelayMs,
						}),
					);
					continue;
				}
				throw new EvmHttpError({
					message: `HTTP ${response.status} ${response.statusText} (${params.url})`,
					status: response.status,
					url: params.url,
					responseText,
				});
			}
			if (!responseText.trim()) {
				throw new Error(`Empty response from ${params.url}`);
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(responseText);
			} catch (error) {
				throw new Error(
					`Invalid JSON from ${params.url}: ${stringifyUnknown(error)}`,
				);
			}
			if (parsed == null) {
				throw new Error(`Response payload is null from ${params.url}`);
			}
			return parsed as T;
		} catch (error) {
			if (attempt >= maxRetries || !isRetryableFetchError(error)) {
				throw error;
			}
			await sleep(
				computeRetryDelay({
					attemp: attempt,
					baseMs: retryBaseMs,
					maxMs: maxRetryDelayMs,
				}),
			);
		} finally {
			clearTimeout(timeout);
		}
	}
	throw new Error(`Failed to fetch ${params.url}`);
}

export function parseSide(value?: string): "buy" | "sell" {
	if (!value) return "buy";
	const normalized = value.trim().toLowerCase();
	if (normalized === "buy" || normalized === "sell") {
		return normalized;
	}
	throw new Error("side must be buy or sell");
}
