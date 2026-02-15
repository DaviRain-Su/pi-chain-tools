import { createHash, randomBytes } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	KASPA_TOOL_PREFIX,
	assertKaspaMainnetExecution,
	getKaspaApiBaseUrl,
	getKaspaApiKey,
	kaspaApiJsonGet,
	kaspaApiJsonPost,
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
const KASPA_DEFAULT_ACCEPTANCE_ENDPOINT = "transactions/acceptance";
const KASPA_SUBMIT_MEMPOOL_WARNING_THRESHOLD = 50000;
const KASPA_DEFAULT_ACCEPTANCE_POLL_INTERVAL_MS = 2_000;
const KASPA_DEFAULT_ACCEPTANCE_POLL_TIMEOUT_MS = 30_000;

type KaspaSubmitRunMode = "analysis" | "execute";
type KaspaSubmitPreflightCheckStatus = "ok" | "warning" | "failed";
type KaspaSubmitPreflightRisk = "low" | "medium" | "high";
type KaspaSubmitPreflightReadiness = "ready" | "needs-review";
type KaspaAcceptanceStatus = "accepted" | "pending" | "rejected" | "unknown";

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

type KaspaSubmitPreflightParams = {
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
	preflightChecks?: string[];
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
	acceptance?: unknown;
	acceptanceChecked?: boolean;
	acceptanceStatus?: KaspaAcceptanceStatus;
	acceptanceTimedOut?: boolean;
	acceptanceCheckedAttempts?: number;
	acceptancePath?: string;
	preflightChecks?: string[];
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

function parsedTokenSummaryChecks(checks: string[] | undefined): string {
	if (!checks || checks.length === 0) {
		return "preflightChecks=none";
	}
	return checks.join(" | ");
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

function parseKaspaReadableNumber(value: unknown): number | null {
	if (value == null) return null;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return null;
		return value;
	}
	if (typeof value === "bigint") {
		return Number(value);
	}
	if (typeof value === "string") {
		const normalized = value.trim();
		if (!normalized) return null;
		const parsed = Number.parseFloat(normalized);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function parseKaspaReadableBoolean(value: unknown): boolean | null {
	if (value == null) return null;
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true") return true;
		if (normalized === "false") return false;
	}
	return null;
}

function parseKaspaReadableString(value: unknown): string | null {
	if (typeof value === "string") {
		const normalized = value.trim();
		return normalized ? normalized : null;
	}
	return null;
}

function pickKaspaPreflightNumericField(
	record: Record<string, unknown>,
	candidates: string[],
): { key: string; value: number } | null {
	for (const key of candidates) {
		const parsed = parseKaspaReadableNumber(record[key]);
		if (parsed != null) {
			return { key, value: parsed };
		}
	}
	return null;
}

function pickKaspaPreflightStringField(
	record: Record<string, unknown>,
	candidates: string[],
): { key: string; value: string } | null {
	for (const key of candidates) {
		const parsed = parseKaspaReadableString(record[key]);
		if (parsed != null) {
			return { key, value: parsed };
		}
	}
	return null;
}

function summarizeKaspaSubmitPreflightCheck(params: {
	key: keyof KaspaSubmitPrecheckResult["checks"];
	path: string;
	data: unknown;
}): {
	label: string;
	path: string;
	status: KaspaSubmitPreflightCheckStatus;
	error?: string;
	data?: unknown;
} {
	if (!params.data || typeof params.data !== "object") {
		return {
			label: params.key,
			path: params.path,
			status: "warning",
			error: "Response is not an object; cannot parse health signal.",
			data: params.data,
		};
	}
	const record = params.data as Record<string, unknown>;
	if (params.key === "feeEstimate") {
		const minFee = pickKaspaPreflightNumericField(record, [
			"minFee",
			"minimumFee",
			"min_fee",
			"minimum_fee",
		]);
		const maxFee = pickKaspaPreflightNumericField(record, [
			"maxFee",
			"maximumFee",
			"max_fee",
			"maximum_fee",
		]);
		const feeUnit = pickKaspaPreflightStringField(record, ["unit", "feeUnit", "fee_unit"]);
		const summary = [
			feeUnit ? `unit=${feeUnit.value}` : "unit=n/a",
			minFee ? `min=${minFee.value}` : "min=n/a",
			maxFee ? `max=${maxFee.value}` : "max=n/a",
		].join(" ");
		if (!minFee && !maxFee) {
			return {
				label: "feeEstimate",
				path: params.path,
				status: "warning",
				error: "fee estimate response has no numeric minFee/maxFee hints.",
				data: summary,
			};
		}
		return {
			label: "feeEstimate",
			path: params.path,
			status: "ok",
			data: summary,
		};
	}
	if (params.key === "mempool") {
		const mempoolSize = pickKaspaPreflightNumericField(record, [
			"mempoolSize",
			"size",
			"txCount",
			"pendingTxs",
			"pending_txs",
		]);
		const summary = mempoolSize
			? `size=${mempoolSize.value}`
			: "size=n/a";
		if (mempoolSize && mempoolSize.value >= KASPA_SUBMIT_MEMPOOL_WARNING_THRESHOLD) {
			return {
				label: "mempool",
				path: params.path,
				status: "warning",
				error: `mempool size is high (>= ${KASPA_SUBMIT_MEMPOOL_WARNING_THRESHOLD}).`,
				data: summary,
			};
		}
		return {
			label: "mempool",
			path: params.path,
			status: "ok",
			data: summary,
		};
	}
	const chainState = pickKaspaPreflightStringField(record, [
		"chainState",
		"state",
		"status",
	]);
	const synced = parseKaspaReadableBoolean(record.isSynced ?? record.synced ?? record.ready);
	if (chainState?.value) {
		const normalizedState = chainState.value.toLowerCase();
		if (
			normalizedState.includes("sync") &&
			!normalizedState.includes("ready") &&
			!normalizedState.includes("synced")
		) {
			return {
				label: "readState",
				path: params.path,
				status: "warning",
				error: `chain state is not fully ready: ${chainState.value}.`,
				data: chainState.value,
			};
		}
	}
	if (synced === false) {
		return {
			label: "readState",
			path: params.path,
			status: "warning",
			error: "chainState indicates node is not synced.",
			data: chainState?.value ?? "synced=false",
		};
	}
	return {
		label: "readState",
		path: params.path,
		status: "ok",
		data: summarizeKaspaSubmitResponse(record),
	};
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
	const body: Record<string, unknown> = requestBody ? { ...requestBody } : {};
	if (rawTransaction?.trim()) {
		body.transaction = normalizedRawTransaction;
	} else if (!("transaction" in body) && "rawTransaction" in body) {
		body.transaction = body.rawTransaction;
	}
	if ("rawTransaction" in body) {
		body.rawTransaction = undefined;
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
		preflightChecks: preflight.reports.map(
			(report) =>
				`${report.label}=${report.status}${report.error ? ` (${report.error})` : ""}`,
		),
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
}): {
	readiness: KaspaSubmitPreflightReadiness;
	riskLevel: KaspaSubmitPreflightRisk;
} {
	const riskLevel = ["low", "medium", "high"].includes(
		payload.preflightRiskLevel ?? "",
	)
		? payload.preflightRiskLevel
		: undefined;
	const readiness =
		payload.preflightReadiness === "ready" ||
		payload.preflightReadiness === "needs-review"
			? payload.preflightReadiness
			: payload.preflightAllOk
				? "ready"
				: "needs-review";
	return {
		readiness,
		riskLevel: riskLevel ?? (payload.preflightAllOk ? "low" : "medium"),
	};
}

function extractKaspaSubmitTransactionStatus(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	for (const key of [
		"status",
		"result",
		"state",
		"acceptance",
		"error",
		"reason",
	]) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim()) {
			return candidate.trim().toLowerCase();
		}
	}
	return null;
}

