import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	assertKaspaMainnetExecution,
	kaspaApiJsonPost,
	KASPA_TOOL_PREFIX,
	kaspaNetworkSchema,
	getKaspaApiBaseUrl,
	getKaspaApiKey,
	parseKaspaNetwork,
} from "../runtime.js";

type KaspaSubmitTransactionResponse = unknown;

export type KaspaSubmitTransactionResult = {
	network: string;
	apiBaseUrl: string;
	body: unknown;
	data: KaspaSubmitTransactionResponse;
};

function summarizeKaspaSubmitResponse(data: unknown): string {
	if (data == null) return "{}";
	if (typeof data === "string") {
		return data.trim() || "(empty)";
	}
	try {
		const json = JSON.stringify(data);
		const max = 1200;
		return json.length > max ? `${json.slice(0, max)}...` : json;
	} catch {
		return "(unserializable response)";
	}
}

function resolveKaspaTransactionSubmissionRequest(
	rawTransaction?: string,
	request?: unknown,
) {
	if (request !== undefined) {
		if (!rawTransaction) {
			return request;
		}
		if (
			request !== null &&
			typeof request === "object" &&
			!Array.isArray(request)
		) {
			return {
				...(request as Record<string, unknown>),
				rawTransaction,
			};
		}
		return { rawTransaction, request };
	}
	if (!rawTransaction) {
		return undefined;
	}
	return { rawTransaction };
}

function extractKaspaSubmitTransactionId(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	for (const key of ["txid", "txId", "transactionId", "hash", "id"]) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim()) {
			return candidate.trim();
		}
	}
	return null;
}

export async function submitKaspaTransaction(params: {
	rawTransaction?: string;
	request?: unknown;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	confirmMainnet?: boolean;
}): Promise<KaspaSubmitTransactionResult> {
	const network = parseKaspaNetwork(params.network);
	assertKaspaMainnetExecution(network, params.confirmMainnet);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl);
	const apiKey = getKaspaApiKey(params.apiKey);
	const body = resolveKaspaTransactionSubmissionRequest(
		params.rawTransaction?.trim(),
		params.request,
	);
	if (body === undefined) {
		throw new Error(
			"At least one of rawTransaction or request is required for Kaspa submit",
		);
	}
	const data = await kaspaApiJsonPost<unknown, KaspaSubmitTransactionResponse>({
		baseUrl: apiBaseUrl,
		path: "/v1/rpc/submit-transaction",
		body,
		apiKey,
	});
	return {
		network,
		apiBaseUrl,
		body,
		data,
	};
}

export function createKaspaExecuteTools() {
	return [
		defineTool({
			name: `${KASPA_TOOL_PREFIX}submitTransaction`,
			label: "Kaspa Submit Transaction",
			description:
				"Submit a pre-signed Kaspa transaction to RPC. Mainnet execution requires confirmMainnet=true.",
			parameters: Type.Object({
				rawTransaction: Type.Optional(
					Type.String({ minLength: 1, description: "Raw signed transaction payload" }),
				),
				request: Type.Optional(
					Type.Unknown({
						description:
							"Full request body used by Kaspa submit endpoint. Keep rawTransaction empty when provided in this field.",
					}),
				),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(
					Type.String({ description: "Override Kaspa API base URL" }),
				),
				apiKey: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const result = await submitKaspaTransaction(params);
				const txId = extractKaspaSubmitTransactionId(result.data);
				const network = result.network;
				const statusLine = txId
					? `Kaspa transaction submitted. network=${network} txId=${txId}`
					: `Kaspa transaction submitted. network=${network}`;
				return {
					content: [
						{
							type: "text",
							text: `${statusLine} response=${summarizeKaspaSubmitResponse(result.data)}`,
						},
					],
					details: {
						schema: "kaspa.transaction.submit.v1",
						network,
						apiBaseUrl: result.apiBaseUrl,
						txId,
						request: result.body,
						response: result.data,
					},
				};
			},
		}),
	];
}
