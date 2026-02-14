import { createHash, randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	type RefPoolPairCandidate,
	fetchRefPoolById,
	findRefPoolForPair,
	getRefContractId,
	getRefSwapQuote,
	getRefTokenDecimalsHint,
	resolveRefTokenIds,
} from "../ref.js";
import {
	callNearRpc,
	nearNetworkSchema,
	parseNearNetwork,
	resolveNearAccountId,
	toYoctoNear,
} from "../runtime.js";
import { createNearComposeTools } from "./compose.js";
import { createNearExecuteTools } from "./execute.js";

type WorkflowRunMode = "analysis" | "compose" | "simulate" | "execute";

type NearTransferIntent = {
	type: "near.transfer.near";
	toAccountId: string;
	amountYoctoNear: string;
	fromAccountId?: string;
};

type NearFtTransferIntent = {
	type: "near.transfer.ft";
	toAccountId: string;
	ftContractId: string;
	amountRaw: string;
	fromAccountId?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearRefSwapIntent = {
	type: "near.swap.ref";
	tokenInId: string;
	tokenOutId: string;
	amountInRaw: string;
	amountInUi?: string;
	poolId?: number;
	slippageBps?: number;
	refContractId?: string;
	minAmountOutRaw?: string;
	fromAccountId?: string;
	autoRegisterOutput?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearIntentsSwapType =
	| "EXACT_INPUT"
	| "EXACT_OUTPUT"
	| "FLEX_INPUT"
	| "ANY_INPUT";
type NearIntentsTransferType = "ORIGIN_CHAIN" | "INTENTS";
type NearIntentsRecipientType = "DESTINATION_CHAIN" | "INTENTS";
type NearIntentsDepositMode = "SIMPLE" | "MEMO";

type NearIntentsSwapIntent = {
	type: "near.swap.intents";
	originAsset: string;
	destinationAsset: string;
	amount: string;
	accountId?: string;
	fromAccountId?: string;
	recipient?: string;
	refundTo?: string;
	swapType?: NearIntentsSwapType;
	slippageTolerance?: number;
	depositType?: NearIntentsTransferType;
	refundType?: NearIntentsTransferType;
	recipientType?: NearIntentsRecipientType;
	depositMode?: NearIntentsDepositMode;
	deadline?: string;
	quoteWaitingTimeMs?: number;
	blockchainHint?: string;
	depositAddress?: string;
	depositMemo?: string;
	apiBaseUrl?: string;
};

type NearRefAddLiquidityIntent = {
	type: "near.lp.ref.add";
	poolId?: number;
	amountARaw: string;
	amountBRaw: string;
	tokenAId?: string;
	tokenBId?: string;
	refContractId?: string;
	fromAccountId?: string;
	autoRegisterExchange?: boolean;
	autoRegisterTokens?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearRefRemoveLiquidityIntent = {
	type: "near.lp.ref.remove";
	poolId?: number;
	shares?: string;
	shareBps?: number;
	minAmountsRaw?: string[];
	minAmountARaw?: string;
	minAmountBRaw?: string;
	tokenAId?: string;
	tokenBId?: string;
	refContractId?: string;
	autoWithdraw?: boolean;
	autoRegisterReceiver?: boolean;
	fromAccountId?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearRefWithdrawIntent = {
	type: "near.ref.withdraw";
	tokenId: string;
	amountRaw?: string;
	withdrawAll?: boolean;
	refContractId?: string;
	autoRegisterReceiver?: boolean;
	fromAccountId?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearWorkflowIntent =
	| NearTransferIntent
	| NearFtTransferIntent
	| NearRefSwapIntent
	| NearIntentsSwapIntent
	| NearRefAddLiquidityIntent
	| NearRefRemoveLiquidityIntent
	| NearRefWithdrawIntent;

type WorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	intentType?: NearWorkflowIntent["type"];
	intentText?: string;
	network?: string;
	rpcUrl?: string;
	toAccountId?: string;
	fromAccountId?: string;
	amountNear?: string | number;
	amountYoctoNear?: string;
	ftContractId?: string;
	amountRaw?: string;
	amountInRaw?: string;
	amountIn?: string | number;
	tokenInId?: string;
	tokenOutId?: string;
	originAsset?: string;
	destinationAsset?: string;
	tokenAId?: string;
	tokenBId?: string;
	tokenId?: string;
	poolId?: number | string;
	poolCandidateIndex?: number | string;
	slippageBps?: number;
	refContractId?: string;
	minAmountOutRaw?: string;
	amountA?: string | number;
	amountB?: string | number;
	amountARaw?: string;
	amountBRaw?: string;
	shares?: string;
	shareBps?: number;
	sharePercent?: string | number;
	minAmountsRaw?: string[];
	minAmountARaw?: string;
	minAmountBRaw?: string;
	withdrawAll?: boolean;
	recipient?: string;
	refundTo?: string;
	swapType?: NearIntentsSwapType;
	slippageTolerance?: number;
	depositType?: NearIntentsTransferType;
	refundType?: NearIntentsTransferType;
	recipientType?: NearIntentsRecipientType;
	depositMode?: NearIntentsDepositMode;
	deadline?: string;
	quoteWaitingTimeMs?: number;
	blockchainHint?: string;
	depositAddress?: string;
	depositMemo?: string;
	txHash?: string;
	waitForFinalStatus?: boolean;
	statusPollIntervalMs?: number;
	statusTimeoutMs?: number;
	apiBaseUrl?: string;
	apiKey?: string;
	jwt?: string;
	autoRegisterOutput?: boolean;
	autoRegisterExchange?: boolean;
	autoRegisterTokens?: boolean;
	autoWithdraw?: boolean;
	autoRegisterReceiver?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	publicKey?: string;
	privateKey?: string;
};

type ParsedIntentHints = {
	intentType?: NearWorkflowIntent["type"];
	toAccountId?: string;
	amountNear?: string;
	ftContractId?: string;
	amountRaw?: string;
	amountInRaw?: string;
	amountInUi?: string;
	tokenInId?: string;
	tokenOutId?: string;
	originAsset?: string;
	destinationAsset?: string;
	tokenAId?: string;
	tokenBId?: string;
	tokenId?: string;
	amountAUi?: string;
	amountBUi?: string;
	amountARaw?: string;
	amountBRaw?: string;
	shares?: string;
	shareBps?: number;
	minAmountARaw?: string;
	minAmountBRaw?: string;
	poolId?: number;
	poolCandidateIndex?: number;
	slippageBps?: number;
	slippageTolerance?: number;
	refContractId?: string;
	recipient?: string;
	refundTo?: string;
	depositAddress?: string;
	depositMemo?: string;
	txHash?: string;
	waitForFinalStatus?: boolean;
	withdrawAll?: boolean;
	autoWithdraw?: boolean;
};

type NearAccountQueryResult = {
	amount: string;
	locked: string;
	block_hash: string;
	block_height: number;
};

type NearCallFunctionResult = {
	result: number[];
	logs: string[];
	block_height: number;
	block_hash: string;
};

type NearIntentsToken = {
	assetId: string;
	decimals: number;
	blockchain: string;
	symbol: string;
	price: number;
	priceUpdatedAt: string;
	contractAddress?: string;
};

type NearIntentsQuoteRequest = {
	dry: boolean;
	swapType: NearIntentsSwapType;
	slippageTolerance: number;
	originAsset: string;
	depositType: NearIntentsTransferType;
	destinationAsset: string;
	amount: string;
	refundTo: string;
	refundType: NearIntentsTransferType;
	recipient: string;
	recipientType: NearIntentsRecipientType;
	deadline: string;
	depositMode?: NearIntentsDepositMode;
	quoteWaitingTimeMs?: number;
};

type NearIntentsQuoteResponse = {
	correlationId: string;
	timestamp: string;
	signature: string;
	quoteRequest: NearIntentsQuoteRequest;
	quote: {
		depositAddress?: string;
		depositMemo?: string;
		amountIn: string;
		amountInFormatted: string;
		amountInUsd: string;
		minAmountIn: string;
		amountOut: string;
		amountOutFormatted: string;
		amountOutUsd: string;
		minAmountOut: string;
		deadline?: string;
		timeWhenInactive?: string;
		timeEstimate: number;
	};
};

type NearIntentsStatusResponse = {
	correlationId: string;
	status:
		| "KNOWN_DEPOSIT_TX"
		| "PENDING_DEPOSIT"
		| "INCOMPLETE_DEPOSIT"
		| "PROCESSING"
		| "SUCCESS"
		| "REFUNDED"
		| "FAILED";
	updatedAt: string;
	quoteResponse: NearIntentsQuoteResponse;
	swapDetails: {
		amountIn?: string;
		amountInFormatted?: string;
		amountOut?: string;
		amountOutFormatted?: string;
		refundedAmount?: string;
		refundedAmountFormatted?: string;
		refundReason?: string;
		depositedAmount?: string;
		depositedAmountFormatted?: string;
	};
};

type NearIntentsBadRequest = {
	message?: string;
	statusCode?: number;
	error?: string;
	timestamp?: string;
	path?: string;
};

type NearIntentsQueryParams = Record<string, string | undefined>;

type WorkflowSessionRecord = {
	runId: string;
	network: "mainnet" | "testnet";
	intent: NearWorkflowIntent;
	confirmToken: string | null;
	poolCandidates: RefPoolCandidateSummary[];
};

type RefPoolCandidateSummary = RefPoolPairCandidate;

type WorkflowTool = ReturnType<typeof createNearExecuteTools>[number];
type WorkflowComposeTool = ReturnType<typeof createNearComposeTools>[number];

const WORKFLOW_SESSION_BY_RUN_ID = new Map<string, WorkflowSessionRecord>();
let latestWorkflowSession: WorkflowSessionRecord | null = null;
const DEFAULT_NEAR_SWAP_MAX_SLIPPAGE_BPS = 1000;
const HARD_MAX_NEAR_SWAP_SLIPPAGE_BPS = 5000;
const DEFAULT_NEAR_INTENTS_API_BASE_URL = "https://1click.chaindefuser.com";
const DEFAULT_INTENTS_STATUS_POLL_INTERVAL_MS = 2_000;
const DEFAULT_INTENTS_STATUS_TIMEOUT_MS = 45_000;

function rememberWorkflowSession(record: WorkflowSessionRecord): void {
	WORKFLOW_SESSION_BY_RUN_ID.set(record.runId, record);
	latestWorkflowSession = record;
}

function readWorkflowSession(runId?: string): WorkflowSessionRecord | null {
	if (runId && WORKFLOW_SESSION_BY_RUN_ID.has(runId)) {
		return WORKFLOW_SESSION_BY_RUN_ID.get(runId) ?? null;
	}
	return latestWorkflowSession;
}

function parseRunMode(value?: string): WorkflowRunMode {
	if (
		value === "analysis" ||
		value === "compose" ||
		value === "simulate" ||
		value === "execute"
	) {
		return value;
	}
	return "analysis";
}

function parsePositiveBigInt(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	const parsed = BigInt(normalized);
	if (parsed <= 0n) {
		throw new Error(`${fieldName} must be greater than 0`);
	}
	return parsed;
}

function parseNonNegativeBigInt(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	return BigInt(normalized);
}

function normalizeAccountId(value: string, fieldName: string): string {
	const normalized = value.trim().replace(/^@/, "");
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

function createRunId(explicitRunId?: string): string {
	if (typeof explicitRunId === "string" && explicitRunId.trim()) {
		return explicitRunId.trim();
	}
	return `wf-near-${randomUUID().slice(0, 8)}`;
}

function createConfirmToken(params: {
	runId: string;
	network: string;
	intent: NearWorkflowIntent;
}): string {
	const digest = createHash("sha256")
		.update(params.runId)
		.update("|")
		.update(params.network)
		.update("|")
		.update(JSON.stringify(params.intent))
		.digest("hex")
		.slice(0, 10)
		.toUpperCase();
	return `NEAR-${digest}`;
}

function parseOptionalPoolId(
	value: number | string | undefined,
	fieldName: string,
): number | undefined {
	if (value == null) return undefined;
	if (typeof value === "string" && !value.trim()) return undefined;
	const normalized = typeof value === "number" ? value : Number(value.trim());
	if (
		!Number.isFinite(normalized) ||
		!Number.isInteger(normalized) ||
		normalized < 0
	) {
		throw new Error(`${fieldName} must be a non-negative integer`);
	}
	return normalized;
}

function parseOptionalPoolCandidateIndex(
	value: number | string | undefined,
	fieldName: string,
): number | undefined {
	if (value == null) return undefined;
	if (typeof value === "string" && !value.trim()) return undefined;
	const normalized = typeof value === "number" ? value : Number(value.trim());
	if (
		!Number.isFinite(normalized) ||
		!Number.isInteger(normalized) ||
		normalized <= 0
	) {
		throw new Error(`${fieldName} must be an integer >= 1`);
	}
	return normalized;
}

function parseOptionalSlippageBps(
	value: number | undefined,
	fieldName: string,
): number | undefined {
	if (value == null) return undefined;
	if (
		!Number.isFinite(value) ||
		value < 0 ||
		value > HARD_MAX_NEAR_SWAP_SLIPPAGE_BPS
	) {
		throw new Error(
			`${fieldName} must be between 0 and ${HARD_MAX_NEAR_SWAP_SLIPPAGE_BPS}`,
		);
	}
	const normalized = Math.floor(value);
	const limit = resolveNearSwapSlippageLimitBps();
	if (normalized > limit) {
		throw new Error(
			`${fieldName} ${normalized} exceeds configured safety limit (${limit}).`,
		);
	}
	return normalized;
}

function resolveNearSwapSlippageLimitBps(): number {
	const raw = process.env.NEAR_SWAP_MAX_SLIPPAGE_BPS?.trim();
	if (!raw) return DEFAULT_NEAR_SWAP_MAX_SLIPPAGE_BPS;
	if (!/^\d+$/.test(raw)) return DEFAULT_NEAR_SWAP_MAX_SLIPPAGE_BPS;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return DEFAULT_NEAR_SWAP_MAX_SLIPPAGE_BPS;
	return Math.max(
		0,
		Math.min(HARD_MAX_NEAR_SWAP_SLIPPAGE_BPS, Math.floor(parsed)),
	);
}

function resolveSafeMinAmountOutRaw(params: {
	requestedMinAmountOutRaw?: string;
	quoteAmountOutRaw: string;
	quoteMinAmountOutRaw: string;
}): string {
	const quoteAmountOutRaw = parsePositiveBigInt(
		params.quoteAmountOutRaw,
		"quote.amountOutRaw",
	);
	const quoteMinAmountOutRaw = parsePositiveBigInt(
		params.quoteMinAmountOutRaw,
		"quote.minAmountOutRaw",
	);
	if (quoteMinAmountOutRaw > quoteAmountOutRaw) {
		throw new Error(
			"Ref quote returned invalid minAmountOutRaw > amountOutRaw",
		);
	}
	if (
		typeof params.requestedMinAmountOutRaw === "string" &&
		params.requestedMinAmountOutRaw.trim()
	) {
		const requestedMinAmountOutRaw = parsePositiveBigInt(
			params.requestedMinAmountOutRaw,
			"minAmountOutRaw",
		);
		if (requestedMinAmountOutRaw < quoteMinAmountOutRaw) {
			throw new Error(
				`minAmountOutRaw is below safe minimum from quote (${quoteMinAmountOutRaw.toString()}).`,
			);
		}
		return requestedMinAmountOutRaw.toString();
	}
	return quoteMinAmountOutRaw.toString();
}

function parseOptionalShareBps(
	value: number | undefined,
	fieldName: string,
): number | undefined {
	if (value == null) return undefined;
	if (!Number.isFinite(value) || value <= 0 || value > 10_000) {
		throw new Error(`${fieldName} must be between 1 and 10000`);
	}
	return Math.floor(value);
}

function parseOptionalSharePercent(
	value: string | number | undefined,
	fieldName: string,
): number | undefined {
	if (value == null) return undefined;
	const normalized =
		typeof value === "number" ? value : Number(value.trim().replace("%", ""));
	if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 100) {
		throw new Error(`${fieldName} must be between 0 and 100`);
	}
	return Math.floor(normalized * 100);
}

function parseIntentsSlippageTolerance(value: number | undefined): number {
	if (value == null) return 100;
	if (!Number.isFinite(value) || value < 0 || value > 5_000) {
		throw new Error("slippageTolerance must be between 0 and 5000");
	}
	return Math.floor(value);
}

function parseIntentsQuoteWaitingTimeMs(
	value: number | undefined,
): number | undefined {
	if (value == null) return undefined;
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		throw new Error("quoteWaitingTimeMs must be an integer >= 0");
	}
	return value;
}

function parseIntentsDeadline(value: string | undefined): string {
	if (typeof value === "string" && value.trim()) {
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			throw new Error("deadline must be a valid ISO datetime string");
		}
		return parsed.toISOString();
	}
	const fallback = new Date(Date.now() + 20 * 60 * 1000);
	return fallback.toISOString();
}

function parseIntentsStatusPollIntervalMs(value: number | undefined): number {
	if (value == null) return DEFAULT_INTENTS_STATUS_POLL_INTERVAL_MS;
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new Error("statusPollIntervalMs must be an integer");
	}
	return Math.min(10_000, Math.max(500, value));
}

function parseIntentsStatusTimeoutMs(value: number | undefined): number {
	if (value == null) return DEFAULT_INTENTS_STATUS_TIMEOUT_MS;
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new Error("statusTimeoutMs must be an integer");
	}
	return Math.min(300_000, Math.max(3_000, value));
}