function resolveKaspaSubmitBroadcastStatus(
	transactionId: string | null,
	submissionResponse: unknown,
): "submitted" | "submitted-without-id" | "accepted-without-id" {
	if (transactionId) {
		return "submitted";
	}
	const status = extractKaspaSubmitTransactionStatus(submissionResponse) ?? "";
	if (status.includes("accepted") || status.includes("success")) {
		return "accepted-without-id";
	}
	if (status.includes("pending") || status.includes("broadcast")) {
		return "submitted-without-id";
	}
	return "accepted-without-id";
}

function normalizeKaspaSubmitEndpoint(
	path: string,
	method: "GET" | "POST",
): string {
	const trimmed = path.trim();
	if (!trimmed) {
		throw new Error("rpcPath is required for preflight checks.");
	}
	if (/^https?:\/\//i.test(trimmed)) {
		throw new Error("rpcPath must be a relative API path.");
	}
	const normalized = trimmed.replace(/^\/+/, "");
	if (method === "POST" && /^v1\//i.test(normalized)) {
		return `/${normalized}`;
	}
	if (method === "POST" && /^rpc\//i.test(normalized)) {
		return `/${normalized}`;
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
	preflightChecks?: string[];
	acceptanceChecked?: boolean;
	acceptancePath?: string;
	acceptance?: unknown;
	acceptanceStatus?: KaspaAcceptanceStatus;
	acceptanceAttempts?: number;
	acceptanceTimedOut?: boolean;
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
		preflightChecks: params.preflightChecks,
		acceptanceChecked: Boolean(params.acceptanceChecked),
		acceptancePath: params.acceptancePath,
		acceptance: params.acceptance,
		acceptanceStatus: params.acceptanceStatus,
		acceptanceAttempts: params.acceptanceAttempts,
		acceptanceTimedOut: Boolean(params.acceptanceTimedOut),
	};
}

