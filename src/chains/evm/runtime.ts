import { Type } from "@sinclair/typebox";

export type EvmNetwork =
	| "ethereum"
	| "sepolia"
	| "polygon"
	| "base"
	| "arbitrum"
	| "optimism";

export type EvmHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type EvmHttpRequestParams = {
	url: string;
	method?: EvmHttpMethod;
	headers?: Record<string, string>;
	body?: unknown;
	timeoutMs?: number;
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
};

const EVM_CHAIN_IDS: Record<EvmNetwork, number> = {
	ethereum: 1,
	sepolia: 11155111,
	polygon: 137,
	base: 8453,
	arbitrum: 42161,
	optimism: 10,
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
		value === "optimism"
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
	const controller = new AbortController();
	const timeoutMs = params.timeoutMs ?? 15_000;
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const method = params.method ?? "GET";
	const headers: Record<string, string> = {
		accept: "application/json",
		...(params.headers ?? {}),
	};

	let bodyText: string | undefined;
	if (params.body != null) {
		headers["content-type"] = headers["content-type"] ?? "application/json";
		bodyText =
			typeof params.body === "string"
				? params.body
				: JSON.stringify(params.body);
	}

	try {
		const response = await fetch(params.url, {
			method,
			headers,
			body: bodyText,
			signal: controller.signal,
		});
		const responseText = await response.text();
		if (!response.ok) {
			throw new EvmHttpError({
				message: `HTTP ${response.status} ${response.statusText} (${params.url})`,
				status: response.status,
				url: params.url,
				responseText,
			});
		}
		if (!responseText.trim()) {
			return null as T;
		}
		try {
			return JSON.parse(responseText) as T;
		} catch (error) {
			throw new Error(
				`Invalid JSON from ${params.url}: ${stringifyUnknown(error)}`,
			);
		}
	} finally {
		clearTimeout(timeout);
	}
}

export function parseSide(value?: string): "buy" | "sell" {
	if (!value) return "buy";
	const normalized = value.trim().toLowerCase();
	if (normalized === "buy" || normalized === "sell") {
		return normalized;
	}
	throw new Error("side must be buy or sell");
}
