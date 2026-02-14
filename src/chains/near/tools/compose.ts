import { Type } from "@sinclair/typebox";
import bs58 from "bs58";
import {
	type Action,
	PublicKey,
	actions,
	createTransaction,
	encodeTransaction,
} from "near-api-js";
import { defineTool } from "../../../core/types.js";
import type { RegisteredTool } from "../../../core/types.js";
import {
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
	NEAR_TOOL_PREFIX,
	callNearRpc,
	getNearRpcEndpoint,
	nearNetworkSchema,
	parseNearNetwork,
	resolveNearAccountId,
	toYoctoNear,
} from "../runtime.js";

type NearBuildTransferNearTransactionParams = {
	toAccountId: string;
	amountYoctoNear?: string;
	amountNear?: string | number;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
};

type NearBuildTransferFtTransactionParams = {
	ftContractId: string;
	toAccountId: string;
	amountRaw: string;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBuildRefSwapTransactionParams = {
	tokenInId: string;
	tokenOutId: string;
	amountInRaw: string;
	minAmountOutRaw?: string;
	poolId?: number | string;
	slippageBps?: number;
	refContractId?: string;
	autoRegisterOutput?: boolean;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBuildIntentsSwapDepositTransactionParams = {
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
	network?: string;
	rpcUrl?: string;
	publicKey?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	jwt?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBuildRefAddLiquidityTransactionParams = {
	poolId?: number | string;
	amountsRaw?: string[];
	amountARaw?: string;
	amountBRaw?: string;
	amountA?: string | number;
	amountB?: string | number;
	tokenAId?: string;
	tokenBId?: string;
	refContractId?: string;
	autoRegisterExchange?: boolean;
	autoRegisterTokens?: boolean;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBuildRefRemoveLiquidityTransactionParams = {
	poolId?: number | string;
	shares?: string;
	shareBps?: number;
	sharePercent?: string | number;
	minAmountsRaw?: string[];
	minAmountARaw?: string;
	minAmountBRaw?: string;
	tokenAId?: string;
	tokenBId?: string;
	refContractId?: string;
	autoWithdraw?: boolean;
	autoRegisterReceiver?: boolean;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBuildRefWithdrawTransactionParams = {
	tokenId: string;
	amountRaw?: string;
	withdrawAll?: boolean;
	refContractId?: string;
	autoRegisterReceiver?: boolean;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBuildSupplyBurrowTransactionParams = {
	tokenId: string;
	amountRaw: string;
	asCollateral?: boolean;
	burrowContractId?: string;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBuildBorrowBurrowTransactionParams = {
	tokenId: string;
	amountRaw: string;
	withdrawToWallet?: boolean;
	burrowContractId?: string;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBuildRepayBurrowTransactionParams = {
	tokenId: string;
	amountRaw: string;
	burrowContractId?: string;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearBuildWithdrawBurrowTransactionParams = {
	tokenId: string;
	amountRaw: string;
	recipientId?: string;
	burrowContractId?: string;
	fromAccountId?: string;
	publicKey?: string;
	network?: string;
	rpcUrl?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearCallFunctionResult = {
	result: number[];
	logs: string[];
	block_height: number;
	block_hash: string;
};

type NearAccessKeyPermission = unknown;

type NearAccessKeyEntry = {
	public_key?: string;
	access_key?: {
		nonce?: string | number | bigint;
		permission?: NearAccessKeyPermission;
	};
};

type NearViewAccessKeyListResult = {
	keys?: NearAccessKeyEntry[];
	block_hash?: string;
	block_height?: number;
};

type NearViewAccessKeyResult = {
	nonce?: string | number | bigint;
	permission?: NearAccessKeyPermission;
	block_hash?: string;
	block_height?: number;
};

type NearStorageBalance = {
	total: string;
	available?: string;
};

type NearStorageBalanceBounds = {
	min: string;
	max?: string;
};

type NearIntentsBadRequest = {
	message?: string;
	statusCode?: number;
	error?: string;
	timestamp?: string;
	path?: string;
};

type NearIntentsQueryParams = Record<string, string | undefined>;

type NearIntentsSwapType =
	| "EXACT_INPUT"
	| "EXACT_OUTPUT"
	| "FLEX_INPUT"
	| "ANY_INPUT";
type NearIntentsTransferType = "ORIGIN_CHAIN" | "INTENTS";
type NearIntentsRecipientType = "DESTINATION_CHAIN" | "INTENTS";
type NearIntentsDepositMode = "SIMPLE" | "MEMO";

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

type ActionSummary =
	| {
			type: "Transfer";
			depositYoctoNear: string;
	  }
	| {
			type: "FunctionCall";
			methodName: string;
			args: Record<string, unknown>;
			gas: string;
			depositYoctoNear: string;
	  };

type WalletSelectorAction =
	| {
			type: "Transfer";
			params: {
				deposit: string;
			};
	  }
	| {
			type: "FunctionCall";
			params: {
				methodName: string;
				args: Record<string, unknown>;
				gas: string;
				deposit: string;
			};
	  };

type UnsignedTransactionArtifact = {
	label: string;
	receiverId: string;
	nonce: string;
	blockHash: string;
	unsignedPayload: string;
	transactionBase64: string;
	actionSummaries: ActionSummary[];
	walletSelectorTransaction: {
		signerId: string;
		receiverId: string;
		actions: WalletSelectorAction[];
	};
};

type ComposeAccessKeyState = {
	signerPublicKey: string;
	source: "provided" | "rpc_full_access" | "rpc_first_key";
	nextNonce: bigint;
	blockHash: string;
	blockHeight: number | null;
	permission: NearAccessKeyPermission;
};

type StorageRegistrationStatus =
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

const DEFAULT_FUNCTION_CALL_GAS = 30_000_000_000_000n;
const DEFAULT_REF_SWAP_GAS = 180_000_000_000_000n;
const DEFAULT_REF_WITHDRAW_GAS = 180_000_000_000_000n;
const DEFAULT_BURROW_CALL_GAS = 180_000_000_000_000n;
const DEFAULT_BURROW_EXECUTE_GAS = 250_000_000_000_000n;
const DEFAULT_ATTACHED_DEPOSIT = 1n;
const DEFAULT_FT_STORAGE_DEPOSIT_YOCTO_NEAR = 1_250_000_000_000_000_000_000n;
const DEFAULT_STORAGE_DEPOSIT_GAS = 30_000_000_000_000n;
const DEFAULT_REF_ACCOUNT_STORAGE_DEPOSIT_YOCTO_NEAR =
	100_000_000_000_000_000_000_000n;
const DEFAULT_REF_REGISTER_TOKENS_GAS = 40_000_000_000_000n;
const DEFAULT_REF_DEPOSIT_TOKEN_GAS = 70_000_000_000_000n;
const DEFAULT_NEAR_SWAP_SLIPPAGE_BPS = 50;
const DEFAULT_NEAR_SWAP_MAX_SLIPPAGE_BPS = 1000;
const HARD_MAX_NEAR_SWAP_SLIPPAGE_BPS = 5000;
const DEFAULT_NEAR_INTENTS_API_BASE_URL = "https://1click.chaindefuser.com";

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

function parseNonce(value: unknown, fieldName: string): bigint {
	if (typeof value === "bigint") {
		if (value < 0n) throw new Error(`${fieldName} must be non-negative`);
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
			throw new Error(`${fieldName} must be a non-negative integer`);
		}
		return BigInt(value);
	}
	if (typeof value === "string") {
		const normalized = value.trim();
		if (!/^\d+$/.test(normalized)) {
			throw new Error(`${fieldName} must be a non-negative integer`);
		}
		return BigInt(normalized);
	}
	throw new Error(`${fieldName} is missing`);
}

function normalizeNonEmptyText(value: string, fieldName: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

function normalizeAccountId(value: string, fieldName: string): string {
	const normalized = normalizeNonEmptyText(value, fieldName).replace(/^@/, "");
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

function isFullAccessPermission(permission: unknown): boolean {
	if (permission === "FullAccess") return true;
	if (!permission || typeof permission !== "object") return false;
	const record = permission as Record<string, unknown>;
	return (
		"FullAccess" in record || "fullAccess" in record || "full_access" in record
	);
}

function resolveTransferAmountYoctoNear(
	params: NearBuildTransferNearTransactionParams,
): string {
	if (
		typeof params.amountYoctoNear === "string" &&
		params.amountYoctoNear.trim()
	) {
		return parsePositiveBigInt(
			params.amountYoctoNear,
			"amountYoctoNear",
		).toString();
	}
	if (params.amountNear != null) {
		return toYoctoNear(params.amountNear).toString();
	}
	throw new Error("Provide amountYoctoNear or amountNear");
}

function resolveRequestGas(value?: string): string {
	if (typeof value !== "string" || !value.trim()) {
		return DEFAULT_FUNCTION_CALL_GAS.toString();
	}
	return parsePositiveBigInt(value, "gas").toString();
}

function resolveRefSwapGas(value?: string): string {
	if (typeof value !== "string" || !value.trim()) {
		return DEFAULT_REF_SWAP_GAS.toString();
	}
	return parsePositiveBigInt(value, "gas").toString();
}

function resolveRefWithdrawGas(value?: string): string {
	if (typeof value !== "string" || !value.trim()) {
		return DEFAULT_REF_WITHDRAW_GAS.toString();
	}
	return parsePositiveBigInt(value, "gas").toString();
}

function resolveBurrowCallGas(value?: string): string {
	if (typeof value !== "string" || !value.trim()) {
		return DEFAULT_BURROW_CALL_GAS.toString();
	}
	return parsePositiveBigInt(value, "gas").toString();
}

function resolveBurrowExecuteGas(value?: string): string {
	if (typeof value !== "string" || !value.trim()) {
		return DEFAULT_BURROW_EXECUTE_GAS.toString();
	}
	return parsePositiveBigInt(value, "gas").toString();
}

function buildBurrowAssetAmountAction(params: {
	action: "IncreaseCollateral" | "Borrow" | "Withdraw";
	tokenId: string;
	amountInner?: string;
}): Record<string, unknown> {
	return {
		[params.action]: {
			token_id: params.tokenId,
			amount:
				typeof params.amountInner === "string" && params.amountInner.trim()
					? params.amountInner.trim()
					: null,
			max_amount: null,
		},
	};
}

function buildBurrowExecuteMessage(actions: Record<string, unknown>[]): string {
	return JSON.stringify({
		Execute: {
			actions,
		},
	});
}

function parseOptionalPoolId(value?: number | string): number | undefined {
	if (value == null) return undefined;
	if (typeof value === "string" && !value.trim()) return undefined;
	const normalized = typeof value === "number" ? value : Number(value.trim());
	if (
		!Number.isFinite(normalized) ||
		!Number.isInteger(normalized) ||
		normalized < 0
	) {
		throw new Error("poolId must be a non-negative integer");
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

function resolveNearSwapSlippageBps(value?: number): number {
	if (value == null) return DEFAULT_NEAR_SWAP_SLIPPAGE_BPS;
	if (
		!Number.isFinite(value) ||
		value < 0 ||
		value > HARD_MAX_NEAR_SWAP_SLIPPAGE_BPS
	) {
		throw new Error(
			`slippageBps must be between 0 and ${HARD_MAX_NEAR_SWAP_SLIPPAGE_BPS}`,
		);
	}
	const normalized = Math.floor(value);
	const limit = resolveNearSwapSlippageLimitBps();
	if (normalized > limit) {
		throw new Error(
			`slippageBps ${normalized} exceeds configured safety limit (${limit}).`,
		);
	}
	return normalized;
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
		const requested = parsePositiveBigInt(
			params.requestedMinAmountOutRaw,
			"minAmountOutRaw",
		);
		if (requested < quoteMinAmountOutRaw) {
			throw new Error(
				`minAmountOutRaw is below safe minimum from quote (${quoteMinAmountOutRaw.toString()}).`,
			);
		}
		return requested.toString();
	}
	return quoteMinAmountOutRaw.toString();
}

function parseScaledDecimalToRaw(
	value: string | number,
	decimals: number,
	fieldName: string,
): string {
	const normalized =
		typeof value === "number" ? value.toString() : value.trim();
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

function parseShareBps(value: number | undefined, fieldName: string): number {
	if (value == null) {
		throw new Error(`${fieldName} is required`);
	}
	if (!Number.isFinite(value) || value <= 0 || value > 10_000) {
		throw new Error(`${fieldName} must be between 1 and 10000`);
	}
	return Math.floor(value);
}

function parseSharePercent(
	value: string | number | undefined,
	fieldName: string,
): number {
	if (value == null) {
		throw new Error(`${fieldName} is required`);
	}
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

function isNearIntentsNativeToken(token: NearIntentsToken): boolean {
	if (token.blockchain.trim().toLowerCase() !== "near") return false;
	const contractAddress = token.contractAddress?.trim().toLowerCase() ?? "";
	return !contractAddress;
}

function normalizeTokenIdList(tokenIds: string[]): string[] {
	return tokenIds
		.map((tokenId) => tokenId.trim().toLowerCase())
		.filter(Boolean);
}

function resolvePoolTokenId(params: {
	network: string;
	tokenInput?: string;
	poolTokenIds: string[];
	defaultTokenId: string;
	fieldName: string;
}): string {
	if (!params.tokenInput || !params.tokenInput.trim()) {
		return params.defaultTokenId;
	}
	const matches = resolveRefTokenIds({
		network: params.network,
		tokenIdOrSymbol: params.tokenInput,
		availableTokenIds: params.poolTokenIds,
	});
	if (!matches[0]) {
		throw new Error(
			`${params.fieldName} does not match pool tokens: ${params.tokenInput}`,
		);
	}
	return matches[0];
}

function resolveRawAmountByToken(params: {
	network: string;
	rawValue?: string;
	uiValue?: string | number;
	tokenInput: string;
	fieldRaw: string;
	fieldUi: string;
}): string {
	if (typeof params.rawValue === "string" && params.rawValue.trim()) {
		return parsePositiveBigInt(params.rawValue, params.fieldRaw).toString();
	}
	if (params.uiValue == null) {
		throw new Error(`Provide ${params.fieldRaw} or ${params.fieldUi}`);
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
	const rawAmount = parseScaledDecimalToRaw(
		params.uiValue,
		decimals,
		params.fieldUi,
	);
	parsePositiveBigInt(rawAmount, params.fieldUi);
	return rawAmount;
}

function resolveAddLiquidityAmounts(params: {
	network: string;
	poolTokenIds: string[];
	amountsRaw?: string[];
	amountARaw?: string;
	amountBRaw?: string;
	amountA?: string | number;
	amountB?: string | number;
	tokenAId?: string;
	tokenBId?: string;
}): {
	amountsRaw: string[];
	tokenAId: string;
	tokenBId: string;
} {
	const poolTokenIds = normalizeTokenIdList(params.poolTokenIds);
	if (poolTokenIds.length < 2) {
		throw new Error("Ref pool must include at least 2 tokens");
	}
	if (Array.isArray(params.amountsRaw) && params.amountsRaw.length > 0) {
		if (params.amountsRaw.length !== poolTokenIds.length) {
			throw new Error(
				`amountsRaw must include ${poolTokenIds.length} entries for pool token order`,
			);
		}
		const normalized = params.amountsRaw.map((value, index) =>
			parseNonNegativeBigInt(value, `amountsRaw[${index}]`).toString(),
		);
		const hasPositive = normalized.some((value) => BigInt(value) > 0n);
		if (!hasPositive) {
			throw new Error("amountsRaw must include at least one positive amount");
		}
		return {
			amountsRaw: normalized,
			tokenAId: poolTokenIds[0] ?? "",
			tokenBId: poolTokenIds[1] ?? "",
		};
	}

	const tokenAId = resolvePoolTokenId({
		network: params.network,
		tokenInput: params.tokenAId,
		poolTokenIds,
		defaultTokenId: poolTokenIds[0] ?? "",
		fieldName: "tokenAId",
	});
	const tokenBId = resolvePoolTokenId({
		network: params.network,
		tokenInput: params.tokenBId,
		poolTokenIds,
		defaultTokenId: poolTokenIds[1] ?? "",
		fieldName: "tokenBId",
	});
	let resolvedTokenAId = tokenAId;
	let resolvedTokenBId = tokenBId;
	if (
		resolvedTokenAId === resolvedTokenBId &&
		typeof params.tokenAId === "string" &&
		params.tokenAId.trim() &&
		(!params.tokenBId || !params.tokenBId.trim())
	) {
		resolvedTokenBId =
			poolTokenIds.find((tokenId) => tokenId !== resolvedTokenAId) ?? "";
	}
	if (
		resolvedTokenAId === resolvedTokenBId &&
		typeof params.tokenBId === "string" &&
		params.tokenBId.trim() &&
		(!params.tokenAId || !params.tokenAId.trim())
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
			"tokenAId and tokenBId must resolve to two distinct tokens",
		);
	}
	const amountA = resolveRawAmountByToken({
		network: params.network,
		rawValue: params.amountARaw,
		uiValue: params.amountA,
		tokenInput: resolvedTokenAId,
		fieldRaw: "amountARaw",
		fieldUi: "amountA",
	});
	const amountB = resolveRawAmountByToken({
		network: params.network,
		rawValue: params.amountBRaw,
		uiValue: params.amountB,
		tokenInput: resolvedTokenBId,
		fieldRaw: "amountBRaw",
		fieldUi: "amountB",
	});
	const amountsRaw = poolTokenIds.map(() => "0");
	const tokenAIndex = poolTokenIds.indexOf(resolvedTokenAId);
	const tokenBIndex = poolTokenIds.indexOf(resolvedTokenBId);
	if (tokenAIndex < 0 || tokenBIndex < 0) {
		throw new Error("tokenAId/tokenBId are not part of the selected pool");
	}
	amountsRaw[tokenAIndex] = amountA;
	amountsRaw[tokenBIndex] = amountB;
	return {
		amountsRaw,
		tokenAId: resolvedTokenAId,
		tokenBId: resolvedTokenBId,
	};
}

function resolveRemoveLiquidityMinAmounts(params: {
	poolTokenIds: string[];
	minAmountsRaw?: string[];
	minAmountARaw?: string;
	minAmountBRaw?: string;
}): string[] {
	const poolTokenIds = normalizeTokenIdList(params.poolTokenIds);
	if (poolTokenIds.length < 2) {
		throw new Error("Ref pool must include at least 2 tokens");
	}
	if (Array.isArray(params.minAmountsRaw) && params.minAmountsRaw.length > 0) {
		if (params.minAmountsRaw.length !== poolTokenIds.length) {
			throw new Error(
				`minAmountsRaw must include ${poolTokenIds.length} entries for pool token order`,
			);
		}
		return params.minAmountsRaw.map((value, index) =>
			parseNonNegativeBigInt(value, `minAmountsRaw[${index}]`).toString(),
		);
	}
	const result = poolTokenIds.map(() => "0");
	if (typeof params.minAmountARaw === "string" && params.minAmountARaw.trim()) {
		result[0] = parseNonNegativeBigInt(
			params.minAmountARaw,
			"minAmountARaw",
		).toString();
	}
	if (typeof params.minAmountBRaw === "string" && params.minAmountBRaw.trim()) {
		result[1] = parseNonNegativeBigInt(
			params.minAmountBRaw,
			"minAmountBRaw",
		).toString();
	}
	return result;
}

function resolveAttachedDeposit(value?: string): string {
	if (typeof value !== "string" || !value.trim()) {
		return DEFAULT_ATTACHED_DEPOSIT.toString();
	}
	return parseNonNegativeBigInt(value, "attachedDepositYoctoNear").toString();
}

function encodeNearCallArgs(args: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(args), "utf8").toString("base64");
}

function decodeNearCallResultJson<T>(payload: NearCallFunctionResult): T {
	if (!Array.isArray(payload.result)) {
		throw new Error("Invalid call_function result payload");
	}
	const utf8 = Buffer.from(Uint8Array.from(payload.result)).toString("utf8");
	if (!utf8.trim()) {
		throw new Error("call_function returned empty payload");
	}
	return JSON.parse(utf8) as T;
}

function extractErrorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function isMissingMethodError(error: unknown): boolean {
	const lower = extractErrorText(error).toLowerCase();
	return (
		lower.includes("methodnotfound") ||
		lower.includes("does not exist while viewing") ||
		lower.includes("unknown method")
	);
}

function decodeBlockHash(blockHash: string): Uint8Array {
	const normalized = normalizeNonEmptyText(blockHash, "block_hash");
	const decoded = bs58.decode(normalized);
	if (decoded.length !== 32) {
		throw new Error("block_hash must decode to 32 bytes");
	}
	return decoded;
}

async function resolveComposeAccessKeyState(params: {
	accountId: string;
	publicKey?: string;
	network: string;
	rpcUrl?: string;
}): Promise<ComposeAccessKeyState> {
	const providedPublicKey =
		typeof params.publicKey === "string" && params.publicKey.trim()
			? params.publicKey.trim()
			: undefined;
	if (providedPublicKey) {
		// Validate user-provided key format early for clearer errors.
		PublicKey.from(providedPublicKey);
		const result = await callNearRpc<NearViewAccessKeyResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "view_access_key",
				finality: "final",
				account_id: params.accountId,
				public_key: providedPublicKey,
			},
		});
		const nonce = parseNonce(result.nonce, "accessKey.nonce") + 1n;
		const blockHash = normalizeNonEmptyText(
			typeof result.block_hash === "string" ? result.block_hash : "",
			"block_hash",
		);
		return {
			signerPublicKey: providedPublicKey,
			source: "provided",
			nextNonce: nonce,
			blockHash,
			blockHeight:
				typeof result.block_height === "number" &&
				Number.isFinite(result.block_height)
					? result.block_height
					: null,
			permission: result.permission ?? null,
		};
	}

	const keyList = await callNearRpc<NearViewAccessKeyListResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			request_type: "view_access_key_list",
			finality: "final",
			account_id: params.accountId,
		},
	});
	const entries = Array.isArray(keyList.keys) ? keyList.keys : [];
	if (entries.length === 0) {
		throw new Error(
			`No access keys found for signer ${params.accountId}. Provide publicKey explicitly or add an access key.`,
		);
	}
	const selectedEntry =
		entries.find((entry) =>
			isFullAccessPermission(entry.access_key?.permission ?? null),
		) ?? entries[0];
	const publicKey = normalizeNonEmptyText(
		typeof selectedEntry.public_key === "string"
			? selectedEntry.public_key
			: "",
		"accessKey.public_key",
	);
	PublicKey.from(publicKey);
	const nonce =
		parseNonce(selectedEntry.access_key?.nonce, "accessKey.nonce") + 1n;
	const blockHash = normalizeNonEmptyText(
		typeof keyList.block_hash === "string" ? keyList.block_hash : "",
		"block_hash",
	);
	return {
		signerPublicKey: publicKey,
		source: isFullAccessPermission(selectedEntry.access_key?.permission ?? null)
			? "rpc_full_access"
			: "rpc_first_key",
		nextNonce: nonce,
		blockHash,
		blockHeight:
			typeof keyList.block_height === "number" &&
			Number.isFinite(keyList.block_height)
				? keyList.block_height
				: null,
		permission: selectedEntry.access_key?.permission ?? null,
	};
}

function createUnsignedTransactionArtifact(params: {
	label: string;
	signerAccountId: string;
	signerPublicKey: string;
	receiverId: string;
	nonce: bigint;
	blockHash: string;
	actions: Action[];
	actionSummaries: ActionSummary[];
}): UnsignedTransactionArtifact {
	const transaction = createTransaction(
		params.signerAccountId,
		PublicKey.from(params.signerPublicKey),
		params.receiverId,
		params.nonce,
		params.actions,
		decodeBlockHash(params.blockHash),
	);
	const transactionBytes = encodeTransaction(transaction);
	const transactionBase64 = Buffer.from(transactionBytes).toString("base64");
	const walletActions: WalletSelectorAction[] = params.actionSummaries.map(
		(summary) =>
			summary.type === "Transfer"
				? {
						type: "Transfer",
						params: {
							deposit: summary.depositYoctoNear,
						},
					}
				: {
						type: "FunctionCall",
						params: {
							methodName: summary.methodName,
							args: summary.args,
							gas: summary.gas,
							deposit: summary.depositYoctoNear,
						},
					},
	);

	return {
		label: params.label,
		receiverId: params.receiverId,
		nonce: params.nonce.toString(),
		blockHash: params.blockHash,
		unsignedPayload: transactionBase64,
		transactionBase64,
		actionSummaries: params.actionSummaries,
		walletSelectorTransaction: {
			signerId: params.signerAccountId,
			receiverId: params.receiverId,
			actions: walletActions,
		},
	};
}

async function queryRefUserDeposits(params: {
	network: string;
	rpcUrl?: string;
	refContractId: string;
	accountId: string;
}): Promise<Record<string, string>> {
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			request_type: "call_function",
			account_id: params.refContractId,
			method_name: "get_deposits",
			args_base64: encodeNearCallArgs({
				account_id: params.accountId,
			}),
			finality: "final",
		},
	});
	const parsed = decodeNearCallResultJson<Record<string, string>>(result);
	if (!parsed || typeof parsed !== "object") {
		return {};
	}
	const deposits: Record<string, string> = {};
	for (const [tokenId, rawAmount] of Object.entries(parsed)) {
		if (typeof tokenId !== "string" || typeof rawAmount !== "string") continue;
		const normalizedTokenId = tokenId.trim().toLowerCase();
		if (!normalizedTokenId) continue;
		deposits[normalizedTokenId] = parseNonNegativeBigInt(
			rawAmount,
			`deposits[${normalizedTokenId}]`,
		).toString();
	}
	return deposits;
}

async function queryRefPoolShares(params: {
	network: string;
	rpcUrl?: string;
	refContractId: string;
	poolId: number;
	accountId: string;
}): Promise<string> {
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			request_type: "call_function",
			account_id: params.refContractId,
			method_name: "get_pool_shares",
			args_base64: encodeNearCallArgs({
				pool_id: params.poolId,
				account_id: params.accountId,
			}),
			finality: "final",
		},
	});
	const parsed = decodeNearCallResultJson<string>(result);
	return parseNonNegativeBigInt(parsed, "poolShares").toString();
}

function resolveRefWithdrawTokenId(params: {
	network: string;
	tokenInput: string;
	availableTokenIds: string[];
}): string {
	const tokenInput = normalizeNonEmptyText(
		params.tokenInput,
		"tokenId",
	).toLowerCase();
	const matches = resolveRefTokenIds({
		network: params.network,
		tokenIdOrSymbol: tokenInput,
		availableTokenIds: params.availableTokenIds.map((tokenId) =>
			tokenId.toLowerCase(),
		),
	});
	if (matches[0]) return matches[0];
	if (tokenInput.includes(".")) return tokenInput;
	const fallback = resolveRefTokenIds({
		network: params.network,
		tokenIdOrSymbol: tokenInput,
	});
	if (fallback[0]) return fallback[0];
	throw new Error(`Cannot resolve tokenId: ${params.tokenInput}`);
}

async function queryStorageRegistrationStatus(params: {
	network: string;
	rpcUrl?: string;
	ftContractId: string;
	accountId: string;
	fallbackMinimumYoctoNear?: bigint;
}): Promise<StorageRegistrationStatus> {
	try {
		const balanceResult = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "call_function",
				account_id: params.ftContractId,
				method_name: "storage_balance_of",
				args_base64: encodeNearCallArgs({
					account_id: params.accountId,
				}),
				finality: "final",
			},
		});
		const balance = decodeNearCallResultJson<NearStorageBalance | null>(
			balanceResult,
		);
		if (
			balance &&
			typeof balance.total === "string" &&
			parseNonNegativeBigInt(balance.total, "storageBalance.total") > 0n
		) {
			return {
				status: "registered",
			};
		}
	} catch (error) {
		if (isMissingMethodError(error)) {
			return {
				status: "unknown",
				reason: "token does not expose storage_balance_of",
			};
		}
		throw error;
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
				args_base64: encodeNearCallArgs({}),
				finality: "final",
			},
		});
		const bounds =
			decodeNearCallResultJson<NearStorageBalanceBounds>(boundsResult);
		const minDeposit =
			bounds && typeof bounds.min === "string" && bounds.min.trim()
				? parseNonNegativeBigInt(bounds.min, "storageBalanceBounds.min")
				: (params.fallbackMinimumYoctoNear ??
					DEFAULT_FT_STORAGE_DEPOSIT_YOCTO_NEAR);
		return {
			status: "needs_registration",
			estimatedDepositYoctoNear: minDeposit.toString(),
		};
	} catch (error) {
		if (isMissingMethodError(error)) {
			return {
				status: "unknown",
				reason: "token does not expose storage_balance_bounds",
			};
		}
		throw error;
	}
}

