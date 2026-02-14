import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	evaluateBtc5mTradeGuards,
	getPolymarketOrderBook,
	resolveBtc5mTradeSelection,
} from "../polymarket.js";
import {
	EVM_TOOL_PREFIX,
	evmNetworkSchema,
	parseEvmNetwork,
	parsePositiveNumber,
	stringifyUnknown,
} from "../runtime.js";
import { createEvmExecuteTools } from "./execute.js";

type WorkflowRunMode = "analysis" | "simulate" | "execute";
type RequotePriceStrategy = "aggressive" | "passive" | "follow_mid";
type RequoteFallbackMode = "none" | "retry_aggressive";

type WorkflowTradeIntent = {
	type: "evm.polymarket.btc5m.trade";
	marketSlug?: string;
	side?: "up" | "down";
	stakeUsd: number;
	maxEntryPrice?: number;
	maxSpreadBps?: number;
	minDepthUsd?: number;
	maxStakeUsd?: number;
	minConfidence?: number;
	requoteStaleOrders: boolean;
	requotePriceStrategy?: RequotePriceStrategy;
	requoteFallbackMode?: RequoteFallbackMode;
	requoteMaxPriceDriftBps?: number;
	maxAgeMinutes?: number;
	maxFillRatio?: number;
	requoteMinIntervalSeconds?: number;
	requoteMaxAttempts?: number;
	useAiAssist: boolean;
};

type WorkflowCancelIntent = {
	type: "evm.polymarket.btc5m.cancel";
	marketSlug?: string;
	tokenId?: string;
	side?: "up" | "down";
	orderIds: string[];
	cancelAll: boolean;
	maxAgeMinutes?: number;
	maxFillRatio?: number;
	useAiAssist: boolean;
};

type WorkflowIntent = WorkflowTradeIntent | WorkflowCancelIntent;

type WorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	network?: string;
	intentType?: "evm.polymarket.btc5m.trade" | "evm.polymarket.btc5m.cancel";
	intentText?: string;
	marketSlug?: string;
	tokenId?: string;
	side?: "up" | "down";
	stakeUsd?: number;
	maxEntryPrice?: number;
	maxSpreadBps?: number;
	minDepthUsd?: number;
	maxStakeUsd?: number;
	minConfidence?: number;
	orderId?: string;
	orderIds?: string[];
	cancelAll?: boolean;
	requoteStaleOrders?: boolean;
	requotePriceStrategy?: RequotePriceStrategy;
	requoteFallbackMode?: RequoteFallbackMode;
	requoteMaxPriceDriftBps?: number;
	maxAgeMinutes?: number;
	maxFillRatio?: number;
	requoteMinIntervalSeconds?: number;
	requoteMaxAttempts?: number;
	useAiAssist?: boolean;
	confirmMainnet?: boolean;
	confirmToken?: string;
};

type ParsedIntentHints = {
	intentType?: WorkflowIntent["type"];
	marketSlug?: string;
	tokenId?: string;
	side?: "up" | "down";
	stakeUsd?: number;
	orderId?: string;
	orderIds?: string[];
	cancelAll?: boolean;
	requoteStaleOrders?: boolean;
	requotePriceStrategy?: RequotePriceStrategy;
	requoteFallbackMode?: RequoteFallbackMode;
	requoteMaxPriceDriftBps?: number;
	maxAgeMinutes?: number;
	maxFillRatio?: number;
	requoteMinIntervalSeconds?: number;
	requoteMaxAttempts?: number;
	confirmMainnet?: boolean;
	confirmToken?: string;
};

type WorkflowSessionRecord = {
	runId: string;
	network: string;
	intent: WorkflowIntent;
};

