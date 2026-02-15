import { Type } from "@sinclair/typebox";

export type KaspaNetwork = "mainnet" | "testnet" | "testnet10" | "testnet11";

export const KASPA_TOOL_PREFIX = "kaspa_";

const KASPA_DEFAULT_BASE_URL_MAINNET = "https://api.kaspa.org";
const KASPA_DEFAULT_BASE_URL_TESTNET10 = "https://api-tn10.kaspa.org";
const KASPA_DEFAULT_BASE_URL_TESTNET11 = "https://api-tn11.kaspa.org";

const KASPA_API_TIMEOUT_MS = 15_000;

type KaspaApiHttpMethod = "GET" | "POST" | "PUT";

export function kaspaNetworkSchema() {
	return Type.Optional(
		Type.Union([
			Type.Literal("mainnet"),
			Type.Literal("testnet"),
			Type.Literal("testnet10"),
			Type.Literal("testnet11"),
		]),
	);
}

export function parseKaspaNetwork(value?: string): KaspaNetwork {
	if (value === "mainnet") return "mainnet";
	if (value === "testnet10" || value === "tn10") return "testnet10";
	if (value === "testnet11" || value === "tn11") return "testnet11";
	if (value === "testnet") return "testnet";
	return "mainnet";
}

function resolveKaspaNetworkAlias(network: KaspaNetwork): Exclude<KaspaNetwork, "testnet"> {
	if (network === "testnet") return "testnet10";
	return network;
}

function getKaspaNetworkDefaultBaseUrl(network: Exclude<KaspaNetwork, "testnet">): string {
	if (network === "mainnet") return KASPA_DEFAULT_BASE_URL_MAINNET;
	if (network === "testnet10") return KASPA_DEFAULT_BASE_URL_TESTNET10;
	return KASPA_DEFAULT_BASE_URL_TESTNET11;
}

export function getKaspaApiBaseUrl(
	overrideUrl?: string,
	network: KaspaNetwork = "mainnet",
): string {
	if (overrideUrl?.trim()) return overrideUrl.trim();
	const resolvedNetwork = resolveKaspaNetworkAlias(network);
	const networkVar =
		resolvedNetwork === "mainnet"
			? process.env.KASPA_API_MAINNET_URL?.trim()
			: resolvedNetwork === "testnet10"
				? (process.env.KASPA_API_TESTNET10_URL?.trim() ||
					process.env.KASPA_API_TESTNET_URL?.trim())
				: (process.env.KASPA_API_TESTNET11_URL?.trim() ||
					process.env.KASPA_API_TESTNET10_URL?.trim() ||
					process.env.KASPA_API_TESTNET_URL?.trim());
	if (networkVar) return networkVar;
	const env = process.env.KASPA_API_BASE_URL?.trim();
	if (env) return env;
	return getKaspaNetworkDefaultBaseUrl(resolvedNetwork);
}

const KASPA_ADDRESS_BASE_REGEX = /^kaspa[a-z]*:[a-z0-9]+$/i;
const KASPA_ADDRESS_PREFIXES_BY_NETWORK: Record<
	"mainnet" | "testnet10" | "testnet11",
	readonly string[]
> = {
	mainnet: ["kaspa"],
	testnet10: ["kaspatest"],
	testnet11: ["kaspatest"],
};
const KASPA_ADDRESS_LEN_MIN_BY_NETWORK: Record<
	"mainnet" | "testnet10" | "testnet11",
	number
> = {
	mainnet: 58,
	testnet10: 58,
	testnet11: 58,
};
const KASPA_ADDRESS_LEN_MAX_BY_NETWORK: Record<
	"mainnet" | "testnet10" | "testnet11",
	number
> = {
	mainnet: 70,
	testnet10: 70,
	testnet11: 70,
};
const KASPA_ADDRESS_CHARSET_REGEX = /^[a-z0-9]+$/i;

export function getKaspaApiKey(overrideApiKey?: string): string | undefined {
	const explicit = overrideApiKey?.trim();
	if (explicit) return explicit;
	return process.env.KASPA_API_KEY?.trim();
}