async function resolveBurrowTokenAndAsset(params: {
	network: string;
	rpcUrl?: string;
	burrowContractId?: string;
	tokenInput: string;
}): Promise<{
	burrowContractId: string;
	tokenId: string;
	extraDecimals: number;
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
	const marketIds = markets.map((entry) => entry.token_id.toLowerCase());
	const tokenId = resolveBurrowTokenId({
		network: params.network,
		tokenInput: params.tokenInput,
		availableTokenIds: marketIds,
	});
	const market = markets.find(
		(entry) => entry.token_id.toLowerCase() === tokenId,
	);
	const resolvedAsset =
		market ??
		(await fetchBurrowAsset({
			network: params.network,
			rpcUrl: params.rpcUrl,
			burrowContractId,
			tokenId,
		}));
	if (!resolvedAsset) {
		throw new Error(`Burrow market not found for token: ${tokenId}`);
	}
	const extraDecimals = parseBurrowExtraDecimals(
		resolvedAsset.config?.extra_decimals,
	);
	return {
		burrowContractId,
		tokenId,
		extraDecimals,
	};
}

export function createNearComposeTools(): RegisteredTool[] {
	return [
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildTransferNearTransaction`,
			label: "NEAR Build Transfer Native Transaction",
			description:
				"Build an unsigned NEAR native transfer transaction payload for local signing.",
			parameters: Type.Object({
				toAccountId: Type.String({
					description: "Destination NEAR account id.",
				}),
				amountYoctoNear: Type.Optional(
					Type.String({
						description: "Amount in yoctoNEAR (raw integer string).",
					}),
				),
				amountNear: Type.Optional(
					Type.Union([
						Type.String({ description: "Amount in NEAR decimal string." }),
						Type.Number({ description: "Amount in NEAR." }),
					]),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				publicKey: Type.Optional(
					Type.String({
						description:
							"Public key used for nonce/access-key lookup, e.g. ed25519:.... If omitted, auto-select from account access keys.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const receiverId = normalizeAccountId(
					params.toAccountId,
					"toAccountId",
				);
				const amountYoctoNear = resolveTransferAmountYoctoNear(params);
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const artifact = createUnsignedTransactionArtifact({
					label: "transfer_near",
					signerAccountId,
					signerPublicKey: keyState.signerPublicKey,
					receiverId,
					nonce: keyState.nextNonce,
					blockHash: keyState.blockHash,
					actions: [actions.transfer(BigInt(amountYoctoNear))],
					actionSummaries: [
						{
							type: "Transfer",
							depositYoctoNear: amountYoctoNear,
						},
					],
				});
				return {
					content: [
						{
							type: "text",
							text: `Unsigned NEAR transfer built: ${amountYoctoNear} yoctoNEAR -> ${receiverId}.`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						transactionCount: 1,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly.",
						transaction: artifact,
						transactions: [artifact],
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildTransferFtTransaction`,
			label: "NEAR Build Transfer FT Transaction",
			description:
				"Build an unsigned NEP-141 ft_transfer transaction payload for local signing.",
			parameters: Type.Object({
				ftContractId: Type.String({
					description: "FT contract account id.",
				}),
				toAccountId: Type.String({
					description: "Destination NEAR account id.",
				}),
				amountRaw: Type.String({
					description: "FT amount in raw integer string.",
				}),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				publicKey: Type.Optional(
					Type.String({
						description:
							"Public key used for nonce/access-key lookup, e.g. ed25519:.... If omitted, auto-select from account access keys.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas in yoctoGas for ft_transfer (default 30000000000000 / 30 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit in yoctoNEAR (default 1 for ft_transfer).",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const ftContractId = normalizeAccountId(
					params.ftContractId,
					"ftContractId",
				);
				const toAccountId = normalizeAccountId(
					params.toAccountId,
					"toAccountId",
				);
				const amountRaw = parsePositiveBigInt(
					params.amountRaw,
					"amountRaw",
				).toString();
				const gas = resolveRequestGas(params.gas);
				const deposit = resolveAttachedDeposit(params.attachedDepositYoctoNear);
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const artifact = createUnsignedTransactionArtifact({
					label: "transfer_ft",
					signerAccountId,
					signerPublicKey: keyState.signerPublicKey,
					receiverId: ftContractId,
					nonce: keyState.nextNonce,
					blockHash: keyState.blockHash,
					actions: [
						actions.functionCall(
							"ft_transfer",
							{
								receiver_id: toAccountId,
								amount: amountRaw,
							},
							BigInt(gas),
							BigInt(deposit),
						),
					],
					actionSummaries: [
						{
							type: "FunctionCall",
							methodName: "ft_transfer",
							args: {
								receiver_id: toAccountId,
								amount: amountRaw,
							},
							gas,
							depositYoctoNear: deposit,
						},
					],
				});
				return {
					content: [
						{
							type: "text",
							text: `Unsigned FT transfer built: ${amountRaw} raw ${ftContractId} -> ${toAccountId}.`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						transactionCount: 1,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly.",
						transaction: artifact,
						transactions: [artifact],
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildSupplyBurrowTransaction`,
			label: "NEAR Build Burrow Supply Transaction",
			description:
				"Build an unsigned Burrow supply transaction (ft_transfer_call) for local signing.",
			parameters: Type.Object({
				tokenId: Type.String({
					description: "Token contract id or common symbol (e.g. NEAR/USDC).",
				}),
				amountRaw: Type.String({
					description: "Token amount in raw integer units.",
				}),
				asCollateral: Type.Optional(
					Type.Boolean({
						description:
							"Mark supplied amount as collateral in the same transaction (default true).",
					}),
				),
				burrowContractId: Type.Optional(
					Type.String({
						description:
							"Burrow contract id override (default contract.main.burrow.near).",
					}),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				publicKey: Type.Optional(
					Type.String({
						description:
							"Public key used for nonce/access-key lookup, e.g. ed25519:.... If omitted, auto-select from account access keys.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas for ft_transfer_call in yoctoGas (default 180000000000000 / 180 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit for ft_transfer_call in yoctoNEAR (default 1).",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearBuildSupplyBurrowTransactionParams;
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const amountRaw = parseBurrowActionAmountRaw(
					params.amountRaw,
					"amountRaw",
				);
				const asCollateral = params.asCollateral !== false;
				const gas = resolveBurrowCallGas(params.gas);
				const deposit = resolveAttachedDeposit(params.attachedDepositYoctoNear);
				const { burrowContractId, tokenId } = await resolveBurrowTokenAndAsset({
					network,
					rpcUrl: params.rpcUrl,
					burrowContractId: params.burrowContractId,
					tokenInput: params.tokenId,
				});
				const msg = asCollateral
					? buildBurrowExecuteMessage([
							buildBurrowAssetAmountAction({
								action: "IncreaseCollateral",
								tokenId,
							}),
						])
					: "";
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const artifact = createUnsignedTransactionArtifact({
					label: "burrow_supply",
					signerAccountId,
					signerPublicKey: keyState.signerPublicKey,
					receiverId: tokenId,
					nonce: keyState.nextNonce,
					blockHash: keyState.blockHash,
					actions: [
						actions.functionCall(
							"ft_transfer_call",
							{
								receiver_id: burrowContractId,
								amount: amountRaw,
								msg,
							},
							BigInt(gas),
							BigInt(deposit),
						),
					],
					actionSummaries: [
						{
							type: "FunctionCall",
							methodName: "ft_transfer_call",
							args: {
								receiver_id: burrowContractId,
								amount: amountRaw,
								msg,
							},
							gas,
							depositYoctoNear: deposit,
						},
					],
				});
				return {
					content: [
						{
							type: "text",
							text: `Unsigned Burrow supply built: ${amountRaw} raw ${tokenId}${asCollateral ? " (as collateral)" : ""}.`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						tokenId,
						amountRaw,
						asCollateral,
						burrowContractId,
						transactionCount: 1,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly.",
						transaction: artifact,
						transactions: [artifact],
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildBorrowBurrowTransaction`,
			label: "NEAR Build Burrow Borrow Transaction",
			description:
				"Build an unsigned Burrow borrow transaction (execute) for local signing.",
			parameters: Type.Object({
				tokenId: Type.String({
					description: "Borrow token contract id or common symbol.",
				}),
				amountRaw: Type.String({
					description: "Borrow amount in token raw units.",
				}),
				withdrawToWallet: Type.Optional(
					Type.Boolean({
						description:
							"Auto-withdraw borrowed amount in same execute call (default true).",
					}),
				),
				burrowContractId: Type.Optional(
					Type.String({
						description:
							"Burrow contract id override (default contract.main.burrow.near).",
					}),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				publicKey: Type.Optional(
					Type.String({
						description:
							"Public key used for nonce/access-key lookup, e.g. ed25519:.... If omitted, auto-select from account access keys.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas for execute in yoctoGas (default 250000000000000 / 250 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit for execute in yoctoNEAR (default 1).",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearBuildBorrowBurrowTransactionParams;
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const amountRaw = parseBurrowActionAmountRaw(
					params.amountRaw,
					"amountRaw",
				);
				const withdrawToWallet = params.withdrawToWallet !== false;
				const gas = resolveBurrowExecuteGas(params.gas);
				const deposit = resolveAttachedDeposit(params.attachedDepositYoctoNear);
				const { burrowContractId, tokenId, extraDecimals } =
					await resolveBurrowTokenAndAsset({
						network,
						rpcUrl: params.rpcUrl,
						burrowContractId: params.burrowContractId,
						tokenInput: params.tokenId,
					});
				const amountInner = toBurrowInnerAmount(amountRaw, extraDecimals);
				const actionsPayload = [
					buildBurrowAssetAmountAction({
						action: "Borrow",
						tokenId,
						amountInner,
					}),
					...(withdrawToWallet
						? [
								buildBurrowAssetAmountAction({
									action: "Withdraw",
									tokenId,
									amountInner,
								}),
							]
						: []),
				];
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const artifact = createUnsignedTransactionArtifact({
					label: "burrow_borrow",
					signerAccountId,
					signerPublicKey: keyState.signerPublicKey,
					receiverId: burrowContractId,
					nonce: keyState.nextNonce,
					blockHash: keyState.blockHash,
					actions: [
						actions.functionCall(
							"execute",
							{
								actions: actionsPayload,
							},
							BigInt(gas),
							BigInt(deposit),
						),
					],
					actionSummaries: [
						{
							type: "FunctionCall",
							methodName: "execute",
							args: {
								actions: actionsPayload,
							},
							gas,
							depositYoctoNear: deposit,
						},
					],
				});
				return {
					content: [
						{
							type: "text",
							text: `Unsigned Burrow borrow built: ${amountRaw} raw ${tokenId}${withdrawToWallet ? " (borrow+withdraw)" : ""}.`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						tokenId,
						amountRaw,
						amountInner,
						extraDecimals,
						withdrawToWallet,
						burrowContractId,
						actions: actionsPayload,
						transactionCount: 1,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly.",
						transaction: artifact,
						transactions: [artifact],
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildRepayBurrowTransaction`,
			label: "NEAR Build Burrow Repay Transaction",
			description:
				"Build an unsigned Burrow repay transaction (ft_transfer_call) for local signing.",
			parameters: Type.Object({
				tokenId: Type.String({
					description: "Repay token contract id or common symbol.",
				}),
				amountRaw: Type.String({
					description: "Repay amount in token raw units.",
				}),
				burrowContractId: Type.Optional(
					Type.String({
						description:
							"Burrow contract id override (default contract.main.burrow.near).",
					}),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				publicKey: Type.Optional(
					Type.String({
						description:
							"Public key used for nonce/access-key lookup, e.g. ed25519:.... If omitted, auto-select from account access keys.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas for ft_transfer_call in yoctoGas (default 180000000000000 / 180 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit for ft_transfer_call in yoctoNEAR (default 1).",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearBuildRepayBurrowTransactionParams;
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const amountRaw = parseBurrowActionAmountRaw(
					params.amountRaw,
					"amountRaw",
				);
				const gas = resolveBurrowCallGas(params.gas);
				const deposit = resolveAttachedDeposit(params.attachedDepositYoctoNear);
				const { burrowContractId, tokenId } = await resolveBurrowTokenAndAsset({
					network,
					rpcUrl: params.rpcUrl,
					burrowContractId: params.burrowContractId,
					tokenInput: params.tokenId,
				});
				const repayMsg = JSON.stringify("OnlyRepay");
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const artifact = createUnsignedTransactionArtifact({
					label: "burrow_repay",
					signerAccountId,
					signerPublicKey: keyState.signerPublicKey,
					receiverId: tokenId,
					nonce: keyState.nextNonce,
					blockHash: keyState.blockHash,
					actions: [
						actions.functionCall(
							"ft_transfer_call",
							{
								receiver_id: burrowContractId,
								amount: amountRaw,
								msg: repayMsg,
							},
							BigInt(gas),
							BigInt(deposit),
						),
					],
					actionSummaries: [
						{
							type: "FunctionCall",
							methodName: "ft_transfer_call",
							args: {
								receiver_id: burrowContractId,
								amount: amountRaw,
								msg: repayMsg,
							},
							gas,
							depositYoctoNear: deposit,
						},
					],
				});
				return {
					content: [
						{
							type: "text",
							text: `Unsigned Burrow repay built: ${amountRaw} raw ${tokenId}.`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						tokenId,
						amountRaw,
						burrowContractId,
						transactionCount: 1,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly.",
						transaction: artifact,
						transactions: [artifact],
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildWithdrawBurrowTransaction`,
			label: "NEAR Build Burrow Withdraw Transaction",
			description:
				"Build an unsigned Burrow withdraw transaction (simple_withdraw) for local signing.",
			parameters: Type.Object({
				tokenId: Type.String({
					description: "Withdraw token contract id or common symbol.",
				}),
				amountRaw: Type.String({
					description: "Withdraw amount in token raw units.",
				}),
				recipientId: Type.Optional(
					Type.String({
						description: "Optional recipient account id (default signer).",
					}),
				),
				burrowContractId: Type.Optional(
					Type.String({
						description:
							"Burrow contract id override (default contract.main.burrow.near).",
					}),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				publicKey: Type.Optional(
					Type.String({
						description:
							"Public key used for nonce/access-key lookup, e.g. ed25519:.... If omitted, auto-select from account access keys.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas for simple_withdraw in yoctoGas (default 250000000000000 / 250 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit for simple_withdraw in yoctoNEAR (default 1).",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearBuildWithdrawBurrowTransactionParams;
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const amountRaw = parseBurrowActionAmountRaw(
					params.amountRaw,
					"amountRaw",
				);
				const gas = resolveBurrowExecuteGas(params.gas);
				const deposit = resolveAttachedDeposit(params.attachedDepositYoctoNear);
				const { burrowContractId, tokenId, extraDecimals } =
					await resolveBurrowTokenAndAsset({
						network,
						rpcUrl: params.rpcUrl,
						burrowContractId: params.burrowContractId,
						tokenInput: params.tokenId,
					});
				const recipientId =
					typeof params.recipientId === "string" && params.recipientId.trim()
						? normalizeAccountId(params.recipientId, "recipientId")
						: undefined;
				const amountInner = toBurrowInnerAmount(amountRaw, extraDecimals);
				const withdrawArgs = {
					token_id: tokenId,
					amount_with_inner_decimal: amountInner,
					...(recipientId ? { recipient_id: recipientId } : {}),
				};
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const artifact = createUnsignedTransactionArtifact({
					label: "burrow_withdraw",
					signerAccountId,
					signerPublicKey: keyState.signerPublicKey,
					receiverId: burrowContractId,
					nonce: keyState.nextNonce,
					blockHash: keyState.blockHash,
					actions: [
						actions.functionCall(
							"simple_withdraw",
							withdrawArgs,
							BigInt(gas),
							BigInt(deposit),
						),
					],
					actionSummaries: [
						{
							type: "FunctionCall",
							methodName: "simple_withdraw",
							args: withdrawArgs,
							gas,
							depositYoctoNear: deposit,
						},
					],
				});
				return {
					content: [
						{
							type: "text",
							text: `Unsigned Burrow withdraw built: ${amountRaw} raw ${tokenId}${recipientId ? ` -> ${recipientId}` : ""}.`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						tokenId,
						amountRaw,
						amountInner,
						extraDecimals,
						recipientId: recipientId ?? signerAccountId,
						burrowContractId,
						transactionCount: 1,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly.",
						transaction: artifact,
						transactions: [artifact],
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildIntentsSwapDepositTransaction`,
			label: "NEAR Build Intents Swap Deposit Transaction",
			description:
				"Build unsigned NEAR Intents deposit transaction payload for local signing (from /v0/quote depositAddress).",
			parameters: Type.Object({
				originAsset: Type.String({
					description: "Origin asset symbol or assetId.",
				}),
				destinationAsset: Type.String({
					description: "Destination asset symbol or assetId.",
				}),
				amount: Type.String({
					description: "Origin amount in raw integer string.",
				}),
				accountId: Type.Optional(
					Type.String({
						description: "Alias of signer account id (same as fromAccountId).",
					}),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
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
				slippageTolerance: Type.Optional(Type.Number()),
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
				publicKey: Type.Optional(Type.String()),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				jwt: Type.Optional(Type.String()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas for NEP-141 ft_transfer in yoctoGas (default 30000000000000 / 30 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit for NEP-141 ft_transfer in yoctoNEAR (default 1).",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params =
					rawParams as NearBuildIntentsSwapDepositTransactionParams;
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.accountId ?? params.fromAccountId,
					network,
				);
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const baseUrl = resolveNearIntentsApiBaseUrl(params.apiBaseUrl);
				const authHeaders = resolveNearIntentsHeaders({
					apiKey: params.apiKey,
					jwt: params.jwt,
				});
				const tokensResponse = await fetchNearIntentsJson<unknown[]>({
					baseUrl,
					path: "/v0/tokens",
					method: "GET",
					headers: authHeaders,
				});
				const tokens = normalizeNearIntentsTokens(tokensResponse.payload);
				const originAssetId = resolveNearIntentsAssetId({
					assetInput: params.originAsset,
					tokens,
					preferredBlockchain: params.blockchainHint,
					fieldName: "originAsset",
				});
				const destinationAssetId = resolveNearIntentsAssetId({
					assetInput: params.destinationAsset,
					tokens,
					preferredBlockchain: params.blockchainHint,
					fieldName: "destinationAsset",
				});
				if (originAssetId === destinationAssetId) {
					throw new Error("originAsset and destinationAsset must be different");
				}
				const recipient =
					typeof params.recipient === "string" && params.recipient.trim()
						? params.recipient.trim()
						: signerAccountId;
				const refundTo =
					typeof params.refundTo === "string" && params.refundTo.trim()
						? params.refundTo.trim()
						: recipient;
				const quoteWaitingTimeMs = parseIntentsQuoteWaitingTimeMs(
					params.quoteWaitingTimeMs,
				);
				const quoteRequest: NearIntentsQuoteRequest = {
					dry: true,
					swapType: params.swapType ?? "EXACT_INPUT",
					slippageTolerance: parseIntentsSlippageTolerance(
						params.slippageTolerance,
					),
					originAsset: originAssetId,
					depositType: params.depositType ?? "ORIGIN_CHAIN",
					destinationAsset: destinationAssetId,
					amount: parsePositiveBigInt(params.amount, "amount").toString(),
					refundTo,
					refundType: params.refundType ?? "ORIGIN_CHAIN",
					recipient,
					recipientType: params.recipientType ?? "DESTINATION_CHAIN",
					deadline: parseIntentsDeadline(params.deadline),
					depositMode: params.depositMode ?? "SIMPLE",
					...(quoteWaitingTimeMs != null
						? {
								quoteWaitingTimeMs,
							}
						: {}),
				};
				const quoteResponse =
					await fetchNearIntentsJson<NearIntentsQuoteResponse>({
						baseUrl,
						path: "/v0/quote",
						method: "POST",
						headers: authHeaders,
						body: quoteRequest as unknown as Record<string, unknown>,
					});
				const depositAddress = normalizeAccountId(
					quoteResponse.payload.quote.depositAddress ?? "",
					"quote.depositAddress",
				);
				const depositMemo =
					typeof quoteResponse.payload.quote.depositMemo === "string" &&
					quoteResponse.payload.quote.depositMemo.trim()
						? quoteResponse.payload.quote.depositMemo.trim()
						: undefined;
				const originToken = resolveNearIntentsTokenByAssetId(
					originAssetId,
					tokens,
				);
				if (!originToken) {
					throw new Error(
						`Cannot resolve origin token metadata for assetId ${originAssetId}`,
					);
				}
				if (originToken.blockchain.trim().toLowerCase() !== "near") {
					throw new Error(
						`originAsset blockchain '${originToken.blockchain}' is not supported for NEAR compose. Use NEAR-origin assets only.`,
					);
				}
				const amountInRaw = parsePositiveBigInt(
					quoteResponse.payload.quote.amountIn,
					"quote.amountIn",
				).toString();

				let artifact: UnsignedTransactionArtifact;
				let routeType: "native_transfer" | "ft_transfer";
				if (isNearIntentsNativeToken(originToken)) {
					if (depositMemo) {
						throw new Error(
							"Quote requires depositMemo, but native NEAR transfer cannot attach memo. Use a token-based origin asset or wallet flow that supports this quote.",
						);
					}
					routeType = "native_transfer";
					artifact = createUnsignedTransactionArtifact({
						label: "intents_deposit_near",
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						receiverId: depositAddress,
						nonce: keyState.nextNonce,
						blockHash: keyState.blockHash,
						actions: [actions.transfer(BigInt(amountInRaw))],
						actionSummaries: [
							{
								type: "Transfer",
								depositYoctoNear: amountInRaw,
							},
						],
					});
				} else {
					routeType = "ft_transfer";
					const ftContractId = normalizeAccountId(
						originToken.contractAddress ?? "",
						"originToken.contractAddress",
					);
					const transferGas = resolveRequestGas(params.gas);
					const transferDeposit = resolveAttachedDeposit(
						params.attachedDepositYoctoNear,
					);
					const ftArgs = {
						receiver_id: depositAddress,
						amount: amountInRaw,
						...(depositMemo ? { memo: depositMemo } : {}),
					};
					artifact = createUnsignedTransactionArtifact({
						label: "intents_deposit_ft",
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						receiverId: ftContractId,
						nonce: keyState.nextNonce,
						blockHash: keyState.blockHash,
						actions: [
							actions.functionCall(
								"ft_transfer",
								ftArgs,
								BigInt(transferGas),
								BigInt(transferDeposit),
							),
						],
						actionSummaries: [
							{
								type: "FunctionCall",
								methodName: "ft_transfer",
								args: ftArgs,
								gas: transferGas,
								depositYoctoNear: transferDeposit,
							},
						],
					});
				}
				return {
					content: [
						{
							type: "text",
							text: `Unsigned Intents deposit built: ${originAssetId} -> ${destinationAssetId} via ${routeType}.`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						apiBaseUrl: baseUrl,
						tokensEndpoint: tokensResponse.url,
						tokensHttpStatus: tokensResponse.status,
						quoteEndpoint: quoteResponse.url,
						quoteHttpStatus: quoteResponse.status,
						routeType,
						originAssetId,
						destinationAssetId,
						originToken,
						depositAddress,
						depositMemo: depositMemo ?? null,
						quoteRequest,
						quoteResponse: quoteResponse.payload,
						transactionCount: 1,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly.",
						transaction: artifact,
						transactions: [artifact],
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildAddLiquidityRefTransaction`,
			label: "NEAR Build Ref Add Liquidity Transaction",
			description:
				"Build unsigned Ref add-liquidity transaction payload(s) for local signing, including optional storage/deposit pre-transactions.",
			parameters: Type.Object({
				poolId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				amountsRaw: Type.Optional(Type.Array(Type.String())),
				amountARaw: Type.Optional(Type.String()),
				amountBRaw: Type.Optional(Type.String()),
				amountA: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				amountB: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				tokenAId: Type.Optional(Type.String()),
				tokenBId: Type.Optional(Type.String()),
				refContractId: Type.Optional(Type.String()),
				autoRegisterExchange: Type.Optional(Type.Boolean()),
				autoRegisterTokens: Type.Optional(Type.Boolean()),
				fromAccountId: Type.Optional(Type.String()),
				publicKey: Type.Optional(Type.String()),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				gas: Type.Optional(Type.String()),
				attachedDepositYoctoNear: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearBuildRefAddLiquidityTransactionParams;
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const addLiquidityGas = resolveRefSwapGas(params.gas);
				const addLiquidityDeposit = resolveAttachedDeposit(
					params.attachedDepositYoctoNear,
				);
				const autoRegisterExchange = params.autoRegisterExchange !== false;
				const autoRegisterTokens = params.autoRegisterTokens !== false;
				const refContractId = getRefContractId(network, params.refContractId);
				let poolId = parseOptionalPoolId(params.poolId);
				let poolSelectionSource: "explicitPool" | "bestLiquidityPool" =
					"explicitPool";
				let poolCandidates: RefPoolPairCandidate[] = [];
				let inferredPair:
					| {
							tokenAId: string;
							tokenBId: string;
							liquidityScore: string;
					  }
					| undefined;
				const pool =
					poolId != null
						? await fetchRefPoolById({
								network,
								rpcUrl: params.rpcUrl,
								refContractId,
								poolId,
							})
						: await (async () => {
								const tokenAInput = params.tokenAId?.trim() ?? "";
								const tokenBInput = params.tokenBId?.trim() ?? "";
								if (!tokenAInput || !tokenBInput) {
									throw new Error(
										"poolId is required when tokenAId/tokenBId are not both provided",
									);
								}
								const selection = await findRefPoolForPair({
									network,
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
								inferredPair = {
									tokenAId: selection.tokenAId,
									tokenBId: selection.tokenBId,
									liquidityScore: selection.liquidityScore,
								};
								return selection.pool;
							})();
				if (poolId == null) {
					throw new Error("Failed to resolve poolId for add liquidity");
				}
				const poolTokenIds = normalizeTokenIdList(pool.token_account_ids);
				const { amountsRaw, tokenAId, tokenBId } = resolveAddLiquidityAmounts({
					network,
					poolTokenIds,
					amountsRaw: params.amountsRaw,
					amountARaw: params.amountARaw,
					amountBRaw: params.amountBRaw,
					amountA: params.amountA,
					amountB: params.amountB,
					tokenAId: params.tokenAId ?? inferredPair?.tokenAId,
					tokenBId: params.tokenBId ?? inferredPair?.tokenBId,
				});
				const activeTokenRows = poolTokenIds
					.map((tokenId, index) => ({
						tokenId,
						amountRaw: amountsRaw[index] ?? "0",
					}))
					.filter(
						(entry) =>
							parseNonNegativeBigInt(entry.amountRaw, "amountRaw") > 0n,
					);
				if (activeTokenRows.length === 0) {
					throw new Error(
						"No positive token amount provided for add liquidity",
					);
				}

				const artifacts: UnsignedTransactionArtifact[] = [];
				let nextNonce = keyState.nextNonce;
				const exchangeStorageRegistration =
					autoRegisterExchange === true
						? await queryStorageRegistrationStatus({
								network,
								rpcUrl: params.rpcUrl,
								ftContractId: refContractId,
								accountId: signerAccountId,
								fallbackMinimumYoctoNear:
									DEFAULT_REF_ACCOUNT_STORAGE_DEPOSIT_YOCTO_NEAR,
							})
						: null;
				if (
					exchangeStorageRegistration &&
					exchangeStorageRegistration.status === "needs_registration"
				) {
					artifacts.push(
						createUnsignedTransactionArtifact({
							label: "exchange_storage_deposit",
							signerAccountId,
							signerPublicKey: keyState.signerPublicKey,
							receiverId: refContractId,
							nonce: nextNonce,
							blockHash: keyState.blockHash,
							actions: [
								actions.functionCall(
									"storage_deposit",
									{
										account_id: signerAccountId,
									},
									DEFAULT_STORAGE_DEPOSIT_GAS,
									parseNonNegativeBigInt(
										exchangeStorageRegistration.estimatedDepositYoctoNear,
										"exchangeStorage.estimatedDepositYoctoNear",
									),
								),
							],
							actionSummaries: [
								{
									type: "FunctionCall",
									methodName: "storage_deposit",
									args: {
										account_id: signerAccountId,
									},
									gas: DEFAULT_STORAGE_DEPOSIT_GAS.toString(),
									depositYoctoNear:
										exchangeStorageRegistration.estimatedDepositYoctoNear,
								},
							],
						}),
					);
					nextNonce += 1n;
				}

				const tokenStorageRegistrations: Array<{
					tokenId: string;
					registration: StorageRegistrationStatus;
				}> = [];
				if (autoRegisterTokens) {
					for (const row of activeTokenRows) {
						const registration = await queryStorageRegistrationStatus({
							network,
							rpcUrl: params.rpcUrl,
							ftContractId: row.tokenId,
							accountId: refContractId,
						});
						tokenStorageRegistrations.push({
							tokenId: row.tokenId,
							registration,
						});
						if (registration.status === "needs_registration") {
							artifacts.push(
								createUnsignedTransactionArtifact({
									label: "token_storage_deposit",
									signerAccountId,
									signerPublicKey: keyState.signerPublicKey,
									receiverId: row.tokenId,
									nonce: nextNonce,
									blockHash: keyState.blockHash,
									actions: [
										actions.functionCall(
											"storage_deposit",
											{
												account_id: refContractId,
												registration_only: true,
											},
											DEFAULT_STORAGE_DEPOSIT_GAS,
											parseNonNegativeBigInt(
												registration.estimatedDepositYoctoNear,
												`tokenStorage[${row.tokenId}].estimatedDepositYoctoNear`,
											),
										),
									],
									actionSummaries: [
										{
											type: "FunctionCall",
											methodName: "storage_deposit",
											args: {
												account_id: refContractId,
												registration_only: true,
											},
											gas: DEFAULT_STORAGE_DEPOSIT_GAS.toString(),
											depositYoctoNear: registration.estimatedDepositYoctoNear,
										},
									],
								}),
							);
							nextNonce += 1n;
						}
					}
					artifacts.push(
						createUnsignedTransactionArtifact({
							label: "register_tokens",
							signerAccountId,
							signerPublicKey: keyState.signerPublicKey,
							receiverId: refContractId,
							nonce: nextNonce,
							blockHash: keyState.blockHash,
							actions: [
								actions.functionCall(
									"register_tokens",
									{
										token_ids: activeTokenRows.map((row) => row.tokenId),
									},
									DEFAULT_REF_REGISTER_TOKENS_GAS,
									0n,
								),
							],
							actionSummaries: [
								{
									type: "FunctionCall",
									methodName: "register_tokens",
									args: {
										token_ids: activeTokenRows.map((row) => row.tokenId),
									},
									gas: DEFAULT_REF_REGISTER_TOKENS_GAS.toString(),
									depositYoctoNear: "0",
								},
							],
						}),
					);
					nextNonce += 1n;
				}

				for (const row of activeTokenRows) {
					artifacts.push(
						createUnsignedTransactionArtifact({
							label: "token_deposit",
							signerAccountId,
							signerPublicKey: keyState.signerPublicKey,
							receiverId: row.tokenId,
							nonce: nextNonce,
							blockHash: keyState.blockHash,
							actions: [
								actions.functionCall(
									"ft_transfer_call",
									{
										receiver_id: refContractId,
										amount: row.amountRaw,
										msg: "",
									},
									DEFAULT_REF_DEPOSIT_TOKEN_GAS,
									1n,
								),
							],
							actionSummaries: [
								{
									type: "FunctionCall",
									methodName: "ft_transfer_call",
									args: {
										receiver_id: refContractId,
										amount: row.amountRaw,
										msg: "",
									},
									gas: DEFAULT_REF_DEPOSIT_TOKEN_GAS.toString(),
									depositYoctoNear: "1",
								},
							],
						}),
					);
					nextNonce += 1n;
				}

				artifacts.push(
					createUnsignedTransactionArtifact({
						label: "ref_add_liquidity",
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						receiverId: refContractId,
						nonce: nextNonce,
						blockHash: keyState.blockHash,
						actions: [
							actions.functionCall(
								"add_liquidity",
								{
									pool_id: poolId,
									amounts: amountsRaw,
								},
								BigInt(addLiquidityGas),
								BigInt(addLiquidityDeposit),
							),
						],
						actionSummaries: [
							{
								type: "FunctionCall",
								methodName: "add_liquidity",
								args: {
									pool_id: poolId,
									amounts: amountsRaw,
								},
								gas: addLiquidityGas,
								depositYoctoNear: addLiquidityDeposit,
							},
						],
					}),
				);

				return {
					content: [
						{
							type: "text",
							text: `Unsigned Ref add_liquidity built: pool=${poolId} txCount=${artifacts.length}.`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						refContractId,
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						poolId,
						poolSelectionSource,
						poolCandidates,
						poolTokenIds,
						tokenAId,
						tokenBId,
						inferredPair,
						amountsRaw,
						autoRegisterExchange,
						autoRegisterTokens,
						exchangeStorageRegistration,
						tokenStorageRegistrations,
						addLiquidityGas,
						attachedDepositYoctoNear: addLiquidityDeposit,
						transactionCount: artifacts.length,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly in listed order.",
						transaction: artifacts[artifacts.length - 1] ?? null,
						transactions: artifacts,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildRemoveLiquidityRefTransaction`,
			label: "NEAR Build Ref Remove Liquidity Transaction",
			description:
				"Build unsigned Ref remove-liquidity transaction payload for local signing.",
			parameters: Type.Object({
				poolId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				shares: Type.Optional(Type.String()),
				shareBps: Type.Optional(Type.Number()),
				sharePercent: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				minAmountsRaw: Type.Optional(Type.Array(Type.String())),
				minAmountARaw: Type.Optional(Type.String()),
				minAmountBRaw: Type.Optional(Type.String()),
				tokenAId: Type.Optional(Type.String()),
				tokenBId: Type.Optional(Type.String()),
				refContractId: Type.Optional(Type.String()),
				autoWithdraw: Type.Optional(Type.Boolean()),
				autoRegisterReceiver: Type.Optional(Type.Boolean()),
				fromAccountId: Type.Optional(Type.String()),
				publicKey: Type.Optional(Type.String()),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				gas: Type.Optional(Type.String()),
				attachedDepositYoctoNear: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params =
					rawParams as NearBuildRefRemoveLiquidityTransactionParams;
				const autoWithdraw = params.autoWithdraw === true;
				const autoRegisterReceiver = params.autoRegisterReceiver !== false;
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const removeLiquidityGas = resolveRefSwapGas(params.gas);
				const removeLiquidityDeposit = resolveAttachedDeposit(
					params.attachedDepositYoctoNear,
				);
				const refContractId = getRefContractId(network, params.refContractId);
				let poolId = parseOptionalPoolId(params.poolId);
				let poolSelectionSource: "explicitPool" | "bestLiquidityPool" =
					"explicitPool";
				let poolCandidates: RefPoolPairCandidate[] = [];
				let inferredPair:
					| {
							tokenAId: string;
							tokenBId: string;
							liquidityScore: string;
					  }
					| undefined;
				const pool =
					poolId != null
						? await fetchRefPoolById({
								network,
								rpcUrl: params.rpcUrl,
								refContractId,
								poolId,
							})
						: await (async () => {
								const tokenAInput = params.tokenAId?.trim() ?? "";
								const tokenBInput = params.tokenBId?.trim() ?? "";
								if (!tokenAInput || !tokenBInput) {
									throw new Error(
										"poolId is required when tokenAId/tokenBId are not both provided",
									);
								}
								const selection = await findRefPoolForPair({
									network,
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
								inferredPair = {
									tokenAId: selection.tokenAId,
									tokenBId: selection.tokenBId,
									liquidityScore: selection.liquidityScore,
								};
								return selection.pool;
							})();
				if (poolId == null) {
					throw new Error("Failed to resolve poolId for remove liquidity");
				}
				const poolTokenIds = normalizeTokenIdList(pool.token_account_ids);
				const minAmountsRaw = resolveRemoveLiquidityMinAmounts({
					poolTokenIds,
					minAmountsRaw: params.minAmountsRaw,
					minAmountARaw: params.minAmountARaw,
					minAmountBRaw: params.minAmountBRaw,
				});
				const shareResolution =
					typeof params.shares === "string" && params.shares.trim()
						? {
								shares: parsePositiveBigInt(params.shares, "shares").toString(),
								availableShares: null as string | null,
								shareBpsUsed: null as number | null,
							}
						: await (async () => {
								const shareBps =
									params.shareBps != null
										? parseShareBps(params.shareBps, "shareBps")
										: params.sharePercent != null
											? parseSharePercent(params.sharePercent, "sharePercent")
											: (() => {
													throw new Error(
														"Provide shares, shareBps, or sharePercent",
													);
												})();
								const availableShares = await queryRefPoolShares({
									network,
									rpcUrl: params.rpcUrl,
									refContractId,
									poolId,
									accountId: signerAccountId,
								});
								const computed =
									(parseNonNegativeBigInt(availableShares, "availableShares") *
										BigInt(shareBps)) /
									10_000n;
								if (computed <= 0n) {
									throw new Error(
										`shareBps/sharePercent resolves to 0 shares (available=${availableShares})`,
									);
								}
								return {
									shares: computed.toString(),
									availableShares,
									shareBpsUsed: shareBps,
								};
							})();

				const artifact = createUnsignedTransactionArtifact({
					label: "ref_remove_liquidity",
					signerAccountId,
					signerPublicKey: keyState.signerPublicKey,
					receiverId: refContractId,
					nonce: keyState.nextNonce,
					blockHash: keyState.blockHash,
					actions: [
						actions.functionCall(
							"remove_liquidity",
							{
								pool_id: poolId,
								shares: shareResolution.shares,
								min_amounts: minAmountsRaw,
							},
							BigInt(removeLiquidityGas),
							BigInt(removeLiquidityDeposit),
						),
					],
					actionSummaries: [
						{
							type: "FunctionCall",
							methodName: "remove_liquidity",
							args: {
								pool_id: poolId,
								shares: shareResolution.shares,
								min_amounts: minAmountsRaw,
							},
							gas: removeLiquidityGas,
							depositYoctoNear: removeLiquidityDeposit,
						},
					],
				});
				const autoWithdrawFollowUps = autoWithdraw
					? poolTokenIds.map((tokenId, index) => ({
							step: index + 1,
							tokenId,
							tool: `${NEAR_TOOL_PREFIX}buildRefWithdrawTransaction`,
							description: `After remove_liquidity confirmation, withdraw all ${tokenId} deposits from Ref to wallet.`,
							params: {
								tokenId,
								withdrawAll: true,
								refContractId,
								autoRegisterReceiver,
								gas: params.gas?.trim() || undefined,
								attachedDepositYoctoNear:
									params.attachedDepositYoctoNear?.trim() || undefined,
								network,
								rpcUrl: params.rpcUrl,
								fromAccountId: signerAccountId,
								publicKey: params.publicKey ?? keyState.signerPublicKey,
							},
						}))
					: [];
				return {
					content: [
						{
							type: "text",
							text: `Unsigned Ref remove_liquidity built: pool=${poolId} shares=${shareResolution.shares}.${autoWithdraw ? " Auto-withdraw follow-up templates prepared." : ""}`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						refContractId,
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						poolId,
						poolSelectionSource,
						poolCandidates,
						poolTokenIds,
						tokenAId: inferredPair?.tokenAId ?? null,
						tokenBId: inferredPair?.tokenBId ?? null,
						minAmountsRaw,
						shares: shareResolution.shares,
						availableShares: shareResolution.availableShares,
						shareBpsUsed: shareResolution.shareBpsUsed,
						autoWithdraw,
						autoRegisterReceiver,
						autoWithdrawFollowUps,
						autoWithdrawNote: autoWithdraw
							? "Follow-up withdraw transactions require the remove_liquidity tx to be confirmed first. Use provided templates to compose and sign those withdrawals."
							: null,
						gas: removeLiquidityGas,
						attachedDepositYoctoNear: removeLiquidityDeposit,
						transactionCount: 1,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly.",
						transaction: artifact,
						transactions: [artifact],
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildSwapRefTransaction`,
			label: "NEAR Build Ref Swap Transaction",
			description:
				"Build unsigned Ref swap transaction payload(s) for local signing. Can include a storage_deposit pre-transaction when output token storage is missing.",
			parameters: Type.Object({
				tokenInId: Type.String({
					description: "Input token contract id or symbol (e.g. NEAR/USDC).",
				}),
				tokenOutId: Type.String({
					description: "Output token contract id or symbol.",
				}),
				amountInRaw: Type.String({
					description: "Input amount in raw integer string.",
				}),
				minAmountOutRaw: Type.Optional(
					Type.String({
						description:
							"Minimum output in raw integer string. If omitted, use quote-safe minimum.",
					}),
				),
				poolId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				slippageBps: Type.Optional(
					Type.Number({
						description:
							"Slippage bps used by quote when minAmountOutRaw is omitted (default 50).",
					}),
				),
				refContractId: Type.Optional(
					Type.String({
						description:
							"Ref contract id override (default mainnet v2.ref-finance.near).",
					}),
				),
				autoRegisterOutput: Type.Optional(
					Type.Boolean({
						description:
							"If true, include storage_deposit pre-transaction when output token storage is missing (default true).",
					}),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				publicKey: Type.Optional(
					Type.String({
						description:
							"Public key used for nonce/access-key lookup, e.g. ed25519:.... If omitted, auto-select from account access keys.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas in yoctoGas for ft_transfer_call swap (default 180000000000000 / 180 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit in yoctoNEAR for ft_transfer_call (default 1).",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearBuildRefSwapTransactionParams;
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const tokenInInput = normalizeNonEmptyText(
					params.tokenInId,
					"tokenInId",
				);
				const tokenOutInput = normalizeNonEmptyText(
					params.tokenOutId,
					"tokenOutId",
				);
				const amountInRaw = parsePositiveBigInt(
					params.amountInRaw,
					"amountInRaw",
				).toString();
				const slippageBps = resolveNearSwapSlippageBps(params.slippageBps);
				const gas = resolveRefSwapGas(params.gas);
				const deposit = resolveAttachedDeposit(params.attachedDepositYoctoNear);
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const refContractId = getRefContractId(network, params.refContractId);
				const poolId = parseOptionalPoolId(params.poolId);
				const quote = await getRefSwapQuote({
					network,
					rpcUrl: params.rpcUrl,
					refContractId,
					tokenInId: tokenInInput,
					tokenOutId: tokenOutInput,
					amountInRaw,
					poolId,
					slippageBps,
				});
				const quoteActions =
					Array.isArray(quote.actions) && quote.actions.length > 0
						? quote.actions
						: [
								{
									poolId: quote.poolId,
									tokenInId: quote.tokenInId,
									tokenOutId: quote.tokenOutId,
									amountInRaw: quote.amountInRaw,
								},
							];
				const firstAction = quoteActions[0];
				const lastAction = quoteActions[quoteActions.length - 1];
				if (!firstAction || !lastAction) {
					throw new Error("Ref quote returned an empty action list");
				}
				const tokenInId = normalizeAccountId(
					firstAction.tokenInId,
					"tokenInId",
				);
				const tokenOutId = normalizeAccountId(
					lastAction.tokenOutId,
					"tokenOutId",
				);
				if (tokenInId === tokenOutId) {
					throw new Error("tokenInId and tokenOutId must be different");
				}
				const minAmountOutRaw = resolveSafeMinAmountOutRaw({
					requestedMinAmountOutRaw: params.minAmountOutRaw,
					quoteAmountOutRaw: quote.amountOutRaw,
					quoteMinAmountOutRaw: quote.minAmountOutRaw,
				});
				const autoRegisterOutput = params.autoRegisterOutput !== false;
				const storageRegistration =
					autoRegisterOutput === true
						? await queryStorageRegistrationStatus({
								network,
								rpcUrl: params.rpcUrl,
								ftContractId: tokenOutId,
								accountId: signerAccountId,
							})
						: null;
				const artifacts: UnsignedTransactionArtifact[] = [];
				let nextNonce = keyState.nextNonce;

				if (
					autoRegisterOutput &&
					storageRegistration &&
					storageRegistration.status === "needs_registration"
				) {
					const storageDepositActionSummary: ActionSummary = {
						type: "FunctionCall",
						methodName: "storage_deposit",
						args: {
							account_id: signerAccountId,
							registration_only: true,
						},
						gas: DEFAULT_STORAGE_DEPOSIT_GAS.toString(),
						depositYoctoNear: storageRegistration.estimatedDepositYoctoNear,
					};
					artifacts.push(
						createUnsignedTransactionArtifact({
							label: "storage_deposit",
							signerAccountId,
							signerPublicKey: keyState.signerPublicKey,
							receiverId: tokenOutId,
							nonce: nextNonce,
							blockHash: keyState.blockHash,
							actions: [
								actions.functionCall(
									"storage_deposit",
									{
										account_id: signerAccountId,
										registration_only: true,
									},
									DEFAULT_STORAGE_DEPOSIT_GAS,
									parseNonNegativeBigInt(
										storageRegistration.estimatedDepositYoctoNear,
										"estimatedDepositYoctoNear",
									),
								),
							],
							actionSummaries: [storageDepositActionSummary],
						}),
					);
					nextNonce += 1n;
				}

				const swapActionsPayload = quoteActions.map((action, index) => {
					const routeTokenInId = normalizeAccountId(
						action.tokenInId,
						"tokenInId",
					);
					const routeTokenOutId = normalizeAccountId(
						action.tokenOutId,
						"tokenOutId",
					);
					const routeAmountInRaw =
						typeof action.amountInRaw === "string" && action.amountInRaw.trim()
							? parsePositiveBigInt(
									action.amountInRaw,
									"route.amountInRaw",
								).toString()
							: amountInRaw;
					return {
						pool_id: action.poolId,
						token_in: routeTokenInId,
						...(index === 0 ? { amount_in: routeAmountInRaw } : {}),
						token_out: routeTokenOutId,
						min_amount_out:
							index === quoteActions.length - 1 ? minAmountOutRaw : "0",
					};
				});
				const swapActionSummary: ActionSummary = {
					type: "FunctionCall",
					methodName: "ft_transfer_call",
					args: {
						receiver_id: refContractId,
						amount: amountInRaw,
						msg: JSON.stringify({
							force: 0,
							actions: swapActionsPayload,
						}),
					},
					gas,
					depositYoctoNear: deposit,
				};
				artifacts.push(
					createUnsignedTransactionArtifact({
						label: "ref_swap",
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						receiverId: tokenInId,
						nonce: nextNonce,
						blockHash: keyState.blockHash,
						actions: [
							actions.functionCall(
								"ft_transfer_call",
								{
									receiver_id: refContractId,
									amount: amountInRaw,
									msg: JSON.stringify({
										force: 0,
										actions: swapActionsPayload,
									}),
								},
								BigInt(gas),
								BigInt(deposit),
							),
						],
						actionSummaries: [swapActionSummary],
					}),
				);

				return {
					content: [
						{
							type: "text",
							text: `Unsigned Ref swap built: ${amountInRaw} raw ${tokenInId} -> ${tokenOutId} (${quoteActions.length} hop(s), txCount=${artifacts.length}).`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						refContractId,
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						tokenInId,
						tokenOutId,
						amountInRaw,
						minAmountOutRaw,
						poolId: quote.poolId,
						slippageBps,
						source: quote.source,
						routeActions: quoteActions,
						autoRegisterOutput,
						storageRegistration,
						transactionCount: artifacts.length,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly in listed order.",
						transaction: artifacts[artifacts.length - 1] ?? null,
						transactions: artifacts,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}buildRefWithdrawTransaction`,
			label: "NEAR Build Ref Withdraw Transaction",
			description:
				"Build unsigned Ref withdraw transaction payload(s) for local signing. Can include an optional storage_deposit pre-transaction when receiver storage is missing.",
			parameters: Type.Object({
				tokenId: Type.String({
					description: "Token contract id or symbol to withdraw from Ref.",
				}),
				amountRaw: Type.Optional(
					Type.String({
						description:
							"Withdraw amount in raw units. If omitted and withdrawAll=true, use full deposited balance.",
					}),
				),
				withdrawAll: Type.Optional(
					Type.Boolean({
						description:
							"If true and amountRaw is omitted, withdraw full deposited balance (default true).",
					}),
				),
				refContractId: Type.Optional(
					Type.String({
						description:
							"Ref contract id override (default mainnet v2.ref-finance.near).",
					}),
				),
				autoRegisterReceiver: Type.Optional(
					Type.Boolean({
						description:
							"If true, include a storage_deposit pre-transaction when receiver storage is missing (default true).",
					}),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				publicKey: Type.Optional(
					Type.String({
						description:
							"Public key used for nonce/access-key lookup, e.g. ed25519:.... If omitted, auto-select from account access keys.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas in yoctoGas for withdraw (default 180000000000000 / 180 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit in yoctoNEAR for withdraw (default 1).",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const signerAccountId = resolveNearAccountId(
					params.fromAccountId,
					network,
				);
				const refContractId = getRefContractId(network, params.refContractId);
				const keyState = await resolveComposeAccessKeyState({
					accountId: signerAccountId,
					publicKey: params.publicKey,
					network,
					rpcUrl: params.rpcUrl,
				});
				const deposits = await queryRefUserDeposits({
					network,
					rpcUrl: params.rpcUrl,
					refContractId,
					accountId: signerAccountId,
				});
				const tokenId = resolveRefWithdrawTokenId({
					network,
					tokenInput: params.tokenId,
					availableTokenIds: Object.keys(deposits),
				});
				const depositBeforeRaw = parseNonNegativeBigInt(
					deposits[tokenId] ?? "0",
					`deposits[${tokenId}]`,
				).toString();
				const requestedAmountRaw =
					typeof params.amountRaw === "string" && params.amountRaw.trim()
						? parsePositiveBigInt(params.amountRaw, "amountRaw").toString()
						: null;
				const withdrawAll = params.withdrawAll !== false;
				const amountRaw =
					requestedAmountRaw ??
					(withdrawAll
						? depositBeforeRaw
						: (() => {
								throw new Error("Provide amountRaw or set withdrawAll=true");
							})());
				if (parseNonNegativeBigInt(amountRaw, "amountRaw") <= 0n) {
					throw new Error(
						`No withdrawable deposit for ${tokenId} on ${refContractId}`,
					);
				}
				if (
					parseNonNegativeBigInt(amountRaw, "amountRaw") >
					parseNonNegativeBigInt(depositBeforeRaw, "depositBeforeRaw")
				) {
					throw new Error(
						`Withdraw amount exceeds Ref deposit for ${tokenId}: ${amountRaw} > ${depositBeforeRaw}`,
					);
				}

				const autoRegisterReceiver = params.autoRegisterReceiver !== false;
				const storageRegistration = await queryStorageRegistrationStatus({
					network,
					rpcUrl: params.rpcUrl,
					ftContractId: tokenId,
					accountId: signerAccountId,
				});
				const artifacts: UnsignedTransactionArtifact[] = [];
				let nextNonce = keyState.nextNonce;

				if (
					autoRegisterReceiver &&
					storageRegistration.status === "needs_registration"
				) {
					const storageDepositActionSummary: ActionSummary = {
						type: "FunctionCall",
						methodName: "storage_deposit",
						args: {
							account_id: signerAccountId,
							registration_only: true,
						},
						gas: DEFAULT_STORAGE_DEPOSIT_GAS.toString(),
						depositYoctoNear: storageRegistration.estimatedDepositYoctoNear,
					};
					artifacts.push(
						createUnsignedTransactionArtifact({
							label: "storage_deposit",
							signerAccountId,
							signerPublicKey: keyState.signerPublicKey,
							receiverId: tokenId,
							nonce: nextNonce,
							blockHash: keyState.blockHash,
							actions: [
								actions.functionCall(
									"storage_deposit",
									{
										account_id: signerAccountId,
										registration_only: true,
									},
									DEFAULT_STORAGE_DEPOSIT_GAS,
									parseNonNegativeBigInt(
										storageRegistration.estimatedDepositYoctoNear,
										"estimatedDepositYoctoNear",
									),
								),
							],
							actionSummaries: [storageDepositActionSummary],
						}),
					);
					nextNonce += 1n;
				}

				const withdrawGas = resolveRefWithdrawGas(params.gas);
				const withdrawDeposit = resolveAttachedDeposit(
					params.attachedDepositYoctoNear,
				);
				artifacts.push(
					createUnsignedTransactionArtifact({
						label: "ref_withdraw",
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						receiverId: refContractId,
						nonce: nextNonce,
						blockHash: keyState.blockHash,
						actions: [
							actions.functionCall(
								"withdraw",
								{
									token_id: tokenId,
									amount: amountRaw,
								},
								BigInt(withdrawGas),
								BigInt(withdrawDeposit),
							),
						],
						actionSummaries: [
							{
								type: "FunctionCall",
								methodName: "withdraw",
								args: {
									token_id: tokenId,
									amount: amountRaw,
								},
								gas: withdrawGas,
								depositYoctoNear: withdrawDeposit,
							},
						],
					}),
				);

				return {
					content: [
						{
							type: "text",
							text: `Unsigned Ref withdraw built: ${amountRaw} raw ${tokenId} (txCount=${artifacts.length}).`,
						},
					],
					details: {
						network,
						rpcEndpoint: getNearRpcEndpoint(network, params.rpcUrl),
						refContractId,
						signerAccountId,
						signerPublicKey: keyState.signerPublicKey,
						accessKeySource: keyState.source,
						accessKeyPermission: keyState.permission,
						blockHeight: keyState.blockHeight,
						tokenId,
						depositBeforeRaw,
						amountRaw,
						withdrawAll,
						autoRegisterReceiver,
						storageRegistration,
						transactionCount: artifacts.length,
						requiresLocalSignature: true,
						expirationNote:
							"Unsigned payload includes nonce+blockHash and expires quickly. Sign and broadcast promptly in listed order.",
						transaction: artifacts[artifacts.length - 1] ?? null,
						transactions: artifacts,
					},
				};
			},
		}),
	];
}