function shouldWaitForIntentsFinalStatus(
	value: boolean | undefined,
	hints: ParsedIntentHints,
): boolean {
	if (typeof value === "boolean") return value;
	if (hints.waitForFinalStatus === true) return true;
	return true;
}

function resolveNearIntentsApiBaseUrl(endpoint?: string): string {
	const explicit = endpoint?.trim();
	const fromEnv = process.env.NEAR_INTENTS_API_BASE_URL?.trim();
	const selected = explicit || fromEnv || DEFAULT_NEAR_INTENTS_API_BASE_URL;
	return selected.endsWith("/") ? selected.slice(0, -1) : selected;
}

function resolveNearIntentsHeaders(params: {
	apiKey?: string;
	jwt?: string;
}): Record<string, string> {
	const headers: Record<string, string> = {};
	const apiKey =
		params.apiKey?.trim() || process.env.NEAR_INTENTS_API_KEY?.trim();
	const jwt = params.jwt?.trim() || process.env.NEAR_INTENTS_JWT?.trim();
	if (apiKey) headers["x-api-key"] = apiKey;
	if (jwt) headers.Authorization = `Bearer ${jwt}`;
	return headers;
}

function buildNearIntentsUrl(params: {
	baseUrl: string;
	path: string;
	query?: NearIntentsQueryParams;
}): string {
	const url = new URL(params.path, `${params.baseUrl}/`);
	if (params.query) {
		for (const [key, value] of Object.entries(params.query)) {
			if (typeof value === "string" && value.trim()) {
				url.searchParams.set(key, value.trim());
			}
		}
	}
	return url.toString();
}

function resolveNearIntentsErrorMessage(
	payload: unknown,
	fallback: string,
): string {
	if (payload && typeof payload === "object") {
		const candidate = payload as NearIntentsBadRequest;
		if (typeof candidate.message === "string" && candidate.message.trim()) {
			return candidate.message.trim();
		}
		if (typeof candidate.error === "string" && candidate.error.trim()) {
			return candidate.error.trim();
		}
	}
	return fallback;
}

async function fetchNearIntentsJson<T>(params: {
	baseUrl: string;
	path: string;
	method: "GET" | "POST";
	query?: NearIntentsQueryParams;
	body?: Record<string, unknown>;
	headers?: Record<string, string>;
}): Promise<{
	url: string;
	status: number;
	payload: T;
}> {
	const url = buildNearIntentsUrl({
		baseUrl: params.baseUrl,
		path: params.path,
		query: params.query,
	});
	const response = await fetch(url, {
		method: params.method,
		headers: {
			accept: "application/json",
			...(params.body ? { "content-type": "application/json" } : {}),
			...(params.headers ?? {}),
		},
		body: params.body ? JSON.stringify(params.body) : undefined,
	});
	const raw = await response.text();
	let payload: unknown = null;
	if (raw.trim()) {
		try {
			payload = JSON.parse(raw) as unknown;
		} catch {
			payload = raw;
		}
	}
	if (!response.ok) {
		throw new Error(
			`NEAR Intents API ${params.method} ${params.path} failed (${response.status}): ${resolveNearIntentsErrorMessage(payload, response.statusText || "request failed")}`,
		);
	}
	return {
		url,
		status: response.status,
		payload: payload as T,
	};
}

function normalizeNearIntentsTokens(value: unknown): NearIntentsToken[] {
	if (!Array.isArray(value)) {
		throw new Error("NEAR Intents tokens response must be an array");
	}
	const normalized: NearIntentsToken[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as Partial<NearIntentsToken>;
		if (
			typeof candidate.assetId !== "string" ||
			typeof candidate.decimals !== "number" ||
			typeof candidate.blockchain !== "string" ||
			typeof candidate.symbol !== "string" ||
			typeof candidate.price !== "number" ||
			typeof candidate.priceUpdatedAt !== "string"
		) {
			continue;
		}
		normalized.push({
			assetId: candidate.assetId,
			decimals: Math.floor(candidate.decimals),
			blockchain: candidate.blockchain,
			symbol: candidate.symbol,
			price: candidate.price,
			priceUpdatedAt: candidate.priceUpdatedAt,
			contractAddress:
				typeof candidate.contractAddress === "string"
					? candidate.contractAddress
					: undefined,
		});
	}
	return normalized;
}

function resolveNearIntentsAssetId(params: {
	assetInput: string;
	tokens: NearIntentsToken[];
	preferredBlockchain?: string;
	fieldName: string;
}): string {
	const normalizedInput = params.assetInput.trim();
	if (!normalizedInput) {
		throw new Error(`${params.fieldName} is required`);
	}
	if (normalizedInput.includes(":")) {
		return normalizedInput;
	}
	const symbol = normalizedInput.toUpperCase();
	const bySymbol = params.tokens.filter(
		(token) => token.symbol.toUpperCase() === symbol,
	);
	if (bySymbol.length === 0) {
		throw new Error(
			`${params.fieldName} symbol '${normalizedInput}' is not supported by NEAR Intents`,
		);
	}
	const preferred = params.preferredBlockchain?.trim().toLowerCase() || "near";
	const onPreferred = bySymbol.filter(
		(token) => token.blockchain.toLowerCase() === preferred,
	);
	if (onPreferred.length === 1) {
		const selected = onPreferred[0];
		if (selected) return selected.assetId;
	}
	if (bySymbol.length === 1) {
		const selected = bySymbol[0];
		if (selected) return selected.assetId;
	}
	const choices = bySymbol
		.slice(0, 6)
		.map((token) => `${token.assetId} [${token.blockchain}]`)
		.join(", ");
	throw new Error(
		`${params.fieldName} symbol '${normalizedInput}' is ambiguous; provide explicit assetId. Candidates: ${choices}`,
	);
}

function resolveNearIntentsTokenByAssetId(
	assetId: string,
	tokens: NearIntentsToken[],
): NearIntentsToken | null {
	return tokens.find((token) => token.assetId === assetId) ?? null;
}

function normalizeTokenInput(value: string, fieldName: string): string {
	const normalized = value.trim().replace(/^@/, "");
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

function parseScaledDecimalToRaw(
	value: string,
	decimals: number,
	fieldName: string,
): string {
	const normalized = value.trim();
	if (!/^\d+(\.\d+)?$/.test(normalized)) {
		throw new Error(`${fieldName} must be a positive decimal number`);
	}
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
		throw new Error("token decimals are invalid");
	}
	const [wholePart, fractionPart = ""] = normalized.split(".");
	if (fractionPart.length > decimals) {
		throw new Error(`${fieldName} supports up to ${decimals} decimal places`);
	}
	const whole = BigInt(wholePart);
	const fraction = fractionPart.padEnd(decimals, "0");
	const fractionValue = fraction ? BigInt(fraction) : 0n;
	return (whole * 10n ** BigInt(decimals) + fractionValue).toString();
}

function parseRefLpAmountRaw(params: {
	valueRaw?: string;
	valueUi?: string | number;
	tokenInput?: string;
	network?: string;
	fieldRaw: string;
	fieldUi: string;
}): string {
	if (typeof params.valueRaw === "string" && params.valueRaw.trim()) {
		return parsePositiveBigInt(params.valueRaw, params.fieldRaw).toString();
	}
	if (params.valueUi == null) {
		const tokenHint =
			typeof params.tokenInput === "string" && params.tokenInput.trim()
				? ` for ${params.tokenInput.trim()}`
				: "";
		throw new Error(
			`Missing ${params.fieldRaw}. Provide ${params.fieldRaw} or ${params.fieldUi}${tokenHint}.`,
		);
	}
	const uiValue =
		typeof params.valueUi === "number"
			? params.valueUi.toString()
			: params.valueUi.trim();
	if (!uiValue) {
		throw new Error(
			`Missing ${params.fieldRaw}. Provide ${params.fieldRaw} or ${params.fieldUi}.`,
		);
	}
	if (!params.tokenInput || !params.tokenInput.trim()) {
		throw new Error(
			`${params.fieldUi} requires token id/symbol (${params.fieldRaw} can be used instead).`,
		);
	}
	const decimals = getRefTokenDecimalsHint({
		network: params.network,
		tokenIdOrSymbol: params.tokenInput,
	});
	if (decimals == null) {
		throw new Error(
			`Cannot infer decimals for ${params.tokenInput}. Provide ${params.fieldRaw}.`,
		);
	}
	const rawAmount = parseScaledDecimalToRaw(uiValue, decimals, params.fieldUi);
	return parsePositiveBigInt(rawAmount, params.fieldUi).toString();
}

const LP_TOKEN_AMOUNT_STOP_WORDS = new Set([
	"pool",
	"lp",
	"ref",
	"mainnet",
	"testnet",
	"slippage",
	"bps",
	"amount",
	"raw",
	"shares",
	"share",
	"mina",
	"minb",
	"tokena",
	"tokenb",
]);

type ParsedTokenAmountPair = {
	token: string;
	amount: string;
};

function collectTokenAmountPairs(intentText: string): ParsedTokenAmountPair[] {
	const candidates: ParsedTokenAmountPair[] = [];
	const addCandidate = (token: string, amount: string) => {
		const normalizedToken = token.trim().toLowerCase();
		if (!normalizedToken) return;
		if (LP_TOKEN_AMOUNT_STOP_WORDS.has(normalizedToken)) return;
		if (!/^\d+(\.\d+)?$/.test(amount.trim())) return;
		candidates.push({
			token: token.trim(),
			amount: amount.trim(),
		});
	};

	for (const match of intentText.matchAll(
		/(\d+(?:\.\d+)?)\s*([a-z][a-z0-9._-]*)/gi,
	)) {
		if (!match[1] || !match[2]) continue;
		addCandidate(match[2], match[1]);
	}
	for (const match of intentText.matchAll(
		/([a-z][a-z0-9._-]*)\s*(\d+(?:\.\d+)?)/gi,
	)) {
		if (!match[1] || !match[2]) continue;
		addCandidate(match[1], match[2]);
	}

	const deduped = new Map<string, ParsedTokenAmountPair>();
	for (const candidate of candidates) {
		const key = `${candidate.token.toLowerCase()}::${candidate.amount}`;
		if (!deduped.has(key)) {
			deduped.set(key, candidate);
		}
	}
	return [...deduped.values()];
}

function applyLpTokenAmountHints(params: {
	hints: ParsedIntentHints;
	tokenAmountPairs: ParsedTokenAmountPair[];
	likelyLpAdd: boolean;
}): void {
	const { hints, tokenAmountPairs, likelyLpAdd } = params;
	if (tokenAmountPairs.length === 0) return;

	if (
		likelyLpAdd &&
		(!hints.tokenAId || !hints.tokenBId) &&
		tokenAmountPairs.length >= 2
	) {
		if (!hints.tokenAId) hints.tokenAId = tokenAmountPairs[0]?.token;
		if (!hints.tokenBId) {
			const firstTokenLower = tokenAmountPairs[0]?.token.toLowerCase();
			const second = tokenAmountPairs.find(
				(entry) => entry.token.toLowerCase() !== firstTokenLower,
			);
			hints.tokenBId = second?.token ?? tokenAmountPairs[1]?.token;
		}
	}

	const amountByToken = new Map<string, string>();
	for (const pair of tokenAmountPairs) {
		const key = pair.token.toLowerCase();
		if (!amountByToken.has(key)) {
			amountByToken.set(key, pair.amount);
		}
	}
	if (hints.tokenAId && !hints.amountARaw && !hints.amountAUi) {
		const matched = amountByToken.get(hints.tokenAId.toLowerCase());
		if (matched) hints.amountAUi = matched;
	}
	if (hints.tokenBId && !hints.amountBRaw && !hints.amountBUi) {
		const matched = amountByToken.get(hints.tokenBId.toLowerCase());
		if (matched) hints.amountBUi = matched;
	}
}

