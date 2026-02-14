import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
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
	useAiAssist: boolean;
};

type WorkflowCancelIntent = {
	type: "evm.polymarket.btc5m.cancel";
	marketSlug?: string;
	tokenId?: string;
	side?: "up" | "down";
	orderIds: string[];
	cancelAll: boolean;
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
	orderId?: string;
	orderIds?: string[];
	cancelAll?: boolean;
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
	const lower = text.toLowerCase();
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

	return {
		intentType: isCancelIntent ? "evm.polymarket.btc5m.cancel" : undefined,
		marketSlug: marketSlug?.trim(),
		tokenId,
		side,
		stakeUsd: stakeMatch?.[1] ? Number.parseFloat(stakeMatch[1]) : undefined,
		orderId: explicitOrderId,
		orderIds,
		cancelAll,
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
			params.orderId?.trim() ||
			(params.orderIds && params.orderIds.length > 0) ||
			params.cancelAll === true ||
			parsed.intentType ||
			parsed.marketSlug ||
			parsed.tokenId ||
			parsed.side ||
			parsed.stakeUsd != null ||
			parsed.orderId ||
			(parsed.orderIds && parsed.orderIds.length > 0) ||
			parsed.cancelAll === true,
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
		if (
			!cancelAll &&
			orderIds.length === 0 &&
			!tokenId &&
			!marketSlug &&
			!side
		) {
			throw new Error(
				"cancel intent requires one selector: cancelAll, orderId(s), tokenId, or (marketSlug/side).",
			);
		}
		return {
			type: "evm.polymarket.btc5m.cancel",
			marketSlug,
			tokenId,
			side,
			orderIds,
			cancelAll,
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
				orderId: Type.Optional(Type.String()),
				orderIds: Type.Optional(
					Type.Array(Type.String({ minLength: 1 }), {
						minItems: 1,
						maxItems: 50,
					}),
				),
				cancelAll: Type.Optional(Type.Boolean()),
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
					const simulateStatus =
						entryPrice == null
							? "no_liquidity"
							: intent.maxEntryPrice != null &&
									entryPrice > intent.maxEntryPrice
								? "price_too_high"
								: "ready";
					const estimatedShares =
						entryPrice == null ? null : intent.stakeUsd / entryPrice;

					if (runMode === "analysis") {
						const summaryLine = buildTradeSummaryLine({
							intent,
							phase: "analysis",
							status: "ready",
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
					const executeTool = resolveExecuteTool(
						`${EVM_TOOL_PREFIX}polymarketPlaceOrder`,
					);
					const executeResult = await executeTool.execute("wf-evm-execute", {
						network,
						marketSlug: trade.market.slug,
						side: trade.side,
						stakeUsd: intent.stakeUsd,
						maxEntryPrice: intent.maxEntryPrice,
						dryRun: false,
						useAiAssist: intent.useAiAssist,
					});
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
