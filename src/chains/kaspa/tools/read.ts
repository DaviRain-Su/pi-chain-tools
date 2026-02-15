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

const KASPA_DECIMALS = 8;

type KaspaUtxoSelectionStrategy = "fifo" | "feeRate";

type KaspaUtxoAddressItem = {
	txId: string;
	index: number;
	amount: string;
	address?: string;
	scriptPublicKey?: string;
};

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

type KaspaReadStandardizedRecord = Record<string, unknown>;

type KaspaReadStandardizedSummary = {
	network?: string;
	address?: string;
	transactionId?: string;
	outputIndex?: number;
	status?: "accepted" | "pending" | "unknown";
	inputCount?: number;
	outputCount?: number;
	count?: number;
	totalInputAmount?: string;
	totalOutputAmount?: string;
	totalAmount?: string;
	feeAmount?: string;
	blockTime?: number;
	confirmations?: number;
};

type KaspaReadStandardizedOutput = {
	summary: KaspaReadStandardizedSummary;
	inputs: KaspaReadStandardizedRecord[];
	outputs: KaspaReadStandardizedRecord[];
	fees: Record<string, unknown>;
};

type KaspaAddressSortedUtxosResult = {
	address: string;
	network: string;
	apiBaseUrl: string;
	limit?: number;
	offset?: number;
	strategy: KaspaUtxoSelectionStrategy;
	apiVersion?: string;
	rawCount: number;
	fetchedCount: number;
	selectedCount: number;
	data: KaspaUtxoAddressItem[];
	summary: {
		totalAmount: string;
		selectedAmount: string;
		selectedOutOf: number;
		selectionOrder: string[];
	};
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

function parseKaspaAmount(value: string | number, fieldName: string): bigint {
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error(`${fieldName} must be a number greater than 0`);
		}
		return parseKaspaAmount(value.toString(), fieldName);
	}
	if (typeof value === "string") {
		const normalized = value.trim();
		if (!/^[0-9]+(\.[0-9]+)?$/.test(normalized)) {
			throw new Error(`${fieldName} must be a decimal string`);
		}
		if (normalized.includes("e") || normalized.includes("E")) {
			throw new Error(`${fieldName} must not use exponential notation`);
		}
		const [whole = "", fractionRaw = ""] = normalized.split(".");
		if (fractionRaw.length > KASPA_DECIMALS) {
			throw new Error(
				`${fieldName} precision cannot exceed ${KASPA_DECIMALS} decimal places`,
			);
		}
		const fraction = fractionRaw.padEnd(KASPA_DECIMALS, "0");
		const parsed = BigInt(`${whole}${fraction}`);
		if (parsed <= 0n) {
			throw new Error(`${fieldName} must be greater than 0`);
		}
		return parsed;
	}
	throw new Error(`${fieldName} must be a number or numeric string`);
}

function parseKaspaUtxoSelectionStrategy(
	value: unknown,
): KaspaUtxoSelectionStrategy {
	if (typeof value !== "string") {
		return "feeRate";
	}
	if (value === "fifo") {
		return "fifo";
	}
	if (value === "feeRate" || value === "feerate") {
		return "feeRate";
	}
	throw new Error("utxoSelectionStrategy must be 'fifo' or 'feeRate'");
}

function parseKaspaFetchedUtxosPayload(data: unknown): unknown[] {
	if (Array.isArray(data)) {
		if (data.length === 0) {
			throw new Error("kaspa_getAddressUtxos returned no UTXOs");
		}
		return data;
	}
	if (!data || typeof data !== "object") {
		throw new Error("kaspa_getAddressUtxos returned no UTXOs");
	}
	const payload = data as Record<string, unknown>;
	if (Array.isArray(payload.utxos)) {
		if (payload.utxos.length === 0) {
			throw new Error("kaspa_getAddressUtxos returned no UTXOs");
		}
		return payload.utxos;
	}
	if (Array.isArray(payload.outputs)) {
		if (payload.outputs.length === 0) {
			throw new Error("kaspa_getAddressUtxos returned no UTXOs");
		}
		return payload.outputs;
	}
	if (Array.isArray(payload.data)) {
		if (payload.data.length === 0) {
			throw new Error("kaspa_getAddressUtxos returned no UTXOs");
		}
		return payload.data;
	}
	throw new Error("kaspa_getAddressUtxos returned no UTXOs");
}