function parseIntentHints(intentText?: string): ParsedIntentHints {
	if (!intentText || !intentText.trim()) return {};
	const text = intentText.trim();
	const lower = text.toLowerCase();
	const tokenAmountPairs = collectTokenAmountPairs(text);
	const toMatch = text.match(
		/(?:to|给|到)\s*([a-z0-9][a-z0-9._-]*(?:\.near)?)/i,
	);
	const nearAmountMatch = text.match(/(\d+(?:\.\d+)?)\s*near\b/i);
	const ftContractMatch = text.match(
		/(?:contract|合约|token)\s*[:：]?\s*([a-z0-9][a-z0-9._-]*(?:\.near)?)/i,
	);
	const rawAmountMatch = text.match(
		/(?:raw|amountRaw|数量|amount)\s*[:：]?\s*(\d+)/i,
	);
	const swapUiAmountMatch = text.match(
		/(?:swap|把|将)?\s*(\d+(?:\.\d+)?)\s*([a-z][a-z0-9._-]*)\s*(?:->|to|换成|换到|兑换为|兑换成)\s*([a-z][a-z0-9._-]*)/i,
	);
	const swapPairMatch = text.match(
		/([a-z0-9][a-z0-9._-]*\.near)\s*(?:->|to|换成|换到|兑换为|兑换成|到)\s*([a-z0-9][a-z0-9._-]*\.near)/i,
	);
	const swapSymbolPairMatch = text.match(
		/([a-z][a-z0-9._-]*)\s*(?:->|to|换成|换到|兑换为|兑换成)\s*([a-z][a-z0-9._-]*)/i,
	);
	const lpPairMatch = text.match(
		/([a-z][a-z0-9._-]*)\s*\/\s*([a-z][a-z0-9._-]*)/i,
	);
	const poolIdMatch = text.match(/(?:pool|池子|池)\s*[:：]?\s*(\d+)/i);
	const poolCandidateIndexMatch =
		text.match(
			/(?:第\s*(\d+)\s*个\s*(?:候选)?(?:池子|池|pool)|(?:候选|candidate)\s*(?:pool)?\s*#?\s*(\d+))/i,
		) ?? null;
	const slippageMatch = text.match(
		/(?:slippage|滑点)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:bps)?/i,
	);
	const intentsSlippageMatch = text.match(
		/(?:slippageTolerance|intents\s*slippage|intents滑点)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:bps)?/i,
	);
	const refContractMatch = text.match(
		/(?:ref\s*contract|ref合约|交易所合约)\s*[:：]?\s*([a-z0-9][a-z0-9._-]*(?:\.near)?)/i,
	);
	const recipientMatch = text.match(
		/(?:recipient|收款地址|收款人)\s*[:：]?\s*([a-z0-9._:-]{6,})/i,
	);
	const refundToMatch = text.match(
		/(?:refundto|refund_to|refund|退款地址)\s*[:：]?\s*([a-z0-9._:-]{6,})/i,
	);
	const depositAddressMatch = text.match(
		/(?:depositaddress|deposit address|入金地址)\s*[:：]?\s*([a-z0-9._:-]{6,})/i,
	);
	const depositMemoMatch = text.match(
		/(?:depositmemo|deposit memo|memo)\s*[:：]?\s*([a-z0-9._:-]{2,})/i,
	);
	const txHashMatch = text.match(
		/(?:txhash|tx hash|交易hash|交易哈希)\s*[:：]?\s*([a-z0-9._:-]{8,})/i,
	);
	const amountARawMatch = text.match(
		/(?:amounta[_\s-]*raw|amountaraw|rawa)\s*[:：]?\s*(\d+)/i,
	);
	const amountBRawMatch = text.match(
		/(?:amountb[_\s-]*raw|amountbraw|rawb)\s*[:：]?\s*(\d+)/i,
	);
	const amountAUiMatch = text.match(
		/(?:amounta|tokena|数量a|金额a)\s*[:：]?\s*(\d+(?:\.\d+)?)/i,
	);
	const amountBUiMatch = text.match(
		/(?:amountb|tokenb|数量b|金额b)\s*[:：]?\s*(\d+(?:\.\d+)?)/i,
	);
	const sharesMatch = text.match(
		/(?:shares?|lp\s*shares|份额)\s*[:：]?\s*(\d+)/i,
	);
	const sharePercentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/i);
	const minAmountARawMatch = text.match(
		/(?:minamounta[_\s-]*raw|minamountaraw|mina)\s*[:：]?\s*(\d+)/i,
	);
	const minAmountBRawMatch = text.match(
		/(?:minamountb[_\s-]*raw|minamountbraw|minb)\s*[:：]?\s*(\d+)/i,
	);
	const tokenAMatch = text.match(
		/(?:tokena|币a|代币a|token_a)\s*[:：]?\s*([a-z][a-z0-9._-]*)/i,
	);
	const tokenBMatch = text.match(
		/(?:tokenb|币b|代币b|token_b)\s*[:：]?\s*([a-z][a-z0-9._-]*)/i,
	);
	const tokenIdMatch = text.match(
		/(?:tokenid|token id|token|币种|代币)\s*[:：]?\s*([a-z][a-z0-9._-]*)/i,
	);
	const refWithdrawTokenBeforeActionMatch = text.match(
		/ref[^a-z0-9]*(?:里|中的)?\s*(?:把|将)?\s*([a-z][a-z0-9._-]*)\s*(?:全部|all|余额|balance)?\s*(?:提回|取回|提取|提现|withdraw|赎回)/i,
	);
	const refWithdrawTokenAfterActionMatch = text.match(
		/(?:提回|取回|提取|提现|withdraw|赎回)\s*(?:ref[^a-z0-9]*(?:里|中的)?)?\s*([a-z][a-z0-9._-]*)/i,
	);

	const likelyFt =
		(lower.includes("ft") ||
			lower.includes("token") ||
			lower.includes("代币") ||
			/\btransfer\b/.test(lower) ||
			/\bsend\b/.test(lower)) &&
		!lower.includes("swap") &&
		!lower.includes("兑换");
	const likelySwap =
		lower.includes("swap") ||
		lower.includes("兑换") ||
		lower.includes("换成") ||
		lower.includes("换到");
	const likelyIntents =
		lower.includes("intents") ||
		lower.includes("1click") ||
		lower.includes("defuse");
	const hasRefKeyword =
		lower.includes("ref") || lower.includes("rhea") || lower.includes("交易所");
	const hasWithdrawAction =
		lower.includes("withdraw") ||
		lower.includes("提回") ||
		lower.includes("取回") ||
		lower.includes("提取") ||
		lower.includes("提现") ||
		lower.includes("赎回");
	const likelyRefWithdraw = hasRefKeyword && hasWithdrawAction;
	const wantsWaitForFinalStatus =
		lower.includes("等待完成") ||
		lower.includes("等到完成") ||
		lower.includes("直到完成") ||
		lower.includes("跟踪状态") ||
		lower.includes("持续跟踪") ||
		lower.includes("wait for final") ||
		lower.includes("wait completion") ||
		lower.includes("track status");
	const hasLpKeyword =
		lower.includes("lp") ||
		lower.includes("liquidity") ||
		lower.includes("流动性");
	const likelyLpAdd =
		hasLpKeyword &&
		(lower.includes("add") ||
			lower.includes("provide") ||
			lower.includes("添加") ||
			lower.includes("增加"));
	const likelyLpRemove =
		hasLpKeyword &&
		(lower.includes("remove") ||
			lower.includes("withdraw") ||
			lower.includes("撤出") ||
			lower.includes("移除") ||
			lower.includes("减少"));
	const hasNearAmount = nearAmountMatch != null;

	const hints: ParsedIntentHints = {};
	if (toMatch?.[1]) hints.toAccountId = toMatch[1];
	if (nearAmountMatch?.[1]) hints.amountNear = nearAmountMatch[1];
	if (ftContractMatch?.[1]) hints.ftContractId = ftContractMatch[1];
	if (rawAmountMatch?.[1]) {
		hints.amountRaw = rawAmountMatch[1];
		hints.amountInRaw = rawAmountMatch[1];
	}
	if (swapUiAmountMatch?.[1]) hints.amountInUi = swapUiAmountMatch[1];
	if (swapUiAmountMatch?.[2]) hints.tokenInId = swapUiAmountMatch[2];
	if (swapUiAmountMatch?.[3]) hints.tokenOutId = swapUiAmountMatch[3];
	if (swapPairMatch?.[1]) hints.tokenInId = swapPairMatch[1];
	if (swapPairMatch?.[2]) hints.tokenOutId = swapPairMatch[2];
	if (!hints.tokenInId && swapSymbolPairMatch?.[1])
		hints.tokenInId = swapSymbolPairMatch[1];
	if (!hints.tokenOutId && swapSymbolPairMatch?.[2])
		hints.tokenOutId = swapSymbolPairMatch[2];
	if (!hints.originAsset && hints.tokenInId)
		hints.originAsset = hints.tokenInId;
	if (!hints.destinationAsset && hints.tokenOutId)
		hints.destinationAsset = hints.tokenOutId;
	if (lpPairMatch?.[1]) hints.tokenAId = lpPairMatch[1];
	if (lpPairMatch?.[2]) hints.tokenBId = lpPairMatch[2];
	if (tokenAMatch?.[1]) hints.tokenAId = tokenAMatch[1];
	if (tokenBMatch?.[1]) hints.tokenBId = tokenBMatch[1];
	if (tokenIdMatch?.[1]) hints.tokenId = tokenIdMatch[1];
	if (!hints.tokenId && refWithdrawTokenBeforeActionMatch?.[1]) {
		hints.tokenId = refWithdrawTokenBeforeActionMatch[1];
	}
	if (!hints.tokenId && refWithdrawTokenAfterActionMatch?.[1]) {
		hints.tokenId = refWithdrawTokenAfterActionMatch[1];
	}
	if (amountARawMatch?.[1]) hints.amountARaw = amountARawMatch[1];
	if (amountBRawMatch?.[1]) hints.amountBRaw = amountBRawMatch[1];
	if (!hints.amountARaw && amountAUiMatch?.[1])
		hints.amountAUi = amountAUiMatch[1];
	if (!hints.amountBRaw && amountBUiMatch?.[1])
		hints.amountBUi = amountBUiMatch[1];
	applyLpTokenAmountHints({
		hints,
		tokenAmountPairs,
		likelyLpAdd,
	});
	if (sharesMatch?.[1]) hints.shares = sharesMatch[1];
	if (
		likelyLpRemove &&
		!hints.shares &&
		sharePercentMatch?.[1] &&
		Number.isFinite(Number(sharePercentMatch[1]))
	) {
		const parsedPercent = Number(sharePercentMatch[1]);
		if (parsedPercent > 0 && parsedPercent <= 100) {
			hints.shareBps = Math.floor(parsedPercent * 100);
		}
	}
	if (likelyLpRemove && !hints.shares && !hints.shareBps) {
		if (lower.includes("half") || lower.includes("一半")) {
			hints.shareBps = 5000;
		} else if (
			lower.includes("all") ||
			lower.includes("全部") ||
			lower.includes("全部移除") ||
			lower.includes("全部撤出")
		) {
			hints.shareBps = 10_000;
		}
	}
	if (minAmountARawMatch?.[1]) hints.minAmountARaw = minAmountARawMatch[1];
	if (minAmountBRawMatch?.[1]) hints.minAmountBRaw = minAmountBRawMatch[1];
	if (poolIdMatch?.[1]) {
		const parsed = Number(poolIdMatch[1]);
		if (Number.isInteger(parsed) && parsed >= 0) {
			hints.poolId = parsed;
		}
	}
	if (poolCandidateIndexMatch) {
		const parsed = Number(
			poolCandidateIndexMatch[1] ?? poolCandidateIndexMatch[2],
		);
		if (Number.isInteger(parsed) && parsed >= 1) {
			hints.poolCandidateIndex = parsed;
		}
	}
	if (slippageMatch?.[1]) {
		const parsed = Number(slippageMatch[1]);
		if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 5000) {
			hints.slippageBps = Math.floor(parsed);
		}
	}
	if (intentsSlippageMatch?.[1]) {
		const parsed = Number(intentsSlippageMatch[1]);
		if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 5000) {
			hints.slippageTolerance = Math.floor(parsed);
		}
	}
	if (refContractMatch?.[1]) {
		hints.refContractId = refContractMatch[1];
	}
	if (recipientMatch?.[1]) hints.recipient = recipientMatch[1];
	if (refundToMatch?.[1]) hints.refundTo = refundToMatch[1];
	if (depositAddressMatch?.[1]) hints.depositAddress = depositAddressMatch[1];
	if (depositMemoMatch?.[1]) hints.depositMemo = depositMemoMatch[1];
	if (txHashMatch?.[1]) hints.txHash = txHashMatch[1];
	if (wantsWaitForFinalStatus) hints.waitForFinalStatus = true;
	if (
		lower.includes("全部") ||
		lower.includes("all") ||
		lower.includes("全部提回") ||
		lower.includes("全部取回")
	) {
		hints.withdrawAll = true;
	}
	if (
		likelyLpRemove &&
		(lower.includes("提回") ||
			lower.includes("提到钱包") ||
			lower.includes("转回钱包") ||
			lower.includes("auto withdraw") ||
			lower.includes("自动提现") ||
			lower.includes("自动提回"))
	) {
		hints.autoWithdraw = true;
	}

	if (
		likelyLpRemove &&
		(hints.poolId != null ||
			(typeof hints.shares === "string" && hints.shares.trim().length > 0) ||
			typeof hints.shareBps === "number")
	) {
		hints.intentType = "near.lp.ref.remove";
		return hints;
	}

	if (
		likelyLpAdd &&
		(hints.poolId != null ||
			typeof hints.amountARaw === "string" ||
			typeof hints.amountBRaw === "string" ||
			typeof hints.amountAUi === "string" ||
			typeof hints.amountBUi === "string")
	) {
		hints.intentType = "near.lp.ref.add";
		return hints;
	}

	if (
		likelyRefWithdraw &&
		!hasLpKeyword &&
		(hints.tokenId || hints.ftContractId)
	) {
		hints.intentType = "near.ref.withdraw";
		return hints;
	}

	if (
		hints.tokenInId &&
		hints.tokenOutId &&
		(likelySwap || hints.amountInRaw || hints.amountInUi)
	) {
		hints.intentType = likelyIntents ? "near.swap.intents" : "near.swap.ref";
		return hints;
	}

	if (
		hints.ftContractId ||
		(likelyFt && hints.amountRaw && hints.toAccountId)
	) {
		hints.intentType = "near.transfer.ft";
		return hints;
	}
	if (hasNearAmount && hints.toAccountId) {
		hints.intentType = "near.transfer.near";
		return hints;
	}
	return hints;
}

function inferIntentType(
	params: WorkflowParams,
	hints: ParsedIntentHints,
): NearWorkflowIntent["type"] {
	if (params.intentType === "near.lp.ref.add") return params.intentType;
	if (params.intentType === "near.lp.ref.remove") return params.intentType;
	if (params.intentType === "near.ref.withdraw") return params.intentType;
	if (params.intentType === "near.swap.intents") return params.intentType;
	if (params.intentType === "near.swap.ref") return params.intentType;
	if (params.intentType === "near.transfer.near") return params.intentType;
	if (params.intentType === "near.transfer.ft") return params.intentType;
	if (hints.intentType) return hints.intentType;
	if (params.poolId != null && params.shares) {
		return "near.lp.ref.remove";
	}
	if (params.poolId != null && params.shareBps != null) {
		return "near.lp.ref.remove";
	}
	if (params.poolId != null && params.sharePercent != null) {
		return "near.lp.ref.remove";
	}
	if (
		(params.shares || params.shareBps != null || params.sharePercent != null) &&
		((typeof params.tokenAId === "string" && params.tokenAId.trim()) ||
			(typeof params.tokenBId === "string" && params.tokenBId.trim()))
	) {
		return "near.lp.ref.remove";
	}
	if (
		params.poolId != null &&
		(params.amountARaw ||
			params.amountBRaw ||
			params.amountA != null ||
			params.amountB != null ||
			params.tokenAId ||
			params.tokenBId)
	) {
		return "near.lp.ref.add";
	}
	if (
		params.originAsset ||
		params.destinationAsset ||
		params.slippageTolerance != null ||
		params.swapType ||
		params.depositType ||
		params.refundType ||
		params.recipientType ||
		params.depositMode
	) {
		return "near.swap.intents";
	}
	if (
		params.tokenId ||
		(params.refContractId && params.withdrawAll != null && !params.toAccountId)
	) {
		return "near.ref.withdraw";
	}
	if (
		params.tokenInId ||
		params.tokenOutId ||
		params.amountInRaw ||
		params.poolId != null
	) {
		return "near.swap.ref";
	}
	if (params.ftContractId || (params.amountRaw && params.toAccountId)) {
		return "near.transfer.ft";
	}
	return "near.transfer.near";
}

