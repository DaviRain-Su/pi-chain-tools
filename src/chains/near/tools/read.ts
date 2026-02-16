import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	type BurrowAccountAllPositionsView,
	type BurrowAccountAssetView,
	type BurrowAccountPositionView,
	type BurrowAssetDetailedView,
	fetchBurrowAccountAllPositions,
	fetchBurrowAssetsPagedDetailed,
	fromBurrowInnerAmount,
	getBurrowContractId,
	parseBurrowExtraDecimals,
} from "../burrow.js";
import { fetchRefPoolById, getRefContractId, getRefSwapQuote } from "../ref.js";
import {
	NEAR_TOOL_PREFIX,
	callNearRpc,
	checkNearCliCredentials,
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
	discoveredSources?: Array<"refDeposits" | "burrowPositions">;
	priceUsd?: number | null;
	estimatedUsd?: number | null;
	valuationSourceAssetId?: string | null;
	valuationMatchBy?: "tokenId" | "symbol";
	valuationPriceUpdatedAt?: string | null;
};

type NearPortfolioFailure = {
	ftContractId: string;
	error: string;
};

type NearPortfolioDiscoveryFailure = {
	source: "ref_deposits" | "burrow_positions";
	error: string;
};

type NearPortfolioDiscoveryByRole = {
	refDeposits: string[];
	burrowSupplied: string[];
	burrowCollateral: string[];
	burrowBorrowed: string[];
};

type NearPortfolioExposureRow = {
	tokenId: string;
	symbol: string;
	walletRawAmount: string | null;
	walletUiAmount: string | null;
	walletEstimatedUsd: number | null;
	inWallet: boolean;
};

type NearPortfolioValuationAsset = {
	symbol: string;
	contractId: string | null;
	rawAmount: string;
	uiAmount: string | null;
	priceUsd: number;
	estimatedUsd: number | null;
	sourceAssetId: string;
	matchBy: "tokenId" | "symbol";
	priceUpdatedAt: string;
};

type NearPortfolioDefiAmountRow = {
	tokenId: string;
	symbol: string;
	rawAmount: string;
	uiAmount: string | null;
	estimatedUsd: number | null;
	walletRawAmount: string | null;
	walletUiAmount: string | null;
	walletEstimatedUsd: number | null;
};

