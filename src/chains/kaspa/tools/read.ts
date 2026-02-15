import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	KASPA_TOOL_PREFIX,
	type KaspaApiQueryValue,
	getKaspaApiBaseUrl,
	getKaspaApiKey,
	kaspaApiJsonGet,
	kaspaApiJsonPost,
	kaspaNetworkSchema,
	normalizeKaspaAddress,
	parseKaspaBoolean,
	parseKaspaLimit,
	parseKaspaNetwork,
	parseKaspaPositiveInteger,
} from "../runtime.js";

type KaspaAddressTagResponse = {
	tag: {
		address: string;
		name?: string;
		link?: string;
		labels?: string[];
		type?: string;
	};
};

type KaspaTransactionSummary = {
	transactionId: string;
	blockTime?: number;
	isAccepted?: boolean;
	confirmations?: number;
	amountSent?: string;
	amountReceived?: string;
	balanceChange?: string;
};

type KaspaTransactionMetadata = {
	hasMore?: boolean;
	count?: number;
};

type KaspaAddressTransactionsResponse = {
	transactions: KaspaTransactionSummary[];
	metadata?: KaspaTransactionMetadata;
};

type KaspaTransactionResponse = unknown;

type KaspaTransactionOutputResponse = unknown;

type KaspaTransactionAcceptanceResponse = unknown;

type KaspaAddressBalanceResponse = unknown;

type KaspaAddressUtxosResponse = unknown;

type KaspaTokenResponse = unknown;

type KaspaBlockResponse = unknown;

type KaspaNetworkInfoResponse = unknown;

type KaspaCoinSupplyResponse = unknown;

type KaspaFeeEstimateResponse = unknown;

type KaspaMempoolInfoResponse = unknown;

type KaspaReadStateResponse = unknown;

type KaspaTransactionMassResponse = unknown;

type KaspaRpcResponse = unknown;

type KaspaRpcMethod = "GET" | "POST";

type KaspaRpcResponseResult = {
	network: string;
	apiBaseUrl: string;
	rpcPath: string;
	rpcMethod: KaspaRpcMethod;
	query?: Record<string, KaspaApiQueryValue>;
	body?: unknown;
	data: KaspaRpcResponse;
};

export type KaspaWorkflowInputs = {
	address: string;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	strictAddressCheck?: boolean;
};

export type KaspaTagResult = {
	address: string;
	network: string;
	apiBaseUrl: string;
	data: KaspaAddressTagResponse;
};

export type KaspaTransactionResult = {
	transactionId: string;
	network: string;
	apiBaseUrl: string;
	data: KaspaTransactionResponse;
};

export type KaspaTransactionOutputResult = {
	transactionId: string;
	outputIndex: number;
	network: string;
	apiBaseUrl: string;
	data: KaspaTransactionOutputResponse;
};

export type KaspaAddressTransactionsResult = {
	address: string;
	network: string;
	apiBaseUrl: string;
	data: KaspaAddressTransactionsResponse;
};

type KaspaAddressHistoryStats = {
	sampleLimit?: number;
	totalTransactions: number;
	acceptedTransactions: number;
	pendingTransactions: number;
	netAmountSent: number;
	netAmountReceived: number;
	netBalanceDelta: number;
	hasMore: boolean;
	countHint?: number;
	latestTransactionId?: string;
	latestBlockTime?: number;
};

export type KaspaAddressHistoryStatsResult = {
	address: string;
	network: string;
	apiBaseUrl: string;
	stats: KaspaAddressHistoryStats;
	transactions: KaspaTransactionSummary[];
};

export type KaspaTransactionAcceptanceResult = {
	transactionIds: string[];
	network: string;
	apiBaseUrl: string;
	data: KaspaTransactionAcceptanceResponse;
};

export type KaspaAddressBalanceResult = {
	address: string;
	network: string;
	apiBaseUrl: string;
	data: KaspaAddressBalanceResponse;
};

export type KaspaAddressUtxosResult = {
	address: string;
	network: string;
	apiBaseUrl: string;
	limit?: number;
	data: KaspaAddressUtxosResponse;
};

export type KaspaTokenResult = {
	tokenId: string;
	network: string;
	apiBaseUrl: string;
	data: KaspaTokenResponse;
};

export type KaspaBlockResult = {
	blockId: string;
	network: string;
	apiBaseUrl: string;
	data: KaspaBlockResponse;
};

export type KaspaRpcResult = {
	network: string;
	apiBaseUrl: string;
	rpcMethod: KaspaRpcMethod;
	rpcPath: string;
	query?: Record<string, KaspaApiQueryValue>;
	body?: unknown;
	data: KaspaRpcResponse;
};