function normalizeIntent(params: WorkflowParams): NearWorkflowIntent {
	const hints = parseIntentHints(params.intentText);
	const intentType = inferIntentType(params, hints);
	const fromAccountId =
		typeof params.fromAccountId === "string" && params.fromAccountId.trim()
			? normalizeAccountId(params.fromAccountId, "fromAccountId")
			: undefined;

	if (intentType === "near.transfer.near") {
		const toAccountId = normalizeAccountId(
			params.toAccountId ?? hints.toAccountId ?? "",
			"toAccountId",
		);
		let amountYoctoNear: bigint;
		if (
			typeof params.amountYoctoNear === "string" &&
			params.amountYoctoNear.trim()
		) {
			amountYoctoNear = parsePositiveBigInt(
				params.amountYoctoNear,
				"amountYoctoNear",
			);
		} else {
			const nearAmount = params.amountNear ?? hints.amountNear;
			if (nearAmount == null) {
				throw new Error(
					"Missing transfer amount. Provide amountNear or amountYoctoNear.",
				);
			}
			amountYoctoNear = toYoctoNear(nearAmount);
		}
		return {
			type: "near.transfer.near",
			toAccountId,
			amountYoctoNear: amountYoctoNear.toString(),
			fromAccountId,
		};
	}

	if (intentType === "near.lp.ref.add") {
		const poolId = parseOptionalPoolId(params.poolId ?? hints.poolId, "poolId");
		const tokenAInput = params.tokenAId ?? hints.tokenAId;
		const tokenBInput = params.tokenBId ?? hints.tokenBId;
		if (
			poolId == null &&
			(!(typeof tokenAInput === "string" && tokenAInput.trim()) ||
				!(typeof tokenBInput === "string" && tokenBInput.trim()))
		) {
			throw new Error(
				"near.lp.ref.add requires poolId, or both tokenAId/tokenBId for automatic pool selection",
			);
		}
		const amountARaw = parseRefLpAmountRaw({
			valueRaw: params.amountARaw ?? hints.amountARaw,
			valueUi: params.amountA ?? hints.amountAUi,
			tokenInput: tokenAInput,
			network: params.network,
			fieldRaw: "amountARaw",
			fieldUi: "amountA",
		});
		const amountBRaw = parseRefLpAmountRaw({
			valueRaw: params.amountBRaw ?? hints.amountBRaw,
			valueUi: params.amountB ?? hints.amountBUi,
			tokenInput: tokenBInput,
			network: params.network,
			fieldRaw: "amountBRaw",
			fieldUi: "amountB",
		});
		const refContractId =
			typeof params.refContractId === "string" && params.refContractId.trim()
				? normalizeAccountId(params.refContractId, "refContractId")
				: typeof hints.refContractId === "string" && hints.refContractId.trim()
					? normalizeAccountId(hints.refContractId, "refContractId")
					: undefined;
		return {
			type: "near.lp.ref.add",
			poolId,
			amountARaw,
			amountBRaw,
			tokenAId:
				typeof tokenAInput === "string" && tokenAInput.trim()
					? normalizeTokenInput(tokenAInput, "tokenAId")
					: undefined,
			tokenBId:
				typeof tokenBInput === "string" && tokenBInput.trim()
					? normalizeTokenInput(tokenBInput, "tokenBId")
					: undefined,
			refContractId,
			fromAccountId,
			autoRegisterExchange: params.autoRegisterExchange !== false,
			autoRegisterTokens: params.autoRegisterTokens !== false,
			gas:
				typeof params.gas === "string" && params.gas.trim()
					? params.gas.trim()
					: undefined,
			attachedDepositYoctoNear:
				typeof params.attachedDepositYoctoNear === "string" &&
				params.attachedDepositYoctoNear.trim()
					? params.attachedDepositYoctoNear.trim()
					: undefined,
		};
	}

	if (intentType === "near.lp.ref.remove") {
		const poolId = parseOptionalPoolId(params.poolId ?? hints.poolId, "poolId");
		const tokenAInput = params.tokenAId ?? hints.tokenAId;
		const tokenBInput = params.tokenBId ?? hints.tokenBId;
		if (
			poolId == null &&
			(!(typeof tokenAInput === "string" && tokenAInput.trim()) ||
				!(typeof tokenBInput === "string" && tokenBInput.trim()))
		) {
			throw new Error(
				"near.lp.ref.remove requires poolId, or both tokenAId/tokenBId for automatic pool selection",
			);
		}
		const sharesInput = params.shares ?? hints.shares;
		const shares =
			typeof sharesInput === "string" && sharesInput.trim()
				? parsePositiveBigInt(sharesInput, "shares").toString()
				: undefined;
		const shareBps =
			shares != null
				? undefined
				: (parseOptionalShareBps(params.shareBps, "shareBps") ??
					parseOptionalSharePercent(params.sharePercent, "sharePercent") ??
					hints.shareBps);
		if (shares == null && shareBps == null) {
			throw new Error(
				"near.lp.ref.remove requires shares, shareBps, or sharePercent",
			);
		}
		const minAmountsRaw =
			Array.isArray(params.minAmountsRaw) && params.minAmountsRaw.length > 0
				? params.minAmountsRaw.map((value, index) =>
						parseNonNegativeBigInt(value, `minAmountsRaw[${index}]`).toString(),
					)
				: undefined;
		const minAmountARaw =
			typeof params.minAmountARaw === "string" && params.minAmountARaw.trim()
				? parseNonNegativeBigInt(
						params.minAmountARaw,
						"minAmountARaw",
					).toString()
				: typeof hints.minAmountARaw === "string" && hints.minAmountARaw.trim()
					? parseNonNegativeBigInt(
							hints.minAmountARaw,
							"minAmountARaw",
						).toString()
					: undefined;
		const minAmountBRaw =
			typeof params.minAmountBRaw === "string" && params.minAmountBRaw.trim()
				? parseNonNegativeBigInt(
						params.minAmountBRaw,
						"minAmountBRaw",
					).toString()
				: typeof hints.minAmountBRaw === "string" && hints.minAmountBRaw.trim()
					? parseNonNegativeBigInt(
							hints.minAmountBRaw,
							"minAmountBRaw",
						).toString()
					: undefined;
		const refContractId =
			typeof params.refContractId === "string" && params.refContractId.trim()
				? normalizeAccountId(params.refContractId, "refContractId")
				: typeof hints.refContractId === "string" && hints.refContractId.trim()
					? normalizeAccountId(hints.refContractId, "refContractId")
					: undefined;
		return {
			type: "near.lp.ref.remove",
			poolId,
			shares,
			shareBps,
			minAmountsRaw,
			minAmountARaw,
			minAmountBRaw,
			tokenAId:
				typeof tokenAInput === "string" && tokenAInput.trim()
					? normalizeTokenInput(tokenAInput, "tokenAId")
					: undefined,
			tokenBId:
				typeof tokenBInput === "string" && tokenBInput.trim()
					? normalizeTokenInput(tokenBInput, "tokenBId")
					: undefined,
			refContractId,
			autoWithdraw: params.autoWithdraw ?? hints.autoWithdraw ?? false,
			autoRegisterReceiver: params.autoRegisterReceiver !== false,
			fromAccountId,
			gas:
				typeof params.gas === "string" && params.gas.trim()
					? params.gas.trim()
					: undefined,
			attachedDepositYoctoNear:
				typeof params.attachedDepositYoctoNear === "string" &&
				params.attachedDepositYoctoNear.trim()
					? params.attachedDepositYoctoNear.trim()
					: undefined,
		};
	}

	if (intentType === "near.ref.withdraw") {
		const tokenIdInput =
			params.tokenId ??
			hints.tokenId ??
			params.ftContractId ??
			hints.ftContractId;
		const tokenId = normalizeTokenInput(tokenIdInput ?? "", "tokenId");
		const amountRawInput =
			typeof params.amountRaw === "string" && params.amountRaw.trim()
				? params.amountRaw
				: typeof hints.amountRaw === "string" && hints.amountRaw.trim()
					? hints.amountRaw
					: undefined;
		const amountRaw =
			typeof amountRawInput === "string" && amountRawInput.trim()
				? parsePositiveBigInt(amountRawInput, "amountRaw").toString()
				: undefined;
		const withdrawAll =
			typeof params.withdrawAll === "boolean"
				? params.withdrawAll
				: typeof hints.withdrawAll === "boolean"
					? hints.withdrawAll
					: amountRaw == null;
		if (amountRaw == null && withdrawAll !== true) {
			throw new Error(
				"near.ref.withdraw requires amountRaw or withdrawAll=true",
			);
		}
		const refContractId =
			typeof params.refContractId === "string" && params.refContractId.trim()
				? normalizeAccountId(params.refContractId, "refContractId")
				: typeof hints.refContractId === "string" && hints.refContractId.trim()
					? normalizeAccountId(hints.refContractId, "refContractId")
					: undefined;
		return {
			type: "near.ref.withdraw",
			tokenId,
			amountRaw,
			withdrawAll,
			refContractId,
			autoRegisterReceiver: params.autoRegisterReceiver !== false,
			fromAccountId,
			gas:
				typeof params.gas === "string" && params.gas.trim()
					? params.gas.trim()
					: undefined,
			attachedDepositYoctoNear:
				typeof params.attachedDepositYoctoNear === "string" &&
				params.attachedDepositYoctoNear.trim()
					? params.attachedDepositYoctoNear.trim()
					: undefined,
		};
	}

	if (intentType === "near.swap.intents") {
		const originAsset = normalizeTokenInput(
			params.originAsset ??
				params.tokenInId ??
				hints.originAsset ??
				hints.tokenInId ??
				"",
			"originAsset",
		);
		const destinationAsset = normalizeTokenInput(
			params.destinationAsset ??
				params.tokenOutId ??
				hints.destinationAsset ??
				hints.tokenOutId ??
				"",
			"destinationAsset",
		);
		if (originAsset.toLowerCase() === destinationAsset.toLowerCase()) {
			throw new Error("originAsset and destinationAsset must be different");
		}
		const explicitRawAmount =
			params.amountRaw?.trim() ??
			params.amountInRaw?.trim() ??
			hints.amountRaw?.trim() ??
			hints.amountInRaw?.trim() ??
			"";
		const amount =
			explicitRawAmount ||
			(() => {
				const nearLikeOrigin =
					originAsset.toLowerCase() === "near" ||
					originAsset.toLowerCase() === "wnear" ||
					originAsset.toLowerCase().includes("wrap.near") ||
					originAsset.toLowerCase().includes("wrap.testnet");
				const nearAmountInput =
					typeof params.amountNear === "number" ||
					typeof params.amountNear === "string"
						? params.amountNear
						: typeof params.amountIn === "number" ||
								typeof params.amountIn === "string"
							? params.amountIn
							: typeof hints.amountInUi === "string"
								? hints.amountInUi
								: hints.amountNear;
				if (nearLikeOrigin && nearAmountInput != null) {
					return toYoctoNear(nearAmountInput).toString();
				}
				throw new Error(
					"amount is required for near.swap.intents (provide amountRaw/amountInRaw, or amountNear for NEAR/wNEAR origin asset).",
				);
			})();
		parsePositiveBigInt(amount, "amount");
		const recipient =
			typeof params.recipient === "string" && params.recipient.trim()
				? params.recipient.trim()
				: typeof hints.recipient === "string" && hints.recipient.trim()
					? hints.recipient.trim()
					: undefined;
		const refundTo =
			typeof params.refundTo === "string" && params.refundTo.trim()
				? params.refundTo.trim()
				: typeof hints.refundTo === "string" && hints.refundTo.trim()
					? hints.refundTo.trim()
					: undefined;
		const depositAddress =
			typeof params.depositAddress === "string" && params.depositAddress.trim()
				? params.depositAddress.trim()
				: typeof hints.depositAddress === "string" &&
						hints.depositAddress.trim()
					? hints.depositAddress.trim()
					: undefined;
		const depositMemo =
			typeof params.depositMemo === "string" && params.depositMemo.trim()
				? params.depositMemo.trim()
				: typeof hints.depositMemo === "string" && hints.depositMemo.trim()
					? hints.depositMemo.trim()
					: undefined;
		const blockchainHint =
			typeof params.blockchainHint === "string" && params.blockchainHint.trim()
				? params.blockchainHint.trim()
				: undefined;
		const apiBaseUrl =
			typeof params.apiBaseUrl === "string" && params.apiBaseUrl.trim()
				? params.apiBaseUrl.trim()
				: undefined;
		return {
			type: "near.swap.intents",
			originAsset,
			destinationAsset,
			amount,
			accountId: fromAccountId,
			fromAccountId,
			recipient,
			refundTo,
			swapType: params.swapType ?? "EXACT_INPUT",
			slippageTolerance: parseIntentsSlippageTolerance(
				params.slippageTolerance ?? hints.slippageTolerance,
			),
			depositType: params.depositType ?? "ORIGIN_CHAIN",
			refundType: params.refundType ?? "ORIGIN_CHAIN",
			recipientType: params.recipientType ?? "DESTINATION_CHAIN",
			depositMode: params.depositMode ?? "SIMPLE",
			deadline:
				typeof params.deadline === "string" && params.deadline.trim()
					? parseIntentsDeadline(params.deadline)
					: undefined,
			quoteWaitingTimeMs: parseIntentsQuoteWaitingTimeMs(
				params.quoteWaitingTimeMs,
			),
			blockchainHint,
			depositAddress,
			depositMemo,
			apiBaseUrl,
		};
	}

	if (intentType === "near.swap.ref") {
		const tokenInId = normalizeTokenInput(
			params.tokenInId ?? hints.tokenInId ?? "",
			"tokenInId",
		);
		const tokenOutId = normalizeTokenInput(
			params.tokenOutId ?? hints.tokenOutId ?? "",
			"tokenOutId",
		);
		if (tokenInId === tokenOutId) {
			throw new Error("tokenInId and tokenOutId must be different");
		}
		const explicitRawAmount =
			params.amountInRaw?.trim() ??
			params.amountRaw?.trim() ??
			hints.amountInRaw?.trim() ??
			hints.amountRaw?.trim() ??
			"";
		const amountInRaw =
			explicitRawAmount ||
			(() => {
				const explicitUiAmount =
					typeof params.amountIn === "number"
						? params.amountIn.toString()
						: typeof params.amountIn === "string"
							? params.amountIn.trim()
							: (hints.amountInUi?.trim() ?? "");
				if (!explicitUiAmount) {
					const nearAmountInput =
						typeof params.amountNear === "number" ||
						typeof params.amountNear === "string"
							? params.amountNear
							: hints.amountNear;
					const nearLikeToken =
						tokenInId.toLowerCase() === "near" ||
						tokenInId.toLowerCase() === "wnear" ||
						tokenInId.toLowerCase().includes("wrap.near") ||
						tokenInId.toLowerCase().includes("wrap.testnet");
					if (nearAmountInput != null && nearLikeToken) {
						return toYoctoNear(nearAmountInput).toString();
					}
					throw new Error(
						"amountInRaw is required for near.swap.ref (or provide decimal amount like '0.01 NEAR').",
					);
				}
				const decimals =
					getRefTokenDecimalsHint({
						network: params.network,
						tokenIdOrSymbol: tokenInId,
					}) ?? null;
				if (decimals == null) {
					throw new Error(
						`Cannot infer decimals for ${tokenInId}. Provide amountInRaw explicitly.`,
					);
				}
				return parseScaledDecimalToRaw(explicitUiAmount, decimals, "amountIn");
			})();
		parsePositiveBigInt(amountInRaw, "amountInRaw");
		const minAmountOutRaw =
			typeof params.minAmountOutRaw === "string" &&
			params.minAmountOutRaw.trim()
				? parsePositiveBigInt(
						params.minAmountOutRaw,
						"minAmountOutRaw",
					).toString()
				: undefined;
		const refContractId =
			typeof params.refContractId === "string" && params.refContractId.trim()
				? normalizeAccountId(params.refContractId, "refContractId")
				: typeof hints.refContractId === "string" && hints.refContractId.trim()
					? normalizeAccountId(hints.refContractId, "refContractId")
					: undefined;
		return {
			type: "near.swap.ref",
			tokenInId,
			tokenOutId,
			amountInRaw,
			poolId: parseOptionalPoolId(params.poolId ?? hints.poolId, "poolId"),
			slippageBps: parseOptionalSlippageBps(
				params.slippageBps ?? hints.slippageBps,
				"slippageBps",
			),
			refContractId,
			minAmountOutRaw,
			fromAccountId,
			autoRegisterOutput: params.autoRegisterOutput !== false,
			gas:
				typeof params.gas === "string" && params.gas.trim()
					? params.gas.trim()
					: undefined,
			attachedDepositYoctoNear:
				typeof params.attachedDepositYoctoNear === "string" &&
				params.attachedDepositYoctoNear.trim()
					? params.attachedDepositYoctoNear.trim()
					: undefined,
		};
	}

	const toAccountId = normalizeAccountId(
		params.toAccountId ?? hints.toAccountId ?? "",
		"toAccountId",
	);
	const ftContractId = normalizeAccountId(
		params.ftContractId ?? hints.ftContractId ?? "",
		"ftContractId",
	);
	const amountRaw = params.amountRaw ?? hints.amountRaw ?? "";
	parsePositiveBigInt(amountRaw, "amountRaw");
	return {
		type: "near.transfer.ft",
		toAccountId,
		ftContractId,
		amountRaw,
		fromAccountId,
		gas:
			typeof params.gas === "string" && params.gas.trim()
				? params.gas.trim()
				: undefined,
		attachedDepositYoctoNear:
			typeof params.attachedDepositYoctoNear === "string" &&
			params.attachedDepositYoctoNear.trim()
				? params.attachedDepositYoctoNear.trim()
				: undefined,
	};
}

