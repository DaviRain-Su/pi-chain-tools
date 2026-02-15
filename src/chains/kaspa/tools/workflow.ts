import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../core/types.js";
import { resolveWorkflowRunMode } from "../../shared/workflow-runtime.js";
import { kaspaNetworkSchema, parseKaspaNetwork } from "../runtime.js";
import { createKaspaComposeTools } from "./compose.js";
import { submitKaspaTransaction } from "./execute.js";
import { signKaspaSubmitRequestWithWallet } from "./sign.js";

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
	utxoSelectionStrategy?: "fifo" | "feeRate" | "feerate";
	utxoLimit?: number;
	strictAddressCheck?: boolean;
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
	pollAcceptance?: boolean;
	acceptancePollIntervalMs?: number;
	acceptancePollTimeoutMs?: number;
	skipFeePreflight?: boolean;
	skipMempoolPreflight?: boolean;
	skipReadStatePreflight?: boolean;
};

type KaspaTransferQuickParams = {
	runMode?: string;
	intentText?: string;
	network?: string;
	request?: unknown;
	fromAddress?: string;
	toAddress?: string;
	amount?: string | number;
	outputs?: unknown[];
	strictAddressCheck?: boolean;
	requestMemo?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	confirmMainnet?: boolean;
	checkAcceptance?: boolean;
	pollAcceptance?: boolean;
	acceptancePollIntervalMs?: number;
	acceptancePollTimeoutMs?: number;
	acceptanceEndpoint?: string;
	skipFeePreflight?: boolean;
	skipMempoolPreflight?: boolean;
	skipReadStatePreflight?: boolean;
	privateKey?: string;
	privateKeyEnv?: string;
	privateKeyFile?: string;
	privateKeyPath?: string;
	privateKeyPathEnv?: string;
	signatureEncoding?: string;
	replaceExistingSignatures?: boolean;
};

type KaspaTransferQuickIntent = {
	fromAddress?: string;
	toAddress?: string;
	amount?: string;
	network?: string;
};

type KaspaTransferQuickMinimalParams = {
	runMode?: string;
	intentText?: string;
	text?: string;
	network?: string;
	fromAddress?: string;
	toAddress?: string;
	amount?: string | number;
	requestMemo?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	confirmMainnet?: boolean;
	checkAcceptance?: boolean;
	pollAcceptance?: boolean;
	acceptancePollIntervalMs?: number;
	acceptancePollTimeoutMs?: number;
	acceptanceEndpoint?: string;
	privateKey?: string;
	privateKeyEnv?: string;
	privateKeyFile?: string;
	privateKeyPath?: string;
	privateKeyPathEnv?: string;
};

function normalizeKaspaTransferQuickMinimalInput(
	rawParams: unknown,
): KaspaTransferQuickMinimalParams {
	if (typeof rawParams === "string") {
		const trimmed = rawParams.trim();
		return trimmed
			? {
					intentText: trimmed,
				}
			: {};
	}
	if (
		!rawParams ||
		typeof rawParams !== "object" ||
		Array.isArray(rawParams)
	) {
		throw new Error(
			"w3rt_run_kaspa_send_v0 requires a natural language intent string or an object payload.",
		);
	}
	const params = rawParams as KaspaTransferQuickMinimalParams;
	const inlineText =
		typeof params.intentText === "string" ? params.intentText.trim() : undefined;
	const fallbackText =
		typeof params.text === "string" ? params.text.trim() : undefined;
	const normalizedIntent = inlineText || fallbackText;
	return {
		...params,
		intentText: normalizedIntent || params.intentText,
	};
}

type KaspaTransferQuickWorkflowResult = {
	content: Array<{ type: string; text: string }>;
	details: Record<string, unknown>;
};

const KASPA_TRANSFER_QUICK_DEFAULT_NETWORK = "testnet10";
const KASPA_TRANSFER_QUICK_ADDRESS_REGEX = /\bkaspa[a-z]*:[a-z0-9]+\b/gi;
const KASPA_TRANSFER_QUICK_AMOUNT_REGEX =
	/(?:\b(?:转|转账|send|to|转给)\b)\s*([0-9]+(?:\.[0-9]{1,8})?)/i;

