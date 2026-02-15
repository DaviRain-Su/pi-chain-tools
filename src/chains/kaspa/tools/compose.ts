import { createHash } from "node:crypto";

import { Type } from "@sinclair/typebox";

import { type RegisteredTool, defineTool } from "../../../core/types.js";
import {
	KASPA_TOOL_PREFIX,
	type KaspaNetwork,
	kaspaNetworkSchema,
	normalizeKaspaAddress,
	parseKaspaNetwork,
} from "../runtime.js";

type KaspaComposeInput = {
	network?: string;
	fromAddress: string;
	toAddress?: string;
	amount?: string | number;
	outputs?: unknown;
	utxos: unknown[];
	feeRate?: string | number;
	dustLimit?: string | number;
	changeAddress?: string;
	lockTime?: number;
	requestMemo?: string;
};

type KaspaUtxoInput = {
	txId: string;
	index: number;
	amount: string;
	address?: string;
	scriptPublicKey?: string;
};

type KaspaTransactionOutput = {
	address: string;
	amount: string;
};

const KASPA_DECIMALS = 8;
const KASPA_DEFAULT_FEE_RATE = 1n;
const KASPA_DEFAULT_DUST_LIMIT = 10_000n;
const KASPA_DEFAULT_LOCK_TIME = 0;
const KASPA_TX_BASE_MASS = 1_000n;
const KASPA_INPUT_MASS = 180n;
const KASPA_OUTPUT_MASS = 70n;

function parseKaspaAmount(value: string | number, fieldName: string): bigint {
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error(`${fieldName} must be greater than 0`);
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
		const atomic = `${whole}${fraction}`;
		const parsed = BigInt(atomic);
		if (parsed <= 0n) {
			throw new Error(`${fieldName} must be greater than 0`);
		}
		return parsed;
	}
	throw new Error(`${fieldName} must be a number or numeric string`);
}

function parseKaspaFeeRate(value: string | number | undefined): bigint {
	if (value == null) {
		return KASPA_DEFAULT_FEE_RATE;
	}
	if (typeof value === "bigint") {
		if (value <= 0n) throw new Error("feeRate must be > 0");
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isInteger(value) || value <= 0) {
			throw new Error("feeRate must be a positive integer");
		}
		return BigInt(value);
	}
	if (typeof value === "string") {
		const normalized = value.trim();
		const parsed = Number.parseInt(normalized, 10);
		if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
			throw new Error("feeRate must be a positive integer");
		}
		return BigInt(parsed);
	}
	throw new Error("feeRate must be a positive integer");
}

function parseKaspaDustLimit(value: string | number | undefined): bigint {
	if (value == null) {
		return KASPA_DEFAULT_DUST_LIMIT;
	}
	if (typeof value === "bigint") {
		if (value < 0n) throw new Error("dustLimit cannot be negative");
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isInteger(value) || value < 0) {
			throw new Error("dustLimit must be a non-negative integer");
		}
		return BigInt(value);
	}
	if (typeof value === "string") {
		const normalized = value.trim();
		const parsed = Number.parseInt(normalized, 10);
		if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
			throw new Error("dustLimit must be a non-negative integer");
		}
		return BigInt(parsed);
	}
	throw new Error("dustLimit must be a non-negative integer");
}

