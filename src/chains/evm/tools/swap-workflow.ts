import { createHash } from "node:crypto";

import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../core/types.js";
import { resolveWorkflowRunMode } from "../../../w3rt-core/index.js";
import { isMainnetLikeEvmNetwork } from "../policy.js";
import {
	EVM_TOOL_PREFIX,
	type EvmNetwork,
	evmNetworkSchema,
	parseEvmNetwork,
	parsePositiveIntegerString,
	parsePositiveNumber,
	stringifyUnknown,
} from "../runtime.js";
import { createEvmExecuteTools, getPancakeV2ConfigStatus } from "./execute.js";

type WorkflowRunMode = "analysis" | "simulate" | "execute";

type WorkflowIntent = {
	type: "evm.swap.pancakeV2";
	tokenInAddress: string;
	tokenOutAddress: string;
	amountInRaw: string;
	toAddress: string;
	slippageBps?: number;
	deadlineMinutes?: number;
	amountOutMinRaw?: string;
};

type WorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	network?: string;
	intentType?: "evm.swap.pancakeV2";
	intentText?: string;
	tokenInAddress?: string;
	tokenOutAddress?: string;
	amountInRaw?: string;
	toAddress?: string;
	amountOutMinRaw?: string;
	slippageBps?: number;
	deadlineMinutes?: number;
	rpcUrl?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	fromPrivateKey?: string;
};

type ParsedIntentHints = {
	tokenInAddress?: string;
	tokenOutAddress?: string;
	amountInRaw?: string;
	toAddress?: string;
	amountOutMinRaw?: string;
	slippageBps?: number;
	deadlineMinutes?: number;
	confirmMainnet?: boolean;
	confirmToken?: string;
};

type WorkflowSessionRecord = {
	runId: string;
	network: string;
	intent: WorkflowIntent;
	rpcUrl?: string;
	fromPrivateKey?: string;
};

