import { createHash, randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	type BurrowAccountAllPositionsView,
	type BurrowAccountAssetView,
	type BurrowAssetDetailedView,
	fetchBurrowAccountAllPositions,
	fetchBurrowAsset,
	fetchBurrowAssetsIndex,
	getBurrowContractId,
	parseBurrowActionAmountRaw,
	parseBurrowExtraDecimals,
	resolveBurrowTokenId,
	toBurrowInnerAmount,
} from "../burrow.js";
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

type NearBurrowSupplyIntent = {
	type: "near.lend.burrow.supply";
	tokenId: string;
	amountRaw: string;
	asCollateral: boolean;
	burrowContractId?: string;
	fromAccountId?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBurrowBorrowIntent = {
	type: "near.lend.burrow.borrow";
	tokenId: string;
	amountRaw: string;
	withdrawToWallet: boolean;
	burrowContractId?: string;
	fromAccountId?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBurrowRepayIntent = {
	type: "near.lend.burrow.repay";
	tokenId: string;
	amountRaw: string;
	burrowContractId?: string;
	fromAccountId?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBurrowWithdrawIntent = {
	type: "near.lend.burrow.withdraw";
	tokenId: string;
	amountRaw: string;
	recipientId?: string;
	burrowContractId?: string;
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
	| NearRefWithdrawIntent
	| NearBurrowSupplyIntent
	| NearBurrowBorrowIntent
	| NearBurrowRepayIntent
	| NearBurrowWithdrawIntent;

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
	burrowContractId?: string;
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
	recipientId?: string;
	recipient?: string;
	asCollateral?: boolean;
	withdrawToWallet?: boolean;
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
	signedTxBase64?: string;
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
	burrowContractId?: string;
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
	swapType?: NearIntentsSwapType;
	depositAddress?: string;
	depositMemo?: string;
	txHash?: string;
	waitForFinalStatus?: boolean;
	confirmMainnet?: boolean;
	confirmToken?: string;
	withdrawAll?: boolean;
	autoWithdraw?: boolean;
	asCollateral?: boolean;
	withdrawToWallet?: boolean;
	recipientId?: string;
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

type NearIntentsAnyInputWithdrawalsResponse = {
	asset?: string;
	recipient?: string;
	affiliateRecipient?: string;
	withdrawals?: unknown;
	page?: number;
	limit?: number;
	total?: number;
};

type NearIntentsAnyInputWithdrawal = {
	status: string | null;
	amountOut: string | null;
	amountOutFormatted: string | null;
	amountOutUsd: string | null;
	withdrawFee: string | null;
	withdrawFeeFormatted: string | null;
	withdrawFeeUsd: string | null;
	timestamp: string | null;
	hash: string | null;
	raw: Record<string, unknown>;
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

type NearIntentsOutcomeCategory =
	| "success"
	| "pending"
	| "failed"
	| "refunded"
	| "incomplete_deposit"
	| "unknown";

type NearIntentsOutcomeSummary = {
	category: NearIntentsOutcomeCategory;
	sourceStatus: string | null;
	reasonCode: string | null;
	reason: string | null;
	remediation: string[];
};

type NearBurrowWorkflowRiskBand = "safe" | "warning" | "critical";

const WORKFLOW_SESSION_BY_RUN_ID = new Map<string, WorkflowSessionRecord>();
let latestWorkflowSession: WorkflowSessionRecord | null = null;
const DEFAULT_NEAR_SWAP_MAX_SLIPPAGE_BPS = 1000;
const HARD_MAX_NEAR_SWAP_SLIPPAGE_BPS = 5000;
const DEFAULT_NEAR_INTENTS_API_BASE_URL = "https://1click.chaindefuser.com";
const DEFAULT_INTENTS_STATUS_POLL_INTERVAL_MS = 2_000;
const DEFAULT_INTENTS_STATUS_TIMEOUT_MS = 45_000;
const DEFAULT_BURROW_WORKFLOW_RISK_WARNING_RATIO = 0.6;
const DEFAULT_BURROW_WORKFLOW_RISK_CRITICAL_RATIO = 0.85;

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

function formatBurrowWorkflowRatioPercent(value: number): string {
	return `${(value * 100).toFixed(2)}%`;
}

function buildBurrowWorkflowRiskPolicyLabel(): string {
	return `warning>=${formatBurrowWorkflowRatioPercent(DEFAULT_BURROW_WORKFLOW_RISK_WARNING_RATIO)} critical>=${formatBurrowWorkflowRatioPercent(DEFAULT_BURROW_WORKFLOW_RISK_CRITICAL_RATIO)}`;
}

function resolveBurrowWorkflowRiskBand(
	level: "low" | "medium" | "high",
): NearBurrowWorkflowRiskBand {
	if (level === "high") return "critical";
	if (level === "medium") return "warning";
	return "safe";
}

function normalizeConfirmTokenValue(
	value: string | undefined,
): string | undefined {
	if (!value) return undefined;
	const normalized = value.trim();
	if (!normalized) return undefined;
	if (/^near-[a-z0-9]+$/i.test(normalized)) {
		return normalized.toUpperCase();
	}
	return normalized;
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
	if (typeof hints.waitForFinalStatus === "boolean") {
		return hints.waitForFinalStatus;
	}
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

function pickOptionalText(
	value: Record<string, unknown>,
	key: string,
): string | null {
	const candidate = value[key];
	return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function normalizeNearIntentsAnyInputWithdrawals(value: unknown): {
	asset: string | null;
	recipient: string | null;
	affiliateRecipient: string | null;
	withdrawals: NearIntentsAnyInputWithdrawal[];
	page: number | null;
	limit: number | null;
	total: number | null;
} {
	const root =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	const rawWithdrawalsSource = Array.isArray(root.withdrawals)
		? root.withdrawals
		: root.withdrawals && typeof root.withdrawals === "object"
			? [root.withdrawals]
			: Array.isArray(value)
				? value
				: [];
	const withdrawals: NearIntentsAnyInputWithdrawal[] = rawWithdrawalsSource
		.filter(
			(entry): entry is Record<string, unknown> =>
				Boolean(entry) && typeof entry === "object",
		)
		.map((entry) => ({
			status: pickOptionalText(entry, "status"),
			amountOut: pickOptionalText(entry, "amountOut"),
			amountOutFormatted: pickOptionalText(entry, "amountOutFormatted"),
			amountOutUsd: pickOptionalText(entry, "amountOutUsd"),
			withdrawFee: pickOptionalText(entry, "withdrawFee"),
			withdrawFeeFormatted: pickOptionalText(entry, "withdrawFeeFormatted"),
			withdrawFeeUsd: pickOptionalText(entry, "withdrawFeeUsd"),
			timestamp: pickOptionalText(entry, "timestamp"),
			hash: pickOptionalText(entry, "hash"),
			raw: entry,
		}));
	return {
		asset: pickOptionalText(root, "asset"),
		recipient: pickOptionalText(root, "recipient"),
		affiliateRecipient: pickOptionalText(root, "affiliateRecipient"),
		withdrawals,
		page:
			typeof root.page === "number" && Number.isFinite(root.page)
				? Math.floor(root.page)
				: null,
		limit:
			typeof root.limit === "number" && Number.isFinite(root.limit)
				? Math.floor(root.limit)
				: null,
		total:
			typeof root.total === "number" && Number.isFinite(root.total)
				? Math.floor(root.total)
				: null,
	};
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

function isNearLikeTokenInput(tokenInput: string): boolean {
	const normalized = tokenInput.trim().toLowerCase();
	return (
		normalized === "near" ||
		normalized === "wnear" ||
		normalized.includes("wrap.near") ||
		normalized.includes("wrap.testnet")
	);
}

function resolveBurrowActionAmountRaw(params: {
	intentType: NearWorkflowIntent["type"];
	tokenInput: string;
	network?: string;
	valueRaw?: string;
	valueNear?: string | number;
	valueUi?: string | number;
}): string {
	if (typeof params.valueRaw === "string" && params.valueRaw.trim()) {
		return parseBurrowActionAmountRaw(params.valueRaw, "amountRaw");
	}
	if (params.valueNear != null && isNearLikeTokenInput(params.tokenInput)) {
		return parseBurrowActionAmountRaw(
			toYoctoNear(params.valueNear).toString(),
			"amountNear",
		);
	}
	if (params.valueUi != null) {
		const uiValue =
			typeof params.valueUi === "number"
				? params.valueUi.toString()
				: params.valueUi.trim();
		if (!uiValue) {
			throw new Error(`${params.intentType} amount is empty`);
		}
		if (isNearLikeTokenInput(params.tokenInput)) {
			return parseBurrowActionAmountRaw(
				toYoctoNear(uiValue).toString(),
				"amountIn",
			);
		}
		const decimals = getRefTokenDecimalsHint({
			network: params.network,
			tokenIdOrSymbol: params.tokenInput,
		});
		if (decimals == null) {
			throw new Error(
				`Cannot infer decimals for ${params.tokenInput}. Provide amountRaw.`,
			);
		}
		const rawAmount = parseScaledDecimalToRaw(uiValue, decimals, "amountIn");
		return parseBurrowActionAmountRaw(rawAmount, "amountIn");
	}
	throw new Error(
		`${params.intentType} requires amountRaw (or provide amountNear/amountIn).`,
	);
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
	"burrow",
	"supply",
	"borrow",
	"repay",
	"withdraw",
	"lending",
	"collateral",
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

function parseSlippageBpsFromHint(
	value: string | undefined,
	unit: string | undefined,
): number | null {
	if (!value) return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	const normalizedUnit = unit?.trim().toLowerCase();
	const bps =
		normalizedUnit === "%" ||
		normalizedUnit === "percent" ||
		normalizedUnit === "pct"
			? parsed * 100
			: parsed;
	const rounded = Math.floor(bps);
	if (rounded < 0 || rounded > 5000) return null;
	return rounded;
}

function parseIntentHints(intentText?: string): ParsedIntentHints {
	if (!intentText || !intentText.trim()) return {};
	const text = intentText.trim();
	const lower = text.toLowerCase();
	const tokenAmountPairs = collectTokenAmountPairs(text);
	const toMatch = text.match(
		/(?:\bto\b|给|到)\s*([a-z0-9][a-z0-9._-]*(?:\.near)?)/i,
	);
	const nearAmountMatch = text.match(/(\d+(?:\.\d+)?)\s*near\b/i);
	const ftContractMatch = text.match(
		/(?:\bcontract\b|合约|\btoken\b)\s*[:：]?\s*([a-z0-9][a-z0-9._-]*(?:\.near)?)/i,
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
		/(?:slippage|滑点)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(%|percent|pct|bps)?/i,
	);
	const intentsSlippageMatch = text.match(
		/(?:slippagetolerance|intents\s*slippage|intents滑点)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(%|percent|pct|bps)?/i,
	);
	const refContractMatch = text.match(
		/(?:ref\s*contract|ref合约|交易所合约)\s*[:：]?\s*([a-z0-9][a-z0-9._-]*(?:\.near)?)/i,
	);
	const burrowContractMatch = text.match(
		/(?:burrow\s*contract|burrow合约|借贷合约)\s*[:：]?\s*([a-z0-9][a-z0-9._-]*(?:\.near)?)/i,
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
	const txHashLooseMatch = text.match(/\b(0x[a-f0-9]{32,})\b/i);
	const confirmTokenMatch = text.match(
		/(?:confirmtoken|confirm token|确认令牌|确认码)\s*[:：]?\s*([a-z0-9_-]{8,})/i,
	);
	const confirmTokenLooseMatch = text.match(/\b(near-[a-z0-9]{8,})\b/i);
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
		/(?:\btokenid\b|\btoken id\b|\btoken\b|币种|代币)\s*[:：]?\s*([a-z][a-z0-9._-]*)/i,
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
		lower.includes("defuse") ||
		lower.includes("any input") ||
		lower.includes("any_input") ||
		lower.includes("任意输入");
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
	const wantsNoWaitForFinalStatus =
		lower.includes("不等待完成") ||
		lower.includes("不用等待") ||
		lower.includes("无需等待") ||
		lower.includes("不跟踪状态") ||
		lower.includes("无需跟踪") ||
		lower.includes("不用跟踪") ||
		lower.includes("do not wait") ||
		lower.includes("don't wait") ||
		lower.includes("no wait");
	const wantsConfirmMainnet =
		lower.includes("确认主网执行") ||
		lower.includes("确认主网") ||
		lower.includes("confirm mainnet") ||
		lower.includes("confirmmainnet=true") ||
		lower.includes("confirmmainnet true");
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
	const hasBurrowKeyword =
		lower.includes("burrow") ||
		lower.includes("借贷") ||
		lower.includes("lending");
	const likelyBurrowSupply =
		hasBurrowKeyword &&
		(lower.includes("supply") ||
			lower.includes("deposit") ||
			lower.includes("lend") ||
			lower.includes("存入") ||
			lower.includes("供应") ||
			lower.includes("供给"));
	const likelyBurrowBorrow =
		hasBurrowKeyword &&
		(lower.includes("borrow") ||
			lower.includes("借款") ||
			lower.includes("借出") ||
			lower.includes("借入") ||
			lower.includes("借"));
	const likelyBurrowRepay =
		hasBurrowKeyword &&
		(lower.includes("repay") ||
			lower.includes("还款") ||
			lower.includes("归还") ||
			lower.includes("偿还"));
	const likelyBurrowWithdraw =
		hasBurrowKeyword &&
		(lower.includes("withdraw") ||
			lower.includes("提取") ||
			lower.includes("取出") ||
			lower.includes("提回") ||
			lower.includes("提现"));
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
	if (burrowContractMatch?.[1]) hints.burrowContractId = burrowContractMatch[1];
	if (!hints.tokenId && refWithdrawTokenBeforeActionMatch?.[1]) {
		hints.tokenId = refWithdrawTokenBeforeActionMatch[1];
	}
	if (!hints.tokenId && refWithdrawTokenAfterActionMatch?.[1]) {
		hints.tokenId = refWithdrawTokenAfterActionMatch[1];
	}
	if (hasBurrowKeyword && !hints.tokenId && tokenAmountPairs[0]) {
		hints.tokenId = tokenAmountPairs[0].token;
	}
	if (hasBurrowKeyword && !hints.amountRaw && !hints.amountNear) {
		const amountTokenPair = tokenAmountPairs.find((pair) => {
			if (!hints.tokenId) return true;
			return pair.token.toLowerCase() === hints.tokenId.toLowerCase();
		});
		if (amountTokenPair) {
			if (isNearLikeTokenInput(amountTokenPair.token)) {
				hints.amountNear = amountTokenPair.amount;
			} else {
				hints.amountInUi = amountTokenPair.amount;
			}
		}
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
		const parsed = parseSlippageBpsFromHint(slippageMatch[1], slippageMatch[2]);
		if (parsed != null) {
			hints.slippageBps = parsed;
		}
	}
	if (intentsSlippageMatch?.[1]) {
		const parsed = parseSlippageBpsFromHint(
			intentsSlippageMatch[1],
			intentsSlippageMatch[2],
		);
		if (parsed != null) {
			hints.slippageTolerance = parsed;
		}
	}
	if (refContractMatch?.[1]) {
		hints.refContractId = refContractMatch[1];
	}
	if (recipientMatch?.[1]) hints.recipient = recipientMatch[1];
	if (hasBurrowKeyword && recipientMatch?.[1]) {
		hints.recipientId = recipientMatch[1];
	}
	if (refundToMatch?.[1]) hints.refundTo = refundToMatch[1];
	if (depositAddressMatch?.[1]) hints.depositAddress = depositAddressMatch[1];
	if (depositMemoMatch?.[1]) hints.depositMemo = depositMemoMatch[1];
	if (txHashMatch?.[1]) hints.txHash = txHashMatch[1];
	if (!hints.txHash && txHashLooseMatch?.[1])
		hints.txHash = txHashLooseMatch[1];
	if (confirmTokenMatch?.[1]) {
		hints.confirmToken = normalizeConfirmTokenValue(confirmTokenMatch[1]);
	}
	if (!hints.confirmToken && confirmTokenLooseMatch?.[1]) {
		hints.confirmToken = normalizeConfirmTokenValue(confirmTokenLooseMatch[1]);
	}
	if (wantsNoWaitForFinalStatus) {
		hints.waitForFinalStatus = false;
	} else if (wantsWaitForFinalStatus) {
		hints.waitForFinalStatus = true;
	}
	if (wantsConfirmMainnet) hints.confirmMainnet = true;
	if (
		lower.includes("any input") ||
		lower.includes("any_input") ||
		lower.includes("任意输入")
	) {
		hints.swapType = "ANY_INPUT";
	}
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
	if (hasBurrowKeyword) {
		if (
			lower.includes("不作为抵押") ||
			lower.includes("不要抵押") ||
			lower.includes("without collateral") ||
			lower.includes("no collateral")
		) {
			hints.asCollateral = false;
		} else if (
			lower.includes("作为抵押") ||
			lower.includes("设为抵押") ||
			lower.includes("as collateral")
		) {
			hints.asCollateral = true;
		}
		if (
			lower.includes("不提到钱包") ||
			lower.includes("不提现到钱包") ||
			lower.includes("without withdraw") ||
			lower.includes("no withdraw to wallet")
		) {
			hints.withdrawToWallet = false;
		} else if (
			lower.includes("提到钱包") ||
			lower.includes("提回钱包") ||
			lower.includes("withdraw to wallet") ||
			lower.includes("borrow+withdraw")
		) {
			hints.withdrawToWallet = true;
		}
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
		hasBurrowKeyword &&
		(hints.tokenId ||
			hints.ftContractId ||
			hints.amountRaw ||
			hints.amountNear ||
			hints.burrowContractId)
	) {
		hints.intentType = likelyBurrowRepay
			? "near.lend.burrow.repay"
			: likelyBurrowBorrow
				? "near.lend.burrow.borrow"
				: likelyBurrowWithdraw
					? "near.lend.burrow.withdraw"
					: "near.lend.burrow.supply";
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
	if (params.intentType === "near.lend.burrow.supply") return params.intentType;
	if (params.intentType === "near.lend.burrow.borrow") return params.intentType;
	if (params.intentType === "near.lend.burrow.repay") return params.intentType;
	if (params.intentType === "near.lend.burrow.withdraw")
		return params.intentType;
	if (params.intentType === "near.lp.ref.add") return params.intentType;
	if (params.intentType === "near.lp.ref.remove") return params.intentType;
	if (params.intentType === "near.ref.withdraw") return params.intentType;
	if (params.intentType === "near.swap.intents") return params.intentType;
	if (params.intentType === "near.swap.ref") return params.intentType;
	if (params.intentType === "near.transfer.near") return params.intentType;
	if (params.intentType === "near.transfer.ft") return params.intentType;
	if (hints.intentType) return hints.intentType;
	if (
		params.burrowContractId ||
		params.asCollateral != null ||
		params.withdrawToWallet != null ||
		params.recipientId
	) {
		if (params.recipientId) return "near.lend.burrow.withdraw";
		if (params.withdrawToWallet != null) return "near.lend.burrow.borrow";
		if (params.asCollateral != null) return "near.lend.burrow.supply";
		if (params.intentText && /repay|还款|归还|偿还/i.test(params.intentText)) {
			return "near.lend.burrow.repay";
		}
		if (
			params.intentText &&
			/borrow|借款|借出|借入|借/i.test(params.intentText)
		) {
			return "near.lend.burrow.borrow";
		}
		if (
			params.intentText &&
			/withdraw|提取|取出|提回|提现/i.test(params.intentText)
		) {
			return "near.lend.burrow.withdraw";
		}
		return "near.lend.burrow.supply";
	}
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

	if (intentType === "near.lend.burrow.supply") {
		const tokenInput = normalizeTokenInput(
			params.tokenId ??
				hints.tokenId ??
				params.ftContractId ??
				hints.ftContractId ??
				"",
			"tokenId",
		);
		const amountRaw = resolveBurrowActionAmountRaw({
			intentType,
			tokenInput,
			network: params.network,
			valueRaw:
				params.amountRaw ??
				params.amountInRaw ??
				hints.amountRaw ??
				hints.amountInRaw,
			valueNear: params.amountNear ?? hints.amountNear,
			valueUi:
				params.amountIn ??
				hints.amountInUi ??
				params.amountNear ??
				hints.amountNear,
		});
		return {
			type: "near.lend.burrow.supply",
			tokenId: tokenInput,
			amountRaw,
			asCollateral: params.asCollateral ?? hints.asCollateral ?? true,
			burrowContractId:
				typeof params.burrowContractId === "string" &&
				params.burrowContractId.trim()
					? normalizeAccountId(params.burrowContractId, "burrowContractId")
					: typeof hints.burrowContractId === "string" &&
							hints.burrowContractId.trim()
						? normalizeAccountId(hints.burrowContractId, "burrowContractId")
						: undefined,
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

	if (intentType === "near.lend.burrow.borrow") {
		const tokenInput = normalizeTokenInput(
			params.tokenId ??
				hints.tokenId ??
				params.ftContractId ??
				hints.ftContractId ??
				"",
			"tokenId",
		);
		const amountRaw = resolveBurrowActionAmountRaw({
			intentType,
			tokenInput,
			network: params.network,
			valueRaw:
				params.amountRaw ??
				params.amountInRaw ??
				hints.amountRaw ??
				hints.amountInRaw,
			valueNear: params.amountNear ?? hints.amountNear,
			valueUi:
				params.amountIn ??
				hints.amountInUi ??
				params.amountNear ??
				hints.amountNear,
		});
		return {
			type: "near.lend.burrow.borrow",
			tokenId: tokenInput,
			amountRaw,
			withdrawToWallet:
				params.withdrawToWallet ?? hints.withdrawToWallet ?? true,
			burrowContractId:
				typeof params.burrowContractId === "string" &&
				params.burrowContractId.trim()
					? normalizeAccountId(params.burrowContractId, "burrowContractId")
					: typeof hints.burrowContractId === "string" &&
							hints.burrowContractId.trim()
						? normalizeAccountId(hints.burrowContractId, "burrowContractId")
						: undefined,
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

	if (intentType === "near.lend.burrow.repay") {
		const tokenInput = normalizeTokenInput(
			params.tokenId ??
				hints.tokenId ??
				params.ftContractId ??
				hints.ftContractId ??
				"",
			"tokenId",
		);
		const amountRaw = resolveBurrowActionAmountRaw({
			intentType,
			tokenInput,
			network: params.network,
			valueRaw:
				params.amountRaw ??
				params.amountInRaw ??
				hints.amountRaw ??
				hints.amountInRaw,
			valueNear: params.amountNear ?? hints.amountNear,
			valueUi:
				params.amountIn ??
				hints.amountInUi ??
				params.amountNear ??
				hints.amountNear,
		});
		return {
			type: "near.lend.burrow.repay",
			tokenId: tokenInput,
			amountRaw,
			burrowContractId:
				typeof params.burrowContractId === "string" &&
				params.burrowContractId.trim()
					? normalizeAccountId(params.burrowContractId, "burrowContractId")
					: typeof hints.burrowContractId === "string" &&
							hints.burrowContractId.trim()
						? normalizeAccountId(hints.burrowContractId, "burrowContractId")
						: undefined,
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

	if (intentType === "near.lend.burrow.withdraw") {
		const tokenInput = normalizeTokenInput(
			params.tokenId ??
				hints.tokenId ??
				params.ftContractId ??
				hints.ftContractId ??
				"",
			"tokenId",
		);
		const amountRaw = resolveBurrowActionAmountRaw({
			intentType,
			tokenInput,
			network: params.network,
			valueRaw:
				params.amountRaw ??
				params.amountInRaw ??
				hints.amountRaw ??
				hints.amountInRaw,
			valueNear: params.amountNear ?? hints.amountNear,
			valueUi:
				params.amountIn ??
				hints.amountInUi ??
				params.amountNear ??
				hints.amountNear,
		});
		const recipientInput =
			params.recipientId ??
			hints.recipientId ??
			params.recipient ??
			hints.recipient;
		return {
			type: "near.lend.burrow.withdraw",
			tokenId: tokenInput,
			amountRaw,
			recipientId:
				typeof recipientInput === "string" && recipientInput.trim()
					? normalizeAccountId(recipientInput, "recipientId")
					: undefined,
			burrowContractId:
				typeof params.burrowContractId === "string" &&
				params.burrowContractId.trim()
					? normalizeAccountId(params.burrowContractId, "burrowContractId")
					: typeof hints.burrowContractId === "string" &&
							hints.burrowContractId.trim()
						? normalizeAccountId(hints.burrowContractId, "burrowContractId")
						: undefined,
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
			swapType: params.swapType ?? hints.swapType ?? "EXACT_INPUT",
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
		params.burrowContractId ||
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
		params.asCollateral != null ||
		params.withdrawToWallet != null ||
		params.recipientId ||
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
		params.autoRegisterOutput != null ||
		params.burrowContractId
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
		params.burrowContractId ||
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
		params.asCollateral != null ||
		params.withdrawToWallet != null ||
		params.recipientId ||
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
		params.autoRegisterOutput != null ||
		params.burrowContractId
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
			hints.burrowContractId ||
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
			hints.autoWithdraw != null ||
			hints.asCollateral != null ||
			hints.withdrawToWallet != null ||
			hints.recipientId,
	);
}

function looksLikeFollowUpExecuteIntent(intentText?: string): boolean {
	if (!intentText || !intentText.trim()) return false;
	const lower = intentText.trim().toLowerCase();
	return (
		lower.includes("继续执行") ||
		lower.includes("执行刚才") ||
		lower.includes("刚才这笔") ||
		lower.includes("继续这笔") ||
		lower.includes("继续上一笔") ||
		lower.includes("continue execute") ||
		lower.includes("continue last") ||
		lower.includes("continue previous")
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

async function resolveBurrowTokenAndAssetForWorkflow(params: {
	network: string;
	rpcUrl?: string;
	burrowContractId?: string;
	tokenInput: string;
}): Promise<{
	burrowContractId: string;
	tokenId: string;
	extraDecimals: number;
	asset: BurrowAssetDetailedView;
}> {
	const burrowContractId = getBurrowContractId(
		params.network,
		params.burrowContractId,
	);
	const markets = await fetchBurrowAssetsIndex({
		network: params.network,
		rpcUrl: params.rpcUrl,
		burrowContractId,
		maxAssets: 256,
		pageSize: 64,
	});
	const tokenId = resolveBurrowTokenId({
		network: params.network,
		tokenInput: params.tokenInput,
		availableTokenIds: markets.map((entry) => entry.token_id.toLowerCase()),
	});
	const asset =
		markets.find((entry) => entry.token_id.toLowerCase() === tokenId) ??
		(await fetchBurrowAsset({
			network: params.network,
			rpcUrl: params.rpcUrl,
			burrowContractId,
			tokenId,
		}));
	if (!asset) {
		throw new Error(`Burrow market not found for token: ${tokenId}`);
	}
	return {
		burrowContractId,
		tokenId,
		extraDecimals: parseBurrowExtraDecimals(asset.config?.extra_decimals),
		asset,
	};
}

function sumBurrowAccountAssetInnerByToken(params: {
	assets?: BurrowAccountAssetView[];
	tokenId: string;
}): bigint {
	if (!Array.isArray(params.assets) || params.assets.length === 0) {
		return 0n;
	}
	return params.assets.reduce((accumulator, asset) => {
		if (!asset || asset.token_id.toLowerCase() !== params.tokenId) {
			return accumulator;
		}
		return (
			accumulator +
			parseNonNegativeBigInt(asset.balance, "burrow.asset.balance")
		);
	}, 0n);
}

function sumBurrowPositionAssetInnerByToken(params: {
	positions?: BurrowAccountAllPositionsView["positions"];
	tokenId: string;
	side: "collateral" | "borrowed";
}): bigint {
	if (!params.positions) return 0n;
	let total = 0n;
	for (const position of Object.values(params.positions)) {
		if (!position || typeof position !== "object") continue;
		const assets = position[params.side];
		if (!Array.isArray(assets)) continue;
		total += sumBurrowAccountAssetInnerByToken({
			assets,
			tokenId: params.tokenId,
		});
	}
	return total;
}

function hasPositiveBurrowAssetBalance(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { balance?: unknown };
	if (typeof candidate.balance !== "string") return false;
	try {
		return parseNonNegativeBigInt(candidate.balance, "burrow.balance") > 0n;
	} catch {
		return false;
	}
}

function countBurrowPositionAssetsBySide(params: {
	positions?: BurrowAccountAllPositionsView["positions"];
	side: "collateral" | "borrowed";
}): number {
	if (!params.positions) return 0;
	let count = 0;
	for (const position of Object.values(params.positions)) {
		if (!position || typeof position !== "object") continue;
		const assets = position[params.side];
		if (!Array.isArray(assets)) continue;
		for (const asset of assets) {
			if (hasPositiveBurrowAssetBalance(asset)) count += 1;
		}
	}
	return count;
}

function burrowInnerToRawString(
	innerAmount: bigint,
	extraDecimals: number,
): string {
	const extra = parseBurrowExtraDecimals(extraDecimals);
	if (extra <= 0) return innerAmount.toString();
	return (innerAmount / 10n ** BigInt(extra)).toString();
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

function isNearIntentsNotFoundError(message: string): boolean {
	return (
		message.includes("(404)") ||
		/deposit .*not found/i.test(message) ||
		/correlation.*not found/i.test(message) ||
		/not found/i.test(message)
	);
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
	depositAddress?: string;
	depositMemo?: string;
	correlationId?: string;
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
	if (!params.depositAddress && !params.correlationId) {
		throw new Error(
			"pollNearIntentsStatusUntilFinal requires depositAddress or correlationId",
		);
	}
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
					depositMemo: params.depositAddress ? params.depositMemo : undefined,
					correlationId: params.correlationId,
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
			const isNotIndexedYet = isNearIntentsNotFoundError(message);
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

async function pollNearIntentsAnyInputWithdrawalsUntilFound(params: {
	baseUrl: string;
	headers: Record<string, string>;
	depositAddress: string;
	depositMemo?: string;
	timeoutMs: number;
	intervalMs: number;
}): Promise<{
	timedOut: boolean;
	attempts: number;
	latest: Awaited<
		ReturnType<typeof queryNearIntentsAnyInputWithdrawals>
	> | null;
	lastError: string | null;
	history: Array<{
		attempt: number;
		status: "FOUND" | "EMPTY" | "NOT_FOUND" | "ERROR";
		count?: number;
		message?: string;
	}>;
}> {
	const deadlineAt = Date.now() + params.timeoutMs;
	let attempts = 0;
	let latest: Awaited<
		ReturnType<typeof queryNearIntentsAnyInputWithdrawals>
	> | null = null;
	let lastError: string | null = null;
	const history: Array<{
		attempt: number;
		status: "FOUND" | "EMPTY" | "NOT_FOUND" | "ERROR";
		count?: number;
		message?: string;
	}> = [];

	while (Date.now() <= deadlineAt) {
		attempts += 1;
		try {
			const response = await queryNearIntentsAnyInputWithdrawals({
				baseUrl: params.baseUrl,
				headers: params.headers,
				depositAddress: params.depositAddress,
				depositMemo: params.depositMemo,
			});
			latest = response;
			const count = response.withdrawals.length;
			history.push({
				attempt: attempts,
				status: count > 0 ? "FOUND" : "EMPTY",
				count,
			});
			if (count > 0) {
				return {
					timedOut: false,
					attempts,
					latest,
					lastError,
					history,
				};
			}
		} catch (error) {
			const message = extractErrorText(error);
			lastError = message;
			const notReady = isNearIntentsNotFoundError(message);
			history.push({
				attempt: attempts,
				status: notReady ? "NOT_FOUND" : "ERROR",
				message,
			});
			if (!notReady) {
				return {
					timedOut: true,
					attempts,
					latest,
					lastError,
					history,
				};
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
		latest,
		lastError,
		history,
	};
}

async function queryNearIntentsAnyInputWithdrawals(params: {
	baseUrl: string;
	headers: Record<string, string>;
	depositAddress: string;
	depositMemo?: string;
}): Promise<{
	endpoint: string;
	httpStatus: number;
	asset: string | null;
	recipient: string | null;
	affiliateRecipient: string | null;
	page: number | null;
	limit: number | null;
	total: number | null;
	withdrawals: NearIntentsAnyInputWithdrawal[];
}> {
	const response =
		await fetchNearIntentsJson<NearIntentsAnyInputWithdrawalsResponse>({
			baseUrl: params.baseUrl,
			path: "/v0/any-input/withdrawals",
			method: "GET",
			query: {
				depositAddress: params.depositAddress,
				depositMemo: params.depositMemo,
				limit: "50",
				sortOrder: "desc",
			},
			headers: params.headers,
		});
	const normalized = normalizeNearIntentsAnyInputWithdrawals(response.payload);
	return {
		endpoint: response.url,
		httpStatus: response.status,
		asset: normalized.asset,
		recipient: normalized.recipient,
		affiliateRecipient: normalized.affiliateRecipient,
		page: normalized.page,
		limit: normalized.limit,
		total: normalized.total,
		withdrawals: normalized.withdrawals,
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

async function simulateBurrowSupply(params: {
	intent: NearBurrowSupplyIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status:
		| "success"
		| "insufficient_balance"
		| "market_unavailable"
		| "collateral_unavailable";
	fromAccountId: string;
	burrowContractId: string;
	tokenId: string;
	amountRaw: string;
	availableRaw: string;
	requiredRaw: string;
	asCollateral: boolean;
	canDeposit: boolean;
	canUseAsCollateral: boolean;
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const { burrowContractId, tokenId, asset } =
		await resolveBurrowTokenAndAssetForWorkflow({
			network: params.network,
			rpcUrl: params.rpcUrl,
			burrowContractId: params.intent.burrowContractId,
			tokenInput: params.intent.tokenId,
		});
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
	const availableRaw = parseNonNegativeBigInt(
		decodeCallFunctionResult(query),
		"ft_balance_of",
	);
	const requiredRaw = parsePositiveBigInt(params.intent.amountRaw, "amountRaw");
	const canDeposit = asset.config?.can_deposit !== false;
	const canUseAsCollateral = asset.config?.can_use_as_collateral !== false;
	return {
		status: !canDeposit
			? "market_unavailable"
			: params.intent.asCollateral && !canUseAsCollateral
				? "collateral_unavailable"
				: availableRaw >= requiredRaw
					? "success"
					: "insufficient_balance",
		fromAccountId,
		burrowContractId,
		tokenId,
		amountRaw: requiredRaw.toString(),
		availableRaw: availableRaw.toString(),
		requiredRaw: requiredRaw.toString(),
		asCollateral: params.intent.asCollateral,
		canDeposit,
		canUseAsCollateral,
	};
}

async function simulateBurrowBorrow(params: {
	intent: NearBurrowBorrowIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "market_unavailable" | "insufficient_collateral";
	fromAccountId: string;
	burrowContractId: string;
	tokenId: string;
	amountRaw: string;
	amountInner: string;
	extraDecimals: number;
	withdrawToWallet: boolean;
	canBorrow: boolean;
	collateralAssetCount: number;
	borrowedAssetCount: number;
	riskLevel: "low" | "medium" | "high";
	riskBand: NearBurrowWorkflowRiskBand;
	riskNotes: string[];
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const { burrowContractId, tokenId, extraDecimals, asset } =
		await resolveBurrowTokenAndAssetForWorkflow({
			network: params.network,
			rpcUrl: params.rpcUrl,
			burrowContractId: params.intent.burrowContractId,
			tokenInput: params.intent.tokenId,
		});
	const amountRaw = parsePositiveBigInt(params.intent.amountRaw, "amountRaw");
	const amountInner = toBurrowInnerAmount(amountRaw.toString(), extraDecimals);
	const canBorrow = asset.config?.can_borrow !== false;
	const snapshot = await fetchBurrowAccountAllPositions({
		network: params.network,
		rpcUrl: params.rpcUrl,
		burrowContractId,
		accountId: fromAccountId,
	});
	const collateralAssetCount = countBurrowPositionAssetsBySide({
		positions: snapshot?.positions,
		side: "collateral",
	});
	const borrowedAssetCount = countBurrowPositionAssetsBySide({
		positions: snapshot?.positions,
		side: "borrowed",
	});
	const riskNotes: string[] = [];
	if (collateralAssetCount <= 0) {
		riskNotes.push(
			"No non-zero Burrow collateral detected. Borrow may fail or be unsafe.",
		);
	}
	if (borrowedAssetCount > 0) {
		riskNotes.push(
			"Existing Burrow debt detected; monitor health before increasing leverage.",
		);
	}
	const riskLevel: "low" | "medium" | "high" =
		collateralAssetCount <= 0
			? "high"
			: borrowedAssetCount > 0
				? "medium"
				: "low";
	const riskBand = resolveBurrowWorkflowRiskBand(riskLevel);
	return {
		status: !canBorrow
			? "market_unavailable"
			: collateralAssetCount <= 0
				? "insufficient_collateral"
				: "success",
		fromAccountId,
		burrowContractId,
		tokenId,
		amountRaw: amountRaw.toString(),
		amountInner,
		extraDecimals,
		withdrawToWallet: params.intent.withdrawToWallet,
		canBorrow,
		collateralAssetCount,
		borrowedAssetCount,
		riskLevel,
		riskBand,
		riskNotes,
	};
}

async function simulateBurrowRepay(params: {
	intent: NearBurrowRepayIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance" | "no_debt";
	fromAccountId: string;
	burrowContractId: string;
	tokenId: string;
	amountRaw: string;
	availableRaw: string;
	requiredRaw: string;
	borrowedRaw: string;
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const { burrowContractId, tokenId, extraDecimals } =
		await resolveBurrowTokenAndAssetForWorkflow({
			network: params.network,
			rpcUrl: params.rpcUrl,
			burrowContractId: params.intent.burrowContractId,
			tokenInput: params.intent.tokenId,
		});
	const balanceQuery = await callNearRpc<NearCallFunctionResult>({
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
	const availableRaw = parseNonNegativeBigInt(
		decodeCallFunctionResult(balanceQuery),
		"ft_balance_of",
	);
	const requiredRaw = parsePositiveBigInt(params.intent.amountRaw, "amountRaw");
	const snapshot = await fetchBurrowAccountAllPositions({
		network: params.network,
		rpcUrl: params.rpcUrl,
		burrowContractId,
		accountId: fromAccountId,
	});
	const borrowedInner = snapshot
		? sumBurrowPositionAssetInnerByToken({
				positions: snapshot.positions,
				tokenId,
				side: "borrowed",
			})
		: 0n;
	const borrowedRaw = parseNonNegativeBigInt(
		burrowInnerToRawString(borrowedInner, extraDecimals),
		"borrowedRaw",
	);
	return {
		status:
			borrowedRaw <= 0n
				? "no_debt"
				: availableRaw >= requiredRaw
					? "success"
					: "insufficient_balance",
		fromAccountId,
		burrowContractId,
		tokenId,
		amountRaw: requiredRaw.toString(),
		availableRaw: availableRaw.toString(),
		requiredRaw: requiredRaw.toString(),
		borrowedRaw: borrowedRaw.toString(),
	};
}

async function simulateBurrowWithdraw(params: {
	intent: NearBurrowWithdrawIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status:
		| "success"
		| "insufficient_balance"
		| "no_supply"
		| "market_unavailable"
		| "risk_check_required";
	fromAccountId: string;
	burrowContractId: string;
	tokenId: string;
	amountRaw: string;
	amountInner: string;
	availableRaw: string;
	availableInner: string;
	requiredRaw: string;
	requiredInner: string;
	recipientId: string | null;
	canWithdraw: boolean;
	suppliedInner: string;
	collateralInner: string;
	borrowedAssetCount: number;
	riskLevel: "low" | "medium" | "high";
	riskBand: NearBurrowWorkflowRiskBand;
	riskNotes: string[];
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const { burrowContractId, tokenId, extraDecimals, asset } =
		await resolveBurrowTokenAndAssetForWorkflow({
			network: params.network,
			rpcUrl: params.rpcUrl,
			burrowContractId: params.intent.burrowContractId,
			tokenInput: params.intent.tokenId,
		});
	const amountRaw = parsePositiveBigInt(params.intent.amountRaw, "amountRaw");
	const amountInner = toBurrowInnerAmount(amountRaw.toString(), extraDecimals);
	const requiredInner = parsePositiveBigInt(amountInner, "amountInner");
	const snapshot = await fetchBurrowAccountAllPositions({
		network: params.network,
		rpcUrl: params.rpcUrl,
		burrowContractId,
		accountId: fromAccountId,
	});
	const suppliedInner = sumBurrowAccountAssetInnerByToken({
		assets: snapshot?.supplied,
		tokenId,
	});
	const collateralInner = sumBurrowPositionAssetInnerByToken({
		positions: snapshot?.positions,
		tokenId,
		side: "collateral",
	});
	const availableInner = suppliedInner + collateralInner;
	const availableRaw = parseNonNegativeBigInt(
		burrowInnerToRawString(availableInner, extraDecimals),
		"availableRaw",
	);
	const canWithdraw = asset.config?.can_withdraw !== false;
	const borrowedAssetCount = countBurrowPositionAssetsBySide({
		positions: snapshot?.positions,
		side: "borrowed",
	});
	const usesCollateralPortion = requiredInner > suppliedInner;
	const requiresRiskCheck = borrowedAssetCount > 0 && usesCollateralPortion;
	const riskNotes: string[] = [];
	if (requiresRiskCheck) {
		riskNotes.push(
			"Withdrawal would consume collateral while debt exists; run deeper health check before execute.",
		);
	} else if (borrowedAssetCount > 0) {
		riskNotes.push(
			"Debt exists on Burrow. Prefer small withdraws from non-collateral supply first.",
		);
	}
	const riskLevel: "low" | "medium" | "high" = requiresRiskCheck
		? "high"
		: borrowedAssetCount > 0
			? "medium"
			: "low";
	const riskBand = resolveBurrowWorkflowRiskBand(riskLevel);
	return {
		status: !canWithdraw
			? "market_unavailable"
			: availableInner <= 0n
				? "no_supply"
				: requiresRiskCheck
					? "risk_check_required"
					: availableInner >= requiredInner
						? "success"
						: "insufficient_balance",
		fromAccountId,
		burrowContractId,
		tokenId,
		amountRaw: amountRaw.toString(),
		amountInner,
		availableRaw: availableRaw.toString(),
		availableInner: availableInner.toString(),
		requiredRaw: amountRaw.toString(),
		requiredInner: requiredInner.toString(),
		recipientId: params.intent.recipientId ?? null,
		canWithdraw,
		suppliedInner: suppliedInner.toString(),
		collateralInner: collateralInner.toString(),
		borrowedAssetCount,
		riskLevel,
		riskBand,
		riskNotes,
	};
}

function resolveExecuteTool(
	name:
		| "near_transferNear"
		| "near_transferFt"
		| "near_swapRef"
		| "near_withdrawRefToken"
		| "near_supplyBurrow"
		| "near_borrowBurrow"
		| "near_repayBurrow"
		| "near_withdrawBurrow"
		| "near_submitIntentsDeposit"
		| "near_broadcastSignedTransaction"
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
		| "near_buildIntentsSwapDepositTransaction"
		| "near_buildAddLiquidityRefTransaction"
		| "near_buildRemoveLiquidityRefTransaction"
		| "near_buildSwapRefTransaction"
		| "near_buildRefWithdrawTransaction"
		| "near_buildSupplyBurrowTransaction"
		| "near_buildBorrowBurrowTransaction"
		| "near_buildRepayBurrowTransaction"
		| "near_buildWithdrawBurrowTransaction",
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

function normalizeIntentsStatusValue(value: unknown): string | null {
	if (typeof value !== "string" || !value.trim()) return null;
	return value.trim().toUpperCase();
}

function summarizeIntentsOutcome(
	executeArtifact: unknown,
): NearIntentsOutcomeSummary | null {
	if (!isObjectRecord(executeArtifact)) return null;
	const submitStatus = normalizeIntentsStatusValue(executeArtifact.status);
	const statusTracking = isObjectRecord(executeArtifact.statusTracking)
		? executeArtifact.statusTracking
		: null;
	const latestStatusNode =
		statusTracking && isObjectRecord(statusTracking.latestStatus)
			? statusTracking.latestStatus
			: null;
	const trackedStatus = normalizeIntentsStatusValue(
		latestStatusNode?.status ?? null,
	);
	const sourceStatus = trackedStatus ?? submitStatus;
	const timedOut = statusTracking?.timedOut === true;
	const trackingLastError =
		typeof statusTracking?.lastError === "string" &&
		statusTracking.lastError.trim()
			? statusTracking.lastError.trim()
			: null;
	const trackingHistory = Array.isArray(statusTracking?.history)
		? statusTracking.history.filter((entry) => isObjectRecord(entry))
		: [];
	const historyStatuses = trackingHistory
		.map((entry) => normalizeIntentsStatusValue(entry.status))
		.filter((status): status is string => status != null);
	const allHistoryNotFound =
		historyStatuses.length > 0 &&
		historyStatuses.every((status) => status === "NOT_FOUND");

	const latestSwapDetails =
		latestStatusNode && isObjectRecord(latestStatusNode.swapDetails)
			? latestStatusNode.swapDetails
			: null;
	const refundReason =
		typeof latestSwapDetails?.refundReason === "string" &&
		latestSwapDetails.refundReason.trim()
			? latestSwapDetails.refundReason.trim()
			: null;

	const anyInputWithdrawals = isObjectRecord(
		executeArtifact.anyInputWithdrawals,
	)
		? executeArtifact.anyInputWithdrawals
		: null;
	const anyInputStatus = normalizeIntentsStatusValue(
		anyInputWithdrawals?.status ?? null,
	);
	const anyInputError =
		typeof anyInputWithdrawals?.error === "string" &&
		anyInputWithdrawals.error.trim()
			? anyInputWithdrawals.error.trim()
			: null;

	let category: NearIntentsOutcomeCategory = "unknown";
	let reasonCode: string | null = null;
	let reason: string | null = null;
	const remediation: string[] = [];

	if (sourceStatus === "SUCCESS") {
		category = "success";
		reasonCode = "SUCCESS";
	} else if (
		sourceStatus === "KNOWN_DEPOSIT_TX" ||
		sourceStatus === "PENDING_DEPOSIT" ||
		sourceStatus === "PROCESSING"
	) {
		category = "pending";
		reasonCode = sourceStatus;
	} else if (sourceStatus === "FAILED") {
		category = "failed";
		reasonCode = "FAILED";
		reason =
			refundReason ??
			trackingLastError ??
			"Execution failed on Intents backend.";
	} else if (sourceStatus === "REFUNDED") {
		category = "refunded";
		reasonCode = "REFUNDED";
		reason = refundReason ?? "Swap was refunded by Intents.";
	} else if (sourceStatus === "INCOMPLETE_DEPOSIT") {
		category = "incomplete_deposit";
		reasonCode = "INCOMPLETE_DEPOSIT";
		reason =
			refundReason ??
			"Deposit is incomplete (amount/address/memo mismatch or insufficient deposit).";
	} else if (timedOut) {
		category = "pending";
		reasonCode = allHistoryNotFound ? "NOT_INDEXED" : "POLL_TIMEOUT";
		reason = allHistoryNotFound
			? "Deposit not indexed yet on Intents status API."
			: (trackingLastError ??
				"Status polling timed out before terminal status.");
	} else if (submitStatus) {
		category = "pending";
		reasonCode = submitStatus;
	}

	if (anyInputStatus === "PENDING" && category === "success") {
		category = "pending";
		reasonCode = "ANY_INPUT_WITHDRAWAL_PENDING";
		reason =
			"Swap succeeded but ANY_INPUT withdrawal record is not available yet.";
	}
	if (anyInputStatus === "ERROR" && anyInputError) {
		if (category === "success") {
			category = "pending";
			reasonCode = "ANY_INPUT_WITHDRAWAL_QUERY_ERROR";
		}
		reason = reason ?? anyInputError;
	}

	if (category === "success") {
		remediation.push(
			"No action required. Keep correlationId for future traceability.",
		);
	} else if (category === "pending") {
		remediation.push(
			"Use near_getIntentsStatus with correlationId or depositAddress/depositMemo to continue tracking.",
		);
		remediation.push(
			"If still pending for several minutes, verify txHash + depositAddress/memo exactly match simulate output, then resubmit.",
		);
	} else if (category === "failed" || category === "refunded") {
		remediation.push(
			"Re-run simulate for latest quote/slippage, then submit a fresh deposit transaction.",
		);
		remediation.push(
			"Verify depositAddress/depositMemo/amount exactly match the quote to avoid backend rejection.",
		);
	} else if (category === "incomplete_deposit") {
		remediation.push(
			"Check deposit transaction amount and memo/address against simulate output, then resubmit with correct values.",
		);
	}

	return {
		category,
		sourceStatus,
		reasonCode,
		reason,
		remediation,
	};
}

function buildIntentsExecuteReadableText(executeArtifact: unknown): string {
	const lines = ["Workflow executed: near.swap.intents"];
	if (!isObjectRecord(executeArtifact)) {
		return `${lines[0]} submitted`;
	}
	lines[0] = `${lines[0]} ${buildExecuteResultSummary(executeArtifact)}`;

	const submitStatus =
		typeof executeArtifact.status === "string" &&
		executeArtifact.status.trim().length > 0
			? executeArtifact.status.trim()
			: null;
	if (submitStatus) {
		lines.push(`Submit status: ${submitStatus}`);
	}
	const correlationId =
		typeof executeArtifact.correlationId === "string" &&
		executeArtifact.correlationId.trim().length > 0
			? executeArtifact.correlationId.trim()
			: null;
	if (correlationId) {
		lines.push(`CorrelationId: ${correlationId}`);
	}
	const depositAddress =
		typeof executeArtifact.depositAddress === "string" &&
		executeArtifact.depositAddress.trim().length > 0
			? executeArtifact.depositAddress.trim()
			: null;
	const depositMemo =
		typeof executeArtifact.depositMemo === "string" &&
		executeArtifact.depositMemo.trim().length > 0
			? executeArtifact.depositMemo.trim()
			: null;
	if (depositAddress) {
		lines.push(
			`Deposit: ${depositAddress}${depositMemo ? ` (memo ${depositMemo})` : ""}`,
		);
	}
	const txHash =
		typeof executeArtifact.txHash === "string" &&
		executeArtifact.txHash.trim().length > 0
			? executeArtifact.txHash.trim()
			: null;
	if (txHash) {
		lines.push(`Deposit txHash: ${txHash}`);
	}
	if (isObjectRecord(executeArtifact.statusTracking)) {
		const tracking = executeArtifact.statusTracking;
		const latestStatus = isObjectRecord(tracking.latestStatus)
			? tracking.latestStatus
			: null;
		const status =
			latestStatus && typeof latestStatus.status === "string"
				? latestStatus.status
				: null;
		const updatedAt =
			latestStatus && typeof latestStatus.updatedAt === "string"
				? latestStatus.updatedAt
				: null;
		const attempts =
			typeof tracking.attempts === "number" ? tracking.attempts : null;
		const timedOut = tracking.timedOut === true;
		if (status) {
			lines.push(
				`Tracked status: ${status}${timedOut ? " (poll-timeout)" : ""}${updatedAt ? ` at ${updatedAt}` : ""}`,
			);
		} else if (timedOut) {
			lines.push("Tracked status: pending (poll-timeout)");
		}
		if (attempts != null) {
			lines.push(`Status poll attempts: ${attempts}`);
		}
		const lastError =
			typeof tracking.lastError === "string" && tracking.lastError.trim()
				? tracking.lastError.trim()
				: null;
		if (timedOut && lastError) {
			lines.push(`Status tracking note: ${lastError}`);
		}
	}
	if (isObjectRecord(executeArtifact.anyInputWithdrawals)) {
		const withdrawals = executeArtifact.anyInputWithdrawals;
		const status =
			typeof withdrawals.status === "string" ? withdrawals.status : "unknown";
		const records = Array.isArray(withdrawals.withdrawals)
			? withdrawals.withdrawals
			: [];
		if (status === "success") {
			lines.push(`ANY_INPUT withdrawals: ${records.length} record(s)`);
		} else if (status === "pending") {
			lines.push("ANY_INPUT withdrawals: pending");
		} else if (status === "error") {
			const error =
				typeof withdrawals.error === "string" && withdrawals.error.trim()
					? withdrawals.error.trim()
					: "unknown error";
			lines.push(`ANY_INPUT withdrawals: error (${error})`);
		}
		if (records.length > 0 && isObjectRecord(records[0])) {
			const first = records[0];
			const firstStatus =
				typeof first.status === "string" ? first.status : "UNKNOWN";
			const firstHash = typeof first.hash === "string" ? first.hash : null;
			lines.push(
				`Latest withdrawal: ${firstStatus}${firstHash ? ` hash=${firstHash}` : ""}`,
			);
		}
		if (isObjectRecord(withdrawals.polling)) {
			const polling = withdrawals.polling;
			const attempts =
				typeof polling.attempts === "number" ? polling.attempts : null;
			const timedOut = polling.timedOut === true;
			if (attempts != null) {
				lines.push(
					`ANY_INPUT polling: attempts=${attempts}${timedOut ? " (timeout)" : ""}`,
				);
			}
		}
	}
	const outcome = summarizeIntentsOutcome(executeArtifact);
	if (outcome) {
		lines.push(
			`Outcome: ${outcome.category}${outcome.sourceStatus ? ` (status ${outcome.sourceStatus})` : ""}`,
		);
		if (outcome.reasonCode) {
			lines.push(`Outcome code: ${outcome.reasonCode}`);
		}
		if (outcome.reason) {
			lines.push(`Reason: ${outcome.reason}`);
		}
		for (const nextStep of outcome.remediation.slice(0, 2)) {
			lines.push(`Next: ${nextStep}`);
		}
	}
	return lines.join("\n");
}

function shortenSummaryValue(value: string): string {
	const normalized = value.trim();
	if (normalized.length <= 18) return normalized;
	return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}

function buildIntentsExecuteOneLineSummary(executeArtifact: unknown): string {
	if (!isObjectRecord(executeArtifact)) {
		return "intents submitted";
	}
	const parts: string[] = ["intents"];
	const submitStatus =
		typeof executeArtifact.status === "string" && executeArtifact.status.trim()
			? executeArtifact.status.trim()
			: "submitted";
	parts.push(`submit=${submitStatus}`);
	const txHash =
		typeof executeArtifact.txHash === "string" && executeArtifact.txHash.trim()
			? executeArtifact.txHash.trim()
			: null;
	if (txHash) {
		parts.push(`tx=${shortenSummaryValue(txHash)}`);
	}
	const correlationId =
		typeof executeArtifact.correlationId === "string" &&
		executeArtifact.correlationId.trim()
			? executeArtifact.correlationId.trim()
			: null;
	if (correlationId) {
		parts.push(`corr=${shortenSummaryValue(correlationId)}`);
	}
	if (isObjectRecord(executeArtifact.statusTracking)) {
		const tracking = executeArtifact.statusTracking;
		const latestStatus = isObjectRecord(tracking.latestStatus)
			? tracking.latestStatus
			: null;
		const tracked =
			latestStatus && typeof latestStatus.status === "string"
				? latestStatus.status
				: tracking.timedOut === true
					? "PENDING(timeout)"
					: null;
		if (tracked) {
			parts.push(`tracked=${tracked}`);
		}
	}
	if (isObjectRecord(executeArtifact.anyInputWithdrawals)) {
		const withdrawals = executeArtifact.anyInputWithdrawals;
		const status =
			typeof withdrawals.status === "string" ? withdrawals.status : "unknown";
		const count = Array.isArray(withdrawals.withdrawals)
			? withdrawals.withdrawals.length
			: 0;
		parts.push(`withdrawals=${status}:${count}`);
	}
	const outcome = summarizeIntentsOutcome(executeArtifact);
	if (outcome && outcome.category !== "success") {
		parts.push(
			`outcome=${outcome.category}${outcome.reasonCode ? `:${outcome.reasonCode}` : ""}`,
		);
	}
	return parts.join(" ");
}

function buildWorkflowExecuteOneLineSummary(
	intentType: NearWorkflowIntent["type"],
	executeArtifact: unknown,
): string {
	if (intentType === "near.swap.intents") {
		return buildIntentsExecuteOneLineSummary(executeArtifact);
	}
	return `${intentType} ${buildExecuteResultSummary(executeArtifact)}`.trim();
}

function buildWorkflowPhaseSummary(params: {
	phase: "analysis" | "simulate" | "execute";
	intentType: NearWorkflowIntent["type"];
	status: string;
	line: string;
}) {
	return {
		schema: "w3rt.workflow.summary.v1",
		phase: params.phase,
		intentType: params.intentType,
		status: params.status,
		line: params.line,
	};
}

function resolveWorkflowExecuteStatus(
	executeArtifact: Record<string, unknown>,
): string {
	const directStatus =
		typeof executeArtifact.status === "string" && executeArtifact.status.trim()
			? executeArtifact.status.trim()
			: null;
	if (directStatus) return directStatus;

	const finalExecutionStatus =
		typeof executeArtifact.finalExecutionStatus === "string" &&
		executeArtifact.finalExecutionStatus.trim()
			? executeArtifact.finalExecutionStatus.trim()
			: null;
	if (finalExecutionStatus) return finalExecutionStatus;

	if (isObjectRecord(executeArtifact.statusTracking)) {
		const tracking = executeArtifact.statusTracking;
		const latestStatus = isObjectRecord(tracking.latestStatus)
			? tracking.latestStatus
			: null;
		if (latestStatus && typeof latestStatus.status === "string") {
			return latestStatus.status;
		}
	}

	return "submitted";
}

function attachExecuteSummaryLine(
	intentType: NearWorkflowIntent["type"],
	executeArtifact: unknown,
): unknown {
	if (!isObjectRecord(executeArtifact)) {
		return executeArtifact;
	}
	const existingSummary =
		typeof executeArtifact.summaryLine === "string"
			? executeArtifact.summaryLine.trim()
			: "";
	const summaryLine =
		existingSummary.length > 0
			? existingSummary
			: buildWorkflowExecuteOneLineSummary(intentType, executeArtifact);
	const status = resolveWorkflowExecuteStatus(executeArtifact);
	return {
		...executeArtifact,
		summaryLine,
		summary: buildWorkflowPhaseSummary({
			phase: "execute",
			intentType,
			status,
			line: summaryLine,
		}),
	};
}

function resolveWorkflowSimulateStatus(
	simulateArtifact: Record<string, unknown>,
): string {
	const status =
		typeof simulateArtifact.status === "string" &&
		simulateArtifact.status.trim()
			? simulateArtifact.status.trim()
			: null;
	if (status) {
		return status;
	}
	if (typeof simulateArtifact.ok === "boolean") {
		return simulateArtifact.ok ? "success" : "failed";
	}
	return "unknown";
}

function buildWorkflowAnalysisSummary(
	intentType: NearWorkflowIntent["type"],
	approvalRequired: boolean,
	confirmToken: string | null,
) {
	const summaryLine = buildWorkflowAnalysisOneLineSummary(
		intentType,
		approvalRequired,
		confirmToken,
	);
	return {
		summaryLine,
		summary: buildWorkflowPhaseSummary({
			phase: "analysis",
			intentType,
			status: "ready",
			line: summaryLine,
		}),
	};
}

function buildWorkflowSimulateSummary(
	intentType: NearWorkflowIntent["type"],
	simulateArtifact: Record<string, unknown>,
) {
	const summaryLine = buildWorkflowSimulateOneLineSummary(
		intentType,
		simulateArtifact,
	);
	return {
		summaryLine,
		summary: buildWorkflowPhaseSummary({
			phase: "simulate",
			intentType,
			status: resolveWorkflowSimulateStatus(simulateArtifact),
			line: summaryLine,
		}),
	};
}

function attachSimulateSummaryLine(
	intentType: NearWorkflowIntent["type"],
	simulateArtifact: unknown,
): unknown {
	if (!isObjectRecord(simulateArtifact)) {
		return simulateArtifact;
	}
	const existingSummary =
		typeof simulateArtifact.summaryLine === "string"
			? simulateArtifact.summaryLine.trim()
			: "";
	if (existingSummary.length > 0 && isObjectRecord(simulateArtifact.summary)) {
		return simulateArtifact;
	}
	const workflowSummary = buildWorkflowSimulateSummary(
		intentType,
		simulateArtifact,
	);
	return {
		...simulateArtifact,
		summaryLine:
			existingSummary.length > 0
				? existingSummary
				: workflowSummary.summaryLine,
		summary: isObjectRecord(simulateArtifact.summary)
			? simulateArtifact.summary
			: workflowSummary.summary,
	};
}

function buildWorkflowAnalysisOneLineSummary(
	intentType: NearWorkflowIntent["type"],
	approvalRequired: boolean,
	confirmToken: string | null,
): string {
	const parts = [intentType, "analysis=ready"];
	if (
		intentType === "near.lend.burrow.borrow" ||
		intentType === "near.lend.burrow.withdraw"
	) {
		parts.push("riskCheck=simulate");
		parts.push(`riskPolicy=${buildBurrowWorkflowRiskPolicyLabel()}`);
	}
	if (approvalRequired) {
		parts.push(`mainnetGuard=on confirmToken=${confirmToken ?? "N/A"}`);
	}
	return parts.join(" ");
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
		intentType === "near.lend.burrow.borrow" ||
		intentType === "near.lend.burrow.withdraw"
	) {
		const riskLevel =
			typeof simulateResult.riskLevel === "string"
				? simulateResult.riskLevel
				: null;
		const riskBand =
			typeof simulateResult.riskBand === "string"
				? simulateResult.riskBand
				: riskLevel === "high" || riskLevel === "medium" || riskLevel === "low"
					? resolveBurrowWorkflowRiskBand(riskLevel)
					: null;
		const collateralAssetCount =
			typeof simulateResult.collateralAssetCount === "number" &&
			Number.isFinite(simulateResult.collateralAssetCount)
				? Math.max(0, Math.floor(simulateResult.collateralAssetCount))
				: null;
		const borrowedAssetCount =
			typeof simulateResult.borrowedAssetCount === "number" &&
			Number.isFinite(simulateResult.borrowedAssetCount)
				? Math.max(0, Math.floor(simulateResult.borrowedAssetCount))
				: null;
		const riskNotesCount = Array.isArray(simulateResult.riskNotes)
			? simulateResult.riskNotes.filter(
					(note): note is string =>
						typeof note === "string" && note.trim().length > 0,
				).length
			: 0;
		const parts = [`Workflow simulated: ${intentType} status=${statusText}`];
		if (riskBand) parts.push(`risk=${riskBand}`);
		if (riskLevel) parts.push(`riskLevel=${riskLevel}`);
		if (collateralAssetCount != null) {
			parts.push(`collateralAssets=${collateralAssetCount}`);
		}
		if (borrowedAssetCount != null) {
			parts.push(`borrowedAssets=${borrowedAssetCount}`);
		}
		if (riskNotesCount > 0) {
			parts.push(`riskNotes=${riskNotesCount}`);
		}
		return parts.join(" ");
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

function buildWorkflowSimulateOneLineSummary(
	intentType: NearWorkflowIntent["type"],
	simulateArtifact: unknown,
): string {
	return buildSimulateResultSummary(intentType, simulateArtifact)
		.replace(/^Workflow simulated:\s*/i, "")
		.trim();
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
				"Run NEAR workflow in phases: analysis -> compose/simulate -> execute for native transfer, FT transfer, Ref swap/withdraw/LP, Burrow lend (supply/borrow/repay/withdraw), and NEAR Intents swap.",
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
						Type.Literal("near.lend.burrow.supply"),
						Type.Literal("near.lend.burrow.borrow"),
						Type.Literal("near.lend.burrow.repay"),
						Type.Literal("near.lend.burrow.withdraw"),
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
				burrowContractId: Type.Optional(Type.String()),
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
				signedTxBase64: Type.Optional(Type.String()),
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
				recipientId: Type.Optional(Type.String()),
				asCollateral: Type.Optional(Type.Boolean()),
				withdrawToWallet: Type.Optional(Type.Boolean()),
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
					(looksLikeFollowUpExecuteIntent(params.intentText) ||
						!hintsContainActionableIntentFields(hints));
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
					} else if (intent.type === "near.swap.intents") {
						const composeTool = resolveComposeTool(
							"near_buildIntentsSwapDepositTransaction",
						);
						composeResult = await composeTool.execute("near-wf-compose", {
							originAsset: intent.originAsset,
							destinationAsset: intent.destinationAsset,
							amount: intent.amount,
							accountId: intent.accountId ?? intent.fromAccountId,
							fromAccountId: intent.fromAccountId ?? params.fromAccountId,
							recipient: intent.recipient,
							refundTo: intent.refundTo,
							swapType: intent.swapType,
							slippageTolerance: intent.slippageTolerance,
							depositType: intent.depositType,
							refundType: intent.refundType,
							recipientType: intent.recipientType,
							depositMode: intent.depositMode,
							deadline: intent.deadline,
							quoteWaitingTimeMs: intent.quoteWaitingTimeMs,
							blockchainHint: intent.blockchainHint,
							apiBaseUrl: intent.apiBaseUrl ?? params.apiBaseUrl,
							apiKey: params.apiKey,
							jwt: params.jwt,
							network,
							rpcUrl: params.rpcUrl,
							publicKey: params.publicKey,
						});
					} else if (intent.type === "near.lp.ref.add") {
						const composeTool = resolveComposeTool(
							"near_buildAddLiquidityRefTransaction",
						);
						composeResult = await composeTool.execute("near-wf-compose", {
							poolId: intent.poolId,
							amountARaw: intent.amountARaw,
							amountBRaw: intent.amountBRaw,
							tokenAId: intent.tokenAId,
							tokenBId: intent.tokenBId,
							refContractId: intent.refContractId,
							autoRegisterExchange: intent.autoRegisterExchange,
							autoRegisterTokens: intent.autoRegisterTokens,
							gas: intent.gas,
							attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
							network,
							rpcUrl: params.rpcUrl,
							fromAccountId: intent.fromAccountId ?? params.fromAccountId,
							publicKey: params.publicKey,
						});
					} else if (intent.type === "near.lp.ref.remove") {
						const composeTool = resolveComposeTool(
							"near_buildRemoveLiquidityRefTransaction",
						);
						composeResult = await composeTool.execute("near-wf-compose", {
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
					} else if (intent.type === "near.lend.burrow.supply") {
						const composeTool = resolveComposeTool(
							"near_buildSupplyBurrowTransaction",
						);
						composeResult = await composeTool.execute("near-wf-compose", {
							tokenId: intent.tokenId,
							amountRaw: intent.amountRaw,
							asCollateral: intent.asCollateral,
							burrowContractId: intent.burrowContractId,
							gas: intent.gas,
							attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
							network,
							rpcUrl: params.rpcUrl,
							fromAccountId: intent.fromAccountId ?? params.fromAccountId,
							publicKey: params.publicKey,
						});
					} else if (intent.type === "near.lend.burrow.borrow") {
						const composeTool = resolveComposeTool(
							"near_buildBorrowBurrowTransaction",
						);
						composeResult = await composeTool.execute("near-wf-compose", {
							tokenId: intent.tokenId,
							amountRaw: intent.amountRaw,
							withdrawToWallet: intent.withdrawToWallet,
							burrowContractId: intent.burrowContractId,
							gas: intent.gas,
							attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
							network,
							rpcUrl: params.rpcUrl,
							fromAccountId: intent.fromAccountId ?? params.fromAccountId,
							publicKey: params.publicKey,
						});
					} else if (intent.type === "near.lend.burrow.repay") {
						const composeTool = resolveComposeTool(
							"near_buildRepayBurrowTransaction",
						);
						composeResult = await composeTool.execute("near-wf-compose", {
							tokenId: intent.tokenId,
							amountRaw: intent.amountRaw,
							burrowContractId: intent.burrowContractId,
							gas: intent.gas,
							attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
							network,
							rpcUrl: params.rpcUrl,
							fromAccountId: intent.fromAccountId ?? params.fromAccountId,
							publicKey: params.publicKey,
						});
					} else if (intent.type === "near.lend.burrow.withdraw") {
						const composeTool = resolveComposeTool(
							"near_buildWithdrawBurrowTransaction",
						);
						composeResult = await composeTool.execute("near-wf-compose", {
							tokenId: intent.tokenId,
							amountRaw: intent.amountRaw,
							recipientId: intent.recipientId,
							burrowContractId: intent.burrowContractId,
							gas: intent.gas,
							attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
							network,
							rpcUrl: params.rpcUrl,
							fromAccountId: intent.fromAccountId ?? params.fromAccountId,
							publicKey: params.publicKey,
						});
					} else {
						throw new Error(
							"compose supports near.transfer.near / near.transfer.ft / near.swap.ref / near.swap.intents / near.lp.ref.add / near.lp.ref.remove / near.ref.withdraw / near.lend.burrow.supply / near.lend.burrow.borrow / near.lend.burrow.repay / near.lend.burrow.withdraw.",
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
					const analysisSummary = buildWorkflowAnalysisSummary(
						intent.type,
						approvalRequired,
						confirmToken,
					);
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
									...analysisSummary,
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
										: intent.type === "near.lend.burrow.supply"
											? await simulateBurrowSupply({
													intent,
													network,
													rpcUrl: params.rpcUrl,
													fromAccountId: params.fromAccountId,
												})
											: intent.type === "near.lend.burrow.borrow"
												? await simulateBurrowBorrow({
														intent,
														network,
														rpcUrl: params.rpcUrl,
														fromAccountId: params.fromAccountId,
													})
												: intent.type === "near.lend.burrow.repay"
													? await simulateBurrowRepay({
															intent,
															network,
															rpcUrl: params.rpcUrl,
															fromAccountId: params.fromAccountId,
														})
													: intent.type === "near.lend.burrow.withdraw"
														? await simulateBurrowWithdraw({
																intent,
																network,
																rpcUrl: params.rpcUrl,
																fromAccountId: params.fromAccountId,
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
					const simulateArtifactWithSummary = attachSimulateSummaryLine(
						intent.type,
						simulateArtifact,
					);
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
								simulate: simulateArtifactWithSummary,
							},
						},
					};
				}

				const effectiveConfirmMainnet =
					typeof params.confirmMainnet === "boolean"
						? params.confirmMainnet
						: hints.confirmMainnet;
				const providedConfirmTokenRaw =
					typeof params.confirmToken === "string" && params.confirmToken.trim()
						? params.confirmToken.trim()
						: typeof hints.confirmToken === "string" &&
								hints.confirmToken.trim()
							? hints.confirmToken.trim()
							: params.confirmToken;
				const providedConfirmToken =
					typeof providedConfirmTokenRaw === "string"
						? normalizeConfirmTokenValue(providedConfirmTokenRaw)
						: providedConfirmTokenRaw;
				const expectedConfirmToken =
					typeof confirmToken === "string"
						? normalizeConfirmTokenValue(confirmToken)
						: confirmToken;
				assertMainnetExecutionConfirmed(network, effectiveConfirmMainnet);
				if (approvalRequired && providedConfirmToken !== expectedConfirmToken) {
					throw new Error(
						`Invalid confirmToken for runId=${runId}. expected=${confirmToken} provided=${providedConfirmToken ?? "null"}.`,
					);
				}
				let submitTxHash =
					typeof params.txHash === "string" && params.txHash.trim()
						? params.txHash.trim()
						: typeof hints.txHash === "string" && hints.txHash.trim()
							? hints.txHash.trim()
							: undefined;
				const signedTxBase64 =
					typeof params.signedTxBase64 === "string" &&
					params.signedTxBase64.trim()
						? params.signedTxBase64
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
				let intentsBroadcastDetails: Record<string, unknown> | null = null;
				if (intent.type === "near.swap.intents") {
					if (!submitTxHash && signedTxBase64) {
						const broadcastTool = resolveExecuteTool(
							"near_broadcastSignedTransaction",
						);
						const broadcastResult = await broadcastTool.execute(
							"near-wf-exec-intents-broadcast",
							{
								signedTxBase64,
								network,
								rpcUrl: params.rpcUrl,
								confirmMainnet: effectiveConfirmMainnet,
							},
						);
						const broadcastResultDetails = broadcastResult.details;
						const broadcastTxHash =
							typeof broadcastResultDetails === "object" &&
							broadcastResultDetails &&
							typeof (
								broadcastResultDetails as {
									txHash?: unknown;
								}
							).txHash === "string" &&
							(
								broadcastResultDetails as {
									txHash: string;
								}
							).txHash.trim()
								? (
										broadcastResultDetails as {
											txHash: string;
										}
									).txHash.trim()
								: undefined;
						if (!broadcastTxHash) {
							throw new Error(
								"near_broadcastSignedTransaction did not return txHash for intents execute.",
							);
						}
						submitTxHash = broadcastTxHash;
						intentsBroadcastDetails =
							typeof broadcastResultDetails === "object" &&
							broadcastResultDetails
								? (broadcastResultDetails as Record<string, unknown>)
								: {
										txHash: broadcastTxHash,
									};
					}
					if (!submitTxHash) {
						throw new Error(
							"near.swap.intents execute requires txHash or signedTxBase64 from the deposit transaction.",
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
									: intent.type === "near.lend.burrow.supply"
										? resolveExecuteTool("near_supplyBurrow")
										: intent.type === "near.lend.burrow.borrow"
											? resolveExecuteTool("near_borrowBurrow")
											: intent.type === "near.lend.burrow.repay"
												? resolveExecuteTool("near_repayBurrow")
												: intent.type === "near.lend.burrow.withdraw"
													? resolveExecuteTool("near_withdrawBurrow")
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
									: intent.type === "near.lend.burrow.supply"
										? {
												tokenId: intent.tokenId,
												amountRaw: intent.amountRaw,
												asCollateral: intent.asCollateral,
												burrowContractId: intent.burrowContractId,
												gas: intent.gas,
												attachedDepositYoctoNear:
													intent.attachedDepositYoctoNear,
											}
										: intent.type === "near.lend.burrow.borrow"
											? {
													tokenId: intent.tokenId,
													amountRaw: intent.amountRaw,
													withdrawToWallet: intent.withdrawToWallet,
													burrowContractId: intent.burrowContractId,
													gas: intent.gas,
													attachedDepositYoctoNear:
														intent.attachedDepositYoctoNear,
												}
											: intent.type === "near.lend.burrow.repay"
												? {
														tokenId: intent.tokenId,
														amountRaw: intent.amountRaw,
														burrowContractId: intent.burrowContractId,
														gas: intent.gas,
														attachedDepositYoctoNear:
															intent.attachedDepositYoctoNear,
													}
												: intent.type === "near.lend.burrow.withdraw"
													? {
															tokenId: intent.tokenId,
															amountRaw: intent.amountRaw,
															recipientId: intent.recipientId,
															burrowContractId: intent.burrowContractId,
															gas: intent.gas,
															attachedDepositYoctoNear:
																intent.attachedDepositYoctoNear,
														}
													: intent.type === "near.swap.intents"
														? {
																txHash: submitTxHash as string,
																depositAddress: effectiveIntentsDepositAddress,
																depositMemo: effectiveIntentsDepositMemo,
																nearSenderAccount:
																	intent.accountId ?? params.fromAccountId,
																apiBaseUrl:
																	params.apiBaseUrl ?? intent.apiBaseUrl,
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
																	autoRegisterExchange:
																		intent.autoRegisterExchange,
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
																	autoRegisterReceiver:
																		intent.autoRegisterReceiver,
																	gas: intent.gas,
																	attachedDepositYoctoNear:
																		intent.attachedDepositYoctoNear,
																}),
					network,
					rpcUrl: params.rpcUrl,
					fromAccountId: intent.fromAccountId ?? params.fromAccountId,
					privateKey: params.privateKey,
					confirmMainnet: effectiveConfirmMainnet,
				});

				const executeDetails = executeResult.details as
					| {
							txHash?: string;
							correlationId?: string;
					  }
					| undefined;
				const intentsExecuteCorrelationId =
					intent.type === "near.swap.intents" &&
					typeof executeDetails?.correlationId === "string" &&
					executeDetails.correlationId.trim()
						? executeDetails.correlationId.trim()
						: undefined;
				const shouldTrackIntentsStatus =
					intent.type === "near.swap.intents"
						? shouldWaitForIntentsFinalStatus(params.waitForFinalStatus, hints)
						: false;
				const statusTracking =
					intent.type === "near.swap.intents" &&
					shouldTrackIntentsStatus &&
					(effectiveIntentsDepositAddress || intentsExecuteCorrelationId)
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
								correlationId: intentsExecuteCorrelationId,
								intervalMs: parseIntentsStatusPollIntervalMs(
									params.statusPollIntervalMs,
								),
								timeoutMs: parseIntentsStatusTimeoutMs(params.statusTimeoutMs),
							})
						: null;
				const anyInputWithdrawals =
					intent.type === "near.swap.intents" &&
					intent.swapType === "ANY_INPUT" &&
					effectiveIntentsDepositAddress
						? await (async () => {
								const baseUrl = resolveNearIntentsApiBaseUrl(
									params.apiBaseUrl ?? intent.apiBaseUrl,
								);
								const headers = resolveNearIntentsHeaders({
									apiKey: params.apiKey,
									jwt: params.jwt,
								});
								try {
									if (!shouldTrackIntentsStatus) {
										const queryResult =
											await queryNearIntentsAnyInputWithdrawals({
												baseUrl,
												headers,
												depositAddress: effectiveIntentsDepositAddress,
												depositMemo: effectiveIntentsDepositMemo,
											});
										return {
											status: "success",
											...queryResult,
										};
									}
									const pollingResult =
										await pollNearIntentsAnyInputWithdrawalsUntilFound({
											baseUrl,
											headers,
											depositAddress: effectiveIntentsDepositAddress,
											depositMemo: effectiveIntentsDepositMemo,
											intervalMs: parseIntentsStatusPollIntervalMs(
												params.statusPollIntervalMs,
											),
											timeoutMs: parseIntentsStatusTimeoutMs(
												params.statusTimeoutMs,
											),
										});
									if (pollingResult.latest) {
										return {
											status:
												pollingResult.latest.withdrawals.length > 0
													? "success"
													: "pending",
											...pollingResult.latest,
											polling: {
												timedOut: pollingResult.timedOut,
												attempts: pollingResult.attempts,
												lastError: pollingResult.lastError,
												history: pollingResult.history,
											},
										};
									}
									if (pollingResult.lastError) {
										return {
											status: "error",
											error: pollingResult.lastError,
											polling: {
												timedOut: pollingResult.timedOut,
												attempts: pollingResult.attempts,
												lastError: pollingResult.lastError,
												history: pollingResult.history,
											},
										};
									}
									return {
										status: "pending",
										withdrawals: [],
										polling: {
											timedOut: pollingResult.timedOut,
											attempts: pollingResult.attempts,
											lastError: pollingResult.lastError,
											history: pollingResult.history,
										},
									};
								} catch (error) {
									return {
										status: "error",
										error: extractErrorText(error),
									};
								}
							})()
						: null;
				const executeArtifact =
					intent.type === "near.swap.intents" && executeDetails
						? (() => {
								const baseArtifact = {
									...(executeDetails as Record<string, unknown>),
									broadcast:
										intentsBroadcastDetails &&
										typeof intentsBroadcastDetails.txHash === "string"
											? intentsBroadcastDetails
											: null,
									depositAddress: effectiveIntentsDepositAddress ?? null,
									depositMemo: effectiveIntentsDepositMemo ?? null,
									anyInputWithdrawals,
									statusTracking:
										shouldTrackIntentsStatus && statusTracking
											? statusTracking
											: shouldTrackIntentsStatus
												? {
														timedOut: true,
														attempts: 0,
														latestStatus: null,
														lastError:
															"status tracking was requested but both depositAddress and correlationId are missing",
														history: [],
													}
												: null,
								};
								const intentsOutcome = summarizeIntentsOutcome(baseArtifact);
								return {
									...baseArtifact,
									intentsOutcome,
									summaryLine: buildIntentsExecuteOneLineSummary(baseArtifact),
								};
							})()
						: (executeDetails ?? null);
				const executeArtifactWithSummary = attachExecuteSummaryLine(
					intent.type,
					executeArtifact,
				);
				const executeSummaryText =
					intent.type === "near.swap.intents"
						? buildIntentsExecuteReadableText(executeArtifactWithSummary)
						: `Workflow executed: ${intent.type} ${buildExecuteResultSummary(executeArtifactWithSummary)}`;
				return {
					content: [
						{
							type: "text",
							text: executeSummaryText,
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
							!approvalRequired ||
							providedConfirmToken === expectedConfirmToken,
						artifacts: {
							execute: executeArtifactWithSummary,
						},
					},
				};
			},
		}),
	];
}
