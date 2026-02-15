import { Type } from "@sinclair/typebox";
import { createHash, randomBytes } from "node:crypto";
import { defineTool } from "../../../core/types.js";
import {
	assertKaspaMainnetExecution,
	kaspaApiJsonPost,
	KASPA_TOOL_PREFIX,
	kaspaNetworkSchema,
	getKaspaApiBaseUrl,
	getKaspaApiKey,
	parseKaspaNetwork,
} from "../runtime.js";

type KaspaSubmitTransactionResponse = unknown;

const KASPA_SUBMIT_TOKEN_PREFIX = "kaspa-submit:v1:";
const KASPA_SUBMIT_CONFIRM_TTL_MS = 20 * 60 * 1000;
const KASPA_DEFAULT_FEES_ENDPOINT = "get-fee-estimate";
const KASPA_DEFAULT_MEMPOOL_ENDPOINT = "get-mempool-entries";
const KASPA_DEFAULT_READ_STATE_ENDPOINT = "read-state";

type KaspaSubmitRunMode = "analysis" | "execute";

type KaspaSubmitPrecheckResult = {
	allOk: boolean;
	reports: Array<{
		label: string;
		path: string;
		status: "ok" | "warning" | "failed";
		error?: string;
		data?: unknown;
	}>;
	checks: {
		feeEstimate: unknown | null;
		mempool: unknown | null;
		readState: unknown | null;
	};
};

type KaspaSubmitConfirmTokenPayload = {
	version: number;
	kind: "kaspa-submit";
	network: string;
	bodyHash: string;
	issuedAt: number;
	nonce: string;
};

export type KaspaSubmitTransactionResult = {
	network: string;
	apiBaseUrl: string;
	body: unknown;
	mode: KaspaSubmitRunMode;
	preflight?: KaspaSubmitPrecheckResult;
	confirmToken?: string;
	data?: KaspaSubmitTransactionResponse;
	requestHash?: string;
	receipt?: Record<string, unknown>;
};

function summarizeKaspaSubmitResponse(data: unknown): string {
	if (data == null) return "{}";
	if (typeof data === "string") {
		return data.trim() || "(empty)";
	}
	try {
		const json = JSON.stringify(data);
		const max = 1200;
		return json.length > max ? `${json.slice(0, max)}...` : json;
	} catch {
		return "(unserializable response)";
	}
}

function resolveKaspaTransactionSubmissionRequest(
	rawTransaction?: string,
	request?: unknown,
) {
	if (request !== undefined) {
		if (!rawTransaction) {
			return request;
		}
		if (
			request !== null &&
			typeof request === "object" &&
			!Array.isArray(request)
		) {
			return {
				...(request as Record<string, unknown>),
				rawTransaction,
			};
		}
		return { rawTransaction, request };
	}
	if (!rawTransaction) {
		return undefined;
	}
	return { rawTransaction };
}

function stableKaspaJson(value: unknown): string {
	if (value === null || value === undefined) {
		return "null";
	}
	if (typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableKaspaJson(entry)).join(",")}]`;
	}
	const sorted = Object.keys(value)
		.sort()
		.map(
			(key) =>
				`${JSON.stringify(key)}:${stableKaspaJson((value as Record<string, unknown>)[key])}`,
		)
		.join(",");
	return `{${sorted}}`;
}

function buildKaspaRequestFingerprint(payload: unknown): string {
	if (payload === undefined) return "empty";
	return createHash("sha256").update(stableKaspaJson(payload)).digest("hex");
}

function makeKaspaSubmitConfirmToken(
	network: string,
	body: unknown,
): string {
	const payload: KaspaSubmitConfirmTokenPayload = {
		version: 1,
		kind: "kaspa-submit",
		network,
		bodyHash: buildKaspaRequestFingerprint(body),
		issuedAt: Date.now(),
		nonce: randomBytes(8).toString("hex"),
	};
	return `${KASPA_SUBMIT_TOKEN_PREFIX}${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function parseKaspaSubmitConfirmToken(
	value: string | undefined,
): KaspaSubmitConfirmTokenPayload | null {
	if (!value?.startsWith(KASPA_SUBMIT_TOKEN_PREFIX)) return null;
	const encoded = value.slice(KASPA_SUBMIT_TOKEN_PREFIX.length);
	try {
		const parsed = JSON.parse(
			Buffer.from(encoded, "base64url").toString("utf8"),
		) as KaspaSubmitConfirmTokenPayload;
		if (parsed?.kind !== "kaspa-submit" || parsed.version !== 1) return null;
		if (typeof parsed.network !== "string") return null;
		if (typeof parsed.bodyHash !== "string") return null;
		if (typeof parsed.issuedAt !== "number") return null;
		return parsed;
	} catch {
		return null;
	}
}

function assertKaspaSubmitConfirmToken(
	network: string,
	body: unknown,
	confirmToken?: string,
) {
	if (!confirmToken) {
		throw new Error(
			"Run kaspa_submitTransaction in runMode=analysis first to obtain confirmToken.",
		);
	}
	const parsed = parseKaspaSubmitConfirmToken(confirmToken);
	if (!parsed) {
		throw new Error(
			"Invalid confirmToken for Kaspa submit. Re-run analysis and use the latest confirmToken.",
		);
	}
	if (parsed.network !== network) {
		throw new Error(`confirmToken network mismatch: expected=${network}`);
	}
	if (Date.now() - parsed.issuedAt > KASPA_SUBMIT_CONFIRM_TTL_MS) {
		throw new Error("confirmToken has expired. Re-run analysis.");
	}
	const currentBodyHash = buildKaspaRequestFingerprint(body);
	if (parsed.bodyHash !== currentBodyHash) {
		throw new Error(
			"confirmToken no longer matches this request body. Re-run analysis.",
		);
	}
}

function normalizeKaspaSubmitEndpoint(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) {
		throw new Error("rpcPath is required for preflight checks.");
	}
	if (/^https?:\/\//i.test(trimmed)) {
		throw new Error("rpcPath must be a relative API path.");
	}
	const normalized = trimmed.replace(/^\/+/, "");
	if (/^v1\//i.test(normalized)) {
		return `/${normalized}`;
	}
	if (/^rpc\//i.test(normalized)) {
		return `/v1/${normalized}`;
	}
	return `/v1/rpc/${normalized}`;
}