type NearPortfolioValuationCacheEntry = {
	fetchedAtMs: number;
	endpoint: string;
	httpStatus: number;
	tokens: NearIntentsToken[];
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

type NearBurrowMarketRow = {
	tokenId: string;
	symbol: string;
	rawDecimals: number | null;
	extraDecimals: number;
	canDeposit: boolean;
	canWithdraw: boolean;
	canBorrow: boolean;
	canUseAsCollateral: boolean;
	suppliedInner: string;
	borrowedInner: string;
	suppliedRaw: string;
	borrowedRaw: string;
	suppliedUi: string | null;
	borrowedUi: string | null;
	supplyApr: string | null;
	borrowApr: string | null;
};

type NearStableYieldCandidate = {
	protocol: "Burrow";
	rank: number;
	tokenId: string;
	symbol: string;
	supplyApr: string | null;
	canDeposit: boolean;
	canWithdraw: boolean;
	suppliedUi: string | null;
	borrowedUi: string | null;
};

type NearStableYieldExecutionAction = {
	action: "supply" | "withdraw" | "hold";
	actionId: string;
	protocol: "Burrow";
	step: number;
	tokenId: string | null;
	symbol: string | null;
	asCollateral: boolean;
	allocationHint: "max-eligible" | "single-winner";
	rationale: string;
};

type NearStableYieldExecutionRiskProfile = {
	riskScore: number;
	riskBand: "low" | "medium" | "high";
	rationale: string;
};

type NearStableYieldExecutionPlan = {
	mode: "analysis-only";
	requiresAgentWallet: true;
	canAutoExecute: boolean;
	planId: string;
	proposalVersion: "v1";
	generatedAt: string;
	expiresAt: string;
	reasons: string[];
	guardrails: {
		maxProtocols: number;
		maxSlippageBps?: number;
		minimumAprDelta?: number;
		cooldownSeconds: number;
	};
	proposedActions: NearStableYieldExecutionAction[];
	recommendedApproach: "single-best-candidate";
	riskProfile: NearStableYieldExecutionRiskProfile;
};

type NearStableYieldPlan = {
	network: string;
	protocol: "Burrow";
	selected: NearStableYieldCandidate | null;
	topN: number;
	stableSymbols: string[];
	includeDisabled: boolean;
	status: "ready";
	generatedAt: string;
	planId: string;
	executionPlan: NearStableYieldExecutionPlan;
	candidates: NearStableYieldCandidate[];
	allocationHint: {
		tokenId: string;
		symbol: string;
		asCollateral: boolean;
	} | null;
};

type NearBurrowPositionAssetRow = {
	tokenId: string;
	symbol: string;
	rawDecimals: number | null;
	extraDecimals: number;
	balanceInner: string;
	shares: string;
	balanceRaw: string;
	balanceUi: string | null;
	apr: string | null;
};

type NearBurrowPositionView = {
	positionId: string;
	collateral: NearBurrowPositionAssetRow[];
	borrowed: NearBurrowPositionAssetRow[];
};

type NearBurrowRiskBand = "unknown" | "safe" | "warning" | "critical";

type NearBurrowRiskSummary = {
	level: "low" | "medium" | "high";
	suppliedAssetCount: number;
	collateralAssetCount: number;
	borrowedAssetCount: number;
	suppliedUsd: number | null;
	collateralUsd: number | null;
	borrowedUsd: number | null;
	borrowToCollateralRatio: number | null;
	hasBorrowedExposure: boolean;
	hasCollateralExposure: boolean;
	accountLocked: boolean;
	valuationPricedRowCount: number;
	valuationUnpricedRowCount: number;
	valuationPriceUpdatedAtLatest: string | null;
	valuationError: string | null;
	warningRatio: number;
	criticalRatio: number;
	borrowToCollateralBand: NearBurrowRiskBand;
	warningHeadroomRatio: number | null;
	criticalHeadroomRatio: number | null;
	notes: string[];
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
const DEFAULT_NEAR_PORTFOLIO_VALUATION_CACHE_TTL_MS = 30_000;
const MAX_NEAR_PORTFOLIO_VALUATION_CACHE_TTL_MS = 3_600_000;
const DEFAULT_BURROW_RISK_WARNING_RATIO = 0.6;
const DEFAULT_BURROW_RISK_CRITICAL_RATIO = 0.85;
const NEAR_INTENTS_EXPLORER_STATUS_VALUES = [
	"FAILED",
	"INCOMPLETE_DEPOSIT",
	"PENDING_DEPOSIT",
	"PROCESSING",
	"REFUNDED",
	"SUCCESS",
] as const;

const nearPortfolioValuationTokenCache = new Map<
	string,
	NearPortfolioValuationCacheEntry
>();
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

function hasPositiveRawAmount(value: string): boolean {
	try {
		return parseUnsignedBigInt(value, "rawAmount") > 0n;
	} catch {
		return false;
	}
}

function parseUiAmountNumber(value: string | null): number | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().replace(/,/g, "");
	if (!normalized) return null;
	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : null;
}

function rawAmountToApproxNumber(
	rawAmount: string,
	decimals: number | null,
): number | null {
	if (decimals == null || !Number.isInteger(decimals) || decimals < 0) {
		return null;
	}
	const parsedRaw = Number(rawAmount);
	if (!Number.isFinite(parsedRaw)) return null;
	const denominator = 10 ** decimals;
	if (!Number.isFinite(denominator) || denominator <= 0) return null;
	return parsedRaw / denominator;
}

function extractNearTokenIdFromIntentsAssetId(assetId: string): string | null {
	const normalized = assetId.trim().toLowerCase();
	if (!normalized.startsWith("nep141:")) return null;
	const tokenId = normalized.slice("nep141:".length).trim();
	return tokenId || null;
}

function buildNearPortfolioPriceIndex(tokens: NearIntentsToken[]): {
	byTokenId: Map<string, NearIntentsToken>;
	bySymbol: Map<string, NearIntentsToken[]>;
} {
	const byTokenId = new Map<string, NearIntentsToken>();
	const bySymbol = new Map<string, NearIntentsToken[]>();
	for (const token of tokens) {
		if (
			token.blockchain.trim().toLowerCase() !== "near" ||
			!Number.isFinite(token.price) ||
			token.price < 0
		) {
			continue;
		}
		const tokenIdFromAssetId = extractNearTokenIdFromIntentsAssetId(
			token.assetId,
		);
		const tokenIdFromAddress =
			typeof token.contractAddress === "string"
				? token.contractAddress.trim().toLowerCase()
				: "";
		const tokenId = tokenIdFromAddress || tokenIdFromAssetId;
		if (tokenId && !byTokenId.has(tokenId)) {
			byTokenId.set(tokenId, token);
		}
		const symbolKey = token.symbol.trim().toUpperCase();
		if (!symbolKey) continue;
		const list = bySymbol.get(symbolKey) ?? [];
		list.push(token);
		bySymbol.set(symbolKey, list);
	}
	return { byTokenId, bySymbol };
}

function resolvePortfolioAssetPrice(params: {
	asset: NearPortfolioAsset;
	priceIndex: {
		byTokenId: Map<string, NearIntentsToken>;
		bySymbol: Map<string, NearIntentsToken[]>;
	};
}): {
	priceUsd: number;
	sourceAssetId: string;
	matchBy: "tokenId" | "symbol";
	priceUpdatedAt: string;
} | null {
	const contractId =
		typeof params.asset.contractId === "string"
			? params.asset.contractId.trim().toLowerCase()
			: null;
	if (contractId) {
		const matched = params.priceIndex.byTokenId.get(contractId);
		if (matched) {
			return {
				priceUsd: matched.price,
				sourceAssetId: matched.assetId,
				matchBy: "tokenId",
				priceUpdatedAt: matched.priceUpdatedAt,
			};
		}
	}
	if (params.asset.kind === "native") {
		const nativeCandidate =
			params.priceIndex.byTokenId.get("wrap.near") ?? null;
		if (nativeCandidate) {
			return {
				priceUsd: nativeCandidate.price,
				sourceAssetId: nativeCandidate.assetId,
				matchBy: "tokenId",
				priceUpdatedAt: nativeCandidate.priceUpdatedAt,
			};
		}
	}
	const symbolKey = params.asset.symbol.trim().toUpperCase();
	if (!symbolKey) return null;
	const bySymbol = params.priceIndex.bySymbol.get(symbolKey) ?? [];
	if (bySymbol.length !== 1) return null;
	const matched = bySymbol[0];
	if (!matched) return null;
	return {
		priceUsd: matched.price,
		sourceAssetId: matched.assetId,
		matchBy: "symbol",
		priceUpdatedAt: matched.priceUpdatedAt,
	};
}

function computePortfolioAssetEstimatedUsd(
	asset: NearPortfolioAsset,
): number | null {
	const priceUsd = asset.priceUsd;
	if (
		typeof priceUsd !== "number" ||
		!Number.isFinite(priceUsd) ||
		priceUsd < 0
	) {
		return null;
	}
	const uiAmount =
		parseUiAmountNumber(asset.uiAmount) ??
		rawAmountToApproxNumber(asset.rawAmount, asset.decimals);
	if (uiAmount == null || !Number.isFinite(uiAmount) || uiAmount < 0)
		return null;
	return uiAmount * priceUsd;
}

function summarizeTokenIdsForReadableLine(
	tokenIds: string[],
	labelByTokenId: Map<string, string>,
): string {
	if (tokenIds.length === 0) return "none";
	const labels = dedupeStrings(
		tokenIds.map((tokenId) => {
			const normalized = tokenId.trim().toLowerCase();
			if (!normalized) return "";
			return labelByTokenId.get(normalized) ?? shortAccountId(normalized);
		}),
	).filter(Boolean);
	if (labels.length <= 4) return labels.join(", ");
	return `${labels.slice(0, 4).join(", ")} (+${labels.length - 4} more)`;
}

function summarizePortfolioRoleTokens(
	tokenIds: string[],
	assetByTokenId: Map<string, NearPortfolioAsset>,
): string {
	const normalized = dedupeStrings(
		tokenIds.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
	);
	if (normalized.length === 0) return "none";
	const rows = normalized.map((tokenId) => {
		const asset = assetByTokenId.get(tokenId);
		if (asset) {
			const amountText = asset.uiAmount ?? `${asset.rawAmount} raw`;
			const usdText =
				asset.estimatedUsd != null
					? ` (~${formatUsdOrFallback(asset.estimatedUsd)})`
					: "";
			return `${asset.symbol}=${amountText}${usdText}`;
		}
		return shortAccountId(tokenId);
	});
	if (rows.length <= 4) return rows.join(", ");
	return `${rows.slice(0, 4).join(", ")} (+${rows.length - 4} more)`;
}

function comparePortfolioAssetsForDisplay(
	left: NearPortfolioAsset,
	right: NearPortfolioAsset,
): number {
	const leftUsd =
		typeof left.estimatedUsd === "number" && Number.isFinite(left.estimatedUsd)
			? left.estimatedUsd
			: null;
	const rightUsd =
		typeof right.estimatedUsd === "number" &&
		Number.isFinite(right.estimatedUsd)
			? right.estimatedUsd
			: null;
	if (leftUsd != null && rightUsd != null && leftUsd !== rightUsd) {
		return leftUsd > rightUsd ? -1 : 1;
	}
	if (leftUsd != null && rightUsd == null) return -1;
	if (leftUsd == null && rightUsd != null) return 1;
	return left.symbol.localeCompare(right.symbol);
}

function normalizeTokenIdList(values: string[]): string[] {
	return dedupeStrings(
		values.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
	);
}

function buildPortfolioExposureRows(
	tokenIds: string[],
	assetByTokenId: Map<string, NearPortfolioAsset>,
): NearPortfolioExposureRow[] {
	const normalized = normalizeTokenIdList(tokenIds);
	return normalized.map((tokenId) => {
		const asset = assetByTokenId.get(tokenId);
		const symbol = asset?.symbol ?? shortAccountId(tokenId);
		const walletRawAmount = asset?.rawAmount ?? null;
		const walletUiAmount = asset?.uiAmount ?? null;
		const inWallet = walletRawAmount
			? hasPositiveRawAmount(walletRawAmount)
			: false;
		return {
			tokenId,
			symbol,
			walletRawAmount,
			walletUiAmount,
			walletEstimatedUsd: asset?.estimatedUsd ?? null,
			inWallet,
		};
	});
}

function addRawAmountToMap(
	target: Map<string, bigint>,
	tokenId: string,
	rawAmount: string,
): void {
	const normalizedTokenId = tokenId.trim().toLowerCase();
	if (!normalizedTokenId) return;
	const parsed = parseUnsignedBigInt(
		rawAmount,
		`rawAmount[${normalizedTokenId}]`,
	);
	if (parsed <= 0n) return;
	target.set(normalizedTokenId, (target.get(normalizedTokenId) ?? 0n) + parsed);
}

function collectBurrowRawAmountsByRole(params: {
	snapshot: BurrowAccountAllPositionsView | null;
	extraDecimalsByToken: Map<string, number>;
}): {
	supplied: Map<string, bigint>;
	collateral: Map<string, bigint>;
	borrowed: Map<string, bigint>;
} {
	const supplied = new Map<string, bigint>();
	const collateral = new Map<string, bigint>();
	const borrowed = new Map<string, bigint>();
	if (!params.snapshot) {
		return { supplied, collateral, borrowed };
	}
	const addFromAssetNode = (
		target: Map<string, bigint>,
		assetNode: unknown,
		context: string,
	): void => {
		const normalized = normalizeBurrowAccountAssetView(assetNode);
		if (!normalized) return;
		const tokenId = normalized.token_id.trim().toLowerCase();
		if (!tokenId) return;
		const inner = parseUnsignedBigInt(
			normalized.balance,
			`${context}.${tokenId}`,
		);
		if (inner <= 0n) return;
		const extraDecimals = params.extraDecimalsByToken.get(tokenId) ?? 0;
		const rawAmount = fromBurrowInnerAmount(inner.toString(), extraDecimals);
		addRawAmountToMap(target, tokenId, rawAmount);
	};
	for (const assetNode of Array.isArray(params.snapshot.supplied)
		? params.snapshot.supplied
		: []) {
		addFromAssetNode(supplied, assetNode, "burrow.supplied");
	}
	const positions = params.snapshot.positions ?? {};
	for (const positionNode of Object.values(positions)) {
		const normalized = normalizeBurrowPositionNode(positionNode);
		if (!normalized) continue;
		for (const assetNode of normalized.collateral ?? []) {
			addFromAssetNode(collateral, assetNode, "burrow.collateral");
		}
		for (const assetNode of normalized.borrowed ?? []) {
			addFromAssetNode(borrowed, assetNode, "burrow.borrowed");
		}
	}
	return { supplied, collateral, borrowed };
}

function buildPortfolioDefiAmountRows(params: {
	tokenAmounts: Map<string, bigint>;
	assetByTokenId: Map<string, NearPortfolioAsset>;
}): NearPortfolioDefiAmountRow[] {
	const rows: NearPortfolioDefiAmountRow[] = [];
	for (const [tokenId, rawAmountValue] of params.tokenAmounts) {
		const asset = params.assetByTokenId.get(tokenId);
		const symbol = asset?.symbol ?? shortAccountId(tokenId);
		const rawAmount = rawAmountValue.toString();
		let uiAmount: string | null = null;
		if (asset?.decimals != null) {
			try {
				uiAmount = formatTokenAmount(rawAmount, asset.decimals, 8);
			} catch {
				uiAmount = null;
			}
		}
		const estimatedUsd =
			typeof asset?.priceUsd === "number" &&
			Number.isFinite(asset.priceUsd) &&
			asset.priceUsd >= 0
				? (() => {
						const amountNumber =
							parseUiAmountNumber(uiAmount) ??
							rawAmountToApproxNumber(rawAmount, asset.decimals);
						if (
							amountNumber == null ||
							!Number.isFinite(amountNumber) ||
							amountNumber < 0
						) {
							return null;
						}
						return amountNumber * asset.priceUsd;
					})()
				: null;
		rows.push({
			tokenId,
			symbol,
			rawAmount,
			uiAmount,
			estimatedUsd,
			walletRawAmount: asset?.rawAmount ?? null,
			walletUiAmount: asset?.uiAmount ?? null,
			walletEstimatedUsd: asset?.estimatedUsd ?? null,
		});
	}
	rows.sort((left, right) => {
		const leftUsd =
			typeof left.estimatedUsd === "number" &&
			Number.isFinite(left.estimatedUsd)
				? left.estimatedUsd
				: null;
		const rightUsd =
			typeof right.estimatedUsd === "number" &&
			Number.isFinite(right.estimatedUsd)
				? right.estimatedUsd
				: null;
		if (leftUsd != null && rightUsd != null && leftUsd !== rightUsd) {
			return leftUsd > rightUsd ? -1 : 1;
		}
		if (leftUsd != null && rightUsd == null) return -1;
		if (leftUsd == null && rightUsd != null) return 1;
		return left.symbol.localeCompare(right.symbol);
	});
	return rows;
}

function summarizeDefiRowsUsd(rows: NearPortfolioDefiAmountRow[]): {
	totalUsd: number | null;
	pricedCount: number;
	totalCount: number;
	fullyPriced: boolean;
} {
	const priced = rows
		.map((row) => row.estimatedUsd)
		.filter(
			(value): value is number =>
				typeof value === "number" && Number.isFinite(value),
		);
	const totalUsd =
		rows.length === 0
			? 0
			: priced.length === 0
				? null
				: priced.reduce((sum, value) => sum + value, 0);
	return {
		totalUsd,
		pricedCount: priced.length,
		totalCount: rows.length,
		fullyPriced: rows.length === 0 || priced.length === rows.length,
	};
}

function formatPortfolioDefiAmountRow(row: NearPortfolioDefiAmountRow): string {
	const amountText =
		row.uiAmount == null ? `${row.rawAmount} raw` : `${row.uiAmount}`;
	const usdText =
		row.estimatedUsd == null
			? ""
			: ` (~${formatUsdOrFallback(row.estimatedUsd)})`;
	return `${row.symbol}: ${amountText}${usdText}`;
}

function collectBurrowTokenIdsFromSnapshot(
	snapshot: BurrowAccountAllPositionsView | null,
): string[] {
	const byRole = collectBurrowTokenIdsByRoleFromSnapshot(snapshot);
	return dedupeStrings([
		...byRole.supplied,
		...byRole.collateral,
		...byRole.borrowed,
	]);
}

function collectBurrowTokenIdsByRoleFromSnapshot(
	snapshot: BurrowAccountAllPositionsView | null,
): {
	supplied: string[];
	collateral: string[];
	borrowed: string[];
} {
	if (!snapshot) {
		return {
			supplied: [],
			collateral: [],
			borrowed: [],
		};
	}
	const byRole = {
		supplied: [] as string[],
		collateral: [] as string[],
		borrowed: [] as string[],
	};
	const parseTokenId = (node: unknown): string | null => {
		const normalized = normalizeBurrowAccountAssetView(node);
		if (!normalized) return null;
		const tokenId = normalized.token_id.trim().toLowerCase();
		if (!tokenId) return null;
		try {
			const balance = parseUnsignedBigInt(
				normalized.balance,
				`burrow.${tokenId}.balance`,
			);
			return balance > 0n ? tokenId : null;
		} catch {
			return null;
		}
	};
	for (const asset of Array.isArray(snapshot.supplied)
		? snapshot.supplied
		: []) {
		const tokenId = parseTokenId(asset);
		if (tokenId) byRole.supplied.push(tokenId);
	}
	const positions = snapshot.positions ?? {};
	for (const positionNode of Object.values(positions)) {
		const normalized = normalizeBurrowPositionNode(positionNode);
		if (!normalized) continue;
		for (const asset of normalized.collateral ?? []) {
			const tokenId = parseTokenId(asset);
			if (tokenId) byRole.collateral.push(tokenId);
		}
		for (const asset of normalized.borrowed ?? []) {
			const tokenId = parseTokenId(asset);
			if (tokenId) byRole.borrowed.push(tokenId);
		}
	}
	return {
		supplied: dedupeStrings(byRole.supplied),
		collateral: dedupeStrings(byRole.collateral),
		borrowed: dedupeStrings(byRole.borrowed),
	};
}

async function discoverPortfolioFtContracts(params: {
	accountId: string;
	network: "mainnet" | "testnet";
	rpcUrl?: string;
}): Promise<{
	tokenIds: string[];
	discoveredBySource: {
		refDeposits: string[];
		burrowPositions: string[];
	};
	discoveredByRole: NearPortfolioDiscoveryByRole;
	refDepositsRaw: Record<string, string>;
	burrowSnapshot: BurrowAccountAllPositionsView | null;
	failures: NearPortfolioDiscoveryFailure[];
}> {
	const discoveredBySource = {
		refDeposits: [] as string[],
		burrowPositions: [] as string[],
	};
	const discoveredByRole: NearPortfolioDiscoveryByRole = {
		refDeposits: [],
		burrowSupplied: [],
		burrowCollateral: [],
		burrowBorrowed: [],
	};
	let refDepositsRaw: Record<string, string> = {};
	let burrowSnapshot: BurrowAccountAllPositionsView | null = null;
	const failures: NearPortfolioDiscoveryFailure[] = [];
	try {
		const refContractId = getRefContractId(params.network);
		const deposits = await queryRefDeposits({
			accountId: params.accountId,
			network: params.network,
			rpcUrl: params.rpcUrl,
			refContractId,
		});
		refDepositsRaw = deposits;
		discoveredBySource.refDeposits = dedupeStrings(
			Object.entries(deposits)
				.filter(([tokenId, rawAmount]) => {
					if (!tokenId) return false;
					try {
						return parseUnsignedBigInt(rawAmount, `deposits[${tokenId}]`) > 0n;
					} catch {
						return false;
					}
				})
				.map(([tokenId]) => tokenId.toLowerCase()),
		);
		discoveredByRole.refDeposits = [...discoveredBySource.refDeposits];
	} catch (error) {
		failures.push({
			source: "ref_deposits",
			error: error instanceof Error ? error.message : String(error),
		});
	}

	try {
		const burrowContractId = getBurrowContractId(params.network);
		const snapshot = await fetchBurrowAccountAllPositions({
			accountId: params.accountId,
			network: params.network,
			rpcUrl: params.rpcUrl,
			burrowContractId,
		});
		burrowSnapshot = snapshot;
		const burrowByRole = collectBurrowTokenIdsByRoleFromSnapshot(snapshot);
		discoveredByRole.burrowSupplied = burrowByRole.supplied;
		discoveredByRole.burrowCollateral = burrowByRole.collateral;
		discoveredByRole.burrowBorrowed = burrowByRole.borrowed;
		discoveredBySource.burrowPositions =
			collectBurrowTokenIdsFromSnapshot(snapshot);
	} catch (error) {
		failures.push({
			source: "burrow_positions",
			error: error instanceof Error ? error.message : String(error),
		});
	}

	return {
		tokenIds: dedupeStrings([
			...discoveredBySource.refDeposits,
			...discoveredBySource.burrowPositions,
		]),
		discoveredBySource,
		discoveredByRole,
		refDepositsRaw,
		burrowSnapshot,
		failures,
	};
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

function parseBurrowRiskRatio(
	value: number | undefined,
	fieldName: string,
	fallback: number,
): number {
	if (value == null) return fallback;
	if (!Number.isFinite(value) || value <= 0 || value >= 2) {
		throw new Error(`${fieldName} must be > 0 and < 2`);
	}
	return value;
}

function parseBurrowRiskThresholds(params: {
	warningRatio?: number;
	criticalRatio?: number;
}): {
	warningRatio: number;
	criticalRatio: number;
} {
	const warningRatio = parseBurrowRiskRatio(
		params.warningRatio,
		"riskWarningRatio",
		DEFAULT_BURROW_RISK_WARNING_RATIO,
	);
	const criticalRatio = parseBurrowRiskRatio(
		params.criticalRatio,
		"riskCriticalRatio",
		DEFAULT_BURROW_RISK_CRITICAL_RATIO,
	);
	if (warningRatio >= criticalRatio) {
		throw new Error("riskWarningRatio must be smaller than riskCriticalRatio");
	}
	return {
		warningRatio,
		criticalRatio,
	};
}

function parsePortfolioValuationCacheTtlMs(value: number | undefined): number {
	if (value == null) {
		const envValue = process.env.NEAR_PORTFOLIO_VALUATION_CACHE_TTL_MS?.trim();
		if (!envValue) return DEFAULT_NEAR_PORTFOLIO_VALUATION_CACHE_TTL_MS;
		const parsed = Number(envValue);
		if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
			return DEFAULT_NEAR_PORTFOLIO_VALUATION_CACHE_TTL_MS;
		}
		return Math.min(parsed, MAX_NEAR_PORTFOLIO_VALUATION_CACHE_TTL_MS);
	}
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		throw new Error("valuationCacheTtlMs must be an integer >= 0");
	}
	return Math.min(Math.floor(value), MAX_NEAR_PORTFOLIO_VALUATION_CACHE_TTL_MS);
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

function formatUsdOrFallback(value: number): string {
	return formatUsdApprox(value) ?? `$${value.toFixed(2)}`;
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

async function queryNearPortfolioValuationTokens(params: {
	baseUrl: string;
	headers: Record<string, string>;
	cacheTtlMs: number;
}): Promise<{
	endpoint: string;
	httpStatus: number;
	tokens: NearIntentsToken[];
	cacheHit: boolean;
	cacheAgeMs: number | null;
}> {
	const now = Date.now();
	if (params.cacheTtlMs > 0) {
		const cached = nearPortfolioValuationTokenCache.get(params.baseUrl);
		if (cached) {
			const ageMs = now - cached.fetchedAtMs;
			if (ageMs >= 0 && ageMs <= params.cacheTtlMs) {
				return {
					endpoint: cached.endpoint,
					httpStatus: cached.httpStatus,
					tokens: cached.tokens,
					cacheHit: true,
					cacheAgeMs: ageMs,
				};
			}
		}
	}
	const response = await fetchNearIntentsJson<NearIntentsToken[]>({
		baseUrl: params.baseUrl,
		path: "/v0/tokens",
		method: "GET",
		headers: params.headers,
	});
	const tokens = normalizeNearIntentsTokens(response.payload);
	if (params.cacheTtlMs > 0) {
		nearPortfolioValuationTokenCache.set(params.baseUrl, {
			fetchedAtMs: now,
			endpoint: response.url,
			httpStatus: response.status,
			tokens,
		});
	}
	return {
		endpoint: response.url,
		httpStatus: response.status,
		tokens,
		cacheHit: false,
		cacheAgeMs: null,
	};
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

function normalizeBurrowApr(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	if (!normalized) return null;
	return normalized;
}

function formatBurrowAmountUi(params: {
	rawAmount: string;
	rawDecimals: number | null;
}): string | null {
	if (params.rawDecimals == null) return null;
	try {
		return formatTokenAmount(params.rawAmount, params.rawDecimals, 8);
	} catch {
		return null;
	}
}

function hasPositiveBurrowRowBalance(row: NearBurrowPositionAssetRow): boolean {
	try {
		return parseUnsignedBigInt(row.balanceRaw, "burrow.balanceRaw") > 0n;
	} catch {
		return false;
	}
}

function countPositiveBurrowRows(rows: NearBurrowPositionAssetRow[]): number {
	let count = 0;
	for (const row of rows) {
		if (hasPositiveBurrowRowBalance(row)) count += 1;
	}
	return count;
}

type NearBurrowRowValuationSummary = {
	totalUsd: number | null;
	positiveRowCount: number;
	pricedRowCount: number;
	unpricedRowCount: number;
	priceUpdatedAtLatest: string | null;
	priceUpdatedAtOldest: string | null;
};

function summarizeBurrowRowsValuationUsd(params: {
	rows: NearBurrowPositionAssetRow[];
	priceIndex: {
		byTokenId: Map<string, NearIntentsToken>;
		bySymbol: Map<string, NearIntentsToken[]>;
	};
}): NearBurrowRowValuationSummary {
	let totalUsd = 0;
	let hasValuation = false;
	let positiveRowCount = 0;
	let pricedRowCount = 0;
	let unpricedRowCount = 0;
	let latestPriceUpdateMs: number | null = null;
	let oldestPriceUpdateMs: number | null = null;

	for (const row of params.rows) {
		if (!hasPositiveBurrowRowBalance(row)) continue;
		positiveRowCount += 1;
		const valuationAsset: NearPortfolioAsset = {
			kind: row.tokenId.trim().toLowerCase() === "wrap.near" ? "native" : "ft",
			symbol: row.symbol,
			contractId: row.tokenId,
			rawAmount: row.balanceRaw,
			uiAmount: row.balanceUi,
			decimals: row.rawDecimals,
		};
		const resolvedPrice = resolvePortfolioAssetPrice({
			asset: valuationAsset,
			priceIndex: params.priceIndex,
		});
		if (!resolvedPrice) {
			unpricedRowCount += 1;
			continue;
		}
		valuationAsset.priceUsd = resolvedPrice.priceUsd;
		const estimatedUsd = computePortfolioAssetEstimatedUsd(valuationAsset);
		if (
			estimatedUsd == null ||
			!Number.isFinite(estimatedUsd) ||
			estimatedUsd < 0
		) {
			unpricedRowCount += 1;
			continue;
		}

		totalUsd += estimatedUsd;
		hasValuation = true;
		pricedRowCount += 1;
		const parsedPriceUpdatedAt = Date.parse(resolvedPrice.priceUpdatedAt);
		if (!Number.isNaN(parsedPriceUpdatedAt)) {
			if (
				latestPriceUpdateMs == null ||
				parsedPriceUpdatedAt > latestPriceUpdateMs
			) {
				latestPriceUpdateMs = parsedPriceUpdatedAt;
			}
			if (
				oldestPriceUpdateMs == null ||
				parsedPriceUpdatedAt < oldestPriceUpdateMs
			) {
				oldestPriceUpdateMs = parsedPriceUpdatedAt;
			}
		}
	}

	return {
		totalUsd: positiveRowCount === 0 ? 0 : hasValuation ? totalUsd : null,
		positiveRowCount,
		pricedRowCount,
		unpricedRowCount,
		priceUpdatedAtLatest:
			latestPriceUpdateMs == null
				? null
				: new Date(latestPriceUpdateMs).toISOString(),
		priceUpdatedAtOldest:
			oldestPriceUpdateMs == null
				? null
				: new Date(oldestPriceUpdateMs).toISOString(),
	};
}

function formatBurrowRatioPercent(value: number): string {
	return `${(value * 100).toFixed(2)}%`;
}

function resolveBurrowRiskBand(params: {
	ratio: number | null;
	warningRatio: number;
	criticalRatio: number;
}): NearBurrowRiskBand {
	if (params.ratio == null) return "unknown";
	if (params.ratio >= params.criticalRatio) return "critical";
	if (params.ratio >= params.warningRatio) return "warning";
	return "safe";
}

function buildBurrowRiskSummary(params: {
	suppliedRows: NearBurrowPositionAssetRow[];
	collateralRows: NearBurrowPositionAssetRow[];
	borrowedRows: NearBurrowPositionAssetRow[];
	accountLocked: boolean;
	warningRatio: number;
	criticalRatio: number;
	valuation?: {
		suppliedUsd: number | null;
		collateralUsd: number | null;
		borrowedUsd: number | null;
		pricedRowCount: number;
		unpricedRowCount: number;
		priceUpdatedAtLatest: string | null;
		error: string | null;
	};
}): NearBurrowRiskSummary {
	const suppliedAssetCount = countPositiveBurrowRows(params.suppliedRows);
	const collateralAssetCount = countPositiveBurrowRows(params.collateralRows);
	const borrowedAssetCount = countPositiveBurrowRows(params.borrowedRows);
	const suppliedUsd =
		typeof params.valuation?.suppliedUsd === "number" &&
		Number.isFinite(params.valuation.suppliedUsd)
			? params.valuation.suppliedUsd
			: null;
	const collateralUsd =
		typeof params.valuation?.collateralUsd === "number" &&
		Number.isFinite(params.valuation.collateralUsd)
			? params.valuation.collateralUsd
			: null;
	const borrowedUsd =
		typeof params.valuation?.borrowedUsd === "number" &&
		Number.isFinite(params.valuation.borrowedUsd)
			? params.valuation.borrowedUsd
			: null;
	const borrowToCollateralRatio =
		borrowedUsd != null &&
		collateralUsd != null &&
		Number.isFinite(borrowedUsd) &&
		Number.isFinite(collateralUsd) &&
		collateralUsd > 0
			? borrowedUsd / collateralUsd
			: null;
	const hasBorrowedExposure = borrowedAssetCount > 0;
	const hasCollateralExposure = collateralAssetCount > 0;
	const borrowToCollateralBand = resolveBurrowRiskBand({
		ratio: borrowToCollateralRatio,
		warningRatio: params.warningRatio,
		criticalRatio: params.criticalRatio,
	});
	const warningHeadroomRatio =
		borrowToCollateralRatio == null
			? null
			: params.warningRatio - borrowToCollateralRatio;
	const criticalHeadroomRatio =
		borrowToCollateralRatio == null
			? null
			: params.criticalRatio - borrowToCollateralRatio;
	const valuationError =
		typeof params.valuation?.error === "string" &&
		params.valuation.error.trim().length > 0
			? params.valuation.error.trim()
			: null;
	const notes: string[] = [];
	if (hasBorrowedExposure && !hasCollateralExposure) {
		notes.push(
			"Borrowed exposure exists but no collateral rows were found. Verify account health before any borrow/withdraw.",
		);
	}
	if (params.accountLocked) {
		notes.push(
			"Account is currently locked on Burrow. Certain borrow/withdraw actions may be blocked.",
		);
	}
	if (hasBorrowedExposure) {
		notes.push(
			"Debt exposure detected. Run workflow simulate before execute for borrow/withdraw actions.",
		);
	}
	if (
		borrowToCollateralBand === "critical" &&
		borrowToCollateralRatio != null
	) {
		notes.push(
			`Borrow/collateral ratio is ${formatBurrowRatioPercent(borrowToCollateralRatio)} (critical). Keep collateral buffer before withdrawing or borrowing more.`,
		);
	} else if (
		borrowToCollateralBand === "warning" &&
		borrowToCollateralRatio != null
	) {
		notes.push(
			`Borrow/collateral ratio is ${formatBurrowRatioPercent(borrowToCollateralRatio)} (warning).`,
		);
	}
	if (valuationError) {
		notes.push(`USD valuation unavailable (${valuationError}).`);
	}
	let level: "low" | "medium" | "high" =
		hasBorrowedExposure && !hasCollateralExposure
			? "high"
			: hasBorrowedExposure || params.accountLocked
				? "medium"
				: "low";
	if (borrowToCollateralBand === "critical") {
		level = "high";
	} else if (borrowToCollateralBand === "warning" && level === "low") {
		level = "medium";
	}
	return {
		level,
		suppliedAssetCount,
		collateralAssetCount,
		borrowedAssetCount,
		suppliedUsd,
		collateralUsd,
		borrowedUsd,
		borrowToCollateralRatio,
		hasBorrowedExposure,
		hasCollateralExposure,
		accountLocked: params.accountLocked,
		valuationPricedRowCount: params.valuation?.pricedRowCount ?? 0,
		valuationUnpricedRowCount: params.valuation?.unpricedRowCount ?? 0,
		valuationPriceUpdatedAtLatest:
			params.valuation?.priceUpdatedAtLatest ?? null,
		valuationError,
		warningRatio: params.warningRatio,
		criticalRatio: params.criticalRatio,
		borrowToCollateralBand,
		warningHeadroomRatio,
		criticalHeadroomRatio,
		notes,
	};
}

function normalizeBurrowMarketAsset(
	value: unknown,
): BurrowAssetDetailedView | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as BurrowAssetDetailedView;
	if (typeof candidate.token_id !== "string") return null;
	if (
		!candidate.supplied ||
		typeof candidate.supplied.balance !== "string" ||
		typeof candidate.supplied.shares !== "string"
	) {
		return null;
	}
	if (
		!candidate.borrowed ||
		typeof candidate.borrowed.balance !== "string" ||
		typeof candidate.borrowed.shares !== "string"
	) {
		return null;
	}
	if (!candidate.config || typeof candidate.config !== "object") {
		return null;
	}
	return candidate;
}

function normalizeBurrowAccountPositions(
	value: unknown,
): BurrowAccountAllPositionsView | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as BurrowAccountAllPositionsView;
	if (typeof candidate.account_id !== "string") return null;
	return candidate;
}

function normalizeBurrowAccountAssetView(
	value: unknown,
): BurrowAccountAssetView | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as BurrowAccountAssetView;
	if (
		typeof candidate.token_id !== "string" ||
		typeof candidate.balance !== "string" ||
		typeof candidate.shares !== "string"
	) {
		return null;
	}
	return candidate;
}

