import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	kaspaApiJsonGet,
	KASPA_TOOL_PREFIX,
	kaspaNetworkSchema,
	normalizeKaspaAddress,
	parseKaspaBoolean,
	parseKaspaLimit,
	parseKaspaNetwork,
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
	address: string;
	network: string;
	apiBaseUrl: string;
	data: KaspaAddressTransactionsResponse;
};

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
		address,
		network,
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
}): Promise<KaspaTransactionResult> {
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
		address,
		network,
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

export function summarizeKaspaTransactionResult(
	result: KaspaTransactionResult,
): string {
	const count = result.data.transactions.length;
	const latest = result.data.transactions[0];
	const latestTx = latest?.transactionId
		? `${latest.transactionId}(${latest.confirmations ?? 0} conf)`
		: "none";
	const hasMore = result.data.metadata?.hasMore ? "yes" : "no";
	return `Kaspa transactions network=${result.network} address=${result.address} count=${count} hasMore=${hasMore} latest=${latestTx}`;
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
						{ type: "text", text: summarizeKaspaTransactionResult(result) },
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
	];
}
