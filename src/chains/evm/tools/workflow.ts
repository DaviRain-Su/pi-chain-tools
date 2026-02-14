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
	maxAgeMinutes?: number;
	maxFillRatio?: number;
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
	maxAgeMinutes?: number;
	maxFillRatio?: number;
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

function parseIntentText(text?: string): ParsedIntentHints {
	if (!text?.trim()) return {};
	const side = parseSideHint(text);
	const stakeMatch =
		text.match(
			/(?:stake|size|amount|仓位|金额|下注|下单)\s*[:= ]\s*(\d+(?:\.\d+)?)/i,
		) ?? text.match(/(\d+(?:\.\d+)?)\s*(?:usd|usdc)\b/i);
	const marketSlug =
		text.match(/\b([a-z0-9]+(?:-[a-z0-9]+)*btc(?:-[a-z0-9]+)*)\b/i)?.[1] ??
		text.match(/\b(btc-updown-5m-[a-z0-9-]+)\b/i)?.[1];
	const tokenId =
		text.match(/\btoken(?:Id)?\s*[:= ]\s*([0-9]{6,})\b/i)?.[1] ?? undefined;
	const isCancelIntent =
		/(取消|撤销|撤单|清空挂单|cancel\s+order|cancel\s+orders?|cancel)/i.test(
			text,
		);
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
		staleMinutesMatch && (isCancelIntent || staleModeHint)
			? Number.parseFloat(staleMinutesMatch)
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
		maxAgeMinutes,
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
			params.maxAgeMinutes != null ||
			params.maxFillRatio != null ||
			parsed.intentType ||
			parsed.marketSlug ||
			parsed.tokenId ||
			parsed.side ||
			parsed.stakeUsd != null ||
			parsed.orderId ||
			(parsed.orderIds && parsed.orderIds.length > 0) ||
			parsed.cancelAll === true ||
			parsed.maxAgeMinutes != null ||
			parsed.maxFillRatio != null,
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
	confirmToken?: string;
}): string {
	const parts = [`${params.intent.type}`, `${params.phase}=${params.status}`];
	if (params.marketSlug) parts.push(`market=${params.marketSlug}`);
	if (params.side) parts.push(`side=${params.side}`);
	if (params.entryPrice != null)
		parts.push(`entry=${params.entryPrice.toFixed(4)}`);
	if (params.shares != null) parts.push(`shares~=${params.shares.toFixed(4)}`);
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
				maxAgeMinutes: Type.Optional(Type.Number({ minimum: 0.1 })),
				maxFillRatio: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
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
					const baseStatus =
						entryPrice == null
							? "no_liquidity"
							: intent.maxEntryPrice != null &&
									entryPrice > intent.maxEntryPrice
								? "price_too_high"
								: "ready";
					const estimatedShares =
						entryPrice == null ? null : intent.stakeUsd / entryPrice;
					const guardEvaluation = evaluateBtc5mTradeGuards({
						stakeUsd: intent.stakeUsd,
						orderbook,
						limitPrice: intent.maxEntryPrice ?? entryPrice ?? 0,
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
						const summaryLine = buildTradeSummaryLine({
							intent,
							phase: "analysis",
							status: analysisStatus,
							marketSlug: trade.market.slug,
							side: trade.side,
							entryPrice,
							shares: estimatedShares,
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
						const summaryLine = buildTradeSummaryLine({
							intent,
							phase: "simulate",
							status: simulateStatus,
							marketSlug: trade.market.slug,
							side: trade.side,
							entryPrice,
							shares: estimatedShares,
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
							`Trade execute blocked: entryPrice ${entryPrice ?? "n/a"} exceeds maxEntryPrice ${intent.maxEntryPrice}.`,
						);
					}
					if (simulateStatus === "guard_blocked") {
						throw new Error(
							`Trade execute blocked by guard checks: ${guardEvaluation.issues.map((issue) => issue.message).join(" | ")}`,
						);
					}
					const executeTool = resolveExecuteTool(
						`${EVM_TOOL_PREFIX}polymarketPlaceOrder`,
					);
					const executeResult = await executeTool.execute("wf-evm-execute", {
						network,
						marketSlug: trade.market.slug,
						side: trade.side,
						stakeUsd: intent.stakeUsd,
						maxEntryPrice: intent.maxEntryPrice,
						maxSpreadBps: intent.maxSpreadBps,
						minDepthUsd: intent.minDepthUsd,
						maxStakeUsd: intent.maxStakeUsd,
						minConfidence: intent.minConfidence,
						dryRun: false,
						useAiAssist: intent.useAiAssist,
					});
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
						status = /private key|POLYMARKET_PRIVATE_KEY|funder/i.test(message)
							? "needs_signer"
							: "precheck_failed";
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
