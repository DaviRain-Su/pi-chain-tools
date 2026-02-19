import { Type } from "@sinclair/typebox";

export const STARKNET_TOOL_PREFIX = "starknet";

export const starknetNetworkSchema = Type.Union([
	Type.Literal("mainnet"),
	Type.Literal("sepolia"),
]);

export type StarknetNetwork = "mainnet" | "sepolia";

export type StarknetBtcRouteQuote = {
	provider: string;
	routeId: string;
	amountIn: string;
	amountOut: string;
	feeBps: number;
	etaSec: number;
	warnings: string[];
};

export function parseStarknetNetwork(value?: unknown): StarknetNetwork {
	const v = String(value || "mainnet")
		.trim()
		.toLowerCase();
	return v === "sepolia" ? "sepolia" : "mainnet";
}

export function getStarknetRpcEndpoint(network: StarknetNetwork): string {
	if (network === "sepolia") {
		return (
			process.env.STARKNET_RPC_URL_SEPOLIA ||
			process.env.STARKNET_RPC_URL ||
			"https://starknet-sepolia.public.blastapi.io/rpc/v0_8"
		);
	}
	return (
		process.env.STARKNET_RPC_URL_MAINNET ||
		process.env.STARKNET_RPC_URL ||
		"https://starknet-mainnet.public.blastapi.io/rpc/v0_8"
	);
}

export async function callStarknetRpc(
	method: string,
	params: unknown[] = [],
	network: StarknetNetwork = "mainnet",
): Promise<unknown> {
	const endpoint = getStarknetRpcEndpoint(network);
	const res = await fetch(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	if (!res.ok) {
		throw new Error(`starknet rpc http ${res.status}`);
	}
	const payload = (await res.json()) as {
		result?: unknown;
		error?: { code?: number; message?: string };
	};
	if (payload?.error) {
		throw new Error(
			`starknet rpc error ${payload.error.code ?? "unknown"}: ${payload.error.message || "unknown"}`,
		);
	}
	return payload?.result;
}

function asString(value: unknown): string | null {
	if (typeof value === "string" && value.trim().length > 0) {
		return value.trim();
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	return null;
}

function asNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function normalizeBtcQuoteResponse(
	payload: unknown,
	fallbackInput: { amountIn: string; sourceAsset: string; targetAsset: string },
): StarknetBtcRouteQuote {
	const src = (
		payload && typeof payload === "object"
			? (payload as Record<string, unknown>)
			: {}
	) as Record<string, unknown>;
	const nested =
		src.data && typeof src.data === "object"
			? (src.data as Record<string, unknown>)
			: null;
	const body = nested || src;

	const provider =
		asString(body.provider) ||
		asString(src.provider) ||
		"starknet-btc-provider";
	const routeId =
		asString(body.routeId) ||
		asString(body.route_id) ||
		asString(body.id) ||
		`route-${fallbackInput.sourceAsset.toLowerCase()}-${fallbackInput.targetAsset.toLowerCase()}`;
	const amountIn =
		asString(body.amountIn) ||
		asString(body.amount_in) ||
		asString(body.fromAmount) ||
		asString(body.inputAmount) ||
		fallbackInput.amountIn;
	const amountOut =
		asString(body.amountOut) ||
		asString(body.amount_out) ||
		asString(body.toAmount) ||
		asString(body.outputAmount) ||
		fallbackInput.amountIn;
	const feeBps =
		asNumber(body.feeBps) ??
		asNumber(body.fee_bps) ??
		asNumber(body.fee) ??
		asNumber(src.feeBps) ??
		50;
	const etaSec =
		asNumber(body.etaSec) ??
		asNumber(body.eta_sec) ??
		asNumber(body.etaSeconds) ??
		asNumber(src.etaSec) ??
		300;

	const warnings = new Set<string>();
	if (Array.isArray(body.warnings)) {
		for (const warning of body.warnings) {
			const text = asString(warning);
			if (text) warnings.add(text);
		}
	}
	if (Array.isArray(src.warnings)) {
		for (const warning of src.warnings) {
			const text = asString(warning);
			if (text) warnings.add(text);
		}
	}

	return {
		provider,
		routeId,
		amountIn,
		amountOut,
		feeBps: Math.max(0, Math.round(feeBps)),
		etaSec: Math.max(0, Math.round(etaSec)),
		warnings: [...warnings],
	};
}

export async function getStarknetBtcRouteQuote(params: {
	network?: unknown;
	sourceAsset?: unknown;
	targetAsset?: unknown;
	amount: unknown;
	sourceChain?: unknown;
}): Promise<StarknetBtcRouteQuote> {
	const network = parseStarknetNetwork(params.network);
	const sourceAsset = String(params.sourceAsset || "BTC")
		.trim()
		.toUpperCase();
	const targetAsset = String(params.targetAsset || "STRK")
		.trim()
		.toUpperCase();
	const sourceChain = params.sourceChain
		? String(params.sourceChain).trim().toLowerCase()
		: undefined;
	const amountValue = Number(params.amount);
	if (!Number.isFinite(amountValue) || amountValue <= 0) {
		throw new Error("amount must be a positive number");
	}
	const amountIn = String(params.amount);

	const quoteApiUrl = String(
		process.env.STARKNET_BTC_QUOTE_API_URL || "",
	).trim();
	const quoteApiKey = String(
		process.env.STARKNET_BTC_QUOTE_API_KEY || "",
	).trim();
	if (!quoteApiUrl) {
		const feeBps = 45;
		const amountOut = amountValue * (1 - feeBps / 10_000);
		return {
			provider: "deterministic-fallback",
			routeId: `fallback-${network}-${sourceAsset.toLowerCase()}-${targetAsset.toLowerCase()}`,
			amountIn,
			amountOut: amountOut.toFixed(8),
			feeBps,
			etaSec: 420,
			warnings: [
				"using deterministic fallback quote; set STARKNET_BTC_QUOTE_API_URL for live provider quotes",
			],
		};
	}

	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (quoteApiKey) {
		headers.authorization = `Bearer ${quoteApiKey}`;
		headers["x-api-key"] = quoteApiKey;
	}
	const response = await fetch(quoteApiUrl, {
		method: "POST",
		headers,
		body: JSON.stringify({
			network,
			sourceAsset,
			targetAsset,
			amount: amountIn,
			sourceChain,
		}),
	});

	if (!response.ok) {
		throw new Error(`starknet btc quote api http ${response.status}`);
	}

	const payload = (await response.json()) as unknown;
	const quote = normalizeBtcQuoteResponse(payload, {
		amountIn,
		sourceAsset,
		targetAsset,
	});
	if (quote.warnings.length === 0) {
		quote.warnings.push(
			"provider quote loaded from STARKNET_BTC_QUOTE_API_URL",
		);
	}
	return quote;
}