function hasIntentInputs(params: WorkflowParams): boolean {
	if (params.intentType || params.intentText) return true;
	if (params.toAccountId || params.amountNear || params.amountYoctoNear)
		return true;
	if (params.ftContractId || params.amountRaw) return true;
	if (
		params.tokenInId ||
		params.tokenOutId ||
		params.originAsset ||
		params.destinationAsset ||
		params.tokenAId ||
		params.tokenBId ||
		params.tokenId ||
		params.amountInRaw ||
		params.amountARaw ||
		params.amountBRaw ||
		params.amountA != null ||
		params.amountB != null ||
		params.shares ||
		params.shareBps != null ||
		params.sharePercent != null ||
		params.amountIn != null ||
		params.withdrawAll != null ||
		params.swapType ||
		params.depositType ||
		params.refundType ||
		params.recipientType ||
		params.depositMode ||
		params.recipient ||
		params.refundTo
	) {
		return true;
	}
	if (
		params.poolId != null ||
		params.refContractId ||
		params.slippageTolerance != null ||
		params.deadline ||
		params.quoteWaitingTimeMs != null ||
		params.blockchainHint ||
		params.apiBaseUrl ||
		params.minAmountOutRaw ||
		(Array.isArray(params.minAmountsRaw) && params.minAmountsRaw.length > 0) ||
		params.minAmountARaw ||
		params.minAmountBRaw ||
		params.autoWithdraw != null ||
		params.autoRegisterReceiver != null ||
		params.autoRegisterOutput != null
	) {
		return true;
	}
	return false;
}

function hasCoreIntentInputs(params: WorkflowParams): boolean {
	if (params.intentType) return true;
	if (params.toAccountId || params.amountNear || params.amountYoctoNear)
		return true;
	if (params.ftContractId || params.amountRaw) return true;
	if (
		params.tokenInId ||
		params.tokenOutId ||
		params.originAsset ||
		params.destinationAsset ||
		params.tokenAId ||
		params.tokenBId ||
		params.tokenId ||
		params.amountInRaw ||
		params.amountARaw ||
		params.amountBRaw ||
		params.amountA != null ||
		params.amountB != null ||
		params.shares ||
		params.shareBps != null ||
		params.sharePercent != null ||
		params.amountIn != null ||
		params.withdrawAll != null ||
		params.swapType ||
		params.depositType ||
		params.refundType ||
		params.recipientType ||
		params.depositMode ||
		params.recipient ||
		params.refundTo
	) {
		return true;
	}
	if (
		params.refContractId ||
		params.slippageTolerance != null ||
		params.deadline ||
		params.quoteWaitingTimeMs != null ||
		params.blockchainHint ||
		params.apiBaseUrl ||
		params.minAmountOutRaw ||
		(Array.isArray(params.minAmountsRaw) && params.minAmountsRaw.length > 0) ||
		params.minAmountARaw ||
		params.minAmountBRaw ||
		params.autoWithdraw != null ||
		params.autoRegisterReceiver != null ||
		params.autoRegisterOutput != null
	) {
		return true;
	}
	return false;
}

function hintsContainActionableIntentFields(hints: ParsedIntentHints): boolean {
	return Boolean(
		hints.intentType ||
			hints.toAccountId ||
			hints.amountNear ||
			hints.ftContractId ||
			hints.amountRaw ||
			hints.amountInRaw ||
			hints.amountInUi ||
			hints.tokenInId ||
			hints.tokenOutId ||
			hints.originAsset ||
			hints.destinationAsset ||
			hints.tokenAId ||
			hints.tokenBId ||
			hints.tokenId ||
			hints.amountAUi ||
			hints.amountBUi ||
			hints.amountARaw ||
			hints.amountBRaw ||
			hints.shares ||
			hints.shareBps != null ||
			hints.minAmountARaw ||
			hints.minAmountBRaw ||
			hints.slippageBps != null ||
			hints.slippageTolerance != null ||
			hints.refContractId ||
			hints.recipient ||
			hints.refundTo ||
			hints.withdrawAll != null ||
			hints.autoWithdraw != null,
	);
}

function normalizeRefPoolCandidates(value: unknown): RefPoolCandidateSummary[] {
	if (!Array.isArray(value)) return [];
	const normalized: RefPoolCandidateSummary[] = [];
	for (const candidate of value) {
		if (!isObjectRecord(candidate)) continue;
		if (
			typeof candidate.poolId !== "number" ||
			!Number.isInteger(candidate.poolId) ||
			candidate.poolId < 0
		) {
			continue;
		}
		if (
			typeof candidate.tokenAId !== "string" ||
			typeof candidate.tokenBId !== "string" ||
			typeof candidate.liquidityScore !== "string"
		) {
			continue;
		}
		normalized.push({
			poolId: candidate.poolId,
			poolKind:
				typeof candidate.poolKind === "string" ? candidate.poolKind : undefined,
			tokenAId: candidate.tokenAId,
			tokenBId: candidate.tokenBId,
			liquidityScore: candidate.liquidityScore,
		});
	}
	return normalized;
}

function resolvePoolIdFromCandidateIndex(params: {
	index: number;
	poolCandidates: RefPoolCandidateSummary[];
}): number {
	if (params.poolCandidates.length === 0) {
		throw new Error(
			"No poolCandidates available in prior session. Run simulate first to get candidate pools.",
		);
	}
	if (params.index > params.poolCandidates.length) {
		throw new Error(
			`poolCandidateIndex ${params.index} is out of range (1-${params.poolCandidates.length}).`,
		);
	}
	const candidate = params.poolCandidates[params.index - 1];
	if (!candidate) {
		throw new Error(
			`poolCandidateIndex ${params.index} is out of range (1-${params.poolCandidates.length}).`,
		);
	}
	return candidate.poolId;
}

function applyPoolFollowUpSelection(params: {
	intent: NearWorkflowIntent;
	poolId?: number;
	poolCandidateIndex?: number;
	poolCandidates: RefPoolCandidateSummary[];
}): NearWorkflowIntent {
	const selectedPoolIdFromIndex =
		params.poolCandidateIndex == null
			? undefined
			: resolvePoolIdFromCandidateIndex({
					index: params.poolCandidateIndex,
					poolCandidates: params.poolCandidates,
				});
	const selectedPoolId =
		params.poolId != null ? params.poolId : selectedPoolIdFromIndex;
	if (selectedPoolIdFromIndex != null && params.poolId != null) {
		if (selectedPoolIdFromIndex !== params.poolId) {
			throw new Error(
				`poolId ${params.poolId} conflicts with poolCandidateIndex ${params.poolCandidateIndex} (poolId=${selectedPoolIdFromIndex}).`,
			);
		}
	}
	if (selectedPoolId == null) {
		return params.intent;
	}
	if (
		params.intent.type !== "near.lp.ref.add" &&
		params.intent.type !== "near.lp.ref.remove"
	) {
		throw new Error(
			"Pool selection follow-up is only supported for near.lp.ref.add and near.lp.ref.remove.",
		);
	}
	return {
		...params.intent,
		poolId: selectedPoolId,
	};
}

function decodeCallFunctionResult(result: NearCallFunctionResult): string {
	if (!Array.isArray(result.result)) {
		throw new Error("Invalid call_function result payload");
	}
	const utf8 = Buffer.from(Uint8Array.from(result.result)).toString("utf8");
	if (!utf8.trim()) {
		throw new Error("call_function returned empty payload");
	}
	const parsed = JSON.parse(utf8) as unknown;
	if (typeof parsed !== "string" || !/^\d+$/.test(parsed.trim())) {
		throw new Error("call_function returned non-numeric balance payload");
	}
	return parsed.trim();
}

function encodeCallFunctionArgs(args: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(args), "utf8").toString("base64");
}

function decodeCallFunctionJson<T>(result: NearCallFunctionResult): T {
	if (!Array.isArray(result.result)) {
		throw new Error("Invalid call_function result payload");
	}
	const utf8 = Buffer.from(Uint8Array.from(result.result)).toString("utf8");
	if (!utf8.trim()) {
		throw new Error("call_function returned empty payload");
	}
	return JSON.parse(utf8) as T;
}

function isMissingMethodError(error: unknown): boolean {
	const text =
		error instanceof Error && typeof error.message === "string"
			? error.message.toLowerCase()
			: String(error).toLowerCase();
	return (
		text.includes("methodnotfound") ||
		text.includes("does not exist while viewing") ||
		text.includes("unknown method")
	);
}

async function queryStorageRegistrationStatus(params: {
	network: string;
	rpcUrl?: string;
	ftContractId: string;
	accountId: string;
}): Promise<
	| {
			status: "registered";
	  }
	| {
			status: "needs_registration";
			estimatedDepositYoctoNear: string;
	  }
	| {
			status: "unknown";
			reason: string;
	  }
> {
	try {
		const balanceResult = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "call_function",
				account_id: params.ftContractId,
				method_name: "storage_balance_of",
				args_base64: encodeCallFunctionArgs({
					account_id: params.accountId,
				}),
				finality: "final",
			},
		});
		const balance = decodeCallFunctionJson<{ total?: string } | null>(
			balanceResult,
		);
		if (balance && typeof balance.total === "string") {
			const total = parseNonNegativeBigInt(
				balance.total,
				"storageBalance.total",
			);
			if (total > 0n) {
				return { status: "registered" };
			}
		}
	} catch (error) {
		if (isMissingMethodError(error)) {
			return {
				status: "unknown",
				reason: "token does not expose storage_balance_of",
			};
		}
		return {
			status: "unknown",
			reason:
				error instanceof Error ? error.message : "storage precheck call failed",
		};
	}

	try {
		const boundsResult = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "call_function",
				account_id: params.ftContractId,
				method_name: "storage_balance_bounds",
				args_base64: encodeCallFunctionArgs({}),
				finality: "final",
			},
		});
		const bounds = decodeCallFunctionJson<{ min?: string }>(boundsResult);
		const min =
			typeof bounds?.min === "string" && /^\d+$/.test(bounds.min.trim())
				? bounds.min.trim()
				: "1250000000000000000000";
		return {
			status: "needs_registration",
			estimatedDepositYoctoNear: min,
		};
	} catch {
		return {
			status: "needs_registration",
			estimatedDepositYoctoNear: "1250000000000000000000",
		};
	}
}

async function simulateNearTransfer(params: {
	intent: NearTransferIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance";
	fromAccountId: string;
	availableYoctoNear: string;
	requiredYoctoNear: string;
	blockHash: string;
	blockHeight: number;
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const query = await callNearRpc<NearAccountQueryResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			account_id: fromAccountId,
			finality: "final",
			request_type: "view_account",
		},
	});
	const total = parseNonNegativeBigInt(query.amount, "amount");
	const locked = parseNonNegativeBigInt(query.locked, "locked");
	const available = total > locked ? total - locked : 0n;
	const required = parsePositiveBigInt(
		params.intent.amountYoctoNear,
		"amountYoctoNear",
	);
	return {
		status: available >= required ? "success" : "insufficient_balance",
		fromAccountId,
		availableYoctoNear: available.toString(),
		requiredYoctoNear: required.toString(),
		blockHash: query.block_hash,
		blockHeight: query.block_height,
	};
}

async function simulateFtTransfer(params: {
	intent: NearFtTransferIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance";
	fromAccountId: string;
	availableRaw: string;
	requiredRaw: string;
	blockHash: string;
	blockHeight: number;
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const query = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			account_id: params.intent.ftContractId,
			args_base64: Buffer.from(
				JSON.stringify({ account_id: fromAccountId }),
				"utf8",
			).toString("base64"),
			finality: "final",
			method_name: "ft_balance_of",
			request_type: "call_function",
		},
	});
	const available = parseNonNegativeBigInt(
		decodeCallFunctionResult(query),
		"ft_balance_of",
	);
	const required = parsePositiveBigInt(params.intent.amountRaw, "amountRaw");
	return {
		status: available >= required ? "success" : "insufficient_balance",
		fromAccountId,
		availableRaw: available.toString(),
		requiredRaw: required.toString(),
		blockHash: query.block_hash,
		blockHeight: query.block_height,
	};
}

async function simulateRefSwap(params: {
	intent: NearRefSwapIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance";
	fromAccountId: string;
	availableRaw: string;
	requiredRaw: string;
	blockHash: string;
	blockHeight: number;
	storageRegistration:
		| {
				status: "registered";
		  }
		| {
				status: "needs_registration";
				estimatedDepositYoctoNear: string;
		  }
		| {
				status: "unknown";
				reason: string;
		  };
	quote: {
		refContractId: string;
		poolId: number;
		tokenInId: string;
		tokenOutId: string;
		amountInRaw: string;
		amountOutRaw: string;
		minAmountOutRaw: string;
		source:
			| "explicitPool"
			| "bestDirectSimplePool"
			| "bestDirectPool"
			| "bestTwoHopPoolRoute";
		actions: Array<{
			poolId: number;
			tokenInId: string;
			tokenOutId: string;
			amountInRaw?: string;
		}>;
	};
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const quote = await getRefSwapQuote({
		network: params.network,
		rpcUrl: params.rpcUrl,
		refContractId: params.intent.refContractId,
		tokenInId: params.intent.tokenInId,
		tokenOutId: params.intent.tokenOutId,
		amountInRaw: params.intent.amountInRaw,
		poolId: params.intent.poolId,
		slippageBps: params.intent.slippageBps,
	});
	const minAmountOutRaw = resolveSafeMinAmountOutRaw({
		requestedMinAmountOutRaw: params.intent.minAmountOutRaw,
		quoteAmountOutRaw: quote.amountOutRaw,
		quoteMinAmountOutRaw: quote.minAmountOutRaw,
	});
	const query = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			account_id: quote.tokenInId,
			args_base64: encodeCallFunctionArgs({ account_id: fromAccountId }),
			finality: "final",
			method_name: "ft_balance_of",
			request_type: "call_function",
		},
	});
	const available = parseNonNegativeBigInt(
		decodeCallFunctionResult(query),
		"ft_balance_of",
	);
	const required = parsePositiveBigInt(quote.amountInRaw, "amountInRaw");
	const storageRegistration = await queryStorageRegistrationStatus({
		network: params.network,
		rpcUrl: params.rpcUrl,
		ftContractId: quote.tokenOutId,
		accountId: fromAccountId,
	});
	return {
		status: available >= required ? "success" : "insufficient_balance",
		fromAccountId,
		availableRaw: available.toString(),
		requiredRaw: required.toString(),
		blockHash: query.block_hash,
		blockHeight: query.block_height,
		storageRegistration,
		quote: {
			refContractId: quote.refContractId,
			poolId: quote.poolId,
			tokenInId: quote.tokenInId,
			tokenOutId: quote.tokenOutId,
			amountInRaw: quote.amountInRaw,
			amountOutRaw: quote.amountOutRaw,
			minAmountOutRaw,
			source: quote.source,
			actions: quote.actions,
		},
	};
}

function resolveRefWithdrawTokenId(params: {
	network: string;
	tokenInput: string;
	availableTokenIds: string[];
}): string {
	const inPoolCandidates = resolveRefTokenIds({
		network: params.network,
		tokenIdOrSymbol: params.tokenInput,
		availableTokenIds: params.availableTokenIds,
	});
	if (inPoolCandidates[0]) return inPoolCandidates[0];
	const fallback = resolveRefTokenIds({
		network: params.network,
		tokenIdOrSymbol: params.tokenInput,
	});
	if (fallback[0]) return fallback[0];
	throw new Error(`Cannot resolve tokenId: ${params.tokenInput}`);
}

