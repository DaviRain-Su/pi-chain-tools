import {
	LIFI_API_BASE,
	LIFI_DEFAULT_SLIPPAGE,
	type LifiQuoteResponse,
} from "./lifi-types.js";

const ORDER_CANDIDATES = [
	"RECOMMENDED",
	"CHEAPEST",
	"FASTEST",
	"SAFEST",
] as const;

type LifiOrder = (typeof ORDER_CANDIDATES)[number];

export type LifiErrorCategory =
	| "api"
	| "network"
	| "timeout"
	| "rate_limit"
	| "validation"
	| "unknown";

export type LifiErrorCode =
	| "LIFI_API_BAD_REQUEST"
	| "LIFI_API_UNAUTHORIZED"
	| "LIFI_API_NOT_FOUND"
	| "LIFI_API_RATE_LIMIT"
	| "LIFI_API_SERVER"
	| "LIFI_NETWORK_ERROR"
	| "LIFI_TIMEOUT"
	| "LIFI_VALIDATION_ERROR"
	| "LIFI_UNKNOWN_ERROR";

export type LifiNormalizedError = {
	category: LifiErrorCategory;
	code: LifiErrorCode;
	httpStatus?: number;
	message: string;
	rawMessage?: string;
};

export type LifiRouteMetrics = {
	fromAmount: bigint;
	toAmount: bigint;
	feeTotal: bigint;
	gasTotal: bigint;
	hops: number;
	durationSeconds: number;
	slippageBps: number;
	riskPenaltyBps: number;
	effectiveCostBps: number;
	netOut: bigint;
};

export type LifiRouteCandidate = {
	order: LifiOrder;
	quote: LifiQuoteResponse;
	metrics: LifiRouteMetrics;
	score: number;
	rationale: string[];
	riskHints: string[];
};

export type LifiQuotePlanningResult = {
	selected: LifiRouteCandidate;
	candidates: LifiRouteCandidate[];
	fallback: {
		used: boolean;
		reason: string | null;
		failedOrders: Array<{ order: LifiOrder; error: LifiNormalizedError }>;
	};
	metrics: {
		quoteAttempts: number;
		quoteSuccess: number;
		quoteFailure: number;
		fallbackUsed: number;
	};
};

function safeBigInt(raw: string | undefined): bigint {
	if (!raw) return 0n;
	try {
		return BigInt(raw);
	} catch {
		return 0n;
	}
}

export function normalizeLifiError(error: unknown): LifiNormalizedError {
	if (error instanceof Error) {
		const message = error.message || "Unknown LI.FI error";
		const apiMatch = message.match(/LI\.FI API error\s+(\d+):/i);
		if (apiMatch) {
			const status = Number(apiMatch[1]);
			if (status === 400) {
				return {
					category: "validation",
					code: "LIFI_API_BAD_REQUEST",
					httpStatus: status,
					message,
					rawMessage: message,
				};
			}
			if (status === 401 || status === 403) {
				return {
					category: "api",
					code: "LIFI_API_UNAUTHORIZED",
					httpStatus: status,
					message,
					rawMessage: message,
				};
			}
			if (status === 404) {
				return {
					category: "api",
					code: "LIFI_API_NOT_FOUND",
					httpStatus: status,
					message,
					rawMessage: message,
				};
			}
			if (status === 429) {
				return {
					category: "rate_limit",
					code: "LIFI_API_RATE_LIMIT",
					httpStatus: status,
					message,
					rawMessage: message,
				};
			}
			if (status >= 500) {
				return {
					category: "api",
					code: "LIFI_API_SERVER",
					httpStatus: status,
					message,
					rawMessage: message,
				};
			}
		}
		if (/timeout/i.test(message)) {
			return {
				category: "timeout",
				code: "LIFI_TIMEOUT",
				message,
				rawMessage: message,
			};
		}
		if (/network|fetch failed|enotfound|econnreset/i.test(message)) {
			return {
				category: "network",
				code: "LIFI_NETWORK_ERROR",
				message,
				rawMessage: message,
			};
		}
		if (/valid EVM address/i.test(message)) {
			return {
				category: "validation",
				code: "LIFI_VALIDATION_ERROR",
				message,
				rawMessage: message,
			};
		}
		return {
			category: "unknown",
			code: "LIFI_UNKNOWN_ERROR",
			message,
			rawMessage: message,
		};
	}

	return {
		category: "unknown",
		code: "LIFI_UNKNOWN_ERROR",
		message: "Unknown LI.FI error",
	};
}

export async function lifiGet<T>(
	path: string,
	params: Record<string, string>,
): Promise<T> {
	const apiBase = process.env.LIFI_API_BASE?.trim() || LIFI_API_BASE;
	const url = new URL(path, apiBase);
	for (const [k, v] of Object.entries(params)) {
		if (v) url.searchParams.set(k, v);
	}

	const headers: Record<string, string> = {
		Accept: "application/json",
	};
	const apiKey = process.env.LIFI_API_KEY?.trim();
	if (apiKey) {
		headers["x-lifi-api-key"] = apiKey;
	}

	let res: Response;
	try {
		res = await fetch(url.toString(), { headers });
	} catch (error) {
		const normalized = normalizeLifiError(error);
		throw new Error(`${normalized.code}: ${normalized.message}`);
	}

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		const message = `LI.FI API error ${res.status}: ${res.statusText}. ${body}`;
		const normalized = normalizeLifiError(new Error(message));
		throw new Error(`${normalized.code}: ${normalized.message}`);
	}

	return (await res.json()) as T;
}