function normalizeKaspaFetchedUtxo(
	raw: unknown,
	index: number,
): KaspaUtxoAddressItem {
	if (!raw || typeof raw !== "object") {
		throw new Error(`utxos[${index}] must be an object`);
	}
	const candidate = raw as Record<string, unknown>;
	const txId =
		typeof candidate.txId === "string"
			? candidate.txId.trim()
			: typeof candidate.txid === "string"
				? candidate.txid.trim()
				: typeof candidate.txHash === "string"
					? candidate.txHash.trim()
					: typeof candidate.hash === "string"
						? candidate.hash.trim()
						: "";
	if (!txId) {
		throw new Error(`utxos[${index}].txId is required`);
	}
	const rawIndex =
		typeof candidate.index === "number"
			? candidate.index
			: typeof candidate.outputIndex === "number"
				? candidate.outputIndex
				: typeof candidate.vout === "number"
					? candidate.vout
					: undefined;
	if (
		typeof rawIndex !== "number" ||
		!Number.isInteger(rawIndex) ||
		rawIndex < 0
	) {
		throw new Error(`utxos[${index}].index is required`);
	}
	const amountSource = candidate.amount ?? candidate.value ?? candidate.satoshis;
	if (amountSource == null) {
		throw new Error(`utxos[${index}].amount is required`);
	}
	const amount = parseKaspaAmount(
		amountSource as string | number,
		`utxos[${index}].amount`,
	).toString();
	const utxo: KaspaUtxoAddressItem = {
		txId,
		index: rawIndex,
		amount,
	};
	if (typeof candidate.address === "string" && candidate.address.trim()) {
		utxo.address = candidate.address.trim();
	}
	if (
		typeof candidate.scriptPublicKey === "string" &&
		candidate.scriptPublicKey.trim()
	) {
		utxo.scriptPublicKey = candidate.scriptPublicKey.trim();
	}
	return utxo;
}

function selectKaspaUtxoOrder(
	utxos: KaspaUtxoAddressItem[],
	strategy: KaspaUtxoSelectionStrategy,
): KaspaUtxoAddressItem[] {
	return strategy === "fifo"
		? [...utxos]
		: [...utxos].sort((a, b) => {
				const aAmount = BigInt(a.amount);
				const bAmount = BigInt(b.amount);
				return aAmount === bAmount ? 0 : aAmount > bAmount ? -1 : 1;
			});
}

function buildKaspaAddressUtxoSelectionSummary(params: {
	strategy: KaspaUtxoSelectionStrategy;
	requested: KaspaUtxoAddressItem[];
	selected: KaspaUtxoAddressItem[];
}): {
	totalAmount: string;
	selectedAmount: string;
	selectedOutOf: number;
	selectionOrder: string[];
} {
	const totalAmount = params.requested.reduce(
		(sum, utxo) => sum + BigInt(utxo.amount),
		0n,
	);
	const selectedAmount = params.selected.reduce(
		(sum, utxo) => sum + BigInt(utxo.amount),
		0n,
	);
	return {
		totalAmount: totalAmount.toString(),
		selectedAmount: selectedAmount.toString(),
		selectedOutOf: params.selected.length,
		selectionOrder: params.selected.map(
			(utxo, index) =>
				`${index}:${utxo.txId}:${utxo.index}:${utxo.amount}`,
		),
	};
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	return value as Record<string, unknown>;
}

function getKaspaFirstString(
	record: Record<string, unknown> | undefined,
	keys: string[],
): string | undefined {
	if (!record) return undefined;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string") {
			const normalized = value.trim();
			if (normalized) {
				return normalized;
			}
		}
	}
	return undefined;
}

