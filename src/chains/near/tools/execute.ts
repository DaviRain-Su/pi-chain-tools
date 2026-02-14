import { Type } from "@sinclair/typebox";
import { Account, JsonRpcProvider } from "near-api-js";
import type { RegisteredTool } from "../../../core/types.js";
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
	NEAR_TOOL_PREFIX,
	callNearRpc,
	formatNearAmount,
	getNearExplorerTransactionUrl,
	getNearRpcEndpoint,
	nearNetworkSchema,
	parseNearNetwork,
	resolveNearSigner,
	toYoctoNear,
} from "../runtime.js";

type NearTransferParams = {
	toAccountId: string;
	amountYoctoNear?: string;
	amountNear?: string | number;
	fromAccountId?: string;
	privateKey?: string;
	network?: string;
	rpcUrl?: string;
	confirmMainnet?: boolean;
};

type NearFtTransferParams = {
	ftContractId: string;
	toAccountId: string;
	amountRaw: string;
	fromAccountId?: string;
	privateKey?: string;
	network?: string;
	rpcUrl?: string;
	confirmMainnet?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearRefSwapParams = {
	tokenInId: string;
	tokenOutId: string;
	amountInRaw: string;
	minAmountOutRaw?: string;
	poolId?: number | string;
	slippageBps?: number;
	refContractId?: string;
	autoRegisterOutput?: boolean;
	fromAccountId?: string;
	privateKey?: string;
	network?: string;
	rpcUrl?: string;
	confirmMainnet?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearRefAddLiquidityParams = {
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
	privateKey?: string;
	network?: string;
	rpcUrl?: string;
	confirmMainnet?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearRefRemoveLiquidityParams = {
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
	privateKey?: string;
	network?: string;
	rpcUrl?: string;
	confirmMainnet?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearRefWithdrawParams = {
	tokenId: string;
	amountRaw?: string;
	withdrawAll?: boolean;
	refContractId?: string;
	autoRegisterReceiver?: boolean;
	fromAccountId?: string;
	privateKey?: string;
	network?: string;
	rpcUrl?: string;
	confirmMainnet?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearSubmitIntentsDepositParams = {
	txHash: string;
	depositAddress: string;
	depositMemo?: string;
	nearSenderAccount?: string;
	network?: string;
	confirmMainnet?: boolean;
	apiBaseUrl?: string;
	apiKey?: string;
	jwt?: string;
};

type NearCallFunctionResult = {
	result: number[];
	logs: string[];
	block_height: number;
	block_hash: string;
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

type StorageRegistrationResult =
	| {
			status: "already_registered";
	  }
	| {
			status: "registered_now";
			depositYoctoNear: string;
			txHash: string | null;
	  }
	| {
			status: "unknown";
			reason: string;
	  };

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

function parsePositiveYocto(value: string, fieldName: string): bigint {
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

function parseNonNegativeYocto(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	return BigInt(normalized);
}

function normalizeNonEmptyText(value: string, fieldName: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
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

function resolveNearTransferAmount(params: NearTransferParams): bigint {
	if (
		typeof params.amountYoctoNear === "string" &&
		params.amountYoctoNear.trim()
	) {
		return parsePositiveYocto(params.amountYoctoNear, "amountYoctoNear");
	}
	if (params.amountNear != null) {
		return toYoctoNear(params.amountNear);
	}
	throw new Error("Provide amountYoctoNear or amountNear");
}

function resolveRequestGas(value?: string): bigint {
	if (typeof value !== "string" || !value.trim()) {
		return 30_000_000_000_000n;
	}
	return parsePositiveYocto(value, "gas");
}

function resolveAttachedDeposit(value?: string): bigint {
	if (typeof value !== "string" || !value.trim()) {
		return 1n;
	}
	return parseNonNegativeYocto(value, "attachedDepositYoctoNear");
}

function resolveRefSwapGas(value?: string): bigint {
	if (typeof value !== "string" || !value.trim()) {
		return 180_000_000_000_000n;
	}
	return parsePositiveYocto(value, "gas");
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
	const quoteAmountOutRaw = parsePositiveYocto(
		params.quoteAmountOutRaw,
		"quote.amountOutRaw",
	);
	const quoteMinAmountOutRaw = parsePositiveYocto(
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
		const requested = parsePositiveYocto(
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

function parseShareBps(
	value: number | undefined,
	fieldName: string,
): number | undefined {
	if (value == null) return undefined;
	if (!Number.isFinite(value) || value <= 0 || value > 10_000) {
		throw new Error(`${fieldName} must be between 1 and 10000`);
	}
	return Math.floor(value);
}

function parseSharePercent(
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
	return parseNonNegativeYocto(parsed, "poolShares").toString();
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
		const normalizedToken = tokenId.trim().toLowerCase();
		if (!normalizedToken) continue;
		deposits[normalizedToken] = parseNonNegativeYocto(
			rawAmount,
			`deposits[${normalizedToken}]`,
		).toString();
	}
	return deposits;
}

function extractErrorText(error: unknown): string {
	if (error instanceof Error && typeof error.message === "string") {
		return error.message;
	}
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

async function queryContractStorageBalance(params: {
	network: string;
	rpcUrl?: string;
	contractId: string;
	accountId: string;
}): Promise<NearStorageBalance | null | "unsupported"> {
	try {
		const result = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "call_function",
				account_id: params.contractId,
				method_name: "storage_balance_of",
				args_base64: encodeNearCallArgs({
					account_id: params.accountId,
				}),
				finality: "final",
			},
		});
		const parsed = decodeNearCallResultJson<NearStorageBalance | null>(result);
		if (!parsed) return null;
		if (
			typeof parsed === "object" &&
			typeof parsed.total === "string" &&
			parsed.total.trim()
		) {
			parseNonNegativeYocto(parsed.total, "storageBalance.total");
			return parsed;
		}
		return null;
	} catch (error) {
		if (isMissingMethodError(error)) return "unsupported";
		throw error;
	}
}

async function queryContractStorageMinimumDeposit(params: {
	network: string;
	rpcUrl?: string;
	contractId: string;
}): Promise<bigint | null> {
	try {
		const result = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "call_function",
				account_id: params.contractId,
				method_name: "storage_balance_bounds",
				args_base64: encodeNearCallArgs({}),
				finality: "final",
			},
		});
		const parsed = decodeNearCallResultJson<NearStorageBalanceBounds>(result);
		if (
			parsed &&
			typeof parsed === "object" &&
			typeof parsed.min === "string" &&
			parsed.min.trim()
		) {
			return parseNonNegativeYocto(parsed.min, "storageBalanceBounds.min");
		}
		return null;
	} catch (error) {
		if (isMissingMethodError(error)) return null;
		return null;
	}
}

async function ensureFtStorageRegistered(params: {
	account: Account;
	network: string;
	rpcUrl?: string;
	ftContractId: string;
	accountId: string;
}): Promise<StorageRegistrationResult> {
	const balance = await queryContractStorageBalance({
		network: params.network,
		rpcUrl: params.rpcUrl,
		contractId: params.ftContractId,
		accountId: params.accountId,
	});
	if (balance === "unsupported") {
		return {
			status: "unknown",
			reason: "token does not expose storage_balance_of",
		};
	}
	if (
		balance &&
		parseNonNegativeYocto(balance.total, "storageBalance.total") > 0n
	) {
		return { status: "already_registered" };
	}

	const minDeposit =
		(await queryContractStorageMinimumDeposit({
			network: params.network,
			rpcUrl: params.rpcUrl,
			contractId: params.ftContractId,
		})) ?? DEFAULT_FT_STORAGE_DEPOSIT_YOCTO_NEAR;

	try {
		const registrationTx = await params.account.callFunction({
			contractId: params.ftContractId,
			methodName: "storage_deposit",
			args: {
				account_id: params.accountId,
				registration_only: true,
			},
			deposit: minDeposit,
			gas: DEFAULT_STORAGE_DEPOSIT_GAS,
		});
		return {
			status: "registered_now",
			depositYoctoNear: minDeposit.toString(),
			txHash: extractTxHash(registrationTx),
		};
	} catch (error) {
		const message = extractErrorText(error).toLowerCase();
		if (message.includes("already registered")) {
			return { status: "already_registered" };
		}
		throw new Error(
			`Failed to auto-register storage on ${params.ftContractId}: ${extractErrorText(error)}`,
		);
	}
}

function isAlreadyRegisteredError(error: unknown): boolean {
	const message = extractErrorText(error).toLowerCase();
	return (
		message.includes("already registered") ||
		message.includes("already whitelisted") ||
		message.includes("already added")
	);
}

async function ensureRefAccountStorageRegistered(params: {
	account: Account;
	network: string;
	rpcUrl?: string;
	refContractId: string;
	accountId: string;
}): Promise<StorageRegistrationResult> {
	const balance = await queryContractStorageBalance({
		network: params.network,
		rpcUrl: params.rpcUrl,
		contractId: params.refContractId,
		accountId: params.accountId,
	});
	if (balance === "unsupported") {
		return {
			status: "unknown",
			reason: "ref contract does not expose storage_balance_of",
		};
	}
	if (
		balance &&
		parseNonNegativeYocto(balance.total, "storageBalance.total") > 0n
	) {
		return { status: "already_registered" };
	}

	const minDeposit =
		(await queryContractStorageMinimumDeposit({
			network: params.network,
			rpcUrl: params.rpcUrl,
			contractId: params.refContractId,
		})) ?? DEFAULT_REF_ACCOUNT_STORAGE_DEPOSIT_YOCTO_NEAR;
	try {
		const registrationTx = await params.account.callFunction({
			contractId: params.refContractId,
			methodName: "storage_deposit",
			args: {
				account_id: params.accountId,
			},
			deposit: minDeposit,
			gas: DEFAULT_STORAGE_DEPOSIT_GAS,
		});
		return {
			status: "registered_now",
			depositYoctoNear: minDeposit.toString(),
			txHash: extractTxHash(registrationTx),
		};
	} catch (error) {
		if (isAlreadyRegisteredError(error)) {
			return { status: "already_registered" };
		}
		throw new Error(
			`Failed to auto-register exchange storage on ${params.refContractId}: ${extractErrorText(error)}`,
		);
	}
}

async function registerTokensOnRefExchange(params: {
	account: Account;
	refContractId: string;
	tokenIds: string[];
}): Promise<"registered_now" | "already_registered"> {
	if (params.tokenIds.length === 0) {
		return "already_registered";
	}
	try {
		await params.account.callFunction({
			contractId: params.refContractId,
			methodName: "register_tokens",
			args: {
				token_ids: params.tokenIds,
			},
			deposit: 0n,
			gas: DEFAULT_REF_REGISTER_TOKENS_GAS,
		});
		return "registered_now";
	} catch (error) {
		if (isAlreadyRegisteredError(error)) {
			return "already_registered";
		}
		throw new Error(
			`Failed to register tokens on ${params.refContractId}: ${extractErrorText(error)}`,
		);
	}
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
		return parsePositiveYocto(params.rawValue, params.fieldRaw).toString();
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
	parsePositiveYocto(rawAmount, params.fieldUi);
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
			parseNonNegativeYocto(value, `amountsRaw[${index}]`).toString(),
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
			parseNonNegativeYocto(value, `minAmountsRaw[${index}]`).toString(),
		);
	}
	const result = poolTokenIds.map(() => "0");
	if (typeof params.minAmountARaw === "string" && params.minAmountARaw.trim()) {
		result[0] = parseNonNegativeYocto(
			params.minAmountARaw,
			"minAmountARaw",
		).toString();
	}
	if (typeof params.minAmountBRaw === "string" && params.minAmountBRaw.trim()) {
		result[1] = parseNonNegativeYocto(
			params.minAmountBRaw,
			"minAmountBRaw",
		).toString();
	}
	return result;
}

async function resolveRemoveLiquidityShares(params: {
	network: string;
	rpcUrl?: string;
	refContractId: string;
	poolId: number;
	accountId: string;
	shares?: string;
	shareBps?: number;
	sharePercent?: string | number;
}): Promise<{
	shares: string;
	availableShares: string | null;
	shareBpsUsed: number | null;
}> {
	if (typeof params.shares === "string" && params.shares.trim()) {
		return {
			shares: parsePositiveYocto(params.shares, "shares").toString(),
			availableShares: null,
			shareBpsUsed: null,
		};
	}

	const shareBps =
		parseShareBps(params.shareBps, "shareBps") ??
		parseSharePercent(params.sharePercent, "sharePercent");
	if (shareBps == null) {
		throw new Error("Provide shares, shareBps, or sharePercent");
	}
	const availableShares = await queryRefPoolShares({
		network: params.network,
		rpcUrl: params.rpcUrl,
		refContractId: params.refContractId,
		poolId: params.poolId,
		accountId: params.accountId,
	});
	const available = parseNonNegativeYocto(availableShares, "poolShares");
	const computed = (available * BigInt(shareBps)) / 10_000n;
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
}

function resolveWithdrawTokenId(params: {
	network: string;
	tokenInput: string;
	availableTokenIds: string[];
}): string {
	const tokenInput = params.tokenInput.trim();
	if (!tokenInput) {
		throw new Error("tokenId is required");
	}
	const availableTokenIds = params.availableTokenIds.map((tokenId) =>
		tokenId.toLowerCase(),
	);
	const matches = resolveRefTokenIds({
		network: params.network,
		tokenIdOrSymbol: tokenInput,
		availableTokenIds,
	});
	if (matches[0]) return matches[0];
	if (tokenInput.includes(".")) return tokenInput.toLowerCase();
	const fallback = resolveRefTokenIds({
		network: params.network,
		tokenIdOrSymbol: tokenInput,
	});
	if (fallback[0]) return fallback[0];
	throw new Error(`Cannot resolve tokenId: ${tokenInput}`);
}

async function executeRefWithdraw(params: {
	account: Account;
	network: string;
	rpcUrl?: string;
	refContractId: string;
	signerAccountId: string;
	tokenInput: string;
	amountRaw?: string;
	withdrawAll?: boolean;
	autoRegisterReceiver?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
}): Promise<{
	tokenId: string;
	amountRaw: string;
	depositBeforeRaw: string;
	storageRegistration: StorageRegistrationResult | null;
	txHash: string | null;
	explorerUrl: string | null;
}> {
	const deposits = await queryRefUserDeposits({
		network: params.network,
		rpcUrl: params.rpcUrl,
		refContractId: params.refContractId,
		accountId: params.signerAccountId,
	});
	const tokenId = resolveWithdrawTokenId({
		network: params.network,
		tokenInput: params.tokenInput,
		availableTokenIds: Object.keys(deposits),
	});
	const depositBeforeRaw = parseNonNegativeYocto(
		deposits[tokenId] ?? "0",
		`deposits[${tokenId}]`,
	).toString();
	const requestedAmountRaw =
		typeof params.amountRaw === "string" && params.amountRaw.trim()
			? parsePositiveYocto(params.amountRaw, "amountRaw").toString()
			: null;
	const withdrawAll = params.withdrawAll !== false;
	const amountRaw =
		requestedAmountRaw ??
		(withdrawAll
			? depositBeforeRaw
			: (() => {
					throw new Error("Provide amountRaw or set withdrawAll=true");
				})());
	if (parseNonNegativeYocto(amountRaw, "amountRaw") <= 0n) {
		throw new Error(
			`No withdrawable deposit for ${tokenId} on ${params.refContractId}`,
		);
	}
	if (
		parseNonNegativeYocto(amountRaw, "amountRaw") >
		parseNonNegativeYocto(depositBeforeRaw, "depositBeforeRaw")
	) {
		throw new Error(
			`Withdraw amount exceeds Ref deposit for ${tokenId}: ${amountRaw} > ${depositBeforeRaw}`,
		);
	}

	const autoRegisterReceiver = params.autoRegisterReceiver !== false;
	const storageRegistration =
		autoRegisterReceiver === true
			? await ensureFtStorageRegistered({
					account: params.account,
					network: params.network,
					rpcUrl: params.rpcUrl,
					ftContractId: tokenId,
					accountId: params.signerAccountId,
				})
			: null;
	const withdrawGas = resolveRefSwapGas(params.gas);
	const withdrawDeposit = resolveAttachedDeposit(
		params.attachedDepositYoctoNear,
	);
	const withdrawTx = await params.account.callFunction({
		contractId: params.refContractId,
		methodName: "withdraw",
		args: {
			token_id: tokenId,
			amount: amountRaw,
		},
		deposit: withdrawDeposit,
		gas: withdrawGas,
	});
	const txHash = extractTxHash(withdrawTx);
	return {
		tokenId,
		amountRaw,
		depositBeforeRaw,
		storageRegistration,
		txHash,
		explorerUrl: txHash
			? getNearExplorerTransactionUrl(txHash, params.network)
			: null,
	};
}

function normalizeReceiverAccountId(value: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error("toAccountId is required");
	}
	return normalized.startsWith("@") ? normalized.slice(1) : normalized;
}

function extractTxHash(details: unknown): string | null {
	if (!details || typeof details !== "object") return null;
	const candidate = details as {
		transaction_outcome?: { id?: unknown };
		final_execution_status?: unknown;
	};
	const txId = candidate.transaction_outcome?.id;
	return typeof txId === "string" && txId.trim() ? txId : null;
}

function assertMainnetExecutionConfirmed(
	network: string,
	confirmMainnet?: boolean,
): void {
	if (network === "mainnet" && confirmMainnet !== true) {
		throw new Error(
			"Mainnet execution is blocked. Set confirmMainnet=true to continue.",
		);
	}
}

function createNearAccountClient(params: {
	accountId?: string;
	privateKey?: string;
	network?: string;
	rpcUrl?: string;
}) {
	const network = parseNearNetwork(params.network);
	const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
	const provider = new JsonRpcProvider({ url: endpoint });
	const resolvedSigner = resolveNearSigner({
		accountId: params.accountId,
		network,
		privateKey: params.privateKey,
	});
	const account = new Account(
		resolvedSigner.accountId,
		provider,
		resolvedSigner.signer,
	);
	return {
		account,
		network,
		endpoint,
		signerAccountId: resolvedSigner.accountId,
	};
}

export function createNearExecuteTools(): RegisteredTool[] {
	return [
		defineTool({
			name: `${NEAR_TOOL_PREFIX}transferNear`,
			label: "NEAR Transfer Native",
			description:
				"Transfer native NEAR from signer account to another account id.",
			parameters: Type.Object({
				toAccountId: Type.String({
					description: "Destination NEAR account id",
				}),
				amountYoctoNear: Type.Optional(
					Type.String({
						description: "Amount in yoctoNEAR (raw integer string)",
					}),
				),
				amountNear: Type.Optional(
					Type.Union([
						Type.String({ description: "Amount in NEAR decimal string" }),
						Type.Number({ description: "Amount in NEAR" }),
					]),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				privateKey: Type.Optional(
					Type.String({
						description:
							"Optional signer private key ed25519:... (otherwise from env/credentials).",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({
						description: "Override NEAR RPC endpoint URL",
					}),
				),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const amountYoctoNear = resolveNearTransferAmount(params);
				const receiverId = normalizeReceiverAccountId(params.toAccountId);
				const { account, network, endpoint, signerAccountId } =
					createNearAccountClient({
						accountId: params.fromAccountId,
						privateKey: params.privateKey,
						network: params.network,
						rpcUrl: params.rpcUrl,
					});

				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const tx = await account.transfer({
					receiverId,
					amount: amountYoctoNear,
				});
				const txHash = extractTxHash(tx);
				const explorerUrl = txHash
					? getNearExplorerTransactionUrl(txHash, network)
					: null;

				return {
					content: [
						{
							type: "text",
							text: `Transfer submitted: ${formatNearAmount(amountYoctoNear, 8)} NEAR -> ${receiverId}`,
						},
					],
					details: {
						amountNear: formatNearAmount(amountYoctoNear, 10),
						amountYoctoNear: amountYoctoNear.toString(),
						explorerUrl,
						fromAccountId: signerAccountId,
						network,
						rawResult: tx,
						rpcEndpoint: endpoint,
						toAccountId: receiverId,
						txHash,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}transferFt`,
			label: "NEAR Transfer FT",
			description:
				"Transfer NEP-141 fungible tokens via ft_transfer from signer account.",
			parameters: Type.Object({
				ftContractId: Type.String({
					description: "FT contract account id",
				}),
				toAccountId: Type.String({
					description: "Destination NEAR account id",
				}),
				amountRaw: Type.String({
					description: "FT amount as raw integer string",
				}),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				privateKey: Type.Optional(
					Type.String({
						description:
							"Optional signer private key ed25519:... (otherwise from env/credentials).",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({
						description: "Override NEAR RPC endpoint URL",
					}),
				),
				confirmMainnet: Type.Optional(Type.Boolean()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas to attach in yoctoGas (default 30000000000000 / 30 Tgas)",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit in yoctoNEAR (default 1 for ft_transfer)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const amountRaw = parsePositiveYocto(params.amountRaw, "amountRaw");
				const receiverId = normalizeReceiverAccountId(params.toAccountId);
				const ftContractId = normalizeReceiverAccountId(params.ftContractId);
				const gas = resolveRequestGas(params.gas);
				const deposit = resolveAttachedDeposit(params.attachedDepositYoctoNear);
				const { account, network, endpoint, signerAccountId } =
					createNearAccountClient({
						accountId: params.fromAccountId,
						privateKey: params.privateKey,
						network: params.network,
						rpcUrl: params.rpcUrl,
					});

				assertMainnetExecutionConfirmed(network, params.confirmMainnet);

				const tx = await account.callFunction({
					contractId: ftContractId,
					methodName: "ft_transfer",
					args: {
						receiver_id: receiverId,
						amount: amountRaw.toString(),
					},
					deposit,
					gas,
				});

				const txHash = extractTxHash(tx);
				const explorerUrl = txHash
					? getNearExplorerTransactionUrl(txHash, network)
					: null;

				return {
					content: [
						{
							type: "text",
							text: `FT transfer submitted: ${amountRaw.toString()} raw from ${signerAccountId} -> ${receiverId} on ${ftContractId}`,
						},
					],
					details: {
						amountRaw: amountRaw.toString(),
						attachedDepositYoctoNear: deposit.toString(),
						explorerUrl,
						fromAccountId: signerAccountId,
						ftContractId,
						gas: gas.toString(),
						network,
						rawResult: tx,
						rpcEndpoint: endpoint,
						toAccountId: receiverId,
						txHash,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}swapRef`,
			label: "NEAR Ref Swap",
			description:
				"Execute token swap on Ref (Rhea route) via ft_transfer_call with mainnet safety gate.",
			parameters: Type.Object({
				tokenInId: Type.String({
					description: "Input token contract id or symbol (e.g. NEAR/USDC)",
				}),
				tokenOutId: Type.String({
					description: "Output token contract id or symbol",
				}),
				amountInRaw: Type.String({
					description: "Input amount as raw integer string",
				}),
				minAmountOutRaw: Type.Optional(
					Type.String({
						description:
							"Minimum output as raw integer string. If omitted, auto-quote with slippage.",
					}),
				),
				poolId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				slippageBps: Type.Optional(
					Type.Number({
						description:
							"Slippage bps used when minAmountOutRaw is omitted (default 50).",
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
							"Auto-run storage_deposit for output token when receiver is not registered (default true).",
					}),
				),
				fromAccountId: Type.Optional(
					Type.String({
						description:
							"Signer account id. If omitted, resolve from env/credentials.",
					}),
				),
				privateKey: Type.Optional(
					Type.String({
						description:
							"Optional signer private key ed25519:... (otherwise from env/credentials).",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({
						description: "Override NEAR RPC endpoint URL",
					}),
				),
				confirmMainnet: Type.Optional(Type.Boolean()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas to attach in yoctoGas (default 180000000000000 / 180 Tgas)",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit in yoctoNEAR (default 1 for ft_transfer_call)",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearRefSwapParams;
				const tokenInInput = params.tokenInId.trim();
				const tokenOutInput = params.tokenOutId.trim();
				if (!tokenInInput || !tokenOutInput) {
					throw new Error("tokenInId and tokenOutId are required");
				}
				const amountInRaw = parsePositiveYocto(
					params.amountInRaw,
					"amountInRaw",
				);
				const slippageBps = resolveNearSwapSlippageBps(params.slippageBps);
				const gas = resolveRefSwapGas(params.gas);
				const deposit = resolveAttachedDeposit(params.attachedDepositYoctoNear);
				const autoRegisterOutput = params.autoRegisterOutput !== false;
				const { account, network, endpoint, signerAccountId } =
					createNearAccountClient({
						accountId: params.fromAccountId,
						privateKey: params.privateKey,
						network: params.network,
						rpcUrl: params.rpcUrl,
					});
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);

				const refContractId = getRefContractId(network, params.refContractId);
				const poolId = parseOptionalPoolId(params.poolId);
				const quote = await getRefSwapQuote({
					network,
					rpcUrl: params.rpcUrl,
					refContractId,
					tokenInId: tokenInInput,
					tokenOutId: tokenOutInput,
					amountInRaw: amountInRaw.toString(),
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
				const tokenInId = normalizeReceiverAccountId(firstAction.tokenInId);
				const tokenOutId = normalizeReceiverAccountId(lastAction.tokenOutId);
				if (tokenInId === tokenOutId) {
					throw new Error("tokenInId and tokenOutId must be different");
				}
				const minAmountOutRaw = resolveSafeMinAmountOutRaw({
					requestedMinAmountOutRaw: params.minAmountOutRaw,
					quoteAmountOutRaw: quote.amountOutRaw,
					quoteMinAmountOutRaw: quote.minAmountOutRaw,
				});
				const storageRegistration =
					autoRegisterOutput === true
						? await ensureFtStorageRegistered({
								account,
								network,
								rpcUrl: params.rpcUrl,
								ftContractId: tokenOutId,
								accountId: signerAccountId,
							})
						: null;
				const swapActionsPayload = quoteActions.map((action, index) => {
					const tokenIn = normalizeReceiverAccountId(action.tokenInId);
					const tokenOut = normalizeReceiverAccountId(action.tokenOutId);
					const amountIn = action.amountInRaw?.trim() || amountInRaw.toString();
					return {
						pool_id: action.poolId,
						token_in: tokenIn,
						...(index === 0 ? { amount_in: amountIn } : {}),
						token_out: tokenOut,
						min_amount_out:
							index === quoteActions.length - 1 ? minAmountOutRaw : "0",
					};
				});

				const tx = await account.callFunction({
					contractId: tokenInId,
					methodName: "ft_transfer_call",
					args: {
						receiver_id: refContractId,
						amount: amountInRaw.toString(),
						msg: JSON.stringify({
							force: 0,
							actions: swapActionsPayload,
						}),
					},
					deposit,
					gas,
				});

				const txHash = extractTxHash(tx);
				const explorerUrl = txHash
					? getNearExplorerTransactionUrl(txHash, network)
					: null;

				return {
					content: [
						{
							type: "text",
							text: `Ref swap submitted: ${amountInRaw.toString()} raw ${tokenInId} -> ${tokenOutId} (${quoteActions.length} hop(s))`,
						},
					],
					details: {
						amountInRaw: amountInRaw.toString(),
						attachedDepositYoctoNear: deposit.toString(),
						autoRegisterOutput,
						explorerUrl,
						fromAccountId: signerAccountId,
						gas: gas.toString(),
						minAmountOutRaw,
						network,
						poolId: quote.poolId,
						routeActions: quoteActions,
						rawResult: tx,
						refContractId,
						rpcEndpoint: endpoint,
						slippageBps,
						source: quote.source,
						storageRegistration,
						tokenInId,
						tokenOutId,
						txHash,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}withdrawRefToken`,
			label: "NEAR Ref Withdraw Token",
			description:
				"Withdraw deposited token from Ref exchange back to signer account.",
			parameters: Type.Object({
				tokenId: Type.String({
					description: "Token contract id or symbol to withdraw from Ref.",
				}),
				amountRaw: Type.Optional(
					Type.String({
						description:
							"Withdraw amount in raw units. If omitted, withdrawAll=true withdraws all deposit.",
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
							"Auto-run storage_deposit on token for signer before withdraw (default true).",
					}),
				),
				fromAccountId: Type.Optional(Type.String()),
				privateKey: Type.Optional(Type.String()),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas for withdraw call in yoctoGas (default 180000000000000 / 180 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description: "Attached deposit for withdraw (default 1 yoctoNEAR).",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearRefWithdrawParams;
				const { account, network, endpoint, signerAccountId } =
					createNearAccountClient({
						accountId: params.fromAccountId,
						privateKey: params.privateKey,
						network: params.network,
						rpcUrl: params.rpcUrl,
					});
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const refContractId = getRefContractId(network, params.refContractId);
				const withdraw = await executeRefWithdraw({
					account,
					network,
					rpcUrl: params.rpcUrl,
					refContractId,
					signerAccountId,
					tokenInput: params.tokenId,
					amountRaw: params.amountRaw,
					withdrawAll: params.withdrawAll,
					autoRegisterReceiver: params.autoRegisterReceiver,
					gas: params.gas,
					attachedDepositYoctoNear: params.attachedDepositYoctoNear,
				});

				return {
					content: [
						{
							type: "text",
							text: `Ref withdraw submitted: ${withdraw.amountRaw} raw ${withdraw.tokenId}`,
						},
					],
					details: {
						...withdraw,
						refContractId,
						network,
						fromAccountId: signerAccountId,
						rpcEndpoint: endpoint,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}submitIntentsDeposit`,
			label: "NEAR Intents Submit Deposit",
			description:
				"Submit a deposited tx hash to NEAR Intents 1Click (/v0/deposit/submit).",
			parameters: Type.Object({
				txHash: Type.String({
					description: "On-chain deposit transaction hash to submit.",
				}),
				depositAddress: Type.String({
					description: "Deposit address returned by NEAR Intents quote.",
				}),
				depositMemo: Type.Optional(
					Type.String({
						description:
							"Optional deposit memo returned by quote (required in memo mode).",
					}),
				),
				nearSenderAccount: Type.Optional(
					Type.String({
						description:
							"Optional NEAR sender account id (nearSenderAccount in submit API).",
					}),
				),
				network: nearNetworkSchema(),
				confirmMainnet: Type.Optional(Type.Boolean()),
				apiBaseUrl: Type.Optional(
					Type.String({
						description:
							"NEAR Intents API base URL override (default https://1click.chaindefuser.com).",
					}),
				),
				apiKey: Type.Optional(
					Type.String({
						description:
							"Optional NEAR Intents API key (fallback env NEAR_INTENTS_API_KEY).",
					}),
				),
				jwt: Type.Optional(
					Type.String({
						description: "Optional bearer JWT (fallback env NEAR_INTENTS_JWT).",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearSubmitIntentsDepositParams;
				const network = parseNearNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const txHash = normalizeNonEmptyText(params.txHash, "txHash");
				const depositAddress = normalizeNonEmptyText(
					params.depositAddress,
					"depositAddress",
				);
				const depositMemo =
					typeof params.depositMemo === "string" && params.depositMemo.trim()
						? params.depositMemo.trim()
						: undefined;
				const nearSenderAccount =
					typeof params.nearSenderAccount === "string" &&
					params.nearSenderAccount.trim()
						? normalizeReceiverAccountId(params.nearSenderAccount)
						: undefined;
				const baseUrl = resolveNearIntentsApiBaseUrl(params.apiBaseUrl);
				const authHeaders = resolveNearIntentsHeaders({
					apiKey: params.apiKey,
					jwt: params.jwt,
				});
				const response = await fetchNearIntentsJson<Record<string, unknown>>({
					baseUrl,
					path: "/v0/deposit/submit",
					method: "POST",
					headers: authHeaders,
					body: {
						txHash,
						depositAddress,
						...(depositMemo ? { memo: depositMemo } : {}),
						...(nearSenderAccount
							? {
									nearSenderAccount,
								}
							: {}),
					},
				});
				const responsePayload = response.payload;
				const correlationId =
					typeof responsePayload.correlationId === "string"
						? responsePayload.correlationId
						: null;
				const status =
					typeof responsePayload.status === "string"
						? responsePayload.status
						: null;
				const lines = [
					`Intents deposit submitted: txHash=${txHash}`,
					`Deposit: ${depositAddress}${depositMemo ? ` (memo ${depositMemo})` : ""}`,
				];
				if (status) {
					lines.push(`Status: ${status}`);
				}
				if (correlationId) {
					lines.push(`CorrelationId: ${correlationId}`);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						network,
						apiBaseUrl: baseUrl,
						endpoint: response.url,
						httpStatus: response.status,
						txHash,
						depositAddress,
						depositMemo: depositMemo ?? null,
						nearSenderAccount: nearSenderAccount ?? null,
						correlationId,
						status,
						response: responsePayload,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}addLiquidityRef`,
			label: "NEAR Ref Add Liquidity",
			description:
				"Add liquidity to a Ref pool via deposit + add_liquidity, with optional auto-registration steps.",
			parameters: Type.Object({
				poolId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				amountsRaw: Type.Optional(
					Type.Array(Type.String(), {
						description:
							"Pool-order raw amounts array. If provided, overrides amountA/amountB.",
					}),
				),
				amountARaw: Type.Optional(
					Type.String({
						description:
							"Token A amount in raw units. Used when amountsRaw is omitted.",
					}),
				),
				amountBRaw: Type.Optional(
					Type.String({
						description:
							"Token B amount in raw units. Used when amountsRaw is omitted.",
					}),
				),
				amountA: Type.Optional(
					Type.Union([
						Type.String({
							description:
								"Token A amount in decimal units (requires known decimals).",
						}),
						Type.Number({
							description:
								"Token A amount in decimal units (requires known decimals).",
						}),
					]),
				),
				amountB: Type.Optional(
					Type.Union([
						Type.String({
							description:
								"Token B amount in decimal units (requires known decimals).",
						}),
						Type.Number({
							description:
								"Token B amount in decimal units (requires known decimals).",
						}),
					]),
				),
				tokenAId: Type.Optional(
					Type.String({
						description:
							"Token A id/symbol for amountA mapping (default pool token[0]).",
					}),
				),
				tokenBId: Type.Optional(
					Type.String({
						description:
							"Token B id/symbol for amountB mapping (default pool token[1]).",
					}),
				),
				refContractId: Type.Optional(
					Type.String({
						description:
							"Ref contract id override (default mainnet v2.ref-finance.near).",
					}),
				),
				autoRegisterExchange: Type.Optional(
					Type.Boolean({
						description:
							"Auto storage_deposit signer account on Ref exchange (default true).",
					}),
				),
				autoRegisterTokens: Type.Optional(
					Type.Boolean({
						description:
							"Auto register/deposit token storage for Ref exchange + register_tokens (default true).",
					}),
				),
				fromAccountId: Type.Optional(Type.String()),
				privateKey: Type.Optional(Type.String()),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas for add_liquidity call in yoctoGas (default 180000000000000 / 180 Tgas)",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit for add_liquidity (default 1 yoctoNEAR).",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearRefAddLiquidityParams;
				const addLiquidityGas = resolveRefSwapGas(params.gas);
				const addLiquidityDeposit = resolveAttachedDeposit(
					params.attachedDepositYoctoNear,
				);
				const autoRegisterExchange = params.autoRegisterExchange !== false;
				const autoRegisterTokens = params.autoRegisterTokens !== false;
				const { account, network, endpoint, signerAccountId } =
					createNearAccountClient({
						accountId: params.fromAccountId,
						privateKey: params.privateKey,
						network: params.network,
						rpcUrl: params.rpcUrl,
					});
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);

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
						(entry) => parseNonNegativeYocto(entry.amountRaw, "amountRaw") > 0n,
					);
				if (activeTokenRows.length === 0) {
					throw new Error(
						"No positive token amount provided for add liquidity",
					);
				}

				const exchangeStorageRegistration =
					autoRegisterExchange === true
						? await ensureRefAccountStorageRegistered({
								account,
								network,
								rpcUrl: params.rpcUrl,
								refContractId,
								accountId: signerAccountId,
							})
						: null;

				const tokenStorageRegistrations: Array<{
					tokenId: string;
					registration: StorageRegistrationResult;
				}> = [];
				if (autoRegisterTokens) {
					for (const row of activeTokenRows) {
						const registration = await ensureFtStorageRegistered({
							account,
							network,
							rpcUrl: params.rpcUrl,
							ftContractId: row.tokenId,
							accountId: refContractId,
						});
						tokenStorageRegistrations.push({
							tokenId: row.tokenId,
							registration,
						});
					}
				}
				const tokenRegistrationStatus =
					autoRegisterTokens === true
						? await registerTokensOnRefExchange({
								account,
								refContractId,
								tokenIds: activeTokenRows.map((row) => row.tokenId),
							})
						: null;

				const depositTxs: Array<{
					tokenId: string;
					amountRaw: string;
					txHash: string | null;
					explorerUrl: string | null;
				}> = [];
				for (const row of activeTokenRows) {
					const depositTx = await account.callFunction({
						contractId: row.tokenId,
						methodName: "ft_transfer_call",
						args: {
							receiver_id: refContractId,
							amount: row.amountRaw,
							msg: "",
						},
						deposit: 1n,
						gas: DEFAULT_REF_DEPOSIT_TOKEN_GAS,
					});
					const txHash = extractTxHash(depositTx);
					depositTxs.push({
						tokenId: row.tokenId,
						amountRaw: row.amountRaw,
						txHash,
						explorerUrl: txHash
							? getNearExplorerTransactionUrl(txHash, network)
							: null,
					});
				}

				const addLiquidityTx = await account.callFunction({
					contractId: refContractId,
					methodName: "add_liquidity",
					args: {
						pool_id: poolId,
						amounts: amountsRaw,
					},
					deposit: addLiquidityDeposit,
					gas: addLiquidityGas,
				});
				const txHash = extractTxHash(addLiquidityTx);
				const explorerUrl = txHash
					? getNearExplorerTransactionUrl(txHash, network)
					: null;

				return {
					content: [
						{
							type: "text",
							text: `Ref add_liquidity submitted: pool=${poolId} tokens=${poolTokenIds.join("/")}`,
						},
					],
					details: {
						poolId,
						poolSelectionSource,
						poolCandidates,
						poolTokenIds,
						amountsRaw,
						tokenAId,
						tokenBId,
						inferredPair,
						refContractId,
						network,
						fromAccountId: signerAccountId,
						rpcEndpoint: endpoint,
						autoRegisterExchange,
						autoRegisterTokens,
						exchangeStorageRegistration,
						tokenStorageRegistrations,
						tokenRegistrationStatus,
						depositTxs,
						addLiquidityGas: addLiquidityGas.toString(),
						attachedDepositYoctoNear: addLiquidityDeposit.toString(),
						txHash,
						explorerUrl,
						rawResult: addLiquidityTx,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}removeLiquidityRef`,
			label: "NEAR Ref Remove Liquidity",
			description: "Remove liquidity from a Ref pool via remove_liquidity.",
			parameters: Type.Object({
				poolId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				shares: Type.Optional(
					Type.String({
						description: "LP shares to remove, raw integer string.",
					}),
				),
				shareBps: Type.Optional(
					Type.Number({
						description:
							"Alternative to shares: remove by basis points of current LP shares (1-10000).",
					}),
				),
				sharePercent: Type.Optional(
					Type.Union([
						Type.String({
							description:
								"Alternative to shares: remove by percentage of current LP shares (e.g. '50').",
						}),
						Type.Number({
							description:
								"Alternative to shares: remove by percentage of current LP shares (e.g. 50).",
						}),
					]),
				),
				minAmountsRaw: Type.Optional(
					Type.Array(Type.String(), {
						description:
							"Pool-order min amounts array. If omitted, defaults to [0, 0, ...].",
					}),
				),
				minAmountARaw: Type.Optional(
					Type.String({
						description:
							"Optional first token min amount when minAmountsRaw is omitted.",
					}),
				),
				minAmountBRaw: Type.Optional(
					Type.String({
						description:
							"Optional second token min amount when minAmountsRaw is omitted.",
					}),
				),
				tokenAId: Type.Optional(
					Type.String({
						description:
							"Token A id/symbol used for automatic pool selection when poolId is omitted.",
					}),
				),
				tokenBId: Type.Optional(
					Type.String({
						description:
							"Token B id/symbol used for automatic pool selection when poolId is omitted.",
					}),
				),
				autoWithdraw: Type.Optional(
					Type.Boolean({
						description:
							"After remove_liquidity succeeds, auto-withdraw pool tokens from Ref to wallet (default false).",
					}),
				),
				autoRegisterReceiver: Type.Optional(
					Type.Boolean({
						description:
							"When autoWithdraw=true, auto-run storage_deposit on receiver token accounts (default true).",
					}),
				),
				refContractId: Type.Optional(Type.String()),
				fromAccountId: Type.Optional(Type.String()),
				privateKey: Type.Optional(Type.String()),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				gas: Type.Optional(
					Type.String({
						description:
							"Gas for remove_liquidity call in yoctoGas (default 180000000000000 / 180 Tgas).",
					}),
				),
				attachedDepositYoctoNear: Type.Optional(
					Type.String({
						description:
							"Attached deposit for remove_liquidity (default 1 yoctoNEAR).",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as NearRefRemoveLiquidityParams;
				const removeLiquidityGas = resolveRefSwapGas(params.gas);
				const removeLiquidityDeposit = resolveAttachedDeposit(
					params.attachedDepositYoctoNear,
				);
				const autoWithdraw = params.autoWithdraw === true;
				const { account, network, endpoint, signerAccountId } =
					createNearAccountClient({
						accountId: params.fromAccountId,
						privateKey: params.privateKey,
						network: params.network,
						rpcUrl: params.rpcUrl,
					});
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);

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
				const shareResolution = await resolveRemoveLiquidityShares({
					network,
					rpcUrl: params.rpcUrl,
					refContractId,
					poolId,
					accountId: signerAccountId,
					shares: params.shares,
					shareBps: params.shareBps,
					sharePercent: params.sharePercent,
				});
				const shares = shareResolution.shares;
				const withdrawGas = params.gas;
				const withdrawDeposit = params.attachedDepositYoctoNear;

				const removeTx = await account.callFunction({
					contractId: refContractId,
					methodName: "remove_liquidity",
					args: {
						pool_id: poolId,
						shares,
						min_amounts: minAmountsRaw,
					},
					deposit: removeLiquidityDeposit,
					gas: removeLiquidityGas,
				});
				const txHash = extractTxHash(removeTx);
				const explorerUrl = txHash
					? getNearExplorerTransactionUrl(txHash, network)
					: null;
				const autoWithdrawResults: Array<{
					tokenId: string;
					amountRaw: string;
					depositBeforeRaw: string;
					storageRegistration: StorageRegistrationResult | null;
					txHash: string | null;
					explorerUrl: string | null;
				}> = [];
				if (autoWithdraw) {
					const refDeposits = await queryRefUserDeposits({
						network,
						rpcUrl: params.rpcUrl,
						refContractId,
						accountId: signerAccountId,
					});
					for (const tokenId of poolTokenIds) {
						const depositBeforeRaw = parseNonNegativeYocto(
							refDeposits[tokenId] ?? "0",
							`deposits[${tokenId}]`,
						).toString();
						if (
							parseNonNegativeYocto(depositBeforeRaw, "depositBeforeRaw") <= 0n
						) {
							autoWithdrawResults.push({
								tokenId,
								amountRaw: "0",
								depositBeforeRaw,
								storageRegistration: null,
								txHash: null,
								explorerUrl: null,
							});
							continue;
						}
						const storageRegistration =
							params.autoRegisterReceiver === false
								? null
								: await ensureFtStorageRegistered({
										account,
										network,
										rpcUrl: params.rpcUrl,
										ftContractId: tokenId,
										accountId: signerAccountId,
									});
						const withdrawTx = await account.callFunction({
							contractId: refContractId,
							methodName: "withdraw",
							args: {
								token_id: tokenId,
								amount: depositBeforeRaw,
							},
							deposit: resolveAttachedDeposit(withdrawDeposit),
							gas: resolveRefSwapGas(withdrawGas),
						});
						const withdrawTxHash = extractTxHash(withdrawTx);
						autoWithdrawResults.push({
							tokenId,
							amountRaw: depositBeforeRaw,
							depositBeforeRaw,
							storageRegistration,
							txHash: withdrawTxHash,
							explorerUrl: withdrawTxHash
								? getNearExplorerTransactionUrl(withdrawTxHash, network)
								: null,
						});
					}
				}

				return {
					content: [
						{
							type: "text",
							text: `Ref remove_liquidity submitted: pool=${poolId} shares=${shares}${autoWithdraw ? ` (autoWithdraw ${autoWithdrawResults.filter((entry) => entry.txHash).length}/${poolTokenIds.length})` : ""}`,
						},
					],
					details: {
						poolId,
						poolSelectionSource,
						poolCandidates,
						poolTokenIds,
						shares,
						minAmountsRaw,
						shareBpsUsed: shareResolution.shareBpsUsed,
						availableShares: shareResolution.availableShares,
						tokenAId: inferredPair?.tokenAId ?? null,
						tokenBId: inferredPair?.tokenBId ?? null,
						inferredPair,
						autoWithdraw,
						autoWithdrawResults,
						refContractId,
						network,
						fromAccountId: signerAccountId,
						rpcEndpoint: endpoint,
						gas: removeLiquidityGas.toString(),
						attachedDepositYoctoNear: removeLiquidityDeposit.toString(),
						txHash,
						explorerUrl,
						rawResult: removeTx,
					},
				};
			},
		}),
	];
}