function buildRouteMetrics(quote: LifiQuoteResponse): LifiRouteMetrics {
	const fromAmount = safeBigInt(quote.estimate.fromAmount);
	const toAmount = safeBigInt(quote.estimate.toAmount);
	const feeTotal = quote.estimate.feeCosts.reduce(
		(sum, fee) => sum + safeBigInt(fee.amount),
		0n,
	);
	const gasTotal = quote.estimate.gasCosts.reduce(
		(sum, gas) => sum + safeBigInt(gas.estimate),
		0n,
	);
	const hops = Math.max(quote.includedSteps.length, 1);
	const durationSeconds = quote.estimate.executionDuration;
	const slippageBps = Math.round(
		(quote.action.slippage || LIFI_DEFAULT_SLIPPAGE) * 10_000,
	);
	const riskPenaltyBps =
		Math.max(hops - 1, 0) * 8 + (durationSeconds > 900 ? 25 : 0);
	const baseCostBps =
		fromAmount > 0n
			? Number(((feeTotal + gasTotal) * 10_000n) / fromAmount)
			: Number.MAX_SAFE_INTEGER;
	const effectiveCostBps = baseCostBps + slippageBps + riskPenaltyBps;
	const netOut = toAmount - feeTotal - gasTotal;

	return {
		fromAmount,
		toAmount,
		feeTotal,
		gasTotal,
		hops,
		durationSeconds,
		slippageBps,
		riskPenaltyBps,
		effectiveCostBps,
		netOut,
	};
}

function buildScore(metrics: LifiRouteMetrics): number {
	const netOutScore = Number(metrics.netOut > 0n ? metrics.netOut : 0n);
	const costPenalty = metrics.effectiveCostBps * 1_000_000;
	const durationPenalty = metrics.durationSeconds * 10_000;
	const hopPenalty = metrics.hops * 50_000;
	return netOutScore - costPenalty - durationPenalty - hopPenalty;
}

function buildRiskHints(metrics: LifiRouteMetrics): string[] {
	const hints: string[] = [];
	if (metrics.hops > 2) hints.push("multi_hop_route");
	if (metrics.durationSeconds > 900) hints.push("slow_route");
	if (metrics.slippageBps > 300) hints.push("high_slippage");
	if (metrics.effectiveCostBps > 500) hints.push("high_cost");
	return hints;
}

function buildRationale(order: LifiOrder, metrics: LifiRouteMetrics): string[] {
	return [
		`order=${order}`,
		`effectiveCostBps=${metrics.effectiveCostBps}`,
		`hops=${metrics.hops}`,
		`durationSeconds=${metrics.durationSeconds}`,
		`slippageBps=${metrics.slippageBps}`,
	];
}

export function scoreLifiQuote(
	quote: LifiQuoteResponse,
	order: LifiOrder,
): LifiRouteCandidate {
	const metrics = buildRouteMetrics(quote);
	const score = buildScore(metrics);
	const riskHints = buildRiskHints(metrics);
	return {
		order,
		quote,
		metrics,
		score,
		rationale: buildRationale(order, metrics),
		riskHints,
	};
}

export async function planLifiQuoteRoutes(params: {
	baseParams: Record<string, string>;
	preferredOrder?: LifiOrder;
}): Promise<LifiQuotePlanningResult> {
	const failedOrders: Array<{ order: LifiOrder; error: LifiNormalizedError }> =
		[];
	const candidates: LifiRouteCandidate[] = [];
	const sequence: LifiOrder[] = params.preferredOrder
		? [
				params.preferredOrder,
				...ORDER_CANDIDATES.filter((order) => order !== params.preferredOrder),
			]
		: [...ORDER_CANDIDATES];

	for (const order of sequence) {
		try {
			const quote = await lifiGet<LifiQuoteResponse>("/quote", {
				...params.baseParams,
				order,
			});
			candidates.push(scoreLifiQuote(quote, order));
		} catch (error) {
			failedOrders.push({ order, error: normalizeLifiError(error) });
		}
	}

	if (candidates.length === 0) {
		const first = failedOrders[0]?.error ?? {
			category: "unknown",
			code: "LIFI_UNKNOWN_ERROR",
			message: "Unable to fetch LI.FI quote",
		};
		throw new Error(`${first.code}: ${first.message}`);
	}

	candidates.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (a.metrics.effectiveCostBps !== b.metrics.effectiveCostBps) {
			return a.metrics.effectiveCostBps - b.metrics.effectiveCostBps;
		}
		if (a.metrics.hops !== b.metrics.hops)
			return a.metrics.hops - b.metrics.hops;
		if (a.metrics.durationSeconds !== b.metrics.durationSeconds) {
			return a.metrics.durationSeconds - b.metrics.durationSeconds;
		}
		return a.order.localeCompare(b.order);
	});

	const selected = candidates[0];
	return {
		selected,
		candidates,
		fallback: {
			used: failedOrders.length > 0,
			reason:
				failedOrders.length > 0 ? "preferred-or-candidate-order-failed" : null,
			failedOrders,
		},
		metrics: {
			quoteAttempts: sequence.length,
			quoteSuccess: candidates.length,
			quoteFailure: failedOrders.length,
			fallbackUsed: failedOrders.length > 0 ? 1 : 0,
		},
	};
}