function makeKaspaSubmitReceiptTemplate(params: {
	network: string;
	apiBaseUrl: string;
	requestHash: string;
	txId: string | null;
	confirmToken: string;
	preflightAllOk: boolean;
}): Record<string, unknown> {
	return {
		network: params.network,
		apiBaseUrl: params.apiBaseUrl,
		executedAt: new Date().toISOString(),
		requestHash: params.requestHash,
		txId: params.txId,
		confirmToken: params.confirmToken,
		preflightReady: params.preflightAllOk,
	};
}

function summarizeKaspaPrechecks(
	preflight?: KaspaSubmitPrecheckResult,
): string {
	if (!preflight) {
		return "preflight=not-run";
	}
	if (!preflight.reports.length) {
		return "preflight=empty";
	}
	return preflight.reports
		.map((report) => {
			const tail = report.error ? `: ${report.error}` : "";
			return `${report.label}=${report.status}${tail}`;
		})
		.join(" | ");
}

async function runKaspaSubmitPreflightChecks(params: {
	network: string;
	apiBaseUrl: string;
	apiKey?: string;
	body: unknown;
	feeEndpoint?: string;
	mempoolEndpoint?: string;
	readStateEndpoint?: string;
}): Promise<KaspaSubmitPrecheckResult> {
	const checks: KaspaSubmitPrecheckResult = {
		allOk: true,
		reports: [],
		checks: {
			feeEstimate: null,
			mempool: null,
			readState: null,
		},
	};
	const preflightChecks = [
		{
			key: "feeEstimate" as const,
			label: "feeEstimate",
			path: normalizeKaspaSubmitEndpoint(
				params.feeEndpoint || KASPA_DEFAULT_FEES_ENDPOINT,
			),
		},
		{
			key: "mempool" as const,
			label: "mempool",
			path: normalizeKaspaSubmitEndpoint(
				params.mempoolEndpoint || KASPA_DEFAULT_MEMPOOL_ENDPOINT,
			),
		},
		{
			key: "readState" as const,
			label: "readState",
			path: normalizeKaspaSubmitEndpoint(
				params.readStateEndpoint || KASPA_DEFAULT_READ_STATE_ENDPOINT,
			),
		},
	];

	for (const check of preflightChecks) {
		const requestBody =
			typeof params.body === "object" && params.body !== null
				? { ...params.body, source: "preflight" }
				: { source: "preflight", request: params.body };
		try {
			const data = await kaspaApiJsonPost<unknown, unknown>({
				baseUrl: params.apiBaseUrl,
				path: check.path,
				body: requestBody,
				apiKey: params.apiKey,
			});
			checks.checks[check.key] = data;
			checks.reports.push({
				label: check.label,
				path: check.path,
				status: "ok",
				data,
			});
		} catch (error) {
			checks.allOk = false;
			const message = error instanceof Error ? error.message : `${error}`;
			checks.reports.push({
				label: check.label,
				path: check.path,
				status: "warning",
				error: message,
			});
		}
	}

	return checks;
}

function extractKaspaSubmitTransactionId(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	for (const key of ["txid", "txId", "transactionId", "hash", "id"]) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim()) {
			return candidate.trim();
		}
	}
	return null;
}