async function simulateRefWithdraw(params: {
	intent: NearRefWithdrawIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance" | "no_deposit";
	fromAccountId: string;
	refContractId: string;
	tokenId: string;
	depositBeforeRaw: string;
	requiredRaw: string;
	withdrawAll: boolean;
	storageRegistration:
		| {
				status: "registered";
		  }
		| {
				status: "needs_registration";
				estimatedDepositYoctoNear: string;
		  }
		| {
				status: "unknown";
				reason: string;
		  }
		| null;
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const refContractId = getRefContractId(
		params.network,
		params.intent.refContractId,
	);
	const depositsResult = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			request_type: "call_function",
			account_id: refContractId,
			method_name: "get_deposits",
			args_base64: encodeCallFunctionArgs({
				account_id: fromAccountId,
			}),
			finality: "final",
		},
	});
	const deposits =
		decodeCallFunctionJson<Record<string, string>>(depositsResult);
	const availableTokenIds = Object.keys(deposits ?? {}).map((entry) =>
		entry.toLowerCase(),
	);
	const tokenId = resolveRefWithdrawTokenId({
		network: params.network,
		tokenInput: params.intent.tokenId,
		availableTokenIds,
	});
	const depositBeforeRaw = parseNonNegativeBigInt(
		typeof deposits?.[tokenId] === "string" ? deposits[tokenId] : "0",
		`deposits[${tokenId}]`,
	).toString();
	const requestedRaw =
		typeof params.intent.amountRaw === "string" &&
		params.intent.amountRaw.trim()
			? parsePositiveBigInt(params.intent.amountRaw, "amountRaw").toString()
			: null;
	const withdrawAll = params.intent.withdrawAll !== false;
	const requiredRaw =
		requestedRaw ??
		(withdrawAll
			? depositBeforeRaw
			: (() => {
					throw new Error("Provide amountRaw or set withdrawAll=true");
				})());
	const depositValue = parseNonNegativeBigInt(
		depositBeforeRaw,
		"depositBeforeRaw",
	);
	const requiredValue = parseNonNegativeBigInt(requiredRaw, "requiredRaw");
	const storageRegistration =
		params.intent.autoRegisterReceiver === false
			? null
			: await queryStorageRegistrationStatus({
					network: params.network,
					rpcUrl: params.rpcUrl,
					ftContractId: tokenId,
					accountId: fromAccountId,
				});
	return {
		status:
			requiredValue <= 0n
				? "no_deposit"
				: depositValue >= requiredValue
					? "success"
					: "insufficient_balance",
		fromAccountId,
		refContractId,
		tokenId,
		depositBeforeRaw,
		requiredRaw,
		withdrawAll,
		storageRegistration,
	};
}

async function simulateNearIntentsSwap(params: {
	intent: NearIntentsSwapIntent;
	network: string;
	fromAccountId?: string;
	apiKey?: string;
	jwt?: string;
}): Promise<{
	status: "success";
	accountId: string;
	apiBaseUrl: string;
	tokensEndpoint: string;
	tokensHttpStatus: number;
	quoteEndpoint: string;
	quoteHttpStatus: number;
	originAssetId: string;
	destinationAssetId: string;
	originSymbol: string;
	destinationSymbol: string;
	request: NearIntentsQuoteRequest;
	quoteResponse: NearIntentsQuoteResponse;
}> {
	const accountId = resolveNearAccountId(
		params.intent.accountId ?? params.fromAccountId,
		params.network,
	);
	const baseUrl = resolveNearIntentsApiBaseUrl(params.intent.apiBaseUrl);
	const authHeaders = resolveNearIntentsHeaders({
		apiKey: params.apiKey,
		jwt: params.jwt,
	});
	const tokensResponse = await fetchNearIntentsJson<NearIntentsToken[]>({
		baseUrl,
		path: "/v0/tokens",
		method: "GET",
		headers: authHeaders,
	});
	const tokens = normalizeNearIntentsTokens(tokensResponse.payload);
	const originAssetId = resolveNearIntentsAssetId({
		assetInput: params.intent.originAsset,
		tokens,
		preferredBlockchain: params.intent.blockchainHint,
		fieldName: "originAsset",
	});
	const destinationAssetId = resolveNearIntentsAssetId({
		assetInput: params.intent.destinationAsset,
		tokens,
		preferredBlockchain: params.intent.blockchainHint,
		fieldName: "destinationAsset",
	});
	if (originAssetId === destinationAssetId) {
		throw new Error("originAsset and destinationAsset must be different");
	}
	const recipient = params.intent.recipient?.trim() || accountId;
	const refundTo = params.intent.refundTo?.trim() || recipient;
	const quoteWaitingTimeMs = parseIntentsQuoteWaitingTimeMs(
		params.intent.quoteWaitingTimeMs,
	);
	const quoteRequest: NearIntentsQuoteRequest = {
		dry: true,
		swapType: params.intent.swapType ?? "EXACT_INPUT",
		slippageTolerance: parseIntentsSlippageTolerance(
			params.intent.slippageTolerance,
		),
		originAsset: originAssetId,
		depositType: params.intent.depositType ?? "ORIGIN_CHAIN",
		destinationAsset: destinationAssetId,
		amount: parsePositiveBigInt(params.intent.amount, "amount").toString(),
		refundTo,
		refundType: params.intent.refundType ?? "ORIGIN_CHAIN",
		recipient,
		recipientType: params.intent.recipientType ?? "DESTINATION_CHAIN",
		deadline: parseIntentsDeadline(params.intent.deadline),
		depositMode: params.intent.depositMode ?? "SIMPLE",
		...(quoteWaitingTimeMs != null
			? {
					quoteWaitingTimeMs,
				}
			: {}),
	};
	const quoteResponse = await fetchNearIntentsJson<NearIntentsQuoteResponse>({
		baseUrl,
		path: "/v0/quote",
		method: "POST",
		headers: authHeaders,
		body: quoteRequest as unknown as Record<string, unknown>,
	});
	const originSymbol =
		resolveNearIntentsTokenByAssetId(originAssetId, tokens)?.symbol ??
		originAssetId;
	const destinationSymbol =
		resolveNearIntentsTokenByAssetId(destinationAssetId, tokens)?.symbol ??
		destinationAssetId;
	return {
		status: "success",
		accountId,
		apiBaseUrl: baseUrl,
		tokensEndpoint: tokensResponse.url,
		tokensHttpStatus: tokensResponse.status,
		quoteEndpoint: quoteResponse.url,
		quoteHttpStatus: quoteResponse.status,
		originAssetId,
		destinationAssetId,
		originSymbol,
		destinationSymbol,
		request: quoteRequest,
		quoteResponse: quoteResponse.payload,
	};
}

function extractErrorText(error: unknown): string {
	if (error instanceof Error && typeof error.message === "string") {
		return error.message;
	}
	return String(error);
}

function isNearIntentsTerminalStatus(
	status: NearIntentsStatusResponse["status"],
): boolean {
	return (
		status === "SUCCESS" ||
		status === "FAILED" ||
		status === "REFUNDED" ||
		status === "INCOMPLETE_DEPOSIT"
	);
}

function sleepMs(delayMs: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, delayMs);
	});
}

async function pollNearIntentsStatusUntilFinal(params: {
	baseUrl: string;
	headers: Record<string, string>;
	depositAddress: string;
	depositMemo?: string;
	timeoutMs: number;
	intervalMs: number;
}): Promise<{
	timedOut: boolean;
	attempts: number;
	latestStatus: NearIntentsStatusResponse | null;
	lastError: string | null;
	history: Array<{
		attempt: number;
		status: NearIntentsStatusResponse["status"] | "NOT_FOUND" | "ERROR";
		updatedAt: string | null;
		message?: string;
	}>;
}> {
	const deadlineAt = Date.now() + params.timeoutMs;
	let attempts = 0;
	let latestStatus: NearIntentsStatusResponse | null = null;
	let lastError: string | null = null;
	const history: Array<{
		attempt: number;
		status: NearIntentsStatusResponse["status"] | "NOT_FOUND" | "ERROR";
		updatedAt: string | null;
		message?: string;
	}> = [];

	while (Date.now() <= deadlineAt) {
		attempts += 1;
		try {
			const response = await fetchNearIntentsJson<NearIntentsStatusResponse>({
				baseUrl: params.baseUrl,
				path: "/v0/status",
				method: "GET",
				query: {
					depositAddress: params.depositAddress,
					depositMemo: params.depositMemo,
				},
				headers: params.headers,
			});
			latestStatus = response.payload;
			history.push({
				attempt: attempts,
				status: response.payload.status,
				updatedAt: response.payload.updatedAt ?? null,
			});
			if (isNearIntentsTerminalStatus(response.payload.status)) {
				return {
					timedOut: false,
					attempts,
					latestStatus,
					lastError,
					history,
				};
			}
		} catch (error) {
			const message = extractErrorText(error);
			lastError = message;
			const isNotIndexedYet =
				message.includes("(404)") ||
				/deposit .*not found/i.test(message) ||
				/not found/i.test(message);
			history.push({
				attempt: attempts,
				status: isNotIndexedYet ? "NOT_FOUND" : "ERROR",
				updatedAt: null,
				message,
			});
			if (!isNotIndexedYet) {
				throw error;
			}
		}

		if (Date.now() + params.intervalMs > deadlineAt) {
			break;
		}
		await sleepMs(params.intervalMs);
	}

	return {
		timedOut: true,
		attempts,
		latestStatus,
		lastError,
		history,
	};
}

function normalizePoolTokenIds(tokenIds: string[]): string[] {
	return tokenIds
		.map((tokenId) => tokenId.trim().toLowerCase())
		.filter(Boolean);
}

function resolveLpIntentTokenMapping(params: {
	intent: NearRefAddLiquidityIntent;
	network: string;
	poolTokenIds: string[];
}): {
	tokenAId: string;
	tokenBId: string;
	amountsRawByPool: string[];
} {
	const poolTokenIds = normalizePoolTokenIds(params.poolTokenIds);
	const resolveToken = (
		tokenInput: string | undefined,
		fallback: string,
	): string => {
		if (!tokenInput || !tokenInput.trim()) return fallback;
		const candidates = resolveRefTokenIds({
			network: params.network,
			tokenIdOrSymbol: tokenInput,
			availableTokenIds: poolTokenIds,
		});
		if (!candidates[0]) {
			throw new Error(`Token ${tokenInput} is not in selected pool`);
		}
		return candidates[0];
	};

	const tokenAId = resolveToken(params.intent.tokenAId, poolTokenIds[0] ?? "");
	const tokenBId = resolveToken(params.intent.tokenBId, poolTokenIds[1] ?? "");
	let resolvedTokenAId = tokenAId;
	let resolvedTokenBId = tokenBId;
	if (
		resolvedTokenAId === resolvedTokenBId &&
		typeof params.intent.tokenAId === "string" &&
		params.intent.tokenAId.trim() &&
		(!params.intent.tokenBId || !params.intent.tokenBId.trim())
	) {
		resolvedTokenBId =
			poolTokenIds.find((tokenId) => tokenId !== resolvedTokenAId) ?? "";
	}
	if (
		resolvedTokenAId === resolvedTokenBId &&
		typeof params.intent.tokenBId === "string" &&
		params.intent.tokenBId.trim() &&
		(!params.intent.tokenAId || !params.intent.tokenAId.trim())
	) {
		resolvedTokenAId =
			poolTokenIds.find((tokenId) => tokenId !== resolvedTokenBId) ?? "";
	}
	if (
		!resolvedTokenAId ||
		!resolvedTokenBId ||
		resolvedTokenAId === resolvedTokenBId
	) {
		throw new Error(
			"tokenAId/tokenBId must resolve to two distinct pool tokens",
		);
	}
	const tokenAIndex = poolTokenIds.indexOf(resolvedTokenAId);
	const tokenBIndex = poolTokenIds.indexOf(resolvedTokenBId);
	if (tokenAIndex < 0 || tokenBIndex < 0) {
		throw new Error("tokenAId/tokenBId are not in selected pool");
	}
	const amountsRawByPool = poolTokenIds.map(() => "0");
	amountsRawByPool[tokenAIndex] = params.intent.amountARaw;
	amountsRawByPool[tokenBIndex] = params.intent.amountBRaw;
	return {
		tokenAId: resolvedTokenAId,
		tokenBId: resolvedTokenBId,
		amountsRawByPool,
	};
}

async function simulateRefAddLiquidity(params: {
	intent: NearRefAddLiquidityIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance";
	fromAccountId: string;
	refContractId: string;
	poolId: number;
	poolSelectionSource: "explicitPool" | "bestLiquidityPool";
	poolCandidates: RefPoolCandidateSummary[];
	poolTokenIds: string[];
	tokenAId: string;
	tokenBId: string;
	amountsRawByPool: string[];
	balanceChecks: Array<{
		tokenId: string;
		requiredRaw: string;
		availableRaw: string;
	}>;
	exchangeStorageRegistration:
		| {
				status: "registered";
		  }
		| {
				status: "needs_registration";
				estimatedDepositYoctoNear: string;
		  }
		| {
				status: "unknown";
				reason: string;
		  };
	tokenStorageRegistrations: Array<{
		tokenId: string;
		registration:
			| {
					status: "registered";
			  }
			| {
					status: "needs_registration";
					estimatedDepositYoctoNear: string;
			  }
			| {
					status: "unknown";
					reason: string;
			  };
	}>;
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const refContractId = getRefContractId(
		params.network,
		params.intent.refContractId,
	);
	let poolId = params.intent.poolId;
	let poolSelectionSource: "explicitPool" | "bestLiquidityPool" =
		"explicitPool";
	let poolCandidates: RefPoolCandidateSummary[] = [];
	const pool =
		typeof poolId === "number"
			? await fetchRefPoolById({
					network: params.network,
					rpcUrl: params.rpcUrl,
					refContractId,
					poolId,
				})
			: await (async () => {
					const tokenAInput = params.intent.tokenAId?.trim() ?? "";
					const tokenBInput = params.intent.tokenBId?.trim() ?? "";
					if (!tokenAInput || !tokenBInput) {
						throw new Error(
							"near.lp.ref.add simulate requires poolId, or tokenAId/tokenBId for automatic pool selection",
						);
					}
					const selection = await findRefPoolForPair({
						network: params.network,
						rpcUrl: params.rpcUrl,
						refContractId,
						tokenAId: tokenAInput,
						tokenBId: tokenBInput,
					});
					poolId = selection.poolId;
					poolSelectionSource = selection.source;
					poolCandidates = Array.isArray(selection.candidates)
						? selection.candidates
						: [];
					return selection.pool;
				})();
	if (typeof poolId !== "number") {
		throw new Error("Failed to resolve poolId for near.lp.ref.add simulate");
	}
	const poolTokenIds = normalizePoolTokenIds(pool.token_account_ids);
	const mapping = resolveLpIntentTokenMapping({
		intent: params.intent,
		network: params.network,
		poolTokenIds,
	});

	const balanceChecks: Array<{
		tokenId: string;
		requiredRaw: string;
		availableRaw: string;
	}> = [];
	let sufficient = true;
	for (const [index, tokenId] of poolTokenIds.entries()) {
		const requiredRaw = mapping.amountsRawByPool[index] ?? "0";
		if (parseNonNegativeBigInt(requiredRaw, "amountsRawByPool") <= 0n) continue;
		const query = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				account_id: tokenId,
				args_base64: encodeCallFunctionArgs({ account_id: fromAccountId }),
				finality: "final",
				method_name: "ft_balance_of",
				request_type: "call_function",
			},
		});
		const availableRaw = decodeCallFunctionResult(query);
		if (
			parseNonNegativeBigInt(availableRaw, "availableRaw") <
			parseNonNegativeBigInt(requiredRaw, "requiredRaw")
		) {
			sufficient = false;
		}
		balanceChecks.push({
			tokenId,
			requiredRaw,
			availableRaw,
		});
	}

	const exchangeStorageRegistration = await queryStorageRegistrationStatus({
		network: params.network,
		rpcUrl: params.rpcUrl,
		ftContractId: refContractId,
		accountId: fromAccountId,
	});
	const tokenStorageRegistrations = await Promise.all(
		poolTokenIds
			.filter(
				(tokenId, index) =>
					parseNonNegativeBigInt(
						mapping.amountsRawByPool[index] ?? "0",
						"amountsRawByPool",
					) > 0n,
			)
			.map(async (tokenId) => ({
				tokenId,
				registration: await queryStorageRegistrationStatus({
					network: params.network,
					rpcUrl: params.rpcUrl,
					ftContractId: tokenId,
					accountId: refContractId,
				}),
			})),
	);

	return {
		status: sufficient ? "success" : "insufficient_balance",
		fromAccountId,
		refContractId,
		poolId,
		poolSelectionSource,
		poolCandidates,
		poolTokenIds,
		tokenAId: mapping.tokenAId,
		tokenBId: mapping.tokenBId,
		amountsRawByPool: mapping.amountsRawByPool,
		balanceChecks,
		exchangeStorageRegistration,
		tokenStorageRegistrations,
	};
}