function getKaspaFirstNumber(
	record: Record<string, unknown> | undefined,
	keys: string[],
): number | undefined {
	if (!record) return undefined;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (!trimmed) continue;
			const parsed = Number(trimmed);
			if (Number.isFinite(parsed)) {
				return parsed;
			}
		}
	}
	return undefined;
}

function getKaspaFirstField(
	record: Record<string, unknown> | undefined,
	keys: string[],
): unknown {
	if (!record) return undefined;
	for (const key of keys) {
		const value = record[key];
		if (value !== undefined) {
			return value;
		}
	}
	return undefined;
}

function parseKaspaReadAmountAtomic(value: unknown): bigint | undefined {
	if (value == null) return undefined;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value < 0) {
			return undefined;
		}
		return parseKaspaReadAmountAtomic(value.toString());
	}
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (trimmed.includes("e") || trimmed.includes("E")) return undefined;
	const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
	if (!match) return undefined;
	const [, wholeRaw, fracRaw = ""] = match;
	if (fracRaw.length > KASPA_DECIMALS) return undefined;
	const atomic = `${wholeRaw}${fracRaw.padEnd(KASPA_DECIMALS, "0")}`;
	try {
		return BigInt(atomic);
	} catch {
		return undefined;
	}
}

function parseKaspaReadAmount(value: unknown): string {
	const parsed = parseKaspaReadAmountAtomic(value);
	return parsed === undefined ? "0" : parsed.toString();
}

function extractKaspaTxPayload(data: unknown): Record<string, unknown> {
	const record = asRecord(data);
	if (!record) return {};
	const nested = asRecord(record.transaction);
	return nested ?? record;
}

function extractKaspaPayloadArray(data: unknown): unknown[] {
	if (Array.isArray(data)) return data;
	const record = asRecord(data);
	if (!record) return [];
	const candidates = ["utxos", "outputs", "data", "items"];
	for (const key of candidates) {
		const value = record[key];
		if (Array.isArray(value)) {
			return value;
		}
	}
	return [];
}

function buildKaspaReadTransactionInputs(
	transaction: Record<string, unknown>,
): KaspaReadStandardizedRecord[] {
	const inputRecords = extractKaspaPayloadArray(transaction.inputs);
	const result: KaspaReadStandardizedRecord[] = [];
	for (const [index, rawInput] of inputRecords.entries()) {
		const input = asRecord(rawInput) ?? {};
		const outputIndex = getKaspaFirstNumber(input, [
			"index",
			"outputIndex",
			"vout",
		]);
		result.push({
			type: "input",
			index,
			txId:
				getKaspaFirstString(input, [
					"txId",
					"txid",
					"txHash",
					"hash",
					"prevTxId",
				]) ?? "unknown",
			outputIndex: outputIndex === undefined ? 0 : outputIndex,
			amount: parseKaspaReadAmount(getKaspaFirstField(input, ["amount", "value", "satoshis"])),
			address: getKaspaFirstString(input, ["address", "sender", "from"]),
			scriptPublicKey: getKaspaFirstString(input, [
				"scriptPublicKey",
				"scriptPubKey",
				"pkScript",
			]),
		});
	}
	return result;
}

function buildKaspaReadTransactionOutputs(
	transaction: Record<string, unknown>,
): KaspaReadStandardizedRecord[] {
	const outputRecords = extractKaspaPayloadArray(transaction.outputs);
	const result: KaspaReadStandardizedRecord[] = [];
	for (const [index, rawOutput] of outputRecords.entries()) {
		const output = asRecord(rawOutput) ?? {};
		result.push({
			type: "output",
			index,
			address: getKaspaFirstString(output, ["address", "recipient", "to"]),
			amount: parseKaspaReadAmount(
				getKaspaFirstField(output, ["amount", "value", "satoshis"]),
			),
			scriptPublicKey: getKaspaFirstString(output, [
				"scriptPublicKey",
				"scriptPubKey",
				"pkScript",
			]),
		});
	}
	return result;
}

