import { Wallet } from "@ethersproject/wallet";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	evaluateEvmTransferPolicy,
	isMainnetLikeEvmNetwork,
} from "../policy.js";
import {
	evaluateBtc5mTradeGuards,
	getPolymarketClobBaseUrl,
	getPolymarketGeoblockStatus,
	getPolymarketMarketBySlug,
	getPolymarketOrderBook,
	parseUsdStake,
	resolveBtc5mTradeSelection,
} from "../polymarket.js";
import {
	EVM_TOOL_PREFIX,
	type EvmNetwork,
	evmHttpJson,
	evmNetworkSchema,
	getEvmChainId,
	getEvmRpcEndpoint,
	parseEvmNetwork,
	parsePositiveIntegerString,
	parsePositiveNumber,
	stringifyUnknown,
} from "../runtime.js";

type ClobApiKeyCreds = {
	key: string;
	secret: string;
	passphrase: string;
};

type ClobOpenOrder = {
	id: string;
	status: string;
	market: string;
	asset_id: string;
	side: string;
	original_size: string;
	size_matched: string;
	price: string;
	outcome: string;
	created_at: number;
	order_type: string;
	associate_trades?: string[];
};

type ClobOrderFilter = {
	id?: string;
	market?: string;
	asset_id?: string;
};

type ClobTradeFilter = {
	id?: string;
	market?: string;
	asset_id?: string;
	maker_address?: string;
};

type ClobTrade = {
	id: string;
	taker_order_id: string;
	market: string;
	asset_id: string;
	side: string;
	size: string;
	price: string;
	status: string;
	match_time: string;
	transaction_hash: string;
};

type ClobClientLike = {
	createOrDeriveApiKey?: () => Promise<ClobApiKeyCreds>;
	createAndPostOrder?: (
		order: {
			tokenID: string;
			price: number;
			side: unknown;
			size: number;
		},
		marketInfo: { tickSize: string; negRisk: boolean },
		orderType: unknown,
	) => Promise<unknown>;
	getOpenOrders?: (
		params?: ClobOrderFilter,
		onlyFirstPage?: boolean,
		nextCursor?: string,
	) => Promise<ClobOpenOrder[]>;
	getOrder?: (orderID: string) => Promise<ClobOpenOrder>;
	getTrades?: (
		params?: ClobTradeFilter,
		onlyFirstPage?: boolean,
		nextCursor?: string,
	) => Promise<ClobTrade[]>;
	cancelOrder?: (payload: { orderID: string }) => Promise<unknown>;
	cancelOrders?: (orderIds: string[]) => Promise<unknown>;
	cancelAll?: () => Promise<unknown>;
	cancelMarketOrders?: (payload: {
		market?: string;
		asset_id?: string;
	}) => Promise<unknown>;
};

type ClobClientModule = {
	ClobClient: new (...args: unknown[]) => ClobClientLike;
	Side: Record<string, unknown>;
	OrderType: Record<string, unknown>;
};

type ClobClientAuthParams = {
	fromPrivateKey?: string;
	funder?: string;
	apiKey?: string;
	apiSecret?: string;
	apiPassphrase?: string;
	signatureType?: number;
};

type PancakeV2SwapRouteConfig = {
	chainId: number;
	factoryAddress: string;
	routerAddress: string;
	wrappedNativeAddress: string;
};

const PANCAKE_V2_NETWORK_CONFIG: Partial<
	Record<EvmNetwork, PancakeV2SwapRouteConfig>
> = {
	bsc: {
		chainId: 56,
		factoryAddress: "0xca143ce32fe78f1f7019d7d551a6402fc5350c73",
		routerAddress: "0x10ed43c718714eb63d5aa57b78b54704e256024e",
		wrappedNativeAddress: "0xbb4cdb9cbd36b01bd1cbaeBF2de08d9173bc095c",
	},
};

const PANCAKE_V2_SELECTOR_GET_PAIR = "0xe6a43905";
const PANCAKE_V2_SELECTOR_TOKEN0 = "0x0dfe1681";
const PANCAKE_V2_SELECTOR_TOKEN1 = "0xd21220a7";
const PANCAKE_V2_SELECTOR_GET_RESERVES = "0x0902f1ac";
const PANCAKE_V2_SELECTOR_SWAP_EXACT_TOKENS_FOR_TOKENS = "0x38ed1739";
const PANCAKE_V2_SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS = "0x7ff36ab5";
const PANCAKE_V2_SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH = "0x18cbafe5";

function resolvePancakeV2Config(network: EvmNetwork): PancakeV2SwapRouteConfig {
	const config = PANCAKE_V2_NETWORK_CONFIG[network];
	if (!config) {
		throw new Error(
			`PancakeSwap v2 execution is only supported on BSC in this toolset. Current network=${network}`,
		);
	}
	return config;
}

function toNormalizedAddress(address: string): string {
	return address.toLowerCase();
}

function toAddressWord(address: string): string {
	return toNormalizedAddress(address).replace(/^0x/, "").padStart(64, "0");
}

function toUint256Word(value: bigint): string {
	if (value < 0n) {
		throw new Error("amount/value cannot be negative");
	}
	return value.toString(16).padStart(64, "0");
}

function isZeroAddress(address: string): boolean {
	return /^0x0{40}$/i.test(address);
}

function parseUint256Word(value: string): bigint {
	const normalized = value.startsWith("0x")
		? value.slice(2).replace(/^0x/i, "")
		: value;
	if (!normalized) return 0n;
	return BigInt(`0x${normalized}`);
}

function parseAddressWord(value: string): string {
	const normalized = value.startsWith("0x") ? value.slice(2) : value;
	const address = normalized.slice(-40);
	return `0x${address}`;
}

function encodeAddressList(path: string[]): string {
	return `${toUint256Word(BigInt(path.length))}${path
		.map((entry) => toAddressWord(entry))
		.join("")}`;
}

async function callEvmContract(params: {
	rpcUrl: string;
	toAddress: string;
	data: string;
}): Promise<string> {
	return callEvmRpc<string>(params.rpcUrl, "eth_call", [
		{ to: params.toAddress, data: params.data },
		"latest",
	]);
}

function buildEvmCallPancakeGetPair(params: {
	tokenInAddress: string;
	tokenOutAddress: string;
}): string {
	return `${PANCAKE_V2_SELECTOR_GET_PAIR}${toAddressWord(params.tokenInAddress)}${toAddressWord(params.tokenOutAddress)}`;
}

function buildSwapExactTokensForTokensData(params: {
	amountInRaw: bigint;
	amountOutMinRaw: bigint;
	path: [string, string];
	toAddress: string;
	deadlineSeconds: number;
}): string {
	const pathData = encodeAddressList(params.path);
	const deadline = BigInt(Math.trunc(params.deadlineSeconds));
	const head = [
		toUint256Word(params.amountInRaw),
		toUint256Word(params.amountOutMinRaw),
		toUint256Word(0xa0n),
		toAddressWord(params.toAddress),
		toUint256Word(deadline),
	].join("");
	return `${PANCAKE_V2_SELECTOR_SWAP_EXACT_TOKENS_FOR_TOKENS}${head}${pathData}`;
}

function buildSwapExactEthForTokensData(params: {
	amountOutMinRaw: bigint;
	path: [string, string];
	toAddress: string;
	deadlineSeconds: number;
}): string {
	const pathData = encodeAddressList(params.path);
	const deadline = BigInt(Math.trunc(params.deadlineSeconds));
	const head = [
		toUint256Word(params.amountOutMinRaw),
		toUint256Word(0x80n),
		toAddressWord(params.toAddress),
		toUint256Word(deadline),
	].join("");
	return `${PANCAKE_V2_SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS}${head}${pathData}`;
}

