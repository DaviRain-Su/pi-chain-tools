import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../core/types.js";
import { resolveWorkflowRunMode } from "../../shared/workflow-runtime.js";
import { kaspaNetworkSchema, parseKaspaNetwork } from "../runtime.js";
import { createKaspaComposeTools } from "./compose.js";
import { submitKaspaTransaction } from "./execute.js";

type KaspaWorkflowRunMode = "analysis" | "simulate" | "execute";

type KaspaWorkflowSession = {
	runId: string;
	network: string;
	request: Record<string, unknown>;
	requestHash: string | undefined;
	confirmToken: string | undefined;
	createdAt: number;
};

type WorkflowParams = {
	runId?: string;
	runMode?: string;
	intentType?: "kaspa.transaction.submit";
	intentText?: string;
	network?: string;
	fromAddress?: string;
	toAddress?: string;
	amount?: string | number;
	outputs?: unknown[];
	utxos?: unknown[];
	feeRate?: string | number;
	dustLimit?: string | number;
	changeAddress?: string;
	lockTime?: number;
	requestMemo?: string;
	rawTransaction?: string;
	request?: unknown;
	confirmToken?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	confirmMainnet?: boolean;
	feeEndpoint?: string;
	mempoolEndpoint?: string;
	readStateEndpoint?: string;
	checkAcceptance?: boolean;
	acceptanceEndpoint?: string;
	skipFeePreflight?: boolean;
	skipMempoolPreflight?: boolean;
	skipReadStatePreflight?: boolean;
};

const KASPA_WORKFLOW_SESSIONS = new Map<string, KaspaWorkflowSession>();
let latestKaspaWorkflowSession: KaspaWorkflowSession | null = null;

const KASPA_COMPOSE_TOOL = createKaspaComposeTools().find(
	(tool) => tool.name === "kaspa_buildTransferTransaction",
);
if (!KASPA_COMPOSE_TOOL) {
	throw new Error(
		"kaspa_buildTransferTransaction tool is required for workflow compose path",
	);
}

