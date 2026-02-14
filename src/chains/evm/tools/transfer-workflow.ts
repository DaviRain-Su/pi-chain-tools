import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	EVM_TOOL_PREFIX,
	evmNetworkSchema,
	parseEvmNetwork,
	parsePositiveIntegerString,
	parsePositiveNumber,
	stringifyUnknown,
} from "../runtime.js";
import { createEvmExecuteTools } from "./execute.js";

type WorkflowRunMode = "analysis" | "simulate" | "execute";

type TransferIntent =
	| {
			type: "evm.transfer.native";
			toAddress: string;
			amountNative?: number;
			amountWei?: string;
	  }
	| {
			type: "evm.transfer.erc20";
			tokenAddress: string;
			toAddress: string;
			amountRaw: string;
	  };

type WorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	network?: string;
	intentType?: TransferIntent["type"];
	intentText?: string;
	toAddress?: string;
	tokenAddress?: string;
	amountNative?: number;
	amountWei?: string;
	amountRaw?: string;
	rpcUrl?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	fromPrivateKey?: string;
};

type ParsedIntentHints = {
	intentType?: TransferIntent["type"];
	toAddress?: string;
	tokenAddress?: string;
	amountNative?: number;
	amountWei?: string;
	amountRaw?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
};

type WorkflowSessionRecord = {
	runId: string;
	network: string;
	intent: TransferIntent;
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

function parseRunMode(value?: string): WorkflowRunMode {
	if (value === "simulate" || value === "execute") return value;
	return "analysis";
}

function createRunId(input?: string): string {
	if (input?.trim()) return input.trim();
	const nonce = Math.random().toString(36).slice(2, 8);
	return `wf-evm-transfer-${Date.now().toString(36)}-${nonce}`;
}

function rememberSession(record: WorkflowSessionRecord): void {
	SESSION_BY_RUN_ID.set(record.runId, record);
	latestSession = record;
}

function readSession(runId?: string): WorkflowSessionRecord | null {
	if (runId?.trim()) return SESSION_BY_RUN_ID.get(runId.trim()) ?? null;
	return latestSession;
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

function parseIntentText(text?: string): ParsedIntentHints {
	if (!text?.trim()) return {};
	const addresses = text.match(/0x[a-fA-F0-9]{40}/g) ?? [];
	const tokenAddressMatch =
		text.match(/\btoken(?:Address)?\s*[:= ]\s*(0x[a-fA-F0-9]{40})\b/i)?.[1] ??
		undefined;
	const toAddressMatch =
		text.match(
			/(?:to|给|转给|收款地址)\s*[:： ]\s*(0x[a-fA-F0-9]{40})/i,
		)?.[1] ?? undefined;
	const amountRawMatch =
		text.match(/\bamountRaw\s*[:= ]\s*(\d+)/i)?.[1] ??
		text.match(/\braw\s*[:= ]\s*(\d+)/i)?.[1] ??
		undefined;
	const amountWeiMatch =
		text.match(/\bamountWei\s*[:= ]\s*(\d+)/i)?.[1] ??
		text.match(/\bwei\s*[:= ]\s*(\d+)/i)?.[1] ??
		undefined;
	const amountNativeMatch =
		text.match(/(\d+(?:\.\d+)?)\s*(?:matic|eth|native|主币|原生币)/i)?.[1] ??
		text.match(/(?:转|给|send|transfer)\s*(\d+(?:\.\d+)?)/i)?.[1] ??
		undefined;
	const lower = text.toLowerCase();
	const erc20Hint =
		/(erc20|usdc|usdt|token\s+transfer|代币转账)/i.test(text) ||
		(amountRawMatch != null && lower.includes("raw"));

	const tokenAddress = tokenAddressMatch || undefined;
	let toAddress = toAddressMatch || undefined;
	if (!toAddress && addresses.length > 0) {
		if (tokenAddress && addresses.length >= 2) {
			toAddress = addresses.find((entry) => entry !== tokenAddress);
		} else if (!tokenAddress) {
			toAddress = addresses[0];
		}
	}

	return {
		intentType: erc20Hint ? "evm.transfer.erc20" : undefined,
		toAddress,
		tokenAddress,
		amountNative:
			amountNativeMatch != null
				? Number.parseFloat(amountNativeMatch)
				: undefined,
		amountWei: amountWeiMatch,
		amountRaw: amountRawMatch,
		confirmMainnet: hasConfirmMainnetPhrase(text) ? true : undefined,
		confirmToken: extractConfirmTokenFromText(text),
	};
}

function hasIntentInput(params: WorkflowParams): boolean {
	const parsed = parseIntentText(params.intentText);
	return Boolean(
		params.intentType ||
			params.toAddress?.trim() ||
			params.tokenAddress?.trim() ||
			params.amountNative != null ||
			params.amountWei?.trim() ||
			params.amountRaw?.trim() ||
			parsed.intentType ||
			parsed.toAddress ||
			parsed.tokenAddress ||
			parsed.amountNative != null ||
			parsed.amountWei ||
			parsed.amountRaw,
	);
}

function normalizeIntent(params: WorkflowParams): TransferIntent {
	const parsed = parseIntentText(params.intentText);
	const intentType =
		params.intentType ?? parsed.intentType ?? "evm.transfer.native";
	if (intentType === "evm.transfer.erc20") {
		const tokenAddress = parseEvmAddress(
			params.tokenAddress?.trim() || parsed.tokenAddress || "",
			"tokenAddress",
		);
		const toAddress = parseEvmAddress(
			params.toAddress?.trim() || parsed.toAddress || "",
			"toAddress",
		);
		const amountRaw = parsePositiveIntegerString(
			params.amountRaw?.trim() || parsed.amountRaw || "",
			"amountRaw",
		);
		return {
			type: "evm.transfer.erc20",
			tokenAddress,
			toAddress,
			amountRaw,
		};
	}

	const toAddress = parseEvmAddress(
		params.toAddress?.trim() || parsed.toAddress || "",
		"toAddress",
	);
	const amountWei =
		params.amountWei?.trim() || parsed.amountWei
			? parsePositiveIntegerString(
					(params.amountWei?.trim() || parsed.amountWei) as string,
					"amountWei",
				)
			: undefined;
	const amountNative =
		amountWei == null
			? params.amountNative != null
				? parsePositiveNumber(params.amountNative, "amountNative")
				: parsed.amountNative != null
					? parsePositiveNumber(parsed.amountNative, "amountNative")
					: undefined
			: undefined;
	if (!amountWei && amountNative == null) {
		throw new Error(
			"Provide amountNative or amountWei for evm.transfer.native",
		);
	}
	return {
		type: "evm.transfer.native",
		toAddress,
		amountNative,
		amountWei,
	};
}

function stableHash(input: string): string {
	return createHash("sha256").update(input).digest("hex").toUpperCase();
}

function createConfirmToken(
	runId: string,
	network: string,
	intent: TransferIntent,
): string {
	const base = JSON.stringify({ runId, network, intent });
	return `EVM-${stableHash(base).slice(0, 16)}`;
}

function intentsMatch(a: TransferIntent, b: TransferIntent): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function buildSummaryLine(params: {
	intent: TransferIntent;
	phase: WorkflowRunMode;
	status: string;
	confirmToken?: string;
	txHash?: string | null;
}): string {
	const parts = [`${params.intent.type}`, `${params.phase}=${params.status}`];
	if (params.intent.type === "evm.transfer.native") {
		parts.push(`to=${params.intent.toAddress}`);
		if (params.intent.amountNative != null) {
			parts.push(`amountNative=${params.intent.amountNative}`);
		}
		if (params.intent.amountWei) {
			parts.push(`amountWei=${params.intent.amountWei}`);
		}
	} else {
		parts.push(`token=${params.intent.tokenAddress}`);
		parts.push(`to=${params.intent.toAddress}`);
		parts.push(`amountRaw=${params.intent.amountRaw}`);
	}
	if (params.txHash) parts.push(`tx=${params.txHash}`);
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

function buildExecuteParams(params: {
	network: string;
	intent: TransferIntent;
	rpcUrl?: string;
	fromPrivateKey?: string;
	dryRun: boolean;
	confirmMainnet?: boolean;
}): Record<string, unknown> {
	if (params.intent.type === "evm.transfer.native") {
		return {
			network: params.network,
			toAddress: params.intent.toAddress,
			...(params.intent.amountNative != null
				? { amountNative: params.intent.amountNative }
				: {}),
			...(params.intent.amountWei
				? { amountWei: params.intent.amountWei }
				: {}),
			...(params.rpcUrl ? { rpcUrl: params.rpcUrl } : {}),
			...(params.fromPrivateKey
				? { fromPrivateKey: params.fromPrivateKey }
				: {}),
			dryRun: params.dryRun,
			...(params.confirmMainnet != null
				? { confirmMainnet: params.confirmMainnet }
				: {}),
		};
	}
	return {
		network: params.network,
		tokenAddress: params.intent.tokenAddress,
		toAddress: params.intent.toAddress,
		amountRaw: params.intent.amountRaw,
		...(params.rpcUrl ? { rpcUrl: params.rpcUrl } : {}),
		...(params.fromPrivateKey ? { fromPrivateKey: params.fromPrivateKey } : {}),
		dryRun: params.dryRun,
		...(params.confirmMainnet != null
			? { confirmMainnet: params.confirmMainnet }
			: {}),
	};
}

function resolveExecuteToolName(intent: TransferIntent): string {
	return intent.type === "evm.transfer.native"
		? `${EVM_TOOL_PREFIX}transferNative`
		: `${EVM_TOOL_PREFIX}transferErc20`;
}

function extractTxHash(details: unknown): string | null {
	if (!details || typeof details !== "object") return null;
	const payload = details as { txHash?: unknown };
	return typeof payload.txHash === "string" ? payload.txHash : null;
}

export function createEvmTransferWorkflowTools() {
	return [
		defineTool({
			name: "w3rt_run_evm_transfer_workflow_v0",
			label: "w3rt Run EVM Transfer Workflow v0",
			description:
				"Deterministic EVM transfer workflow entrypoint for native/ERC20 transfers: analysis -> simulate -> execute.",
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
						Type.Literal("evm.transfer.native"),
						Type.Literal("evm.transfer.erc20"),
					]),
				),
				intentText: Type.Optional(Type.String()),
				toAddress: Type.Optional(Type.String()),
				tokenAddress: Type.Optional(Type.String()),
				amountNative: Type.Optional(
					Type.Number({ minimum: 0.000000000000000001 }),
				),
				amountWei: Type.Optional(Type.String()),
				amountRaw: Type.Optional(Type.String()),
				rpcUrl: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
				fromPrivateKey: Type.Optional(Type.String()),
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
				const executeTool = resolveExecuteTool(resolveExecuteToolName(intent));
				const effectiveRpcUrl = params.rpcUrl || priorSession?.rpcUrl;
				const effectivePrivateKey =
					params.fromPrivateKey || priorSession?.fromPrivateKey;

				if (runMode === "analysis") {
					const summaryLine = buildSummaryLine({
						intent,
						phase: "analysis",
						status: "ready",
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
					let previewResult: unknown = null;
					let status = "ready";
					try {
						const preview = await executeTool.execute(
							"wf-evm-transfer-simulate",
							buildExecuteParams({
								network,
								intent,
								rpcUrl: effectiveRpcUrl,
								fromPrivateKey: effectivePrivateKey,
								dryRun: true,
							}),
						);
						previewResult = preview.details ?? null;
					} catch (error) {
						status = "precheck_failed";
						previewResult = { error: stringifyUnknown(error) };
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
							artifacts: {
								simulate: {
									status,
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
					"wf-evm-transfer-execute",
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
								txHash,
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