function buildSwapExactTokensForEthData(params: {
	amountInRaw: bigint;
	amountOutMinRaw: bigint;
	path: [string, string];
	toAddress: string;
	deadlineSeconds: number;
}): string {
	const pathData = encodeAddressList(params.path);
	const deadline = BigInt(Math.trunc(params.deadlineSeconds));
	const head = [
		toUint256Word(params.amountInRaw),
		toUint256Word(params.amountOutMinRaw),
		toUint256Word(0xa0n),
		toAddressWord(params.toAddress),
		toUint256Word(deadline),
	].join("");
	return `${PANCAKE_V2_SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH}${head}${pathData}`;
}

function computeV2AmountOut(params: {
	amountInRaw: bigint;
	reserveInRaw: bigint;
	reserveOutRaw: bigint;
}): bigint {
	if (
		params.amountInRaw <= 0n ||
		params.reserveInRaw <= 0n ||
		params.reserveOutRaw <= 0n
	) {
		return 0n;
	}
	const amountInWithFee = params.amountInRaw * 997n;
	const numerator = amountInWithFee * params.reserveOutRaw;
	const denominator = params.reserveInRaw * 1000n + amountInWithFee;
	return denominator === 0n ? 0n : numerator / denominator;
}

function normalizeDeadlineMinutes(value: number | undefined): number {
	if (value == null) return 20;
	const minutes = Math.trunc(value);
	if (!Number.isFinite(minutes) || minutes < 1) {
		throw new Error("deadlineMinutes must be >= 1");
	}
	if (minutes > 60 * 24 * 7) {
		throw new Error("deadlineMinutes must be <= 10080");
	}
	return minutes;
}

function buildPancakeV2SwapTx(params: {
	isInputNative: boolean;
	isOutputNative: boolean;
	amountInRaw: bigint;
	amountOutMinRaw: bigint;
	routerAddress: string;
	tokenInAddress: string;
	tokenOutAddress: string;
	recipientAddress: string;
	deadlineSeconds: number;
}): { toAddress: string; data: string; valueWei: bigint } {
	if (params.isInputNative) {
		return {
			toAddress: params.routerAddress,
			data: buildSwapExactEthForTokensData({
				amountOutMinRaw: params.amountOutMinRaw,
				path: [params.tokenInAddress, params.tokenOutAddress] as [
					string,
					string,
				],
				toAddress: params.recipientAddress,
				deadlineSeconds: params.deadlineSeconds,
			}),
			valueWei: params.amountInRaw,
		};
	}
	if (params.isOutputNative) {
		return {
			toAddress: params.routerAddress,
			data: buildSwapExactTokensForEthData({
				amountInRaw: params.amountInRaw,
				amountOutMinRaw: params.amountOutMinRaw,
				path: [params.tokenInAddress, params.tokenOutAddress] as [
					string,
					string,
				],
				toAddress: params.recipientAddress,
				deadlineSeconds: params.deadlineSeconds,
			}),
			valueWei: 0n,
		};
	}
	return {
		toAddress: params.routerAddress,
		data: buildSwapExactTokensForTokensData({
			amountInRaw: params.amountInRaw,
			amountOutMinRaw: params.amountOutMinRaw,
			path: [params.tokenInAddress, params.tokenOutAddress] as [string, string],
			toAddress: params.recipientAddress,
			deadlineSeconds: params.deadlineSeconds,
		}),
		valueWei: 0n,
	};
}

async function quotePancakeV2Swap(params: {
	rpcUrl: string;
	tokenInAddress: string;
	tokenOutAddress: string;
	amountInRaw: bigint;
	slippageBps?: number;
	factoryAddress: string;
}): Promise<{
	pairAddress: string;
	amountOutRaw: bigint;
	amountOutMinRaw: bigint;
	reserveInRaw: bigint;
	reserveOutRaw: bigint;
}> {
	if (params.amountInRaw <= 0n) {
		throw new Error("amountInRaw must be greater than 0");
	}
	const pairAddressRaw = await callEvmContract({
		rpcUrl: params.rpcUrl,
		toAddress: params.factoryAddress,
		data: buildEvmCallPancakeGetPair({
			tokenInAddress: params.tokenInAddress,
			tokenOutAddress: params.tokenOutAddress,
		}),
	});
	const pairAddress = parseAddressWord(pairAddressRaw);
	if (isZeroAddress(pairAddress)) {
		throw new Error(
			`No direct PancakeSwap v2 pair found for tokenIn=${params.tokenInAddress}, tokenOut=${params.tokenOutAddress} on BSC`,
		);
	}
	const pairToken0 = parseAddressWord(
		await callEvmContract({
			rpcUrl: params.rpcUrl,
			toAddress: pairAddress,
			data: PANCAKE_V2_SELECTOR_TOKEN0,
		}),
	);
	const pairToken1 = parseAddressWord(
		await callEvmContract({
			rpcUrl: params.rpcUrl,
			toAddress: pairAddress,
			data: PANCAKE_V2_SELECTOR_TOKEN1,
		}),
	);
	const reservesRaw = await callEvmContract({
		rpcUrl: params.rpcUrl,
		toAddress: pairAddress,
		data: PANCAKE_V2_SELECTOR_GET_RESERVES,
	});
	const reservesHex = reservesRaw.startsWith("0x")
		? reservesRaw.slice(2)
		: reservesRaw;
	const reserve0 = parseUint256Word(`0x${reservesHex.slice(0, 64)}`);
	const reserve1 = parseUint256Word(`0x${reservesHex.slice(64, 128)}`);
	let reserveInRaw: bigint;
	let reserveOutRaw: bigint;
	const tokenInNormalized = toNormalizedAddress(params.tokenInAddress);
	if (tokenInNormalized === toNormalizedAddress(pairToken0)) {
		reserveInRaw = reserve0;
		reserveOutRaw = reserve1;
	} else if (tokenInNormalized === toNormalizedAddress(pairToken1)) {
		reserveInRaw = reserve1;
		reserveOutRaw = reserve0;
	} else {
		throw new Error("Pair does not include provided tokenIn address");
	}
	const amountOutRaw = computeV2AmountOut({
		amountInRaw: params.amountInRaw,
		reserveInRaw,
		reserveOutRaw,
	});
	if (amountOutRaw <= 0n) {
		throw new Error("Pair has insufficient liquidity for this swap amount");
	}
	const bps = params.slippageBps == null ? 50 : Math.trunc(params.slippageBps);
	if (!Number.isFinite(bps) || bps <= 0 || bps >= 10_000) {
		throw new Error("slippageBps must be in (0,10000)");
	}
	const slippagePenalty = (amountOutRaw * BigInt(bps)) / 10_000n;
	const amountOutMinRaw = amountOutRaw - slippagePenalty;
	return {
		pairAddress,
		amountOutRaw,
		amountOutMinRaw,
		reserveInRaw,
		reserveOutRaw,
	};
}

function parseSignatureType(value: number | undefined): number {
	if (value === 0 || value === 1 || value === 2) return value;
	const envValue = process.env.POLYMARKET_SIGNATURE_TYPE?.trim();
	if (envValue) {
		const parsed = Number.parseInt(envValue, 10);
		if (parsed === 0 || parsed === 1 || parsed === 2) return parsed;
	}
	return 1;
}

