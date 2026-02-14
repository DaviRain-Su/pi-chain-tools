import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { fetchRefPoolById, getRefContractId, getRefSwapQuote } from "../ref.js";
import {
	NEAR_TOOL_PREFIX,
	callNearRpc,
	formatNearAmount,
	formatTokenAmount,
	getNearRpcEndpoint,
	nearNetworkSchema,
	parseNearNetwork,
	resolveNearAccountId,
} from "../runtime.js";

type NearViewAccountResult = {
	amount: string;
	locked: string;
	code_hash: string;
	storage_usage: number;
	storage_paid_at: number;
	block_hash: string;
	block_height: number;
};

type NearCallFunctionResult = {
	result: number[];
	logs: string[];
	block_height: number;
	block_hash: string;
};

type NearFtMetadata = {
	spec?: string;
	name?: string;
	symbol?: string;
	decimals?: number;
	icon?: string | null;
	reference?: string | null;
	reference_hash?: string | null;
};

type NearPortfolioAsset = {
	kind: "native" | "ft";
	symbol: string;
	contractId: string | null;
	rawAmount: string;
	uiAmount: string | null;
	decimals: number | null;
};

type NearPortfolioFailure = {
	ftContractId: string;
	error: string;
};

type NearRefDepositAsset = {
	tokenId: string;
	symbol: string;
	rawAmount: string;
	uiAmount: string | null;
	decimals: number | null;
	metadata: NearFtMetadata | null;
};

type NearRefDepositFailure = {
	tokenId: string;
	error: string;
};

type NearRefPoolView = {
	id: number;
	tokenIds: string[];
	poolKind?: string;
};

type NearRefLpPosition = {
	poolId: number;
	poolKind?: string;
	tokenIds: string[];
	tokenSymbols: string[];
	pairLabel: string;
	sharesRaw: string;
	removeHint: string;
};

type NearRefLpFailure = {
	poolId: number;
	error: string;
};

type NearIntentsBlockchain =
	| "near"
	| "eth"
	| "base"
	| "arb"
	| "btc"
	| "sol"
	| "ton"
	| "doge"
	| "xrp"
	| "zec"
	| "gnosis"
	| "bera"
	| "bsc"
	| "pol"
	| "tron"
	| "sui"
	| "op"
	| "avax"
	| "cardano"
	| "stellar"
	| "ltc"
	| "xlayer"
	| "monad"
	| "bch"
	| "adi"
	| "plasma"
	| "scroll"
	| "starknet"
	| "aleo";

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
	swapType: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT" | "ANY_INPUT";
	slippageTolerance: number;
	originAsset: string;
	depositType: "ORIGIN_CHAIN" | "INTENTS";
	destinationAsset: string;
	amount: string;
	refundTo: string;
	refundType: "ORIGIN_CHAIN" | "INTENTS";
	recipient: string;
	recipientType: "DESTINATION_CHAIN" | "INTENTS";
	deadline: string;
	depositMode?: "SIMPLE" | "MEMO";
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

type NearIntentsExplorerTransaction = {
	originAsset: string | null;
	destinationAsset: string | null;
	depositAddress: string | null;
	depositAddressAndMemo: string | null;
	recipient: string | null;
	status: string | null;
	createdAt: string | null;
	createdAtTimestamp: number | null;
	intentHashes: string | null;
	referral: string | null;
	amountIn: string | null;
	amountInFormatted: string | null;
	amountInUsd: string | null;
	amountOut: string | null;
	amountOutFormatted: string | null;
	amountOutUsd: string | null;
	refundTo: string | null;
	refundReason: string | null;
	senders: string[];
	nearTxHashes: string[];
	originChainTxHashes: string[];
	destinationChainTxHashes: string[];
	raw: Record<string, unknown>;
};

type NearIntentsExplorerTransactionsResponse = {
	data: NearIntentsExplorerTransaction[];
	page: number | null;
	perPage: number | null;
	total: number | null;
	totalPages: number | null;
	nextPage: number | null;
	prevPage: number | null;
};

type NearIntentsBadRequest = {
	message?: string;
	statusCode?: number;
	error?: string;
	timestamp?: string;
	path?: string;
};

type NearIntentsQueryParams = Record<string, string | undefined>;

const NEAR_PORTFOLIO_ENV_BY_NETWORK: Record<"mainnet" | "testnet", string> = {
	mainnet: "NEAR_PORTFOLIO_FT_MAINNET_CONTRACTS",
	testnet: "NEAR_PORTFOLIO_FT_TESTNET_CONTRACTS",
};

const DEFAULT_NEAR_PORTFOLIO_FT_BY_NETWORK: Record<
	"mainnet" | "testnet",
	string[]
> = {
	mainnet: [
		"usdt.tether-token.near",
		"a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
		"usdc.tether-token.near",
	],
	testnet: ["usdt.fakes.testnet", "usdc.fakes.near"],
};

const DEFAULT_NEAR_INTENTS_API_BASE_URL = "https://1click.chaindefuser.com";
const DEFAULT_NEAR_INTENTS_EXPLORER_API_BASE_URL =
	"https://explorer.near-intents.org";
const NEAR_INTENTS_EXPLORER_STATUS_VALUES = [
	"FAILED",
	"INCOMPLETE_DEPOSIT",
	"PENDING_DEPOSIT",
	"PROCESSING",
	"REFUNDED",
	"SUCCESS",
] as const;
const NEAR_INTENTS_EXPLORER_CHAIN_VALUES = [
	"near",
	"eth",
	"base",
	"arb",
	"btc",
	"sol",
	"ton",
	"doge",
	"xrp",
	"zec",
	"gnosis",
	"bera",
	"bsc",
	"pol",
	"tron",
	"sui",
	"op",
	"avax",
	"cardano",
	"stellar",
	"aptos",
	"ltc",
	"monad",
	"xlayer",
	"starknet",
	"bch",
	"adi",
	"plasma",
	"scroll",
	"aleo",
] as const;

function parseUnsignedBigInt(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	return BigInt(normalized);
}

function toTextBytes(value: number[]): string {
	if (
		!Array.isArray(value) ||
		value.some((entry) => !Number.isInteger(entry))
	) {
		throw new Error("NEAR call_function result bytes are invalid");
	}
	return Buffer.from(Uint8Array.from(value)).toString("utf8");
}

function decodeNearCallFunctionJson<T>(result: NearCallFunctionResult): T {
	const raw = toTextBytes(result.result);
	if (!raw.trim()) {
		throw new Error("NEAR call_function returned empty payload");
	}
	return JSON.parse(raw) as T;
}

function buildViewAccountParams(accountId: string) {
	return {
		account_id: accountId,
		finality: "final",
		request_type: "view_account",
	};
}

function buildCallFunctionParams(params: {
	accountId: string;
	methodName: string;
	args: Record<string, unknown>;
}) {
	return {
		account_id: params.accountId,
		args_base64: Buffer.from(JSON.stringify(params.args), "utf8").toString(
			"base64",
		),
		finality: "final",
		method_name: params.methodName,
		request_type: "call_function",
	};
}

async function queryViewAccount(params: {
	accountId: string;
	network: string;
	rpcUrl?: string;
}): Promise<NearViewAccountResult> {
	return await callNearRpc<NearViewAccountResult>({
		method: "query",
		network: params.network,
		params: buildViewAccountParams(params.accountId),
		rpcUrl: params.rpcUrl,
	});
}

async function queryFtBalance(params: {
	accountId: string;
	ftContractId: string;
	network: string;
	rpcUrl?: string;
}): Promise<{ rawBalance: string; blockHeight: number; blockHash: string }> {
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		params: buildCallFunctionParams({
			accountId: params.ftContractId,
			args: {
				account_id: params.accountId,
			},
			methodName: "ft_balance_of",
		}),
		rpcUrl: params.rpcUrl,
	});

	const rawBalance = decodeNearCallFunctionJson<string>(result);
	if (typeof rawBalance !== "string") {
		throw new Error("ft_balance_of returned an invalid payload");
	}
	parseUnsignedBigInt(rawBalance, "ft_balance_of");

	return {
		blockHash: result.block_hash,
		blockHeight: result.block_height,
		rawBalance,
	};
}

async function queryFtMetadata(params: {
	ftContractId: string;
	network: string;
	rpcUrl?: string;
}): Promise<NearFtMetadata | null> {
	try {
		const result = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			params: buildCallFunctionParams({
				accountId: params.ftContractId,
				args: {},
				methodName: "ft_metadata",
			}),
			rpcUrl: params.rpcUrl,
		});
		const metadata = decodeNearCallFunctionJson<NearFtMetadata>(result);
		if (!metadata || typeof metadata !== "object") {
			return null;
		}
		return metadata;
	} catch {
		return null;
	}
}

function shortAccountId(value: string): string {
	if (value.length <= 28) return value;
	return `${value.slice(0, 14)}...${value.slice(-10)}`;
}