export function normalizeKaspaAddress(
	value: string,
	network?: KaspaNetwork,
	strict = false,
): string {
	const normalized = value.trim().toLowerCase();
	if (!KASPA_ADDRESS_BASE_REGEX.test(normalized)) {
		throw new Error("address must be a valid Kaspa address (starting with kaspa:). ");
	}
	if (strict) {
		const [networkPrefix = "", addressPayload = ""] = normalized.split(":", 2);
		const resolvedNetwork = network
			? resolveKaspaNetworkAlias(parseKaspaNetwork(network))
			: "mainnet";
		if (!KASPA_ADDRESS_PREFIXES_BY_NETWORK[resolvedNetwork].includes(networkPrefix)) {
			throw new Error(
				`Kaspa address prefix does not match expected network (${resolvedNetwork})`,
			);
		}
		if (!KASPA_ADDRESS_CHARSET_REGEX.test(addressPayload)) {
			throw new Error("Kaspa address payload must be base32-like");
		}
		if (
			addressPayload.length <
				KASPA_ADDRESS_LEN_MIN_BY_NETWORK[resolvedNetwork] ||
			addressPayload.length >
				KASPA_ADDRESS_LEN_MAX_BY_NETWORK[resolvedNetwork]
		) {
			throw new Error("Kaspa address payload length is out of expected bounds");
		}
		if (resolvedNetwork === "mainnet" && !/^[qp]/i.test(addressPayload)) {
			throw new Error("Mainnet Kaspa address payload should start with q or p");
		}
	}
	return normalized;
}

export type KaspaApiQueryValue = string | number | boolean;

type KaspaApiJsonRequestParams<TBody = undefined> = {
	baseUrl: string;
	path: string;
	query?: Record<string, KaspaApiQueryValue | undefined>;
	method?: KaspaApiHttpMethod;
	body?: TBody;
	apiKey?: string;
	timeoutMs?: number;
};

function normalizeApiQuery(params: Record<string, KaspaApiQueryValue | undefined>) {
	const result: Record<string, string> = {};
	for (const [key, rawValue] of Object.entries(params)) {
		if (rawValue === undefined) continue;
		result[key] = String(rawValue);
	}
	return result;
}

export async function kaspaApiJsonRequest<T, TBody = undefined>(
	params: KaspaApiJsonRequestParams<TBody>,
): Promise<T> {
	const base = params.baseUrl.trim().replace(/\/$/, "");
	const path = params.path.startsWith("/") ? params.path : `/${params.path}`;
	const query = normalizeApiQuery(params.query ?? {});
	const requestBody = params.body === undefined ? undefined : JSON.stringify(params.body);
	const method = (params.method ?? "GET").toUpperCase() as KaspaApiHttpMethod;
	const headers: Record<string, string> = {
		accept: "application/json",
	};
	if (requestBody !== undefined) {
		headers["content-type"] = "application/json";
	}
	if (params.apiKey?.trim()) {
		headers["x-api-key"] = params.apiKey.trim();
	}
	const url = new URL(`${base}${path}`);
	for (const [key, rawValue] of Object.entries(query)) {
		url.searchParams.set(key, rawValue);
	}
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		params.timeoutMs ?? KASPA_API_TIMEOUT_MS,
	);
	try {
		const response = await fetch(url, {
			method,
			body: requestBody,
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
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw error;
		}
		const details = error instanceof Error ? error.message : String(error);
		throw new Error(`Kaspa API request failed: ${details}`);
	} finally {
		clearTimeout(timeout);
	}
}

export async function kaspaApiJsonGet<T>(
	params: Omit<KaspaApiJsonRequestParams, "method" | "body">,
): Promise<T> {
	return kaspaApiJsonRequest<T>({
		...params,
		method: "GET",
	});
}

export async function kaspaApiJsonPost<TBody, T>(
	params: Omit<KaspaApiJsonRequestParams<TBody>, "method">,
): Promise<T> {
	return kaspaApiJsonRequest<T, TBody>({
		...params,
		method: "POST",
	});
}

export function assertKaspaMainnetExecution(
	network: KaspaNetwork,
	confirmMainnet?: boolean,
): void {
	if (network === "mainnet" && confirmMainnet !== true) {
		throw new Error(
			"Mainnet Kaspa execution is blocked. Re-run with confirmMainnet=true.",
		);
	}
}

export function parseKaspaPositiveInteger(
	value: unknown,
	field: string,
	allowZero = false,
): number {
	if (typeof value === "number") {
		if (!Number.isInteger(value)) {
			throw new Error(`${field} must be an integer`);
		}
		if (allowZero ? value < 0 : value <= 0) {
			throw new Error(`${field} must be ${allowZero ? ">= 0" : "> 0"}`);
		}
		return value;
	}
	if (typeof value === "string") {
		const normalized = value.trim();
		if (!normalized) {
			throw new Error(`${field} is required`);
		}
		const parsed = Number.parseInt(normalized, 10);
		if (!Number.isInteger(parsed)) {
			throw new Error(`${field} must be an integer`);
		}
		if (allowZero ? parsed < 0 : parsed <= 0) {
			throw new Error(`${field} must be ${allowZero ? ">= 0" : "> 0"}`);
		}
		return parsed;
	}
	throw new Error(
		`${field} must be an integer${allowZero ? " or zero" : ""}`,
	);
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