function resolvePrivateKey(input?: string): string {
	const key = input?.trim() || process.env.POLYMARKET_PRIVATE_KEY?.trim() || "";
	if (!key) {
		throw new Error(
			"No Polymarket private key provided. Set fromPrivateKey or POLYMARKET_PRIVATE_KEY.",
		);
	}
	return key;
}

function resolveFunderAddress(input?: string): string {
	const funder = input?.trim() || process.env.POLYMARKET_FUNDER?.trim() || "";
	if (!funder) {
		throw new Error(
			"Missing Polymarket funder/profile address. Set funder or POLYMARKET_FUNDER.",
		);
	}
	return funder;
}

function resolveApiCreds(input: {
	apiKey?: string;
	apiSecret?: string;
	apiPassphrase?: string;
}): ClobApiKeyCreds | null {
	const key = input.apiKey?.trim() || process.env.POLYMARKET_API_KEY?.trim();
	const secret =
		input.apiSecret?.trim() || process.env.POLYMARKET_API_SECRET?.trim();
	const passphrase =
		input.apiPassphrase?.trim() ||
		process.env.POLYMARKET_API_PASSPHRASE?.trim();
	if (!key || !secret || !passphrase) return null;
	return { key, secret, passphrase };
}

async function getClobClientModule(): Promise<ClobClientModule> {
	const moduleValue = await import("@polymarket/clob-client");
	const ClobClient = (moduleValue as { ClobClient?: unknown }).ClobClient;
	const Side = (moduleValue as { Side?: unknown }).Side;
	const OrderType = (moduleValue as { OrderType?: unknown }).OrderType;
	if (
		typeof ClobClient !== "function" ||
		!Side ||
		typeof Side !== "object" ||
		!OrderType ||
		typeof OrderType !== "object"
	) {
		throw new Error(
			"Failed to load @polymarket/clob-client exports (ClobClient/Side/OrderType).",
		);
	}
	return {
		ClobClient: ClobClient as new (...args: unknown[]) => ClobClientLike,
		Side: Side as Record<string, unknown>,
		OrderType: OrderType as Record<string, unknown>,
	};
}

async function createAuthedClobClient(params: ClobClientAuthParams): Promise<{
	client: ClobClientLike;
	signatureType: number;
	Side: Record<string, unknown>;
	OrderType: Record<string, unknown>;
}> {
	const privateKey = resolvePrivateKey(params.fromPrivateKey);
	const funder = resolveFunderAddress(params.funder);
	const apiCreds = resolveApiCreds(params);
	const signatureType = parseSignatureType(params.signatureType);
	const { ClobClient, OrderType, Side } = await getClobClientModule();
	const signer = new Wallet(privateKey);
	const host = getPolymarketClobBaseUrl();
	const chainId = 137;
	const bootClient = new ClobClient(host, chainId, signer);
	const creds = apiCreds ?? (await bootClient.createOrDeriveApiKey?.());
	if (!creds) {
		throw new Error("Unable to derive Polymarket API credentials.");
	}
	const client = new ClobClient(
		host,
		chainId,
		signer,
		creds,
		signatureType,
		funder,
	);
	return {
		client,
		signatureType,
		Side,
		OrderType,
	};
}

function shortId(value: string): string {
	if (value.length <= 18) return value;
	return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function normalizeOrderId(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error("orderId cannot be empty");
	return normalized;
}

function collectOrderIds(input: {
	orderId?: string;
	orderIds?: string[];
}): string[] {
	const output: string[] = [];
	if (input.orderId?.trim()) output.push(normalizeOrderId(input.orderId));
	for (const entry of input.orderIds ?? []) {
		output.push(normalizeOrderId(entry));
	}
	const dedup = new Set(output);
	return [...dedup];
}

function parseNumberText(value: string): number | null {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function calculateRemainingSize(order: ClobOpenOrder): number | null {
	const original = parseNumberText(order.original_size);
	const matched = parseNumberText(order.size_matched);
	if (original == null || matched == null) return null;
	return Math.max(0, original - matched);
}

function normalizeEpochToMillis(value: number): number {
	return value >= 1_000_000_000_000 ? value : value * 1000;
}

function calculateOrderAgeMinutes(
	order: ClobOpenOrder,
	nowMs: number,
): number | null {
	if (!Number.isFinite(order.created_at) || order.created_at <= 0) return null;
	const createdAtMs = normalizeEpochToMillis(order.created_at);
	const ageMs = nowMs - createdAtMs;
	if (!Number.isFinite(ageMs) || ageMs < 0) return null;
	return ageMs / 60_000;
}

function calculateOrderFillRatio(order: ClobOpenOrder): number | null {
	const original = parseNumberText(order.original_size);
	const matched = parseNumberText(order.size_matched);
	if (original == null || matched == null || original <= 0) return null;
	return Math.max(0, Math.min(1, matched / original));
}

function parseOptionalFillRatioLimit(
	value: number | undefined,
	fieldName: string,
): number | null {
	if (value == null) return null;
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new Error(`${fieldName} must be between 0 and 1`);
	}
	return value;
}

function deriveOrderState(order: ClobOpenOrder): string {
	const normalizedStatus = order.status.trim().toLowerCase();
	const fillRatio = calculateOrderFillRatio(order);
	if (fillRatio != null && fillRatio >= 1) return "filled";
	if (
		normalizedStatus.includes("cancel") ||
		normalizedStatus.includes("canceled") ||
		normalizedStatus.includes("cancelled")
	) {
		return fillRatio != null && fillRatio > 0
			? "partially_filled_canceled"
			: "canceled";
	}
	if (
		normalizedStatus.includes("expired") ||
		normalizedStatus.includes("expire")
	) {
		return fillRatio != null && fillRatio > 0
			? "partially_filled_expired"
			: "expired";
	}
	if (fillRatio != null && fillRatio > 0) return "partially_filled";
	return "open";
}

function summarizeOrderTrades(trades: ClobTrade[]): {
	tradeCount: number;
	filledSize: number;
	averageFillPrice: number | null;
	lastMatchTime: string | null;
} {
	if (trades.length === 0) {
		return {
			tradeCount: 0,
			filledSize: 0,
			averageFillPrice: null,
			lastMatchTime: null,
		};
	}
	let filledSize = 0;
	let weightedNotional = 0;
	let lastMatchTime: string | null = null;
	for (const trade of trades) {
		const size = parseNumberText(trade.size);
		const price = parseNumberText(trade.price);
		if (size != null && size > 0) {
			filledSize += size;
			if (price != null && price > 0) {
				weightedNotional += size * price;
			}
		}
		if (trade.match_time) {
			if (!lastMatchTime || trade.match_time > lastMatchTime) {
				lastMatchTime = trade.match_time;
			}
		}
	}
	return {
		tradeCount: trades.length,
		filledSize,
		averageFillPrice:
			filledSize > 0 && weightedNotional > 0
				? weightedNotional / filledSize
				: null,
		lastMatchTime,
	};
}

type JsonRpcResponse<T> = {
	jsonrpc?: string;
	id?: string | number | null;
	result?: T;
	error?: {
		code?: number;
		message?: string;
		data?: unknown;
	};
};

function parseEvmAddress(value: string, fieldName: string): string {
	const normalized = value.trim();
	if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
		throw new Error(`${fieldName} must be a valid EVM address`);
	}
	return normalized;
}

function parseHexQuantity(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^0x[0-9a-fA-F]+$/.test(normalized)) {
		throw new Error(`${fieldName} must be a 0x-prefixed hex quantity`);
	}
	return BigInt(normalized);
}

function toHexQuantity(value: bigint): string {
	if (value < 0n) {
		throw new Error("hex quantity cannot be negative");
	}
	return `0x${value.toString(16)}`;
}