function summarizeKaspaPrecheckReadiness(
	preflight: KaspaSubmitPrecheckResult,
): KaspaSubmitPreflightReadiness {
	return preflight.allOk ? preflight.readiness : "needs-review";
}

function summarizeKaspaPrechecks(
	preflight?: KaspaSubmitPrecheckResult,
): string {
	if (!preflight) {
		return "preflight=not-run";
	}
	const preflightReadiness =
		preflight.readiness ?? (preflight.allOk ? "ready" : "needs-review");
	if (!preflight.reports.length) {
		return `preflight=${preflightReadiness} risk=${preflight.riskLevel || "medium"} `;
	}
	return `${preflightReadiness} risk=${preflight.riskLevel || "medium"} ${preflight.reports
		.map((report) => {
			const tail = report.error ? `: ${report.error}` : "";
			return `${report.label}=${report.status}${tail}`;
		})
		.join(" | ")}`;
}

function buildKaspaSubmitPreflightSummaryFromChecks(
	checks: string[] | undefined,
): string {
	if (!checks || !checks.length) {
		return "preflightChecks=none";
	}
	return checks.join(" | ");
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

async function runKaspaSubmitPreflightChecks(
	params: KaspaSubmitPreflightParams,
): Promise<KaspaSubmitPrecheckResult> {
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
	type KaspaSubmitPreflightCheckDefinition = {
		key: keyof typeof checks.checks;
		label: string;
		method: "GET";
		path: string;
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
		(check): check is KaspaSubmitPreflightCheckDefinition => check !== false,
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
			const report = summarizeKaspaSubmitPreflightCheck({
				key: check.key,
				path: check.path,
				data,
			});
			checks.reports.push(report);
			if (report.status !== "ok") {
				checks.allOk = false;
			}
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
	checks.riskLevel = resolveKaspaSubmitPreflightRisk(
		checks.allOk,
		checks.reports,
	);
	const hasWarnings = checks.reports.some(
		(report) => report.status === "warning",
	);
	checks.readiness = checks.allOk && !hasWarnings ? "ready" : "needs-review";

	return checks;
}

export async function checkKaspaSubmitReadiness(params: {
	rawTransaction?: string;
	request?: unknown;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	feeEndpoint?: string;
	mempoolEndpoint?: string;
	readStateEndpoint?: string;
	skipFeePreflight?: boolean;
	skipMempoolPreflight?: boolean;
	skipReadStatePreflight?: boolean;
}): Promise<{
	network: string;
	apiBaseUrl: string;
	body: unknown;
	requestHash: string;
	preflight: KaspaSubmitPrecheckResult;
}> {
	const network = parseKaspaNetwork(params.network);
	const resolvedApiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const resolvedApiKey = getKaspaApiKey(params.apiKey);
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
	const preflight = await runKaspaSubmitPreflightChecks({
		network,
		apiBaseUrl: resolvedApiBaseUrl,
		apiKey: resolvedApiKey,
		body,
		feeEndpoint: params.feeEndpoint,
		mempoolEndpoint: params.mempoolEndpoint,
		readStateEndpoint: params.readStateEndpoint,
		skipFeePreflight: params.skipFeePreflight,
		skipMempoolPreflight: params.skipMempoolPreflight,
		skipReadStatePreflight: params.skipReadStatePreflight,
	});
	return {
		network,
		apiBaseUrl: resolvedApiBaseUrl,
		body,
		requestHash,
		preflight,
	};
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function normalizeKaspaAcceptancePollingInterval(value?: number): number {
	if (value == null) {
		return KASPA_DEFAULT_ACCEPTANCE_POLL_INTERVAL_MS;
	}
	const normalized = Math.trunc(value);
	if (!Number.isFinite(normalized) || normalized < 250) {
		return KASPA_DEFAULT_ACCEPTANCE_POLL_INTERVAL_MS;
	}
	return normalized;
}

function normalizeKaspaAcceptancePollingTimeout(value?: number): number {
	if (value == null) {
		return KASPA_DEFAULT_ACCEPTANCE_POLL_TIMEOUT_MS;
	}
	const normalized = Math.trunc(value);
	if (!Number.isFinite(normalized) || normalized < 1000) {
		return KASPA_DEFAULT_ACCEPTANCE_POLL_TIMEOUT_MS;
	}
	return normalized;
}

function parseKaspaTransactionAcceptanceBoolean(value: unknown): boolean | null {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true" || normalized === "1" || normalized === "yes") {
			return true;
		}
		if (
			normalized === "false" ||
			normalized === "0" ||
			normalized === "no"
		) {
			return false;
		}
	}
	if (typeof value === "number") {
		if (value === 1) return true;
		if (value === 0) return false;
	}
	return null;
}

function parseKaspaTransactionAcceptanceId(
	record: Record<string, unknown>,
): string | null {
	const keys = ["txId", "txid", "transactionId", "hash", "id"];
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed) return trimmed;
		}
	}
	return null;
}