function parseKaspaTransferIntentNetwork(input: string): string | undefined {
	if (/\b(?:mainnet|main\s+net|主网|主链|正式网)\b/i.test(input)) {
		return "mainnet";
	}
	if (/\b(?:testnet11|tn11|测试网11|测试链11)\b/i.test(input)) {
		return "testnet11";
	}
	if (/\b(?:testnet10|tn10|测试网10|测试链10)\b/i.test(input)) {
		return "testnet10";
	}
	if (/\b(?:testnet|测试网|测试链)\b/i.test(input)) {
		return "testnet10";
	}
	return undefined;
}

function parseKaspaTransferIntentText(
	intentText: string | undefined,
): KaspaTransferQuickIntent {
	if (!intentText?.trim()) {
		return {};
	}
	const input = intentText.trim();
	const fromMatch = /(?:从|from)\s*(kaspa[a-z]*:[a-z0-9]+)/i.exec(input);
	const toMatch = /(?:到|to)\s*(kaspa[a-z]*:[a-z0-9]+)/i.exec(input);
	const addresses = Array.from(input.matchAll(KASPA_TRANSFER_QUICK_ADDRESS_REGEX)).map(
		(match) => match[0].toLowerCase(),
	);
	const amountMatch = KASPA_TRANSFER_QUICK_AMOUNT_REGEX.exec(input);
	const network = parseKaspaTransferIntentNetwork(input);
	return {
		fromAddress:
			fromMatch?.[1]?.toLowerCase() ??
			addresses[0],
		toAddress:
			toMatch?.[1]?.toLowerCase() ?? (addresses[1] || undefined),
		amount: amountMatch?.[1] ?? undefined,
		network: network,
	};
}

function normalizeKaspaTransferRequestForSubmit(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Kaspa request must be an object.");
	}
	const request = value as Record<string, unknown>;
	if (!("rawTransaction" in request) && !("transaction" in request)) {
		throw new Error("Kaspa request must contain rawTransaction or transaction.");
	}
	return request;
}

function resolveKaspaTransferComposeRequest(details: unknown): Record<string, unknown> {
	if (!details || typeof details !== "object" || Array.isArray(details)) {
		throw new Error("Kaspa compose result has unexpected details payload.");
	}
	const raw = (details as Record<string, unknown>).request;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Kaspa compose result did not return request payload.");
	}
	if (
		!(typeof raw.rawTransaction === "string") &&
		!("transaction" in raw)
	) {
		throw new Error("Kaspa compose request is missing rawTransaction/transaction.");
	}
	return raw as Record<string, unknown>;
}

function isKaspaTransferRequestLikelySigned(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const transactionValue = record.transaction;
	if (hasKaspaSignatureInValue(transactionValue)) return true;
	const rawTransactionValue = record.rawTransaction;
	if (typeof rawTransactionValue === "string") {
		try {
			const parsed = JSON.parse(rawTransactionValue);
			if (hasKaspaSignatureInValue(parsed)) return true;
		} catch {
			// keep probing
		}
	}
	return hasKaspaSignatureInValue(record);
}

function hasKaspaSignatureInValue(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const signatureValue = record.signature ?? record.sig;
	if (typeof signatureValue === "string" && signatureValue.trim()) return true;
	const signatures = record.signatures;
	return (
		Array.isArray(signatures) &&
		signatures.some(
			(signature) =>
				typeof signature === "string" && signature.trim().length > 0,
		)
	);
}

async function resolveKaspaTransferQuickRequest(
	params: KaspaTransferQuickParams,
	network: string,
): Promise<{ request: Record<string, unknown>; source: "compose" | "provided" }> {
	if (params.request !== undefined) {
		return {
			request: normalizeKaspaTransferRequestForSubmit(params.request),
			source: "provided",
		};
	}
	const parsedIntent = parseKaspaTransferIntentText(params.intentText);
	const fromAddress = params.fromAddress?.trim() || parsedIntent.fromAddress;
	const toAddress = params.toAddress?.trim() || parsedIntent.toAddress;
	const amount = params.amount ?? parsedIntent.amount;
	const outputs = params.outputs;
	if (!fromAddress) {
		throw new Error(
			"Kaspa transfer requires fromAddress (or provide request directly).",
		);
	}
	if (!outputs || outputs.length === 0) {
		if (!toAddress || amount == null) {
			throw new Error(
				"Kaspa transfer requires toAddress+amount when outputs are not provided (or pass request directly).",
			);
		}
	}
	const composeResult = await KASPA_BUILD_FROM_ADDRESS_TOOL.execute(
		"w3rt-run-kaspa-transfer-build",
		{
			network,
			fromAddress,
			toAddress,
			amount,
			outputs,
			strictAddressCheck: params.strictAddressCheck,
			requestMemo: params.requestMemo,
		} as never,
	);
	return {
		request: resolveKaspaTransferComposeRequest(composeResult.details),
		source: "compose",
	};
}