type ExecuteTool = {
	name: string;
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

const SESSION_BY_RUN_ID = new Map<string, WorkflowSessionRecord>();
let latestSession: WorkflowSessionRecord | null = null;

function createRunId(input?: string): string {
	if (input?.trim()) return input.trim();
	const nonce = Math.random().toString(36).slice(2, 8);
	return `wf-evm-swap-${Date.now().toString(36)}-${nonce}`;
}

function rememberSession(record: WorkflowSessionRecord): void {
	SESSION_BY_RUN_ID.set(record.runId, record);
	latestSession = record;
}

function readSession(runId?: string): WorkflowSessionRecord | null {
	if (runId?.trim()) {
		return SESSION_BY_RUN_ID.get(runId.trim()) ?? null;
	}
	return latestSession;
}

function resolveExecuteTool(name: string): ExecuteTool {
	const tool = createEvmExecuteTools().find((entry) => entry.name === name);
	if (!tool) {
		throw new Error(`${name} tool not found`);
	}
	return tool as unknown as ExecuteTool;
}

function getPancakeV2ConfigPrecheck(network: EvmNetwork) {
	const status = getPancakeV2ConfigStatus(network);
	return {
		schema: "w3rt.workflow.pancakev2.precheck.v1",
		ready: status.configured,
		status: status.configured ? "ready" : "blocked",
		network: status.network,
		config: {
			source: status.source,
			configured: status.configured,
			issues: status.issues,
			config: status.config,
		},
		reason: status.configured
			? undefined
			: (status.issues[0] ?? "PancakeSwap V2 config is not ready."),
	};
}

function assertPancakeV2ConfigReady(precheck: {
	ready: boolean;
	reason?: string;
}): void {
	if (!precheck.ready) {
		throw new Error(precheck.reason);
	}
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

function parseAmountRaw(raw?: string): string | undefined {
	if (!raw) return undefined;
	return raw.trim();
}

function isEvmAddress(value: string): boolean {
	return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function parseEvmAddress(value: string, fieldName: string): string {
	const normalized = value.trim();
	if (!isEvmAddress(normalized)) {
		throw new Error(`${fieldName} must be a valid EVM address`);
	}
	return normalized;
}

function parseIntentText(text?: string): ParsedIntentHints {
	if (!text?.trim()) return {};
	const addresses = text.match(/0x[a-fA-F0-9]{40}/g) ?? [];
	const tokenInAddress =
		text.match(
			/\b(?:tokenInAddress|fromAddress|fromToken|inputToken|tokenIn)\s*[:= ]\s*(0x[a-fA-F0-9]{40})\b/i,
		)?.[1] ??
		text.match(/\btoken(?:In)?Address\s*[:= ]\s*(0x[a-fA-F0-9]{40})\b/i)?.[1] ??
		text.match(/\bfrom\s*[:= ]\s*(0x[a-fA-F0-9]{40})\b/i)?.[1];
	const tokenOutAddress =
		text.match(
			/\b(?:tokenOutAddress|toToken|outputToken|tokenOut)\s*[:= ]\s*(0x[a-fA-F0-9]{40})\b/i,
		)?.[1] ??
		text.match(/\btoken(?:Out)?Address\s*[:= ]\s*(0x[a-fA-F0-9]{40})\b/i)?.[1];
	const toAddressFromText =
		text.match(
			/\b(?:recipient|recipientAddress|receiver|receiverAddress|toAddress)\s*[:= ]\s*(0x[a-fA-F0-9]{40})\b/i,
		)?.[1] ??
		text.match(
			/(?:^|\s)(?:给|给到|转给|转到|收款|收款到|收币|收币到)\s*[:： ]?\s*(0x[a-fA-F0-9]{40})/i,
		)?.[1];
	const amountInRaw = parseAmountRaw(
		text.match(/\bamountInRaw\s*[:= ]\s*(\d+(?:\.\d+)?)\b/i)?.[1] ??
			text.match(/\bamountIn\s*[:= ]\s*(\d+(?:\.\d+)?)\b/i)?.[1] ??
			text.match(/\brawIn\s*[:= ]\s*(\d+(?:\.\d+)?)\b/i)?.[1] ??
			text.match(
				/(?:^|[\s，。,.])(?:数量|数量为|amount)\s*[:=：]?\s*(\d+(?:\.\d+)?)\b/i,
			)?.[1] ??
			text.match(/(?:^|[\s，。,.])(\d+(?:\.\d+)?)\s*(?:from|从|to|到)/i)?.[1] ??
			text.match(/(?:把|换|兑换|swap)\s*(\d+(?:\.\d+)?)/i)?.[1],
	);
	const amountOutMinRaw = parseAmountRaw(
		text.match(
			/\b(?:amountOutMinRaw|minOutRaw|minOut)\s*[:= ]\s*(\d+(?:\.\d+)?)\b/i,
		)?.[1],
	);
	const slippageMatch = text.match(
		/(?:^|[\s，。,.])(slippageBps|slippage|滑点)\s*[:=：]?\s*(\d+(?:\.\d+)?)\s*(%)?/i,
	);
	const slippageRawNumeric = slippageMatch?.[2];
	const slippageRawPercent = slippageMatch?.[3]?.includes("%") === true;
	const slippageBps =
		slippageRawNumeric != null
			? Number.parseFloat(slippageRawNumeric) * (slippageRawPercent ? 100 : 1)
			: undefined;
	const deadlineRaw =
		text.match(
			/(?:^|[\s，。,.])(?:deadlineMinutes|deadline|deadlineMin|截止|超时)\s*[:=：]?\s*(\d+)\b/i,
		)?.[1] ?? text.match(/\bdeadlineMinutes\s*[:= ]\s*(\d+)\b/i)?.[1];
	const uniqueAddresses = [
		...new Set(addresses.map((entry) => entry.toLowerCase())),
	];
	const candidateSwapAddresses = (() => {
		if (!toAddressFromText) return uniqueAddresses;
		const toAddressLower = toAddressFromText.toLowerCase();
		const filtered = uniqueAddresses.filter(
			(entry) => entry !== toAddressLower,
		);
		return filtered.length > 0 ? filtered : uniqueAddresses;
	})();

	let resolvedTokenIn = tokenInAddress;
	let resolvedTokenOut = tokenOutAddress;
	let resolvedTo = toAddressFromText;
	if (candidateSwapAddresses.length >= 2) {
		if (!resolvedTokenIn) resolvedTokenIn = candidateSwapAddresses[0];
		if (!resolvedTokenOut) resolvedTokenOut = candidateSwapAddresses[1];
	} else if (candidateSwapAddresses.length === 1) {
		if (!resolvedTokenIn && !resolvedTokenOut) {
			resolvedTokenIn = candidateSwapAddresses[0];
		}
	}
	if (!resolvedTo && uniqueAddresses.length >= 3) {
		resolvedTo = uniqueAddresses[2];
	}

	return {
		tokenInAddress: resolvedTokenIn,
		tokenOutAddress: resolvedTokenOut,
		amountInRaw,
		toAddress: resolvedTo,
		amountOutMinRaw,
		slippageBps:
			slippageBps != null && Number.isFinite(slippageBps) && slippageBps > 0
				? slippageBps
				: undefined,
		deadlineMinutes:
			deadlineRaw != null ? Number.parseInt(deadlineRaw, 10) : undefined,
		confirmMainnet: hasConfirmMainnetPhrase(text) ? true : undefined,
		confirmToken: extractConfirmTokenFromText(text),
	};
}

function hasIntentInput(params: WorkflowParams): boolean {
	const parsed = parseIntentText(params.intentText);
	return Boolean(
		params.intentType ||
			params.tokenInAddress?.trim() ||
			params.tokenOutAddress?.trim() ||
			params.amountInRaw?.trim() ||
			params.toAddress?.trim() ||
			params.amountOutMinRaw?.trim() ||
			params.slippageBps != null ||
			params.deadlineMinutes != null ||
			parsed.tokenInAddress ||
			parsed.tokenOutAddress ||
			parsed.amountInRaw ||
			parsed.toAddress ||
			parsed.amountOutMinRaw ||
			parsed.slippageBps != null ||
			parsed.deadlineMinutes != null,
	);
}

function buildMissingSwapFieldError(input: {
	tokenInAddressInput?: string;
	tokenOutAddressInput?: string;
	toAddressInput?: string;
	amountInRawInput?: string;
}): string | undefined {
	const missing: string[] = [];
	if (!input.tokenInAddressInput) {
		missing.push(
			"tokenInAddress (use 'tokenInAddress' / 'from' / 'fromAddress' / 'fromToken' / 'inputToken' / 'tokenIn=')",
		);
	}
	if (!input.tokenOutAddressInput) {
		missing.push(
			"tokenOutAddress (use 'tokenOutAddress' / 'toToken' / 'outputToken' / 'tokenOut=')",
		);
	}
	if (!input.toAddressInput) {
		missing.push(
			"toAddress (use 'toAddress' / 'recipient' / 'recipientAddress' / 'receiver' / 'receiverAddress' / '给 ...', '转给 ...', '收款到 ...')",
		);
	}
	if (!input.amountInRawInput) {
		missing.push(
			"amountInRaw (positive integer string; decimal token amounts must be converted first)",
		);
	}
	if (missing.length === 0) return undefined;
	if (missing.length === 1) {
		if (!input.tokenInAddressInput) {
			return "tokenInAddress is required for evm.swap.pancakeV2. Include tokenInAddress in params or phrase it like 'from=0x...'.";
		}
		if (!input.tokenOutAddressInput) {
			return "tokenOutAddress is required for evm.swap.pancakeV2. Include tokenOutAddress in params or phrase it like 'toToken=0x...'.";
		}
		if (!input.toAddressInput) {
			return "toAddress is required for evm.swap.pancakeV2. Include toAddress in params or phrase it like 'toAddress=0x...' / '给/...'.";
		}
		if (!input.amountInRawInput) {
			return "amountInRaw is required for evm.swap.pancakeV2. Use amountInRaw and keep it an integer raw amount.";
		}
	}
	return `Missing required fields for evm.swap.pancakeV2: ${missing.join(", ")}.`;
}

function normalizeIntent(params: WorkflowParams): {
	intent: WorkflowIntent;
	rpcUrl?: string;
	fromPrivateKey?: string;
} {
	const parsed = parseIntentText(params.intentText);
	const intentType = params.intentType ?? "evm.swap.pancakeV2";
	if (intentType !== "evm.swap.pancakeV2") {
		throw new Error("intentType must be evm.swap.pancakeV2");
	}

	const tokenInAddressInput =
		params.tokenInAddress?.trim() || parsed.tokenInAddress;
	const tokenOutAddressInput =
		params.tokenOutAddress?.trim() || parsed.tokenOutAddress;
	const toAddressInput = params.toAddress?.trim() || parsed.toAddress;
	const amountInRawInput = params.amountInRaw?.trim() || parsed.amountInRaw;
	const missingFieldError = buildMissingSwapFieldError({
		tokenInAddressInput,
		tokenOutAddressInput,
		toAddressInput,
		amountInRawInput,
	});
	if (missingFieldError) {
		throw new Error(missingFieldError);
	}
	const normalizedAmountInRawInput = amountInRawInput ?? "";
	if (
		!/^\d+$/.test(normalizedAmountInRawInput) ||
		/^0+$/.test(normalizedAmountInRawInput)
	) {
		if (/^\d+\.\d+$/.test(normalizedAmountInRawInput)) {
			throw new Error(
				"amountInRaw must be an integer raw amount. Decimal values are not accepted by this workflow; convert token amount to raw units yourself.",
			);
		}
		throw new Error(
			"amountInRaw must be a positive integer string (raw units) for evm.swap.pancakeV2.",
		);
	}

	const tokenInAddress = parseEvmAddress(
		tokenInAddressInput ?? "",
		"tokenInAddress",
	);
	const tokenOutAddress = parseEvmAddress(
		tokenOutAddressInput ?? "",
		"tokenOutAddress",
	);
	const toAddress = parseEvmAddress(toAddressInput ?? "", "toAddress");
	const amountInRaw = parsePositiveIntegerString(
		normalizedAmountInRawInput,
		"amountInRaw",
	);
	if (tokenInAddress.toLowerCase() === tokenOutAddress.toLowerCase()) {
		throw new Error("tokenInAddress and tokenOutAddress must differ");
	}

	const amountOutMinRawInput =
		params.amountOutMinRaw?.trim() || parsed.amountOutMinRaw;
	if (
		amountOutMinRawInput != null &&
		(!/^\d+$/.test(amountOutMinRawInput) || /^0+$/.test(amountOutMinRawInput))
	) {
		if (/^\d+\.\d+$/.test(amountOutMinRawInput)) {
			throw new Error(
				"amountOutMinRaw must be an integer raw amount. Decimal values are not accepted by this workflow; convert token amount to raw units yourself.",
			);
		}
		throw new Error(
			"amountOutMinRaw must be a positive integer string (raw units) for evm.swap.pancakeV2.",
		);
	}
	const slippageBpsRaw = params.slippageBps ?? parsed.slippageBps;
	const deadlineMinutesRaw = params.deadlineMinutes ?? parsed.deadlineMinutes;
	const slippageBps =
		slippageBpsRaw == null
			? undefined
			: parsePositiveNumber(slippageBpsRaw, "slippageBps");
	const deadlineMinutes =
		deadlineMinutesRaw == null
			? undefined
			: parsePositiveNumber(deadlineMinutesRaw, "deadlineMinutes");
	if (slippageBps != null && (slippageBps < 1 || slippageBps > 9999)) {
		throw new Error("slippageBps must be within 1 and 9999");
	}
	if (
		deadlineMinutes != null &&
		(deadlineMinutes < 1 || deadlineMinutes > 60 * 24 * 7)
	) {
		throw new Error("deadlineMinutes must be within 1 and 10080");
	}

	return {
		intent: {
			type: "evm.swap.pancakeV2",
			tokenInAddress,
			tokenOutAddress,
			amountInRaw,
			toAddress,
			...(amountOutMinRawInput
				? {
						amountOutMinRaw: parsePositiveIntegerString(
							amountOutMinRawInput,
							"amountOutMinRaw",
						),
					}
				: {}),
			...(slippageBps != null ? { slippageBps } : {}),
			...(deadlineMinutes != null ? { deadlineMinutes } : {}),
		},
		rpcUrl: params.rpcUrl,
		fromPrivateKey: params.fromPrivateKey,
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
	return `EVM-${stableHash(JSON.stringify({ runId, network, intent })).slice(0, 16)}`;
}

function intentsMatch(a: WorkflowIntent, b: WorkflowIntent): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function buildSummaryLine(params: {
	intent: WorkflowIntent;
	phase: WorkflowRunMode;
	status: string;
	confirmToken?: string;
	txHash?: string | null;
}): string {
	const intent = params.intent;
	const parts = [`${intent.type}`, `${params.phase}=${params.status}`];
	parts.push(`tokenIn=${intent.tokenInAddress}`);
	parts.push(`tokenOut=${intent.tokenOutAddress}`);
	parts.push(`amountInRaw=${intent.amountInRaw}`);
	parts.push(`to=${intent.toAddress}`);
	if (intent.amountOutMinRaw) {
		parts.push(`amountOutMinRaw=${intent.amountOutMinRaw}`);
	}
	if (intent.slippageBps != null)
		parts.push(`slippageBps=${intent.slippageBps}`);
	if (intent.deadlineMinutes != null) {
		parts.push(`deadlineMinutes=${intent.deadlineMinutes}`);
	}
	if (params.txHash) parts.push(`tx=${params.txHash}`);
	if (params.confirmToken) parts.push(`confirmToken=${params.confirmToken}`);
	return parts.join(" ");
}

function buildExecuteParams(params: {
	network: string;
	intent: WorkflowIntent;
	dryRun: boolean;
	confirmMainnet?: boolean;
	rpcUrl?: string;
	fromPrivateKey?: string;
}): Record<string, unknown> {
	return {
		network: params.network,
		tokenInAddress: params.intent.tokenInAddress,
		tokenOutAddress: params.intent.tokenOutAddress,
		amountInRaw: params.intent.amountInRaw,
		toAddress: params.intent.toAddress,
		...(params.intent.amountOutMinRaw
			? { amountOutMinRaw: params.intent.amountOutMinRaw }
			: {}),
		...(params.intent.slippageBps != null
			? { slippageBps: params.intent.slippageBps }
			: {}),
		...(params.intent.deadlineMinutes != null
			? { deadlineMinutes: params.intent.deadlineMinutes }
			: {}),
		dryRun: params.dryRun,
		...(params.rpcUrl ? { rpcUrl: params.rpcUrl } : {}),
		...(params.fromPrivateKey ? { fromPrivateKey: params.fromPrivateKey } : {}),
		...(params.confirmMainnet != null
			? { confirmMainnet: params.confirmMainnet }
			: {}),
	};
}

function extractTxHash(details: unknown): string | null {
	if (!details || typeof details !== "object") return null;
	const payload = details as { txHash?: unknown };
	return typeof payload.txHash === "string" ? payload.txHash : null;
}

export function createEvmSwapWorkflowTools() {
	return [
		defineTool({
			name: "w3rt_run_evm_swap_workflow_v0",
			label: "w3rt Run EVM Swap Workflow v0",
			description:
				"Deterministic EVM swap workflow entrypoint for PancakeSwap V2 swaps: analysis -> simulate -> execute.",
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
				intentType: Type.Optional(Type.Literal("evm.swap.pancakeV2")),
				intentText: Type.Optional(Type.String()),
				tokenInAddress: Type.Optional(Type.String()),
				tokenOutAddress: Type.Optional(Type.String()),
				amountInRaw: Type.Optional(Type.String()),
				toAddress: Type.Optional(Type.String()),
				amountOutMinRaw: Type.Optional(Type.String()),
				slippageBps: Type.Optional(Type.Number({ minimum: 1, maximum: 9999 })),
				deadlineMinutes: Type.Optional(
					Type.Number({ minimum: 1, maximum: 10080 }),
				),
				rpcUrl: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
				fromPrivateKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as WorkflowParams;
				const parsedHints = parseIntentText(params.intentText);
				const runMode = resolveWorkflowRunMode(
					params.runMode,
					params.intentText,
					{
						allowCompose: false,
					},
				);
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
				const resolved =
					runMode === "execute" &&
					!hasIntentInput(params) &&
					priorSession?.intent
						? {
								intent: priorSession.intent,
								rpcUrl: priorSession.rpcUrl,
								fromPrivateKey: priorSession.fromPrivateKey,
							}
						: normalizeIntent(params);
				const intent = resolved.intent;
				const effectiveRpcUrl =
					params.rpcUrl || priorSession?.rpcUrl || resolved.rpcUrl;
				const effectivePrivateKey =
					params.fromPrivateKey ||
					priorSession?.fromPrivateKey ||
					resolved.fromPrivateKey;
				const confirmToken = createConfirmToken(runId, network, intent);
				const providedConfirmToken =
					params.confirmToken?.trim() || parsedHints.confirmToken?.trim();
				const effectiveConfirmMainnet =
					params.confirmMainnet === true || parsedHints.confirmMainnet === true;
				const mainnetGuardRequired = isMainnetLikeEvmNetwork(network);
				const executeTool = resolveExecuteTool(
					`${EVM_TOOL_PREFIX}pancakeV2Swap`,
				);
				const precheck = getPancakeV2ConfigPrecheck(network);
				const precheckSummary = {
					schema: precheck.schema,
					status: precheck.status,
					ready: precheck.ready,
					network: precheck.network,
				};

				if (runMode === "analysis") {
					const analysisStatus = precheck.ready ? "ready" : "config_blocked";
					const summaryLine = buildSummaryLine({
						intent,
						phase: "analysis",
						status: analysisStatus,
						confirmToken: mainnetGuardRequired ? confirmToken : undefined,
					});
					if (precheck.ready) {
						rememberSession({
							runId,
							network,
							intent,
							rpcUrl: effectiveRpcUrl,
							fromPrivateKey: effectivePrivateKey,
						});
					}
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
							pancakeV2Config: precheck,
							artifacts: {
								analysis: {
									intent,
									summaryLine,
									precheck: precheckSummary,
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
					assertPancakeV2ConfigReady(precheck);
					let simulateResult: unknown = null;
					let status = "ready";
					try {
						const preview = await executeTool.execute(
							"wf-evm-swap-simulate",
							buildExecuteParams({
								network,
								intent,
								rpcUrl: effectiveRpcUrl,
								fromPrivateKey: effectivePrivateKey,
								dryRun: true,
							}),
						);
						simulateResult = preview.details ?? null;
					} catch (error) {
						status = "precheck_failed";
						simulateResult = { error: stringifyUnknown(error) };
					}
					const summaryLine = buildSummaryLine({
						intent,
						phase: "simulate",
						status,
						confirmToken: mainnetGuardRequired ? confirmToken : undefined,
					});
					rememberSession({
						runId,
						network,
						intent,
						rpcUrl: effectiveRpcUrl,
						fromPrivateKey: effectivePrivateKey,
					});
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
							pancakeV2Config: precheck,
							artifacts: {
								simulate: {
									status,
									preview: simulateResult,
									precheck: precheckSummary,
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

				assertPancakeV2ConfigReady(precheck);

				if (mainnetGuardRequired) {
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
				}

				const executeResult = await executeTool.execute(
					"wf-evm-swap-execute",
					buildExecuteParams({
						network,
						intent,
						rpcUrl: effectiveRpcUrl,
						fromPrivateKey: effectivePrivateKey,
						dryRun: false,
						confirmMainnet: mainnetGuardRequired ? true : undefined,
					}),
				);
				const txHash = extractTxHash(executeResult.details);
				const summaryLine = buildSummaryLine({
					intent,
					phase: "execute",
					status: "submitted",
					txHash,
				});
				rememberSession({
					runId,
					network,
					intent,
					rpcUrl: effectiveRpcUrl,
					fromPrivateKey: effectivePrivateKey,
				});
				return {
					content: [
						{
							type: "text",
							text: `Workflow executed: ${intent.type}`,
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
						pancakeV2Config: precheck,
						artifacts: {
							execute: {
								status: "submitted",
								txHash,
								result: executeResult.details ?? null,
								precheck: precheckSummary,
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