function buildKaspaReadTransactionFees(
	transaction: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const fee = getKaspaFirstField(transaction, [
		"fee",
		"feeAmount",
		"networkFee",
		"gas",
	]);
	if (fee !== undefined) {
		result.feeAmount = parseKaspaReadAmount(fee);
	}
	const mass = getKaspaFirstField(transaction, [
		"mass",
		"estimatedMass",
		"massLimit",
	]);
	if (mass !== undefined) {
		result.mass = typeof mass === "number" || typeof mass === "string"
			? String(mass)
			: summarizeKaspaResponse(mass);
	}
	return result;
}

function summarizeKaspaReadTransactionFromPayload(
	txPayload: Record<string, unknown>,
): KaspaReadStandardizedSummary {
	const statusCandidate = getKaspaFirstField(txPayload, [
		"isAccepted",
		"accepted",
		"is_accepted",
	]);
	const confirmedCandidate = getKaspaFirstField(txPayload, ["confirmed"]);
	const confirmations = getKaspaFirstNumber(txPayload, [
		"confirmations",
		"confirmationsCount",
	]);
	const blockTime = getKaspaFirstNumber(txPayload, ["blockTime", "block_time"]);
	if (typeof statusCandidate === "boolean") {
		return {
			status: statusCandidate ? "accepted" : "pending",
			blockTime,
			confirmations,
		};
	}
	if (typeof confirmedCandidate === "boolean") {
		return {
			status: confirmedCandidate ? "accepted" : "pending",
			blockTime,
			confirmations,
		};
	}
	if (
		(confirmations !== undefined && confirmations > 0) ||
		typeof blockTime === "number"
	) {
		return {
			status: "accepted",
			blockTime,
			confirmations,
		};
	}
	return {
		status: "unknown",
		blockTime,
		confirmations,
	};
}

function buildKaspaReadTransactionStandardization(
	transactionId: string,
	result: KaspaTransactionResult,
): KaspaReadStandardizedOutput {
	const txPayload = extractKaspaTxPayload(result.data);
	const inputs = buildKaspaReadTransactionInputs(txPayload);
	const outputs = buildKaspaReadTransactionOutputs(txPayload);
	const fees = buildKaspaReadTransactionFees(txPayload);
	const statusSummary = summarizeKaspaReadTransactionFromPayload(txPayload);
	const totalInputAmount = inputs.reduce(
		(sum, input) =>
			sum + (parseKaspaReadAmountAtomic(input.amount) || 0n),
		0n,
	);
	const totalOutputAmount = outputs.reduce(
		(sum, output) =>
			sum + (parseKaspaReadAmountAtomic(output.amount) || 0n),
		0n,
	);
	return {
		summary: {
			transactionId,
			network: result.network,
			status: statusSummary.status,
			inputCount: inputs.length,
			outputCount: outputs.length,
			totalInputAmount: totalInputAmount.toString(),
			totalOutputAmount: totalOutputAmount.toString(),
			feeAmount: typeof fees.feeAmount === "string" ? fees.feeAmount : undefined,
			blockTime: statusSummary.blockTime,
			confirmations: statusSummary.confirmations,
		},
		inputs,
		outputs,
		fees,
	};
}

function buildKaspaReadTransactionOutputStandardization(
	result: KaspaTransactionOutputResult,
): KaspaReadStandardizedOutput {
	const outputPayload = asRecord(result.data) ?? {};
	const root = asRecord(outputPayload.output) ?? outputPayload;
	const outputEntry = {
		type: "output",
		index: getKaspaFirstNumber(root, ["index", "outputIndex", "vout"]) ?? 0,
		txId: result.transactionId,
		address: getKaspaFirstString(root, ["address", "recipient", "to"]),
		amount: parseKaspaReadAmount(
			getKaspaFirstField(root, ["amount", "value", "satoshis"]),
		),
		scriptPublicKey: getKaspaFirstString(root, [
			"scriptPublicKey",
			"scriptPubKey",
			"pkScript",
		]),
	};
	return {
		summary: {
			transactionId: result.transactionId,
			outputIndex: result.outputIndex,
			network: result.network,
			outputCount: 1,
			totalAmount: outputEntry.amount,
			feeAmount: "0",
			inputCount: 0,
			status: "unknown",
		},
		inputs: [],
		outputs: [outputEntry],
		fees: { feeAmount: "0", outputCount: 1 },
	};
}

