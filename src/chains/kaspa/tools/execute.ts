import { Type } from "@sinclair/typebox";
import { createHash, randomBytes } from "node:crypto";
import { defineTool } from "../../../core/types.js";
import {
	assertKaspaMainnetExecution,
	kaspaApiJsonGet,
	kaspaApiJsonPost,
	KASPA_TOOL_PREFIX,
	getKaspaApiBaseUrl,
	getKaspaApiKey,
	kaspaNetworkSchema,
	parseKaspaNetwork,
} from "../runtime.js";

type KaspaSubmitTransactionResponse = unknown;

const KASPA_SUBMIT_TOKEN_PREFIX = "kaspa-submit:v1:";
const KASPA_SUBMIT_CONFIRM_TTL_MS = 20 * 60 * 1000;
const KASPA_SUBMIT_PATH = "/transactions";
const KASPA_DEFAULT_FEES_ENDPOINT = "info/fee-estimate";
const KASPA_DEFAULT_MEMPOOL_ENDPOINT = "info/kaspad";
const KASPA_DEFAULT_READ_STATE_ENDPOINT = "info/blockdag";

type KaspaSubmitRunMode = "analysis" | "execute";
type KaspaSubmitPreflightCheckStatus = "ok" | "warning" | "failed";
type KaspaSubmitPreflightRisk = "low" | "medium" | "high";
type KaspaSubmitPreflightReadiness = "ready" | "needs-review";

type KaspaSubmitPrecheckResult = {
	allOk: boolean;
	riskLevel: KaspaSubmitPreflightRisk;
	readiness: KaspaSubmitPreflightReadiness;
	reports: Array<{
		label: string;
		path: string;
		status: KaspaSubmitPreflightCheckStatus;
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
	preflightAllOk: boolean;
	preflightSummary: string;
	preflightRiskLevel?: KaspaSubmitPreflightRisk;
	preflightReadiness?: KaspaSubmitPreflightReadiness;
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

function resolveKaspaTransactionSubmissionRequest(
	rawTransaction?: string,
	request?: unknown,
) {
	const requestBody =
		request === undefined
			? undefined
			: (() => {
					if (
						request == null ||
						typeof request !== "object" ||
						Array.isArray(request)
					) {
						throw new Error("request must be an object");
					}
					return request as Record<string, unknown>;
				})();
	const normalizedRawTransaction = parseKaspaTransactionPayload(rawTransaction);
	if (!requestBody && normalizedRawTransaction === undefined) {
		return undefined;
	}
	const body: Record<string, unknown> = requestBody
		? { ...requestBody }
		: {};
	if (rawTransaction?.trim()) {
		body.transaction = normalizedRawTransaction;
	} else if (!("transaction" in body) && "rawTransaction" in body) {
		body.transaction = body.rawTransaction;
	}
	if ("rawTransaction" in body) {
		delete body.rawTransaction;
	}
	if (!("transaction" in body)) {
		return undefined;
	}
	return body;
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
				`${JSON.stringify(key)}:${stableKaspaJson(
					(value as Record<string, unknown>)[key],
				)}`,
		)
		.join(",");
	return `{${sorted}}`;
}

function buildKaspaRequestFingerprint(payload: unknown): string {
	if (payload === undefined) return "empty";
	return createHash("sha256").update(stableKaspaJson(payload)).digest("hex");
}

function buildKaspaSubmitBodyFingerprintInput(body: unknown): unknown {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return body;
	}
	const record = body as Record<string, unknown>;
	if ("transaction" in record) {
		return { transaction: record.transaction };
	}
	return body;
}

function makeKaspaSubmitConfirmToken(
	network: string,
	body: unknown,
	preflight: KaspaSubmitPrecheckResult,
): string {
	const preflightReady = summarizeKaspaPrecheckReadiness(preflight);
	const payload: KaspaSubmitConfirmTokenPayload = {
		version: 1,
		kind: "kaspa-submit",
		network,
		bodyHash: buildKaspaRequestFingerprint(
			buildKaspaSubmitBodyFingerprintInput(body),
		),
		issuedAt: Date.now(),
		nonce: randomBytes(8).toString("hex"),
		preflightAllOk: preflight.allOk,
		preflightRiskLevel: preflight.riskLevel,
		preflightReadiness: preflightReady,
		preflightSummary: summarizeKaspaPrechecks(preflight),
	};
	return `${KASPA_SUBMIT_TOKEN_PREFIX}${Buffer.from(
		JSON.stringify(payload),
	).toString("base64url")}`;
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
		if (typeof parsed.preflightAllOk !== "boolean") return null;
		return parsed;
	} catch {
		return null;
	}
}

function assertKaspaSubmitConfirmToken(
	network: string,
	body: unknown,
	confirmToken?: string,
): KaspaSubmitConfirmTokenPayload {
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
	const currentBodyHash = buildKaspaRequestFingerprint(
		buildKaspaSubmitBodyFingerprintInput(body),
	);
	if (parsed.bodyHash !== currentBodyHash) {
		throw new Error(
			"confirmToken no longer matches this request body. Re-run analysis.",
		);
	}
	return parsed;
}