export type KaspaNetworkInfoResult = {
	network: string;
	apiBaseUrl: string;
	data: KaspaNetworkInfoResponse;
};

export type KaspaCoinSupplyResult = {
	network: string;
	apiBaseUrl: string;
	totalSupply?: string;
	circulatingSupply?: string;
	data: KaspaCoinSupplyResponse;
};

export type KaspaFeeEstimateResult = {
	network: string;
	apiBaseUrl: string;
	data: KaspaFeeEstimateResponse;
};

export type KaspaMempoolInfoResult = {
	network: string;
	apiBaseUrl: string;
	data: KaspaMempoolInfoResponse;
};

export type KaspaReadStateResult = {
	network: string;
	apiBaseUrl: string;
	data: KaspaReadStateResponse;
};

export type KaspaTransactionMassResult = {
	network: string;
	apiBaseUrl: string;
	data: KaspaTransactionMassResponse;
	transaction: unknown;
};

function normalizeKaspaId(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
}

function normalizeKaspaEndpoint(path: string, method: KaspaRpcMethod): string {
	const trimmed = path.trim();
	if (!trimmed) {
		throw new Error("rpcPath is required");
	}
	if (/^https?:\/\//i.test(trimmed)) {
		throw new Error("rpcPath must be a relative API path");
	}
	const normalized = trimmed.replace(/^\/+/, "");
	if (/^v1\//i.test(normalized)) {
		return `/${normalized}`;
	}
	if (/^rpc\//i.test(normalized)) {
		return `/v1/${normalized}`;
	}
	if (method === "POST") {
		return `/v1/rpc/${normalized}`;
	}
	return `/${normalized}`;
}

function normalizeKaspaQueryPayload(
	query?: Record<string, unknown>,
): Record<string, KaspaApiQueryValue> | undefined {
	if (!query) return undefined;
	const result: Record<string, KaspaApiQueryValue> = {};
	for (const [key, rawValue] of Object.entries(query)) {
		if (rawValue == null) continue;
		if (
			typeof rawValue !== "string" &&
			typeof rawValue !== "number" &&
			typeof rawValue !== "boolean"
		) {
			throw new Error(`query.${key} must be string, number, or boolean`);
		}
		result[key] = rawValue;
	}
	return result;
}

function buildTransactionIdSet(
	transactionId?: string,
	transactionIds: string[] = [],
): string[] {
	const ids = new Set<string>();
	if (transactionId) {
		ids.add(normalizeKaspaId(transactionId, "transactionId"));
	}
	for (const rawId of transactionIds) {
		ids.add(normalizeKaspaId(rawId, "transactionId"));
	}
	if (ids.size === 0) {
		throw new Error(
			"At least one transactionId or transactionIds is required for acceptance lookup",
		);
	}
	return [...ids];
}

function summarizeKaspaResponse(value: unknown): string {
	if (value == null) return "{}";
	if (typeof value === "string") {
		return value.trim() || "(empty)";
	}
	try {
		const text = JSON.stringify(value);
		const max = 1200;
		return text.length > max ? `${text.slice(0, max)}...` : text;
	} catch {
		return "(unserializable response)";
	}
}