async function simulateRefRemoveLiquidity(params: {
	intent: NearRefRemoveLiquidityIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance";
	fromAccountId: string;
	refContractId: string;
	poolId: number;
	poolSelectionSource: "explicitPool" | "bestLiquidityPool";
	poolCandidates: RefPoolCandidateSummary[];
	poolTokenIds: string[];
	tokenAId: string | null;
	tokenBId: string | null;
	availableShares: string;
	requiredShares: string;
	shareBpsUsed: number | null;
	minAmountsRaw: string[];
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const refContractId = getRefContractId(
		params.network,
		params.intent.refContractId,
	);
	let poolId = params.intent.poolId;
	let poolSelectionSource: "explicitPool" | "bestLiquidityPool" =
		"explicitPool";
	let poolCandidates: RefPoolCandidateSummary[] = [];
	let selectedTokenAId: string | null = null;
	let selectedTokenBId: string | null = null;
	const pool =
		typeof poolId === "number"
			? await fetchRefPoolById({
					network: params.network,
					rpcUrl: params.rpcUrl,
					refContractId,
					poolId,
				})
			: await (async () => {
					const tokenAInput = params.intent.tokenAId?.trim() ?? "";
					const tokenBInput = params.intent.tokenBId?.trim() ?? "";
					if (!tokenAInput || !tokenBInput) {
						throw new Error(
							"near.lp.ref.remove simulate requires poolId, or tokenAId/tokenBId for automatic pool selection",
						);
					}
					const selection = await findRefPoolForPair({
						network: params.network,
						rpcUrl: params.rpcUrl,
						refContractId,
						tokenAId: tokenAInput,
						tokenBId: tokenBInput,
					});
					poolId = selection.poolId;
					poolSelectionSource = selection.source;
					poolCandidates = Array.isArray(selection.candidates)
						? selection.candidates
						: [];
					selectedTokenAId = selection.tokenAId;
					selectedTokenBId = selection.tokenBId;
					return selection.pool;
				})();
	if (typeof poolId !== "number") {
		throw new Error("Failed to resolve poolId for near.lp.ref.remove simulate");
	}
	const poolTokenIds = normalizePoolTokenIds(pool.token_account_ids);
	const minAmountsRaw =
		Array.isArray(params.intent.minAmountsRaw) &&
		params.intent.minAmountsRaw.length > 0
			? params.intent.minAmountsRaw
			: (() => {
					const values = poolTokenIds.map(() => "0");
					if (params.intent.minAmountARaw)
						values[0] = params.intent.minAmountARaw;
					if (params.intent.minAmountBRaw)
						values[1] = params.intent.minAmountBRaw;
					return values;
				})();
	const sharesResult = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			account_id: refContractId,
			args_base64: encodeCallFunctionArgs({
				pool_id: poolId,
				account_id: fromAccountId,
			}),
			finality: "final",
			method_name: "get_pool_shares",
			request_type: "call_function",
		},
	});
	const availableShares = decodeCallFunctionResult(sharesResult);
	const requiredShares =
		typeof params.intent.shares === "string" && params.intent.shares.trim()
			? parsePositiveBigInt(params.intent.shares, "shares").toString()
			: (() => {
					const shareBps = parseOptionalShareBps(
						params.intent.shareBps,
						"shareBps",
					);
					if (shareBps == null) {
						throw new Error(
							"near.lp.ref.remove simulate requires shares or shareBps",
						);
					}
					const available = parseNonNegativeBigInt(
						availableShares,
						"availableShares",
					);
					const computed = (available * BigInt(shareBps)) / 10_000n;
					if (computed <= 0n) {
						throw new Error(
							`shareBps resolves to 0 shares (available=${availableShares})`,
						);
					}
					return computed.toString();
				})();
	return {
		status:
			parseNonNegativeBigInt(availableShares, "availableShares") >=
			parseNonNegativeBigInt(requiredShares, "requiredShares")
				? "success"
				: "insufficient_balance",
		fromAccountId,
		refContractId,
		poolId,
		poolSelectionSource,
		poolCandidates,
		poolTokenIds,
		tokenAId: selectedTokenAId,
		tokenBId: selectedTokenBId,
		availableShares,
		requiredShares,
		shareBpsUsed: params.intent.shareBps ?? null,
		minAmountsRaw: minAmountsRaw.map((entry) =>
			parseNonNegativeBigInt(entry, "minAmountsRaw").toString(),
		),
	};
}

function resolveExecuteTool(
	name:
		| "near_transferNear"
		| "near_transferFt"
		| "near_swapRef"
		| "near_withdrawRefToken"
		| "near_submitIntentsDeposit"
		| "near_addLiquidityRef"
		| "near_removeLiquidityRef",
): WorkflowTool {
	const tool = createNearExecuteTools().find((entry) => entry.name === name);
	if (!tool) {
		throw new Error(`Execute tool not found: ${name}`);
	}
	return tool;
}

function resolveComposeTool(
	name:
		| "near_buildTransferNearTransaction"
		| "near_buildTransferFtTransaction"
		| "near_buildSwapRefTransaction"
		| "near_buildRefWithdrawTransaction",
): WorkflowComposeTool {
	const tool = createNearComposeTools().find((entry) => entry.name === name);
	if (!tool) {
		throw new Error(`Compose tool not found: ${name}`);
	}
	return tool;
}

function assertMainnetExecutionConfirmed(
	network: string,
	confirmMainnet?: boolean,
): void {
	if (network === "mainnet" && confirmMainnet !== true) {
		throw new Error(
			"Mainnet execute requires confirmMainnet=true. Run analysis/simulate first to obtain confirmToken.",
		);
	}
}

function buildExecuteResultSummary(executeResult: unknown): string {
	if (!executeResult || typeof executeResult !== "object") {
		return "submitted";
	}
	const candidate = executeResult as {
		txHash?: unknown;
		status?: unknown;
		correlationId?: unknown;
		statusTracking?: unknown;
	};
	const directStatus =
		typeof candidate.status === "string" ? candidate.status : null;
	const correlationId =
		typeof candidate.correlationId === "string" &&
		candidate.correlationId.trim()
			? candidate.correlationId
			: null;
	if (directStatus || correlationId) {
		return [
			directStatus ? `status=${directStatus}` : null,
			correlationId ? `correlationId=${correlationId}` : null,
		]
			.filter((item): item is string => item != null)
			.join(" ");
	}
	if (
		candidate.statusTracking &&
		typeof candidate.statusTracking === "object" &&
		typeof (candidate.statusTracking as { latestStatus?: { status?: unknown } })
			.latestStatus?.status === "string"
	) {
		const tracking = candidate.statusTracking as {
			latestStatus: { status: string };
			timedOut?: boolean;
		};
		return `status=${tracking.latestStatus.status}${tracking.timedOut ? " (poll-timeout)" : ""}`;
	}
	const hashText =
		typeof candidate.txHash === "string" && candidate.txHash.trim()
			? `txHash=${candidate.txHash}`
			: "txHash=unknown";
	return hashText;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object";
}

function buildSimulateResultSummary(
	intentType: NearWorkflowIntent["type"],
	simulateResult: unknown,
): string {
	if (!isObjectRecord(simulateResult)) {
		return `Workflow simulated: ${intentType}`;
	}
	const statusText =
		typeof simulateResult.status === "string"
			? simulateResult.status
			: "unknown";
	if (intentType === "near.swap.intents") {
		const depositAddress =
			typeof simulateResult.quoteResponse === "object" &&
			simulateResult.quoteResponse &&
			typeof (
				simulateResult.quoteResponse as { quote?: { depositAddress?: unknown } }
			).quote?.depositAddress === "string"
				? (
						simulateResult.quoteResponse as {
							quote: { depositAddress: string };
						}
					).quote.depositAddress
				: null;
		return `Workflow simulated: ${intentType} status=${statusText}${depositAddress ? ` deposit=${depositAddress}` : ""}`;
	}
	if (
		(intentType === "near.lp.ref.add" || intentType === "near.lp.ref.remove") &&
		simulateResult.poolSelectionSource === "bestLiquidityPool"
	) {
		const selectedPoolId =
			typeof simulateResult.poolId === "number"
				? simulateResult.poolId
				: typeof simulateResult.poolId === "string"
					? Number(simulateResult.poolId)
					: null;
		const poolCandidates = Array.isArray(simulateResult.poolCandidates)
			? simulateResult.poolCandidates
			: [];
		const alternativePoolIds = poolCandidates
			.map((candidate) =>
				isObjectRecord(candidate) && typeof candidate.poolId === "number"
					? candidate.poolId
					: null,
			)
			.filter(
				(poolId): poolId is number =>
					poolId != null &&
					(selectedPoolId == null || poolId !== selectedPoolId),
			)
			.slice(0, 3);
		if (selectedPoolId != null && alternativePoolIds.length > 0) {
			return `Workflow simulated: ${intentType} status=${statusText} pool=${selectedPoolId} alternatives=${alternativePoolIds.join(",")}`;
		}
	}
	return `Workflow simulated: ${intentType} status=${statusText}`;
}

function workflowRunModeSchema() {
	return Type.Optional(
		Type.Union([
			Type.Literal("analysis"),
			Type.Literal("compose"),
			Type.Literal("simulate"),
			Type.Literal("execute"),
		]),
	);
}