function normalizeKaspaSubmitPreflightRiskAndReadiness(payload: {
	preflightAllOk: boolean;
	preflightReadiness?: KaspaSubmitPreflightReadiness;
	preflightRiskLevel?: KaspaSubmitPreflightRisk;
}): { readiness: KaspaSubmitPreflightReadiness; riskLevel: KaspaSubmitPreflightRisk } {
	const riskLevel = [
		"low",
		"medium",
		"high",
	].includes(payload.preflightRiskLevel ?? "") ? payload.preflightRiskLevel : undefined;
	const readiness =
		payload.preflightReadiness === "ready" || payload.preflightReadiness === "needs-review"
			? payload.preflightReadiness
			: payload.preflightAllOk
				? "ready"
				: "needs-review";
	return {
		readiness,
		riskLevel:
			riskLevel ??
			(payload.preflightAllOk
				? "low"
				: "medium"),
	};
}

function normalizeKaspaSubmitEndpoint(path: string, method: "GET" | "POST"): string {
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
		return method === "POST" ? `/v1/${normalized}` : `/${normalized}`;
	}
	if (method === "POST") {
		return `/v1/rpc/${normalized}`;
	}
	return `/${normalized}`;
}

function makeKaspaSubmitReceiptTemplate(params: {
	network: string;
	apiBaseUrl: string;
	requestHash: string;
	broadcastStatus: "submitted" | "submitted-without-id" | "accepted-without-id";
	txId: string | null;
	confirmToken: string;
	preflightAllOk: boolean;
	preflightSummary: string;
	preflightRiskLevel: KaspaSubmitPreflightRisk;
	preflightReadiness: KaspaSubmitPreflightReadiness;
}): Record<string, unknown> {
	return {
		kind: "kaspa-submit-receipt",
		version: 1,
		network: params.network,
		apiBaseUrl: params.apiBaseUrl,
		executedAt: new Date().toISOString(),
		submitPath: KASPA_SUBMIT_PATH,
		broadcastStatus: params.broadcastStatus,
		requestHash: params.requestHash,
		txId: params.txId,
		confirmToken: params.confirmToken,
		preflightReady: params.preflightAllOk,
		preflightSummary: params.preflightSummary,
		preflightRiskLevel: params.preflightRiskLevel,
		preflightReadiness: params.preflightReadiness,
	};
}

function summarizeKaspaPrecheckReadiness(
	preflight: KaspaSubmitPrecheckResult,
): KaspaSubmitPreflightReadiness {
	return preflight.allOk ? preflight.readiness : "needs-review";
}

function summarizeKaspaPrechecks(preflight?: KaspaSubmitPrecheckResult): string {
	if (!preflight) {
		return "preflight=not-run";
	}
	const preflightReadiness =
		preflight.readiness ?? (preflight.allOk ? "ready" : "needs-review");
	if (!preflight.reports.length) {
		return `preflight=${preflightReadiness} risk=${preflight.riskLevel || "medium"} `;
	}
	return `${preflightReadiness} risk=${preflight.riskLevel || "medium"} ` + preflight.reports
		.map((report) => {
			const tail = report.error ? `: ${report.error}` : "";
			return `${report.label}=${report.status}${tail}`;
		})
		.join(" | ");
}

function resolveKaspaSubmitPreflightRisk(
	allOk: boolean,
	reports: Array<{ status: KaspaSubmitPreflightCheckStatus }>,
): KaspaSubmitPreflightRisk {
	const hasFailure = reports.some((report) => report.status === "failed");
	const hasWarning = reports.some((report) => report.status === "warning");
	if (hasFailure) return "high";
	if (hasWarning) return "medium";
	return allOk ? "low" : "medium";
}