function parseKaspaAcceptanceNestedValue(
	value: unknown,
): { isAccepted: boolean | null; status: KaspaAcceptanceStatus } | null {
	if (value == null) return null;
	if (typeof value === "boolean") {
		return {
			isAccepted: value,
			status: value ? "accepted" : "rejected",
		};
	}
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized.includes("accept")) {
			return { isAccepted: true, status: "accepted" };
		}
		if (normalized.includes("reject") || normalized.includes("fail")) {
			return { isAccepted: false, status: "rejected" };
		}
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		const parsed =
			parseKaspaTransactionAcceptanceBoolean(record.accepted) ??
			parseKaspaTransactionAcceptanceBoolean(record.isAccepted);
		if (parsed !== null) {
			return {
				isAccepted: parsed,
				status: parsed ? "accepted" : "rejected",
			};
		}
	}
	return null;
}

function parseKaspaAcceptanceStatusFromCollection(
	candidate: unknown,
	txId: string,
	invert = false,
): { isAccepted: boolean | null; status: KaspaAcceptanceStatus } | null {
	if (!Array.isArray(candidate)) {
		return null;
	}
	for (const entry of candidate) {
		if (typeof entry === "string") {
			if (entry === txId) {
				if (invert) {
					return { isAccepted: false, status: "rejected" };
				}
				return { isAccepted: true, status: "accepted" };
			}
			continue;
		}
		if (!entry || typeof entry !== "object") continue;
		const record = entry as Record<string, unknown>;
		const entryTxId = parseKaspaTransactionAcceptanceId(record);
		if (!entryTxId || entryTxId !== txId) continue;
		const fromNested = parseKaspaAcceptanceNestedValue(record);
		if (fromNested) {
			if (invert) {
				const flipped = fromNested.isAccepted;
				const normalized = flipped === null ? null : !flipped;
				return {
					isAccepted: normalized,
					status:
						normalized === null
							? "unknown"
							: normalized
								? "accepted"
								: "rejected",
				};
			}
			return fromNested;
		}
	}
	return null;
}