export async function fetchKaspaAddressTag(
	params: KaspaWorkflowInputs,
): Promise<KaspaTagResult> {
	const network = parseKaspaNetwork(params.network);
	const address = normalizeKaspaAddress(
		params.address,
		network,
		params.strictAddressCheck === true,
	);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const path = `/v1/addresses/${encodeURIComponent(address)}/tag`;
	const data = await kaspaApiJsonGet<KaspaAddressTagResponse>({
		baseUrl: apiBaseUrl,
		path,
		apiKey,
	});
	return {
		network,
		address,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaAddressTransactions(params: {
	address: string;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	strictAddressCheck?: boolean;
	limit?: number;
	startingAfter?: string;
	endingBefore?: string;
	acceptedOnly?: boolean;
	includePayload?: boolean;
}): Promise<KaspaAddressTransactionsResult> {
	const network = parseKaspaNetwork(params.network);
	const address = normalizeKaspaAddress(
		params.address,
		network,
		params.strictAddressCheck === true,
	);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const normalizedLimit = parseKaspaLimit(params.limit);
	const normalizedAcceptedOnly = parseKaspaBoolean(params.acceptedOnly);
	const normalizedIncludePayload = parseKaspaBoolean(params.includePayload);
	const data = await kaspaApiJsonGet<KaspaAddressTransactionsResponse>({
		baseUrl: apiBaseUrl,
		path: `/v1/addresses/${encodeURIComponent(address)}/transactions`,
		query: {
			limit: normalizedLimit,
			starting_after: params.startingAfter,
			ending_before: params.endingBefore,
			accepted_only: normalizedAcceptedOnly,
			include_payload: normalizedIncludePayload,
		},
		apiKey,
	});
	return {
		network,
		address,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaTransaction(params: {
	transactionId: string;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
}): Promise<KaspaTransactionResult> {
	const network = parseKaspaNetwork(params.network);
	const transactionId = normalizeKaspaId(params.transactionId, "transactionId");
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const data = await kaspaApiJsonGet<KaspaTransactionResponse>({
		baseUrl: apiBaseUrl,
		path: `/v1/transactions/${encodeURIComponent(transactionId)}`,
		apiKey,
	});
	return {
		network,
		transactionId,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaTransactionOutput(params: {
	transactionId: string;
	outputIndex: number;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
}): Promise<KaspaTransactionOutputResult> {
	const network = parseKaspaNetwork(params.network);
	const transactionId = normalizeKaspaId(params.transactionId, "transactionId");
	const outputIndex = parseKaspaPositiveInteger(
		params.outputIndex,
		"outputIndex",
		true,
	);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const data = await kaspaApiJsonGet<KaspaTransactionOutputResponse>({
		baseUrl: apiBaseUrl,
		path: `/v1/transactions/outputs/${encodeURIComponent(transactionId)}/${outputIndex}`,
		apiKey,
	});
	return {
		network,
		transactionId,
		outputIndex,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaTransactionAcceptance(params: {
	transactionId?: string;
	transactionIds?: string[];
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	payload?: unknown;
}): Promise<KaspaTransactionAcceptanceResult> {
	const network = parseKaspaNetwork(params.network);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const normalizedIds = buildTransactionIdSet(
		params.transactionId,
		params.transactionIds,
	);
	const body = {
		transactionIds: normalizedIds,
		...(params.payload === undefined ? {} : { payload: params.payload }),
	};
	const data = await kaspaApiJsonPost<
		typeof body,
		KaspaTransactionAcceptanceResponse
	>({
		baseUrl: apiBaseUrl,
		path: "/v1/transaction/acceptance-data",
		body,
		apiKey,
	});
	return {
		network,
		transactionIds: normalizedIds,
		apiBaseUrl,
		data,
	};
}

function parseKaspaAmount(value: unknown): number {
	if (typeof value === "number") {
		if (Number.isFinite(value)) {
			return value;
		}
		return 0;
	}
	if (typeof value === "string") {
		const normalized = value.trim();
		if (!normalized) return 0;
		const parsed = Number.parseFloat(normalized);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

export async function fetchKaspaAddressHistoryStats(params: {
	address: string;
	limit?: number;
	startingAfter?: string;
	endingBefore?: string;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	strictAddressCheck?: boolean;
}): Promise<KaspaAddressHistoryStatsResult> {
	const network = parseKaspaNetwork(params.network);
	const address = normalizeKaspaAddress(
		params.address,
		network,
		params.strictAddressCheck === true,
	);
	const result = await fetchKaspaAddressTransactions({
		address,
		limit: params.limit,
		startingAfter: params.startingAfter,
		endingBefore: params.endingBefore,
		acceptedOnly: undefined,
		includePayload: false,
		network,
		apiBaseUrl: params.apiBaseUrl,
		apiKey: params.apiKey,
	});
	const transactions = result.data.transactions ?? [];
	const normalizedLimit = parseKaspaLimit(params.limit);
	let acceptedTransactions = 0;
	let netAmountSent = 0;
	let netAmountReceived = 0;
	for (const transaction of transactions) {
		if (transaction.isAccepted) {
			acceptedTransactions += 1;
		}
		netAmountSent += parseKaspaAmount(transaction.amountSent);
		netAmountReceived += parseKaspaAmount(transaction.amountReceived);
	}
	const latest = transactions[0];
	return {
		network,
		address,
		apiBaseUrl: getKaspaApiBaseUrl(params.apiBaseUrl, network),
		stats: {
			sampleLimit: normalizedLimit,
			totalTransactions: transactions.length,
			acceptedTransactions,
			pendingTransactions: transactions.length - acceptedTransactions,
			netAmountSent,
			netAmountReceived,
			netBalanceDelta: netAmountReceived - netAmountSent,
			hasMore: Boolean(result.data.metadata?.hasMore),
			countHint: result.data.metadata?.count,
			latestTransactionId: latest?.transactionId,
			latestBlockTime: latest?.blockTime,
		},
		transactions,
	};
}

export async function fetchKaspaAddressBalance(params: {
	address: string;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	strictAddressCheck?: boolean;
}): Promise<KaspaAddressBalanceResult> {
	const network = parseKaspaNetwork(params.network);
	const address = normalizeKaspaAddress(
		params.address,
		network,
		params.strictAddressCheck === true,
	);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const data = await kaspaApiJsonGet<KaspaAddressBalanceResponse>({
		baseUrl: apiBaseUrl,
		path: `/v1/addresses/${encodeURIComponent(address)}/balance`,
		apiKey,
	});
	return {
		network,
		address,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaAddressUtxos(params: {
	address: string;
	limit?: number;
	offset?: number;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	strictAddressCheck?: boolean;
}): Promise<KaspaAddressUtxosResult> {
	const network = parseKaspaNetwork(params.network);
	const address = normalizeKaspaAddress(
		params.address,
		network,
		params.strictAddressCheck === true,
	);
	const normalizedLimit = parseKaspaLimit(params.limit);
	const parsedOffset =
		params.offset == null
			? undefined
			: parseKaspaPositiveInteger(params.offset, "offset", true);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const data = await kaspaApiJsonGet<KaspaAddressUtxosResponse>({
		baseUrl: apiBaseUrl,
		path: `/v1/addresses/${encodeURIComponent(address)}/utxos`,
		query: {
			limit: normalizedLimit,
			offset: parsedOffset,
		},
		apiKey,
	});
	return {
		network,
		address,
		apiBaseUrl,
		limit: normalizedLimit,
		data,
	};
}

export async function fetchKaspaTokenInfo(params: {
	tokenId: string;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
}): Promise<KaspaTokenResult> {
	const network = parseKaspaNetwork(params.network);
	const tokenId = normalizeKaspaId(params.tokenId, "tokenId");
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const data = await kaspaApiJsonGet<KaspaTokenResponse>({
		baseUrl: apiBaseUrl,
		path: `/v1/tokens/${encodeURIComponent(tokenId)}`,
		apiKey,
	});
	return {
		network,
		tokenId,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaBlock(params: {
	blockId: string;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	includeTransactions?: boolean;
}): Promise<KaspaBlockResult> {
	const network = parseKaspaNetwork(params.network);
	const blockId = normalizeKaspaId(params.blockId, "blockId");
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const includeTransactionsValue = params.includeTransactions === true;
	const data = await kaspaApiJsonGet<KaspaBlockResponse>({
		baseUrl: apiBaseUrl,
		path: `/v1/blocks/${encodeURIComponent(blockId)}`,
		query: normalizeKaspaQueryPayload({
			include_transactions: includeTransactionsValue,
		}),
		apiKey,
	});
	return {
		network,
		blockId,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaNetworkInfo(params: {
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
}): Promise<KaspaNetworkInfoResult> {
	const network = parseKaspaNetwork(params.network);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const data = await kaspaApiJsonGet<KaspaNetworkInfoResponse>({
		baseUrl: apiBaseUrl,
		path: "/info/blockdag",
		apiKey,
	});
	return {
		network,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaCoinSupply(params: {
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	includeInBillion?: boolean;
}): Promise<KaspaCoinSupplyResult> {
	const network = parseKaspaNetwork(params.network);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const data = await kaspaApiJsonGet<KaspaCoinSupplyResponse>({
		baseUrl: apiBaseUrl,
		path: "/info/coinsupply",
		query: params.includeInBillion
			? {
					in_billion: true,
				}
			: undefined,
		apiKey,
	});
	return {
		network,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaFeeEstimate(params: {
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
}): Promise<KaspaFeeEstimateResult> {
	const network = parseKaspaNetwork(params.network);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const data = await kaspaApiJsonGet<KaspaFeeEstimateResponse>({
		baseUrl: apiBaseUrl,
		path: "/info/fee-estimate",
		apiKey,
	});
	return {
		network,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaMempoolInfo(params: {
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
}): Promise<KaspaMempoolInfoResult> {
	const network = parseKaspaNetwork(params.network);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const data = await kaspaApiJsonGet<KaspaMempoolInfoResponse>({
		baseUrl: apiBaseUrl,
		path: "/info/kaspad",
		apiKey,
	});
	return {
		network,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaReadState(params: {
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
}): Promise<KaspaReadStateResult> {
	const network = parseKaspaNetwork(params.network);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const data = await kaspaApiJsonGet<KaspaReadStateResponse>({
		baseUrl: apiBaseUrl,
		path: "/info/blockdag",
		apiKey,
	});
	return {
		network,
		apiBaseUrl,
		data,
	};
}

export async function fetchKaspaTransactionMass(params: {
	transaction: Record<string, unknown>;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
}): Promise<KaspaTransactionMassResult> {
	const network = parseKaspaNetwork(params.network);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const data = await kaspaApiJsonPost<
		Record<string, unknown>,
		KaspaTransactionMassResponse
	>({
		baseUrl: apiBaseUrl,
		path: "/transactions/mass",
		body: { transaction: params.transaction },
		apiKey,
	});
	return {
		network,
		apiBaseUrl,
		transaction: params.transaction,
		data,
	};
}

export async function fetchKaspaRpcRead(params: {
	rpcPath: string;
	rpcMethod?: KaspaRpcMethod;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	query?: Record<string, unknown>;
	body?: unknown;
}): Promise<KaspaRpcResult> {
	const network = parseKaspaNetwork(params.network);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const rpcMethod = params.rpcMethod === "GET" ? "GET" : "POST";
	const normalizedPath = normalizeKaspaEndpoint(params.rpcPath, rpcMethod);
	const normalizedQuery = normalizeKaspaQueryPayload(params.query);
	if (rpcMethod === "GET") {
		const data = await kaspaApiJsonGet<KaspaRpcResponse>({
			baseUrl: apiBaseUrl,
			path: normalizedPath,
			query: normalizedQuery,
			apiKey,
		});
		return {
			network,
			apiBaseUrl,
			rpcMethod,
			rpcPath: normalizedPath,
			query: normalizedQuery,
			data,
		};
	}
	const data = await kaspaApiJsonPost<unknown, KaspaRpcResponse>({
		baseUrl: apiBaseUrl,
		path: normalizedPath,
		body: params.body,
		apiKey,
	});
	return {
		network,
		apiBaseUrl,
		rpcMethod,
		rpcPath: normalizedPath,
		query: normalizedQuery,
		body: params.body,
		data,
	};
}

export function summarizeKaspaTagResult(result: KaspaTagResult): string {
	const tag = result.data.tag;
	const labelText = tag.labels?.length ? tag.labels.join(", ") : "no labels";
	return [
		"Kaspa address tag",
		`network=${result.network}`,
		`address=${result.address}`,
		`name=${tag.name ?? "(unknown)"}`,
		`type=${tag.type ?? "(unknown)"}`,
		`labels=${labelText}`,
		`link=${tag.link ?? "(none)"}`,
	].join(" | ");
}

export function summarizeKaspaTransactionListResult(
	result: KaspaAddressTransactionsResult,
): string {
	const count = result.data.transactions.length;
	const latest = result.data.transactions[0];
	const latestTx = latest?.transactionId
		? `${latest.transactionId}(${latest.confirmations ?? 0} conf)`
		: "none";
	const hasMore = result.data.metadata?.hasMore ? "yes" : "no";
	return `Kaspa transactions network=${result.network} address=${result.address} count=${count} hasMore=${hasMore} latest=${latestTx}`;
}

export function summarizeKaspaTransactionResult(
	result: KaspaTransactionResult,
): string {
	return `Kaspa transaction lookup network=${result.network} tx=${result.transactionId} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaTransactionOutputResult(
	result: KaspaTransactionOutputResult,
): string {
	return `Kaspa transaction output network=${result.network} tx=${result.transactionId} outputIndex=${result.outputIndex} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaTransactionAcceptanceResult(
	result: KaspaTransactionAcceptanceResult,
): string {
	const ids = result.transactionIds.join(", ");
	return `Kaspa transaction acceptance network=${result.network} ids=[${ids}] data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaAddressHistoryStatsResult(
	result: KaspaAddressHistoryStatsResult,
): string {
	return [
		"Kaspa address history stats",
		`network=${result.network}`,
		`address=${result.address}`,
		`sampleLimit=${result.stats.sampleLimit ?? "n/a"}`,
		`sampleCount=${result.stats.totalTransactions}`,
		`accepted=${result.stats.acceptedTransactions}`,
		`pending=${result.stats.pendingTransactions}`,
		`sent=${result.stats.netAmountSent}`,
		`received=${result.stats.netAmountReceived}`,
		`delta=${result.stats.netBalanceDelta}`,
		`hasMore=${result.stats.hasMore}`,
		`latest=${result.stats.latestTransactionId ?? "none"}`,
	].join(" | ");
}

export function summarizeKaspaAddressBalanceResult(
	result: KaspaAddressBalanceResult,
): string {
	return `Kaspa address balance network=${result.network} address=${result.address} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaAddressUtxosResult(
	result: KaspaAddressUtxosResult,
): string {
	return `Kaspa address utxos network=${result.network} address=${result.address} limit=${result.limit ?? "all"} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaTokenResult(result: KaspaTokenResult): string {
	return `Kaspa token info network=${result.network} tokenId=${result.tokenId} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaBlockResult(result: KaspaBlockResult): string {
	return `Kaspa block info network=${result.network} blockId=${result.blockId} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaNetworkInfoResult(
	result: KaspaNetworkInfoResult,
): string {
	return `Kaspa network info network=${result.network} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaCoinSupplyResult(
	result: KaspaCoinSupplyResult,
): string {
	const total =
		"totalSupply" in (result.data as Record<string, unknown>)
			? `${(result.data as Record<string, unknown>).totalSupply}`
			: "n/a";
	const circulating =
		"circulatingSupply" in (result.data as Record<string, unknown>)
			? `${(result.data as Record<string, unknown>).circulatingSupply}`
			: "n/a";
	return `Kaspa coin supply network=${result.network} totalSupply=${total} circulating=${circulating} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaFeeEstimateResult(
	result: KaspaFeeEstimateResult,
): string {
	return `Kaspa fee estimate network=${result.network} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaMempoolInfoResult(
	result: KaspaMempoolInfoResult,
): string {
	return `Kaspa mempool info network=${result.network} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaReadStateResult(
	result: KaspaReadStateResult,
): string {
	return `Kaspa read state network=${result.network} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaTransactionMassResult(
	result: KaspaTransactionMassResult,
): string {
	return `Kaspa transaction mass network=${result.network} hasTx=${Boolean(result.transaction)} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaRpcResult(result: KaspaRpcResult): string {
	return `Kaspa RPC read network=${result.network} method=${result.rpcMethod} path=${result.rpcPath} data=${summarizeKaspaResponse(result.data)}`;
}

export function createKaspaReadToolsLegacy() {
	return [
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getAddressTag`,
			label: "Kaspa Address Tag",
			description: "Query Kaspa address tag metadata.",
			parameters: Type.Object({
				address: Type.String({ minLength: 8 }),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				strictAddressCheck: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaAddressTag(params);
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaTagResult(result),
						},
					],
					details: {
						schema: "kaspa.address.tag.v1",
						network: result.network,
						address: result.address,
						tag: result.data.tag,
						apiBaseUrl: result.apiBaseUrl,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getAddressTransactions`,
			label: "Kaspa Address Transactions",
			description:
				"Query Kaspa address transactions with optional pagination filters.",
			parameters: Type.Object({
				address: Type.String({ minLength: 8 }),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				strictAddressCheck: Type.Optional(Type.Boolean()),
				limit: Type.Optional(Type.Number()),
				startingAfter: Type.Optional(Type.String()),
				endingBefore: Type.Optional(Type.String()),
				acceptedOnly: Type.Optional(Type.Boolean()),
				includePayload: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaAddressTransactions(params);
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaTransactionListResult(result),
						},
					],
					details: {
						schema: "kaspa.address.transactions.v1",
						network: result.network,
						address: result.address,
						apiBaseUrl: result.apiBaseUrl,
						transactions: result.data.transactions,
						metadata: result.data.metadata,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getAddressHistoryStats`,
			label: "Kaspa Address History Stats",
			description:
				"Aggregate recent address history metrics from the latest transactions page.",
			parameters: Type.Object({
				address: Type.String({ minLength: 8 }),
				limit: Type.Optional(Type.Number()),
				startingAfter: Type.Optional(Type.String()),
				endingBefore: Type.Optional(Type.String()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				strictAddressCheck: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaAddressHistoryStats({
					address: params.address,
					limit: params.limit,
					startingAfter: params.startingAfter,
					endingBefore: params.endingBefore,
					network: params.network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
					strictAddressCheck: params.strictAddressCheck,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaAddressHistoryStatsResult(result),
						},
					],
					details: {
						schema: "kaspa.address.history-stats.v1",
						network: result.network,
						address: result.address,
						apiBaseUrl: result.apiBaseUrl,
						stats: result.stats,
						transactions: result.transactions,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getTransaction`,
			label: "Kaspa Transaction",
			description: "Get Kaspa transaction details by transaction id.",
			parameters: Type.Object({
				transactionId: Type.String({ minLength: 8 }),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaTransaction(params);
				return {
					content: [
						{ type: "text", text: summarizeKaspaTransactionResult(result) },
					],
					details: {
						schema: "kaspa.transaction.v1",
						network: result.network,
						transactionId: result.transactionId,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getTransactionOutput`,
			label: "Kaspa Transaction Output",
			description:
				"Get one transaction output by transaction id and output index.",
			parameters: Type.Object({
				transactionId: Type.String({ minLength: 8 }),
				outputIndex: Type.Integer({ minimum: 0 }),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaTransactionOutput(params);
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaTransactionOutputResult(result),
						},
					],
					details: {
						schema: "kaspa.transaction.output.v1",
						network: result.network,
						transactionId: result.transactionId,
						outputIndex: result.outputIndex,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getTransactionAcceptance`,
			label: "Kaspa Transaction Acceptance",
			description:
				"Get Kaspa transaction acceptance details for one or more transaction ids.",
			parameters: Type.Object({
				transactionId: Type.Optional(Type.String({ minLength: 1 })),
				transactionIds: Type.Optional(
					Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
				),
				payload: Type.Optional(Type.Unknown()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaTransactionAcceptance(params);
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaTransactionAcceptanceResult(result),
						},
					],
					details: {
						schema: "kaspa.transaction.acceptance.v1",
						network: result.network,
						transactionIds: result.transactionIds,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getAddressBalance`,
			label: "Kaspa Address Balance",
			description:
				"Query Kaspa address balance summary for quick wallet checks.",
			parameters: Type.Object({
				address: Type.String({ minLength: 8 }),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				strictAddressCheck: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaAddressBalance(params);
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaAddressBalanceResult(result),
						},
					],
					details: {
						schema: "kaspa.address.balance.v1",
						network: result.network,
						address: result.address,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getAddressUtxos`,
			label: "Kaspa Address UTXOs",
			description:
				"Query Kaspa address UTXO set with optional pagination filters.",
			parameters: Type.Object({
				address: Type.String({ minLength: 8 }),
				limit: Type.Optional(Type.Number()),
				offset: Type.Optional(Type.Number()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				strictAddressCheck: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaAddressUtxos(params);
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaAddressUtxosResult(result),
						},
					],
					details: {
						schema: "kaspa.address.utxos.v1",
						network: result.network,
						address: result.address,
						apiBaseUrl: result.apiBaseUrl,
						limit: result.limit,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getToken`,
			label: "Kaspa Token Info",
			description: "Read Kaspa token metadata by token id.",
			parameters: Type.Object({
				tokenId: Type.String({ minLength: 1 }),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaTokenInfo(params);
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaTokenResult(result),
						},
					],
					details: {
						schema: "kaspa.token.info.v1",
						network: result.network,
						tokenId: result.tokenId,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getBlock`,
			label: "Kaspa Block",
			description: "Read Kaspa block detail and optional transaction list.",
			parameters: Type.Object({
				blockId: Type.String({ minLength: 1 }),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				includeTransactions: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaBlock(params);
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaBlockResult(result),
						},
					],
					details: {
						schema: "kaspa.block.detail.v1",
						network: result.network,
						blockId: result.blockId,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getFeeEstimate`,
			label: "Kaspa Fee Estimate",
			description:
				"Get fee estimate from Kaspa node for pre-submission planning.",
			parameters: Type.Object({
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaFeeEstimate({
					network: params.network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaFeeEstimateResult(result),
						},
					],
					details: {
						schema: "kaspa.fee.estimate.v1",
						network: result.network,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getNetworkInfo`,
			label: "Kaspa Network Info",
			description: "Read Kaspa network health/state summary.",
			parameters: Type.Object({
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaNetworkInfo({
					network: params.network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaNetworkInfoResult(result),
						},
					],
					details: {
						schema: "kaspa.network.info.v1",
						network: result.network,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getCoinSupply`,
			label: "Kaspa Coin Supply",
			description: "Read circulating/total Kaspa token supply information.",
			parameters: Type.Object({
				includeInBillion: Type.Optional(Type.Boolean()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaCoinSupply({
					network: params.network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
					includeInBillion: params.includeInBillion,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaCoinSupplyResult(result),
						},
					],
					details: {
						schema: "kaspa.coin.supply.v1",
						network: result.network,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
						totalSupply: result.totalSupply,
						circulatingSupply: result.circulatingSupply,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getTransactionMass`,
			label: "Kaspa Transaction Mass",
			description: "Estimate transaction mass from raw transaction payload.",
			parameters: Type.Object({
				transaction: Type.Record(Type.String(), Type.Unknown()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaTransactionMass({
					transaction: params.transaction as Record<string, unknown>,
					network: params.network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaTransactionMassResult(result),
						},
					],
					details: {
						schema: "kaspa.transaction.mass.v1",
						network: result.network,
						apiBaseUrl: result.apiBaseUrl,
						transaction: result.transaction,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getMempool`,
			label: "Kaspa Mempool",
			description:
				"Read Kaspa mempool-facing runtime details for pre-submit checks.",
			parameters: Type.Object({
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaMempoolInfo({
					network: params.network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaMempoolInfoResult(result),
						},
					],
					details: {
						schema: "kaspa.mempool.info.v1",
						network: result.network,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}readState`,
			label: "Kaspa Read State",
			description:
				"Read Kaspa chain state snapshot for pre-submit safety checks.",
			parameters: Type.Object({
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaReadState({
					network: params.network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaReadStateResult(result),
						},
					],
					details: {
						schema: "kaspa.chain.state.v1",
						network: result.network,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getAddressHistoryStats`,
			label: "Kaspa Address History Stats",
			description:
				"Aggregate recent address history metrics from the latest transactions page.",
			parameters: Type.Object({
				address: Type.String({ minLength: 8 }),
				limit: Type.Optional(Type.Number()),
				startingAfter: Type.Optional(Type.String()),
				endingBefore: Type.Optional(Type.String()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				strictAddressCheck: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaAddressHistoryStats({
					address: params.address,
					limit: params.limit,
					startingAfter: params.startingAfter,
					endingBefore: params.endingBefore,
					network: params.network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
					strictAddressCheck: params.strictAddressCheck,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaAddressHistoryStatsResult(result),
						},
					],
					details: {
						schema: "kaspa.address.history-stats.v1",
						network: result.network,
						address: result.address,
						apiBaseUrl: result.apiBaseUrl,
						stats: result.stats,
						transactions: result.transactions,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getTransaction`,
			label: "Kaspa Transaction",
			description: "Get Kaspa transaction details by transaction id.",
			parameters: Type.Object({
				transactionId: Type.String({ minLength: 8 }),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaTransaction(params);
				return {
					content: [
						{ type: "text", text: summarizeKaspaTransactionResult(result) },
					],
					details: {
						schema: "kaspa.transaction.v1",
						network: result.network,
						transactionId: result.transactionId,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getTransactionOutput`,
			label: "Kaspa Transaction Output",
			description:
				"Get one transaction output by transaction id and output index.",
			parameters: Type.Object({
				transactionId: Type.String({ minLength: 8 }),
				outputIndex: Type.Integer({ minimum: 0 }),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaTransactionOutput(params);
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaTransactionOutputResult(result),
						},
					],
					details: {
						schema: "kaspa.transaction.output.v1",
						network: result.network,
						transactionId: result.transactionId,
						outputIndex: result.outputIndex,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getTransactionAcceptance`,
			label: "Kaspa Transaction Acceptance",
			description:
				"Get Kaspa transaction acceptance details for one or more transaction ids.",
			parameters: Type.Object({
				transactionId: Type.Optional(Type.String({ minLength: 1 })),
				transactionIds: Type.Optional(
					Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
				),
				payload: Type.Optional(Type.Unknown()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaTransactionAcceptance(params);
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaTransactionAcceptanceResult(result),
						},
					],
					details: {
						schema: "kaspa.transaction.acceptance.v1",
						network: result.network,
						transactionIds: result.transactionIds,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}rpc`,
			label: "Kaspa RPC Read",
			description:
				"Call a configurable Kaspa RPC/read endpoint for custom fee/mempool/state checks.",
			parameters: Type.Object({
				rpcPath: Type.String({ minLength: 1 }),
				rpcMethod: Type.Optional(
					Type.Union([Type.Literal("GET"), Type.Literal("POST")]),
				),
				query: Type.Optional(
					Type.Record(
						Type.String(),
						Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
					),
				),
				body: Type.Optional(Type.Unknown()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const method = params.rpcMethod === "GET" ? "GET" : "POST";
				const result = await fetchKaspaRpcRead({
					rpcPath: params.rpcPath,
					rpcMethod: method,
					query:
						method === "GET"
							? (params.query as Record<string, unknown> | undefined)
							: undefined,
					body: method === "POST" ? params.body : undefined,
					network: params.network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaRpcResult(result),
						},
					],
					details: {
						schema: "kaspa.rpc.read.v1",
						network: result.network,
						rpcPath: result.rpcPath,
						rpcMethod: result.rpcMethod,
						apiBaseUrl: result.apiBaseUrl,
						query: result.query,
						body: result.body,
						data: result.data,
					},
				};
			},
		}),
	];
}

export function createKaspaReadTools() {
	const tools = createKaspaReadToolsLegacy();
	const deduped = new Map<string, (typeof tools)[number]>();
	for (const tool of tools) {
		if (!deduped.has(tool.name)) {
			deduped.set(tool.name, tool);
		}
	}
	return [...deduped.values()];
}