function normalizeBurrowPositionNode(
	value: unknown,
): BurrowAccountPositionView | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as {
		collateral?: unknown;
		borrowed?: unknown;
	};
	const collateral = Array.isArray(candidate.collateral)
		? candidate.collateral
				.map(normalizeBurrowAccountAssetView)
				.filter((entry): entry is BurrowAccountAssetView => entry != null)
		: [];
	const borrowed = Array.isArray(candidate.borrowed)
		? candidate.borrowed
				.map(normalizeBurrowAccountAssetView)
				.filter((entry): entry is BurrowAccountAssetView => entry != null)
		: [];
	return {
		collateral,
		borrowed,
	};
}

async function resolveBurrowMarketRows(params: {
	network: string;
	rpcUrl?: string;
	markets: BurrowAssetDetailedView[];
}): Promise<NearBurrowMarketRow[]> {
	const metadataCache = new Map<string, Promise<NearFtMetadata | null>>();
	const rows = await mapConcurrently(
		params.markets,
		8,
		async (market): Promise<NearBurrowMarketRow> => {
			const tokenId = market.token_id.toLowerCase();
			const metadata = await resolveTokenMetadataCached(
				tokenId,
				metadataCache,
				{
					network: params.network,
					rpcUrl: params.rpcUrl,
				},
			);
			const rawDecimals =
				typeof metadata?.decimals === "number" ? metadata.decimals : null;
			const symbol =
				typeof metadata?.symbol === "string" && metadata.symbol.trim()
					? metadata.symbol.trim()
					: shortAccountId(tokenId);
			const extraDecimals = parseBurrowExtraDecimals(
				market.config?.extra_decimals,
			);
			const suppliedInner = parseUnsignedBigInt(
				market.supplied.balance,
				`${tokenId}.supplied.balance`,
			).toString();
			const borrowedInner = parseUnsignedBigInt(
				market.borrowed.balance,
				`${tokenId}.borrowed.balance`,
			).toString();
			const suppliedRaw = fromBurrowInnerAmount(suppliedInner, extraDecimals);
			const borrowedRaw = fromBurrowInnerAmount(borrowedInner, extraDecimals);
			return {
				tokenId,
				symbol,
				rawDecimals,
				extraDecimals,
				canDeposit: market.config?.can_deposit === true,
				canWithdraw: market.config?.can_withdraw === true,
				canBorrow: market.config?.can_borrow === true,
				canUseAsCollateral: market.config?.can_use_as_collateral === true,
				suppliedInner,
				borrowedInner,
				suppliedRaw,
				borrowedRaw,
				suppliedUi: formatBurrowAmountUi({
					rawAmount: suppliedRaw,
					rawDecimals,
				}),
				borrowedUi: formatBurrowAmountUi({
					rawAmount: borrowedRaw,
					rawDecimals,
				}),
				supplyApr: normalizeBurrowApr(market.supply_apr),
				borrowApr: normalizeBurrowApr(market.borrow_apr),
			};
		},
	);
	rows.sort((left, right) => left.symbol.localeCompare(right.symbol));
	return rows;
}