function buildKaspaReadUtxoStandardization(
	result: KaspaAddressUtxosResult,
): KaspaReadStandardizedOutput {
	const rawUtxos = extractKaspaPayloadArray(result.data);
	const outputs: KaspaReadStandardizedRecord[] = [];
	for (const [index, rawUtxo] of rawUtxos.entries()) {
		const utxo = asRecord(rawUtxo) ?? {};
		outputs.push({
			type: "utxo",
			index:
				getKaspaFirstNumber(utxo, ["index", "outputIndex", "vout"]) ??
				index,
			txId:
				getKaspaFirstString(utxo, ["txId", "txid", "txHash", "hash"]) ??
				"unknown",
			amount: parseKaspaReadAmount(
				getKaspaFirstField(utxo, ["amount", "value", "satoshis"]),
			),
			address: getKaspaFirstString(utxo, ["address", "owner"]),
			scriptPublicKey: getKaspaFirstString(utxo, [
				"scriptPublicKey",
				"scriptPubKey",
				"pkScript",
			]),
		});
	}
	const totalAmount = outputs.reduce(
		(sum, utxo) => sum + (parseKaspaReadAmountAtomic(utxo.amount) || 0n),
		0n,
	);
	return {
		summary: {
			address: result.address,
			network: result.network,
			count: outputs.length,
			totalAmount: totalAmount.toString(),
			outputCount: outputs.length,
			feeAmount: "0",
		},
		inputs: [],
		outputs,
		fees: { feeAmount: "0" },
	};
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

function parseKaspaStatsAmount(value: unknown): number {
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
		netAmountSent += parseKaspaStatsAmount(transaction.amountSent);
		netAmountReceived += parseKaspaStatsAmount(transaction.amountReceived);
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

export async function fetchKaspaAddressSortedUtxos(params: {
	address: string;
	limit?: number;
	offset?: number;
	selectionStrategy?: KaspaUtxoSelectionStrategy;
	selectionLimit?: number;
	network?: string;
	apiBaseUrl?: string;
	apiKey?: string;
	strictAddressCheck?: boolean;
}): Promise<KaspaAddressSortedUtxosResult> {
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
	const parsedSelectionLimit = params.selectionLimit
		? parseKaspaPositiveInteger(params.selectionLimit, "selectionLimit")
		: undefined;
	const strategy = parseKaspaUtxoSelectionStrategy(params.selectionStrategy);
	const apiBaseUrl = getKaspaApiBaseUrl(params.apiBaseUrl, network);
	const apiKey = getKaspaApiKey(params.apiKey);
	const source = await fetchKaspaAddressUtxos({
		address,
		limit: normalizedLimit,
		offset: parsedOffset,
		network,
		apiBaseUrl: params.apiBaseUrl,
		apiKey: params.apiKey,
		strictAddressCheck: params.strictAddressCheck,
	});
	const requestedUtxos = parseKaspaFetchedUtxosPayload(source.data).map(
		(rawUtxo, index) => normalizeKaspaFetchedUtxo(rawUtxo, index),
	);
	const selected = selectKaspaUtxoOrder(requestedUtxos, strategy);
	const finalUtxos =
		parsedSelectionLimit == null ? selected : selected.slice(0, parsedSelectionLimit);
	return {
		network,
		address,
		apiBaseUrl,
		limit: normalizedLimit,
		offset: parsedOffset,
		strategy,
		apiVersion: "v1",
		rawCount: requestedUtxos.length,
		fetchedCount: selected.length,
		selectedCount: finalUtxos.length,
		data: finalUtxos,
		summary: buildKaspaAddressUtxoSelectionSummary({
			strategy,
			requested: requestedUtxos,
			selected: finalUtxos,
		}),
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
	const normalized = buildKaspaReadTransactionStandardization(
		result.transactionId,
		result,
	);
	return `Kaspa transaction lookup network=${result.network} tx=${result.transactionId} summary=${summarizeKaspaResponse(normalized.summary)} inputs=${normalized.inputs.length} outputs=${normalized.outputs.length} fees=${summarizeKaspaResponse(normalized.fees)} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaTransactionOutputResult(
	result: KaspaTransactionOutputResult,
): string {
	const standardized = buildKaspaReadTransactionOutputStandardization(result);
	return `Kaspa transaction output network=${result.network} tx=${result.transactionId} outputIndex=${result.outputIndex} summary=${summarizeKaspaResponse(standardized.summary)} data=${summarizeKaspaResponse(result.data)}`;
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
	const standardized = buildKaspaReadUtxoStandardization(result);
	return `Kaspa address utxos network=${result.network} address=${result.address} summary=${summarizeKaspaResponse(standardized.summary)} limit=${result.limit ?? "all"} data=${summarizeKaspaResponse(result.data)}`;
}

export function summarizeKaspaAddressSortedUtxosResult(
	result: KaspaAddressSortedUtxosResult,
): string {
	return `Kaspa address sorted utxos network=${result.network} address=${result.address} strategy=${result.strategy} raw=${result.rawCount} selected=${result.selectedCount} summary=${summarizeKaspaResponse(result.summary)}`;
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
						standardized: buildKaspaReadTransactionStandardization(
							result.transactionId,
							result,
						),
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
						standardized: buildKaspaReadTransactionOutputStandardization(result),
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
						standardized: buildKaspaReadUtxoStandardization(result),
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}fetchUtxos`,
			label: "Kaspa Fetch UTXOs",
			description:
				"Fetch Kaspa address UTXOs with normalized fields and strategy-based ordering.",
			parameters: Type.Object({
				address: Type.String({ minLength: 8 }),
				limit: Type.Optional(Type.Number()),
				offset: Type.Optional(Type.Number()),
				selectionStrategy: Type.Optional(
					Type.Union([
						Type.Literal("fifo"),
						Type.Literal("feeRate"),
						Type.Literal("feerate"),
					]),
				),
				selectionLimit: Type.Optional(
					Type.Integer({
						minimum: 1,
						description:
							"Optional maximum number of sorted UTXOs returned after strategy ordering.",
					}),
				),
				network: kaspaNetworkSchema(),
				apiBaseUrl: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				strictAddressCheck: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const result = await fetchKaspaAddressSortedUtxos({
					address: params.address,
					limit: params.limit,
					offset: params.offset,
					selectionStrategy: params.selectionStrategy,
					selectionLimit: params.selectionLimit,
					network: params.network,
					apiBaseUrl: params.apiBaseUrl,
					apiKey: params.apiKey,
					strictAddressCheck: params.strictAddressCheck,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeKaspaAddressSortedUtxosResult(result),
						},
					],
						details: {
						schema: "kaspa.address.utxos.sorted.v1",
						network: result.network,
						address: result.address,
						apiBaseUrl: result.apiBaseUrl,
						strategy: result.strategy,
						limit: result.limit,
						offset: result.offset,
						rawCount: result.rawCount,
						fetchedCount: result.fetchedCount,
						selectedCount: result.selectedCount,
						summary: result.summary,
						data: result.data,
						standardized: buildKaspaReadUtxoStandardization({
							address: result.address,
							network: result.network,
							apiBaseUrl: result.apiBaseUrl,
							limit: result.limit,
							data: result.data,
						}),
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
						standardized: buildKaspaReadTransactionStandardization(
							result.transactionId,
							result,
						),
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
						standardized: buildKaspaReadTransactionOutputStandardization(result),
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