function parseKaspaAcceptanceStatusFromRecord(
	record: Record<string, unknown>,
	txId: string,
): { isAccepted: boolean | null; status: KaspaAcceptanceStatus } {
	const directAccepted = parseKaspaTransactionAcceptanceBoolean(record.accepted);
	if (directAccepted !== null) {
		return {
			isAccepted: directAccepted,
			status: directAccepted ? "accepted" : "rejected",
		};
	}
	const statusValue = typeof record.status === "string" ? record.status.toLowerCase() : "";
	if (statusValue.includes("accept")) {
		return { isAccepted: true, status: "accepted" };
	}
	if (statusValue.includes("reject") || statusValue.includes("fail")) {
		return { isAccepted: false, status: "rejected" };
	}
	const nested = record[txId];
	if (nested !== undefined) {
		const result = parseKaspaAcceptanceNestedValue(nested);
		if (result) return result;
	}
	const collectionKeys = [
		{ key: "acceptedTransactions", invert: false },
		{ key: "acceptedTransactionIds", invert: false },
		{ key: "rejectedTransactions", invert: true },
		{ key: "rejectedTransactionIds", invert: true },
		"transactions",
		"results",
	];
	for (const key of collectionKeys) {
		const parsed =
			typeof key === "string"
				? parseKaspaAcceptanceStatusFromCollection(record[key], txId)
				: parseKaspaAcceptanceStatusFromCollection(
						record[key.key],
						txId,
						key.invert,
					);
		if (parsed) return parsed;
	}
	if (record.transactionId === txId) {
		const parsed = parseKaspaAcceptanceNestedValue(record);
		if (parsed) return parsed;
	}
	if (typeof record.id === "string" && record.id === txId) {
		const parsed = parseKaspaAcceptanceNestedValue(record);
		if (parsed) return parsed;
	}
	return { isAccepted: null, status: "pending" };
}

function parseKaspaAcceptanceStatus(
	txId: string,
	data: unknown,
): { isAccepted: boolean | null; status: KaspaAcceptanceStatus } {
	if (!data || typeof data !== "object") {
		return { isAccepted: null, status: "unknown" };
	}
	const record = data as Record<string, unknown>;
	return parseKaspaAcceptanceStatusFromRecord(record, txId);
}

type KaspaSubmitAcceptanceLookupResult = {
	path: string;
	data: unknown;
	isAccepted: boolean | null;
	status: KaspaAcceptanceStatus;
	attempts: number;
	elapsedMs: number;
	timedOut?: boolean;
};