async function runKaspaSubmitPreflightChecks(params: {
	network: string;
	apiBaseUrl: string;
	apiKey?: string;
	body: unknown;
	feeEndpoint?: string;
	mempoolEndpoint?: string;
	readStateEndpoint?: string;
	skipFeePreflight?: boolean;
	skipMempoolPreflight?: boolean;
	skipReadStatePreflight?: boolean;
}): Promise<KaspaSubmitPrecheckResult> {
	const checks: KaspaSubmitPrecheckResult = {
		allOk: true,
		riskLevel: "low",
		readiness: "ready",
		reports: [],
		checks: {
			feeEstimate: null,
			mempool: null,
			readState: null,
		},
	};
	const preflightChecks = [
		!params.skipFeePreflight && {
			key: "feeEstimate" as const,
			label: "feeEstimate",
			method: "GET" as const,
			path: normalizeKaspaSubmitEndpoint(
				params.feeEndpoint || KASPA_DEFAULT_FEES_ENDPOINT,
				"GET",
			),
		},
		!params.skipMempoolPreflight && {
			key: "mempool" as const,
			label: "mempool",
			method: "GET" as const,
			path: normalizeKaspaSubmitEndpoint(
				params.mempoolEndpoint || KASPA_DEFAULT_MEMPOOL_ENDPOINT,
				"GET",
			),
		},
		!params.skipReadStatePreflight && {
			key: "readState" as const,
			label: "readState",
			method: "GET" as const,
			path: normalizeKaspaSubmitEndpoint(
				params.readStateEndpoint || KASPA_DEFAULT_READ_STATE_ENDPOINT,
				"GET",
			),
		},
	].filter(
		(check): check is { key: keyof typeof checks.checks; label: string; method: "GET" | "POST"; path: string } =>
			check !== false,
	);

	for (const check of preflightChecks) {
		try {
			const data =
				check.method === "GET"
					? await kaspaApiJsonGet<unknown>({
							baseUrl: params.apiBaseUrl,
							path: check.path,
							apiKey: params.apiKey,
					  })
					: await kaspaApiJsonPost<unknown, unknown>({
							baseUrl: params.apiBaseUrl,
							path: check.path,
							body: params.body,
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
	checks.riskLevel = resolveKaspaSubmitPreflightRisk(checks.allOk, checks.reports);
	const hasWarnings = checks.reports.some((report) => report.status === "warning");
	checks.readiness = checks.allOk && !hasWarnings ? "ready" : "needs-review";

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
	skipFeePreflight?: boolean;
	skipMempoolPreflight?: boolean;
	skipReadStatePreflight?: boolean;
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
			skipFeePreflight: params.skipFeePreflight,
			skipMempoolPreflight: params.skipMempoolPreflight,
			skipReadStatePreflight: params.skipReadStatePreflight,
		});
		const confirmToken = preflight.allOk
			? makeKaspaSubmitConfirmToken(network, body, preflight)
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
	const parsedToken = assertKaspaSubmitConfirmToken(network, body, params.confirmToken);
	const data = await kaspaApiJsonPost<unknown, KaspaSubmitTransactionResponse>({
		baseUrl: apiBaseUrl,
		path: KASPA_SUBMIT_PATH,
		body,
		apiKey,
	});
	const txId = extractKaspaSubmitTransactionId(data);
	const parsedTokenRisk = normalizeKaspaSubmitPreflightRiskAndReadiness(parsedToken);
	const broadcastStatus = txId ? "submitted-without-id" : "accepted-without-id";
	const receiptTemplate = makeKaspaSubmitReceiptTemplate({
		network,
		apiBaseUrl,
		requestHash,
		txId,
		broadcastStatus,
		confirmToken: params.confirmToken ?? "none",
		preflightAllOk: parsedToken.preflightAllOk,
		preflightSummary: parsedToken.preflightSummary,
		preflightRiskLevel: parsedTokenRisk.riskLevel,
		preflightReadiness: parsedTokenRisk.readiness,
	});
	const detailsPreflight: KaspaSubmitPrecheckResult = {
		allOk: parsedToken.preflightAllOk,
		riskLevel: parsedTokenRisk.riskLevel,
		readiness: parsedTokenRisk.readiness,
		reports: [
			{
				label: "analysis",
				path: "confirmToken",
				status: parsedToken.preflightAllOk ? "ok" : "warning",
				data: parsedToken.preflightSummary,
			},
		],
		checks: {
			feeEstimate: null,
			mempool: null,
			readState: null,
		},
	};
	return {
		network,
		apiBaseUrl,
		body,
		mode: "execute",
		confirmToken: params.confirmToken,
		preflight: detailsPreflight,
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
				"Submit a pre-signed Kaspa transaction to API. Use runMode=analysis for preflight and confirmToken output.",
			parameters: Type.Object({
				rawTransaction: Type.Optional(
					Type.String({ minLength: 1, description: "Raw signed transaction payload" }),
				),
				request: Type.Optional(
					Type.Unknown({
						description:
							"Full request body used by Kaspa submit endpoint. Prefer { transaction, allowOrphan? }. Keep rawTransaction empty when provided in this field.",
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
				skipFeePreflight: Type.Optional(Type.Boolean()),
				skipMempoolPreflight: Type.Optional(Type.Boolean()),
				skipReadStatePreflight: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const result = await submitKaspaTransaction(params);
				if (result.mode === "analysis") {
					const ready = result.preflight?.readiness ?? "needs-review";
					const risk = result.preflight?.riskLevel ?? "medium";
					const tokenLine = result.confirmToken
						? ` confirmToken=${result.confirmToken}`
						: "";
					return {
						content: [
							{
								type: "text",
								text: `Kaspa submit analysis (${ready}, risk=${risk}) network=${result.network} requestHash=${result.requestHash ?? "n/a"} ${summarizeKaspaPrechecks(result.preflight)}${tokenLine}`,
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
							text: txId
								? `Kaspa transaction submitted. network=${result.network} txId=${txId} receipt=${summarizeKaspaSubmitResponse(result.data)}`
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
						preflight: result.preflight,
						response: result.data,
						receipt: result.receipt,
						preflightSummary: summarizeKaspaPrechecks(result.preflight),
					},
				};
			},
		}),
	];
}