function parseKaspaOutputList(
	toAddress: string | undefined,
	amount: string | number | undefined,
	rawOutputs: unknown,
	network: KaspaNetwork,
): KaspaTransactionOutput[] {
	if (Array.isArray(rawOutputs) && rawOutputs.length > 0) {
		const outputs: KaspaTransactionOutput[] = [];
		for (const [index, rawOutput] of rawOutputs.entries()) {
			if (!rawOutput || typeof rawOutput !== "object") {
				throw new Error(`outputs[${index}] must be an object`);
			}
			const entry = rawOutput as Record<string, unknown>;
			const rawOutputAddress =
				typeof entry.address === "string" ? entry.address.trim() : "";
			if (!rawOutputAddress) {
				throw new Error(`outputs[${index}].address is required`);
			}
			const outputAmount =
				typeof entry.amount === "string" || typeof entry.amount === "number"
					? parseKaspaAmount(entry.amount, `outputs[${index}].amount`)
					: undefined;
			if (outputAmount == null) {
				throw new Error(`outputs[${index}].amount is required`);
			}
			outputs.push({
				address: normalizeKaspaAddress(rawOutputAddress, network, false),
				amount: outputAmount.toString(),
			});
		}
		if (outputs.length === 0) {
			throw new Error("outputs cannot be empty when provided");
		}
		return outputs;
	}

	if (toAddress == null) {
		throw new Error("toAddress is required when outputs is not provided");
	}
	if (amount == null) {
		throw new Error("amount is required when outputs is not provided");
	}
	const singleAmount = parseKaspaAmount(amount, "amount");
	return [
		{
			address: normalizeKaspaAddress(toAddress, network, false),
			amount: singleAmount.toString(),
		},
	];
}

function parseKaspaUtxos(rawUtxos: unknown[]): KaspaUtxoInput[] {
	if (!Array.isArray(rawUtxos) || rawUtxos.length === 0) {
		throw new Error("At least one utxo is required");
	}
	const utxos: KaspaUtxoInput[] = [];
	for (const [index, raw] of rawUtxos.entries()) {
		if (!raw || typeof raw !== "object") {
			throw new Error(`utxos[${index}] must be an object`);
		}
		const candidate = raw as Record<string, unknown>;
		const txId =
			typeof candidate.txId === "string" ? candidate.txId.trim() : "";
		if (!txId) {
			throw new Error(`utxos[${index}].txId is required`);
		}
		const rawIndex = candidate.index;
		if (
			typeof rawIndex !== "number" ||
			!Number.isInteger(rawIndex) ||
			rawIndex < 0
		) {
			throw new Error(`utxos[${index}].index must be a non-negative integer`);
		}
		const rawAmount =
			typeof candidate.amount === "string" ||
			typeof candidate.amount === "number"
				? candidate.amount
				: undefined;
		if (rawAmount == null) {
			throw new Error(`utxos[${index}].amount is required`);
		}
		const amount = parseKaspaAmount(
			rawAmount,
			`utxos[${index}].amount`,
		).toString();
		const utxo: KaspaUtxoInput = { txId, index: rawIndex, amount };
		if (typeof candidate.address === "string" && candidate.address.trim()) {
			utxo.address = candidate.address.trim();
		}
		if (
			typeof candidate.scriptPublicKey === "string" &&
			candidate.scriptPublicKey.trim()
		) {
			utxo.scriptPublicKey = candidate.scriptPublicKey.trim();
		}
		utxos.push(utxo);
	}
	return utxos;
}

function estimateKaspaMass(inputCount: number, outputCount: number): bigint {
	return (
		KASPA_TX_BASE_MASS +
		KASPA_INPUT_MASS * BigInt(inputCount) +
		KASPA_OUTPUT_MASS * BigInt(outputCount)
	);
}

function estimateKaspaFee(
	inputCount: number,
	outputCount: number,
	feeRate: bigint,
): bigint {
	return estimateKaspaMass(inputCount, outputCount) * feeRate;
}

