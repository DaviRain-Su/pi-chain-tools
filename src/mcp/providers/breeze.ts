import type {
	McpProvider,
	McpProviderContext,
	McpProviderResult,
} from "../provider.js";

const DEFAULT_BREEZE_API_BASE_URL = "";

type FetchLike = typeof fetch;

type JsonRecord = Record<string, unknown>;

function resolveBreezeApiBaseUrl(explicit?: string): string {
	const fromEnv =
		process.env.BREEZE_API_BASE_URL || process.env.PI_MCP_BREEZE_API_BASE_URL;
	return (explicit || fromEnv || DEFAULT_BREEZE_API_BASE_URL)
		.trim()
		.replace(/\/$/, "");
}

function resolveBreezeApiKey(explicit?: string): string | undefined {
	const fromEnv = process.env.BREEZE_API_KEY;
	const value = (explicit || fromEnv || "").trim();
	return value.length ? value : undefined;
}

function asObject(value: unknown): JsonRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: null;
}

function parseJsonLoose(raw: string): unknown {
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function pickArray(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	const obj = asObject(value);
	if (!obj) return [];
	for (const key of ["items", "data", "strategies", "results", "list"]) {
		const candidate = obj[key];
		if (Array.isArray(candidate)) return candidate;
	}
	return [];
}

function getNumberLike(input: unknown): number | null {
	if (typeof input === "number" && Number.isFinite(input)) return input;
	if (typeof input === "string" && input.trim().length) {
		const n = Number(input);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function normalizeStrategy(input: unknown): JsonRecord | null {
	const item = asObject(input);
	if (!item) return null;
	const id =
		String(
			item.id || item.strategyId || item.slug || item.symbol || "",
		).trim() || undefined;
	const name =
		String(item.name || item.title || item.strategy || id || "").trim() ||
		"unknown";
	const apy =
		getNumberLike(item.apy) ??
		getNumberLike(item.apr) ??
		getNumberLike(item.yield) ??
		null;
	const chain =
		String(item.chain || item.network || item.chainId || "").trim() ||
		undefined;
	const asset =
		String(item.asset || item.token || item.baseAsset || "").trim() ||
		undefined;
	return {
		id,
		name,
		apy,
		chain,
		asset,
		raw: item,
	};
}

async function fetchJson(args: {
	fetchImpl: FetchLike;
	url: string;
	apiKey?: string;
	method?: "GET" | "POST";
	body?: unknown;
}): Promise<{
	ok: boolean;
	status: number;
	parsed: unknown;
}> {
	const method = args.method ?? "GET";
	const headers: Record<string, string> = {
		accept: "application/json",
	};
	if (args.apiKey) {
		headers.authorization = `Bearer ${args.apiKey}`;
		headers["x-api-key"] = args.apiKey;
	}
	if (args.body !== undefined) {
		headers["content-type"] = "application/json";
	}

	const response = await args.fetchImpl(args.url, {
		method,
		headers,
		body: args.body === undefined ? undefined : JSON.stringify(args.body),
	});
	const raw = await response.text();
	return {
		ok: response.ok,
		status: response.status,
		parsed: parseJsonLoose(raw),
	};
}

async function trySearchEndpoints(args: {
	query: string;
	baseUrl: string;
	apiKey?: string;
	fetchImpl: FetchLike;
	context: McpProviderContext;
}): Promise<McpProviderResult> {
	const encoded = encodeURIComponent(args.query);
	const candidates = [
		`${args.baseUrl}/mcp/search?query=${encoded}`,
		`${args.baseUrl}/strategies/search?query=${encoded}`,
		`${args.baseUrl}/strategies?query=${encoded}`,
		`${args.baseUrl}/strategies`,
		`${args.baseUrl}/info/strategies?query=${encoded}`,
	];

	const attempts: Array<{ url: string; status?: number; error?: string }> = [];
	for (const url of candidates) {
		try {
			const res = await fetchJson({
				fetchImpl: args.fetchImpl,
				url,
				apiKey: args.apiKey,
			});
			attempts.push({ url, status: res.status });
			if (!res.ok) continue;
			const items = pickArray(res.parsed)
				.map((item) => normalizeStrategy(item))
				.filter((item): item is JsonRecord => Boolean(item));
			return {
				ok: true,
				data: {
					provider: "breeze",
					mode: "search",
					query: args.query,
					requestId: args.context.requestId || null,
					items,
				},
				warnings: [
					"Breeze search endpoint is inferred from strategy/info routes; verify endpoint contract before production execution.",
				],
				raw: res.parsed,
			};
		} catch (error) {
			attempts.push({
				url,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {
		ok: false,
		error: {
			code: "provider_unavailable",
			message: "Breeze search endpoints are unavailable or unsupported",
			details: {
				attempts,
			},
		},
		warnings: [
			"Breeze provider is currently read/plan-only and could not resolve a search endpoint.",
		],
	};
}

function parseBalances(params: Record<string, unknown>): Array<JsonRecord> {
	const candidate =
		(params.balances as unknown) ||
		(params.holdings as unknown) ||
		(params.walletBalances as unknown);
	if (!Array.isArray(candidate)) return [];
	return candidate
		.map((item) => asObject(item))
		.filter((item): item is JsonRecord => Boolean(item));
}

function toUpperToken(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toUpperCase();
	return normalized.length ? normalized : null;
}

function buildPlan(args: {
	strategies: JsonRecord[];
	balances: JsonRecord[];
	context: McpProviderContext;
	params: Record<string, unknown>;
}): McpProviderResult {
	if (!args.strategies.length) {
		return {
			ok: false,
			error: {
				code: "not_supported",
				message: "No Breeze strategy data available for planning",
			},
			warnings: [
				"Breeze plan currently requires readable strategy data from Breeze API.",
			],
		};
	}

	const sorted = [...args.strategies].sort((a, b) => {
		const apyA = getNumberLike(a.apy) ?? -1;
		const apyB = getNumberLike(b.apy) ?? -1;
		return apyB - apyA;
	});
	const top = sorted.slice(0, 3);

	const proposals = top.map((strategy) => {
		const strategyAsset = toUpperToken(strategy.asset);
		const matchedBalance = args.balances.find((balance) => {
			const symbol =
				toUpperToken(balance.symbol) ||
				toUpperToken(balance.asset) ||
				toUpperToken(balance.token);
			return strategyAsset && symbol === strategyAsset;
		});
		return {
			strategyId: strategy.id || null,
			strategy: strategy.name,
			apy: strategy.apy,
			asset: strategy.asset || null,
			chain: strategy.chain || null,
			action: matchedBalance ? "consider_deposit" : "watchlist",
			reason: matchedBalance
				? "Matching wallet balance found for strategy asset"
				: "No matching wallet balance supplied",
		};
	});

	return {
		ok: true,
		data: {
			provider: "breeze",
			mode: "plan",
			requestId: args.context.requestId || null,
			intent: args.params.intent || "yield_strategy_review",
			readOnly: true,
			proposals,
		},
		warnings: [
			"Plan is advisory/read-only. Execute through PI SDK guarded execute path.",
		],
	};
}

export function createBreezeMcpProvider(args?: {
	apiBaseUrl?: string;
	apiKey?: string;
	fetchImpl?: FetchLike;
}): McpProvider {
	const apiBaseUrl = resolveBreezeApiBaseUrl(args?.apiBaseUrl);
	const apiKey = resolveBreezeApiKey(args?.apiKey);
	const fetchImpl = args?.fetchImpl ?? fetch;

	async function fetchStrategies(query: string, context: McpProviderContext) {
		if (!apiBaseUrl) {
			return {
				ok: false,
				error: {
					code: "not_configured",
					message:
						"Breeze API base URL is not configured. Set BREEZE_API_BASE_URL.",
				},
				warnings: [
					"Breeze provider enabled without BREEZE_API_BASE_URL; search/plan unavailable.",
				],
			} as McpProviderResult;
		}
		return trySearchEndpoints({
			query,
			baseUrl: apiBaseUrl,
			apiKey,
			fetchImpl,
			context,
		});
	}

	return {
		id: "breeze",
		label: "Breeze API (read/plan)",
		capabilities: ["search", "plan"],
		async search(query, context) {
			if (!String(query || "").trim()) {
				return {
					ok: false,
					error: {
						code: "invalid_query",
						message: "query must be a non-empty string",
					},
				};
			}
			return fetchStrategies(query, context);
		},
		async plan(params, context) {
			const intent = String(params.intent || "yield strategy").trim();
			const strategyResult = await fetchStrategies(intent, context);
			if (!strategyResult.ok) return strategyResult;
			const items = pickArray(strategyResult.data);
			const strategies = items
				.map((item) => normalizeStrategy(item))
				.filter((item): item is JsonRecord => Boolean(item));
			const balances = parseBalances(params);
			return buildPlan({
				strategies,
				balances,
				context,
				params,
			});
		},
	};
}

export { DEFAULT_BREEZE_API_BASE_URL };