async function resolveKaspaTransferQuickSignedRequest(
	params: KaspaTransferQuickParams,
	request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	if (isKaspaTransferRequestLikelySigned(request)) {
		return request;
	}
	const signed = await signKaspaSubmitRequestWithWallet({
		request,
		privateKey: params.privateKey,
		privateKeyEnv: params.privateKeyEnv,
		privateKeyFile: params.privateKeyFile,
		privateKeyPath: params.privateKeyPath,
		privateKeyPathEnv: params.privateKeyPathEnv,
		signerProvider: "auto",
		signatureEncoding: params.signatureEncoding,
		replaceExistingSignatures: params.replaceExistingSignatures,
	});
	return normalizeKaspaTransferRequestForSubmit(signed.request);
}

async function runKaspaTransferQuickWorkflow(
	params: KaspaTransferQuickParams,
): Promise<KaspaTransferQuickWorkflowResult> {
	const runMode = resolveWorkflowRunMode(
		params.runMode,
		params.intentText,
	);
	const parsedIntent = parseKaspaTransferIntentText(params.intentText);
	const network = resolveKaspaTransferQuickNetwork(
		params.network || parsedIntent.network,
	);
	const requestPack = await resolveKaspaTransferQuickRequest(
		{
			...params,
			amount: params.amount === undefined ? parsedIntent.amount : params.amount,
			toAddress: params.toAddress?.trim() || parsedIntent.toAddress,
			fromAddress: params.fromAddress?.trim() || parsedIntent.fromAddress,
		},
		network,
	);
	const submitRequest =
		runMode === "analysis" || runMode === "simulate"
			? requestPack.request
			: await resolveKaspaTransferQuickSignedRequest(params, requestPack.request);
	const analysis = await submitKaspaTransaction({
		runMode: "analysis",
		request: submitRequest,
		network,
		apiBaseUrl: params.apiBaseUrl,
		apiKey: params.apiKey,
		checkAcceptance: params.checkAcceptance,
		pollAcceptance: params.pollAcceptance,
		acceptancePollIntervalMs: params.acceptancePollIntervalMs,
		acceptancePollTimeoutMs: params.acceptancePollTimeoutMs,
		acceptanceEndpoint: params.acceptanceEndpoint,
		skipFeePreflight: params.skipFeePreflight,
		skipMempoolPreflight: params.skipMempoolPreflight,
		skipReadStatePreflight: params.skipReadStatePreflight,
	});
	if (runMode === "analysis" || runMode === "simulate") {
		return {
			content: [
				{
					type: "text",
					text: summarizeKaspaTransferQuickSummary({
						network,
						runMode: `analysis(${runMode})`,
						fromAddress: params.fromAddress || parsedIntent.fromAddress,
						toAddress: params.toAddress || parsedIntent.toAddress,
						amount: params.amount ?? parsedIntent.amount,
						requestSource: requestPack.source,
						requestHash: analysis.requestHash,
						confirmed: analysis.confirmToken != null,
					}),
				},
			],
			details: {
				schema: "kaspa.transfer.quick.workflow.v1",
				mode: runMode,
				network,
				requestSource: requestPack.source,
				request: submitRequest,
				requestHash: analysis.requestHash,
				preflight: analysis.preflight,
				confirmToken: analysis.confirmToken,
				preflightChecks: analysis.preflightChecks,
				preflightSummary:
					analysis.preflight && {
						allOk: analysis.preflight.allOk,
						riskLevel: analysis.preflight.riskLevel,
						readiness: analysis.preflight.readiness,
					},
				intent: {
					runMode,
					fromAddress: params.fromAddress || parsedIntent.fromAddress,
					toAddress: params.toAddress || parsedIntent.toAddress,
					amount: params.amount ?? parsedIntent.amount,
					intentText: params.intentText,
				},
				summary: summarizeKaspaTransferQuickSummary({
					network,
					runMode: `analysis(${runMode})`,
					fromAddress: params.fromAddress || parsedIntent.fromAddress,
					toAddress: params.toAddress || parsedIntent.toAddress,
					amount: params.amount ?? parsedIntent.amount,
					requestSource: requestPack.source,
					requestHash: analysis.requestHash,
					confirmed: analysis.confirmToken != null,
				}),
			},
		};
	}
	if (!analysis.confirmToken) {
		throw new Error(
			"Kaspa transfer quick execute is not ready for execution because preflight confirmToken was not generated. Retry in analysis mode first or relax risk requirements.",
		);
	}
	const executeResult = await submitKaspaTransaction({
		runMode: "execute",
		request: submitRequest,
		network,
		apiBaseUrl: params.apiBaseUrl,
		apiKey: params.apiKey,
		confirmToken: analysis.confirmToken,
		confirmMainnet: params.confirmMainnet,
		checkAcceptance: params.checkAcceptance,
		pollAcceptance: params.pollAcceptance,
		acceptancePollIntervalMs: params.acceptancePollIntervalMs,
		acceptancePollTimeoutMs: params.acceptancePollTimeoutMs,
		acceptanceEndpoint: params.acceptanceEndpoint,
		skipFeePreflight: params.skipFeePreflight,
		skipMempoolPreflight: params.skipMempoolPreflight,
		skipReadStatePreflight: params.skipReadStatePreflight,
	});
	const txId = extractTxIdFromSubmitResult(executeResult.data);
	return {
		content: [
			{
				type: "text",
				text: summarizeKaspaTransferQuickSummary({
					network,
					runMode: "execute",
					fromAddress: params.fromAddress || parsedIntent.fromAddress,
					toAddress: params.toAddress || parsedIntent.toAddress,
					amount: params.amount ?? parsedIntent.amount,
					requestSource: requestPack.source,
					requestHash: executeResult.requestHash,
					confirmed: true,
				}) + (txId ? ` txId=${txId}` : ""),
			},
		],
		details: {
			schema: "kaspa.transfer.quick.workflow.v1",
			mode: "execute",
			network,
			requestSource: requestPack.source,
			request: submitRequest,
			requestHash: executeResult.requestHash,
			confirmToken: analysis.confirmToken,
			execution: {
				txId,
				preflight: executeResult.preflight,
				response: executeResult.data,
				receipt: executeResult.receipt,
				acceptance: executeResult.acceptance,
				acceptanceChecked: executeResult.acceptanceChecked,
				acceptanceStatus: executeResult.acceptanceStatus,
				acceptanceCheckedAttempts: executeResult.acceptanceCheckedAttempts,
				acceptanceTimedOut: executeResult.acceptanceTimedOut,
				acceptancePath: executeResult.acceptancePath,
			},
		},
	};
}