const DEFAULT_STABLE_YIELD_SYMBOLS = [
	"USDC",
	"USDT",
	"DAI",
	"USDD",
	"BUSD",
	"FRAX",
	"LUSD",
	"TUSD",
	"PYUSD",
	"GUSD",
	"USDE",
	"SUSD",
];

function normalizeStableSymbol(value: string): string {
	return value.trim().toUpperCase();
}

function parseStableSymbolHints(values?: string[]): string[] {
	const merged = values?.length
		? values.map(normalizeStableSymbol).filter(Boolean)
		: DEFAULT_STABLE_YIELD_SYMBOLS;
	const seen = new Set<string>();
	for (const symbol of merged) {
		if (symbol) seen.add(symbol);
	}
	return [...seen];
}

function parseTopN(value?: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 3;
	const rounded = Math.floor(value);
	if (rounded <= 0) return 1;
	if (rounded > 20) return 20;
	return rounded;
}

function parseApr(value: string | null): number | null {
	if (!value) return null;
	const normalized = value.trim();
	if (!normalized) return null;
	const parsed = Number.parseFloat(normalized);
	if (!Number.isFinite(parsed)) return null;
	return parsed;
}

function buildStableYieldExecutionRiskProfile(params: {
	selected: NearStableYieldCandidate | null;
}): NearStableYieldExecutionRiskProfile {
	if (params.selected == null) {
		return {
			riskScore: 1,
			riskBand: "high",
			rationale:
				"No stable candidate selected for execution path, so execution risk is not assessable; hold action only.",
		};
	}
	let score = 0.25;
	if (!params.selected.canWithdraw) {
		score += 0.15;
	}
	if (!params.selected.canDeposit) {
		score += 0.2;
	}
	const apr = parseApr(params.selected.supplyApr);
	if (apr == null || apr <= 0) {
		score += 0.1;
	}
	score = Math.min(1, Math.max(0, score));
	const riskBand = score >= 0.7 ? "high" : score >= 0.35 ? "medium" : "low";
	const rationale =
		score === 1
			? "No reliable APR/depositability profile available."
			: `Heuristic risk score ${score.toFixed(2)} derived from deposit/withdraw APR attributes.`;
	return {
		riskScore: Number(score.toFixed(3)),
		riskBand,
		rationale,
	};
}

function buildStableYieldPlanId(params: {
	network: string;
	burrowContractId: string;
	topN: number;
	stableSymbols: string[];
	includeDisabled: boolean;
	selectedTokenId: string | null;
}): string {
	const fingerprint = JSON.stringify({
		network: params.network,
		burrowContractId: params.burrowContractId,
		topN: params.topN,
		stableSymbols: [...params.stableSymbols].sort(),
		includeDisabled: params.includeDisabled,
		selectedTokenId: params.selectedTokenId,
	});
	const digest = createHash("sha256")
		.update(fingerprint)
		.digest("hex")
		.slice(0, 16);
	return `near.stable-yield.${digest}`;
}

function resolveStableYieldExpiryAt(params: {
	generatedAt: string;
	ttlMinutes?: number;
}): string {
	const parsed = Date.parse(params.generatedAt);
	const fallback = Date.now();
	const base = Number.isFinite(parsed) ? parsed : fallback;
	const ttl = Math.max(30, params.ttlMinutes == null ? 60 : params.ttlMinutes);
	return new Date(base + ttl * 60_000).toISOString();
}

function pickStableYieldCandidates(params: {
	markets: NearBurrowMarketRow[];
	stableSymbols: string[];
	includeDisabled: boolean;
	topN: number;
}): NearStableYieldCandidate[] {
	const stableSet = new Set(params.stableSymbols.map(normalizeStableSymbol));
	const eligible = params.markets.filter((market) => {
		if (!params.includeDisabled && !market.canDeposit) return false;
		if (!market.symbol) return false;
		return stableSet.has(normalizeStableSymbol(market.symbol));
	});

	const ranked = [...eligible].sort((left, right) => {
		const leftApr = parseApr(left.supplyApr) ?? Number.NEGATIVE_INFINITY;
		const rightApr = parseApr(right.supplyApr) ?? Number.NEGATIVE_INFINITY;
		if (rightApr !== leftApr) return rightApr - leftApr;
		return left.symbol.localeCompare(right.symbol);
	});

	return ranked.slice(0, params.topN).map((entry, index) => ({
		protocol: "Burrow",
		rank: index + 1,
		tokenId: entry.tokenId,
		symbol: entry.symbol,
		supplyApr: entry.supplyApr,
		canDeposit: entry.canDeposit,
		canWithdraw: entry.canWithdraw,
		suppliedUi: entry.suppliedUi,
		borrowedUi: entry.borrowedUi,
	}));
}

function buildStableYieldExecutionPlan(params: {
	selected: NearStableYieldCandidate | null;
	topN: number;
	planId: string;
	generatedAt: string;
	reasonPrefix: string;
}): NearStableYieldExecutionPlan {
	if (params.selected == null) {
		return {
			mode: "analysis-only",
			requiresAgentWallet: true,
			canAutoExecute: false,
			planId: `${params.planId}.hold`,
			proposalVersion: "v1",
			generatedAt: params.generatedAt,
			expiresAt: resolveStableYieldExpiryAt({
				generatedAt: params.generatedAt,
				ttlMinutes: 60,
			}),
			reasons: [
				`No eligible stablecoin candidate found with current scan filters. ${params.reasonPrefix}`,
			],
			guardrails: {
				maxProtocols: 1,
				cooldownSeconds: 3600,
			},
			proposedActions: [
				{
					action: "hold",
					actionId: `${params.planId}.hold`,
					protocol: "Burrow",
					step: 1,
					tokenId: null,
					symbol: null,
					asCollateral: true,
					allocationHint: "max-eligible",
					rationale:
						"No action can be proposed until a stable candidate is available.",
				},
			],
			recommendedApproach: "single-best-candidate",
			riskProfile: buildStableYieldExecutionRiskProfile({
				selected: params.selected,
			}),
		};
	}

	const aprText = params.selected.supplyApr ?? "n/a";
	return {
		mode: "analysis-only",
		requiresAgentWallet: true,
		canAutoExecute: false,
		planId: `${params.planId}.rank-1`,
		proposalVersion: "v1",
		generatedAt: params.generatedAt,
		expiresAt: resolveStableYieldExpiryAt({
			generatedAt: params.generatedAt,
			ttlMinutes: 60,
		}),
		reasons: [
			"Execution requires dedicated Agent Wallet/Vault, direct private-key signing disabled in workflow.",
			"Stable-yield plan is optimized for strategy review before execution.",
		],
		guardrails: {
			maxProtocols: 1,
			maxSlippageBps: 50,
			minimumAprDelta: 0.1,
			cooldownSeconds: 3600,
		},
		proposedActions: [
			{
				action: "supply",
				actionId: `${params.planId}.rank-1`,
				protocol: "Burrow",
				step: 1,
				tokenId: params.selected.tokenId,
				symbol: params.selected.symbol,
				asCollateral: true,
				allocationHint: "single-winner",
				rationale: `Top-${params.topN} scan winner with highest APR (${aprText}).`,
			},
		],
		recommendedApproach: "single-best-candidate",
		riskProfile: buildStableYieldExecutionRiskProfile({
			selected: params.selected,
		}),
	};
}