async function pollKaspaSubmitAcceptanceLookup(params: {
	apiBaseUrl: string;
	apiKey?: string;
	acceptanceEndpoint?: string;
	txId: string;
	pollIntervalMs?: number;
	pollTimeoutMs?: number;
}): Promise<KaspaSubmitAcceptanceLookupResult> {
	const pollIntervalMs = normalizeKaspaAcceptancePollingInterval(
		params.pollIntervalMs,
	);
	const pollTimeoutMs = normalizeKaspaAcceptancePollingTimeout(
		params.pollTimeoutMs,
	);
	const start = Date.now();
	const results: KaspaSubmitAcceptanceLookupResult[] = [];
	while (true) {
		const response = await runKaspaSubmitAcceptanceLookup({
			apiBaseUrl: params.apiBaseUrl,
			apiKey: params.apiKey,
			acceptanceEndpoint: params.acceptanceEndpoint,
			txId: params.txId,
		});
		const parsed = response
			? {
				...parseKaspaAcceptanceStatus(params.txId, response.data),
				path: response.path,
				data: response.data,
			}
			: {
				isAccepted: null,
				status: "unknown" as KaspaAcceptanceStatus,
				path: "",
				data: null,
			};
		const elapsedMs = Date.now() - start;
		const item: KaspaSubmitAcceptanceLookupResult = {
			...parsed,
			attempts: results.length + 1,
			elapsedMs,
			timedOut: false,
		};
		results.push(item);
		if (parsed.status !== "pending" && parsed.status !== "unknown") {
			return item;
		}
		if (elapsedMs >= pollTimeoutMs) {
			return {
				...item,
				timedOut: true,
			};
		}
		await sleep(pollIntervalMs);
	}
}