function parseDecimalToUnits(
	input: number | string,
	decimals: number,
	fieldName: string,
): bigint {
	const text =
		typeof input === "number"
			? Number.isFinite(input)
				? input.toString()
				: ""
			: input.trim();
	if (!text || /e/i.test(text)) {
		throw new Error(`${fieldName} must be a non-scientific decimal value`);
	}
	if (!/^\d+(\.\d+)?$/.test(text)) {
		throw new Error(`${fieldName} must be a positive decimal value`);
	}
	const [wholeRaw, fracRaw = ""] = text.split(".");
	const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
	const frac = fracRaw.slice(0, decimals).padEnd(decimals, "0");
	const scale = 10n ** BigInt(decimals);
	const wholeUnits = BigInt(whole) * scale;
	const fracUnits = frac.length > 0 ? BigInt(frac) : 0n;
	const units = wholeUnits + fracUnits;
	if (units <= 0n) {
		throw new Error(`${fieldName} must be greater than 0`);
	}
	return units;
}

function buildErc20TransferData(toAddress: string, amountRaw: bigint): string {
	const selector = "a9059cbb";
	const addressWord = toAddress
		.toLowerCase()
		.replace(/^0x/, "")
		.padStart(64, "0");
	const amountWord = amountRaw.toString(16).padStart(64, "0");
	return `0x${selector}${addressWord}${amountWord}`;
}

function resolveEvmPrivateKey(input?: string): string {
	const key =
		input?.trim() ||
		process.env.EVM_PRIVATE_KEY?.trim() ||
		process.env.POLYMARKET_PRIVATE_KEY?.trim() ||
		"";
	if (!key) {
		throw new Error(
			"No EVM private key provided. Set fromPrivateKey or EVM_PRIVATE_KEY.",
		);
	}
	return key;
}