async function resolveStableYieldPlan(params: {
	network: string;
	rpcUrl?: string;
	burrowContractId: string;
	topN: number;
	stableSymbols: string[];
	includeDisabled: boolean;
}): Promise<NearStableYieldPlan> {
	const markets = await fetchBurrowAssetsPagedDetailed({
		network: params.network,
		rpcUrl: params.rpcUrl,
		burrowContractId: params.burrowContractId,
		fromIndex: 0,
		limit: 200,
	});
	const normalizedMarkets = markets
		.map(normalizeBurrowMarketAsset)
		.filter((entry): entry is BurrowAssetDetailedView => entry != null);
	const rows = await resolveBurrowMarketRows({
		network: params.network,
		rpcUrl: params.rpcUrl,
		markets: normalizedMarkets,
	});
	const candidates = pickStableYieldCandidates({
		markets: rows,
		stableSymbols: params.stableSymbols,
		includeDisabled: params.includeDisabled,
		topN: params.topN,
	});
	const selected = candidates[0] ?? null;
	const generatedAt = new Date().toISOString();
	const planId = buildStableYieldPlanId({
		network: params.network,
		burrowContractId: params.burrowContractId,
		topN: params.topN,
		stableSymbols: params.stableSymbols,
		includeDisabled: params.includeDisabled,
		selectedTokenId: selected?.tokenId ?? null,
	});
	return {
		network: params.network,
		protocol: "Burrow",
		topN: params.topN,
		stableSymbols: params.stableSymbols,
		includeDisabled: params.includeDisabled,
		status: "ready",
		generatedAt,
		planId,
		candidates,
		selected,
		allocationHint: selected
			? {
					tokenId: selected.tokenId,
					symbol: selected.symbol,
					asCollateral: true,
				}
			: null,
		executionPlan: buildStableYieldExecutionPlan({
			selected,
			topN: params.topN,
			planId,
			generatedAt,
			reasonPrefix: `Request from ${params.network} Burrow via ${params.burrowContractId}.`,
		}),
	};
}

async function resolveBurrowPositionAssetRows(params: {
	network: string;
	rpcUrl?: string;
	assets: BurrowAccountAssetView[];
	extraDecimalsByToken: Map<string, number>;
}): Promise<NearBurrowPositionAssetRow[]> {
	const metadataCache = new Map<string, Promise<NearFtMetadata | null>>();
	return await mapConcurrently(
		params.assets,
		8,
		async (asset): Promise<NearBurrowPositionAssetRow> => {
			const tokenId = asset.token_id.toLowerCase();
			const metadata = await resolveTokenMetadataCached(
				tokenId,
				metadataCache,
				{
					network: params.network,
					rpcUrl: params.rpcUrl,
				},
			);
			const rawDecimals =
				typeof metadata?.decimals === "number" ? metadata.decimals : null;
			const symbol =
				typeof metadata?.symbol === "string" && metadata.symbol.trim()
					? metadata.symbol.trim()
					: shortAccountId(tokenId);
			const extraDecimals =
				params.extraDecimalsByToken.get(tokenId) ?? parseBurrowExtraDecimals(0);
			const balanceInner = parseUnsignedBigInt(
				asset.balance,
				`${tokenId}.balance`,
			).toString();
			const shares = parseUnsignedBigInt(
				asset.shares,
				`${tokenId}.shares`,
			).toString();
			const balanceRaw = fromBurrowInnerAmount(balanceInner, extraDecimals);
			return {
				tokenId,
				symbol,
				rawDecimals,
				extraDecimals,
				balanceInner,
				shares,
				balanceRaw,
				balanceUi: formatBurrowAmountUi({
					rawAmount: balanceRaw,
					rawDecimals,
				}),
				apr: normalizeBurrowApr(asset.apr),
			};
		},
	);
}