function resolveKaspaTransferQuickNetwork(value?: string): string {
	return parseKaspaNetwork(value ?? KASPA_TRANSFER_QUICK_DEFAULT_NETWORK);
}

function summarizeKaspaTransferQuickSummary(params: {
	network: string;
	runMode: string;
	fromAddress?: string;
	toAddress?: string;
	amount?: string | number;
	requestSource: "compose" | "provided";
	requestHash?: string;
	confirmed: boolean;
}): string {
	const amount = params.amount ?? "unknown";
	const route = params.toAddress ? `to=${params.toAddress}` : "to=<custom-request>";
	const source = params.requestSource === "compose" ? "auto-compose" : "provided-request";
	const requestHash = params.requestHash ? ` requestHash=${params.requestHash}` : "";
	return `Kaspa transfer quick-${params.runMode} network=${params.network} from=${params.fromAddress} ${route} amount=${amount} source=${source} confirmed=${params.confirmed}${requestHash}`;
}
const KASPA_WORKFLOW_SESSIONS = new Map<string, KaspaWorkflowSession>();
let latestKaspaWorkflowSession: KaspaWorkflowSession | null = null;

const KASPA_COMPOSE_TOOLS = createKaspaComposeTools();
const KASPA_COMPOSE_TOOL = KASPA_COMPOSE_TOOLS.find(
	(tool) => tool.name === "kaspa_buildTransferTransaction",
);
if (!KASPA_COMPOSE_TOOL) {
	throw new Error(
		"kaspa_buildTransferTransaction tool is required for workflow compose path",
	);
}
const KASPA_BUILD_FROM_ADDRESS_TOOL = KASPA_COMPOSE_TOOLS.find(
	(tool) => tool.name === "kaspa_buildTransferTransactionFromAddress",
);

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