function pickKaspaInputs(params: {
	utxos: KaspaUtxoInput[];
	targetAmount: bigint;
	outputCount: number;
	feeRate: bigint;
	dustLimit: bigint;
}): {
	selected: KaspaUtxoInput[];
	totalInput: bigint;
	fee: bigint;
	hasChange: boolean;
	change: bigint;
} {
	const sorted = [...params.utxos].sort((a, b) => {
		const diff = BigInt(a.amount) > BigInt(b.amount);
		return diff ? -1 : BigInt(a.amount) < BigInt(b.amount) ? 1 : 0;
	});

	let selected: KaspaUtxoInput[] = [];
	let totalInput = 0n;
	let selectedFee = 0n;
	let selectedHasChange = false;
	let selectedChange = 0n;

	for (const utxo of sorted) {
		totalInput += BigInt(utxo.amount);
		selected = [...selected, utxo];
		const inputCount = selected.length;

		const feeWithoutChange = estimateKaspaFee(
			inputCount,
			params.outputCount,
			params.feeRate,
		);
		if (totalInput >= params.targetAmount + feeWithoutChange) {
			const remainder = totalInput - params.targetAmount - feeWithoutChange;
			if (remainder >= 0n && remainder < params.dustLimit) {
				selectedFee = feeWithoutChange;
				selectedHasChange = false;
				selectedChange = 0n;
				break;
			}
		}

		const feeWithChange = estimateKaspaFee(
			inputCount,
			params.outputCount + 1,
			params.feeRate,
		);
		if (totalInput >= params.targetAmount + feeWithChange) {
			const remainder = totalInput - params.targetAmount - feeWithChange;
			if (remainder >= params.dustLimit) {
				selectedFee = feeWithChange;
				selectedHasChange = true;
				selectedChange = remainder;
				break;
			}
		}
	}

	if (selected.length === 0 || selectedFee === 0n) {
		const totalAvailable = sorted.reduce(
			(sum, u) => sum + BigInt(u.amount),
			0n,
		);
		const minimalFee = estimateKaspaFee(
			1,
			params.outputCount + 1,
			params.feeRate,
		);
		if (totalAvailable < params.targetAmount + minimalFee) {
			throw new Error("Insufficient balance for amount + fee");
		}
		throw new Error(
			"Unable to find a valid UTXO set with current fee/dust settings",
		);
	}
	if (selected.length === 0) {
		throw new Error("Unable to assemble spendable UTXO set");
	}

	if (totalInput < params.targetAmount + selectedFee) {
		throw new Error("Insufficient selected UTXO balance for amount + fee");
	}

	return {
		selected,
		totalInput,
		fee: selectedFee,
		hasChange: selectedHasChange,
		change: selectedHasChange ? selectedChange : 0n,
	};
}

function normalizeLockTime(raw: unknown): number {
	if (raw == null) {
		return KASPA_DEFAULT_LOCK_TIME;
	}
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
		throw new Error("lockTime must be a non-negative integer");
	}
	return raw;
}

function resolveNetworkTag(network: string): string {
	if (network === "mainnet") return "kaspa-mainnet";
	if (network === "testnet11") return "kaspa-testnet11";
	return "kaspa-testnet10";
}