export function createNearWorkflowTools() {
	return [
		defineTool({
			name: "w3rt_run_near_workflow_v0",
			label: "W3RT NEAR Workflow",
			description:
				"Run NEAR workflow in phases: analysis -> compose/simulate -> execute for native transfer, FT transfer, Ref swap, Ref withdraw, NEAR Intents swap, and Ref LP add/remove.",
			parameters: Type.Object({
				runId: Type.Optional(Type.String()),
				runMode: workflowRunModeSchema(),
				intentType: Type.Optional(
					Type.Union([
						Type.Literal("near.transfer.near"),
						Type.Literal("near.transfer.ft"),
						Type.Literal("near.swap.ref"),
						Type.Literal("near.ref.withdraw"),
						Type.Literal("near.swap.intents"),
						Type.Literal("near.lp.ref.add"),
						Type.Literal("near.lp.ref.remove"),
					]),
				),
				intentText: Type.Optional(Type.String()),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				toAccountId: Type.Optional(Type.String()),
				fromAccountId: Type.Optional(Type.String()),
				amountNear: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				amountYoctoNear: Type.Optional(Type.String()),
				ftContractId: Type.Optional(Type.String()),
				amountRaw: Type.Optional(Type.String()),
				amountInRaw: Type.Optional(Type.String()),
				amountIn: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				tokenInId: Type.Optional(Type.String()),
				tokenOutId: Type.Optional(Type.String()),
				originAsset: Type.Optional(Type.String()),
				destinationAsset: Type.Optional(Type.String()),
				tokenAId: Type.Optional(Type.String()),
				tokenBId: Type.Optional(Type.String()),
				tokenId: Type.Optional(Type.String()),
				poolId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				poolCandidateIndex: Type.Optional(
					Type.Union([Type.String(), Type.Number()]),
				),
				slippageBps: Type.Optional(Type.Number()),
				slippageTolerance: Type.Optional(Type.Number()),
				refContractId: Type.Optional(Type.String()),
				minAmountOutRaw: Type.Optional(Type.String()),
				recipient: Type.Optional(Type.String()),
				refundTo: Type.Optional(Type.String()),
				swapType: Type.Optional(
					Type.Union([
						Type.Literal("EXACT_INPUT"),
						Type.Literal("EXACT_OUTPUT"),
						Type.Literal("FLEX_INPUT"),
						Type.Literal("ANY_INPUT"),
					]),
				),
				depositType: Type.Optional(
					Type.Union([Type.Literal("ORIGIN_CHAIN"), Type.Literal("INTENTS")]),
				),
				refundType: Type.Optional(
					Type.Union([Type.Literal("ORIGIN_CHAIN"), Type.Literal("INTENTS")]),
				),
				recipientType: Type.Optional(
					Type.Union([
						Type.Literal("DESTINATION_CHAIN"),
						Type.Literal("INTENTS"),
					]),
				),
				depositMode: Type.Optional(
					Type.Union([Type.Literal("SIMPLE"), Type.Literal("MEMO")]),
				),
				deadline: Type.Optional(Type.String()),
				quoteWaitingTimeMs: Type.Optional(Type.Number()),
				blockchainHint: Type.Optional(Type.String()),
				depositAddress: Type.Optional(Type.String()),
				depositMemo: Type.Optional(Type.String()),
				txHash: Type.Optional(Type.String()),
				waitForFinalStatus: Type.Optional(Type.Boolean()),
				statusPollIntervalMs: Type.Optional(Type.Number()),
				statusTimeoutMs: Type.Optional(Type.Number()),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				jwt: Type.Optional(Type.String()),
				amountA: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				amountB: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				amountARaw: Type.Optional(Type.String()),
				amountBRaw: Type.Optional(Type.String()),
				shares: Type.Optional(Type.String()),
				shareBps: Type.Optional(Type.Number()),
				sharePercent: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				minAmountsRaw: Type.Optional(Type.Array(Type.String())),
				minAmountARaw: Type.Optional(Type.String()),
				minAmountBRaw: Type.Optional(Type.String()),
				withdrawAll: Type.Optional(Type.Boolean()),
				autoRegisterOutput: Type.Optional(Type.Boolean()),
				autoRegisterExchange: Type.Optional(Type.Boolean()),
				autoRegisterTokens: Type.Optional(Type.Boolean()),
				autoWithdraw: Type.Optional(Type.Boolean()),
				autoRegisterReceiver: Type.Optional(Type.Boolean()),
				gas: Type.Optional(Type.String()),
				attachedDepositYoctoNear: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
				publicKey: Type.Optional(Type.String()),
				privateKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as WorkflowParams;
				const runMode = parseRunMode(params.runMode);
				const session =
					runMode === "execute" ? readWorkflowSession(params.runId) : null;
				const hints = parseIntentHints(params.intentText);
				const poolCandidateIndex =
					runMode === "execute"
						? parseOptionalPoolCandidateIndex(
								params.poolCandidateIndex ?? hints.poolCandidateIndex,
								"poolCandidateIndex",
							)
						: undefined;
				const poolIdFollowUp =
					runMode === "execute"
						? parseOptionalPoolId(
								params.poolId ??
									(poolCandidateIndex == null ? hints.poolId : undefined),
								"poolId",
							)
						: undefined;
				const followUpByIntentText =
					runMode === "execute" &&
					!hasCoreIntentInputs(params) &&
					!hintsContainActionableIntentFields(hints);
				if (
					runMode === "execute" &&
					!session &&
					(!hasIntentInputs(params) || followUpByIntentText)
				) {
					throw new Error(
						"No prior workflow session found. Provide intent parameters or run analysis/simulate first.",
					);
				}
				const useSessionIntent =
					runMode === "execute" &&
					session != null &&
					(!hasIntentInputs(params) || followUpByIntentText);
				const network = parseNearNetwork(
					params.network ?? (useSessionIntent ? session?.network : undefined),
				);
				const runId = createRunId(
					params.runId ?? (useSessionIntent ? session?.runId : undefined),
				);
				const intent =
					useSessionIntent && session != null
						? applyPoolFollowUpSelection({
								intent: session.intent,
								poolId: poolIdFollowUp,
								poolCandidateIndex,
								poolCandidates: normalizeRefPoolCandidates(
									session.poolCandidates,
								),
							})
						: normalizeIntent(params);

				if (runMode === "compose") {
					let composeResult:
						| {
								content: { type: string; text: string }[];
								details?: unknown;
						  }
						| undefined;
					if (intent.type === "near.transfer.near") {
						const composeTool = resolveComposeTool(
							"near_buildTransferNearTransaction",
						);
						composeResult = await composeTool.execute("near-wf-compose", {
							toAccountId: intent.toAccountId,
							amountYoctoNear: intent.amountYoctoNear,
							network,
							rpcUrl: params.rpcUrl,
							fromAccountId: intent.fromAccountId ?? params.fromAccountId,
							publicKey: params.publicKey,
						});
					} else if (intent.type === "near.transfer.ft") {
						const composeTool = resolveComposeTool(
							"near_buildTransferFtTransaction",
						);
						composeResult = await composeTool.execute("near-wf-compose", {
							ftContractId: intent.ftContractId,
							toAccountId: intent.toAccountId,
							amountRaw: intent.amountRaw,
							gas: intent.gas,
							attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
							network,
							rpcUrl: params.rpcUrl,
							fromAccountId: intent.fromAccountId ?? params.fromAccountId,
							publicKey: params.publicKey,
						});
					} else if (intent.type === "near.swap.ref") {
						const composeTool = resolveComposeTool(
							"near_buildSwapRefTransaction",
						);
						composeResult = await composeTool.execute("near-wf-compose", {
							tokenInId: intent.tokenInId,
							tokenOutId: intent.tokenOutId,
							amountInRaw: intent.amountInRaw,
							minAmountOutRaw: intent.minAmountOutRaw,
							poolId: intent.poolId,
							slippageBps: intent.slippageBps,
							refContractId: intent.refContractId,
							autoRegisterOutput: intent.autoRegisterOutput,
							gas: intent.gas,
							attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
							network,
							rpcUrl: params.rpcUrl,
							fromAccountId: intent.fromAccountId ?? params.fromAccountId,
							publicKey: params.publicKey,
						});
					} else if (intent.type === "near.ref.withdraw") {
						const composeTool = resolveComposeTool(
							"near_buildRefWithdrawTransaction",
						);
						composeResult = await composeTool.execute("near-wf-compose", {
							tokenId: intent.tokenId,
							amountRaw: intent.amountRaw,
							withdrawAll: intent.withdrawAll,
							refContractId: intent.refContractId,
							autoRegisterReceiver: intent.autoRegisterReceiver,
							gas: intent.gas,
							attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
							network,
							rpcUrl: params.rpcUrl,
							fromAccountId: intent.fromAccountId ?? params.fromAccountId,
							publicKey: params.publicKey,
						});
					} else {
						throw new Error(
							`compose currently supports near.transfer.near / near.transfer.ft / near.swap.ref / near.ref.withdraw. Unsupported intentType=${intent.type}`,
						);
					}

					rememberWorkflowSession({
						runId,
						network,
						intent,
						confirmToken: null,
						poolCandidates: [],
					});
					return {
						content: [
							{
								type: "text",
								text: `Workflow composed: ${intent.type}`,
							},
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							approvalRequired: false,
							confirmToken: null,
							artifacts: {
								compose: composeResult.details ?? null,
							},
						},
					};
				}

				const approvalRequired = network === "mainnet";
				const confirmToken = approvalRequired
					? createConfirmToken({
							runId,
							network,
							intent,
						})
					: null;

				if (runMode === "analysis") {
					rememberWorkflowSession({
						runId,
						network,
						intent,
						confirmToken,
						poolCandidates: [],
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
							approvalRequired,
							confirmToken,
							artifacts: {
								analysis: {
									status: "ready",
								},
							},
						},
					};
				}

				if (runMode === "simulate") {
					const simulateArtifact =
						intent.type === "near.transfer.near"
							? await simulateNearTransfer({
									intent,
									network,
									rpcUrl: params.rpcUrl,
									fromAccountId: params.fromAccountId,
								})
							: intent.type === "near.transfer.ft"
								? await simulateFtTransfer({
										intent,
										network,
										rpcUrl: params.rpcUrl,
										fromAccountId: params.fromAccountId,
									})
								: intent.type === "near.swap.ref"
									? await simulateRefSwap({
											intent,
											network,
											rpcUrl: params.rpcUrl,
											fromAccountId: params.fromAccountId,
										})
									: intent.type === "near.swap.intents"
										? await simulateNearIntentsSwap({
												intent,
												network,
												fromAccountId: params.fromAccountId,
												apiKey: params.apiKey,
												jwt: params.jwt,
											})
										: intent.type === "near.lp.ref.add"
											? await simulateRefAddLiquidity({
													intent,
													network,
													rpcUrl: params.rpcUrl,
													fromAccountId: params.fromAccountId,
												})
											: intent.type === "near.ref.withdraw"
												? await simulateRefWithdraw({
														intent,
														network,
														rpcUrl: params.rpcUrl,
														fromAccountId: params.fromAccountId,
													})
												: await simulateRefRemoveLiquidity({
														intent,
														network,
														rpcUrl: params.rpcUrl,
														fromAccountId: params.fromAccountId,
													});
					const sessionIntent: NearWorkflowIntent =
						(intent.type === "near.lp.ref.add" ||
							intent.type === "near.lp.ref.remove") &&
						intent.poolId == null &&
						typeof (simulateArtifact as { poolId?: unknown }).poolId ===
							"number"
							? {
									...intent,
									poolId: (simulateArtifact as { poolId: number }).poolId,
								}
							: intent.type === "near.swap.intents"
								? {
										...intent,
										originAsset:
											typeof (
												simulateArtifact as {
													originAssetId?: unknown;
												}
											).originAssetId === "string"
												? (
														simulateArtifact as {
															originAssetId: string;
														}
													).originAssetId
												: intent.originAsset,
										destinationAsset:
											typeof (
												simulateArtifact as {
													destinationAssetId?: unknown;
												}
											).destinationAssetId === "string"
												? (
														simulateArtifact as {
															destinationAssetId: string;
														}
													).destinationAssetId
												: intent.destinationAsset,
										depositAddress:
											typeof (
												simulateArtifact as {
													quoteResponse?: {
														quote?: { depositAddress?: unknown };
													};
												}
											).quoteResponse?.quote?.depositAddress === "string"
												? (
														simulateArtifact as {
															quoteResponse: {
																quote: { depositAddress: string };
															};
														}
													).quoteResponse.quote.depositAddress
												: intent.depositAddress,
										depositMemo:
											typeof (
												simulateArtifact as {
													quoteResponse?: {
														quote?: { depositMemo?: unknown };
													};
												}
											).quoteResponse?.quote?.depositMemo === "string"
												? (
														simulateArtifact as {
															quoteResponse: {
																quote: { depositMemo: string };
															};
														}
													).quoteResponse.quote.depositMemo
												: intent.depositMemo,
									}
								: intent;
					const sessionConfirmToken = approvalRequired
						? createConfirmToken({
								runId,
								network,
								intent: sessionIntent,
							})
						: null;
					const sessionPoolCandidates =
						sessionIntent.type === "near.lp.ref.add" ||
						sessionIntent.type === "near.lp.ref.remove"
							? normalizeRefPoolCandidates(
									(simulateArtifact as { poolCandidates?: unknown })
										.poolCandidates,
								)
							: [];
					rememberWorkflowSession({
						runId,
						network,
						intent: sessionIntent,
						confirmToken: sessionConfirmToken,
						poolCandidates: sessionPoolCandidates,
					});
					return {
						content: [
							{
								type: "text",
								text: buildSimulateResultSummary(intent.type, simulateArtifact),
							},
						],
						details: {
							runId,
							runMode,
							network,
							intentType: sessionIntent.type,
							intent: sessionIntent,
							approvalRequired,
							confirmToken: sessionConfirmToken,
							artifacts: {
								simulate: simulateArtifact,
							},
						},
					};
				}

				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				if (approvalRequired && params.confirmToken !== confirmToken) {
					throw new Error(
						`Invalid confirmToken for runId=${runId}. expected=${confirmToken} provided=${params.confirmToken ?? "null"}.`,
					);
				}
				const submitTxHash =
					typeof params.txHash === "string" && params.txHash.trim()
						? params.txHash.trim()
						: typeof hints.txHash === "string" && hints.txHash.trim()
							? hints.txHash.trim()
							: undefined;
				const submitDepositAddress =
					typeof params.depositAddress === "string" &&
					params.depositAddress.trim()
						? params.depositAddress.trim()
						: typeof hints.depositAddress === "string" &&
								hints.depositAddress.trim()
							? hints.depositAddress.trim()
							: undefined;
				const submitDepositMemo =
					typeof params.depositMemo === "string" && params.depositMemo.trim()
						? params.depositMemo.trim()
						: typeof hints.depositMemo === "string" && hints.depositMemo.trim()
							? hints.depositMemo.trim()
							: undefined;
				let effectiveIntentsDepositAddress: string | undefined;
				let effectiveIntentsDepositMemo: string | undefined;
				if (intent.type === "near.swap.intents") {
					if (!submitTxHash) {
						throw new Error(
							"near.swap.intents execute requires txHash from the deposit transaction.",
						);
					}
					effectiveIntentsDepositAddress =
						submitDepositAddress ?? intent.depositAddress;
					effectiveIntentsDepositMemo = submitDepositMemo ?? intent.depositMemo;
					if (!effectiveIntentsDepositAddress) {
						throw new Error(
							"near.swap.intents execute requires depositAddress (use simulate output or pass depositAddress).",
						);
					}
				}

				const executeTool =
					intent.type === "near.transfer.near"
						? resolveExecuteTool("near_transferNear")
						: intent.type === "near.transfer.ft"
							? resolveExecuteTool("near_transferFt")
							: intent.type === "near.swap.ref"
								? resolveExecuteTool("near_swapRef")
								: intent.type === "near.ref.withdraw"
									? resolveExecuteTool("near_withdrawRefToken")
									: intent.type === "near.swap.intents"
										? resolveExecuteTool("near_submitIntentsDeposit")
										: intent.type === "near.lp.ref.add"
											? resolveExecuteTool("near_addLiquidityRef")
											: resolveExecuteTool("near_removeLiquidityRef");
				const executeResult = await executeTool.execute("near-wf-exec", {
					...(intent.type === "near.transfer.near"
						? {
								toAccountId: intent.toAccountId,
								amountYoctoNear: intent.amountYoctoNear,
							}
						: intent.type === "near.transfer.ft"
							? {
									ftContractId: intent.ftContractId,
									toAccountId: intent.toAccountId,
									amountRaw: intent.amountRaw,
									gas: intent.gas,
									attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
								}
							: intent.type === "near.swap.ref"
								? {
										tokenInId: intent.tokenInId,
										tokenOutId: intent.tokenOutId,
										amountInRaw: intent.amountInRaw,
										minAmountOutRaw: intent.minAmountOutRaw,
										poolId: intent.poolId,
										slippageBps: intent.slippageBps,
										refContractId: intent.refContractId,
										autoRegisterOutput: intent.autoRegisterOutput,
										gas: intent.gas,
										attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
									}
								: intent.type === "near.ref.withdraw"
									? {
											tokenId: intent.tokenId,
											amountRaw: intent.amountRaw,
											withdrawAll: intent.withdrawAll,
											refContractId: intent.refContractId,
											autoRegisterReceiver: intent.autoRegisterReceiver,
											gas: intent.gas,
											attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
										}
									: intent.type === "near.swap.intents"
										? {
												txHash: submitTxHash,
												depositAddress: effectiveIntentsDepositAddress,
												depositMemo: effectiveIntentsDepositMemo,
												nearSenderAccount:
													intent.accountId ?? params.fromAccountId,
												apiBaseUrl: params.apiBaseUrl ?? intent.apiBaseUrl,
												apiKey: params.apiKey,
												jwt: params.jwt,
											}
										: intent.type === "near.lp.ref.add"
											? {
													poolId: intent.poolId,
													amountARaw: intent.amountARaw,
													amountBRaw: intent.amountBRaw,
													tokenAId: intent.tokenAId,
													tokenBId: intent.tokenBId,
													refContractId: intent.refContractId,
													autoRegisterExchange: intent.autoRegisterExchange,
													autoRegisterTokens: intent.autoRegisterTokens,
													gas: intent.gas,
													attachedDepositYoctoNear:
														intent.attachedDepositYoctoNear,
												}
											: {
													poolId: intent.poolId,
													shares: intent.shares,
													shareBps: intent.shareBps,
													minAmountsRaw: intent.minAmountsRaw,
													minAmountARaw: intent.minAmountARaw,
													minAmountBRaw: intent.minAmountBRaw,
													tokenAId: intent.tokenAId,
													tokenBId: intent.tokenBId,
													refContractId: intent.refContractId,
													autoWithdraw: intent.autoWithdraw,
													autoRegisterReceiver: intent.autoRegisterReceiver,
													gas: intent.gas,
													attachedDepositYoctoNear:
														intent.attachedDepositYoctoNear,
												}),
					network,
					rpcUrl: params.rpcUrl,
					fromAccountId: intent.fromAccountId ?? params.fromAccountId,
					privateKey: params.privateKey,
					confirmMainnet: params.confirmMainnet,
				});

				const executeDetails = executeResult.details as
					| {
							txHash?: string;
					  }
					| undefined;
				const shouldTrackIntentsStatus =
					intent.type === "near.swap.intents"
						? shouldWaitForIntentsFinalStatus(params.waitForFinalStatus, hints)
						: false;
				const statusTracking =
					intent.type === "near.swap.intents" &&
					shouldTrackIntentsStatus &&
					effectiveIntentsDepositAddress
						? await pollNearIntentsStatusUntilFinal({
								baseUrl: resolveNearIntentsApiBaseUrl(
									params.apiBaseUrl ?? intent.apiBaseUrl,
								),
								headers: resolveNearIntentsHeaders({
									apiKey: params.apiKey,
									jwt: params.jwt,
								}),
								depositAddress: effectiveIntentsDepositAddress,
								depositMemo: effectiveIntentsDepositMemo,
								intervalMs: parseIntentsStatusPollIntervalMs(
									params.statusPollIntervalMs,
								),
								timeoutMs: parseIntentsStatusTimeoutMs(params.statusTimeoutMs),
							})
						: null;
				const executeArtifact =
					intent.type === "near.swap.intents" && executeDetails
						? {
								...(executeDetails as Record<string, unknown>),
								depositAddress: effectiveIntentsDepositAddress ?? null,
								depositMemo: effectiveIntentsDepositMemo ?? null,
								statusTracking:
									shouldTrackIntentsStatus && statusTracking
										? statusTracking
										: shouldTrackIntentsStatus
											? {
													timedOut: true,
													attempts: 0,
													latestStatus: null,
													lastError:
														"status tracking was requested but depositAddress is missing",
													history: [],
												}
											: null,
							}
						: (executeDetails ?? null);
				return {
					content: [
						{
							type: "text",
							text: `Workflow executed: ${intent.type} ${buildExecuteResultSummary(executeDetails)}`,
						},
					],
					details: {
						runId,
						runMode,
						network,
						intentType: intent.type,
						intent,
						approvalRequired,
						confirmToken,
						confirmTokenMatched:
							!approvalRequired || params.confirmToken === confirmToken,
						artifacts: {
							execute: executeArtifact,
						},
					},
				};
			},
		}),
	];
}