function createKaspaWorkflowRunId(): string {
	return `wf-kaspa-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function readWorkflowSession(runId?: string): KaspaWorkflowSession | null {
	if (runId?.trim()) {
		return KASPA_WORKFLOW_SESSIONS.get(runId.trim()) ?? null;
	}
	return latestKaspaWorkflowSession;
}

function rememberWorkflowSession(record: KaspaWorkflowSession): void {
	KASPA_WORKFLOW_SESSIONS.set(record.runId, record);
	latestKaspaWorkflowSession = record;
}

function parseKaspaTransactionPayload(value?: string): unknown | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
}

function resolveKaspaTransactionPayload(
	rawTransaction?: string,
	request?: unknown,
): Record<string, unknown> {
	const requestBody =
		request === undefined
			? undefined
			: (() => {
					if (
						request === null ||
						typeof request !== "object" ||
						Array.isArray(request)
					) {
						throw new Error("request must be an object");
					}
					return request as Record<string, unknown>;
				})();
	const normalizedRaw = parseKaspaTransactionPayload(rawTransaction);
	if (!requestBody && normalizedRaw === undefined) {
		throw new Error(
			"At least one of rawTransaction or request is required for Kaspa workflow",
		);
	}
	const body: Record<string, unknown> = requestBody ? { ...requestBody } : {};
	if (rawTransaction?.trim()) {
		body.transaction = normalizedRaw;
	} else if (!("transaction" in body) && "rawTransaction" in body) {
		if (typeof body.rawTransaction === "string") {
			body.transaction = parseKaspaTransactionPayload(body.rawTransaction);
		} else {
			body.transaction = body.rawTransaction;
		}
	}
	if ("rawTransaction" in body) {
		body.rawTransaction = undefined;
	}
	if (!("transaction" in body)) {
		throw new Error("request payload must include transaction");
	}
	if (typeof body.transaction === "string") {
		throw new Error(
			"transaction must be an object or array of unsigned tx data",
		);
	}
	return body;
}

function hasComposeInputs(params: WorkflowParams): boolean {
	if (!params.fromAddress?.trim()) {
		return false;
	}
	if (!Array.isArray(params.utxos) || params.utxos.length === 0) {
		return false;
	}
	if (params.toAddress?.trim()) {
		return true;
	}
	return Array.isArray(params.outputs) && params.outputs.length > 0;
}

async function resolveWorkflowSubmitRequest(
	params: WorkflowParams,
	priorSession: KaspaWorkflowSession | null,
	runMode: KaspaWorkflowRunMode,
): Promise<Record<string, unknown>> {
	if (params.rawTransaction !== undefined || params.request !== undefined) {
		return resolveKaspaTransactionPayload(
			params.rawTransaction,
			params.request,
		);
	}
	if (hasComposeInputs(params)) {
		const composeTool = KASPA_COMPOSE_TOOL;
		if (!composeTool) {
			throw new Error("kaspa_buildTransferTransaction tool unavailable");
		}
		const composeResult = await composeTool.execute("kaspa-workflow-compose", {
			network: params.network,
			fromAddress: params.fromAddress,
			toAddress: params.toAddress,
			amount: params.amount,
			outputs: params.outputs,
			utxos: params.utxos,
			feeRate: params.feeRate,
			dustLimit: params.dustLimit,
			changeAddress: params.changeAddress,
			lockTime: params.lockTime,
			requestMemo: params.requestMemo,
		});
		const composeDetails = composeResult.details as
			| { request?: Record<string, unknown> }
			| undefined;
		if (
			!composeDetails?.request ||
			typeof composeDetails.request !== "object"
		) {
			throw new Error(
				"Kaspa compose step failed to produce request in workflow",
			);
		}
		return resolveKaspaTransactionPayload(
			undefined,
			composeDetails.request as unknown,
		);
	}
	if (runMode === "execute" && priorSession) {
		return priorSession.request;
	}
	if (runMode === "execute") {
		throw new Error(
			"Kaspa workflow execute requires prior session or explicit request body",
		);
	}
	throw new Error(
		"Kaspa workflow requires either request/rawTransaction or compose inputs",
	);
}

function buildSummaryLine(params: {
	intentType: string;
	phase: KaspaWorkflowRunMode;
	status: string;
	network: string;
	runId: string;
	requestHash?: string;
}): string {
	const requestHash = params.requestHash
		? ` requestHash=${params.requestHash}`
		: "";
	return `Kaspa workflow ${params.phase} ${params.intentType} status=${params.status} network=${params.network} runId=${params.runId}${requestHash}`;
}

function extractTxIdFromSubmitResult(data: unknown): string | null {
	if (!data || typeof data !== "object") {
		return null;
	}
	const record = data as Record<string, unknown>;
	const candidate = record.txid ?? record.txId ?? record.transactionId ?? null;
	if (typeof candidate === "string") {
		return candidate;
	}
	return null;
}

export function createKaspaWorkflowTools() {
	return [
		defineTool({
			name: "w3rt_run_kaspa_workflow_v0",
			label: "Kaspa workflow",
			description:
				"Kaspa workflow runner with analysis -> simulate -> execute for Kaspa submit flows.",
			parameters: Type.Object({
				runId: Type.Optional(Type.String()),
				runMode: Type.Optional(
					Type.Union([
						Type.Literal("analysis"),
						Type.Literal("simulate"),
						Type.Literal("execute"),
					]),
				),
				network: kaspaNetworkSchema(),
				intentType: Type.Optional(Type.Literal("kaspa.transaction.submit")),
				intentText: Type.Optional(Type.String()),
				fromAddress: Type.Optional(Type.String()),
				toAddress: Type.Optional(Type.String()),
				amount: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				outputs: Type.Optional(Type.Array(Type.Unknown())),
				utxos: Type.Optional(Type.Array(Type.Unknown())),
				feeRate: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				dustLimit: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				changeAddress: Type.Optional(Type.String()),
				lockTime: Type.Optional(Type.Integer()),
				requestMemo: Type.Optional(Type.String()),
				rawTransaction: Type.Optional(Type.String()),
				request: Type.Optional(Type.Unknown()),
				confirmToken: Type.Optional(Type.String()),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				feeEndpoint: Type.Optional(Type.String()),
				mempoolEndpoint: Type.Optional(Type.String()),
				readStateEndpoint: Type.Optional(Type.String()),
				checkAcceptance: Type.Optional(Type.Boolean()),
				acceptanceEndpoint: Type.Optional(Type.String()),
				skipFeePreflight: Type.Optional(Type.Boolean()),
				skipMempoolPreflight: Type.Optional(Type.Boolean()),
				skipReadStatePreflight: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as WorkflowParams;
				const runMode = resolveWorkflowRunMode(
					params.runMode,
					params.intentText,
				);
				const priorSession =
					runMode === "execute" ? readWorkflowSession(params.runId) : null;
				const runId =
					params.runId?.trim() ||
					priorSession?.runId ||
					createKaspaWorkflowRunId();
				const network = parseKaspaNetwork(
					params.network || priorSession?.network,
				);
				const intentType = params.intentType || "kaspa.transaction.submit";
				const request = await resolveWorkflowSubmitRequest(
					params,
					priorSession,
					runMode,
				);

				if (runMode === "analysis" || runMode === "simulate") {
					const result = await submitKaspaTransaction({
						runMode: "analysis",
						rawTransaction: undefined,
						request,
						network,
						apiBaseUrl: params.apiBaseUrl,
						apiKey: params.apiKey,
						feeEndpoint: params.feeEndpoint,
						mempoolEndpoint: params.mempoolEndpoint,
						readStateEndpoint: params.readStateEndpoint,
						skipFeePreflight: params.skipFeePreflight,
						skipMempoolPreflight: params.skipMempoolPreflight,
						skipReadStatePreflight: params.skipReadStatePreflight,
					});
					const preflight = result.preflight;
					const status =
						preflight?.allOk && preflight.readiness === "ready"
							? "ready"
							: "precheck_warn";
					const summaryLine = buildSummaryLine({
						intentType,
						phase: runMode,
						status,
						network,
						runId,
						requestHash: result.requestHash,
					});
					rememberWorkflowSession({
						runId,
						network,
						request,
						requestHash: result.requestHash,
						confirmToken: result.confirmToken,
						createdAt: Date.now(),
					});
					return {
						content: [
							{
								type: "text",
								text:
									runMode === "analysis"
										? `Kaspa workflow analyzed: ${intentType} status=${status}`
										: `Kaspa workflow simulated: ${intentType} status=${status}`,
							},
						],
						details: {
							runId,
							runMode,
							network,
							intentType,
							confirmToken: result.confirmToken,
							needsMainnetConfirmation: network === "mainnet",
							request,
							requestHash: result.requestHash,
							artifacts: {
								[runMode]: {
									intentType,
									requestHash: result.requestHash,
									confirmToken: result.confirmToken,
									preflight,
									summaryLine,
									summary: {
										schema: "w3rt.workflow.summary.v1",
										phase: runMode,
										status,
										intentType,
										line: summaryLine,
									},
								},
							},
						},
					};
				}

				const effectiveSession = readWorkflowSession(runId);
				if (!effectiveSession || effectiveSession.runId !== runId) {
					throw new Error(
						"No prior workflow session found for execute. Run analysis/simulate first or pass request/rawTransaction.",
					);
				}
				const effectiveConfirmToken =
					params.confirmToken?.trim() || effectiveSession.confirmToken;
				if (!effectiveConfirmToken) {
					throw new Error(
						"Missing confirmToken for Kaspa execute. Run analysis/simulate first and pass confirmToken.",
					);
				}
				const executeResult = await submitKaspaTransaction({
					runMode: "execute",
					rawTransaction: undefined,
					request,
					network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
					confirmToken: effectiveConfirmToken,
					confirmMainnet: params.confirmMainnet,
					checkAcceptance: params.checkAcceptance,
					acceptanceEndpoint: params.acceptanceEndpoint,
					feeEndpoint: params.feeEndpoint,
					mempoolEndpoint: params.mempoolEndpoint,
					readStateEndpoint: params.readStateEndpoint,
					skipFeePreflight: params.skipFeePreflight,
					skipMempoolPreflight: params.skipMempoolPreflight,
					skipReadStatePreflight: params.skipReadStatePreflight,
				});
				const txId = extractTxIdFromSubmitResult(executeResult.data);
				const summaryLine = buildSummaryLine({
					intentType,
					phase: "execute",
					status: txId ? "submitted" : "completed",
					network,
					runId,
					requestHash: executeResult.requestHash,
				});
				rememberWorkflowSession({
					runId,
					network,
					request,
					requestHash: executeResult.requestHash,
					confirmToken: effectiveConfirmToken,
					createdAt: Date.now(),
				});
				return {
					content: [
						{ type: "text", text: `Kaspa workflow executed: ${intentType}` },
					],
					details: {
						runId,
						runMode,
						network,
						intentType,
						confirmToken: effectiveConfirmToken,
						needsMainnetConfirmation: network === "mainnet",
						request,
						requestHash: executeResult.requestHash,
						artifacts: {
							execute: {
								intentType,
								txId,
								requestHash: executeResult.requestHash,
								result: executeResult.data,
								receipt: executeResult.receipt,
								summaryLine,
								summary: {
									schema: "w3rt.workflow.summary.v1",
									phase: "execute",
									status: txId ? "submitted" : "completed",
									intentType,
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