async function runKaspaSubmitAcceptanceLookup(params: {
	apiBaseUrl: string;
	apiKey?: string;
	acceptanceEndpoint?: string;
	txId: string;
}): Promise<{ path: string; data: unknown } | null> {
	const rawPath = (
		params.acceptanceEndpoint || KASPA_DEFAULT_ACCEPTANCE_ENDPOINT
	).trim();
	if (!rawPath) {
		throw new Error("acceptanceEndpoint is required for acceptance lookup");
	}
	if (/^https?:\/\//i.test(rawPath)) {
		throw new Error("acceptanceEndpoint must be a relative API path");
	}
	const normalized = rawPath.replace(/^\/+/, "");
	const path = `/${normalized}`;
	try {
		const data = await kaspaApiJsonPost<{ transactionIds: string[] }, unknown>({
			baseUrl: params.apiBaseUrl,
			path,
			body: { transactionIds: [params.txId] },
			apiKey: params.apiKey,
		});
		return { path, data };
	} catch {
		return null;
	}
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
	checkAcceptance?: boolean;
	acceptanceEndpoint?: string;
	pollAcceptance?: boolean;
	acceptancePollIntervalMs?: number;
	acceptancePollTimeoutMs?: number;
	skipFeePreflight?: boolean;
	skipMempoolPreflight?: boolean;
	skipReadStatePreflight?: boolean;
}): Promise<KaspaSubmitTransactionResult> {
	const runMode: KaspaSubmitRunMode =
		params.runMode === "analysis" ? "analysis" : "execute";
	if (runMode === "analysis") {
		const readiness = await checkKaspaSubmitReadiness({
			rawTransaction: params.rawTransaction,
			request: params.request,
			network: params.network,
			apiBaseUrl: params.apiBaseUrl,
			apiKey: params.apiKey,
			feeEndpoint: params.feeEndpoint,
			mempoolEndpoint: params.mempoolEndpoint,
			readStateEndpoint: params.readStateEndpoint,
			skipFeePreflight: params.skipFeePreflight,
			skipMempoolPreflight: params.skipMempoolPreflight,
			skipReadStatePreflight: params.skipReadStatePreflight,
		});
		const network = readiness.network;
		const confirmToken = readiness.preflight.allOk
			? makeKaspaSubmitConfirmToken(
					network,
					readiness.body,
					readiness.preflight,
				)
			: undefined;
		return {
			network,
			apiBaseUrl: readiness.apiBaseUrl,
			body: readiness.body,
			mode: "analysis",
			preflight: readiness.preflight,
			confirmToken,
			requestHash: readiness.requestHash,
			preflightChecks: readiness.preflight.reports.map(
				(report) =>
					`${report.label}=${report.status}${report.error ? ` (${report.error})` : ""}`,
			),
		};
	}

	const network = parseKaspaNetwork(params.network);
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
	assertKaspaMainnetExecution(network, params.confirmMainnet);
	const parsedToken = assertKaspaSubmitConfirmToken(
		network,
		body,
		params.confirmToken,
	);
	const data = await kaspaApiJsonPost<unknown, KaspaSubmitTransactionResponse>({
		baseUrl: apiBaseUrl,
		path: KASPA_SUBMIT_PATH,
		body,
		apiKey,
	});
	const txId = extractKaspaSubmitTransactionId(data);
	const requestHash = buildKaspaRequestFingerprint(body);
	const broadcastStatus = resolveKaspaSubmitBroadcastStatus(txId, data);
	const acceptanceResult =
		params.checkAcceptance && txId
			? params.pollAcceptance
				? await pollKaspaSubmitAcceptanceLookup({
						apiBaseUrl,
						apiKey,
						acceptanceEndpoint: params.acceptanceEndpoint,
						txId,
						pollIntervalMs: params.acceptancePollIntervalMs,
						pollTimeoutMs: params.acceptancePollTimeoutMs,
					})
				: await runKaspaSubmitAcceptanceLookup({
						apiBaseUrl,
						apiKey,
						txId,
						acceptanceEndpoint: params.acceptanceEndpoint,
					}).then((result) =>
						result
							? {
									path: result.path,
									data: result.data,
									...parseKaspaAcceptanceStatus(txId, result.data),
									attempts: 1,
									elapsedMs: 0,
									timedOut: false,
								}
							: null,
					)
			: null;
	const parsedTokenRisk =
		normalizeKaspaSubmitPreflightRiskAndReadiness(parsedToken);
	const parsedTokenChecks = parsedToken.preflightChecks ?? [];
	const receiptTemplate = makeKaspaSubmitReceiptTemplate({
		network,
		apiBaseUrl,
		requestHash,
		txId,
		broadcastStatus,
		confirmToken: params.confirmToken ?? "none",
		preflightAllOk: parsedToken.preflightAllOk,
		preflightSummary: parsedToken.preflightSummary,
		preflightChecks: parsedTokenChecks,
		preflightRiskLevel: parsedTokenRisk.riskLevel,
		preflightReadiness: parsedTokenRisk.readiness,
		acceptanceChecked: acceptanceResult !== null,
		acceptancePath: acceptanceResult?.path,
		acceptance: acceptanceResult?.data,
		acceptanceStatus: acceptanceResult?.status,
		acceptanceAttempts: acceptanceResult?.attempts,
		acceptanceTimedOut: acceptanceResult?.timedOut,
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
				data: parsedTokenSummaryChecks(parsedTokenChecks),
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
		preflightChecks: parsedTokenChecks,
		data,
		requestHash,
		receipt: receiptTemplate,
		acceptance: acceptanceResult?.data,
		acceptanceChecked: acceptanceResult !== null,
		acceptancePath: acceptanceResult?.path,
		acceptanceStatus: acceptanceResult?.status,
		acceptanceTimedOut: acceptanceResult?.timedOut,
		acceptanceCheckedAttempts: acceptanceResult?.attempts,
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
					Type.String({
						minLength: 1,
						description: "Raw signed transaction payload",
					}),
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
				acceptanceEndpoint: Type.Optional(
					Type.String({
						description: "Optional acceptance endpoint override.",
					}),
				),
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
							preflightChecks: result.preflightChecks,
							preflightSummary: summarizeKaspaPrechecks(result.preflight),
						},
					};
				}
				const txId = result.data
					? extractKaspaSubmitTransactionId(result.data)
					: null;
				const acceptanceLine =
					result.acceptanceChecked === true
						? ` acceptanceChecked=true path=${result.acceptancePath ?? "unknown"} status=${result.acceptanceStatus ?? "unknown"}`
						: "";
				const acceptanceTimingLine =
					result.acceptanceChecked === true
						? ` attempts=${result.acceptanceCheckedAttempts ?? 0} timedOut=${result.acceptanceTimedOut ? "yes" : "no"}`
						: "";
					return {
						content: [
							{
								type: "text",
								text: txId
									? `Kaspa transaction submitted. network=${result.network} txId=${txId} receipt=${summarizeKaspaSubmitResponse(result.data)}${acceptanceLine}${acceptanceTimingLine}`
									: `Kaspa transaction submitted. network=${result.network} response=${summarizeKaspaSubmitResponse(result.data)}${acceptanceLine}${acceptanceTimingLine}`,
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
							preflightChecks: result.preflightChecks,
							response: result.data,
							receipt: result.receipt,
							acceptance: result.acceptance,
							acceptanceChecked: result.acceptanceChecked,
							acceptanceStatus: result.acceptanceStatus,
							acceptancePath: result.acceptancePath,
							acceptanceTimedOut: result.acceptanceTimedOut,
							acceptanceCheckedAttempts: result.acceptanceCheckedAttempts,
							preflightSummary: summarizeKaspaPrechecks(result.preflight),
						},
					};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}checkSubmitReadiness`,
			label: "Kaspa Submit Readiness Check",
			description:
				"Run Kaspa preflight checks (fee/mempool/read-state) for a submit payload before execution.",
			parameters: Type.Object({
				rawTransaction: Type.Optional(
					Type.String({
						minLength: 1,
						description: "Raw signed transaction payload",
					}),
				),
				request: Type.Optional(
					Type.Unknown({
						description:
							"Full request body used by Kaspa submit endpoint. Keep rawTransaction empty when provided in this field.",
					}),
				),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(
					Type.String({ description: "Override Kaspa API base URL" }),
				),
				apiKey: Type.Optional(Type.String()),
				feeEndpoint: Type.Optional(Type.String()),
				mempoolEndpoint: Type.Optional(Type.String()),
				readStateEndpoint: Type.Optional(Type.String()),
				skipFeePreflight: Type.Optional(Type.Boolean()),
				skipMempoolPreflight: Type.Optional(Type.Boolean()),
				skipReadStatePreflight: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const result = await checkKaspaSubmitReadiness({
					rawTransaction: params.rawTransaction,
					request: params.request,
					network: params.network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
					feeEndpoint: params.feeEndpoint,
					mempoolEndpoint: params.mempoolEndpoint,
					readStateEndpoint: params.readStateEndpoint,
					skipFeePreflight: params.skipFeePreflight,
					skipMempoolPreflight: params.skipMempoolPreflight,
					skipReadStatePreflight: params.skipReadStatePreflight,
				});
				const ready = result.preflight.readiness ?? "needs-review";
				const risk = result.preflight.riskLevel ?? "medium";
					return {
						content: [
							{
								type: "text",
								text: `Kaspa submit readiness (${ready}, risk=${risk}) network=${result.network} requestHash=${result.requestHash ?? "n/a"} ${summarizeKaspaPrechecks(result.preflight)}`,
							},
						],
						details: {
							schema: "kaspa.transaction.preflight.v1",
							network: result.network,
							apiBaseUrl: result.apiBaseUrl,
							request: result.body,
							requestHash: result.requestHash,
							preflight: result.preflight,
							preflightChecks: result.preflight.reports.map(
								(report) =>
									`${report.label}=${report.status}${report.error ? ` (${report.error})` : ""}`,
							),
							preflightSummary: summarizeKaspaPrechecks(result.preflight),
						},
					};
			},
		}),
	];
}