type ExecuteTool = {
	name: string;
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

const WORKFLOW_SESSION_BY_RUN_ID = new Map<string, WorkflowSessionRecord>();
let latestWorkflowSession: WorkflowSessionRecord | null = null;

type WorkflowTradeRequoteRuntimeState = {
	lastExecuteAtMs: number;
	attempts: number;
	referencePrice: number | null;
};

const WORKFLOW_TRADE_REQUOTE_STATE_BY_RUN_ID = new Map<
	string,
	WorkflowTradeRequoteRuntimeState
>();

function parseRunMode(value?: string): WorkflowRunMode {
	if (value === "simulate" || value === "execute") return value;
	return "analysis";
}

function createRunId(input?: string): string {
	if (input?.trim()) return input.trim();
	const nonce = Math.random().toString(36).slice(2, 8);
	return `wf-evm-${Date.now().toString(36)}-${nonce}`;
}

function rememberSession(record: WorkflowSessionRecord): void {
	WORKFLOW_SESSION_BY_RUN_ID.set(record.runId, record);
	latestWorkflowSession = record;
}

function readSession(runId?: string): WorkflowSessionRecord | null {
	if (runId?.trim()) {
		return WORKFLOW_SESSION_BY_RUN_ID.get(runId.trim()) ?? null;
	}
	return latestWorkflowSession;
}

function extractConfirmTokenFromText(text?: string): string | undefined {
	if (!text?.trim()) return undefined;
	const explicit =
		text.match(/\bconfirmToken\s*[:= ]\s*(EVM-[A-Za-z0-9]+)\b/i)?.[1] ??
		text.match(/\b(EVM-[A-Za-z0-9]{8,})\b/i)?.[1];
	return explicit?.trim();
}

function hasConfirmMainnetPhrase(text?: string): boolean {
	if (!text?.trim()) return false;
	const lower = text.toLowerCase();
	return (
		lower.includes("确认主网执行") ||
		lower.includes("确认执行") ||
		lower.includes("confirm mainnet") ||
		lower.includes("confirmmainnet=true") ||
		lower.includes("confirmmainnet true")
	);
}

function parseSideHint(text: string): "up" | "down" | undefined {
	if (
		/\bup\b|\blong\b|上涨|看涨|买涨|做多|涨\b/i.test(text) &&
		!/\bdown\b|下跌|看跌|买跌|做空|跌\b/i.test(text)
	) {
		return "up";
	}
	if (/\bdown\b|\bshort\b|下跌|看跌|买跌|做空|跌\b/i.test(text)) {
		return "down";
	}
	return undefined;
}

function parseRequotePriceStrategyHint(
	text?: string,
): RequotePriceStrategy | undefined {
	if (!text?.trim()) return undefined;
	if (/(aggressive|激进|快速成交|taker)/i.test(text)) return "aggressive";
	if (/(passive|保守|被动|maker)/i.test(text)) return "passive";
	if (/(follow[-_\s]?mid|midpoint|中价|中间价|跟随中价)/i.test(text)) {
		return "follow_mid";
	}
	return undefined;
}

function normalizeRequotePriceStrategy(
	value?: string,
): RequotePriceStrategy | undefined {
	if (!value?.trim()) return undefined;
	const normalized = value.trim().toLowerCase().replace(/-/g, "_");
	if (
		normalized === "aggressive" ||
		normalized === "passive" ||
		normalized === "follow_mid"
	) {
		return normalized;
	}
	throw new Error(
		"requotePriceStrategy must be one of: aggressive | passive | follow_mid",
	);
}

function parseRequoteFallbackModeHint(
	text?: string,
): RequoteFallbackMode | undefined {
	if (!text?.trim()) return undefined;
	if (/(不重试|no\s+fallback|no\s+retry|不要兜底)/i.test(text)) return "none";
	if (
		/(失败后.*重试|fallback|兜底|保底|重试激进|retry\s+aggressive)/i.test(text)
	) {
		return "retry_aggressive";
	}
	return undefined;
}

function parseRequoteMaxPriceDriftBpsHint(text?: string): number | undefined {
	if (!text?.trim()) return undefined;
	const bpsRaw =
		text.match(
			/(?:波动|偏移|drift|price\s*drift)[^0-9]{0,16}(\d+(?:\.\d+)?)\s*(?:bps|bp|基点)/i,
		)?.[1] ?? undefined;
	if (bpsRaw) {
		const parsed = Number.parseFloat(bpsRaw);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	const pctRaw =
		text.match(
			/(?:波动|偏移|drift|price\s*drift)[^0-9]{0,16}(\d+(?:\.\d+)?)\s*%/i,
		)?.[1] ?? undefined;
	if (!pctRaw) return undefined;
	const parsed = Number.parseFloat(pctRaw);
	return Number.isFinite(parsed) ? parsed * 100 : undefined;
}

function normalizeRequoteFallbackMode(
	value?: string,
): RequoteFallbackMode | undefined {
	if (!value?.trim()) return undefined;
	const normalized = value.trim().toLowerCase().replace(/-/g, "_");
	if (normalized === "none" || normalized === "retry_aggressive") {
		return normalized;
	}
	throw new Error(
		"requoteFallbackMode must be one of: none | retry_aggressive",
	);
}

function resolveRequoteLimitPrice(params: {
	orderbook: {
		bestAsk?: { price?: number } | null;
		bestBid?: { price?: number } | null;
		midpoint?: number | null;
	};
	strategy: RequotePriceStrategy;
}): {
	strategy: RequotePriceStrategy;
	limitPrice: number | null;
	priceSource: "best_ask" | "best_bid" | "midpoint" | "none";
} {
	const ask = params.orderbook.bestAsk?.price;
	const bid = params.orderbook.bestBid?.price;
	const midpoint = params.orderbook.midpoint ?? null;
	let chosen: number | null = null;
	let priceSource: "best_ask" | "best_bid" | "midpoint" | "none" = "none";
	if (params.strategy === "aggressive") {
		if (typeof ask === "number" && Number.isFinite(ask) && ask > 0) {
			chosen = ask;
			priceSource = "best_ask";
		} else if (
			typeof midpoint === "number" &&
			Number.isFinite(midpoint) &&
			midpoint > 0
		) {
			chosen = midpoint;
			priceSource = "midpoint";
		} else if (typeof bid === "number" && Number.isFinite(bid) && bid > 0) {
			chosen = bid;
			priceSource = "best_bid";
		}
	} else if (params.strategy === "passive") {
		if (typeof bid === "number" && Number.isFinite(bid) && bid > 0) {
			chosen = bid;
			priceSource = "best_bid";
		} else if (
			typeof midpoint === "number" &&
			Number.isFinite(midpoint) &&
			midpoint > 0
		) {
			chosen = midpoint;
			priceSource = "midpoint";
		} else if (typeof ask === "number" && Number.isFinite(ask) && ask > 0) {
			chosen = ask;
			priceSource = "best_ask";
		}
	} else {
		if (
			typeof midpoint === "number" &&
			Number.isFinite(midpoint) &&
			midpoint > 0
		) {
			chosen = midpoint;
			priceSource = "midpoint";
		} else if (typeof ask === "number" && Number.isFinite(ask) && ask > 0) {
			chosen = ask;
			priceSource = "best_ask";
		} else if (typeof bid === "number" && Number.isFinite(bid) && bid > 0) {
			chosen = bid;
			priceSource = "best_bid";
		}
	}
	if (chosen == null) {
		return {
			strategy: params.strategy,
			limitPrice: null,
			priceSource,
		};
	}
	const clamped = Math.min(0.999, Math.max(0.001, Number(chosen.toFixed(6))));
	return {
		strategy: params.strategy,
		limitPrice: clamped,
		priceSource,
	};
}

function parseIntentText(text?: string): ParsedIntentHints {
	if (!text?.trim()) return {};
	const side = parseSideHint(text);
	const requotePriceStrategy = parseRequotePriceStrategyHint(text);
	const requoteFallbackMode = parseRequoteFallbackModeHint(text);
	const requoteMaxPriceDriftBps = parseRequoteMaxPriceDriftBpsHint(text);
	const stakeMatch =
		text.match(
			/(?:stake|size|amount|仓位|金额|下注|下单)\s*[:= ]\s*(\d+(?:\.\d+)?)/i,
		) ?? text.match(/(\d+(?:\.\d+)?)\s*(?:usd|usdc)\b/i);
	const marketSlug =
		text.match(/\b([a-z0-9]+(?:-[a-z0-9]+)*btc(?:-[a-z0-9]+)*)\b/i)?.[1] ??
		text.match(/\b(btc-updown-5m-[a-z0-9-]+)\b/i)?.[1];
	const tokenId =
		text.match(/\btoken(?:Id)?\s*[:= ]\s*([0-9]{6,})\b/i)?.[1] ?? undefined;
	const hasTradeSignal =
		Boolean(stakeMatch) ||
		Boolean(side) ||
		/(买|卖|下单|开仓|做多|做空|trade|buy|sell)/i.test(text);
	const hasRequotePhrase =
		/(撤单重挂|重新挂单|重挂|re-?quote|repost|replace\s+stale)/i.test(text);
	const hasCancelPhrase =
		/(取消|撤销|撤单|清空挂单|cancel\s+order|cancel\s+orders?|cancel)/i.test(
			text,
		);
	const isCancelIntent =
		hasCancelPhrase && !(hasRequotePhrase && hasTradeSignal);
	const cancelAll =
		/(全部|所有|cancel\s+all|all\s+(?:open\s+)?orders?|清空)/i.test(text) ||
		undefined;
	const explicitOrderId =
		text.match(/\borderId\s*[:= ]\s*([A-Za-z0-9:_-]{6,})\b/i)?.[1] ??
		text.match(/\b订单\s*[:：]\s*([A-Za-z0-9:_-]{6,})\b/i)?.[1] ??
		undefined;
	const orderIdsListRaw =
		text.match(/\borderIds\s*[:= ]\s*([A-Za-z0-9,\s:_-]{6,})\b/i)?.[1] ??
		undefined;
	const orderIds = orderIdsListRaw
		? orderIdsListRaw
				.split(/[\s,]+/)
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0)
		: undefined;
	const staleMinutesMatch =
		text.match(
			/(?:超(?:过|出)|超过|older than|for at least)\s*(\d+(?:\.\d+)?)\s*(?:分钟|mins?|minutes?)/i,
		)?.[1] ??
		text.match(
			/(\d+(?:\.\d+)?)\s*(?:分钟|mins?|minutes?)\s*(?:未成交|未成单|未成交挂单|stale|old)/i,
		)?.[1];
	const staleModeHint =
		/(未成交|未成单|超时|过期挂单|stale|old\s+orders?)/i.test(text) ||
		undefined;
	const maxAgeMinutes =
		staleMinutesMatch && (isCancelIntent || staleModeHint || hasRequotePhrase)
			? Number.parseFloat(staleMinutesMatch)
			: undefined;
	const maxFillRatioRaw =
		text.match(
			/(?:maxFillRatio|fill\s*ratio)\s*[:= ]\s*(\d+(?:\.\d+)?%?)/i,
		)?.[1] ??
		text.match(
			/(?:成交率|fill\s*ratio)\s*(?:<=|<|不高于|低于|小于|at most|below)\s*(\d+(?:\.\d+)?%?)/i,
		)?.[1];
	let maxFillRatio: number | undefined;
	if (maxFillRatioRaw) {
		const isPercent = maxFillRatioRaw.includes("%");
		const parsed = Number.parseFloat(maxFillRatioRaw.replace("%", ""));
		if (Number.isFinite(parsed)) {
			maxFillRatio = isPercent || parsed > 1 ? parsed / 100 : parsed;
		}
	}
	const requoteMinIntervalSecondsRaw = hasRequotePhrase
		? text.match(
				/(?:每|间隔|冷却|cooldown|interval)\s*(\d+(?:\.\d+)?)\s*(?:秒|secs?|seconds?)/i,
			)?.[1]
		: undefined;
	const requoteMaxAttemptsRaw = hasRequotePhrase
		? text.match(
				/(?:最多|至多|max)\s*(\d+)\s*(?:次|times?)\s*(?:重挂|re-?quote|repost|尝试)?/i,
			)?.[1]
		: undefined;
	const requoteMinIntervalSeconds = requoteMinIntervalSecondsRaw
		? Number.parseFloat(requoteMinIntervalSecondsRaw)
		: undefined;
	const requoteMaxAttempts = requoteMaxAttemptsRaw
		? Number.parseInt(requoteMaxAttemptsRaw, 10)
		: undefined;

	return {
		intentType: isCancelIntent ? "evm.polymarket.btc5m.cancel" : undefined,
		marketSlug: marketSlug?.trim(),
		tokenId,
		side,
		stakeUsd: stakeMatch?.[1] ? Number.parseFloat(stakeMatch[1]) : undefined,
		orderId: explicitOrderId,
		orderIds,
		cancelAll,
		requoteStaleOrders: hasRequotePhrase ? true : undefined,
		requotePriceStrategy,
		requoteFallbackMode,
		requoteMaxPriceDriftBps,
		maxAgeMinutes,
		maxFillRatio,
		requoteMinIntervalSeconds,
		requoteMaxAttempts,
		confirmMainnet: hasConfirmMainnetPhrase(text) ? true : undefined,
		confirmToken: extractConfirmTokenFromText(text),
	};
}

function hasIntentInput(params: WorkflowParams): boolean {
	const parsed = parseIntentText(params.intentText);
	return Boolean(
		params.marketSlug?.trim() ||
			params.tokenId?.trim() ||
			params.side ||
			params.stakeUsd != null ||
			params.maxSpreadBps != null ||
			params.minDepthUsd != null ||
			params.maxStakeUsd != null ||
			params.minConfidence != null ||
			params.orderId?.trim() ||
			(params.orderIds && params.orderIds.length > 0) ||
			params.cancelAll === true ||
			params.requoteStaleOrders === true ||
			params.requotePriceStrategy != null ||
			params.requoteFallbackMode != null ||
			params.requoteMaxPriceDriftBps != null ||
			params.maxAgeMinutes != null ||
			params.maxFillRatio != null ||
			params.requoteMinIntervalSeconds != null ||
			params.requoteMaxAttempts != null ||
			parsed.intentType ||
			parsed.marketSlug ||
			parsed.tokenId ||
			parsed.side ||
			parsed.stakeUsd != null ||
			parsed.orderId ||
			(parsed.orderIds && parsed.orderIds.length > 0) ||
			parsed.cancelAll === true ||
			parsed.requoteStaleOrders === true ||
			parsed.requotePriceStrategy != null ||
			parsed.requoteFallbackMode != null ||
			parsed.requoteMaxPriceDriftBps != null ||
			parsed.maxAgeMinutes != null ||
			parsed.maxFillRatio != null ||
			parsed.requoteMinIntervalSeconds != null ||
			parsed.requoteMaxAttempts != null,
	);
}

function normalizeOrderId(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error("orderId cannot be empty");
	return normalized;
}

function collectOrderIds(input: {
	orderId?: string;
	orderIds?: string[];
}): string[] {
	const output: string[] = [];
	if (input.orderId?.trim()) output.push(normalizeOrderId(input.orderId));
	for (const orderId of input.orderIds ?? []) {
		output.push(normalizeOrderId(orderId));
	}
	const dedup = new Set(output);
	return [...dedup];
}

function normalizeIntent(params: WorkflowParams): WorkflowIntent {
	const parsed = parseIntentText(params.intentText);
	const intentType =
		params.intentType ?? parsed.intentType ?? "evm.polymarket.btc5m.trade";
	if (intentType === "evm.polymarket.btc5m.cancel") {
		const orderIds = collectOrderIds({
			orderId: params.orderId ?? parsed.orderId,
			orderIds: [...(params.orderIds ?? []), ...(parsed.orderIds ?? [])],
		});
		const cancelAll = params.cancelAll === true || parsed.cancelAll === true;
		const tokenId = params.tokenId?.trim() || parsed.tokenId;
		const marketSlug = params.marketSlug?.trim() || parsed.marketSlug;
		const side = params.side ?? parsed.side;
		const maxAgeMinutesRaw = params.maxAgeMinutes ?? parsed.maxAgeMinutes;
		const maxFillRatioRaw = params.maxFillRatio ?? parsed.maxFillRatio;
		const maxAgeMinutes =
			maxAgeMinutesRaw != null
				? parsePositiveNumber(maxAgeMinutesRaw, "maxAgeMinutes")
				: undefined;
		let maxFillRatio: number | undefined;
		if (maxFillRatioRaw != null) {
			if (!Number.isFinite(maxFillRatioRaw)) {
				throw new Error("maxFillRatio must be a finite number");
			}
			if (maxFillRatioRaw < 0 || maxFillRatioRaw > 1) {
				throw new Error("maxFillRatio must be between 0 and 1");
			}
			maxFillRatio = maxFillRatioRaw;
		}
		if (
			!cancelAll &&
			orderIds.length === 0 &&
			!tokenId &&
			!marketSlug &&
			!side &&
			maxAgeMinutes == null &&
			maxFillRatio == null
		) {
			throw new Error(
				"cancel intent requires one selector: cancelAll, orderId(s), tokenId, (marketSlug/side), or stale filter (maxAgeMinutes/maxFillRatio).",
			);
		}
		return {
			type: "evm.polymarket.btc5m.cancel",
			marketSlug,
			tokenId,
			side,
			orderIds,
			cancelAll,
			maxAgeMinutes,
			maxFillRatio,
			useAiAssist: params.useAiAssist !== false,
		};
	}

	const stakeUsdRaw = params.stakeUsd ?? parsed.stakeUsd;
	if (stakeUsdRaw == null) {
		throw new Error("stakeUsd is required for evm.polymarket.btc5m.trade");
	}
	const requotePriceStrategyRaw =
		params.requotePriceStrategy ?? parsed.requotePriceStrategy;
	const requoteFallbackModeRaw =
		params.requoteFallbackMode ?? parsed.requoteFallbackMode;
	const requoteMaxPriceDriftBpsRaw =
		params.requoteMaxPriceDriftBps ?? parsed.requoteMaxPriceDriftBps;
	const maxAgeMinutesRaw = params.maxAgeMinutes ?? parsed.maxAgeMinutes;
	const maxFillRatioRaw = params.maxFillRatio ?? parsed.maxFillRatio;
	const requoteMinIntervalSecondsRaw =
		params.requoteMinIntervalSeconds ?? parsed.requoteMinIntervalSeconds;
	const requoteMaxAttemptsRaw =
		params.requoteMaxAttempts ?? parsed.requoteMaxAttempts;
	const maxAgeMinutes =
		maxAgeMinutesRaw != null
			? parsePositiveNumber(maxAgeMinutesRaw, "maxAgeMinutes")
			: undefined;
	let maxFillRatio: number | undefined;
	if (maxFillRatioRaw != null) {
		if (!Number.isFinite(maxFillRatioRaw)) {
			throw new Error("maxFillRatio must be a finite number");
		}
		if (maxFillRatioRaw < 0 || maxFillRatioRaw > 1) {
			throw new Error("maxFillRatio must be between 0 and 1");
		}
		maxFillRatio = maxFillRatioRaw;
	}
	const requoteMinIntervalSeconds =
		requoteMinIntervalSecondsRaw != null
			? parsePositiveNumber(
					requoteMinIntervalSecondsRaw,
					"requoteMinIntervalSeconds",
				)
			: undefined;
	let requoteMaxAttempts: number | undefined;
	if (requoteMaxAttemptsRaw != null) {
		if (
			!Number.isFinite(requoteMaxAttemptsRaw) ||
			!Number.isInteger(requoteMaxAttemptsRaw) ||
			requoteMaxAttemptsRaw <= 0
		) {
			throw new Error("requoteMaxAttempts must be a positive integer");
		}
		requoteMaxAttempts = requoteMaxAttemptsRaw;
	}
	const requoteStaleOrders =
		params.requoteStaleOrders === true ||
		parsed.requoteStaleOrders === true ||
		maxAgeMinutes != null ||
		maxFillRatio != null ||
		requoteMinIntervalSeconds != null ||
		requoteMaxAttempts != null;
	const requotePriceStrategy = requoteStaleOrders
		? normalizeRequotePriceStrategy(requotePriceStrategyRaw ?? "aggressive")
		: normalizeRequotePriceStrategy(requotePriceStrategyRaw);
	const requoteFallbackMode = requoteStaleOrders
		? normalizeRequoteFallbackMode(requoteFallbackModeRaw ?? "retry_aggressive")
		: normalizeRequoteFallbackMode(requoteFallbackModeRaw);
	const requoteMaxPriceDriftBps =
		requoteMaxPriceDriftBpsRaw != null
			? parsePositiveNumber(
					requoteMaxPriceDriftBpsRaw,
					"requoteMaxPriceDriftBps",
				)
			: undefined;
	if (requoteStaleOrders && maxAgeMinutes == null && maxFillRatio == null) {
		throw new Error(
			"requoteStaleOrders requires at least one stale filter: maxAgeMinutes or maxFillRatio.",
		);
	}
	return {
		type: "evm.polymarket.btc5m.trade",
		marketSlug: params.marketSlug?.trim() || parsed.marketSlug,
		side: params.side ?? parsed.side,
		stakeUsd: parsePositiveNumber(stakeUsdRaw, "stakeUsd"),
		maxEntryPrice:
			params.maxEntryPrice != null
				? parsePositiveNumber(params.maxEntryPrice, "maxEntryPrice")
				: undefined,
		maxSpreadBps:
			params.maxSpreadBps != null
				? parsePositiveNumber(params.maxSpreadBps, "maxSpreadBps")
				: undefined,
		minDepthUsd:
			params.minDepthUsd != null
				? parsePositiveNumber(params.minDepthUsd, "minDepthUsd")
				: undefined,
		maxStakeUsd:
			params.maxStakeUsd != null
				? parsePositiveNumber(params.maxStakeUsd, "maxStakeUsd")
				: undefined,
		minConfidence:
			params.minConfidence != null
				? parsePositiveNumber(params.minConfidence, "minConfidence")
				: undefined,
		requoteStaleOrders,
		requotePriceStrategy,
		requoteFallbackMode,
		requoteMaxPriceDriftBps,
		maxAgeMinutes,
		maxFillRatio,
		requoteMinIntervalSeconds,
		requoteMaxAttempts,
		useAiAssist: params.useAiAssist !== false,
	};
}

function stableHash(input: string): string {
	return createHash("sha256").update(input).digest("hex").toUpperCase();
}

function createConfirmToken(
	runId: string,
	network: string,
	intent: WorkflowIntent,
): string {
	const base = JSON.stringify({
		runId,
		network,
		intent,
	});
	return `EVM-${stableHash(base).slice(0, 16)}`;
}

function intentsMatch(a: WorkflowIntent, b: WorkflowIntent): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function buildTradeSummaryLine(params: {
	intent: WorkflowTradeIntent;
	phase: WorkflowRunMode;
	status: string;
	marketSlug?: string;
	side?: "up" | "down";
	entryPrice?: number | null;
	shares?: number | null;
	requoteLimitPrice?: number | null;
	staleTargets?: number | null;
	confirmToken?: string;
}): string {
	const parts = [`${params.intent.type}`, `${params.phase}=${params.status}`];
	if (params.marketSlug) parts.push(`market=${params.marketSlug}`);
	if (params.side) parts.push(`side=${params.side}`);
	if (params.entryPrice != null)
		parts.push(`entry=${params.entryPrice.toFixed(4)}`);
	if (params.shares != null) parts.push(`shares~=${params.shares.toFixed(4)}`);
	if (params.intent.requoteStaleOrders) parts.push("requote=stale");
	if (params.intent.requotePriceStrategy) {
		parts.push(`requotePriceStrategy=${params.intent.requotePriceStrategy}`);
	}
	if (params.intent.requoteFallbackMode) {
		parts.push(`requoteFallbackMode=${params.intent.requoteFallbackMode}`);
	}
	if (params.intent.requoteMaxPriceDriftBps != null) {
		parts.push(
			`requoteMaxPriceDriftBps=${params.intent.requoteMaxPriceDriftBps}`,
		);
	}
	if (params.requoteLimitPrice != null) {
		parts.push(`requoteLimit=${params.requoteLimitPrice.toFixed(4)}`);
	}
	if (params.intent.maxAgeMinutes != null) {
		parts.push(`maxAgeMinutes=${params.intent.maxAgeMinutes}`);
	}
	if (params.intent.maxFillRatio != null) {
		parts.push(`maxFillRatio=${params.intent.maxFillRatio}`);
	}
	if (params.intent.requoteMinIntervalSeconds != null) {
		parts.push(
			`requoteMinIntervalSeconds=${params.intent.requoteMinIntervalSeconds}`,
		);
	}
	if (params.intent.requoteMaxAttempts != null) {
		parts.push(`requoteMaxAttempts=${params.intent.requoteMaxAttempts}`);
	}
	if (params.staleTargets != null) {
		parts.push(`staleTargets=${params.staleTargets}`);
	}
	if (params.confirmToken) parts.push(`confirmToken=${params.confirmToken}`);
	return parts.join(" ");
}

function buildCancelSummaryLine(params: {
	intent: WorkflowCancelIntent;
	phase: WorkflowRunMode;
	status: string;
	targetOrders?: number | null;
	confirmToken?: string;
}): string {
	const parts = [`${params.intent.type}`, `${params.phase}=${params.status}`];
	if (params.intent.cancelAll) parts.push("scope=all");
	if (params.intent.tokenId) parts.push(`token=${params.intent.tokenId}`);
	if (params.intent.marketSlug)
		parts.push(`market=${params.intent.marketSlug}`);
	if (params.intent.side) parts.push(`side=${params.intent.side}`);
	if (params.intent.orderIds.length > 0) {
		parts.push(`orderIds=${params.intent.orderIds.length}`);
	}
	if (params.intent.maxAgeMinutes != null) {
		parts.push(`maxAgeMinutes=${params.intent.maxAgeMinutes}`);
	}
	if (params.intent.maxFillRatio != null) {
		parts.push(`maxFillRatio=${params.intent.maxFillRatio}`);
	}
	if (params.targetOrders != null) parts.push(`target=${params.targetOrders}`);
	if (params.confirmToken) parts.push(`confirmToken=${params.confirmToken}`);
	return parts.join(" ");
}

function resolveExecuteTool(name: string): ExecuteTool {
	const tool = createEvmExecuteTools().find((entry) => entry.name === name);
	if (!tool) {
		throw new Error(`${name} tool not found`);
	}
	return tool as unknown as ExecuteTool;
}

function buildCancelExecuteParams(
	network: string,
	intent: WorkflowCancelIntent,
	dryRun: boolean,
): Record<string, unknown> {
	return {
		network,
		marketSlug: intent.marketSlug,
		tokenId: intent.tokenId,
		side: intent.side,
		orderIds: intent.orderIds,
		cancelAll: intent.cancelAll,
		maxAgeMinutes: intent.maxAgeMinutes,
		maxFillRatio: intent.maxFillRatio,
		useAiAssist: intent.useAiAssist,
		dryRun,
	};
}

function buildTradeStaleCancelParams(
	network: string,
	intent: WorkflowTradeIntent,
	tokenId: string,
	dryRun: boolean,
): Record<string, unknown> {
	return {
		network,
		tokenId,
		maxAgeMinutes: intent.maxAgeMinutes,
		maxFillRatio: intent.maxFillRatio,
		dryRun,
	};
}

function classifyCancelPrecheckStatus(
	message: string,
): "needs_signer" | "precheck_failed" {
	return /private key|POLYMARKET_PRIVATE_KEY|funder/i.test(message)
		? "needs_signer"
		: "precheck_failed";
}

function readTradeRequoteRuntime(params: {
	runId: string;
	intent: WorkflowTradeIntent;
	nowMs?: number;
}) {
	const nowMs = params.nowMs ?? Date.now();
	const state =
		WORKFLOW_TRADE_REQUOTE_STATE_BY_RUN_ID.get(params.runId) ?? null;
	const attempts = state?.attempts ?? 0;
	const maxAttempts = params.intent.requoteMaxAttempts ?? null;
	const minIntervalSeconds = params.intent.requoteMinIntervalSeconds ?? null;
	const minIntervalMs =
		minIntervalSeconds == null ? 0 : Math.floor(minIntervalSeconds * 1000);
	let remainingCooldownSeconds = 0;
	if (state && minIntervalMs > 0) {
		const elapsed = nowMs - state.lastExecuteAtMs;
		if (elapsed < minIntervalMs) {
			remainingCooldownSeconds = Math.ceil((minIntervalMs - elapsed) / 1000);
		}
	}
	const blockedByAttempts = maxAttempts != null && attempts >= maxAttempts;
	const blockedByCooldown = remainingCooldownSeconds > 0;
	return {
		attemptsUsed: attempts,
		maxAttempts,
		minIntervalSeconds,
		remainingCooldownSeconds,
		referencePrice: state?.referencePrice ?? null,
		blockedByAttempts,
		blockedByCooldown,
	};
}

function writeTradeRequoteRuntime(
	runId: string,
	nextState: WorkflowTradeRequoteRuntimeState,
): void {
	WORKFLOW_TRADE_REQUOTE_STATE_BY_RUN_ID.set(runId, nextState);
}

function evaluateRequoteVolatilityGuard(params: {
	intent: WorkflowTradeIntent;
	runtime: ReturnType<typeof readTradeRequoteRuntime> | null;
	currentPrice: number | null;
}) {
	const maxDriftBps = params.intent.requoteMaxPriceDriftBps ?? null;
	const referencePrice = params.runtime?.referencePrice ?? null;
	const currentPrice = params.currentPrice;
	if (maxDriftBps == null || referencePrice == null || currentPrice == null) {
		return {
			enabled: maxDriftBps != null,
			maxDriftBps,
			referencePrice,
			currentPrice,
			driftBps: null,
			blocked: false,
		};
	}
	const driftBps =
		(Math.abs(currentPrice - referencePrice) / referencePrice) * 10_000;
	return {
		enabled: true,
		maxDriftBps,
		referencePrice,
		currentPrice,
		driftBps,
		blocked: driftBps > maxDriftBps,
	};
}

function extractTargetOrderCount(details: unknown): number | null {
	if (!details || typeof details !== "object") return null;
	const payload = details as {
		targetOrderIds?: unknown;
		targetOrders?: unknown;
		orderCount?: unknown;
	};
	if (Array.isArray(payload.targetOrderIds))
		return payload.targetOrderIds.length;
	if (
		typeof payload.targetOrders === "number" &&
		Number.isFinite(payload.targetOrders)
	) {
		return payload.targetOrders;
	}
	if (
		typeof payload.orderCount === "number" &&
		Number.isFinite(payload.orderCount)
	) {
		return payload.orderCount;
	}
	return null;
}

function extractSubmittedOrderId(details: unknown): string | null {
	if (!details || typeof details !== "object") return null;
	const payload = details as {
		orderId?: unknown;
		orderID?: unknown;
		response?: unknown;
		result?: unknown;
	};
	const directOrderId =
		typeof payload.orderId === "string" && payload.orderId.trim()
			? payload.orderId.trim()
			: typeof payload.orderID === "string" && payload.orderID.trim()
				? payload.orderID.trim()
				: null;
	if (directOrderId) return directOrderId;
	if (payload.response && typeof payload.response === "object") {
		const nested = payload.response as { orderId?: unknown; orderID?: unknown };
		if (typeof nested.orderId === "string" && nested.orderId.trim()) {
			return nested.orderId.trim();
		}
		if (typeof nested.orderID === "string" && nested.orderID.trim()) {
			return nested.orderID.trim();
		}
	}
	if (payload.result && typeof payload.result === "object") {
		const nested = payload.result as { orderId?: unknown; orderID?: unknown };
		if (typeof nested.orderId === "string" && nested.orderId.trim()) {
			return nested.orderId.trim();
		}
		if (typeof nested.orderID === "string" && nested.orderID.trim()) {
			return nested.orderID.trim();
		}
	}
	return null;
}

export function createEvmWorkflowTools() {
	return [
		defineTool({
			name: "w3rt_run_evm_polymarket_workflow_v0",
			label: "w3rt Run EVM Polymarket Workflow v0",
			description:
				"Deterministic EVM Polymarket BTC 5m workflow entrypoint: analysis -> simulate -> execute.",
			parameters: Type.Object({
				runId: Type.Optional(Type.String()),
				runMode: Type.Optional(
					Type.Union([
						Type.Literal("analysis"),
						Type.Literal("simulate"),
						Type.Literal("execute"),
					]),
				),
				network: evmNetworkSchema(),
				intentType: Type.Optional(
					Type.Union([
						Type.Literal("evm.polymarket.btc5m.trade"),
						Type.Literal("evm.polymarket.btc5m.cancel"),
					]),
				),
				intentText: Type.Optional(Type.String()),
				marketSlug: Type.Optional(Type.String()),
				tokenId: Type.Optional(Type.String()),
				side: Type.Optional(
					Type.Union([Type.Literal("up"), Type.Literal("down")]),
				),
				stakeUsd: Type.Optional(Type.Number({ minimum: 0.01 })),
				maxEntryPrice: Type.Optional(
					Type.Number({ minimum: 0.001, maximum: 0.999 }),
				),
				maxSpreadBps: Type.Optional(Type.Number({ minimum: 0.01 })),
				minDepthUsd: Type.Optional(Type.Number({ minimum: 0.01 })),
				maxStakeUsd: Type.Optional(Type.Number({ minimum: 0.01 })),
				minConfidence: Type.Optional(
					Type.Number({ minimum: 0.01, maximum: 0.99 }),
				),
				orderId: Type.Optional(Type.String()),
				orderIds: Type.Optional(
					Type.Array(Type.String({ minLength: 1 }), {
						minItems: 1,
						maxItems: 50,
					}),
				),
				cancelAll: Type.Optional(Type.Boolean()),
				requoteStaleOrders: Type.Optional(Type.Boolean()),
				requotePriceStrategy: Type.Optional(
					Type.Union([
						Type.Literal("aggressive"),
						Type.Literal("passive"),
						Type.Literal("follow_mid"),
					]),
				),
				requoteFallbackMode: Type.Optional(
					Type.Union([Type.Literal("none"), Type.Literal("retry_aggressive")]),
				),
				requoteMaxPriceDriftBps: Type.Optional(Type.Number({ minimum: 0.01 })),
				maxAgeMinutes: Type.Optional(Type.Number({ minimum: 0.1 })),
				maxFillRatio: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
				requoteMinIntervalSeconds: Type.Optional(Type.Number({ minimum: 0.1 })),
				requoteMaxAttempts: Type.Optional(
					Type.Number({ minimum: 1, maximum: 20 }),
				),
				useAiAssist: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as WorkflowParams;
				const runMode = parseRunMode(params.runMode);
				const parsedHints = parseIntentText(params.intentText);
				const priorSession =
					runMode === "execute" ? readSession(params.runId) : null;
				const runId = createRunId(
					params.runId ||
						(runMode === "execute" ? priorSession?.runId : undefined),
				);
				const network = parseEvmNetwork(
					params.network ||
						(runMode === "execute" ? priorSession?.network : undefined),
				);
				const intent =
					runMode === "execute" &&
					!hasIntentInput(params) &&
					priorSession?.intent
						? priorSession.intent
						: normalizeIntent(params);
				const confirmToken = createConfirmToken(runId, network, intent);
				const providedConfirmToken =
					params.confirmToken?.trim() || parsedHints.confirmToken?.trim();
				const effectiveConfirmMainnet =
					params.confirmMainnet === true || parsedHints.confirmMainnet === true;
				const mainnetGuardRequired = network === "polygon";

				const assertMainnetConfirmation = () => {
					if (!mainnetGuardRequired) return;
					if (!effectiveConfirmMainnet) {
						throw new Error(
							`Mainnet execute blocked. Re-run with confirmMainnet=true and confirmToken=${confirmToken}`,
						);
					}
					const sessionConfirmed =
						priorSession?.runId === runId &&
						priorSession.network === network &&
						intentsMatch(priorSession.intent, intent) &&
						!providedConfirmToken;
					if (!sessionConfirmed && providedConfirmToken !== confirmToken) {
						throw new Error(
							`Invalid confirmToken. Expected ${confirmToken}, got ${providedConfirmToken ?? "(empty)"}`,
						);
					}
				};

				if (intent.type === "evm.polymarket.btc5m.trade") {
					const trade = await resolveBtc5mTradeSelection({
						marketSlug: intent.marketSlug,
						side: intent.side,
						useAiAssist: intent.useAiAssist,
					});
					const orderbook = await getPolymarketOrderBook(trade.tokenId);
					const entryPrice = orderbook.bestAsk?.price ?? null;
					const requotePricing = intent.requoteStaleOrders
						? resolveRequoteLimitPrice({
								orderbook,
								strategy: intent.requotePriceStrategy ?? "aggressive",
							})
						: null;
					const effectiveOrderPrice = requotePricing?.limitPrice ?? entryPrice;
					const baseStatus =
						effectiveOrderPrice == null
							? "no_liquidity"
							: intent.maxEntryPrice != null &&
									effectiveOrderPrice > intent.maxEntryPrice
								? "price_too_high"
								: "ready";
					const estimatedShares =
						effectiveOrderPrice == null
							? null
							: intent.stakeUsd / effectiveOrderPrice;
					const guardEvaluation = evaluateBtc5mTradeGuards({
						stakeUsd: intent.stakeUsd,
						orderbook,
						limitPrice: effectiveOrderPrice ?? 0,
						orderSide: "buy",
						adviceConfidence: trade.advice?.confidence ?? null,
						guards: {
							maxSpreadBps: intent.maxSpreadBps,
							minDepthUsd: intent.minDepthUsd,
							maxStakeUsd: intent.maxStakeUsd,
							minConfidence: intent.minConfidence,
						},
					});
					const analysisStatus =
						baseStatus === "ready" && !guardEvaluation.passed
							? "guard_blocked"
							: baseStatus;
					const simulateStatus = analysisStatus;

					if (runMode === "analysis") {
						const requoteRuntime = intent.requoteStaleOrders
							? readTradeRequoteRuntime({
									runId,
									intent,
								})
							: null;
						const volatilityGuard = evaluateRequoteVolatilityGuard({
							intent,
							runtime: requoteRuntime,
							currentPrice: requotePricing?.limitPrice ?? effectiveOrderPrice,
						});
						const summaryLine = buildTradeSummaryLine({
							intent,
							phase: "analysis",
							status: analysisStatus,
							marketSlug: trade.market.slug,
							side: trade.side,
							entryPrice,
							shares: estimatedShares,
							requoteLimitPrice: requotePricing?.limitPrice ?? null,
							confirmToken: mainnetGuardRequired ? confirmToken : undefined,
						});
						rememberSession({ runId, network, intent });
						return {
							content: [
								{ type: "text", text: `Workflow analyzed: ${intent.type}` },
							],
							details: {
								runId,
								runMode,
								network,
								intentType: intent.type,
								intent,
								needsMainnetConfirmation: mainnetGuardRequired,
								confirmToken,
								artifacts: {
									analysis: {
										intent,
										tradeSelection: trade,
										entryPrice,
										estimatedShares,
										guardEvaluation,
										staleRequote: intent.requoteStaleOrders
											? {
													enabled: true,
													status: requoteRuntime?.blockedByAttempts
														? "max_attempts_reached"
														: requoteRuntime?.blockedByCooldown
															? "throttled"
															: "planned",
													fallbackMode: intent.requoteFallbackMode ?? null,
													maxAgeMinutes: intent.maxAgeMinutes ?? null,
													maxFillRatio: intent.maxFillRatio ?? null,
													pricing: requotePricing,
													volatilityGuard,
													runtime: requoteRuntime,
												}
											: {
													enabled: false,
													status: "disabled",
												},
										summaryLine,
										summary: {
											schema: "w3rt.workflow.summary.v1",
											phase: "analysis",
											status: analysisStatus,
											intentType: intent.type,
											line: summaryLine,
										},
									},
								},
							},
						};
					}

					if (runMode === "simulate") {
						let staleRequotePreview: unknown = null;
						let staleRequoteStatus:
							| "disabled"
							| "ready"
							| "needs_signer"
							| "precheck_failed"
							| "throttled"
							| "max_attempts_reached"
							| "volatility_blocked" = intent.requoteStaleOrders
							? "ready"
							: "disabled";
						const requoteRuntime = intent.requoteStaleOrders
							? readTradeRequoteRuntime({
									runId,
									intent,
								})
							: null;
						const volatilityGuard = evaluateRequoteVolatilityGuard({
							intent,
							runtime: requoteRuntime,
							currentPrice: requotePricing?.limitPrice ?? effectiveOrderPrice,
						});
						if (intent.requoteStaleOrders) {
							const cancelTool = resolveExecuteTool(
								`${EVM_TOOL_PREFIX}polymarketCancelOrder`,
							);
							try {
								const preview = await cancelTool.execute(
									"wf-evm-trade-stale-simulate",
									buildTradeStaleCancelParams(
										network,
										intent,
										trade.tokenId,
										true,
									),
								);
								staleRequotePreview = preview.details ?? null;
							} catch (error) {
								const message = stringifyUnknown(error);
								staleRequoteStatus = classifyCancelPrecheckStatus(message);
								staleRequotePreview = { error: message };
							}
							if (
								staleRequoteStatus === "ready" &&
								requoteRuntime?.blockedByAttempts
							) {
								staleRequoteStatus = "max_attempts_reached";
							}
							if (
								staleRequoteStatus === "ready" &&
								requoteRuntime?.blockedByCooldown
							) {
								staleRequoteStatus = "throttled";
							}
							if (staleRequoteStatus === "ready" && volatilityGuard.blocked) {
								staleRequoteStatus = "volatility_blocked";
							}
						}
						const staleTargets = extractTargetOrderCount(staleRequotePreview);
						const summaryLine = buildTradeSummaryLine({
							intent,
							phase: "simulate",
							status: simulateStatus,
							marketSlug: trade.market.slug,
							side: trade.side,
							entryPrice,
							shares: estimatedShares,
							requoteLimitPrice: requotePricing?.limitPrice ?? null,
							staleTargets,
							confirmToken: mainnetGuardRequired ? confirmToken : undefined,
						});
						rememberSession({ runId, network, intent });
						return {
							content: [
								{
									type: "text",
									text: `Workflow simulated: ${intent.type} status=${simulateStatus}`,
								},
							],
							details: {
								runId,
								runMode,
								network,
								intentType: intent.type,
								intent,
								needsMainnetConfirmation: mainnetGuardRequired,
								confirmToken,
								artifacts: {
									simulate: {
										tradeSelection: trade,
										orderbook,
										entryPrice,
										estimatedShares,
										guardEvaluation,
										staleRequote: {
											enabled: intent.requoteStaleOrders,
											status: staleRequoteStatus,
											fallbackMode: intent.requoteFallbackMode ?? null,
											targetOrders: staleTargets,
											pricing: requotePricing,
											volatilityGuard,
											runtime: requoteRuntime,
											result: staleRequotePreview,
										},
										status: simulateStatus,
										summaryLine,
										summary: {
											schema: "w3rt.workflow.summary.v1",
											phase: "simulate",
											status: simulateStatus,
											intentType: intent.type,
											line: summaryLine,
										},
									},
								},
							},
						};
					}

					assertMainnetConfirmation();
					if (simulateStatus === "no_liquidity") {
						throw new Error(
							"Trade execute blocked: no ask liquidity in current orderbook.",
						);
					}
					if (simulateStatus === "price_too_high") {
						throw new Error(
							`Trade execute blocked: entryPrice ${effectiveOrderPrice ?? "n/a"} exceeds maxEntryPrice ${intent.maxEntryPrice}.`,
						);
					}
					if (simulateStatus === "guard_blocked") {
						throw new Error(
							`Trade execute blocked by guard checks: ${guardEvaluation.issues.map((issue) => issue.message).join(" | ")}`,
						);
					}
					const requoteRuntime = intent.requoteStaleOrders
						? readTradeRequoteRuntime({
								runId,
								intent,
							})
						: null;
					const volatilityGuard = evaluateRequoteVolatilityGuard({
						intent,
						runtime: requoteRuntime,
						currentPrice: requotePricing?.limitPrice ?? effectiveOrderPrice,
					});
					if (requoteRuntime?.blockedByAttempts) {
						throw new Error(
							`Trade execute blocked: requote max attempts reached (${requoteRuntime.attemptsUsed}/${requoteRuntime.maxAttempts}).`,
						);
					}
					if (requoteRuntime?.blockedByCooldown) {
						throw new Error(
							`Trade execute throttled: wait ${requoteRuntime.remainingCooldownSeconds}s before next requote.`,
						);
					}
					if (volatilityGuard.blocked) {
						throw new Error(
							`Trade execute blocked by requote volatility guard: drift=${volatilityGuard.driftBps?.toFixed(2)}bps > max=${volatilityGuard.maxDriftBps}.`,
						);
					}
					let staleCancelResult: unknown = null;
					let staleCancelTargetOrders: number | null = null;
					if (intent.requoteStaleOrders) {
						const cancelTool = resolveExecuteTool(
							`${EVM_TOOL_PREFIX}polymarketCancelOrder`,
						);
						const staleCancel = await cancelTool.execute(
							"wf-evm-trade-stale-execute",
							buildTradeStaleCancelParams(
								network,
								intent,
								trade.tokenId,
								false,
							),
						);
						staleCancelResult = staleCancel.details ?? null;
						staleCancelTargetOrders =
							extractTargetOrderCount(staleCancelResult);
					}
					const executeTool = resolveExecuteTool(
						`${EVM_TOOL_PREFIX}polymarketPlaceOrder`,
					);
					const buildPlaceOrderParams = (limitPrice: number | null) => ({
						network,
						marketSlug: trade.market.slug,
						side: trade.side,
						stakeUsd: intent.stakeUsd,
						limitPrice: limitPrice ?? undefined,
						maxEntryPrice: intent.maxEntryPrice,
						maxSpreadBps: intent.maxSpreadBps,
						minDepthUsd: intent.minDepthUsd,
						maxStakeUsd: intent.maxStakeUsd,
						minConfidence: intent.minConfidence,
						dryRun: false,
						useAiAssist: intent.useAiAssist,
					});
					let executedLimitPrice = requotePricing?.limitPrice ?? null;
					const repost = {
						mode: intent.requoteFallbackMode ?? null,
						primaryError: null as string | null,
						fallbackTried: false,
						usedFallback: false,
						fallbackPricing: null as ReturnType<
							typeof resolveRequoteLimitPrice
						> | null,
						fallbackError: null as string | null,
					};
					let executeResult: {
						content: { type: string; text: string }[];
						details?: unknown;
					} | null = null;
					try {
						executeResult = await executeTool.execute(
							"wf-evm-execute",
							buildPlaceOrderParams(executedLimitPrice),
						);
					} catch (primaryError) {
						if (
							intent.requoteStaleOrders &&
							intent.requoteFallbackMode === "retry_aggressive"
						) {
							repost.primaryError = stringifyUnknown(primaryError);
							const fallbackPricing = resolveRequoteLimitPrice({
								orderbook,
								strategy: "aggressive",
							});
							repost.fallbackPricing = fallbackPricing;
							const fallbackLimit = fallbackPricing.limitPrice;
							const canRetryWithFallback =
								fallbackLimit != null &&
								(executedLimitPrice == null ||
									Math.abs(fallbackLimit - executedLimitPrice) > 1e-9);
							if (canRetryWithFallback) {
								repost.fallbackTried = true;
								try {
									executeResult = await executeTool.execute(
										"wf-evm-execute-fallback",
										buildPlaceOrderParams(fallbackLimit),
									);
									repost.usedFallback = true;
									executedLimitPrice = fallbackLimit;
								} catch (fallbackError) {
									repost.fallbackError = stringifyUnknown(fallbackError);
									throw new Error(
										`Repost failed after stale-cancel. primary=${repost.primaryError} | fallback=${repost.fallbackError}`,
									);
								}
							} else {
								throw new Error(
									`Repost failed after stale-cancel. primary=${repost.primaryError}`,
								);
							}
						} else {
							throw primaryError;
						}
					}
					if (!executeResult) {
						throw new Error(
							"Unexpected empty executeResult after repost flow.",
						);
					}
					let nextRequoteRuntime: ReturnType<
						typeof readTradeRequoteRuntime
					> | null = requoteRuntime;
					if (intent.requoteStaleOrders) {
						const nowMs = Date.now();
						writeTradeRequoteRuntime(runId, {
							attempts: (requoteRuntime?.attemptsUsed ?? 0) + 1,
							lastExecuteAtMs: nowMs,
							referencePrice:
								executedLimitPrice ?? requoteRuntime?.referencePrice ?? null,
						});
						nextRequoteRuntime = readTradeRequoteRuntime({
							runId,
							intent,
							nowMs,
						});
					}
					const submittedOrderId = extractSubmittedOrderId(
						executeResult.details,
					);
					let orderStatus: unknown = null;
					if (submittedOrderId) {
						try {
							const statusTool = resolveExecuteTool(
								`${EVM_TOOL_PREFIX}polymarketGetOrderStatus`,
							);
							const statusResult = await statusTool.execute(
								"wf-evm-order-status",
								{
									network,
									orderId: submittedOrderId,
									includeTrades: true,
									maxTrades: 10,
								},
							);
							orderStatus = statusResult.details ?? null;
						} catch (error) {
							orderStatus = {
								orderId: submittedOrderId,
								error: stringifyUnknown(error),
							};
						}
					}
					const summaryLine = buildTradeSummaryLine({
						intent,
						phase: "execute",
						status: "submitted",
						marketSlug: trade.market.slug,
						side: trade.side,
						entryPrice,
						shares: estimatedShares,
						requoteLimitPrice: executedLimitPrice,
						staleTargets: staleCancelTargetOrders,
					});
					rememberSession({ runId, network, intent });
					return {
						content: [
							{ type: "text", text: `Workflow executed: ${intent.type}` },
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation: mainnetGuardRequired,
							confirmToken,
							artifacts: {
								execute: {
									status: "submitted",
									staleRequote: {
										enabled: intent.requoteStaleOrders,
										fallbackMode: intent.requoteFallbackMode ?? null,
										targetOrders: staleCancelTargetOrders,
										pricing: requotePricing,
										volatilityGuard,
										executedLimitPrice,
										repost,
										runtime: nextRequoteRuntime,
										result: staleCancelResult,
									},
									orderId: submittedOrderId,
									orderStatus,
									result: executeResult.details ?? null,
									guardEvaluation,
									summaryLine,
									summary: {
										schema: "w3rt.workflow.summary.v1",
										phase: "execute",
										status: "submitted",
										intentType: intent.type,
										line: summaryLine,
									},
								},
							},
						},
					};
				}

				if (runMode === "analysis") {
					const summaryLine = buildCancelSummaryLine({
						intent,
						phase: "analysis",
						status: "ready",
						confirmToken: mainnetGuardRequired ? confirmToken : undefined,
					});
					rememberSession({ runId, network, intent });
					return {
						content: [
							{ type: "text", text: `Workflow analyzed: ${intent.type}` },
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation: mainnetGuardRequired,
							confirmToken,
							artifacts: {
								analysis: {
									intent,
									summaryLine,
									summary: {
										schema: "w3rt.workflow.summary.v1",
										phase: "analysis",
										status: "ready",
										intentType: intent.type,
										line: summaryLine,
									},
								},
							},
						},
					};
				}

				if (runMode === "simulate") {
					const cancelTool = resolveExecuteTool(
						`${EVM_TOOL_PREFIX}polymarketCancelOrder`,
					);
					let previewResult: unknown = null;
					let status = "ready";
					try {
						const preview = await cancelTool.execute(
							"wf-evm-cancel-simulate",
							buildCancelExecuteParams(network, intent, true),
						);
						previewResult = preview.details ?? null;
					} catch (error) {
						const message = stringifyUnknown(error);
						status = classifyCancelPrecheckStatus(message);
						previewResult = { error: message };
					}
					const targetOrders = extractTargetOrderCount(previewResult);
					const summaryLine = buildCancelSummaryLine({
						intent,
						phase: "simulate",
						status,
						targetOrders,
						confirmToken: mainnetGuardRequired ? confirmToken : undefined,
					});
					rememberSession({ runId, network, intent });
					return {
						content: [
							{
								type: "text",
								text: `Workflow simulated: ${intent.type} status=${status}`,
							},
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation: mainnetGuardRequired,
							confirmToken,
							artifacts: {
								simulate: {
									status,
									targetOrders,
									preview: previewResult,
									summaryLine,
									summary: {
										schema: "w3rt.workflow.summary.v1",
										phase: "simulate",
										status,
										intentType: intent.type,
										line: summaryLine,
									},
								},
							},
						},
					};
				}

				assertMainnetConfirmation();
				const cancelTool = resolveExecuteTool(
					`${EVM_TOOL_PREFIX}polymarketCancelOrder`,
				);
				const executeResult = await cancelTool.execute(
					"wf-evm-cancel-execute",
					buildCancelExecuteParams(network, intent, false),
				);
				const targetOrders = extractTargetOrderCount(executeResult.details);
				const summaryLine = buildCancelSummaryLine({
					intent,
					phase: "execute",
					status: "submitted",
					targetOrders,
				});
				rememberSession({ runId, network, intent });
				return {
					content: [
						{ type: "text", text: `Workflow executed: ${intent.type}` },
					],
					details: {
						runId,
						runMode,
						network,
						intentType: intent.type,
						intent,
						needsMainnetConfirmation: mainnetGuardRequired,
						confirmToken,
						artifacts: {
							execute: {
								status: "submitted",
								targetOrders,
								result: executeResult.details ?? null,
								summaryLine,
								summary: {
									schema: "w3rt.workflow.summary.v1",
									phase: "execute",
									status: "submitted",
									intentType: intent.type,
									line: summaryLine,
								},
							},
						},
					},
				};
			},
		}),
	];
}