export async function submitKaspaTransaction(params: {
	rawTransaction?: string;
	request?: unknown;
	runMode?: KaspaSubmitRunMode;
	confirmToken?: string;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	confirmMainnet?: boolean;
	feeEndpoint?: string;
	mempoolEndpoint?: string;
	readStateEndpoint?: string;
}): Promise<KaspaSubmitTransactionResult> {
	const network = parseKaspaNetwork(params.network);
	const runMode: KaspaSubmitRunMode = params.runMode === "analysis" ? "analysis" : "execute";
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const body = resolveKaspaTransactionSubmissionRequest(
		params.rawTransaction?.trim(),
		params.request,
	);
	if (body === undefined) {
		throw new Error(
			"At least one of rawTransaction or request is required for Kaspa submit",
		);
	}
	const requestHash = buildKaspaRequestFingerprint(body);
	if (runMode === "analysis") {
		const preflight = await runKaspaSubmitPreflightChecks({
			network,
			apiBaseUrl,
			apiKey,
			body,
			feeEndpoint: params.feeEndpoint,
			mempoolEndpoint: params.mempoolEndpoint,
			readStateEndpoint: params.readStateEndpoint,
		});
		const confirmToken = preflight.allOk
			? makeKaspaSubmitConfirmToken(network, body)
			: undefined;
		return {
			network,
			apiBaseUrl,
			body,
			mode: "analysis",
			preflight,
			confirmToken,
			requestHash,
		};
	}

	assertKaspaMainnetExecution(network, params.confirmMainnet);
	if (runMode === "execute") {
		assertKaspaSubmitConfirmToken(network, body, params.confirmToken);
	}

	const data = await kaspaApiJsonPost<unknown, KaspaSubmitTransactionResponse>({
		baseUrl: apiBaseUrl,
		path: "/v1/rpc/submit-transaction",
		body,
		apiKey,
	});
	const preflightAllOk = Boolean(params.confirmToken);
	const txId = extractKaspaSubmitTransactionId(data);
	const receiptTemplate = makeKaspaSubmitReceiptTemplate({
		network,
		apiBaseUrl,
		requestHash,
		txId,
		confirmToken: params.confirmToken ?? "none",
		preflightAllOk,
	});
	return {
		network,
		apiBaseUrl,
		body,
		mode: "execute",
		confirmToken: params.confirmToken,
		data,
		requestHash,
		receipt: receiptTemplate,
	};
}

export function createKaspaExecuteTools() {
	return [
		defineTool({
			name: `${KASPA_TOOL_PREFIX}submitTransaction`,
			label: "Kaspa Submit Transaction",
			description:
				"Submit a pre-signed Kaspa transaction to RPC. Use runMode=analysis for preflight and confirmToken output.",
			parameters: Type.Object({
				rawTransaction: Type.Optional(
					Type.String({ minLength: 1, description: "Raw signed transaction payload" }),
				),
				request: Type.Optional(
					Type.Unknown({
						description:
							"Full request body used by Kaspa submit endpoint. Keep rawTransaction empty when provided in this field.",
					}),
				),
				runMode: Type.Optional(
					Type.Union([Type.Literal("analysis"), Type.Literal("execute")]),
				),
				confirmToken: Type.Optional(Type.String()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(
					Type.String({ description: "Override Kaspa API base URL" }),
				),
				apiKey: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				feeEndpoint: Type.Optional(Type.String()),
				mempoolEndpoint: Type.Optional(Type.String()),
				readStateEndpoint: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await submitKaspaTransaction(params);
				if (result.mode === "analysis") {
					const ready = result.preflight?.allOk ? "ready" : "needs-review";
					const tokenLine = result.confirmToken
						? ` confirmToken=${result.confirmToken}`
						: "";
					return {
						content: [
							{
								type: "text",
								text: `Kaspa submit analysis (${ready}) network=${result.network} requestHash=${result.requestHash ?? "n/a"} ${summarizeKaspaPrechecks(result.preflight)}${tokenLine}`,
							},
						],
						details: {
							schema: "kaspa.transaction.analysis.v1",
							network: result.network,
							apiBaseUrl: result.apiBaseUrl,
							request: result.body,
							requestHash: result.requestHash,
							preflight: result.preflight,
							confirmToken: result.confirmToken,
							preflightSummary: summarizeKaspaPrechecks(result.preflight),
						},
					};
				}
				const txId = result.data ? extractKaspaSubmitTransactionId(result.data) : null;
				return {
					content: [
						{
							type: "text",
							text:
								txId ?
									`Kaspa transaction submitted. network=${result.network} txId=${txId} receipt=${summarizeKaspaSubmitResponse(result.data)}`
								: `Kaspa transaction submitted. network=${result.network} response=${summarizeKaspaSubmitResponse(result.data)}`,
						},
					],
					details: {
						schema: "kaspa.transaction.submit.v1",
						network: result.network,
						apiBaseUrl: result.apiBaseUrl,
						txId,
						request: result.body,
						requestHash: result.requestHash,
						confirmToken: result.confirmToken,
						response: result.data,
						receipt: result.receipt,
					},
				};
			},
		}),
	];
}