function stableKaspaJson(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableKaspaJson(entry)).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const sorted = Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableKaspaJson(record[key])}`)
		.join(",");
	return `{${sorted}}`;
}

function buildKaspaRequestHash(payload: unknown): string {
	return createHash("sha256").update(stableKaspaJson(payload)).digest("hex");
}

export function createKaspaComposeTools(): RegisteredTool[] {
	return [
		defineTool({
			name: `${KASPA_TOOL_PREFIX}buildTransferTransaction`,
			label: "Kaspa Build Transfer Transaction",
			description:
				"Build an unsigned Kaspa transfer transaction payload for local signing.",
			parameters: Type.Object({
				network: kaspaNetworkSchema(),
				fromAddress: Type.String({
					description:
						"Sender Kaspa address (sender must be able to sign corresponding inputs).",
				}),
				toAddress: Type.Optional(
					Type.String({
						description:
							"Recipient address. If outputs is omitted, toAddress+amount must be provided.",
					}),
				),
				amount: Type.Optional(
					Type.Union([
						Type.String({
							description: "Amount in KAS (decimal text preferred).",
						}),
						Type.Number({
							description: "Amount in KAS as number.",
						}),
					]),
				),
				outputs: Type.Optional(
					Type.Array(
						Type.Object({
							address: Type.String({
								description:
									"Recipient address for one output. Use with amount list or amount fields.",
							}),
							amount: Type.Union([
								Type.String({
									description: "Output amount in KAS decimal text.",
								}),
								Type.Number({
									description: "Output amount as number.",
								}),
							]),
						}),
						{ minItems: 1 },
					),
				),
				utxos: Type.Array(
					Type.Object(
						{
							txId: Type.String(),
							index: Type.Integer({ minimum: 0 }),
							amount: Type.Union([Type.String(), Type.Number()]),
							address: Type.Optional(Type.String()),
							scriptPublicKey: Type.Optional(Type.String()),
						},
						{ minItems: 1 },
					),
				),
				feeRate: Type.Optional(
					Type.Union([Type.String(), Type.Integer({ minimum: 1 })]),
				),
				dustLimit: Type.Optional(
					Type.Union([Type.String(), Type.Integer({ minimum: 0 })]),
				),
				changeAddress: Type.Optional(
					Type.String({
						description:
							"Optional change destination. Defaults to fromAddress.",
					}),
				),
				lockTime: Type.Optional(Type.Integer({ minimum: 0 })),
				requestMemo: Type.Optional(
					Type.String({
						description: "Optional memo for transaction builders/tests.",
					}),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as KaspaComposeInput;
				const network = parseKaspaNetwork(params.network);
				const fromAddress = normalizeKaspaAddress(
					params.fromAddress,
					network,
					false,
				);
				const changeAddress = params.changeAddress
					? normalizeKaspaAddress(params.changeAddress, network, false)
					: fromAddress;
				const outputs = parseKaspaOutputList(
					params.toAddress,
					params.amount,
					params.outputs,
					network,
				);
				const targetAmount = outputs.reduce(
					(sum, output) => sum + BigInt(output.amount),
					0n,
				);
				const utxos = parseKaspaUtxos(params.utxos);
				const feeRate = parseKaspaFeeRate(params.feeRate);
				const dustLimit = parseKaspaDustLimit(params.dustLimit);
				const selected = pickKaspaInputs({
					utxos,
					targetAmount,
					outputCount: outputs.length,
					feeRate,
					dustLimit,
				});
				const finalOutputs: KaspaTransactionOutput[] = [...outputs];
				if (selected.hasChange && selected.change > 0n) {
					finalOutputs.push({
						address: changeAddress,
						amount: selected.change.toString(),
					});
				}
				const unsignedTransaction = {
					version: 0,
					network: resolveNetworkTag(network),
					lockTime: normalizeLockTime(params.lockTime),
					from: fromAddress,
					inputs: selected.selected.map((utxo, index) => ({
						index,
						txId: utxo.txId,
						outputIndex: utxo.index,
						amount: utxo.amount,
						address: utxo.address,
						scriptPublicKey: utxo.scriptPublicKey,
					})),
					outputs: finalOutputs.map((output) => ({
						address: output.address,
						amount: output.amount,
					})),
					memo: params.requestMemo?.trim() || undefined,
				};

				const requestHashPayload = {
					transaction: unsignedTransaction,
				};
				const requestHash = buildKaspaRequestHash(requestHashPayload);
				const detailsMetadata = {
					version: 0,
					createdAt: new Date().toISOString(),
					network,
					networkTag: resolveNetworkTag(network),
					requiresSignature: true,
					inputCount: selected.selected.length,
					feeRate: feeRate.toString(),
					dustLimit: dustLimit.toString(),
					totalInputAmount: selected.totalInput.toString(),
					totalOutputAmount: outputs
						.reduce((sum, output) => sum + BigInt(output.amount), 0n)
						.toString(),
					feeAmount: selected.fee.toString(),
					changeAmount: selected.hasChange ? selected.change.toString() : "0",
					requestHash,
				};

				return {
					content: [
						{
							type: "text",
							text: `Kaspa unsigned transaction built (chain=${network}, fee=${selected.fee}, inputCount=${selected.selected.length}, requestHash=${requestHash}).`,
						},
					],
					details: {
						schema: "kaspa.transaction.compose.v1",
						network,
						fromAddress,
						changeAddress,
						lockTime: normalizeLockTime(params.lockTime),
						requestHash,
						requiresLocalSignature: true,
						tx: unsignedTransaction,
						request: {
							rawTransaction: JSON.stringify(unsignedTransaction),
							metadata: {
								...detailsMetadata,
							},
						},
					},
				};
			},
		}),
	];
}