function parseFtContractList(value: string | undefined): string[] {
	const normalized = value?.trim();
	if (!normalized) return [];
	return normalized
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

function normalizeFtContractIds(values: string[] | undefined): string[] {
	if (!Array.isArray(values) || values.length === 0) return [];
	return values.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function dedupeStrings(values: string[]): string[] {
	return [...new Set(values)];
}

function resolvePortfolioFtContracts(params: {
	network: "mainnet" | "testnet";
	ftContractIds?: string[];
}): string[] {
	const explicit = normalizeFtContractIds(params.ftContractIds);
	if (explicit.length > 0) return dedupeStrings(explicit);

	const globalFromEnv = parseFtContractList(
		process.env.NEAR_PORTFOLIO_FT_CONTRACTS,
	);
	const networkFromEnv = parseFtContractList(
		process.env[NEAR_PORTFOLIO_ENV_BY_NETWORK[params.network]],
	);
	const defaults = DEFAULT_NEAR_PORTFOLIO_FT_BY_NETWORK[params.network];

	return dedupeStrings([...globalFromEnv, ...networkFromEnv, ...defaults]);
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

function parsePoolIdList(values?: (number | string)[]): number[] {
	if (!Array.isArray(values) || values.length === 0) return [];
	return [...new Set(values.map((value) => parseOptionalPoolId(value)))].filter(
		(value): value is number => value != null,
	);
}

function parseMaxPools(value?: number): number {
	if (value == null) return 200;
	if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
		throw new Error("maxPools must be a positive integer");
	}
	return Math.min(value, 1_000);
}

function normalizeTokenFilterList(values?: string[]): string[] {
	if (!Array.isArray(values) || values.length === 0) return [];
	return dedupeStrings(
		values.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
	);
}

function parsePositiveInt(
	value: number | undefined,
	fieldName: string,
): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		!Number.isInteger(value) ||
		value <= 0
	) {
		throw new Error(`${fieldName} must be a positive integer`);
	}
	return value;
}

function parseIntentsListLimit(value: number | undefined): number {
	if (value == null) return 20;
	return Math.min(200, parsePositiveInt(value, "limit"));
}

function parseIntentsWithdrawalsLimit(value: number | undefined): number {
	if (value == null) return 50;
	return Math.min(50, parsePositiveInt(value, "limit"));
}

function parseIntentsExplorerPerPage(value: number | undefined): number {
	if (value == null) return 20;
	return Math.min(1_000, parsePositiveInt(value, "perPage"));
}

function parseIntentsExplorerNumberOfTransactions(
	value: number | undefined,
): number {
	if (value == null) return 50;
	return Math.min(1_000, parsePositiveInt(value, "numberOfTransactions"));
}

function parseIntentsExplorerStatuses(
	value: string[] | undefined,
): string | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const allowed = new Set<string>(NEAR_INTENTS_EXPLORER_STATUS_VALUES);
	const normalized = dedupeStrings(
		value.map((entry) => entry.trim().toUpperCase()).filter(Boolean),
	);
	for (const status of normalized) {
		if (!allowed.has(status)) {
			throw new Error(
				`statuses contains unsupported value '${status}' (allowed: ${[...allowed].join(", ")})`,
			);
		}
	}
	return normalized.join(",");
}

function parseOptionalPositiveInt(
	value: number | undefined,
	fieldName: string,
): number | undefined {
	if (value == null) return undefined;
	return parsePositiveInt(value, fieldName);
}

function parseOptionalNonNegativeNumber(
	value: number | undefined,
	fieldName: string,
): number | undefined {
	if (value == null) return undefined;
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`${fieldName} must be a number >= 0`);
	}
	return value;
}

function parseOptionalIsoDatetime(
	value: string | undefined,
	fieldName: string,
): string | undefined {
	const normalized = value?.trim();
	if (!normalized) return undefined;
	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`${fieldName} must be a valid ISO datetime string`);
	}
	return parsed.toISOString();
}

function parseOptionalNearIntentsChain(
	value: string | undefined,
	fieldName: string,
): string | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	const allowed = new Set<string>(NEAR_INTENTS_EXPLORER_CHAIN_VALUES);
	if (!allowed.has(normalized)) {
		throw new Error(
			`${fieldName} must be one of: ${NEAR_INTENTS_EXPLORER_CHAIN_VALUES.join(", ")}`,
		);
	}
	return normalized;
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

function resolveNearIntentsExplorerApiBaseUrl(endpoint?: string): string {
	const explicit = endpoint?.trim();
	const fromEnv = process.env.NEAR_INTENTS_EXPLORER_API_BASE_URL?.trim();
	const selected =
		explicit || fromEnv || DEFAULT_NEAR_INTENTS_EXPLORER_API_BASE_URL;
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

function resolveNearIntentsExplorerHeaders(params: {
	jwt?: string;
}): Record<string, string> {
	const jwt =
		params.jwt?.trim() ||
		process.env.NEAR_INTENTS_EXPLORER_JWT?.trim() ||
		process.env.NEAR_INTENTS_JWT?.trim();
	if (!jwt) {
		throw new Error(
			"near_getIntentsExplorerTransactions requires jwt (pass jwt or set NEAR_INTENTS_EXPLORER_JWT/NEAR_INTENTS_JWT)",
		);
	}
	return {
		Authorization: `Bearer ${jwt}`,
	};
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

function normalizeNearIntentsExplorerTransactions(
	value: unknown,
): NearIntentsExplorerTransactionsResponse {
	const root =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	const dataSource = Array.isArray(value)
		? value
		: Array.isArray(root.data)
			? root.data
			: [];
	const data = dataSource
		.filter(
			(entry): entry is Record<string, unknown> =>
				Boolean(entry) && typeof entry === "object",
		)
		.map((entry) => ({
			originAsset: pickOptionalText(entry, "originAsset"),
			destinationAsset: pickOptionalText(entry, "destinationAsset"),
			depositAddress: pickOptionalText(entry, "depositAddress"),
			depositAddressAndMemo: pickOptionalText(entry, "depositAddressAndMemo"),
			recipient: pickOptionalText(entry, "recipient"),
			status: pickOptionalText(entry, "status"),
			createdAt: pickOptionalText(entry, "createdAt"),
			createdAtTimestamp:
				typeof entry.createdAtTimestamp === "number" &&
				Number.isFinite(entry.createdAtTimestamp)
					? Math.floor(entry.createdAtTimestamp)
					: null,
			intentHashes: pickOptionalText(entry, "intentHashes"),
			referral: pickOptionalText(entry, "referral"),
			amountIn: pickOptionalText(entry, "amountIn"),
			amountInFormatted: pickOptionalText(entry, "amountInFormatted"),
			amountInUsd: pickOptionalText(entry, "amountInUsd"),
			amountOut: pickOptionalText(entry, "amountOut"),
			amountOutFormatted: pickOptionalText(entry, "amountOutFormatted"),
			amountOutUsd: pickOptionalText(entry, "amountOutUsd"),
			refundTo: pickOptionalText(entry, "refundTo"),
			refundReason: pickOptionalText(entry, "refundReason"),
			senders: Array.isArray(entry.senders)
				? entry.senders
						.filter((sender): sender is string => typeof sender === "string")
						.map((sender) => sender.trim())
						.filter(Boolean)
				: [],
			nearTxHashes: Array.isArray(entry.nearTxHashes)
				? entry.nearTxHashes
						.filter((txHash): txHash is string => typeof txHash === "string")
						.map((txHash) => txHash.trim())
						.filter(Boolean)
				: [],
			originChainTxHashes: Array.isArray(entry.originChainTxHashes)
				? entry.originChainTxHashes
						.filter((txHash): txHash is string => typeof txHash === "string")
						.map((txHash) => txHash.trim())
						.filter(Boolean)
				: [],
			destinationChainTxHashes: Array.isArray(entry.destinationChainTxHashes)
				? entry.destinationChainTxHashes
						.filter((txHash): txHash is string => typeof txHash === "string")
						.map((txHash) => txHash.trim())
						.filter(Boolean)
				: [],
			raw: entry,
		}));
	return {
		data,
		page:
			typeof root.page === "number" && Number.isFinite(root.page)
				? Math.floor(root.page)
				: null,
		perPage:
			typeof root.perPage === "number" && Number.isFinite(root.perPage)
				? Math.floor(root.perPage)
				: null,
		total:
			typeof root.total === "number" && Number.isFinite(root.total)
				? Math.floor(root.total)
				: null,
		totalPages:
			typeof root.totalPages === "number" && Number.isFinite(root.totalPages)
				? Math.floor(root.totalPages)
				: null,
		nextPage:
			typeof root.nextPage === "number" && Number.isFinite(root.nextPage)
				? Math.floor(root.nextPage)
				: null,
		prevPage:
			typeof root.prevPage === "number" && Number.isFinite(root.prevPage)
				? Math.floor(root.prevPage)
				: null,
	};
}

function formatNearIntentsExplorerAssetLabel(asset: string | null): string {
	const normalized = asset?.trim();
	if (!normalized) return "unknown";
	const parts = normalized.split(":");
	if (parts.length < 2) {
		return normalized.length > 32 ? shortAccountId(normalized) : normalized;
	}
	const chain = parts[0]?.trim() || "unknown";
	const rawToken = parts.slice(1).join(":").trim();
	let tokenLabel = rawToken;
	if (rawToken.includes("::")) {
		const segments = rawToken.split("::").filter(Boolean);
		const tail = segments[segments.length - 1];
		tokenLabel = tail ?? rawToken;
	}
	if (tokenLabel.length > 32) {
		tokenLabel = shortAccountId(tokenLabel);
	}
	return `${tokenLabel} [${chain}]`;
}

function parseOptionalFiniteNumber(value: string | null): number | null {
	if (!value) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function formatUsdApprox(value: number | null): string | null {
	if (value == null) return null;
	return value.toLocaleString(undefined, {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: value >= 100 ? 0 : 2,
		maximumFractionDigits: 2,
	});
}

function summarizeNearIntentsExplorerStatuses(
	transactions: NearIntentsExplorerTransaction[],
): Record<string, number> {
	const summary: Record<string, number> = {};
	for (const tx of transactions) {
		const key = tx.status?.trim().toUpperCase() || "UNKNOWN";
		summary[key] = (summary[key] ?? 0) + 1;
	}
	return summary;
}

function formatNearIntentsExplorerStatusSummary(
	statusSummary: Record<string, number>,
): string {
	const preferredOrder = new Map<string, number>(
		[...NEAR_INTENTS_EXPLORER_STATUS_VALUES, "UNKNOWN"].map(
			(status, index) => [status, index] as const,
		),
	);
	const statuses = Object.keys(statusSummary);
	statuses.sort((left, right) => {
		const leftOrder = preferredOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
		const rightOrder = preferredOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
		if (leftOrder !== rightOrder) return leftOrder - rightOrder;
		return left.localeCompare(right);
	});
	return statuses
		.map((status) => `${status}=${statusSummary[status] ?? 0}`)
		.join(" | ");
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

function formatRefAssetAmount(params: {
	rawAmount: string;
	decimals: number | null;
}): string | null {
	if (params.decimals == null) return null;
	try {
		return formatTokenAmount(params.rawAmount, params.decimals, 8);
	} catch {
		return null;
	}
}

function resolveRefAssetText(asset: NearRefDepositAsset): string {
	const amountText =
		asset.uiAmount == null
			? `${asset.rawAmount} raw`
			: `${asset.uiAmount} (raw ${asset.rawAmount})`;
	return `${asset.symbol}: ${amountText} on ${asset.tokenId}`;
}

function resolveRefPoolPositionText(position: NearRefLpPosition): string[] {
	return [
		`Pool ${position.poolId} (${position.pairLabel}): shares ${position.sharesRaw}`,
		`Tokens: ${position.tokenIds.join(" / ")}`,
		`Hint: ${position.removeHint}`,
	];
}

async function queryRefDeposits(params: {
	accountId: string;
	network: string;
	refContractId: string;
	rpcUrl?: string;
}): Promise<Record<string, string>> {
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: buildCallFunctionParams({
			accountId: params.refContractId,
			methodName: "get_deposits",
			args: {
				account_id: params.accountId,
			},
		}),
	});
	const decoded = decodeNearCallFunctionJson<Record<string, string>>(result);
	if (!decoded || typeof decoded !== "object") {
		return {};
	}
	const deposits: Record<string, string> = {};
	for (const [tokenId, rawAmount] of Object.entries(decoded)) {
		if (typeof tokenId !== "string" || typeof rawAmount !== "string") continue;
		const normalizedTokenId = tokenId.trim().toLowerCase();
		if (!normalizedTokenId) continue;
		deposits[normalizedTokenId] = parseUnsignedBigInt(
			rawAmount,
			`deposits[${normalizedTokenId}]`,
		).toString();
	}
	return deposits;
}

async function queryRefPoolShares(params: {
	accountId: string;
	network: string;
	refContractId: string;
	poolId: number;
	rpcUrl?: string;
}): Promise<string> {
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: buildCallFunctionParams({
			accountId: params.refContractId,
			methodName: "get_pool_shares",
			args: {
				pool_id: params.poolId,
				account_id: params.accountId,
			},
		}),
	});
	const shares = decodeNearCallFunctionJson<string>(result);
	if (typeof shares !== "string") {
		throw new Error("get_pool_shares returned invalid payload");
	}
	return parseUnsignedBigInt(shares, "poolShares").toString();
}

