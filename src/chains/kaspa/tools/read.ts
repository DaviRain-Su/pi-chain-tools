import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	kaspaApiJsonGet,
	kaspaApiJsonPost,
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

function normalizeKaspaId(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
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
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl);
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
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl);
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
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl);
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
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl);
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
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl);
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
	];
}