export function createNearReadTools() {
	return [
		defineTool({
			name: `${NEAR_TOOL_PREFIX}checkSetup`,
			label: "NEAR Check Setup",
			description:
				"Check NEAR CLI installation and local wallet credentials. " +
				"Detects near-cli and ~/.near-credentials/ (or ~/.near/credentials/) automatically. " +
				"Returns diagnostic info: account id, private key availability, and setup instructions if missing. " +
				"Run this first before any execute operations.",
			parameters: Type.Object({
				network: nearNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const network = parseNearNetwork(params.network);
				const diag = checkNearCliCredentials(network);

				const lines: string[] = [];
				lines.push(`NEAR Setup Check (${network})`);
				lines.push(
					`near-cli installed: ${diag.nearCliInstalled ? "yes" : "NO"}`,
				);
				lines.push(`Credentials dir: ${diag.credentialsDir}`);
				lines.push(`Account found: ${diag.accountId ?? "none"}`);
				lines.push(`Private key: ${diag.hasPrivateKey ? "yes" : "NO"}`);
				lines.push("");
				lines.push(diag.hint);

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						schema: "near.check.setup.v1",
						network,
						nearCliInstalled: diag.nearCliInstalled,
						credentialsDir: diag.credentialsDir,
						accountId: diag.accountId,
						hasPrivateKey: diag.hasPrivateKey,
						found: diag.found,
						hint: diag.hint,
					},
				};
			},
		}),
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
				autoDiscoverDefiTokens: Type.Optional(
					Type.Boolean({
						description:
							"Auto-discover additional FT contracts from Ref deposits and Burrow positions (default true when ftContractIds is omitted).",
					}),
				),
				includeDefiBreakdown: Type.Optional(
					Type.Boolean({
						description:
							"Include Ref/Burrow quantity breakdown and wallet/ref/burrow/net summary (default follows autoDiscoverDefiTokens).",
					}),
				),
				includeValuationUsd: Type.Optional(
					Type.Boolean({
						description:
							"Estimate USD value using NEAR Intents token prices (default true, best-effort).",
					}),
				),
				valuationApiBaseUrl: Type.Optional(
					Type.String({
						description:
							"NEAR Intents API base URL override for valuation price feed (default https://1click.chaindefuser.com).",
					}),
				),
				valuationApiKey: Type.Optional(
					Type.String({
						description:
							"Optional API key for valuation price feed (fallback env NEAR_INTENTS_API_KEY).",
					}),
				),
				valuationJwt: Type.Optional(
					Type.String({
						description:
							"Optional JWT for valuation price feed (fallback env NEAR_INTENTS_JWT).",
					}),
				),
				valuationCacheTtlMs: Type.Optional(
					Type.Number({
						description:
							"Valuation token-price cache TTL in ms (default 30000; 0 disables cache).",
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
				const includeValuationUsd = params.includeValuationUsd !== false;
				const valuationCacheTtlMs = parsePortfolioValuationCacheTtlMs(
					params.valuationCacheTtlMs,
				);
				const baseFtContractIds = resolvePortfolioFtContracts({
					network,
					ftContractIds: params.ftContractIds,
				});
				const autoDiscoverDefiTokens =
					typeof params.autoDiscoverDefiTokens === "boolean"
						? params.autoDiscoverDefiTokens
						: !Array.isArray(params.ftContractIds) ||
							params.ftContractIds.length === 0;
				const includeDefiBreakdown =
					typeof params.includeDefiBreakdown === "boolean"
						? params.includeDefiBreakdown
						: autoDiscoverDefiTokens;
				const discovered = autoDiscoverDefiTokens
					? await discoverPortfolioFtContracts({
							accountId,
							network,
							rpcUrl: params.rpcUrl,
						})
					: {
							tokenIds: [],
							discoveredBySource: {
								refDeposits: [] as string[],
								burrowPositions: [] as string[],
							},
							discoveredByRole: {
								refDeposits: [] as string[],
								burrowSupplied: [] as string[],
								burrowCollateral: [] as string[],
								burrowBorrowed: [] as string[],
							} as NearPortfolioDiscoveryByRole,
							refDepositsRaw: {} as Record<string, string>,
							burrowSnapshot: null as BurrowAccountAllPositionsView | null,
							failures: [] as NearPortfolioDiscoveryFailure[],
						};
				const ftContractIds = dedupeStrings([
					...baseFtContractIds,
					...discovered.tokenIds,
				]);
				const discoveredSourcesByToken = new Map<
					string,
					Array<"refDeposits" | "burrowPositions">
				>();
				const addDiscoveredSource = (
					tokenId: string,
					source: "refDeposits" | "burrowPositions",
				) => {
					const key = tokenId.trim().toLowerCase();
					if (!key) return;
					const current = discoveredSourcesByToken.get(key) ?? [];
					if (!current.includes(source)) current.push(source);
					discoveredSourcesByToken.set(key, current);
				};
				for (const tokenId of discovered.discoveredBySource.refDeposits) {
					addDiscoveredSource(tokenId, "refDeposits");
				}
				for (const tokenId of discovered.discoveredBySource.burrowPositions) {
					addDiscoveredSource(tokenId, "burrowPositions");
				}

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
						priceUsd: null,
						estimatedUsd: null,
						valuationSourceAssetId: null,
						valuationPriceUpdatedAt: null,
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
						const discoveredSources =
							discoveredSourcesByToken.get(ftContractId.toLowerCase()) ?? [];
						if (
							!includeZero &&
							rawBalance === 0n &&
							discoveredSources.length === 0
						) {
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
							discoveredSources:
								discoveredSources.length > 0 ? discoveredSources : undefined,
							priceUsd: null,
							estimatedUsd: null,
							valuationSourceAssetId: null,
							valuationPriceUpdatedAt: null,
						});
					} catch (error) {
						failures.push({
							ftContractId,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}

				const valuation = {
					enabled: includeValuationUsd,
					currency: "USD" as const,
					source: "near_intents_tokens" as const,
					endpoint: null as string | null,
					httpStatus: null as number | null,
					tokenCount: 0,
					walletAssetCount: 0,
					pricedAssetCount: 0,
					pricedWalletAssetCount: 0,
					totalWalletUsd: null as number | null,
					assets: [] as NearPortfolioValuationAsset[],
					priceUpdatedAtLatest: null as string | null,
					priceUpdatedAtOldest: null as string | null,
					cache: {
						ttlMs: valuationCacheTtlMs,
						hit: false,
						ageMs: null as number | null,
					},
					error: null as string | null,
				};
				if (includeValuationUsd) {
					try {
						const baseUrl = resolveNearIntentsApiBaseUrl(
							params.valuationApiBaseUrl,
						);
						const headers = resolveNearIntentsHeaders({
							apiKey: params.valuationApiKey,
							jwt: params.valuationJwt,
						});
						const tokenResponse = await queryNearPortfolioValuationTokens({
							baseUrl,
							headers,
							cacheTtlMs: valuationCacheTtlMs,
						});
						const tokens = tokenResponse.tokens;
						valuation.endpoint = tokenResponse.endpoint;
						valuation.httpStatus = tokenResponse.httpStatus;
						valuation.tokenCount = tokens.length;
						valuation.cache.hit = tokenResponse.cacheHit;
						valuation.cache.ageMs = tokenResponse.cacheAgeMs;
						const priceIndex = buildNearPortfolioPriceIndex(tokens);
						valuation.walletAssetCount = assets.filter((asset) =>
							hasPositiveRawAmount(asset.rawAmount),
						).length;
						for (const asset of assets) {
							const resolved = resolvePortfolioAssetPrice({
								asset,
								priceIndex,
							});
							if (!resolved) continue;
							asset.priceUsd = resolved.priceUsd;
							asset.valuationSourceAssetId = resolved.sourceAssetId;
							asset.valuationMatchBy = resolved.matchBy;
							asset.valuationPriceUpdatedAt = resolved.priceUpdatedAt;
							asset.estimatedUsd = computePortfolioAssetEstimatedUsd(asset);
							valuation.pricedAssetCount += 1;
							if (hasPositiveRawAmount(asset.rawAmount)) {
								valuation.pricedWalletAssetCount += 1;
							}
							valuation.assets.push({
								symbol: asset.symbol,
								contractId: asset.contractId,
								rawAmount: asset.rawAmount,
								uiAmount: asset.uiAmount,
								priceUsd: resolved.priceUsd,
								estimatedUsd: asset.estimatedUsd,
								sourceAssetId: resolved.sourceAssetId,
								matchBy: resolved.matchBy,
								priceUpdatedAt: resolved.priceUpdatedAt,
							});
						}
						const priceUpdateTimes = valuation.assets
							.map((asset) => {
								const parsed = Date.parse(asset.priceUpdatedAt);
								return Number.isFinite(parsed) ? parsed : null;
							})
							.filter(
								(value): value is number =>
									typeof value === "number" && Number.isFinite(value),
							);
						if (priceUpdateTimes.length > 0) {
							const latest = Math.max(...priceUpdateTimes);
							const oldest = Math.min(...priceUpdateTimes);
							valuation.priceUpdatedAtLatest = new Date(latest).toISOString();
							valuation.priceUpdatedAtOldest = new Date(oldest).toISOString();
						}
						const walletUsdRows = valuation.assets
							.filter((asset) => hasPositiveRawAmount(asset.rawAmount))
							.map((asset) => asset.estimatedUsd)
							.filter(
								(value): value is number =>
									typeof value === "number" && Number.isFinite(value),
							);
						valuation.totalWalletUsd =
							walletUsdRows.length > 0
								? walletUsdRows.reduce((sum, value) => sum + value, 0)
								: null;
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						valuation.error =
							message.trim().length > 0
								? `price feed request failed: ${message}`
								: "price feed request failed";
					}
				}

				const lines = [
					`Portfolio: ${assets.length} assets (account ${accountId})`,
					`NEAR: ${formatNearAmount(totalYoctoNear, 8)} (available ${formatNearAmount(availableYoctoNear, 8)}, locked ${formatNearAmount(lockedYoctoNear, 8)})`,
				];
				const nativeAsset = assets[0] ?? null;
				const ftAssets = assets.filter(
					(asset): asset is NearPortfolioAsset =>
						asset.kind === "ft" && typeof asset.contractId === "string",
				);
				const symbolByTokenId = new Map<string, string>();
				const assetByTokenId = new Map<string, NearPortfolioAsset>();
				for (const asset of ftAssets) {
					if (!asset.contractId) continue;
					symbolByTokenId.set(asset.contractId.toLowerCase(), asset.symbol);
					assetByTokenId.set(asset.contractId.toLowerCase(), asset);
				}
				const walletFtAssets = ftAssets
					.filter((asset) => hasPositiveRawAmount(asset.rawAmount))
					.sort(comparePortfolioAssetsForDisplay);
				const walletNonZeroFtAssets = walletFtAssets.map((asset) => ({
					tokenId: asset.contractId as string,
					symbol: asset.symbol,
					rawAmount: asset.rawAmount,
					uiAmount: asset.uiAmount,
				}));
				const defiExposure = {
					refDeposits: buildPortfolioExposureRows(
						discovered.discoveredByRole.refDeposits,
						assetByTokenId,
					),
					burrowSupplied: buildPortfolioExposureRows(
						discovered.discoveredByRole.burrowSupplied,
						assetByTokenId,
					),
					burrowCollateral: buildPortfolioExposureRows(
						discovered.discoveredByRole.burrowCollateral,
						assetByTokenId,
					),
					burrowBorrowed: buildPortfolioExposureRows(
						discovered.discoveredByRole.burrowBorrowed,
						assetByTokenId,
					),
				};
				const defiBreakdown = {
					enabled: includeDefiBreakdown,
					refDeposits: [] as NearPortfolioDefiAmountRow[],
					burrowSupplied: [] as NearPortfolioDefiAmountRow[],
					burrowCollateral: [] as NearPortfolioDefiAmountRow[],
					burrowBorrowed: [] as NearPortfolioDefiAmountRow[],
					totals: {
						walletUsd:
							typeof valuation.totalWalletUsd === "number" &&
							Number.isFinite(valuation.totalWalletUsd)
								? valuation.totalWalletUsd
								: null,
						refDepositsUsd: null as number | null,
						burrowSuppliedUsd: null as number | null,
						burrowBorrowedUsd: null as number | null,
						netUsd: null as number | null,
						coverage: {
							refDeposits: {
								priced: 0,
								total: 0,
								fullyPriced: false,
							},
							burrowSupplied: {
								priced: 0,
								total: 0,
								fullyPriced: false,
							},
							burrowBorrowed: {
								priced: 0,
								total: 0,
								fullyPriced: false,
							},
						},
					},
					failures: [] as string[],
				};
				if (includeDefiBreakdown) {
					try {
						const refDepositsRaw = autoDiscoverDefiTokens
							? discovered.refDepositsRaw
							: await queryRefDeposits({
									accountId,
									network,
									rpcUrl: params.rpcUrl,
									refContractId: getRefContractId(network),
								});
						const refDepositMap = new Map<string, bigint>();
						for (const [tokenId, rawAmount] of Object.entries(refDepositsRaw)) {
							try {
								addRawAmountToMap(refDepositMap, tokenId, rawAmount);
							} catch {
								// Ignore malformed ref deposit amounts.
							}
						}
						defiBreakdown.refDeposits = buildPortfolioDefiAmountRows({
							tokenAmounts: refDepositMap,
							assetByTokenId,
						});
					} catch (error) {
						defiBreakdown.failures.push(
							`refDeposits: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					try {
						const burrowSnapshot = autoDiscoverDefiTokens
							? discovered.burrowSnapshot
							: await fetchBurrowAccountAllPositions({
									accountId,
									network,
									rpcUrl: params.rpcUrl,
									burrowContractId: getBurrowContractId(network),
								});
						const extraDecimalsByToken = new Map<string, number>();
						try {
							const burrowMarkets = await fetchBurrowAssetsPagedDetailed({
								network,
								rpcUrl: params.rpcUrl,
								burrowContractId: getBurrowContractId(network),
								fromIndex: 0,
								limit: 200,
							});
							for (const market of burrowMarkets) {
								const tokenId =
									typeof market?.token_id === "string"
										? market.token_id.trim().toLowerCase()
										: "";
								if (!tokenId) continue;
								extraDecimalsByToken.set(
									tokenId,
									parseBurrowExtraDecimals(market.config?.extra_decimals),
								);
							}
						} catch (error) {
							defiBreakdown.failures.push(
								`burrowExtraDecimals: ${error instanceof Error ? error.message : String(error)}`,
							);
						}
						const burrowRaw = collectBurrowRawAmountsByRole({
							snapshot: burrowSnapshot,
							extraDecimalsByToken,
						});
						defiBreakdown.burrowSupplied = buildPortfolioDefiAmountRows({
							tokenAmounts: burrowRaw.supplied,
							assetByTokenId,
						});
						defiBreakdown.burrowCollateral = buildPortfolioDefiAmountRows({
							tokenAmounts: burrowRaw.collateral,
							assetByTokenId,
						});
						defiBreakdown.burrowBorrowed = buildPortfolioDefiAmountRows({
							tokenAmounts: burrowRaw.borrowed,
							assetByTokenId,
						});
					} catch (error) {
						defiBreakdown.failures.push(
							`burrowPositions: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					const refTotals = summarizeDefiRowsUsd(defiBreakdown.refDeposits);
					const burrowSuppliedTotals = summarizeDefiRowsUsd(
						defiBreakdown.burrowSupplied,
					);
					const burrowBorrowedTotals = summarizeDefiRowsUsd(
						defiBreakdown.burrowBorrowed,
					);
					defiBreakdown.totals.refDepositsUsd = refTotals.totalUsd;
					defiBreakdown.totals.burrowSuppliedUsd =
						burrowSuppliedTotals.totalUsd;
					defiBreakdown.totals.burrowBorrowedUsd =
						burrowBorrowedTotals.totalUsd;
					defiBreakdown.totals.coverage.refDeposits = {
						priced: refTotals.pricedCount,
						total: refTotals.totalCount,
						fullyPriced: refTotals.fullyPriced,
					};
					defiBreakdown.totals.coverage.burrowSupplied = {
						priced: burrowSuppliedTotals.pricedCount,
						total: burrowSuppliedTotals.totalCount,
						fullyPriced: burrowSuppliedTotals.fullyPriced,
					};
					defiBreakdown.totals.coverage.burrowBorrowed = {
						priced: burrowBorrowedTotals.pricedCount,
						total: burrowBorrowedTotals.totalCount,
						fullyPriced: burrowBorrowedTotals.fullyPriced,
					};
					const walletUsd = defiBreakdown.totals.walletUsd;
					const refUsd = defiBreakdown.totals.refDepositsUsd;
					const suppliedUsd = defiBreakdown.totals.burrowSuppliedUsd;
					const borrowedUsd = defiBreakdown.totals.burrowBorrowedUsd;
					defiBreakdown.totals.netUsd =
						walletUsd != null &&
						refUsd != null &&
						suppliedUsd != null &&
						borrowedUsd != null
							? walletUsd + refUsd + suppliedUsd - borrowedUsd
							: null;
				}
				if (includeValuationUsd) {
					if (valuation.totalWalletUsd != null) {
						lines.push(
							`Estimated USD value (wallet): ${formatUsdOrFallback(valuation.totalWalletUsd)} (priced ${valuation.pricedWalletAssetCount}/${valuation.walletAssetCount} assets)`,
						);
						const walletAssetsByValue = [
							...(nativeAsset && hasPositiveRawAmount(nativeAsset.rawAmount)
								? [nativeAsset]
								: []),
							...walletFtAssets,
						]
							.filter(
								(asset): asset is NearPortfolioAsset =>
									typeof asset.estimatedUsd === "number" &&
									Number.isFinite(asset.estimatedUsd),
							)
							.sort(comparePortfolioAssetsForDisplay)
							.slice(0, 3)
							.map(
								(asset) =>
									`${asset.symbol} ${formatUsdOrFallback(asset.estimatedUsd as number)}`,
							);
						if (walletAssetsByValue.length > 0) {
							lines.push(
								`Top wallet assets by USD: ${walletAssetsByValue.join(", ")}`,
							);
						}
						if (valuation.priceUpdatedAtLatest) {
							lines.push(
								`Valuation prices as of: ${valuation.priceUpdatedAtLatest}`,
							);
						}
					} else if (valuation.error) {
						lines.push(
							`Estimated USD value (wallet): unavailable (${valuation.error})`,
						);
					} else {
						lines.push(
							"Estimated USD value (wallet): unavailable (no priced assets matched)",
						);
					}
				}
				lines.push("Wallet assets (>0):");
				lines.push(
					`- NEAR: ${formatNearAmount(totalYoctoNear, 8)}${nativeAsset?.estimatedUsd != null ? ` (~${formatUsdOrFallback(nativeAsset.estimatedUsd)})` : ""}`,
				);
				if (walletFtAssets.length === 0) {
					lines.push("- FT: none");
				} else {
					for (const asset of walletFtAssets) {
						const amountText =
							asset.uiAmount == null
								? `${asset.rawAmount} raw`
								: `${asset.uiAmount} (raw ${asset.rawAmount})`;
						const usdText =
							asset.estimatedUsd != null
								? ` (~${formatUsdOrFallback(asset.estimatedUsd)})`
								: "";
						lines.push(
							`- ${asset.symbol}: ${amountText}${usdText} on ${asset.contractId ?? "unknown"}`,
						);
					}
				}
				if (includeDefiBreakdown) {
					const formatUsdTotal = (value: number | null): string =>
						value == null ? "n/a" : formatUsdOrFallback(value);
					lines.push(
						`DeFi totals (USD): wallet=${formatUsdTotal(defiBreakdown.totals.walletUsd)} ref=${formatUsdTotal(defiBreakdown.totals.refDepositsUsd)} burrowSupplied=${formatUsdTotal(defiBreakdown.totals.burrowSuppliedUsd)} burrowBorrowed=${formatUsdTotal(defiBreakdown.totals.burrowBorrowedUsd)} net=${formatUsdTotal(defiBreakdown.totals.netUsd)}`,
					);
					lines.push("DeFi balances (amount / ~USD):");
					const sections: Array<{
						label: string;
						rows: NearPortfolioDefiAmountRow[];
					}> = [
						{
							label: "Ref deposits",
							rows: defiBreakdown.refDeposits,
						},
						{
							label: "Burrow supplied",
							rows: defiBreakdown.burrowSupplied,
						},
						{
							label: "Burrow collateral",
							rows: defiBreakdown.burrowCollateral,
						},
						{
							label: "Burrow borrowed",
							rows: defiBreakdown.burrowBorrowed,
						},
					];
					for (const section of sections) {
						if (section.rows.length === 0) {
							lines.push(`- ${section.label}: none`);
							continue;
						}
						const topRows = section.rows
							.slice(0, 6)
							.map((row) => formatPortfolioDefiAmountRow(row));
						const rest =
							section.rows.length > topRows.length
								? ` (+${section.rows.length - topRows.length} more)`
								: "";
						lines.push(`- ${section.label}: ${topRows.join(", ")}${rest}`);
					}
					if (defiBreakdown.failures.length > 0) {
						lines.push(
							`DeFi breakdown partial: ${defiBreakdown.failures.join(" | ")}`,
						);
					}
				}
				if (autoDiscoverDefiTokens) {
					lines.push(
						`Auto-discovered DeFi tokens: ${discovered.tokenIds.length} (Ref=${discovered.discoveredBySource.refDeposits.length}, Burrow=${discovered.discoveredBySource.burrowPositions.length})`,
					);
					lines.push(
						`DeFi exposure: Ref deposits ${discovered.discoveredByRole.refDeposits.length} (${summarizeTokenIdsForReadableLine(
							discovered.discoveredByRole.refDeposits,
							symbolByTokenId,
						)}); Burrow supplied ${discovered.discoveredByRole.burrowSupplied.length} (${summarizeTokenIdsForReadableLine(
							discovered.discoveredByRole.burrowSupplied,
							symbolByTokenId,
						)}); collateral ${discovered.discoveredByRole.burrowCollateral.length} (${summarizeTokenIdsForReadableLine(
							discovered.discoveredByRole.burrowCollateral,
							symbolByTokenId,
						)}); borrowed ${discovered.discoveredByRole.burrowBorrowed.length} (${summarizeTokenIdsForReadableLine(
							discovered.discoveredByRole.burrowBorrowed,
							symbolByTokenId,
						)}).`,
					);
					lines.push("DeFi tracked tokens:");
					lines.push(
						`- Ref deposits: ${summarizePortfolioRoleTokens(
							discovered.discoveredByRole.refDeposits,
							assetByTokenId,
						)}`,
					);
					lines.push(
						`- Burrow supplied: ${summarizePortfolioRoleTokens(
							discovered.discoveredByRole.burrowSupplied,
							assetByTokenId,
						)}`,
					);
					lines.push(
						`- Burrow collateral: ${summarizePortfolioRoleTokens(
							discovered.discoveredByRole.burrowCollateral,
							assetByTokenId,
						)}`,
					);
					lines.push(
						`- Burrow borrowed: ${summarizePortfolioRoleTokens(
							discovered.discoveredByRole.burrowBorrowed,
							assetByTokenId,
						)}`,
					);
				}
				lines.push("Asset details:");
				const ftAssetsSorted = [...ftAssets].sort(
					comparePortfolioAssetsForDisplay,
				);
				for (const asset of ftAssetsSorted) {
					const amountText =
						asset.uiAmount == null
							? `${asset.rawAmount} raw`
							: `${asset.uiAmount} (raw ${asset.rawAmount})`;
					const sourceText =
						Array.isArray(asset.discoveredSources) &&
						asset.discoveredSources.length > 0
							? ` [discovered in ${asset.discoveredSources
									.map((source) =>
										source === "refDeposits" ? "Ref" : "Burrow",
									)
									.join("+")}]`
							: "";
					const valuationText =
						asset.priceUsd != null
							? ` [price=$${asset.priceUsd.toLocaleString(undefined, {
									maximumFractionDigits: 8,
								})}${asset.estimatedUsd != null ? ` est=${formatUsdOrFallback(asset.estimatedUsd)}` : ""}]`
							: "";
					lines.push(
						`- ${asset.symbol}: ${amountText} on ${asset.contractId ?? "unknown"}${sourceText}${valuationText}`,
					);
				}
				if (failures.length > 0) {
					lines.push(
						`Skipped ${failures.length} token(s) due to query errors.`,
					);
				}
				if (discovered.failures.length > 0) {
					lines.push(
						`Discovery skipped for ${discovered.failures.length} source(s) due to query errors.`,
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
						baseFtContracts: baseFtContractIds,
						autoDiscoverDefiTokens,
						discoveredFtContracts: discovered.tokenIds,
						discoveredBySource: discovered.discoveredBySource,
						discoveredByRole: discovered.discoveredByRole,
						walletNonZeroFtAssets,
						defiExposure,
						defiBreakdown,
						valuation,
						discoveryFailures: discovered.failures,
						includeZeroBalances: includeZero,
						includeDefiBreakdown,
						includeValuationUsd,
						valuationCacheTtlMs,
						totalYoctoNear: totalYoctoNear.toString(),
						availableYoctoNear: availableYoctoNear.toString(),
						lockedYoctoNear: lockedYoctoNear.toString(),
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getLendingMarketsBurrow`,
			label: "NEAR Burrow Lending Markets",
			description:
				"List Burrow lending markets with deposit/borrow capability and utilization snapshots.",
			parameters: Type.Object({
				burrowContractId: Type.Optional(
					Type.String({
						description:
							"Burrow contract id override (default contract.main.burrow.near).",
					}),
				),
				fromIndex: Type.Optional(
					Type.Number({
						description: "Paging from_index for Burrow assets (default 0).",
					}),
				),
				limit: Type.Optional(
					Type.Number({
						description: "Paging limit (default 30, max 200).",
					}),
				),
				includeDisabled: Type.Optional(
					Type.Boolean({
						description:
							"Include markets where all deposit/withdraw/borrow capabilities are disabled.",
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
				const burrowContractId = getBurrowContractId(
					network,
					params.burrowContractId,
				);
				const fromIndex =
					typeof params.fromIndex === "number" &&
					Number.isFinite(params.fromIndex) &&
					params.fromIndex >= 0
						? Math.floor(params.fromIndex)
						: 0;
				const limit =
					typeof params.limit === "number" &&
					Number.isFinite(params.limit) &&
					params.limit > 0
						? Math.min(200, Math.floor(params.limit))
						: 30;
				const includeDisabled = params.includeDisabled === true;
				const assetsRaw = await fetchBurrowAssetsPagedDetailed({
					network,
					rpcUrl: params.rpcUrl,
					burrowContractId,
					fromIndex,
					limit,
				});
				const normalizedAssets = assetsRaw
					.map(normalizeBurrowMarketAsset)
					.filter((entry): entry is BurrowAssetDetailedView => entry != null);
				const rowsAll = await resolveBurrowMarketRows({
					network,
					rpcUrl: params.rpcUrl,
					markets: normalizedAssets,
				});
				const rows = includeDisabled
					? rowsAll
					: rowsAll.filter(
							(entry) =>
								entry.canDeposit || entry.canWithdraw || entry.canBorrow,
						);

				const lines = [
					`Burrow lending markets: ${rows.length} shown / ${rowsAll.length} fetched (contract ${burrowContractId})`,
				];
				if (rows.length === 0) {
					lines.push("No market matched current filters.");
				}
				for (const [index, row] of rows.entries()) {
					const suppliedText =
						row.suppliedUi == null
							? `${row.suppliedRaw} raw`
							: `${row.suppliedUi} (raw ${row.suppliedRaw})`;
					const borrowedText =
						row.borrowedUi == null
							? `${row.borrowedRaw} raw`
							: `${row.borrowedUi} (raw ${row.borrowedRaw})`;
					const capability = [
						row.canDeposit ? "deposit" : null,
						row.canWithdraw ? "withdraw" : null,
						row.canBorrow ? "borrow" : null,
						row.canUseAsCollateral ? "collateral" : null,
					]
						.filter((item): item is string => item != null)
						.join("/");
					lines.push(
						`${index + 1}. ${row.symbol} [${capability || "no-capability"}] supplyAPR=${row.supplyApr ?? "n/a"} borrowAPR=${row.borrowApr ?? "n/a"}`,
					);
					lines.push(`   supplied: ${suppliedText}; borrowed: ${borrowedText}`);
					lines.push(`   tokenId: ${row.tokenId}`);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						network,
						rpcEndpoint: endpoint,
						burrowContractId,
						fromIndex,
						limit,
						includeDisabled,
						markets: rows,
						fetchedCount: rowsAll.length,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getStableYieldPlan`,
			label: "NEAR Stable Yield Plan",
			description:
				"Analyse stablecoins with highest supply APR on supported lending markets and return a strategy plan for review/execution readiness.",
			parameters: Type.Object({
				burrowContractId: Type.Optional(
					Type.String({
						description:
							"Burrow contract id override (default contract.main.burrow.near).",
					}),
				),
				stableSymbols: Type.Optional(
					Type.Array(
						Type.String({
							description: "Optional stablecoin symbols to consider.",
						}),
					),
				),
				topN: Type.Optional(
					Type.Number({
						minimum: 1,
						maximum: 20,
						default: 3,
					}),
				),
				includeDisabled: Type.Optional(
					Type.Boolean({
						description:
							"Include non-deposit-capable entries in scan (default false).",
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
				const burrowContractId = getBurrowContractId(
					network,
					params.burrowContractId,
				);
				const topN = parseTopN(params.topN);
				const stableSymbols = parseStableSymbolHints(params.stableSymbols);
				const includeDisabled = params.includeDisabled === true;
				const plan = await resolveStableYieldPlan({
					network,
					rpcUrl: params.rpcUrl,
					burrowContractId,
					topN,
					stableSymbols,
					includeDisabled,
				});
				const lines = [
					`NEAR stable yield plan (${network}): protocol=${plan.protocol} contract=${burrowContractId}`,
					`stableSymbols=${plan.stableSymbols.join(",")} includeDisabled=${includeDisabled} topN=${topN}`,
				];
				if (plan.selected == null) {
					lines.push("No eligible stablecoin markets found.");
				} else {
					lines.push(
						`Recommended: #${plan.selected.rank} ${plan.selected.symbol} (${plan.selected.tokenId}) supplyAPR=${plan.selected.supplyApr ?? "n/a"}`,
					);
				}
				for (const candidate of plan.candidates) {
					lines.push(
						`${candidate.rank}. ${candidate.symbol} (${candidate.tokenId}) supplyAPR=${candidate.supplyApr ?? "n/a"} deposit=${candidate.canDeposit ? "yes" : "no"}`,
					);
				}
				if (plan.executionPlan.canAutoExecute === false) {
					lines.push(
						`Execution mode: ${plan.executionPlan.mode} (requires vault: ${plan.executionPlan.requiresAgentWallet ? "yes" : "no"})`,
					);
					for (const reason of plan.executionPlan.reasons) {
						lines.push(`- ${reason}`);
					}
					for (const action of plan.executionPlan.proposedActions) {
						lines.push(
							`Action ${action.step}: ${action.action} ${action.symbol ?? "asset"} protocol=${action.protocol}`,
						);
					}
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						schema: "near.defi.stableYieldPlan.v1",
						rpcEndpoint: endpoint,
						burrowContractId,
						...plan,
					},
				};
			},
		}),
		defineTool({
			name: `${NEAR_TOOL_PREFIX}getLendingPositionsBurrow`,
			label: "NEAR Burrow Lending Positions",
			description:
				"Get Burrow lending position snapshot (supplied/collateral/borrowed) for one account.",
			parameters: Type.Object({
				accountId: Type.Optional(
					Type.String({
						description:
							"NEAR account id. If omitted, resolve from env/credentials.",
					}),
				),
				burrowContractId: Type.Optional(
					Type.String({
						description:
							"Burrow contract id override (default contract.main.burrow.near).",
					}),
				),
				includeZeroBalances: Type.Optional(
					Type.Boolean({
						description:
							"Include zero-balance assets in sections (default false).",
					}),
				),
				includeValuationUsd: Type.Optional(
					Type.Boolean({
						description:
							"Include USD valuation via NEAR Intents /v0/tokens feed (default true).",
					}),
				),
				valuationApiBaseUrl: Type.Optional(
					Type.String({
						description:
							"NEAR Intents API base URL override for valuation price feed (default https://1click.chaindefuser.com).",
					}),
				),
				valuationApiKey: Type.Optional(
					Type.String({
						description:
							"Optional API key for valuation price feed (fallback env NEAR_INTENTS_API_KEY).",
					}),
				),
				valuationJwt: Type.Optional(
					Type.String({
						description:
							"Optional JWT for valuation price feed (fallback env NEAR_INTENTS_JWT).",
					}),
				),
				valuationCacheTtlMs: Type.Optional(
					Type.Number({
						description:
							"Cache TTL (ms) for valuation token feed reuse in process (default 30000).",
					}),
				),
				riskWarningRatio: Type.Optional(
					Type.Number({
						description:
							"Borrow/collateral warning threshold ratio (default 0.6).",
					}),
				),
				riskCriticalRatio: Type.Optional(
					Type.Number({
						description:
							"Borrow/collateral critical threshold ratio (default 0.85). Must be greater than riskWarningRatio.",
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
				const burrowContractId = getBurrowContractId(
					network,
					params.burrowContractId,
				);
				const includeZero = params.includeZeroBalances === true;
				const includeValuationUsd = params.includeValuationUsd !== false;
				const valuationCacheTtlMs = parsePortfolioValuationCacheTtlMs(
					params.valuationCacheTtlMs,
				);
				const riskThresholds = parseBurrowRiskThresholds({
					warningRatio: params.riskWarningRatio,
					criticalRatio: params.riskCriticalRatio,
				});
				const snapshotRaw = await fetchBurrowAccountAllPositions({
					network,
					rpcUrl: params.rpcUrl,
					burrowContractId,
					accountId,
				});
				const snapshot = normalizeBurrowAccountPositions(snapshotRaw);
				if (!snapshot) {
					return {
						content: [
							{
								type: "text",
								text: `Burrow positions: account ${accountId} is not registered on ${burrowContractId}.`,
							},
						],
						details: {
							accountId,
							network,
							rpcEndpoint: endpoint,
							burrowContractId,
							registered: false,
						},
					};
				}

				const markets = await fetchBurrowAssetsPagedDetailed({
					network,
					rpcUrl: params.rpcUrl,
					burrowContractId,
					fromIndex: 0,
					limit: 256,
				});
				const extraDecimalsByToken = new Map<string, number>();
				for (const market of markets) {
					const normalized = normalizeBurrowMarketAsset(market);
					if (!normalized) continue;
					extraDecimalsByToken.set(
						normalized.token_id.toLowerCase(),
						parseBurrowExtraDecimals(normalized.config?.extra_decimals),
					);
				}

				const suppliedAssetsInput = Array.isArray(snapshot.supplied)
					? snapshot.supplied
							.map(normalizeBurrowAccountAssetView)
							.filter((entry): entry is BurrowAccountAssetView => entry != null)
					: [];
				const suppliedAssetsAll = await resolveBurrowPositionAssetRows({
					network,
					rpcUrl: params.rpcUrl,
					assets: suppliedAssetsInput,
					extraDecimalsByToken,
				});
				const suppliedAssets = includeZero
					? suppliedAssetsAll
					: suppliedAssetsAll.filter(
							(asset) =>
								parseUnsignedBigInt(asset.balanceRaw, "balanceRaw") > 0n,
						);

				const positions: NearBurrowPositionView[] = [];
				const collateralRowsAll: NearBurrowPositionAssetRow[] = [];
				const borrowedRowsAll: NearBurrowPositionAssetRow[] = [];
				const positionEntries = snapshot.positions ?? {};
				for (const [positionId, positionNode] of Object.entries(
					positionEntries,
				)) {
					const normalizedPosition = normalizeBurrowPositionNode(positionNode);
					if (!normalizedPosition) continue;
					const collateralAll = await resolveBurrowPositionAssetRows({
						network,
						rpcUrl: params.rpcUrl,
						assets: normalizedPosition.collateral ?? [],
						extraDecimalsByToken,
					});
					const borrowedAll = await resolveBurrowPositionAssetRows({
						network,
						rpcUrl: params.rpcUrl,
						assets: normalizedPosition.borrowed ?? [],
						extraDecimalsByToken,
					});
					collateralRowsAll.push(...collateralAll);
					borrowedRowsAll.push(...borrowedAll);
					const collateral = includeZero
						? collateralAll
						: collateralAll.filter(
								(asset) =>
									parseUnsignedBigInt(asset.balanceRaw, "balanceRaw") > 0n,
							);
					const borrowed = includeZero
						? borrowedAll
						: borrowedAll.filter(
								(asset) =>
									parseUnsignedBigInt(asset.balanceRaw, "balanceRaw") > 0n,
							);
					positions.push({
						positionId,
						collateral,
						borrowed,
					});
				}
				positions.sort((left, right) =>
					left.positionId.localeCompare(right.positionId),
				);
				const valuation = {
					enabled: includeValuationUsd,
					endpoint: null as string | null,
					httpStatus: null as number | null,
					tokenCount: null as number | null,
					cache: {
						hit: null as boolean | null,
						ageMs: null as number | null,
						ttlMs: valuationCacheTtlMs,
					},
					suppliedUsd: null as number | null,
					collateralUsd: null as number | null,
					borrowedUsd: null as number | null,
					pricedRowCount: 0,
					unpricedRowCount: 0,
					priceUpdatedAtLatest: null as string | null,
					priceUpdatedAtOldest: null as string | null,
					error: null as string | null,
				};
				if (includeValuationUsd) {
					try {
						const valuationApiBaseUrl = resolveNearIntentsApiBaseUrl(
							params.valuationApiBaseUrl,
						);
						const tokenResponse = await queryNearPortfolioValuationTokens({
							baseUrl: valuationApiBaseUrl,
							headers: resolveNearIntentsHeaders({
								apiKey: params.valuationApiKey,
								jwt: params.valuationJwt,
							}),
							cacheTtlMs: valuationCacheTtlMs,
						});
						valuation.endpoint = tokenResponse.endpoint;
						valuation.httpStatus = tokenResponse.httpStatus;
						valuation.tokenCount = tokenResponse.tokens.length;
						valuation.cache.hit = tokenResponse.cacheHit;
						valuation.cache.ageMs = tokenResponse.cacheAgeMs;

						const priceIndex = buildNearPortfolioPriceIndex(
							tokenResponse.tokens,
						);
						const suppliedValuation = summarizeBurrowRowsValuationUsd({
							rows: suppliedAssetsAll,
							priceIndex,
						});
						const collateralValuation = summarizeBurrowRowsValuationUsd({
							rows: collateralRowsAll,
							priceIndex,
						});
						const borrowedValuation = summarizeBurrowRowsValuationUsd({
							rows: borrowedRowsAll,
							priceIndex,
						});
						valuation.suppliedUsd = suppliedValuation.totalUsd;
						valuation.collateralUsd = collateralValuation.totalUsd;
						valuation.borrowedUsd = borrowedValuation.totalUsd;
						valuation.pricedRowCount =
							suppliedValuation.pricedRowCount +
							collateralValuation.pricedRowCount +
							borrowedValuation.pricedRowCount;
						valuation.unpricedRowCount =
							suppliedValuation.unpricedRowCount +
							collateralValuation.unpricedRowCount +
							borrowedValuation.unpricedRowCount;

						const valuationUpdatedTimes = [
							suppliedValuation.priceUpdatedAtLatest,
							suppliedValuation.priceUpdatedAtOldest,
							collateralValuation.priceUpdatedAtLatest,
							collateralValuation.priceUpdatedAtOldest,
							borrowedValuation.priceUpdatedAtLatest,
							borrowedValuation.priceUpdatedAtOldest,
						]
							.filter(
								(value): value is string =>
									typeof value === "string" && value.length > 0,
							)
							.map((value) => Date.parse(value))
							.filter((value) => !Number.isNaN(value));
						if (valuationUpdatedTimes.length > 0) {
							const latest = Math.max(...valuationUpdatedTimes);
							const oldest = Math.min(...valuationUpdatedTimes);
							valuation.priceUpdatedAtLatest = new Date(latest).toISOString();
							valuation.priceUpdatedAtOldest = new Date(oldest).toISOString();
						}
					} catch (error) {
						valuation.error =
							error instanceof Error ? error.message : String(error);
					}
				}
				const riskSummary = buildBurrowRiskSummary({
					suppliedRows: suppliedAssetsAll,
					collateralRows: collateralRowsAll,
					borrowedRows: borrowedRowsAll,
					accountLocked: snapshot.is_locked === true,
					warningRatio: riskThresholds.warningRatio,
					criticalRatio: riskThresholds.criticalRatio,
					valuation: includeValuationUsd
						? {
								suppliedUsd: valuation.suppliedUsd,
								collateralUsd: valuation.collateralUsd,
								borrowedUsd: valuation.borrowedUsd,
								pricedRowCount: valuation.pricedRowCount,
								unpricedRowCount: valuation.unpricedRowCount,
								priceUpdatedAtLatest: valuation.priceUpdatedAtLatest,
								error: valuation.error,
							}
						: undefined,
				});

				const lines = [
					`Burrow positions: account ${accountId} on ${burrowContractId}`,
					`Supplied assets: ${suppliedAssets.length}`,
					`Risk: ${riskSummary.level} (supplied=${riskSummary.suppliedAssetCount}, collateral=${riskSummary.collateralAssetCount}, borrowed=${riskSummary.borrowedAssetCount})`,
				];
				if (includeValuationUsd) {
					lines.push(
						`Risk thresholds: warning >=${formatBurrowRatioPercent(riskSummary.warningRatio)}, critical >=${formatBurrowRatioPercent(riskSummary.criticalRatio)}`,
					);
					if (
						riskSummary.suppliedUsd != null ||
						riskSummary.collateralUsd != null ||
						riskSummary.borrowedUsd != null
					) {
						const suppliedUsdText =
							riskSummary.suppliedUsd == null
								? "n/a"
								: formatUsdOrFallback(riskSummary.suppliedUsd);
						const collateralUsdText =
							riskSummary.collateralUsd == null
								? "n/a"
								: formatUsdOrFallback(riskSummary.collateralUsd);
						const borrowedUsdText =
							riskSummary.borrowedUsd == null
								? "n/a"
								: formatUsdOrFallback(riskSummary.borrowedUsd);
						lines.push(
							`Risk USD: supplied=${suppliedUsdText}, collateral=${collateralUsdText}, borrowed=${borrowedUsdText}`,
						);
					} else if (riskSummary.valuationError) {
						lines.push(`Risk USD: unavailable (${riskSummary.valuationError})`);
					}
					if (riskSummary.borrowToCollateralRatio != null) {
						lines.push(
							`Borrow/Collateral: ${formatBurrowRatioPercent(riskSummary.borrowToCollateralRatio)}`,
						);
						lines.push(`Risk band: ${riskSummary.borrowToCollateralBand}`);
						if (riskSummary.warningHeadroomRatio != null) {
							if (riskSummary.warningHeadroomRatio >= 0) {
								lines.push(
									`Headroom to warning: ${formatBurrowRatioPercent(riskSummary.warningHeadroomRatio)}`,
								);
							} else {
								lines.push(
									`Above warning by: ${formatBurrowRatioPercent(Math.abs(riskSummary.warningHeadroomRatio))}`,
								);
							}
						}
						if (riskSummary.criticalHeadroomRatio != null) {
							if (riskSummary.criticalHeadroomRatio >= 0) {
								lines.push(
									`Headroom to critical: ${formatBurrowRatioPercent(riskSummary.criticalHeadroomRatio)}`,
								);
							} else {
								lines.push(
									`Above critical by: ${formatBurrowRatioPercent(Math.abs(riskSummary.criticalHeadroomRatio))}`,
								);
							}
						}
					}
					if (
						riskSummary.valuationPricedRowCount > 0 ||
						riskSummary.valuationUnpricedRowCount > 0
					) {
						lines.push(
							`Valuation coverage: priced ${riskSummary.valuationPricedRowCount} rows, unpriced ${riskSummary.valuationUnpricedRowCount} rows`,
						);
					}
					if (riskSummary.valuationPriceUpdatedAtLatest) {
						lines.push(
							`Valuation prices as of: ${riskSummary.valuationPriceUpdatedAtLatest}`,
						);
					}
				}
				for (const asset of suppliedAssets) {
					const amountText =
						asset.balanceUi == null
							? `${asset.balanceRaw} raw`
							: `${asset.balanceUi} (raw ${asset.balanceRaw})`;
					lines.push(
						`- Supply ${asset.symbol}: ${amountText} shares=${asset.shares}`,
					);
				}
				for (const position of positions) {
					lines.push(
						`Position ${position.positionId}: collateral ${position.collateral.length}, borrowed ${position.borrowed.length}`,
					);
					for (const collateral of position.collateral) {
						const amountText =
							collateral.balanceUi == null
								? `${collateral.balanceRaw} raw`
								: `${collateral.balanceUi} (raw ${collateral.balanceRaw})`;
						lines.push(
							`  collateral ${collateral.symbol}: ${amountText} shares=${collateral.shares}`,
						);
					}
					for (const borrowed of position.borrowed) {
						const amountText =
							borrowed.balanceUi == null
								? `${borrowed.balanceRaw} raw`
								: `${borrowed.balanceUi} (raw ${borrowed.balanceRaw})`;
						lines.push(
							`  borrowed ${borrowed.symbol}: ${amountText} shares=${borrowed.shares}`,
						);
					}
				}
				for (const note of riskSummary.notes) {
					lines.push(`Risk note: ${note}`);
				}
				const hasDisplayedExposure =
					suppliedAssets.length > 0 ||
					positions.some(
						(position) =>
							position.collateral.length > 0 || position.borrowed.length > 0,
					);
				if (!hasDisplayedExposure) {
					lines.push("No non-zero supplied/collateral/borrowed assets found.");
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						accountId,
						network,
						rpcEndpoint: endpoint,
						burrowContractId,
						includeZeroBalances: includeZero,
						includeValuationUsd,
						riskThresholds,
						registered: true,
						positions,
						supplied: suppliedAssets,
						isLocked: snapshot.is_locked === true,
						riskSummary,
						valuation,
						raw: snapshot,
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