async function queryRefPoolsPage(params: {
	network: string;
	refContractId: string;
	fromIndex: number;
	limit: number;
	rpcUrl?: string;
}): Promise<{ pools: NearRefPoolView[]; rawCount: number }> {
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: buildCallFunctionParams({
			accountId: params.refContractId,
			methodName: "get_pools",
			args: {
				from_index: params.fromIndex,
				limit: params.limit,
			},
		}),
	});
	const decoded = decodeNearCallFunctionJson<unknown[]>(result);
	if (!Array.isArray(decoded)) {
		throw new Error("get_pools returned invalid payload");
	}
	const pools: NearRefPoolView[] = [];
	for (const [index, entry] of decoded.entries()) {
		if (!entry || typeof entry !== "object") continue;
		const rawPool = entry as {
			id?: number;
			token_account_ids?: unknown;
			pool_kind?: unknown;
		};
		const tokenIds = Array.isArray(rawPool.token_account_ids)
			? rawPool.token_account_ids
					.filter((tokenId): tokenId is string => typeof tokenId === "string")
					.map((tokenId) => tokenId.toLowerCase())
			: [];
		if (tokenIds.length < 2) continue;
		const poolId =
			typeof rawPool.id === "number" &&
			Number.isInteger(rawPool.id) &&
			rawPool.id >= 0
				? rawPool.id
				: params.fromIndex + index;
		pools.push({
			id: poolId,
			tokenIds,
			poolKind:
				typeof rawPool.pool_kind === "string" ? rawPool.pool_kind : undefined,
		});
	}
	return {
		pools,
		rawCount: decoded.length,
	};
}

async function mapConcurrently<T, U>(
	inputs: T[],
	concurrency: number,
	mapper: (input: T, index: number) => Promise<U>,
): Promise<U[]> {
	if (inputs.length === 0) return [];
	const workers = Math.max(1, Math.min(concurrency, inputs.length));
	const output = new Array<U>(inputs.length);
	let cursor = 0;
	await Promise.all(
		Array.from({ length: workers }, async () => {
			while (true) {
				const index = cursor;
				cursor += 1;
				if (index >= inputs.length) return;
				output[index] = await mapper(inputs[index], index);
			}
		}),
	);
	return output;
}

async function resolveTokenMetadataCached(
	tokenId: string,
	cache: Map<string, Promise<NearFtMetadata | null>>,
	params: {
		network: string;
		rpcUrl?: string;
	},
): Promise<NearFtMetadata | null> {
	const normalized = tokenId.toLowerCase();
	if (!cache.has(normalized)) {
		cache.set(
			normalized,
			queryFtMetadata({
				ftContractId: normalized,
				network: params.network,
				rpcUrl: params.rpcUrl,
			}),
		);
	}
	const metadataPromise = cache.get(normalized);
	if (!metadataPromise) return null;
	return await metadataPromise;
}

