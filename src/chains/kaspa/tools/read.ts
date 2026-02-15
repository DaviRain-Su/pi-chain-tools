import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	kaspaApiJsonGet,
	kaspaApiJsonPost,
	KaspaApiQueryValue,
	KASPA_TOOL_PREFIX,
	kaspaNetworkSchema,
	normalizeKaspaAddress,
	parseKaspaBoolean,
	parseKaspaLimit,
	parseKaspaNetwork,
	parseKaspaPositiveInteger,
	getKaspaApiBaseUrl,
	getKaspaApiKey,
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
	const address = normalizeKaspaAddress(params.address);
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
	limit?: number;
	startingAfter?: string;
	endingBefore?: string;
	acceptedOnly?: boolean;
	includePayload?: boolean;
}): Promise<KaspaAddressTransactionsResult> {
	const network = parseKaspaNetwork(params.network);
	const address = normalizeKaspaAddress(params.address);
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
	const outputIndex = parseKaspaPositiveInteger(params.outputIndex, "outputIndex", true);
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
	const labelText = tag.labels?.length
		? tag.labels.join(", ")
		: "no labels";
	return [
		`Kaspa address tag`,
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

export function summarizeKaspaRpcResult(result: KaspaRpcResult): string {
	return `Kaspa RPC read network=${result.network} method=${result.rpcMethod} path=${result.rpcPath} data=${summarizeKaspaResponse(result.data)}`;
}

export function createKaspaReadTools() {
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
			description: "Query Kaspa address balance summary for quick wallet checks.",
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
			description: "Query Kaspa address UTXO set with optional pagination filters.",
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
				"Call Kaspa RPC fee-estimate endpoint for pre-submit fee planning.",
			parameters: Type.Object({
				request: Type.Optional(Type.Unknown()),
				rpcPath: Type.Optional(Type.String()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const rpcPath = params.rpcPath?.trim() || "get-fee-estimate";
				const result = await fetchKaspaRpcRead({
					rpcPath,
					rpcMethod: "POST",
					body: params.request,
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
						schema: "kaspa.rpc.fee-estimate.v1",
						network: result.network,
						rpcPath: result.rpcPath,
						rpcMethod: result.rpcMethod,
						apiBaseUrl: result.apiBaseUrl,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}getMempool`,
			label: "Kaspa Mempool",
			description:
				"Call Kaspa mempool RPC/read endpoint before submit/confirm.",
			parameters: Type.Object({
				rpcPath: Type.Optional(Type.String()),
				rpcMethod: Type.Optional(Type.Union([Type.Literal("GET"), Type.Literal("POST")])),
				query: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]))),
				body: Type.Optional(Type.Unknown()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const rpcPath = params.rpcPath?.trim() || "get-mempool-entries";
				const method = params.rpcMethod === "GET" ? "GET" : "POST";
				const result = await fetchKaspaRpcRead({
					rpcPath,
					rpcMethod: method,
					query:
						(method === "GET" ? (params.query as Record<string, unknown> | undefined) : undefined),
					body:
						(method === "POST" ? (params.body ?? {}) : undefined),
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
						schema: "kaspa.rpc.mempool.v1",
						network: result.network,
						rpcPath: result.rpcPath,
						rpcMethod: result.rpcMethod,
						apiBaseUrl: result.apiBaseUrl,
						query: result.query,
						data: result.data,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}readState`,
			label: "Kaspa Read State",
			description: "Read Kaspa state by RPC endpoint for transaction preflight.",
			parameters: Type.Object({
				rpcPath: Type.Optional(Type.String()),
				query: Type.Optional(
					Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
				),
				body: Type.Optional(Type.Unknown()),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const rpcPath = params.rpcPath?.trim() || "read-state";
				const result = await fetchKaspaRpcRead({
					rpcPath,
					rpcMethod: "POST",
					query: params.query,
					body: params.body,
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
						schema: "kaspa.rpc.read-state.v1",
						network: result.network,
						rpcPath: result.rpcPath,
						rpcMethod: result.rpcMethod,
						apiBaseUrl: result.apiBaseUrl,
						query: result.query,
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
				rpcMethod: Type.Optional(Type.Union([Type.Literal("GET"), Type.Literal("POST")])),
				query: Type.Optional(
					Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
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
						method === "GET" ? (params.query as Record<string, unknown> | undefined) : undefined,
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