async function callEvmRpc<T>(
	rpcUrl: string,
	method: string,
	params: unknown[],
): Promise<T> {
	const payload = await evmHttpJson<JsonRpcResponse<T>>({
		url: rpcUrl,
		method: "POST",
		body: {
			jsonrpc: "2.0",
			id: `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
			method,
			params,
		},
	});
	if (payload.error) {
		throw new Error(
			`RPC ${method} failed: ${payload.error.message ?? stringifyUnknown(payload.error)}`,
		);
	}
	if (payload.result == null) {
		throw new Error(`RPC ${method} returned empty result`);
	}
	return payload.result;
}

async function resolveNonce(params: {
	rpcUrl: string;
	address: string;
	nonce?: number;
}): Promise<bigint> {
	if (params.nonce != null) {
		if (!Number.isInteger(params.nonce) || params.nonce < 0) {
			throw new Error("nonce must be a non-negative integer");
		}
		return BigInt(params.nonce);
	}
	const nonceHex = await callEvmRpc<string>(
		params.rpcUrl,
		"eth_getTransactionCount",
		[params.address, "pending"],
	);
	return parseHexQuantity(nonceHex, "nonce");
}

async function resolveGasPriceWei(params: {
	rpcUrl: string;
	gasPriceGwei?: number;
}): Promise<bigint> {
	if (params.gasPriceGwei != null) {
		const gwei = parsePositiveNumber(params.gasPriceGwei, "gasPriceGwei");
		return parseDecimalToUnits(gwei, 9, "gasPriceGwei");
	}
	const gasPriceHex = await callEvmRpc<string>(
		params.rpcUrl,
		"eth_gasPrice",
		[],
	);
	return parseHexQuantity(gasPriceHex, "gasPrice");
}

async function resolveGasLimit(params: {
	rpcUrl: string;
	fromAddress: string;
	toAddress: string;
	valueWei: bigint;
	data?: string;
	gasLimit?: number;
}): Promise<bigint> {
	if (params.gasLimit != null) {
		if (!Number.isInteger(params.gasLimit) || params.gasLimit <= 0) {
			throw new Error("gasLimit must be a positive integer");
		}
		return BigInt(params.gasLimit);
	}
	const estimateHex = await callEvmRpc<string>(
		params.rpcUrl,
		"eth_estimateGas",
		[
			{
				from: params.fromAddress,
				to: params.toAddress,
				value: toHexQuantity(params.valueWei),
				...(params.data ? { data: params.data } : {}),
			},
		],
	);
	return parseHexQuantity(estimateHex, "gasLimit");
}

function formatNativeAmountFromWei(valueWei: bigint): string {
	const decimals = 18;
	const scale = 10n ** BigInt(decimals);
	const whole = valueWei / scale;
	const frac = valueWei % scale;
	if (frac === 0n) return whole.toString();
	const fracText = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${whole.toString()}.${fracText}`;
}

export function createEvmExecuteTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketPlaceOrder`,
			label: "EVM Polymarket Place Order",
			description:
				"Place BTC 5m Polymarket order via CLOB client. Defaults to dryRun=true for safety.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				marketSlug: Type.Optional(Type.String()),
				tokenId: Type.Optional(Type.String()),
				side: Type.Optional(
					Type.Union([Type.Literal("up"), Type.Literal("down")]),
				),
				orderSide: Type.Optional(
					Type.Union([Type.Literal("buy"), Type.Literal("sell")]),
				),
				stakeUsd: Type.Number({ minimum: 0.01 }),
				limitPrice: Type.Optional(
					Type.Number({ minimum: 0.001, maximum: 0.999 }),
				),
				maxEntryPrice: Type.Optional(
					Type.Number({ minimum: 0.001, maximum: 0.999 }),
				),
				maxSpreadBps: Type.Optional(Type.Number({ minimum: 0.01 })),
				minDepthUsd: Type.Optional(Type.Number({ minimum: 0.01 })),
				maxStakeUsd: Type.Optional(Type.Number({ minimum: 0.01 })),
				minConfidence: Type.Optional(
					Type.Number({ minimum: 0.01, maximum: 0.99 }),
				),
				dryRun: Type.Optional(Type.Boolean()),
				useAiAssist: Type.Optional(Type.Boolean()),
				fromPrivateKey: Type.Optional(Type.String()),
				funder: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				apiSecret: Type.Optional(Type.String()),
				apiPassphrase: Type.Optional(Type.String()),
				signatureType: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
				orderType: Type.Optional(
					Type.Union([
						Type.Literal("GTC"),
						Type.Literal("FOK"),
						Type.Literal("GTD"),
					]),
				),
				tickSize: Type.Optional(Type.Number({ minimum: 0.0001, maximum: 1 })),
				negRisk: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				const orderSide = params.orderSide === "sell" ? "sell" : "buy";
				const explicitTokenId = params.tokenId?.trim();
				const marketSlug = params.marketSlug?.trim();
				const trade = explicitTokenId
					? null
					: await resolveBtc5mTradeSelection({
							marketSlug,
							side: params.side,
							useAiAssist: params.useAiAssist,
						});
				const tokenId = explicitTokenId || trade?.tokenId;
				if (!tokenId) {
					throw new Error(
						"Cannot resolve tokenId. Provide tokenId or (marketSlug + side) for BTC 5m.",
					);
				}

				const market =
					trade?.market ||
					(marketSlug ? await getPolymarketMarketBySlug(marketSlug) : null);
				const orderbook = await getPolymarketOrderBook(tokenId);
				const fallbackPrice =
					orderSide === "buy"
						? (orderbook.bestAsk?.price ?? null)
						: (orderbook.bestBid?.price ?? null);
				const limitPrice = params.limitPrice ?? fallbackPrice;
				if (limitPrice == null) {
					throw new Error(
						`No market price available for token=${tokenId}. Provide limitPrice explicitly.`,
					);
				}
				if (
					orderSide === "buy" &&
					params.maxEntryPrice != null &&
					limitPrice > params.maxEntryPrice
				) {
					throw new Error(
						`limitPrice ${limitPrice} exceeds maxEntryPrice ${params.maxEntryPrice}`,
					);
				}
				const stakeUsd = parseUsdStake(params.stakeUsd);
				const size = stakeUsd / limitPrice;
				if (!Number.isFinite(size) || size <= 0) {
					throw new Error(`Invalid order size from stakeUsd=${stakeUsd}`);
				}
				const guardEvaluation = evaluateBtc5mTradeGuards({
					stakeUsd,
					orderbook,
					limitPrice,
					orderSide,
					adviceConfidence: trade?.advice?.confidence ?? null,
					guards: {
						maxSpreadBps: params.maxSpreadBps,
						minDepthUsd: params.minDepthUsd,
						maxStakeUsd: params.maxStakeUsd,
						minConfidence: params.minConfidence,
					},
				});
				const tickSize = params.tickSize ?? market?.tickSize ?? 0.001;
				const negRisk = params.negRisk ?? market?.negRisk ?? false;
				const geoblock = await getPolymarketGeoblockStatus();

				const orderPreview = {
					network,
					marketSlug: market?.slug ?? marketSlug ?? null,
					tokenId,
					orderSide,
					side: trade?.side ?? params.side ?? null,
					stakeUsd,
					limitPrice,
					size,
					tickSize,
					negRisk,
					guardEvaluation,
					geoblock,
				};

				if (dryRun) {
					const guardStatus = guardEvaluation.passed ? "passed" : "blocked";
					return {
						content: [
							{
								type: "text",
								text: `Polymarket order preview (${network}): ${orderSide} token=${tokenId} price=${limitPrice} size=${size.toFixed(4)} stakeUsd=${stakeUsd} guard=${guardStatus}`,
							},
						],
						details: {
							dryRun: true,
							orderPreview,
							advice: trade?.advice ?? null,
						},
					};
				}

				if (!guardEvaluation.passed) {
					throw new Error(
						`Polymarket guard check failed: ${guardEvaluation.issues.map((issue) => issue.message).join(" | ")}`,
					);
				}

				if (geoblock.blocked) {
					throw new Error(
						`Polymarket geoblock blocked for country=${geoblock.country ?? "unknown"}. Execute is not allowed in this region.`,
					);
				}

				const { client, signatureType, Side, OrderType } =
					await createAuthedClobClient({
						fromPrivateKey: params.fromPrivateKey,
						funder: params.funder,
						apiKey: params.apiKey,
						apiSecret: params.apiSecret,
						apiPassphrase: params.apiPassphrase,
						signatureType: params.signatureType,
					});
				const sideValue =
					orderSide === "sell" ? (Side.SELL ?? "SELL") : (Side.BUY ?? "BUY");
				const orderTypeInput = (params.orderType ?? "GTC").toUpperCase();
				const orderTypeValue =
					OrderType[orderTypeInput] ?? OrderType.GTC ?? "GTC";
				const response = await client.createAndPostOrder?.(
					{
						tokenID: tokenId,
						price: limitPrice,
						side: sideValue,
						size,
					},
					{
						tickSize: String(tickSize),
						negRisk,
					},
					orderTypeValue,
				);
				return {
					content: [
						{
							type: "text",
							text: `Polymarket order submitted (${network}): ${orderSide} token=${tokenId} size=${size.toFixed(4)} price=${limitPrice}`,
						},
					],
					details: {
						dryRun: false,
						orderPreview,
						signatureType,
						response: response ?? null,
						advice: trade?.advice ?? null,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketGetOpenOrders`,
			label: "EVM Polymarket Open Orders",
			description:
				"List your open Polymarket orders. Requires signer credentials.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				marketSlug: Type.Optional(Type.String()),
				tokenId: Type.Optional(Type.String()),
				side: Type.Optional(
					Type.Union([Type.Literal("up"), Type.Literal("down")]),
				),
				useAiAssist: Type.Optional(Type.Boolean()),
				limit: Type.Optional(
					Type.Number({ minimum: 1, maximum: 100, default: 20 }),
				),
				fromPrivateKey: Type.Optional(Type.String()),
				funder: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				apiSecret: Type.Optional(Type.String()),
				apiPassphrase: Type.Optional(Type.String()),
				signatureType: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const explicitTokenId = params.tokenId?.trim();
				const trade = explicitTokenId
					? null
					: params.marketSlug?.trim() ||
							params.side ||
							params.useAiAssist != null
						? await resolveBtc5mTradeSelection({
								marketSlug: params.marketSlug?.trim(),
								side: params.side,
								useAiAssist: params.useAiAssist,
							})
						: null;
				const tokenId = explicitTokenId || trade?.tokenId;
				const { client } = await createAuthedClobClient({
					fromPrivateKey: params.fromPrivateKey,
					funder: params.funder,
					apiKey: params.apiKey,
					apiSecret: params.apiSecret,
					apiPassphrase: params.apiPassphrase,
					signatureType: params.signatureType,
				});
				const orders =
					(await client.getOpenOrders?.(
						tokenId ? { asset_id: tokenId } : undefined,
						true,
					)) ?? [];
				const sorted = [...orders].sort((a, b) => b.created_at - a.created_at);
				const limit = params.limit ?? 20;
				const preview = sorted.slice(0, limit);
				const lines = [
					`Polymarket open orders (${network}): ${orders.length} order(s)`,
				];
				if (tokenId) {
					lines.push(`token=${tokenId}`);
				}
				for (const [index, order] of preview.entries()) {
					const remaining = calculateRemainingSize(order);
					const remainingText =
						remaining == null ? "n/a" : remaining.toFixed(4);
					lines.push(
						`${index + 1}. id=${shortId(order.id)} ${order.side}/${order.outcome} price=${order.price} remaining=${remainingText} status=${order.status}`,
					);
				}
				if (orders.length > preview.length) {
					lines.push(`... and ${orders.length - preview.length} more order(s)`);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						network,
						tokenId: tokenId ?? null,
						orderCount: orders.length,
						orders: preview,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketGetOrderStatus`,
			label: "EVM Polymarket Order Status",
			description:
				"Get latest order state/fill progress by orderId, with optional associated trade snapshots.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				orderId: Type.String(),
				includeTrades: Type.Optional(Type.Boolean()),
				maxTrades: Type.Optional(
					Type.Number({ minimum: 1, maximum: 50, default: 20 }),
				),
				fromPrivateKey: Type.Optional(Type.String()),
				funder: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				apiSecret: Type.Optional(Type.String()),
				apiPassphrase: Type.Optional(Type.String()),
				signatureType: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const orderId = normalizeOrderId(params.orderId);
				const includeTrades = params.includeTrades !== false;
				const maxTrades = params.maxTrades ?? 20;
				const { client } = await createAuthedClobClient({
					fromPrivateKey: params.fromPrivateKey,
					funder: params.funder,
					apiKey: params.apiKey,
					apiSecret: params.apiSecret,
					apiPassphrase: params.apiPassphrase,
					signatureType: params.signatureType,
				});
				if (!client.getOrder) {
					throw new Error("getOrder is not supported by current CLOB client.");
				}
				const order = await client.getOrder(orderId);
				const trades: ClobTrade[] = [];
				if (includeTrades && client.getTrades) {
					const associatedTradeIds = Array.isArray(order.associate_trades)
						? order.associate_trades
								.filter((entry): entry is string => typeof entry === "string")
								.slice(0, maxTrades)
						: [];
					if (associatedTradeIds.length > 0) {
						for (const tradeId of associatedTradeIds) {
							const rows =
								(await client.getTrades({ id: tradeId }, true)) ?? [];
							for (const row of rows) {
								if (typeof row.id === "string" && row.id.trim()) {
									trades.push(row);
								}
							}
						}
					}
				}
				const tradeById = new Map<string, ClobTrade>();
				for (const trade of trades) {
					tradeById.set(trade.id, trade);
				}
				const uniqueTrades = [...tradeById.values()]
					.sort((a, b) => b.match_time.localeCompare(a.match_time))
					.slice(0, maxTrades);
				const tradeSummary = summarizeOrderTrades(uniqueTrades);
				const remainingSize = calculateRemainingSize(order);
				const fillRatio = calculateOrderFillRatio(order);
				const orderState = deriveOrderState(order);
				const filledSizeFromOrder = parseNumberText(order.size_matched);
				const filledSize =
					tradeSummary.filledSize > 0
						? tradeSummary.filledSize
						: (filledSizeFromOrder ?? 0);
				const lines = [
					`Polymarket order status (${network}): order=${shortId(order.id)} state=${orderState}`,
					`statusRaw=${order.status} filled=${filledSize.toFixed(4)} / ${order.original_size} remaining=${remainingSize == null ? "n/a" : remainingSize.toFixed(4)} fillRatio=${fillRatio == null ? "n/a" : `${(fillRatio * 100).toFixed(2)}%`}`,
				];
				if (uniqueTrades.length > 0) {
					lines.push(
						`trades=${uniqueTrades.length} avgFillPrice=${tradeSummary.averageFillPrice == null ? "n/a" : tradeSummary.averageFillPrice.toFixed(4)} lastMatch=${tradeSummary.lastMatchTime ?? "n/a"}`,
					);
					for (const [index, trade] of uniqueTrades.slice(0, 5).entries()) {
						lines.push(
							`${index + 1}. trade=${shortId(trade.id)} size=${trade.size} price=${trade.price} match=${trade.match_time}`,
						);
					}
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						network,
						orderState,
						orderId: order.id,
						fillRatio,
						remainingSize,
						filledSize,
						tradeSummary,
						order,
						trades: uniqueTrades,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketCancelOrder`,
			label: "EVM Polymarket Cancel Order",
			description:
				"Cancel Polymarket orders by orderId(s), token scope, or cancel-all. Defaults to dryRun=true.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				orderId: Type.Optional(Type.String()),
				orderIds: Type.Optional(
					Type.Array(Type.String({ minLength: 1 }), {
						minItems: 1,
						maxItems: 50,
					}),
				),
				cancelAll: Type.Optional(Type.Boolean()),
				marketSlug: Type.Optional(Type.String()),
				tokenId: Type.Optional(Type.String()),
				side: Type.Optional(
					Type.Union([Type.Literal("up"), Type.Literal("down")]),
				),
				maxAgeMinutes: Type.Optional(Type.Number({ minimum: 0.1 })),
				maxFillRatio: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
				useAiAssist: Type.Optional(Type.Boolean()),
				dryRun: Type.Optional(Type.Boolean()),
				fromPrivateKey: Type.Optional(Type.String()),
				funder: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				apiSecret: Type.Optional(Type.String()),
				apiPassphrase: Type.Optional(Type.String()),
				signatureType: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				const orderIds = collectOrderIds({
					orderId: params.orderId,
					orderIds: params.orderIds,
				});
				const explicitTokenId = params.tokenId?.trim();
				const trade = explicitTokenId
					? null
					: params.marketSlug?.trim() ||
							params.side ||
							params.useAiAssist != null
						? await resolveBtc5mTradeSelection({
								marketSlug: params.marketSlug?.trim(),
								side: params.side,
								useAiAssist: params.useAiAssist,
							})
						: null;
				const tokenId = explicitTokenId || trade?.tokenId;
				const cancelAll = params.cancelAll === true;
				const maxAgeMinutes =
					params.maxAgeMinutes != null
						? parsePositiveNumber(params.maxAgeMinutes, "maxAgeMinutes")
						: null;
				const maxFillRatio = parseOptionalFillRatioLimit(
					params.maxFillRatio,
					"maxFillRatio",
				);
				const hasStaleFilter = maxAgeMinutes != null || maxFillRatio != null;
				if (cancelAll && hasStaleFilter) {
					throw new Error(
						"cancelAll cannot be combined with maxAgeMinutes/maxFillRatio filters.",
					);
				}
				if (
					!cancelAll &&
					orderIds.length === 0 &&
					!tokenId &&
					!hasStaleFilter
				) {
					throw new Error(
						"Provide cancelAll=true, orderId/orderIds, token scope (tokenId / marketSlug + side), or stale filters (maxAgeMinutes/maxFillRatio).",
					);
				}
				const { client, signatureType } = await createAuthedClobClient({
					fromPrivateKey: params.fromPrivateKey,
					funder: params.funder,
					apiKey: params.apiKey,
					apiSecret: params.apiSecret,
					apiPassphrase: params.apiPassphrase,
					signatureType: params.signatureType,
				});
				const scopedOrders =
					(await client.getOpenOrders?.(
						tokenId ? { asset_id: tokenId } : undefined,
						true,
					)) ?? [];
				const nowMs = Date.now();
				const staleCandidateOrders = hasStaleFilter
					? scopedOrders.filter((order) => {
							const ageMinutes = calculateOrderAgeMinutes(order, nowMs);
							const fillRatio = calculateOrderFillRatio(order);
							const agePass =
								maxAgeMinutes == null ||
								(ageMinutes != null && ageMinutes >= maxAgeMinutes);
							const ratioPass =
								maxFillRatio == null ||
								(fillRatio != null ? fillRatio <= maxFillRatio : true);
							return agePass && ratioPass;
						})
					: scopedOrders;
				const targetOrderIds = cancelAll
					? scopedOrders.map((entry) => entry.id)
					: orderIds.length > 0
						? orderIds
						: staleCandidateOrders.map((entry) => entry.id);
				if (dryRun) {
					const lines = [
						`Polymarket cancel preview (${network}): targetOrders=${targetOrderIds.length}`,
					];
					if (cancelAll) lines.push("scope=all");
					if (tokenId) lines.push(`token=${tokenId}`);
					if (hasStaleFilter) {
						lines.push(
							`filter=maxAgeMinutes:${maxAgeMinutes ?? "none"}, maxFillRatio:${maxFillRatio ?? "none"}`,
						);
					}
					if (orderIds.length > 0) {
						lines.push(
							`explicitOrderIds=${orderIds.map((entry) => shortId(entry)).join(", ")}`,
						);
					}
					if (targetOrderIds.length > 0) {
						lines.push(
							`target=${targetOrderIds
								.slice(0, 8)
								.map((entry) => shortId(entry))
								.join(", ")}`,
						);
						if (targetOrderIds.length > 8) {
							lines.push(`... and ${targetOrderIds.length - 8} more`);
						}
					}
					return {
						content: [{ type: "text", text: lines.join("\n") }],
						details: {
							dryRun: true,
							network,
							cancelAll,
							tokenId: tokenId ?? null,
							maxAgeMinutes,
							maxFillRatio,
							targetOrderIds,
							orderCount: scopedOrders.length,
							filteredOrderCount: staleCandidateOrders.length,
						},
					};
				}

				let response: unknown;
				if (cancelAll) {
					if (!client.cancelAll) {
						throw new Error(
							"cancelAll is not supported by current CLOB client.",
						);
					}
					response = await client.cancelAll();
				} else if (orderIds.length === 1) {
					if (!client.cancelOrder) {
						throw new Error(
							"cancelOrder is not supported by current CLOB client.",
						);
					}
					response = await client.cancelOrder({ orderID: orderIds[0] });
				} else if (orderIds.length > 1) {
					if (!client.cancelOrders) {
						throw new Error(
							"cancelOrders is not supported by current CLOB client.",
						);
					}
					response = await client.cancelOrders(orderIds);
				} else if (tokenId && !hasStaleFilter && client.cancelMarketOrders) {
					response = await client.cancelMarketOrders({ asset_id: tokenId });
				} else if (targetOrderIds.length > 0 && client.cancelOrders) {
					response = await client.cancelOrders(targetOrderIds);
				} else {
					response = { success: true, canceled: 0 };
				}
				return {
					content: [
						{
							type: "text",
							text: `Polymarket cancel submitted (${network}): targetOrders=${targetOrderIds.length} scope=${cancelAll ? "all" : tokenId ? "token" : "ids"}`,
						},
					],
					details: {
						dryRun: false,
						network,
						cancelAll,
						tokenId: tokenId ?? null,
						maxAgeMinutes,
						maxFillRatio,
						targetOrderIds,
						signatureType,
						response: response ?? null,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}transferNative`,
			label: "EVM Transfer Native",
			description:
				"Transfer native token on EVM (e.g. ETH/MATIC). Defaults to dryRun=true.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				toAddress: Type.String(),
				amountNative: Type.Optional(
					Type.Number({ minimum: 0.000000000000000001 }),
				),
				amountWei: Type.Optional(Type.String()),
				rpcUrl: Type.Optional(Type.String()),
				nonce: Type.Optional(Type.Number({ minimum: 0 })),
				gasPriceGwei: Type.Optional(Type.Number({ minimum: 0.000000001 })),
				gasLimit: Type.Optional(Type.Number({ minimum: 21000 })),
				dryRun: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				fromPrivateKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const mainnetLike = isMainnetLikeEvmNetwork(network);
				const dryRun = params.dryRun !== false;
				if (!dryRun && mainnetLike && params.confirmMainnet !== true) {
					throw new Error(
						"Mainnet transfer blocked. Re-run with confirmMainnet=true.",
					);
				}
				const toAddress = parseEvmAddress(params.toAddress, "toAddress");
				const policyCheck = evaluateEvmTransferPolicy({
					network,
					toAddress,
					transferType: "native",
				});
				const amountWei = params.amountWei?.trim()
					? BigInt(parsePositiveIntegerString(params.amountWei, "amountWei"))
					: params.amountNative != null
						? parseDecimalToUnits(
								parsePositiveNumber(params.amountNative, "amountNative"),
								18,
								"amountNative",
							)
						: null;
				if (amountWei == null || amountWei <= 0n) {
					throw new Error("Provide amountNative or amountWei (>0)");
				}
				const rpcUrl = getEvmRpcEndpoint(network, params.rpcUrl);

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `EVM native transfer preview (${network}): to=${toAddress} amount=${formatNativeAmountFromWei(amountWei)} native (${amountWei.toString()} wei)`,
							},
						],
						details: {
							dryRun: true,
							network,
							rpcUrl,
							toAddress,
							amountWei: amountWei.toString(),
							amountNative: formatNativeAmountFromWei(amountWei),
							mainnetLike,
							policyCheck,
						},
					};
				}
				if (!policyCheck.allowed) {
					throw new Error(`Transfer blocked by policy: ${policyCheck.reason}`);
				}

				const privateKey = resolveEvmPrivateKey(params.fromPrivateKey);
				const signer = new Wallet(privateKey);
				const fromAddress = signer.address;
				const chainId = getEvmChainId(network);
				const nonce = await resolveNonce({
					rpcUrl,
					address: fromAddress,
					nonce: params.nonce,
				});
				const gasPriceWei = await resolveGasPriceWei({
					rpcUrl,
					gasPriceGwei: params.gasPriceGwei,
				});
				const gasLimit = await resolveGasLimit({
					rpcUrl,
					fromAddress,
					toAddress,
					valueWei: amountWei,
					gasLimit: params.gasLimit,
				});
				const signedTx = await signer.signTransaction({
					to: toAddress,
					nonce: Number(nonce),
					chainId,
					value: toHexQuantity(amountWei),
					gasPrice: toHexQuantity(gasPriceWei),
					gasLimit: toHexQuantity(gasLimit),
				});
				const txHash = await callEvmRpc<string>(
					rpcUrl,
					"eth_sendRawTransaction",
					[signedTx],
				);
				return {
					content: [
						{
							type: "text",
							text: `EVM native transfer submitted (${network}): ${txHash}`,
						},
					],
					details: {
						dryRun: false,
						network,
						rpcUrl,
						chainId,
						fromAddress,
						toAddress,
						amountWei: amountWei.toString(),
						amountNative: formatNativeAmountFromWei(amountWei),
						nonce: nonce.toString(),
						gasPriceWei: gasPriceWei.toString(),
						gasLimit: gasLimit.toString(),
						policyCheck,
						txHash,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}transferErc20`,
			label: "EVM Transfer ERC20",
			description:
				"Transfer ERC20 token on EVM using tokenAddress + amountRaw. Defaults to dryRun=true.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				tokenAddress: Type.String(),
				toAddress: Type.String(),
				amountRaw: Type.String(),
				rpcUrl: Type.Optional(Type.String()),
				nonce: Type.Optional(Type.Number({ minimum: 0 })),
				gasPriceGwei: Type.Optional(Type.Number({ minimum: 0.000000001 })),
				gasLimit: Type.Optional(Type.Number({ minimum: 21000 })),
				dryRun: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				fromPrivateKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const mainnetLike = isMainnetLikeEvmNetwork(network);
				const dryRun = params.dryRun !== false;
				if (!dryRun && mainnetLike && params.confirmMainnet !== true) {
					throw new Error(
						"Mainnet transfer blocked. Re-run with confirmMainnet=true.",
					);
				}
				const tokenAddress = parseEvmAddress(
					params.tokenAddress,
					"tokenAddress",
				);
				const toAddress = parseEvmAddress(params.toAddress, "toAddress");
				const amountRaw = BigInt(
					parsePositiveIntegerString(params.amountRaw, "amountRaw"),
				);
				const policyCheck = evaluateEvmTransferPolicy({
					network,
					toAddress,
					transferType: "erc20",
					tokenAddress,
				});
				const data = buildErc20TransferData(toAddress, amountRaw);
				const rpcUrl = getEvmRpcEndpoint(network, params.rpcUrl);

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `EVM ERC20 transfer preview (${network}): token=${tokenAddress} to=${toAddress} amountRaw=${amountRaw.toString()}`,
							},
						],
						details: {
							dryRun: true,
							network,
							rpcUrl,
							tokenAddress,
							toAddress,
							amountRaw: amountRaw.toString(),
							data,
							mainnetLike,
							policyCheck,
						},
					};
				}
				if (!policyCheck.allowed) {
					throw new Error(`Transfer blocked by policy: ${policyCheck.reason}`);
				}

				const privateKey = resolveEvmPrivateKey(params.fromPrivateKey);
				const signer = new Wallet(privateKey);
				const fromAddress = signer.address;
				const chainId = getEvmChainId(network);
				const nonce = await resolveNonce({
					rpcUrl,
					address: fromAddress,
					nonce: params.nonce,
				});
				const gasPriceWei = await resolveGasPriceWei({
					rpcUrl,
					gasPriceGwei: params.gasPriceGwei,
				});
				const gasLimit = await resolveGasLimit({
					rpcUrl,
					fromAddress,
					toAddress: tokenAddress,
					valueWei: 0n,
					data,
					gasLimit: params.gasLimit,
				});
				const signedTx = await signer.signTransaction({
					to: tokenAddress,
					nonce: Number(nonce),
					chainId,
					value: "0x0",
					gasPrice: toHexQuantity(gasPriceWei),
					gasLimit: toHexQuantity(gasLimit),
					data,
				});
				const txHash = await callEvmRpc<string>(
					rpcUrl,
					"eth_sendRawTransaction",
					[signedTx],
				);
				return {
					content: [
						{
							type: "text",
							text: `EVM ERC20 transfer submitted (${network}): ${txHash}`,
						},
					],
					details: {
						dryRun: false,
						network,
						rpcUrl,
						chainId,
						fromAddress,
						tokenAddress,
						toAddress,
						amountRaw: amountRaw.toString(),
						nonce: nonce.toString(),
						gasPriceWei: gasPriceWei.toString(),
						gasLimit: gasLimit.toString(),
						data,
						policyCheck,
						txHash,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}pancakeV2Swap`,
			label: "EVM PancakeSwap v2 Swap",
			description:
				"Build/submit exact-input PancakeSwap V2 swaps on BSC (single-hop pair only). Defaults to dryRun=true.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				tokenInAddress: Type.String(),
				tokenOutAddress: Type.String(),
				amountInRaw: Type.String(),
				toAddress: Type.String(),
				slippageBps: Type.Optional(Type.Number({ minimum: 1, maximum: 9999 })),
				deadlineMinutes: Type.Optional(
					Type.Number({ minimum: 1, maximum: 10080 }),
				),
				amountOutMinRaw: Type.Optional(Type.String()),
				rpcUrl: Type.Optional(Type.String()),
				nonce: Type.Optional(Type.Number({ minimum: 0 })),
				gasPriceGwei: Type.Optional(Type.Number({ minimum: 0.000000001 })),
				gasLimit: Type.Optional(Type.Number({ minimum: 21000 })),
				dryRun: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				fromPrivateKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				if (network !== "bsc") {
					throw new Error("pancakeV2Swap currently supports BSC network only.");
				}
				const mainnetLike = isMainnetLikeEvmNetwork(network);
				const dryRun = params.dryRun !== false;
				if (!dryRun && mainnetLike && params.confirmMainnet !== true) {
					throw new Error(
						"Mainnet swap blocked. Re-run with confirmMainnet=true.",
					);
				}
				const tokenInAddress = parseEvmAddress(
					params.tokenInAddress,
					"tokenInAddress",
				);
				const tokenOutAddress = parseEvmAddress(
					params.tokenOutAddress,
					"tokenOutAddress",
				);
				if (tokenInAddress === tokenOutAddress) {
					throw new Error("tokenInAddress and tokenOutAddress must differ");
				}
				const toAddress = parseEvmAddress(params.toAddress, "toAddress");
				const amountInRaw = BigInt(
					parsePositiveIntegerString(params.amountInRaw, "amountInRaw"),
				);
				const config = resolvePancakeV2Config(network);
				const rpcUrl = getEvmRpcEndpoint(network, params.rpcUrl);
				const deadlineMinutes = normalizeDeadlineMinutes(
					params.deadlineMinutes,
				);
				const deadlineSeconds =
					Math.floor(Date.now() / 1000) + deadlineMinutes * 60;
				const quote = await quotePancakeV2Swap({
					rpcUrl,
					tokenInAddress,
					tokenOutAddress,
					amountInRaw,
					slippageBps: params.slippageBps,
					factoryAddress: config.factoryAddress,
				});
				const amountOutMinRaw = params.amountOutMinRaw
					? BigInt(
							parsePositiveIntegerString(
								params.amountOutMinRaw,
								"amountOutMinRaw",
							),
						)
					: quote.amountOutMinRaw;
				const isInputNative =
					toNormalizedAddress(tokenInAddress) ===
					toNormalizedAddress(config.wrappedNativeAddress);
				const isOutputNative =
					toNormalizedAddress(tokenOutAddress) ===
					toNormalizedAddress(config.wrappedNativeAddress);
				const tx = buildPancakeV2SwapTx({
					isInputNative,
					isOutputNative,
					amountInRaw,
					amountOutMinRaw,
					routerAddress: config.routerAddress,
					tokenInAddress,
					tokenOutAddress,
					recipientAddress: toAddress,
					deadlineSeconds,
				});
				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `PancakeSwap V2 swap preview (${network}): ${tokenInAddress} -> ${tokenOutAddress} amountIn=${amountInRaw.toString()} amountOutMin=${amountOutMinRaw.toString()} pair=${quote.pairAddress}`,
							},
						],
						details: {
							dryRun: true,
							network,
							tokenInAddress,
							tokenOutAddress,
							toAddress,
							pairAddress: quote.pairAddress,
							amountInRaw: amountInRaw.toString(),
							amountOutRaw: quote.amountOutRaw.toString(),
							amountOutMinRaw: amountOutMinRaw.toString(),
							reserveInRaw: quote.reserveInRaw.toString(),
							reserveOutRaw: quote.reserveOutRaw.toString(),
							tx,
							slippageBps: params.slippageBps ?? 50,
							deadlineSeconds,
							chainId: config.chainId,
							rpcUrl,
						},
					};
				}

				const privateKey = resolveEvmPrivateKey(params.fromPrivateKey);
				const signer = new Wallet(privateKey);
				const fromAddress = signer.address;
				const chainId = getEvmChainId(network);
				const nonce = await resolveNonce({
					rpcUrl,
					address: fromAddress,
					nonce: params.nonce,
				});
				const gasPriceWei = await resolveGasPriceWei({
					rpcUrl,
					gasPriceGwei: params.gasPriceGwei,
				});
				const gasLimit = await resolveGasLimit({
					rpcUrl,
					fromAddress,
					toAddress: tx.toAddress,
					valueWei: tx.valueWei,
					data: tx.data,
					gasLimit: params.gasLimit,
				});
				const signedTx = await signer.signTransaction({
					to: tx.toAddress,
					nonce: Number(nonce),
					chainId,
					value: toHexQuantity(tx.valueWei),
					gasPrice: toHexQuantity(gasPriceWei),
					gasLimit: toHexQuantity(gasLimit),
					data: tx.data,
				});
				const txHash = await callEvmRpc<string>(
					rpcUrl,
					"eth_sendRawTransaction",
					[signedTx],
				);
				return {
					content: [
						{
							type: "text",
							text: `PancakeSwap V2 swap submitted (${network}): ${txHash}`,
						},
					],
					details: {
						dryRun: false,
						network,
						rpcUrl,
						chainId,
						fromAddress,
						pairAddress: quote.pairAddress,
						tokenInAddress,
						tokenOutAddress,
						toAddress,
						amountInRaw: amountInRaw.toString(),
						amountOutRaw: quote.amountOutRaw.toString(),
						amountOutMinRaw: amountOutMinRaw.toString(),
						reserveInRaw: quote.reserveInRaw.toString(),
						reserveOutRaw: quote.reserveOutRaw.toString(),
						deadlineSeconds,
						tx,
						gasPriceWei: gasPriceWei.toString(),
						gasLimit: gasLimit.toString(),
						nonce: nonce.toString(),
						txHash,
					},
				};
			},
		}),
	];
}