export function createNearReadTools() {
	return [
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getBalance`,
			label: "NEAR Get Balance",
			description: "Get native NEAR balance (available + locked).",
			parameters: Type.Object({
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = resolveNearAccountId(params.accountId, network);
				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);

				const account = await queryViewAccount({
					accountId,
					network,
					rpcUrl: params.rpcUrl,
				});
				const amount = parseUnsignedBigInt(account.amount, "amount");
				const locked = parseUnsignedBigInt(account.locked, "locked");
				const available = amount > locked ? amount - locked : 0n;

				const lines = [
					`Balance: ${formatNearAmount(amount, 6)} NEAR (${amount.toString()} yoctoNEAR)`,
					`Available: ${formatNearAmount(available, 6)} NEAR`,
				];
				if (locked > 0n) {
					lines.push(
						`Locked: ${formatNearAmount(locked, 6)} NEAR (${locked.toString()} yoctoNEAR)`,
					);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						accountId,
						availableNear: formatNearAmount(available, 8),
						availableYoctoNear: available.toString(),
						blockHash: account.block_hash,
						blockHeight: account.block_height,
						lockedNear: formatNearAmount(locked, 8),
						lockedYoctoNear: locked.toString(),
						network,
						rpcEndpoint: endpoint,
						totalNear: formatNearAmount(amount, 8),
						totalYoctoNear: amount.toString(),
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getAccount`,
			label: "NEAR Get Account",
			description: "Get NEAR account state via view_account.",
			parameters: Type.Object({
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = resolveNearAccountId(params.accountId, network);
				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
				const account = await queryViewAccount({
					accountId,
					network,
					rpcUrl: params.rpcUrl,
				});

				const amount = parseUnsignedBigInt(account.amount, "amount");
				const locked = parseUnsignedBigInt(account.locked, "locked");
				const available = amount > locked ? amount - locked : 0n;

				const text = [
					`Account: ${accountId}`,
					`Total: ${formatNearAmount(amount, 6)} NEAR`,
					`Available: ${formatNearAmount(available, 6)} NEAR`,
					`Storage usage: ${account.storage_usage}`,
					`Code hash: ${account.code_hash}`,
				].join("\n");

				return {
					content: [{ type: "text", text }],
					details: {
						accountId,
						accountState: account,
						availableYoctoNear: available.toString(),
						network,
						rpcEndpoint: endpoint,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getFtBalance`,
			label: "NEAR Get FT Balance",
			description:
				"Get fungible-token balance for an account from a specific FT contract (NEP-141).",
			parameters: Type.Object({
				ftContractId: Type.String({
					description:
						"FT contract account id (for example usdt.tether-token.near)",
				}),
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = resolveNearAccountId(params.accountId, network);
				const ftContractId = params.ftContractId.trim();
				if (!ftContractId) {
					throw new Error("ftContractId is required");
				}

				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
				const ftBalance = await queryFtBalance({
					accountId,
					ftContractId,
					network,
					rpcUrl: params.rpcUrl,
				});
				const metadata = await queryFtMetadata({
					ftContractId,
					network,
					rpcUrl: params.rpcUrl,
				});

				const decimals =
					typeof metadata?.decimals === "number" ? metadata.decimals : null;
				const symbol =
					typeof metadata?.symbol === "string" && metadata.symbol.trim()
						? metadata.symbol.trim()
						: shortAccountId(ftContractId);
				const uiAmount =
					decimals === null
						? null
						: formatTokenAmount(ftBalance.rawBalance, decimals, 8);

				const text =
					uiAmount === null
						? `FT balance: ${ftBalance.rawBalance} raw (${symbol})`
						: `FT balance: ${uiAmount} ${symbol} (raw ${ftBalance.rawBalance})`;

				return {
					content: [{ type: "text", text }],
					details: {
						accountId,
						blockHash: ftBalance.blockHash,
						blockHeight: ftBalance.blockHeight,
						decimals,
						ftContractId,
						metadata: metadata ?? null,
						network,
						rawBalance: ftBalance.rawBalance,
						rpcEndpoint: endpoint,
						symbol,
						uiAmount,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getPortfolio`,
			label: "NEAR Get Portfolio",
			description:
				"Get portfolio snapshot for native NEAR and selected NEP-141 tokens.",
			parameters: Type.Object({
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				ftContractIds: Type.Optional(
					Type.Array(
						Type.String({
							description:
								"Optional FT contract ids to query. If omitted, use defaults/env list.",
						}),
					),
				),
				includeZeroBalances: Type.Optional(
					Type.Boolean({
						description: "Include zero FT balances (default false).",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = resolveNearAccountId(params.accountId, network);
				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
				const includeZero = params.includeZeroBalances === true;
				const ftContractIds = resolvePortfolioFtContracts({
					network,
					ftContractIds: params.ftContractIds,
				});

				const account = await queryViewAccount({
					accountId,
					network,
					rpcUrl: params.rpcUrl,
				});
				const totalYoctoNear = parseUnsignedBigInt(account.amount, "amount");
				const lockedYoctoNear = parseUnsignedBigInt(account.locked, "locked");
				const availableYoctoNear =
					totalYoctoNear > lockedYoctoNear
						? totalYoctoNear - lockedYoctoNear
						: 0n;

				const assets: NearPortfolioAsset[] = [
					{
						kind: "native",
						symbol: "NEAR",
						contractId: null,
						rawAmount: totalYoctoNear.toString(),
						uiAmount: formatNearAmount(totalYoctoNear, 8),
						decimals: 24,
					},
				];
				const failures: NearPortfolioFailure[] = [];

				for (const ftContractId of ftContractIds) {
					try {
						const ftBalance = await queryFtBalance({
							accountId,
							ftContractId,
							network,
							rpcUrl: params.rpcUrl,
						});
						const rawBalance = parseUnsignedBigInt(
							ftBalance.rawBalance,
							"ft_balance_of",
						);
						if (!includeZero && rawBalance === 0n) {
							continue;
						}

						const metadata = await queryFtMetadata({
							ftContractId,
							network,
							rpcUrl: params.rpcUrl,
						});
						const decimals =
							typeof metadata?.decimals === "number" ? metadata.decimals : null;
						const symbol =
							typeof metadata?.symbol === "string" && metadata.symbol.trim()
								? metadata.symbol.trim()
								: shortAccountId(ftContractId);
						const uiAmount =
							decimals == null
								? null
								: formatTokenAmount(ftBalance.rawBalance, decimals, 8);
						assets.push({
							kind: "ft",
							symbol,
							contractId: ftContractId,
							rawAmount: ftBalance.rawBalance,
							uiAmount,
							decimals,
						});
					} catch (error) {
						failures.push({
							ftContractId,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}

				const lines = [
					`Portfolio: ${assets.length} assets (account ${accountId})`,
					`NEAR: ${formatNearAmount(totalYoctoNear, 8)} (available ${formatNearAmount(availableYoctoNear, 8)}, locked ${formatNearAmount(lockedYoctoNear, 8)})`,
				];
				for (const asset of assets) {
					if (asset.kind === "native") continue;
					const amountText =
						asset.uiAmount == null
							? `${asset.rawAmount} raw`
							: `${asset.uiAmount} (raw ${asset.rawAmount})`;
					lines.push(
						`${asset.symbol}: ${amountText} on ${asset.contractId ?? "unknown"}`,
					);
				}
				if (failures.length > 0) {
					lines.push(
						`Skipped ${failures.length} token(s) due to query errors.`,
					);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						accountId,
						assets,
						blockHash: account.block_hash,
						blockHeight: account.block_height,
						failures,
						network,
						rpcEndpoint: endpoint,
						ftContractsQueried: ftContractIds,
						includeZeroBalances: includeZero,
						totalYoctoNear: totalYoctoNear.toString(),
						availableYoctoNear: availableYoctoNear.toString(),
						lockedYoctoNear: lockedYoctoNear.toString(),
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getRefDeposits`,
			label: "NEAR Ref Deposits",
			description:
				"Get deposited token balances on Ref exchange for an account.",
			parameters: Type.Object({
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				refContractId: Type.Optional(
					Type.String({
						description:
							"Ref exchange contract id override (default mainnet v2.ref-finance.near).",
					}),
				),
				tokenIds: Type.Optional(
					Type.Array(
						Type.String({
							description:
								"Optional token contract ids to filter (case-insensitive).",
						}),
					),
				),
				includeZeroBalances: Type.Optional(
					Type.Boolean({
						description: "Include zero deposits (default false).",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = resolveNearAccountId(params.accountId, network);
				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
				const refContractId = getRefContractId(network, params.refContractId);
				const includeZero = params.includeZeroBalances === true;
				const tokenFilters = new Set(normalizeTokenFilterList(params.tokenIds));
				const metadataCache = new Map<string, Promise<NearFtMetadata | null>>();
				const deposits = await queryRefDeposits({
					accountId,
					network,
					refContractId,
					rpcUrl: params.rpcUrl,
				});

				const assets: NearRefDepositAsset[] = [];
				const failures: NearRefDepositFailure[] = [];
				const sortedEntries = Object.entries(deposits).sort((left, right) => {
					const leftValue = parseUnsignedBigInt(
						left[1],
						`deposits[${left[0]}]`,
					);
					const rightValue = parseUnsignedBigInt(
						right[1],
						`deposits[${right[0]}]`,
					);
					if (leftValue === rightValue) return left[0].localeCompare(right[0]);
					return leftValue > rightValue ? -1 : 1;
				});
				for (const [tokenId, rawAmount] of sortedEntries) {
					const rawAmountValue = parseUnsignedBigInt(
						rawAmount,
						`deposits[${tokenId}]`,
					);
					if (tokenFilters.size > 0 && !tokenFilters.has(tokenId)) {
						continue;
					}
					if (!includeZero && rawAmountValue === 0n) {
						continue;
					}
					try {
						const metadata = await resolveTokenMetadataCached(
							tokenId,
							metadataCache,
							{
								network,
								rpcUrl: params.rpcUrl,
							},
						);
						const decimals =
							typeof metadata?.decimals === "number" ? metadata.decimals : null;
						const symbol =
							typeof metadata?.symbol === "string" && metadata.symbol.trim()
								? metadata.symbol.trim()
								: shortAccountId(tokenId);
						assets.push({
							tokenId,
							symbol,
							rawAmount: rawAmountValue.toString(),
							uiAmount: formatRefAssetAmount({
								rawAmount: rawAmountValue.toString(),
								decimals,
							}),
							decimals,
							metadata: metadata ?? null,
						});
					} catch (error) {
						failures.push({
							tokenId,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}

				const lines = [
					`Ref deposits: ${assets.length} token(s) on ${refContractId} (account ${accountId})`,
				];
				if (assets.length === 0) {
					lines.push("No deposited token balances found.");
				}
				for (const asset of assets) {
					lines.push(resolveRefAssetText(asset));
				}
				if (failures.length > 0) {
					lines.push(
						`Skipped ${failures.length} token(s) due to metadata/query errors.`,
					);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						accountId,
						network,
						rpcEndpoint: endpoint,
						refContractId,
						assets,
						failures,
						tokenFilters: [...tokenFilters],
						includeZeroBalances: includeZero,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getRefLpPositions`,
			label: "NEAR Ref LP Positions",
			description:
				"Get Ref LP share positions for an account (by explicit pool ids or scanned pools).",
			parameters: Type.Object({
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				poolId: Type.Optional(
					Type.Union([Type.Number(), Type.String()], {
						description: "Optional single pool id.",
					}),
				),
				poolIds: Type.Optional(
					Type.Array(
						Type.Union([Type.Number(), Type.String()], {
							description: "Optional pool ids.",
						}),
					),
				),
				maxPools: Type.Optional(
					Type.Number({
						description:
							"When poolId/poolIds are omitted, scan up to this many pools (default 200).",
					}),
				),
				includeZeroBalances: Type.Optional(
					Type.Boolean({
						description:
							"Include zero-share pools in the response (default false).",
					}),
				),
				refContractId: Type.Optional(
					Type.String({
						description:
							"Ref exchange contract id override (default mainnet v2.ref-finance.near).",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const accountId = resolveNearAccountId(params.accountId, network);
				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
				const refContractId = getRefContractId(network, params.refContractId);
				const includeZero = params.includeZeroBalances === true;
				const maxPools = parseMaxPools(params.maxPools);
				const poolIds = dedupeStrings(
					[
						parseOptionalPoolId(params.poolId),
						...parsePoolIdList(params.poolIds),
					]
						.filter((value): value is number => value != null)
						.map((value) => value.toString()),
				).map((value) => Number(value));
				const metadataCache = new Map<string, Promise<NearFtMetadata | null>>();

				let scannedPoolCount = 0;
				const pools: NearRefPoolView[] = [];

				if (poolIds.length > 0) {
					const resolvedPools = await Promise.all(
						poolIds.map(async (poolId) => {
							const pool = await fetchRefPoolById({
								network,
								rpcUrl: params.rpcUrl,
								refContractId,
								poolId,
							});
							return {
								id: pool.id,
								tokenIds: pool.token_account_ids.map((tokenId) =>
									tokenId.toLowerCase(),
								),
								poolKind: pool.pool_kind,
							} satisfies NearRefPoolView;
						}),
					);
					pools.push(...resolvedPools);
					scannedPoolCount = resolvedPools.length;
				} else {
					let fromIndex = 0;
					while (pools.length < maxPools) {
						const pageLimit = Math.min(100, maxPools - pools.length);
						const page = await queryRefPoolsPage({
							network,
							refContractId,
							fromIndex,
							limit: pageLimit,
							rpcUrl: params.rpcUrl,
						});
						if (page.rawCount === 0) break;
						pools.push(...page.pools);
						scannedPoolCount += page.rawCount;
						if (page.rawCount < pageLimit) break;
						fromIndex += page.rawCount;
					}
					if (pools.length > maxPools) {
						pools.length = maxPools;
					}
				}

				const shareResults = await mapConcurrently(
					pools,
					8,
					async (
						pool,
					): Promise<
						| {
								status: "ok";
								position: NearRefLpPosition;
								sharesRawValue: bigint;
						  }
						| {
								status: "error";
								failure: NearRefLpFailure;
						  }
					> => {
						try {
							const sharesRaw = await queryRefPoolShares({
								accountId,
								network,
								refContractId,
								poolId: pool.id,
								rpcUrl: params.rpcUrl,
							});
							const sharesRawValue = parseUnsignedBigInt(
								sharesRaw,
								`poolShares[${pool.id}]`,
							);
							if (!includeZero && sharesRawValue === 0n) {
								return {
									status: "ok",
									position: {
										poolId: pool.id,
										poolKind: pool.poolKind,
										tokenIds: pool.tokenIds,
										tokenSymbols: [],
										pairLabel: pool.tokenIds.join("/"),
										sharesRaw: sharesRawValue.toString(),
										removeHint: `在 Ref 移除 LP，pool ${pool.id}，shares ${sharesRawValue.toString()}，minA 0，minB 0，先模拟`,
									},
									sharesRawValue,
								};
							}

							const tokenSymbols = await Promise.all(
								pool.tokenIds.map(async (tokenId) => {
									const metadata = await resolveTokenMetadataCached(
										tokenId,
										metadataCache,
										{
											network,
											rpcUrl: params.rpcUrl,
										},
									);
									return typeof metadata?.symbol === "string" &&
										metadata.symbol.trim()
										? metadata.symbol.trim()
										: shortAccountId(tokenId);
								}),
							);
							const pairLabel = tokenSymbols.join("/");
							return {
								status: "ok",
								position: {
									poolId: pool.id,
									poolKind: pool.poolKind,
									tokenIds: pool.tokenIds,
									tokenSymbols,
									pairLabel,
									sharesRaw: sharesRawValue.toString(),
									removeHint: `在 Ref 移除 LP，pool ${pool.id}，shares ${sharesRawValue.toString()}，minA 0，minB 0，先模拟`,
								},
								sharesRawValue,
							};
						} catch (error) {
							return {
								status: "error",
								failure: {
									poolId: pool.id,
									error: error instanceof Error ? error.message : String(error),
								},
							};
						}
					},
				);

				const failures: NearRefLpFailure[] = [];
				const positions: NearRefLpPosition[] = [];
				for (const entry of shareResults) {
					if (entry.status === "error") {
						failures.push(entry.failure);
						continue;
					}
					if (!includeZero && entry.sharesRawValue === 0n) {
						continue;
					}
					positions.push(entry.position);
				}
				positions.sort((left, right) => {
					const leftShares = parseUnsignedBigInt(
						left.sharesRaw,
						`shares[${left.poolId}]`,
					);
					const rightShares = parseUnsignedBigInt(
						right.sharesRaw,
						`shares[${right.poolId}]`,
					);
					if (leftShares === rightShares) return left.poolId - right.poolId;
					return leftShares > rightShares ? -1 : 1;
				});

				const lines = [
					`Ref LP positions: ${positions.length} pool(s) on ${refContractId} (account ${accountId})`,
					`Scanned pools: ${scannedPoolCount}${poolIds.length > 0 ? " (explicit)" : ""}`,
				];
				if (positions.length === 0) {
					lines.push("No LP shares found in scanned pools.");
				}
				for (const [index, position] of positions.entries()) {
					const block = resolveRefPoolPositionText(position);
					lines.push(`${index + 1}. ${block[0]}`);
					lines.push(`   ${block[1]}`);
					lines.push(`   ${block[2]}`);
				}
				if (failures.length > 0) {
					lines.push(`Skipped ${failures.length} pool(s) due to query errors.`);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						accountId,
						network,
						rpcEndpoint: endpoint,
						refContractId,
						poolIdsExplicit: poolIds.length > 0 ? poolIds : undefined,
						maxPoolsScanned: maxPools,
						scannedPoolCount,
						includeZeroBalances: includeZero,
						positions,
						failures,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getSwapQuoteRef`,
			label: "NEAR Ref Swap Quote",
			description:
				"Get swap quote from Ref (Rhea route) using direct simple pool best-route or explicit pool.",
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
				poolId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				slippageBps: Type.Optional(
					Type.Number({ description: "Slippage in bps (default 50)" }),
				),
				refContractId: Type.Optional(
					Type.String({
						description:
							"Ref exchange contract id override (default mainnet v2.ref-finance.near)",
					}),
				),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override NEAR JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const endpoint = getNearRpcEndpoint(network, params.rpcUrl);
				const tokenInId = params.tokenInId.trim();
				const tokenOutId = params.tokenOutId.trim();
				if (!tokenInId || !tokenOutId) {
					throw new Error("tokenInId and tokenOutId are required");
				}
				const quote = await getRefSwapQuote({
					network,
					rpcUrl: params.rpcUrl,
					refContractId: params.refContractId,
					tokenInId,
					tokenOutId,
					amountInRaw: params.amountInRaw,
					poolId: parseOptionalPoolId(params.poolId),
					slippageBps: params.slippageBps,
				});
				const slippageBps =
					typeof params.slippageBps === "number" &&
					Number.isFinite(params.slippageBps)
						? Math.max(0, Math.floor(params.slippageBps))
						: 50;
				const text = [
					`Ref quote: ${quote.amountInRaw} raw ${tokenInId} -> ${quote.amountOutRaw} raw ${tokenOutId}`,
					`Min output (${slippageBps} bps): ${quote.minAmountOutRaw} raw`,
					`Pool: ${quote.poolId} (${quote.source})`,
					`Contract: ${quote.refContractId}`,
				].join("\n");
				return {
					content: [{ type: "text", text }],
					details: {
						network,
						rpcEndpoint: endpoint,
						quote,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getIntentsTokens`,
			label: "NEAR Intents Tokens",
			description:
				"List supported assets from NEAR Intents 1Click API (/v0/tokens) with optional filters.",
			parameters: Type.Object({
				apiBaseUrl: Type.Optional(
					Type.String({
						description:
							"NEAR Intents API base URL override (default https://1click.chaindefuser.com)",
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
						description:
							"Optional bearer JWT for authenticated endpoints (fallback env NEAR_INTENTS_JWT).",
					}),
				),
				blockchain: Type.Optional(
					Type.String({
						description: "Filter by blockchain (e.g. near, sol, eth).",
					}),
				),
				symbol: Type.Optional(
					Type.String({ description: "Filter by token symbol (e.g. USDC)." }),
				),
				assetId: Type.Optional(
					Type.String({ description: "Filter by exact assetId." }),
				),
				limit: Type.Optional(
					Type.Number({
						description: "Max number of rows to show (default 20, max 200).",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const baseUrl = resolveNearIntentsApiBaseUrl(params.apiBaseUrl);
				const authHeaders = resolveNearIntentsHeaders({
					apiKey: params.apiKey,
					jwt: params.jwt,
				});
				const response = await fetchNearIntentsJson<NearIntentsToken[]>({
					baseUrl,
					path: "/v0/tokens",
					method: "GET",
					headers: authHeaders,
				});
				const tokens = normalizeNearIntentsTokens(response.payload);
				const blockchainFilter = params.blockchain?.trim().toLowerCase() || "";
				const symbolFilter = params.symbol?.trim().toUpperCase() || "";
				const assetIdFilter = params.assetId?.trim().toLowerCase() || "";
				const limit = parseIntentsListLimit(params.limit);
				const filtered = tokens
					.filter((token) =>
						blockchainFilter
							? token.blockchain.toLowerCase() === blockchainFilter
							: true,
					)
					.filter((token) =>
						symbolFilter ? token.symbol.toUpperCase() === symbolFilter : true,
					)
					.filter((token) =>
						assetIdFilter
							? token.assetId.toLowerCase() === assetIdFilter
							: true,
					)
					.sort((left, right) => {
						if (left.price === right.price) {
							return left.assetId.localeCompare(right.assetId);
						}
						return left.price > right.price ? -1 : 1;
					});
				const selected = filtered.slice(0, limit);
				const lines = [
					`Intents tokens: ${selected.length} shown / ${filtered.length} matched (total ${tokens.length})`,
				];
				if (selected.length === 0) {
					lines.push("No token matched current filters.");
				}
				for (const [index, token] of selected.entries()) {
					const priceText = Number.isFinite(token.price)
						? token.price.toLocaleString(undefined, {
								maximumFractionDigits: 8,
							})
						: String(token.price);
					lines.push(
						`${index + 1}. ${token.symbol} [${token.blockchain}] price=$${priceText} assetId=${token.assetId}`,
					);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						apiBaseUrl: baseUrl,
						endpoint: response.url,
						httpStatus: response.status,
						total: tokens.length,
						matched: filtered.length,
						shown: selected.length,
						filters: {
							blockchain: blockchainFilter || null,
							symbol: symbolFilter || null,
							assetId: assetIdFilter || null,
						},
						tokens: selected,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getIntentsQuote`,
			label: "NEAR Intents Quote",
			description:
				"Get NEAR Intents 1Click quote (/v0/quote). Defaults to dry-run for safe analysis.",
			parameters: Type.Object({
				originAsset: Type.String({
					description:
						"Origin assetId (e.g. nep141:wrap.near) or symbol (e.g. wNEAR).",
				}),
				destinationAsset: Type.String({
					description:
						"Destination assetId or symbol (if symbol, resolves with blockchainHint default near).",
				}),
				amount: Type.String({
					description: "Amount in smallest unit (integer string).",
				}),
				accountId: Type.Optional(
					Type.String({
						description:
							"Optional account used to default recipient/refundTo when they are omitted.",
					}),
				),
				dry: Type.Optional(
					Type.Boolean({
						description: "Dry-run quote only (default true).",
					}),
				),
				swapType: Type.Optional(
					Type.Union([
						Type.Literal("EXACT_INPUT"),
						Type.Literal("EXACT_OUTPUT"),
						Type.Literal("FLEX_INPUT"),
						Type.Literal("ANY_INPUT"),
					]),
				),
				slippageTolerance: Type.Optional(
					Type.Number({
						description:
							"Slippage tolerance in bps (default 100, allowed 0..5000).",
					}),
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
				recipient: Type.Optional(Type.String()),
				refundTo: Type.Optional(Type.String()),
				deadline: Type.Optional(
					Type.String({
						description:
							"ISO datetime string; defaults to now + 20 minutes if omitted.",
					}),
				),
				quoteWaitingTimeMs: Type.Optional(Type.Number()),
				blockchainHint: Type.Optional(
					Type.String({
						description:
							"When origin/destination uses symbol, prefer this blockchain (default near).",
					}),
				),
				network: nearNetworkSchema(),
				apiBaseUrl: Type.Optional(
					Type.String({
						description:
							"NEAR Intents API base URL override (default https://1click.chaindefuser.com)",
					}),
				),
				apiKey: Type.Optional(Type.String()),
				jwt: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const baseUrl = resolveNearIntentsApiBaseUrl(params.apiBaseUrl);
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
				const blockchainHint = params.blockchainHint?.trim().toLowerCase();
				const originAssetId = resolveNearIntentsAssetId({
					assetInput: params.originAsset,
					tokens,
					preferredBlockchain: blockchainHint,
					fieldName: "originAsset",
				});
				const destinationAssetId = resolveNearIntentsAssetId({
					assetInput: params.destinationAsset,
					tokens,
					preferredBlockchain: blockchainHint,
					fieldName: "destinationAsset",
				});
				if (originAssetId === destinationAssetId) {
					throw new Error("originAsset and destinationAsset must be different");
				}
				const amount = parseUnsignedBigInt(params.amount, "amount").toString();
				const fallbackAccountId = resolveNearAccountId(
					params.accountId,
					network,
				);
				const recipient = params.recipient?.trim() || fallbackAccountId;
				const refundTo = params.refundTo?.trim() || recipient;
				const quoteWaitingTimeMs = parseIntentsQuoteWaitingTimeMs(
					params.quoteWaitingTimeMs,
				);
				const quoteRequest: NearIntentsQuoteRequest = {
					dry: params.dry !== false,
					swapType: params.swapType ?? "EXACT_INPUT",
					slippageTolerance: parseIntentsSlippageTolerance(
						params.slippageTolerance,
					),
					originAsset: originAssetId,
					depositType: params.depositType ?? "ORIGIN_CHAIN",
					destinationAsset: destinationAssetId,
					amount,
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
				const originToken =
					resolveNearIntentsTokenByAssetId(originAssetId, tokens) ?? null;
				const destinationToken =
					resolveNearIntentsTokenByAssetId(destinationAssetId, tokens) ?? null;
				const originSymbol = originToken?.symbol || originAssetId;
				const destinationSymbol =
					destinationToken?.symbol || destinationAssetId;
				const lines = [
					`Intents quote (${quoteRequest.dry ? "dry" : "live"}): ${quoteResponse.payload.quote.amountInFormatted} ${originSymbol} -> ${quoteResponse.payload.quote.amountOutFormatted} ${destinationSymbol}`,
					`Min output: ${quoteResponse.payload.quote.minAmountOut} raw`,
					`Estimated time: ${quoteResponse.payload.quote.timeEstimate}s`,
					`CorrelationId: ${quoteResponse.payload.correlationId}`,
				];
				if (quoteResponse.payload.quote.depositAddress) {
					lines.push(
						`Deposit address: ${quoteResponse.payload.quote.depositAddress}`,
					);
				}
				if (quoteResponse.payload.quote.depositMemo) {
					lines.push(
						`Deposit memo: ${quoteResponse.payload.quote.depositMemo}`,
					);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						apiBaseUrl: baseUrl,
						endpoint: quoteResponse.url,
						httpStatus: quoteResponse.status,
						network,
						originAssetId,
						destinationAssetId,
						originSymbol,
						destinationSymbol,
						request: quoteRequest,
						quoteResponse: quoteResponse.payload,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getIntentsExplorerTransactions`,
			label: "NEAR Intents Explorer Transactions",
			description:
				"List NEAR Intents Explorer transactions (/api/v0/transactions-pages or /api/v0/transactions cursor mode). Requires JWT auth.",
			parameters: Type.Object({
				mode: Type.Optional(
					Type.Union([Type.Literal("pages"), Type.Literal("cursor")], {
						description:
							"Pagination mode: pages uses /transactions-pages; cursor uses /transactions.",
					}),
				),
				quickView: Type.Optional(
					Type.Union([Type.Literal("abnormal")], {
						description:
							"Quick filter preset. 'abnormal' => FAILED/REFUNDED/INCOMPLETE_DEPOSIT.",
					}),
				),
				page: Type.Optional(
					Type.Number({
						description: "Page number (default 1).",
					}),
				),
				perPage: Type.Optional(
					Type.Number({
						description: "Rows per page (default 20, max 1000).",
					}),
				),
				numberOfTransactions: Type.Optional(
					Type.Number({
						description:
							"Cursor mode limit for /transactions (default 50, max 1000).",
					}),
				),
				lastDepositAddressAndMemo: Type.Optional(
					Type.String({
						description:
							"Cursor mode cursor key from previous page (depositAddressAndMemo).",
					}),
				),
				direction: Type.Optional(
					Type.Union([Type.Literal("next"), Type.Literal("prev")], {
						description:
							"Cursor mode direction: next=older records, prev=newer records.",
					}),
				),
				search: Type.Optional(
					Type.String({
						description:
							"Search by deposit address, recipient, sender, or tx hash.",
					}),
				),
				fromChainId: Type.Optional(
					Type.String({
						description: "Origin chain filter (e.g. near/eth/base/sol/sui).",
					}),
				),
				toChainId: Type.Optional(
					Type.String({
						description:
							"Destination chain filter (e.g. near/eth/base/sol/sui).",
					}),
				),
				fromTokenId: Type.Optional(
					Type.String({
						description:
							"Origin token filter (asset id); overrides fromChainId at API side.",
					}),
				),
				toTokenId: Type.Optional(
					Type.String({
						description:
							"Destination token filter (asset id); overrides toChainId/fromTokenId at API side.",
					}),
				),
				referral: Type.Optional(Type.String()),
				affiliate: Type.Optional(Type.String()),
				statuses: Type.Optional(
					Type.Array(
						Type.String({
							description:
								"Status values: FAILED, INCOMPLETE_DEPOSIT, PENDING_DEPOSIT, PROCESSING, REFUNDED, SUCCESS. Overrides quickView default when explicitly provided.",
						}),
					),
				),
				showTestTxs: Type.Optional(Type.Boolean()),
				minUsdPrice: Type.Optional(
					Type.Number({
						description: "Min USD filter (>= 0).",
					}),
				),
				maxUsdPrice: Type.Optional(
					Type.Number({
						description: "Max USD filter (>= 0).",
					}),
				),
				startTimestamp: Type.Optional(
					Type.String({
						description:
							"Start timestamp ISO string (inclusive filter window).",
					}),
				),
				endTimestamp: Type.Optional(
					Type.String({
						description: "End timestamp ISO string (non-inclusive filter).",
					}),
				),
				apiBaseUrl: Type.Optional(
					Type.String({
						description:
							"Explorer API base URL override (default https://explorer.near-intents.org).",
					}),
				),
				jwt: Type.Optional(
					Type.String({
						description:
							"Bearer JWT for explorer API (fallback env NEAR_INTENTS_EXPLORER_JWT / NEAR_INTENTS_JWT).",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const baseUrl = resolveNearIntentsExplorerApiBaseUrl(params.apiBaseUrl);
				const authHeaders = resolveNearIntentsExplorerHeaders({
					jwt: params.jwt,
				});
				const mode = params.mode === "cursor" ? "cursor" : "pages";
				const quickView = params.quickView === "abnormal" ? "abnormal" : null;
				const page = parseOptionalPositiveInt(params.page, "page");
				const perPage = parseIntentsExplorerPerPage(params.perPage);
				const numberOfTransactions = parseIntentsExplorerNumberOfTransactions(
					params.numberOfTransactions,
				);
				const direction = params.direction === "prev" ? "prev" : "next";
				const lastDepositAddressAndMemo =
					params.lastDepositAddressAndMemo?.trim() || undefined;
				const startTimestamp = parseOptionalIsoDatetime(
					params.startTimestamp,
					"startTimestamp",
				);
				const endTimestamp = parseOptionalIsoDatetime(
					params.endTimestamp,
					"endTimestamp",
				);
				if (startTimestamp && endTimestamp && startTimestamp >= endTimestamp) {
					throw new Error("startTimestamp must be earlier than endTimestamp");
				}
				const minUsdPrice = parseOptionalNonNegativeNumber(
					params.minUsdPrice,
					"minUsdPrice",
				);
				const maxUsdPrice = parseOptionalNonNegativeNumber(
					params.maxUsdPrice,
					"maxUsdPrice",
				);
				if (
					minUsdPrice != null &&
					maxUsdPrice != null &&
					minUsdPrice > maxUsdPrice
				) {
					throw new Error("minUsdPrice must be <= maxUsdPrice");
				}
				const effectiveStatusesInput =
					Array.isArray(params.statuses) && params.statuses.length > 0
						? params.statuses
						: quickView === "abnormal"
							? ["FAILED", "REFUNDED", "INCOMPLETE_DEPOSIT"]
							: undefined;
				const statuses = parseIntentsExplorerStatuses(effectiveStatusesInput);
				const fromChainId = parseOptionalNearIntentsChain(
					params.fromChainId,
					"fromChainId",
				);
				const toChainId = parseOptionalNearIntentsChain(
					params.toChainId,
					"toChainId",
				);
				const baseQuery = {
					search: params.search?.trim() || undefined,
					fromChainId,
					fromTokenId: params.fromTokenId?.trim() || undefined,
					toChainId,
					toTokenId: params.toTokenId?.trim() || undefined,
					referral: params.referral?.trim() || undefined,
					affiliate: params.affiliate?.trim() || undefined,
					statuses,
					showTestTxs:
						typeof params.showTestTxs === "boolean"
							? String(params.showTestTxs)
							: undefined,
					minUsdPrice: minUsdPrice != null ? String(minUsdPrice) : undefined,
					maxUsdPrice: maxUsdPrice != null ? String(maxUsdPrice) : undefined,
					startTimestamp,
					endTimestamp,
				};
				const response = await fetchNearIntentsJson<unknown>({
					baseUrl,
					path:
						mode === "cursor"
							? "/api/v0/transactions"
							: "/api/v0/transactions-pages",
					method: "GET",
					query:
						mode === "cursor"
							? {
									...baseQuery,
									numberOfTransactions: String(numberOfTransactions),
									lastDepositAddressAndMemo,
									direction,
								}
							: {
									...baseQuery,
									page: page != null ? String(page) : undefined,
									perPage: String(perPage),
								},
					headers: authHeaders,
				});
				const normalized = normalizeNearIntentsExplorerTransactions(
					response.payload,
				);
				const cursorOlder =
					normalized.data[normalized.data.length - 1]?.depositAddressAndMemo ??
					normalized.data[normalized.data.length - 1]?.depositAddress ??
					null;
				const cursorNewer =
					normalized.data[0]?.depositAddressAndMemo ??
					normalized.data[0]?.depositAddress ??
					null;
				const statusSummary = summarizeNearIntentsExplorerStatuses(
					normalized.data,
				);
				const totalInUsd = normalized.data.reduce((sum, tx) => {
					const value = parseOptionalFiniteNumber(tx.amountInUsd);
					return value == null ? sum : sum + value;
				}, 0);
				const totalOutUsd = normalized.data.reduce((sum, tx) => {
					const value = parseOptionalFiniteNumber(tx.amountOutUsd);
					return value == null ? sum : sum + value;
				}, 0);
				const hasUsdSummary = normalized.data.some(
					(tx) =>
						parseOptionalFiniteNumber(tx.amountInUsd) != null ||
						parseOptionalFiniteNumber(tx.amountOutUsd) != null,
				);
				const routeCounter = new Map<string, number>();
				for (const tx of normalized.data) {
					const routeLabel = `${formatNearIntentsExplorerAssetLabel(tx.originAsset)} -> ${formatNearIntentsExplorerAssetLabel(tx.destinationAsset)}`;
					routeCounter.set(routeLabel, (routeCounter.get(routeLabel) ?? 0) + 1);
				}
				const topRoutes = [...routeCounter.entries()]
					.sort((left, right) => {
						if (left[1] === right[1]) return left[0].localeCompare(right[0]);
						return right[1] - left[1];
					})
					.slice(0, 3)
					.map(([route, count]) => ({ route, count }));
				const lines = [
					mode === "cursor"
						? `Intents explorer txs: ${normalized.data.length} item(s) mode=cursor direction=${direction} limit=${numberOfTransactions}`
						: `Intents explorer txs: ${normalized.data.length} item(s) page=${normalized.page ?? page ?? 1}/${normalized.totalPages ?? "?"} total=${normalized.total ?? "unknown"}`,
				];
				if (Object.keys(statusSummary).length > 0) {
					lines.push(
						`Status summary: ${formatNearIntentsExplorerStatusSummary(statusSummary)}`,
					);
				}
				if (hasUsdSummary) {
					lines.push(
						`USD in/out: ${formatUsdApprox(totalInUsd) ?? "unknown"} / ${formatUsdApprox(totalOutUsd) ?? "unknown"}`,
					);
				}
				if (topRoutes.length > 0) {
					lines.push(
						`Top routes: ${topRoutes
							.map((entry) => `${entry.route} (${entry.count})`)
							.join(" | ")}`,
					);
				}
				if (quickView === "abnormal") {
					lines.push(
						"Quick view: abnormal (FAILED | REFUNDED | INCOMPLETE_DEPOSIT)",
					);
				}
				const activeFilters = [
					quickView ? `quickView=${quickView}` : null,
					fromChainId ? `fromChainId=${fromChainId}` : null,
					toChainId ? `toChainId=${toChainId}` : null,
					params.search?.trim() ? `search=${params.search.trim()}` : null,
					statuses ? `statuses=${statuses}` : null,
					minUsdPrice != null ? `minUsd=${minUsdPrice}` : null,
					maxUsdPrice != null ? `maxUsd=${maxUsdPrice}` : null,
				].filter((entry): entry is string => Boolean(entry));
				if (activeFilters.length > 0) {
					lines.push(`Filters: ${activeFilters.join(" | ")}`);
				}
				if (mode === "cursor") {
					lines.push(`Cursor(older): ${cursorOlder ?? "none"}`);
					lines.push(`Cursor(newer): ${cursorNewer ?? "none"}`);
				}
				const shown = normalized.data.slice(0, 10);
				for (const [index, tx] of shown.entries()) {
					const amountIn = tx.amountInFormatted ?? tx.amountIn ?? "unknown";
					const amountOut = tx.amountOutFormatted ?? tx.amountOut ?? "unknown";
					const outUsd = parseOptionalFiniteNumber(tx.amountOutUsd);
					const routeLabel = `${formatNearIntentsExplorerAssetLabel(tx.originAsset)} -> ${formatNearIntentsExplorerAssetLabel(tx.destinationAsset)}`;
					lines.push(
						`${index + 1}. [${tx.status ?? "UNKNOWN"}] ${amountIn} -> ${amountOut}${outUsd != null ? ` (${formatUsdApprox(outUsd)})` : ""}`,
					);
					lines.push(
						`   route=${routeLabel} recipient=${tx.recipient ? shortAccountId(tx.recipient) : "unknown"} time=${tx.createdAt ?? "unknown"}`,
					);
					lines.push(
						`   deposit=${tx.depositAddress ? shortAccountId(tx.depositAddress) : "unknown"}${tx.intentHashes ? ` intent=${shortAccountId(tx.intentHashes)}` : ""}`,
					);
					if (tx.refundReason) {
						lines.push(`   refundReason=${tx.refundReason}`);
					}
				}
				if (normalized.data.length > shown.length) {
					lines.push(
						`... ${normalized.data.length - shown.length} more tx(s) not shown`,
					);
				}
				if (normalized.data.length === 0) {
					lines.push("No transactions matched current filters.");
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						apiBaseUrl: baseUrl,
						endpoint: response.url,
						httpStatus: response.status,
						filters: {
							mode,
							quickView,
							page: mode === "pages" ? (page ?? 1) : null,
							perPage: mode === "pages" ? perPage : null,
							numberOfTransactions:
								mode === "cursor" ? numberOfTransactions : null,
							direction: mode === "cursor" ? direction : null,
							lastDepositAddressAndMemo:
								mode === "cursor" ? (lastDepositAddressAndMemo ?? null) : null,
							search: params.search?.trim() || null,
							fromChainId: fromChainId ?? null,
							toChainId: toChainId ?? null,
							fromTokenId: params.fromTokenId?.trim() || null,
							toTokenId: params.toTokenId?.trim() || null,
							referral: params.referral?.trim() || null,
							affiliate: params.affiliate?.trim() || null,
							statuses: statuses ?? null,
							showTestTxs:
								typeof params.showTestTxs === "boolean"
									? params.showTestTxs
									: null,
							minUsdPrice: minUsdPrice ?? null,
							maxUsdPrice: maxUsdPrice ?? null,
							startTimestamp: startTimestamp ?? null,
							endTimestamp: endTimestamp ?? null,
						},
						page: normalized.page,
						perPage: normalized.perPage,
						total: normalized.total,
						totalPages: normalized.totalPages,
						nextPage: normalized.nextPage,
						prevPage: normalized.prevPage,
						cursor: {
							older: cursorOlder,
							newer: cursorNewer,
						},
						summary: {
							statusCounts: statusSummary,
							totalAmountInUsd: hasUsdSummary ? totalInUsd : null,
							totalAmountOutUsd: hasUsdSummary ? totalOutUsd : null,
							topRoutes,
						},
						transactions: normalized.data,
						raw: response.payload,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getIntentsStatus`,
			label: "NEAR Intents Status",
			description:
				"Check NEAR Intents execution status by depositAddress or correlationId (/v0/status).",
			parameters: Type.Object({
				depositAddress: Type.Optional(
					Type.String({
						description: "Deposit address returned by 1Click quote response.",
					}),
				),
				depositMemo: Type.Optional(
					Type.String({
						description:
							"Optional deposit memo, required when quote returned memo mode.",
					}),
				),
				correlationId: Type.Optional(
					Type.String({
						description:
							"Optional correlationId returned by quote/submit response.",
					}),
				),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				jwt: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const depositAddress = params.depositAddress?.trim() || undefined;
				const correlationId = params.correlationId?.trim() || undefined;
				const depositMemo =
					depositAddress && params.depositMemo?.trim()
						? params.depositMemo.trim()
						: undefined;
				if (!depositAddress && !correlationId) {
					throw new Error(
						"near_getIntentsStatus requires depositAddress or correlationId",
					);
				}
				const baseUrl = resolveNearIntentsApiBaseUrl(params.apiBaseUrl);
				const authHeaders = resolveNearIntentsHeaders({
					apiKey: params.apiKey,
					jwt: params.jwt,
				});
				const statusResponse =
					await fetchNearIntentsJson<NearIntentsStatusResponse>({
						baseUrl,
						path: "/v0/status",
						method: "GET",
						query: {
							depositAddress,
							depositMemo,
							correlationId,
						},
						headers: authHeaders,
					});
				const payload = statusResponse.payload;
				const quoteSummary = payload.quoteResponse?.quote;
				const swapSummary = payload.swapDetails;
				const lines = [
					`Intents status: ${payload.status}`,
					depositAddress
						? `Deposit: ${depositAddress}${depositMemo ? ` (memo ${depositMemo})` : ""}`
						: `Correlation query: ${correlationId}`,
					`Updated: ${payload.updatedAt}`,
					`CorrelationId: ${payload.correlationId}`,
				];
				if (swapSummary?.amountInFormatted || swapSummary?.amountOutFormatted) {
					lines.push(
						`Settled: ${swapSummary.amountInFormatted ?? swapSummary.amountIn ?? "unknown"} -> ${swapSummary.amountOutFormatted ?? swapSummary.amountOut ?? "unknown"}`,
					);
				} else if (
					quoteSummary?.amountInFormatted ||
					quoteSummary?.amountOutFormatted
				) {
					lines.push(
						`Quoted: ${quoteSummary.amountInFormatted ?? quoteSummary.amountIn ?? "unknown"} -> ${quoteSummary.amountOutFormatted ?? quoteSummary.amountOut ?? "unknown"}`,
					);
				}
				if (
					swapSummary?.refundedAmountFormatted ||
					swapSummary?.refundedAmount
				) {
					lines.push(
						`Refunded: ${swapSummary.refundedAmountFormatted ?? swapSummary.refundedAmount}`,
					);
				}
				if (swapSummary?.refundReason) {
					lines.push(`Refund reason: ${swapSummary.refundReason}`);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						apiBaseUrl: baseUrl,
						endpoint: statusResponse.url,
						httpStatus: statusResponse.status,
						query: {
							depositAddress: depositAddress ?? null,
							depositMemo: depositMemo ?? null,
							correlationId: correlationId ?? null,
						},
						depositAddress: depositAddress ?? null,
						depositMemo: depositMemo ?? null,
						correlationId: correlationId ?? null,
						status: payload,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getIntentsAnyInputWithdrawals`,
			label: "NEAR Intents ANY_INPUT Withdrawals",
			description:
				"Get ANY_INPUT withdrawals from NEAR Intents 1Click (/v0/any-input/withdrawals).",
			parameters: Type.Object({
				depositAddress: Type.String({
					description: "ANY_INPUT deposit address.",
				}),
				depositMemo: Type.Optional(
					Type.String({
						description:
							"Optional memo returned by quote when deposit mode is MEMO.",
					}),
				),
				timestampFrom: Type.Optional(
					Type.String({
						description:
							"Optional lower-bound timestamp filter (ISO datetime string).",
					}),
				),
				page: Type.Optional(
					Type.Number({
						description: "Page number (default 1).",
					}),
				),
				limit: Type.Optional(
					Type.Number({
						description: "Records per page (max 50, default 50).",
					}),
				),
				sortOrder: Type.Optional(
					Type.Union([Type.Literal("asc"), Type.Literal("desc")]),
				),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				jwt: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const baseUrl = resolveNearIntentsApiBaseUrl(params.apiBaseUrl);
				const authHeaders = resolveNearIntentsHeaders({
					apiKey: params.apiKey,
					jwt: params.jwt,
				});
				const page = parseOptionalPositiveInt(params.page, "page");
				const limit = parseIntentsWithdrawalsLimit(params.limit);
				const timestampFrom = parseOptionalIsoDatetime(
					params.timestampFrom,
					"timestampFrom",
				);
				const response =
					await fetchNearIntentsJson<NearIntentsAnyInputWithdrawalsResponse>({
						baseUrl,
						path: "/v0/any-input/withdrawals",
						method: "GET",
						query: {
							depositAddress: params.depositAddress,
							depositMemo: params.depositMemo,
							timestampFrom,
							page: page != null ? String(page) : undefined,
							limit: String(limit),
							sortOrder: params.sortOrder,
						},
						headers: authHeaders,
					});
				const normalized = normalizeNearIntentsAnyInputWithdrawals(
					response.payload,
				);
				const lines = [
					`ANY_INPUT withdrawals: ${normalized.withdrawals.length} record(s)`,
					`Deposit: ${params.depositAddress}${params.depositMemo ? ` (memo ${params.depositMemo})` : ""}`,
				];
				if (normalized.asset) lines.push(`Asset: ${normalized.asset}`);
				if (normalized.recipient) {
					lines.push(`Recipient: ${normalized.recipient}`);
				}
				if (normalized.affiliateRecipient) {
					lines.push(`Affiliate: ${normalized.affiliateRecipient}`);
				}
				const shown = normalized.withdrawals.slice(0, 10);
				for (const [index, withdrawal] of shown.entries()) {
					lines.push(
						`${index + 1}. ${withdrawal.status ?? "UNKNOWN"} amount=${withdrawal.amountOutFormatted ?? withdrawal.amountOut ?? "unknown"} fee=${withdrawal.withdrawFeeFormatted ?? withdrawal.withdrawFee ?? "unknown"} time=${withdrawal.timestamp ?? "unknown"} hash=${withdrawal.hash ?? "unknown"}`,
					);
				}
				if (normalized.withdrawals.length > shown.length) {
					lines.push(
						`... ${normalized.withdrawals.length - shown.length} more record(s) not shown`,
					);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						apiBaseUrl: baseUrl,
						endpoint: response.url,
						httpStatus: response.status,
						depositAddress: params.depositAddress,
						depositMemo: params.depositMemo ?? null,
						filters: {
							timestampFrom: timestampFrom ?? null,
							page: page ?? 1,
							limit,
							sortOrder: params.sortOrder ?? null,
						},
						asset: normalized.asset,
						recipient: normalized.recipient,
						affiliateRecipient: normalized.affiliateRecipient,
						page: normalized.page,
						limit: normalized.limit,
						total: normalized.total,
						withdrawals: normalized.withdrawals,
						raw: response.payload,
					},
				};
			},
		}),
	];
}