function hasAddressComposeInputs(params: WorkflowParams): boolean {
	if (!params.fromAddress?.trim()) {
		return false;
	}
	if (Array.isArray(params.utxos) && params.utxos.length > 0) {
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
	if (hasAddressComposeInputs(params)) {
		const composeTool = KASPA_BUILD_FROM_ADDRESS_TOOL;
		if (!composeTool) {
			throw new Error(
				"kaspa_buildTransferTransactionFromAddress tool unavailable",
			);
		}
		const composeResult = await composeTool.execute(
			"kaspa-workflow-compose-from-address",
			{
				network: params.network,
				fromAddress: params.fromAddress,
				toAddress: params.toAddress,
				amount: params.amount,
				outputs: params.outputs,
				utxoSelectionStrategy: params.utxoSelectionStrategy,
				utxoLimit: params.utxoLimit,
				feeRate: params.feeRate,
				dustLimit: params.dustLimit,
				changeAddress: params.changeAddress,
				lockTime: params.lockTime,
				requestMemo: params.requestMemo,
				apiBaseUrl: params.apiBaseUrl,
				apiKey: params.apiKey,
				strictAddressCheck: params.strictAddressCheck,
			},
		);
		const composeDetails = composeResult.details as
			| { request?: Record<string, unknown> }
			| undefined;
		if (
			!composeDetails?.request ||
			typeof composeDetails.request !== "object"
		) {
			throw new Error(
				"Kaspa compose-from-address step failed to produce request in workflow",
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
				utxoSelectionStrategy: Type.Optional(
					Type.Union([
						Type.Literal("fifo"),
						Type.Literal("feeRate"),
						Type.Literal("feerate"),
					]),
				),
				utxoLimit: Type.Optional(Type.Integer({ minimum: 1 })),
				strictAddressCheck: Type.Optional(Type.Boolean()),
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
				pollAcceptance: Type.Optional(
					Type.Boolean({
						description:
							"Poll acceptance endpoint until non-pending state or timeout.",
					}),
				),
				acceptancePollIntervalMs: Type.Optional(
					Type.Integer({
						minimum: 250,
						description: "Acceptance poll interval in ms.",
					}),
				),
				acceptancePollTimeoutMs: Type.Optional(
					Type.Integer({
						minimum: 1000,
						description: "Acceptance polling timeout in ms.",
					}),
				),
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
						checkAcceptance: params.checkAcceptance,
						pollAcceptance: params.pollAcceptance,
						acceptancePollIntervalMs: params.acceptancePollIntervalMs,
						acceptancePollTimeoutMs: params.acceptancePollTimeoutMs,
						acceptanceEndpoint: params.acceptanceEndpoint,
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
					pollAcceptance: params.pollAcceptance,
					acceptancePollIntervalMs: params.acceptancePollIntervalMs,
					acceptancePollTimeoutMs: params.acceptancePollTimeoutMs,
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
		defineTool({
			name: "w3rt_run_kaspa_send_v0",
			label: "Kaspa Send (natural)",
			description:
				"Minimal Kaspa transfer for natural language: `intentText` + optional runMode.",
			parameters: Type.Union([
				Type.Object({
					runMode: Type.Optional(
						Type.Union([
							Type.Literal("analysis"),
							Type.Literal("simulate"),
							Type.Literal("execute"),
						]),
					),
					intentText: Type.Optional(Type.String()),
					text: Type.Optional(Type.String()),
					network: kaspaNetworkSchema(),
					fromAddress: Type.Optional(Type.String()),
					toAddress: Type.Optional(Type.String()),
					amount: Type.Optional(Type.Union([Type.String(), Type.Number()])),
					requestMemo: Type.Optional(Type.String()),
					apiBaseUrl: Type.Optional(Type.String()),
					apiKey: Type.Optional(Type.String()),
					confirmMainnet: Type.Optional(Type.Boolean()),
					checkAcceptance: Type.Optional(Type.Boolean()),
					pollAcceptance: Type.Optional(
						Type.Boolean({
							description:
								"Poll acceptance endpoint until non-pending state or timeout.",
						}),
					),
					acceptancePollIntervalMs: Type.Optional(
						Type.Integer({
							minimum: 250,
							description: "Acceptance poll interval in ms.",
						}),
					),
					acceptancePollTimeoutMs: Type.Optional(
						Type.Integer({
							minimum: 1000,
							description: "Acceptance polling timeout in ms.",
						}),
					),
					acceptanceEndpoint: Type.Optional(Type.String()),
					privateKey: Type.Optional(Type.String()),
					privateKeyEnv: Type.Optional(
						Type.String({
							description:
								"Optional env var name for private key fallback (default: KASPA_PRIVATE_KEY).",
						}),
					),
					privateKeyFile: Type.Optional(
						Type.String({
							description:
								"Optional local file path containing private key content.",
						}),
					),
					privateKeyPath: Type.Optional(
						Type.String({
							description:
								"Alias for local file path containing private key content.",
						}),
					),
					privateKeyPathEnv: Type.Optional(
						Type.String({
							description:
								"Optional env var name for private key file path fallback (default: KASPA_PRIVATE_KEY_PATH).",
						}),
					),
				}),
				Type.String({ description: "Natural language intent sentence." }),
			]),
			async execute(_toolCallId, rawParams) {
				const params = normalizeKaspaTransferQuickMinimalInput(rawParams);
				return runKaspaTransferQuickWorkflow({
					runMode: params.runMode,
					intentText: params.intentText,
					network: params.network,
					fromAddress: params.fromAddress,
					toAddress: params.toAddress,
					amount: params.amount,
					requestMemo: params.requestMemo,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
					confirmMainnet: params.confirmMainnet,
					checkAcceptance: params.checkAcceptance,
					pollAcceptance: params.pollAcceptance,
					acceptancePollIntervalMs: params.acceptancePollIntervalMs,
					acceptancePollTimeoutMs: params.acceptancePollTimeoutMs,
					acceptanceEndpoint: params.acceptanceEndpoint,
					privateKey: params.privateKey,
					privateKeyEnv: params.privateKeyEnv,
					privateKeyFile: params.privateKeyFile,
					privateKeyPath: params.privateKeyPath,
					privateKeyPathEnv: params.privateKeyPathEnv,
				});
			},
		}),
		defineTool({
			name: "w3rt_run_kaspa_transfer_v0",
			label: "Kaspa Transfer (one-shot)",
			description:
				"One-shot Kaspa transfer with intent parsing, auto compose from sender address, optional wallet signing, then analysis or execute.",
			parameters: Type.Object({
				runMode: Type.Optional(
					Type.Union([
						Type.Literal("analysis"),
						Type.Literal("simulate"),
						Type.Literal("execute"),
					]),
				),
				intentText: Type.Optional(Type.String()),
				network: kaspaNetworkSchema(),
				request: Type.Optional(Type.Unknown()),
				fromAddress: Type.Optional(Type.String()),
				toAddress: Type.Optional(Type.String()),
				amount: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				outputs: Type.Optional(Type.Array(Type.Unknown())),
				strictAddressCheck: Type.Optional(Type.Boolean()),
				requestMemo: Type.Optional(Type.String()),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				checkAcceptance: Type.Optional(Type.Boolean()),
				pollAcceptance: Type.Optional(
					Type.Boolean({
						description:
							"Poll acceptance endpoint until non-pending state or timeout.",
					}),
				),
				acceptancePollIntervalMs: Type.Optional(
					Type.Integer({
						minimum: 250,
						description: "Acceptance poll interval in ms.",
					}),
				),
				acceptancePollTimeoutMs: Type.Optional(
					Type.Integer({
						minimum: 1000,
						description: "Acceptance polling timeout in ms.",
					}),
				),
				acceptanceEndpoint: Type.Optional(Type.String()),
				skipFeePreflight: Type.Optional(Type.Boolean()),
				skipMempoolPreflight: Type.Optional(Type.Boolean()),
				skipReadStatePreflight: Type.Optional(Type.Boolean()),
				privateKey: Type.Optional(Type.String()),
				privateKeyEnv: Type.Optional(Type.String()),
				privateKeyFile: Type.Optional(Type.String()),
				privateKeyPath: Type.Optional(Type.String()),
				privateKeyPathEnv: Type.Optional(Type.String()),
				signatureEncoding: Type.Optional(Type.String()),
				replaceExistingSignatures: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as KaspaTransferQuickParams;
				return runKaspaTransferQuickWorkflow(params);
			},
		}),
	];
}
