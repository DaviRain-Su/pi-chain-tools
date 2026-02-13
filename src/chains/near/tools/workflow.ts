import { createHash, randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	fetchRefPoolById,
	getRefContractId,
	getRefSwapQuote,
	getRefTokenDecimalsHint,
	resolveRefTokenIds,
} from "../ref.js";
import {
	callNearRpc,
	nearNetworkSchema,
	parseNearNetwork,
	resolveNearAccountId,
	toYoctoNear,
} from "../runtime.js";
import { createNearExecuteTools } from "./execute.js";

type WorkflowRunMode = "analysis" | "simulate" | "execute";

type NearTransferIntent = {
	type: "near.transfer.near";
	toAccountId: string;
	amountYoctoNear: string;
	fromAccountId?: string;
};

type NearFtTransferIntent = {
	type: "near.transfer.ft";
	toAccountId: string;
	ftContractId: string;
	amountRaw: string;
	fromAccountId?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearRefSwapIntent = {
	type: "near.swap.ref";
	tokenInId: string;
	tokenOutId: string;
	amountInRaw: string;
	amountInUi?: string;
	poolId?: number;
	slippageBps?: number;
	refContractId?: string;
	minAmountOutRaw?: string;
	fromAccountId?: string;
	autoRegisterOutput?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearRefAddLiquidityIntent = {
	type: "near.lp.ref.add";
	poolId: number;
	amountARaw: string;
	amountBRaw: string;
	tokenAId?: string;
	tokenBId?: string;
	refContractId?: string;
	fromAccountId?: string;
	autoRegisterExchange?: boolean;
	autoRegisterTokens?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearRefRemoveLiquidityIntent = {
	type: "near.lp.ref.remove";
	poolId: number;
	shares: string;
	minAmountsRaw?: string[];
	minAmountARaw?: string;
	minAmountBRaw?: string;
	refContractId?: string;
	fromAccountId?: string;
	gas?: string;
	attachedDepositYoctoNear?: string;
};

type NearWorkflowIntent =
	| NearTransferIntent
	| NearFtTransferIntent
	| NearRefSwapIntent
	| NearRefAddLiquidityIntent
	| NearRefRemoveLiquidityIntent;

type WorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	intentType?: NearWorkflowIntent["type"];
	intentText?: string;
	network?: string;
	rpcUrl?: string;
	toAccountId?: string;
	fromAccountId?: string;
	amountNear?: string | number;
	amountYoctoNear?: string;
	ftContractId?: string;
	amountRaw?: string;
	amountInRaw?: string;
	amountIn?: string | number;
	tokenInId?: string;
	tokenOutId?: string;
	tokenAId?: string;
	tokenBId?: string;
	poolId?: number | string;
	slippageBps?: number;
	refContractId?: string;
	minAmountOutRaw?: string;
	amountA?: string | number;
	amountB?: string | number;
	amountARaw?: string;
	amountBRaw?: string;
	shares?: string;
	minAmountsRaw?: string[];
	minAmountARaw?: string;
	minAmountBRaw?: string;
	autoRegisterOutput?: boolean;
	autoRegisterExchange?: boolean;
	autoRegisterTokens?: boolean;
	gas?: string;
	attachedDepositYoctoNear?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	privateKey?: string;
};

type ParsedIntentHints = {
	intentType?: NearWorkflowIntent["type"];
	toAccountId?: string;
	amountNear?: string;
	ftContractId?: string;
	amountRaw?: string;
	amountInRaw?: string;
	amountInUi?: string;
	tokenInId?: string;
	tokenOutId?: string;
	tokenAId?: string;
	tokenBId?: string;
	amountAUi?: string;
	amountBUi?: string;
	amountARaw?: string;
	amountBRaw?: string;
	shares?: string;
	minAmountARaw?: string;
	minAmountBRaw?: string;
	poolId?: number;
	slippageBps?: number;
	refContractId?: string;
};

type NearAccountQueryResult = {
	amount: string;
	locked: string;
	block_hash: string;
	block_height: number;
};

type NearCallFunctionResult = {
	result: number[];
	logs: string[];
	block_height: number;
	block_hash: string;
};

type WorkflowSessionRecord = {
	runId: string;
	network: "mainnet" | "testnet";
	intent: NearWorkflowIntent;
	confirmToken: string | null;
};

type WorkflowTool = ReturnType<typeof createNearExecuteTools>[number];

const WORKFLOW_SESSION_BY_RUN_ID = new Map<string, WorkflowSessionRecord>();
let latestWorkflowSession: WorkflowSessionRecord | null = null;

function rememberWorkflowSession(record: WorkflowSessionRecord): void {
	WORKFLOW_SESSION_BY_RUN_ID.set(record.runId, record);
	latestWorkflowSession = record;
}

function readWorkflowSession(runId?: string): WorkflowSessionRecord | null {
	if (runId && WORKFLOW_SESSION_BY_RUN_ID.has(runId)) {
		return WORKFLOW_SESSION_BY_RUN_ID.get(runId) ?? null;
	}
	return latestWorkflowSession;
}

function parseRunMode(value?: string): WorkflowRunMode {
	if (value === "analysis" || value === "simulate" || value === "execute") {
		return value;
	}
	return "analysis";
}

function parsePositiveBigInt(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	const parsed = BigInt(normalized);
	if (parsed <= 0n) {
		throw new Error(`${fieldName} must be greater than 0`);
	}
	return parsed;
}

function parseNonNegativeBigInt(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	return BigInt(normalized);
}

function normalizeAccountId(value: string, fieldName: string): string {
	const normalized = value.trim().replace(/^@/, "");
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

function createRunId(explicitRunId?: string): string {
	if (typeof explicitRunId === "string" && explicitRunId.trim()) {
		return explicitRunId.trim();
	}
	return `wf-near-${randomUUID().slice(0, 8)}`;
}

function createConfirmToken(params: {
	runId: string;
	network: string;
	intent: NearWorkflowIntent;
}): string {
	const digest = createHash("sha256")
		.update(params.runId)
		.update("|")
		.update(params.network)
		.update("|")
		.update(JSON.stringify(params.intent))
		.digest("hex")
		.slice(0, 10)
		.toUpperCase();
	return `NEAR-${digest}`;
}

function parseOptionalPoolId(
	value: number | string | undefined,
	fieldName: string,
): number | undefined {
	if (value == null) return undefined;
	if (typeof value === "string" && !value.trim()) return undefined;
	const normalized = typeof value === "number" ? value : Number(value.trim());
	if (
		!Number.isFinite(normalized) ||
		!Number.isInteger(normalized) ||
		normalized < 0
	) {
		throw new Error(`${fieldName} must be a non-negative integer`);
	}
	return normalized;
}

function parseOptionalSlippageBps(
	value: number | undefined,
	fieldName: string,
): number | undefined {
	if (value == null) return undefined;
	if (!Number.isFinite(value) || value < 0 || value > 5000) {
		throw new Error(`${fieldName} must be between 0 and 5000`);
	}
	return Math.floor(value);
}

function normalizeTokenInput(value: string, fieldName: string): string {
	const normalized = value.trim().replace(/^@/, "");
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

function parseScaledDecimalToRaw(
	value: string,
	decimals: number,
	fieldName: string,
): string {
	const normalized = value.trim();
	if (!/^\d+(\.\d+)?$/.test(normalized)) {
		throw new Error(`${fieldName} must be a positive decimal number`);
	}
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
		throw new Error("token decimals are invalid");
	}
	const [wholePart, fractionPart = ""] = normalized.split(".");
	if (fractionPart.length > decimals) {
		throw new Error(`${fieldName} supports up to ${decimals} decimal places`);
	}
	const whole = BigInt(wholePart);
	const fraction = fractionPart.padEnd(decimals, "0");
	const fractionValue = fraction ? BigInt(fraction) : 0n;
	return (whole * 10n ** BigInt(decimals) + fractionValue).toString();
}

function parseRefLpAmountRaw(params: {
	valueRaw?: string;
	valueUi?: string | number;
	tokenInput?: string;
	network?: string;
	fieldRaw: string;
	fieldUi: string;
}): string {
	if (typeof params.valueRaw === "string" && params.valueRaw.trim()) {
		return parsePositiveBigInt(params.valueRaw, params.fieldRaw).toString();
	}
	if (params.valueUi == null) {
		throw new Error(
			`Missing ${params.fieldRaw}. Provide ${params.fieldRaw} or ${params.fieldUi}.`,
		);
	}
	const uiValue =
		typeof params.valueUi === "number"
			? params.valueUi.toString()
			: params.valueUi.trim();
	if (!uiValue) {
		throw new Error(
			`Missing ${params.fieldRaw}. Provide ${params.fieldRaw} or ${params.fieldUi}.`,
		);
	}
	if (!params.tokenInput || !params.tokenInput.trim()) {
		throw new Error(
			`${params.fieldUi} requires token id/symbol (${params.fieldRaw} can be used instead).`,
		);
	}
	const decimals = getRefTokenDecimalsHint({
		network: params.network,
		tokenIdOrSymbol: params.tokenInput,
	});
	if (decimals == null) {
		throw new Error(
			`Cannot infer decimals for ${params.tokenInput}. Provide ${params.fieldRaw}.`,
		);
	}
	const rawAmount = parseScaledDecimalToRaw(uiValue, decimals, params.fieldUi);
	return parsePositiveBigInt(rawAmount, params.fieldUi).toString();
}

function parseIntentHints(intentText?: string): ParsedIntentHints {
	if (!intentText || !intentText.trim()) return {};
	const text = intentText.trim();
	const lower = text.toLowerCase();
	const toMatch = text.match(
		/(?:to|给|到)\s*([a-z0-9][a-z0-9._-]*(?:\.near)?)/i,
	);
	const nearAmountMatch = text.match(/(\d+(?:\.\d+)?)\s*near\b/i);
	const ftContractMatch = text.match(
		/(?:contract|合约|token)\s*[:：]?\s*([a-z0-9][a-z0-9._-]*(?:\.near)?)/i,
	);
	const rawAmountMatch = text.match(
		/(?:raw|amountRaw|数量|amount)\s*[:：]?\s*(\d+)/i,
	);
	const swapUiAmountMatch = text.match(
		/(?:swap|把|将)?\s*(\d+(?:\.\d+)?)\s*([a-z][a-z0-9._-]*)\s*(?:->|to|换成|换到|兑换为|兑换成)\s*([a-z][a-z0-9._-]*)/i,
	);
	const swapPairMatch = text.match(
		/([a-z0-9][a-z0-9._-]*\.near)\s*(?:->|to|换成|换到|兑换为|兑换成|到)\s*([a-z0-9][a-z0-9._-]*\.near)/i,
	);
	const lpPairMatch = text.match(
		/([a-z][a-z0-9._-]*)\s*\/\s*([a-z][a-z0-9._-]*)/i,
	);
	const poolIdMatch = text.match(/(?:pool|池子|池)\s*[:：]?\s*(\d+)/i);
	const slippageMatch = text.match(
		/(?:slippage|滑点)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:bps)?/i,
	);
	const refContractMatch = text.match(
		/(?:ref\s*contract|ref合约|交易所合约)\s*[:：]?\s*([a-z0-9][a-z0-9._-]*(?:\.near)?)/i,
	);
	const amountARawMatch = text.match(
		/(?:amounta[_\s-]*raw|amountaraw|rawa)\s*[:：]?\s*(\d+)/i,
	);
	const amountBRawMatch = text.match(
		/(?:amountb[_\s-]*raw|amountbraw|rawb)\s*[:：]?\s*(\d+)/i,
	);
	const amountAUiMatch = text.match(
		/(?:amounta|tokena|数量a|金额a)\s*[:：]?\s*(\d+(?:\.\d+)?)/i,
	);
	const amountBUiMatch = text.match(
		/(?:amountb|tokenb|数量b|金额b)\s*[:：]?\s*(\d+(?:\.\d+)?)/i,
	);
	const sharesMatch = text.match(
		/(?:shares?|lp\s*shares|份额)\s*[:：]?\s*(\d+)/i,
	);
	const minAmountARawMatch = text.match(
		/(?:minamounta[_\s-]*raw|minamountaraw|mina)\s*[:：]?\s*(\d+)/i,
	);
	const minAmountBRawMatch = text.match(
		/(?:minamountb[_\s-]*raw|minamountbraw|minb)\s*[:：]?\s*(\d+)/i,
	);
	const tokenAMatch = text.match(
		/(?:tokena|币a|代币a|token_a)\s*[:：]?\s*([a-z][a-z0-9._-]*)/i,
	);
	const tokenBMatch = text.match(
		/(?:tokenb|币b|代币b|token_b)\s*[:：]?\s*([a-z][a-z0-9._-]*)/i,
	);

	const likelyFt =
		(lower.includes("ft") ||
			lower.includes("token") ||
			lower.includes("代币") ||
			/\btransfer\b/.test(lower) ||
			/\bsend\b/.test(lower)) &&
		!lower.includes("swap") &&
		!lower.includes("兑换");
	const likelySwap =
		lower.includes("swap") ||
		lower.includes("兑换") ||
		lower.includes("换成") ||
		lower.includes("换到");
	const hasLpKeyword =
		lower.includes("lp") ||
		lower.includes("liquidity") ||
		lower.includes("流动性");
	const likelyLpAdd =
		hasLpKeyword &&
		(lower.includes("add") ||
			lower.includes("provide") ||
			lower.includes("添加") ||
			lower.includes("增加"));
	const likelyLpRemove =
		hasLpKeyword &&
		(lower.includes("remove") ||
			lower.includes("withdraw") ||
			lower.includes("撤出") ||
			lower.includes("移除") ||
			lower.includes("减少"));
	const hasNearAmount = nearAmountMatch != null;

	const hints: ParsedIntentHints = {};
	if (toMatch?.[1]) hints.toAccountId = toMatch[1];
	if (nearAmountMatch?.[1]) hints.amountNear = nearAmountMatch[1];
	if (ftContractMatch?.[1]) hints.ftContractId = ftContractMatch[1];
	if (rawAmountMatch?.[1]) {
		hints.amountRaw = rawAmountMatch[1];
		hints.amountInRaw = rawAmountMatch[1];
	}
	if (swapUiAmountMatch?.[1]) hints.amountInUi = swapUiAmountMatch[1];
	if (swapUiAmountMatch?.[2]) hints.tokenInId = swapUiAmountMatch[2];
	if (swapUiAmountMatch?.[3]) hints.tokenOutId = swapUiAmountMatch[3];
	if (swapPairMatch?.[1]) hints.tokenInId = swapPairMatch[1];
	if (swapPairMatch?.[2]) hints.tokenOutId = swapPairMatch[2];
	if (lpPairMatch?.[1]) hints.tokenAId = lpPairMatch[1];
	if (lpPairMatch?.[2]) hints.tokenBId = lpPairMatch[2];
	if (tokenAMatch?.[1]) hints.tokenAId = tokenAMatch[1];
	if (tokenBMatch?.[1]) hints.tokenBId = tokenBMatch[1];
	if (amountARawMatch?.[1]) hints.amountARaw = amountARawMatch[1];
	if (amountBRawMatch?.[1]) hints.amountBRaw = amountBRawMatch[1];
	if (!hints.amountARaw && amountAUiMatch?.[1])
		hints.amountAUi = amountAUiMatch[1];
	if (!hints.amountBRaw && amountBUiMatch?.[1])
		hints.amountBUi = amountBUiMatch[1];
	if (sharesMatch?.[1]) hints.shares = sharesMatch[1];
	if (minAmountARawMatch?.[1]) hints.minAmountARaw = minAmountARawMatch[1];
	if (minAmountBRawMatch?.[1]) hints.minAmountBRaw = minAmountBRawMatch[1];
	if (poolIdMatch?.[1]) {
		const parsed = Number(poolIdMatch[1]);
		if (Number.isInteger(parsed) && parsed >= 0) {
			hints.poolId = parsed;
		}
	}
	if (slippageMatch?.[1]) {
		const parsed = Number(slippageMatch[1]);
		if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 5000) {
			hints.slippageBps = Math.floor(parsed);
		}
	}
	if (refContractMatch?.[1]) {
		hints.refContractId = refContractMatch[1];
	}

	if (
		likelyLpRemove &&
		(hints.poolId != null ||
			(typeof hints.shares === "string" && hints.shares.trim().length > 0))
	) {
		hints.intentType = "near.lp.ref.remove";
		return hints;
	}

	if (
		likelyLpAdd &&
		(hints.poolId != null ||
			typeof hints.amountARaw === "string" ||
			typeof hints.amountBRaw === "string" ||
			typeof hints.amountAUi === "string" ||
			typeof hints.amountBUi === "string")
	) {
		hints.intentType = "near.lp.ref.add";
		return hints;
	}

	if (
		hints.tokenInId &&
		hints.tokenOutId &&
		(likelySwap || hints.amountInRaw || hints.amountInUi)
	) {
		hints.intentType = "near.swap.ref";
		return hints;
	}

	if (
		hints.ftContractId ||
		(likelyFt && hints.amountRaw && hints.toAccountId)
	) {
		hints.intentType = "near.transfer.ft";
		return hints;
	}
	if (hasNearAmount && hints.toAccountId) {
		hints.intentType = "near.transfer.near";
		return hints;
	}
	return hints;
}

function inferIntentType(
	params: WorkflowParams,
	hints: ParsedIntentHints,
): NearWorkflowIntent["type"] {
	if (params.intentType === "near.lp.ref.add") return params.intentType;
	if (params.intentType === "near.lp.ref.remove") return params.intentType;
	if (params.intentType === "near.swap.ref") return params.intentType;
	if (params.intentType === "near.transfer.near") return params.intentType;
	if (params.intentType === "near.transfer.ft") return params.intentType;
	if (hints.intentType) return hints.intentType;
	if (params.poolId != null && params.shares) {
		return "near.lp.ref.remove";
	}
	if (
		params.poolId != null &&
		(params.amountARaw ||
			params.amountBRaw ||
			params.amountA != null ||
			params.amountB != null ||
			params.tokenAId ||
			params.tokenBId)
	) {
		return "near.lp.ref.add";
	}
	if (
		params.tokenInId ||
		params.tokenOutId ||
		params.amountInRaw ||
		params.poolId != null
	) {
		return "near.swap.ref";
	}
	if (params.ftContractId || (params.amountRaw && params.toAccountId)) {
		return "near.transfer.ft";
	}
	return "near.transfer.near";
}

function normalizeIntent(params: WorkflowParams): NearWorkflowIntent {
	const hints = parseIntentHints(params.intentText);
	const intentType = inferIntentType(params, hints);
	const fromAccountId =
		typeof params.fromAccountId === "string" && params.fromAccountId.trim()
			? normalizeAccountId(params.fromAccountId, "fromAccountId")
			: undefined;

	if (intentType === "near.transfer.near") {
		const toAccountId = normalizeAccountId(
			params.toAccountId ?? hints.toAccountId ?? "",
			"toAccountId",
		);
		let amountYoctoNear: bigint;
		if (
			typeof params.amountYoctoNear === "string" &&
			params.amountYoctoNear.trim()
		) {
			amountYoctoNear = parsePositiveBigInt(
				params.amountYoctoNear,
				"amountYoctoNear",
			);
		} else {
			const nearAmount = params.amountNear ?? hints.amountNear;
			if (nearAmount == null) {
				throw new Error(
					"Missing transfer amount. Provide amountNear or amountYoctoNear.",
				);
			}
			amountYoctoNear = toYoctoNear(nearAmount);
		}
		return {
			type: "near.transfer.near",
			toAccountId,
			amountYoctoNear: amountYoctoNear.toString(),
			fromAccountId,
		};
	}

	if (intentType === "near.lp.ref.add") {
		const poolId = parseOptionalPoolId(params.poolId ?? hints.poolId, "poolId");
		if (poolId == null) {
			throw new Error("poolId is required for near.lp.ref.add");
		}
		const tokenAInput = params.tokenAId ?? hints.tokenAId;
		const tokenBInput = params.tokenBId ?? hints.tokenBId;
		const amountARaw = parseRefLpAmountRaw({
			valueRaw: params.amountARaw ?? hints.amountARaw,
			valueUi: params.amountA ?? hints.amountAUi,
			tokenInput: tokenAInput,
			network: params.network,
			fieldRaw: "amountARaw",
			fieldUi: "amountA",
		});
		const amountBRaw = parseRefLpAmountRaw({
			valueRaw: params.amountBRaw ?? hints.amountBRaw,
			valueUi: params.amountB ?? hints.amountBUi,
			tokenInput: tokenBInput,
			network: params.network,
			fieldRaw: "amountBRaw",
			fieldUi: "amountB",
		});
		const refContractId =
			typeof params.refContractId === "string" && params.refContractId.trim()
				? normalizeAccountId(params.refContractId, "refContractId")
				: typeof hints.refContractId === "string" && hints.refContractId.trim()
					? normalizeAccountId(hints.refContractId, "refContractId")
					: undefined;
		return {
			type: "near.lp.ref.add",
			poolId,
			amountARaw,
			amountBRaw,
			tokenAId:
				typeof tokenAInput === "string" && tokenAInput.trim()
					? normalizeTokenInput(tokenAInput, "tokenAId")
					: undefined,
			tokenBId:
				typeof tokenBInput === "string" && tokenBInput.trim()
					? normalizeTokenInput(tokenBInput, "tokenBId")
					: undefined,
			refContractId,
			fromAccountId,
			autoRegisterExchange: params.autoRegisterExchange !== false,
			autoRegisterTokens: params.autoRegisterTokens !== false,
			gas:
				typeof params.gas === "string" && params.gas.trim()
					? params.gas.trim()
					: undefined,
			attachedDepositYoctoNear:
				typeof params.attachedDepositYoctoNear === "string" &&
				params.attachedDepositYoctoNear.trim()
					? params.attachedDepositYoctoNear.trim()
					: undefined,
		};
	}

	if (intentType === "near.lp.ref.remove") {
		const poolId = parseOptionalPoolId(params.poolId ?? hints.poolId, "poolId");
		if (poolId == null) {
			throw new Error("poolId is required for near.lp.ref.remove");
		}
		const sharesInput = params.shares ?? hints.shares ?? "";
		const shares = parsePositiveBigInt(sharesInput, "shares").toString();
		const minAmountsRaw =
			Array.isArray(params.minAmountsRaw) && params.minAmountsRaw.length > 0
				? params.minAmountsRaw.map((value, index) =>
						parseNonNegativeBigInt(value, `minAmountsRaw[${index}]`).toString(),
					)
				: undefined;
		const minAmountARaw =
			typeof params.minAmountARaw === "string" && params.minAmountARaw.trim()
				? parseNonNegativeBigInt(
						params.minAmountARaw,
						"minAmountARaw",
					).toString()
				: typeof hints.minAmountARaw === "string" && hints.minAmountARaw.trim()
					? parseNonNegativeBigInt(
							hints.minAmountARaw,
							"minAmountARaw",
						).toString()
					: undefined;
		const minAmountBRaw =
			typeof params.minAmountBRaw === "string" && params.minAmountBRaw.trim()
				? parseNonNegativeBigInt(
						params.minAmountBRaw,
						"minAmountBRaw",
					).toString()
				: typeof hints.minAmountBRaw === "string" && hints.minAmountBRaw.trim()
					? parseNonNegativeBigInt(
							hints.minAmountBRaw,
							"minAmountBRaw",
						).toString()
					: undefined;
		const refContractId =
			typeof params.refContractId === "string" && params.refContractId.trim()
				? normalizeAccountId(params.refContractId, "refContractId")
				: typeof hints.refContractId === "string" && hints.refContractId.trim()
					? normalizeAccountId(hints.refContractId, "refContractId")
					: undefined;
		return {
			type: "near.lp.ref.remove",
			poolId,
			shares,
			minAmountsRaw,
			minAmountARaw,
			minAmountBRaw,
			refContractId,
			fromAccountId,
			gas:
				typeof params.gas === "string" && params.gas.trim()
					? params.gas.trim()
					: undefined,
			attachedDepositYoctoNear:
				typeof params.attachedDepositYoctoNear === "string" &&
				params.attachedDepositYoctoNear.trim()
					? params.attachedDepositYoctoNear.trim()
					: undefined,
		};
	}

	if (intentType === "near.swap.ref") {
		const tokenInId = normalizeTokenInput(
			params.tokenInId ?? hints.tokenInId ?? "",
			"tokenInId",
		);
		const tokenOutId = normalizeTokenInput(
			params.tokenOutId ?? hints.tokenOutId ?? "",
			"tokenOutId",
		);
		if (tokenInId === tokenOutId) {
			throw new Error("tokenInId and tokenOutId must be different");
		}
		const explicitRawAmount =
			params.amountInRaw?.trim() ??
			params.amountRaw?.trim() ??
			hints.amountInRaw?.trim() ??
			hints.amountRaw?.trim() ??
			"";
		const amountInRaw =
			explicitRawAmount ||
			(() => {
				const explicitUiAmount =
					typeof params.amountIn === "number"
						? params.amountIn.toString()
						: typeof params.amountIn === "string"
							? params.amountIn.trim()
							: (hints.amountInUi?.trim() ?? "");
				if (!explicitUiAmount) {
					const nearAmountInput =
						typeof params.amountNear === "number" ||
						typeof params.amountNear === "string"
							? params.amountNear
							: hints.amountNear;
					const nearLikeToken =
						tokenInId.toLowerCase() === "near" ||
						tokenInId.toLowerCase() === "wnear" ||
						tokenInId.toLowerCase().includes("wrap.near") ||
						tokenInId.toLowerCase().includes("wrap.testnet");
					if (nearAmountInput != null && nearLikeToken) {
						return toYoctoNear(nearAmountInput).toString();
					}
					throw new Error(
						"amountInRaw is required for near.swap.ref (or provide decimal amount like '0.01 NEAR').",
					);
				}
				const decimals =
					getRefTokenDecimalsHint({
						network: params.network,
						tokenIdOrSymbol: tokenInId,
					}) ?? null;
				if (decimals == null) {
					throw new Error(
						`Cannot infer decimals for ${tokenInId}. Provide amountInRaw explicitly.`,
					);
				}
				return parseScaledDecimalToRaw(explicitUiAmount, decimals, "amountIn");
			})();
		parsePositiveBigInt(amountInRaw, "amountInRaw");
		const minAmountOutRaw =
			typeof params.minAmountOutRaw === "string" &&
			params.minAmountOutRaw.trim()
				? parsePositiveBigInt(
						params.minAmountOutRaw,
						"minAmountOutRaw",
					).toString()
				: undefined;
		const refContractId =
			typeof params.refContractId === "string" && params.refContractId.trim()
				? normalizeAccountId(params.refContractId, "refContractId")
				: typeof hints.refContractId === "string" && hints.refContractId.trim()
					? normalizeAccountId(hints.refContractId, "refContractId")
					: undefined;
		return {
			type: "near.swap.ref",
			tokenInId,
			tokenOutId,
			amountInRaw,
			poolId: parseOptionalPoolId(params.poolId ?? hints.poolId, "poolId"),
			slippageBps: parseOptionalSlippageBps(
				params.slippageBps ?? hints.slippageBps,
				"slippageBps",
			),
			refContractId,
			minAmountOutRaw,
			fromAccountId,
			autoRegisterOutput: params.autoRegisterOutput !== false,
			gas:
				typeof params.gas === "string" && params.gas.trim()
					? params.gas.trim()
					: undefined,
			attachedDepositYoctoNear:
				typeof params.attachedDepositYoctoNear === "string" &&
				params.attachedDepositYoctoNear.trim()
					? params.attachedDepositYoctoNear.trim()
					: undefined,
		};
	}

	const toAccountId = normalizeAccountId(
		params.toAccountId ?? hints.toAccountId ?? "",
		"toAccountId",
	);
	const ftContractId = normalizeAccountId(
		params.ftContractId ?? hints.ftContractId ?? "",
		"ftContractId",
	);
	const amountRaw = params.amountRaw ?? hints.amountRaw ?? "";
	parsePositiveBigInt(amountRaw, "amountRaw");
	return {
		type: "near.transfer.ft",
		toAccountId,
		ftContractId,
		amountRaw,
		fromAccountId,
		gas:
			typeof params.gas === "string" && params.gas.trim()
				? params.gas.trim()
				: undefined,
		attachedDepositYoctoNear:
			typeof params.attachedDepositYoctoNear === "string" &&
			params.attachedDepositYoctoNear.trim()
				? params.attachedDepositYoctoNear.trim()
				: undefined,
	};
}

function hasIntentInputs(params: WorkflowParams): boolean {
	if (params.intentType || params.intentText) return true;
	if (params.toAccountId || params.amountNear || params.amountYoctoNear)
		return true;
	if (params.ftContractId || params.amountRaw) return true;
	if (
		params.tokenInId ||
		params.tokenOutId ||
		params.tokenAId ||
		params.tokenBId ||
		params.amountInRaw ||
		params.amountARaw ||
		params.amountBRaw ||
		params.amountA != null ||
		params.amountB != null ||
		params.shares ||
		params.amountIn != null
	) {
		return true;
	}
	if (
		params.poolId != null ||
		params.refContractId ||
		params.minAmountOutRaw ||
		(Array.isArray(params.minAmountsRaw) && params.minAmountsRaw.length > 0) ||
		params.minAmountARaw ||
		params.minAmountBRaw ||
		params.autoRegisterOutput != null
	) {
		return true;
	}
	return false;
}

function decodeCallFunctionResult(result: NearCallFunctionResult): string {
	if (!Array.isArray(result.result)) {
		throw new Error("Invalid call_function result payload");
	}
	const utf8 = Buffer.from(Uint8Array.from(result.result)).toString("utf8");
	if (!utf8.trim()) {
		throw new Error("call_function returned empty payload");
	}
	const parsed = JSON.parse(utf8) as unknown;
	if (typeof parsed !== "string" || !/^\d+$/.test(parsed.trim())) {
		throw new Error("call_function returned non-numeric balance payload");
	}
	return parsed.trim();
}

function encodeCallFunctionArgs(args: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(args), "utf8").toString("base64");
}

function decodeCallFunctionJson<T>(result: NearCallFunctionResult): T {
	if (!Array.isArray(result.result)) {
		throw new Error("Invalid call_function result payload");
	}
	const utf8 = Buffer.from(Uint8Array.from(result.result)).toString("utf8");
	if (!utf8.trim()) {
		throw new Error("call_function returned empty payload");
	}
	return JSON.parse(utf8) as T;
}

function isMissingMethodError(error: unknown): boolean {
	const text =
		error instanceof Error && typeof error.message === "string"
			? error.message.toLowerCase()
			: String(error).toLowerCase();
	return (
		text.includes("methodnotfound") ||
		text.includes("does not exist while viewing") ||
		text.includes("unknown method")
	);
}

async function queryStorageRegistrationStatus(params: {
	network: string;
	rpcUrl?: string;
	ftContractId: string;
	accountId: string;
}): Promise<
	| {
			status: "registered";
	  }
	| {
			status: "needs_registration";
			estimatedDepositYoctoNear: string;
	  }
	| {
			status: "unknown";
			reason: string;
	  }
> {
	try {
		const balanceResult = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "call_function",
				account_id: params.ftContractId,
				method_name: "storage_balance_of",
				args_base64: encodeCallFunctionArgs({
					account_id: params.accountId,
				}),
				finality: "final",
			},
		});
		const balance = decodeCallFunctionJson<{ total?: string } | null>(
			balanceResult,
		);
		if (balance && typeof balance.total === "string") {
			const total = parseNonNegativeBigInt(
				balance.total,
				"storageBalance.total",
			);
			if (total > 0n) {
				return { status: "registered" };
			}
		}
	} catch (error) {
		if (isMissingMethodError(error)) {
			return {
				status: "unknown",
				reason: "token does not expose storage_balance_of",
			};
		}
		return {
			status: "unknown",
			reason:
				error instanceof Error ? error.message : "storage precheck call failed",
		};
	}

	try {
		const boundsResult = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "call_function",
				account_id: params.ftContractId,
				method_name: "storage_balance_bounds",
				args_base64: encodeCallFunctionArgs({}),
				finality: "final",
			},
		});
		const bounds = decodeCallFunctionJson<{ min?: string }>(boundsResult);
		const min =
			typeof bounds?.min === "string" && /^\d+$/.test(bounds.min.trim())
				? bounds.min.trim()
				: "1250000000000000000000";
		return {
			status: "needs_registration",
			estimatedDepositYoctoNear: min,
		};
	} catch {
		return {
			status: "needs_registration",
			estimatedDepositYoctoNear: "1250000000000000000000",
		};
	}
}

async function simulateNearTransfer(params: {
	intent: NearTransferIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance";
	fromAccountId: string;
	availableYoctoNear: string;
	requiredYoctoNear: string;
	blockHash: string;
	blockHeight: number;
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const query = await callNearRpc<NearAccountQueryResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			account_id: fromAccountId,
			finality: "final",
			request_type: "view_account",
		},
	});
	const total = parseNonNegativeBigInt(query.amount, "amount");
	const locked = parseNonNegativeBigInt(query.locked, "locked");
	const available = total > locked ? total - locked : 0n;
	const required = parsePositiveBigInt(
		params.intent.amountYoctoNear,
		"amountYoctoNear",
	);
	return {
		status: available >= required ? "success" : "insufficient_balance",
		fromAccountId,
		availableYoctoNear: available.toString(),
		requiredYoctoNear: required.toString(),
		blockHash: query.block_hash,
		blockHeight: query.block_height,
	};
}

async function simulateFtTransfer(params: {
	intent: NearFtTransferIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance";
	fromAccountId: string;
	availableRaw: string;
	requiredRaw: string;
	blockHash: string;
	blockHeight: number;
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const query = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			account_id: params.intent.ftContractId,
			args_base64: Buffer.from(
				JSON.stringify({ account_id: fromAccountId }),
				"utf8",
			).toString("base64"),
			finality: "final",
			method_name: "ft_balance_of",
			request_type: "call_function",
		},
	});
	const available = parseNonNegativeBigInt(
		decodeCallFunctionResult(query),
		"ft_balance_of",
	);
	const required = parsePositiveBigInt(params.intent.amountRaw, "amountRaw");
	return {
		status: available >= required ? "success" : "insufficient_balance",
		fromAccountId,
		availableRaw: available.toString(),
		requiredRaw: required.toString(),
		blockHash: query.block_hash,
		blockHeight: query.block_height,
	};
}

async function simulateRefSwap(params: {
	intent: NearRefSwapIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance";
	fromAccountId: string;
	availableRaw: string;
	requiredRaw: string;
	blockHash: string;
	blockHeight: number;
	storageRegistration:
		| {
				status: "registered";
		  }
		| {
				status: "needs_registration";
				estimatedDepositYoctoNear: string;
		  }
		| {
				status: "unknown";
				reason: string;
		  };
	quote: {
		refContractId: string;
		poolId: number;
		tokenInId: string;
		tokenOutId: string;
		amountInRaw: string;
		amountOutRaw: string;
		minAmountOutRaw: string;
		source:
			| "explicitPool"
			| "bestDirectSimplePool"
			| "bestDirectPool"
			| "bestTwoHopPoolRoute";
		actions: Array<{
			poolId: number;
			tokenInId: string;
			tokenOutId: string;
			amountInRaw?: string;
		}>;
	};
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const quote = await getRefSwapQuote({
		network: params.network,
		rpcUrl: params.rpcUrl,
		refContractId: params.intent.refContractId,
		tokenInId: params.intent.tokenInId,
		tokenOutId: params.intent.tokenOutId,
		amountInRaw: params.intent.amountInRaw,
		poolId: params.intent.poolId,
		slippageBps: params.intent.slippageBps,
	});
	const query = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			account_id: quote.tokenInId,
			args_base64: encodeCallFunctionArgs({ account_id: fromAccountId }),
			finality: "final",
			method_name: "ft_balance_of",
			request_type: "call_function",
		},
	});
	const available = parseNonNegativeBigInt(
		decodeCallFunctionResult(query),
		"ft_balance_of",
	);
	const required = parsePositiveBigInt(quote.amountInRaw, "amountInRaw");
	const storageRegistration = await queryStorageRegistrationStatus({
		network: params.network,
		rpcUrl: params.rpcUrl,
		ftContractId: quote.tokenOutId,
		accountId: fromAccountId,
	});
	return {
		status: available >= required ? "success" : "insufficient_balance",
		fromAccountId,
		availableRaw: available.toString(),
		requiredRaw: required.toString(),
		blockHash: query.block_hash,
		blockHeight: query.block_height,
		storageRegistration,
		quote: {
			refContractId: quote.refContractId,
			poolId: quote.poolId,
			tokenInId: quote.tokenInId,
			tokenOutId: quote.tokenOutId,
			amountInRaw: quote.amountInRaw,
			amountOutRaw: quote.amountOutRaw,
			minAmountOutRaw: params.intent.minAmountOutRaw ?? quote.minAmountOutRaw,
			source: quote.source,
			actions: quote.actions,
		},
	};
}

function normalizePoolTokenIds(tokenIds: string[]): string[] {
	return tokenIds
		.map((tokenId) => tokenId.trim().toLowerCase())
		.filter(Boolean);
}

function resolveLpIntentTokenMapping(params: {
	intent: NearRefAddLiquidityIntent;
	network: string;
	poolTokenIds: string[];
}): {
	tokenAId: string;
	tokenBId: string;
	amountsRawByPool: string[];
} {
	const poolTokenIds = normalizePoolTokenIds(params.poolTokenIds);
	const resolveToken = (
		tokenInput: string | undefined,
		fallback: string,
	): string => {
		if (!tokenInput || !tokenInput.trim()) return fallback;
		const candidates = resolveRefTokenIds({
			network: params.network,
			tokenIdOrSymbol: tokenInput,
			availableTokenIds: poolTokenIds,
		});
		if (!candidates[0]) {
			throw new Error(`Token ${tokenInput} is not in selected pool`);
		}
		return candidates[0];
	};

	const tokenAId = resolveToken(params.intent.tokenAId, poolTokenIds[0] ?? "");
	const tokenBId = resolveToken(params.intent.tokenBId, poolTokenIds[1] ?? "");
	let resolvedTokenAId = tokenAId;
	let resolvedTokenBId = tokenBId;
	if (
		resolvedTokenAId === resolvedTokenBId &&
		typeof params.intent.tokenAId === "string" &&
		params.intent.tokenAId.trim() &&
		(!params.intent.tokenBId || !params.intent.tokenBId.trim())
	) {
		resolvedTokenBId =
			poolTokenIds.find((tokenId) => tokenId !== resolvedTokenAId) ?? "";
	}
	if (
		resolvedTokenAId === resolvedTokenBId &&
		typeof params.intent.tokenBId === "string" &&
		params.intent.tokenBId.trim() &&
		(!params.intent.tokenAId || !params.intent.tokenAId.trim())
	) {
		resolvedTokenAId =
			poolTokenIds.find((tokenId) => tokenId !== resolvedTokenBId) ?? "";
	}
	if (
		!resolvedTokenAId ||
		!resolvedTokenBId ||
		resolvedTokenAId === resolvedTokenBId
	) {
		throw new Error(
			"tokenAId/tokenBId must resolve to two distinct pool tokens",
		);
	}
	const tokenAIndex = poolTokenIds.indexOf(resolvedTokenAId);
	const tokenBIndex = poolTokenIds.indexOf(resolvedTokenBId);
	if (tokenAIndex < 0 || tokenBIndex < 0) {
		throw new Error("tokenAId/tokenBId are not in selected pool");
	}
	const amountsRawByPool = poolTokenIds.map(() => "0");
	amountsRawByPool[tokenAIndex] = params.intent.amountARaw;
	amountsRawByPool[tokenBIndex] = params.intent.amountBRaw;
	return {
		tokenAId: resolvedTokenAId,
		tokenBId: resolvedTokenBId,
		amountsRawByPool,
	};
}

async function simulateRefAddLiquidity(params: {
	intent: NearRefAddLiquidityIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance";
	fromAccountId: string;
	refContractId: string;
	poolId: number;
	poolTokenIds: string[];
	tokenAId: string;
	tokenBId: string;
	amountsRawByPool: string[];
	balanceChecks: Array<{
		tokenId: string;
		requiredRaw: string;
		availableRaw: string;
	}>;
	exchangeStorageRegistration:
		| {
				status: "registered";
		  }
		| {
				status: "needs_registration";
				estimatedDepositYoctoNear: string;
		  }
		| {
				status: "unknown";
				reason: string;
		  };
	tokenStorageRegistrations: Array<{
		tokenId: string;
		registration:
			| {
					status: "registered";
			  }
			| {
					status: "needs_registration";
					estimatedDepositYoctoNear: string;
			  }
			| {
					status: "unknown";
					reason: string;
			  };
	}>;
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const pool = await fetchRefPoolById({
		network: params.network,
		rpcUrl: params.rpcUrl,
		refContractId: params.intent.refContractId,
		poolId: params.intent.poolId,
	});
	const poolTokenIds = normalizePoolTokenIds(pool.token_account_ids);
	const mapping = resolveLpIntentTokenMapping({
		intent: params.intent,
		network: params.network,
		poolTokenIds,
	});
	const refContractId = getRefContractId(
		params.network,
		params.intent.refContractId,
	);

	const balanceChecks: Array<{
		tokenId: string;
		requiredRaw: string;
		availableRaw: string;
	}> = [];
	let sufficient = true;
	for (const [index, tokenId] of poolTokenIds.entries()) {
		const requiredRaw = mapping.amountsRawByPool[index] ?? "0";
		if (parseNonNegativeBigInt(requiredRaw, "amountsRawByPool") <= 0n) continue;
		const query = await callNearRpc<NearCallFunctionResult>({
			method: "query",
			network: params.network,
			rpcUrl: params.rpcUrl,
			params: {
				account_id: tokenId,
				args_base64: encodeCallFunctionArgs({ account_id: fromAccountId }),
				finality: "final",
				method_name: "ft_balance_of",
				request_type: "call_function",
			},
		});
		const availableRaw = decodeCallFunctionResult(query);
		if (
			parseNonNegativeBigInt(availableRaw, "availableRaw") <
			parseNonNegativeBigInt(requiredRaw, "requiredRaw")
		) {
			sufficient = false;
		}
		balanceChecks.push({
			tokenId,
			requiredRaw,
			availableRaw,
		});
	}

	const exchangeStorageRegistration = await queryStorageRegistrationStatus({
		network: params.network,
		rpcUrl: params.rpcUrl,
		ftContractId: refContractId,
		accountId: fromAccountId,
	});
	const tokenStorageRegistrations = await Promise.all(
		poolTokenIds
			.filter(
				(tokenId, index) =>
					parseNonNegativeBigInt(
						mapping.amountsRawByPool[index] ?? "0",
						"amountsRawByPool",
					) > 0n,
			)
			.map(async (tokenId) => ({
				tokenId,
				registration: await queryStorageRegistrationStatus({
					network: params.network,
					rpcUrl: params.rpcUrl,
					ftContractId: tokenId,
					accountId: refContractId,
				}),
			})),
	);

	return {
		status: sufficient ? "success" : "insufficient_balance",
		fromAccountId,
		refContractId,
		poolId: params.intent.poolId,
		poolTokenIds,
		tokenAId: mapping.tokenAId,
		tokenBId: mapping.tokenBId,
		amountsRawByPool: mapping.amountsRawByPool,
		balanceChecks,
		exchangeStorageRegistration,
		tokenStorageRegistrations,
	};
}

async function simulateRefRemoveLiquidity(params: {
	intent: NearRefRemoveLiquidityIntent;
	network: string;
	rpcUrl?: string;
	fromAccountId?: string;
}): Promise<{
	status: "success" | "insufficient_balance";
	fromAccountId: string;
	refContractId: string;
	poolId: number;
	poolTokenIds: string[];
	availableShares: string;
	requiredShares: string;
	minAmountsRaw: string[];
}> {
	const fromAccountId = resolveNearAccountId(
		params.intent.fromAccountId ?? params.fromAccountId,
		params.network,
	);
	const pool = await fetchRefPoolById({
		network: params.network,
		rpcUrl: params.rpcUrl,
		refContractId: params.intent.refContractId,
		poolId: params.intent.poolId,
	});
	const poolTokenIds = normalizePoolTokenIds(pool.token_account_ids);
	const refContractId = getRefContractId(
		params.network,
		params.intent.refContractId,
	);
	const minAmountsRaw =
		Array.isArray(params.intent.minAmountsRaw) &&
		params.intent.minAmountsRaw.length > 0
			? params.intent.minAmountsRaw
			: (() => {
					const values = poolTokenIds.map(() => "0");
					if (params.intent.minAmountARaw)
						values[0] = params.intent.minAmountARaw;
					if (params.intent.minAmountBRaw)
						values[1] = params.intent.minAmountBRaw;
					return values;
				})();
	const sharesResult = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network: params.network,
		rpcUrl: params.rpcUrl,
		params: {
			account_id: refContractId,
			args_base64: encodeCallFunctionArgs({
				pool_id: params.intent.poolId,
				account_id: fromAccountId,
			}),
			finality: "final",
			method_name: "get_pool_shares",
			request_type: "call_function",
		},
	});
	const availableShares = decodeCallFunctionResult(sharesResult);
	const requiredShares = parsePositiveBigInt(
		params.intent.shares,
		"shares",
	).toString();
	return {
		status:
			parseNonNegativeBigInt(availableShares, "availableShares") >=
			parseNonNegativeBigInt(requiredShares, "requiredShares")
				? "success"
				: "insufficient_balance",
		fromAccountId,
		refContractId,
		poolId: params.intent.poolId,
		poolTokenIds,
		availableShares,
		requiredShares,
		minAmountsRaw: minAmountsRaw.map((entry) =>
			parseNonNegativeBigInt(entry, "minAmountsRaw").toString(),
		),
	};
}

function resolveExecuteTool(
	name:
		| "near_transferNear"
		| "near_transferFt"
		| "near_swapRef"
		| "near_addLiquidityRef"
		| "near_removeLiquidityRef",
): WorkflowTool {
	const tool = createNearExecuteTools().find((entry) => entry.name === name);
	if (!tool) {
		throw new Error(`Execute tool not found: ${name}`);
	}
	return tool;
}

function assertMainnetExecutionConfirmed(
	network: string,
	confirmMainnet?: boolean,
): void {
	if (network === "mainnet" && confirmMainnet !== true) {
		throw new Error(
			"Mainnet execute requires confirmMainnet=true. Run analysis/simulate first to obtain confirmToken.",
		);
	}
}

function buildExecuteResultSummary(executeResult: unknown): string {
	if (!executeResult || typeof executeResult !== "object") {
		return "submitted";
	}
	const candidate = executeResult as {
		txHash?: unknown;
		toAccountId?: unknown;
	};
	const hashText =
		typeof candidate.txHash === "string" && candidate.txHash.trim()
			? `txHash=${candidate.txHash}`
			: "txHash=unknown";
	return hashText;
}

function workflowRunModeSchema() {
	return Type.Optional(
		Type.Union([
			Type.Literal("analysis"),
			Type.Literal("simulate"),
			Type.Literal("execute"),
		]),
	);
}

export function createNearWorkflowTools() {
	return [
		defineTool({
			name: "w3rt_run_near_workflow_v0",
			label: "W3RT NEAR Workflow",
			description:
				"Run NEAR workflow in three phases: analysis -> simulate -> execute for native transfer, FT transfer, Ref swap, and Ref LP add/remove.",
			parameters: Type.Object({
				runId: Type.Optional(Type.String()),
				runMode: workflowRunModeSchema(),
				intentType: Type.Optional(
					Type.Union([
						Type.Literal("near.transfer.near"),
						Type.Literal("near.transfer.ft"),
						Type.Literal("near.swap.ref"),
						Type.Literal("near.lp.ref.add"),
						Type.Literal("near.lp.ref.remove"),
					]),
				),
				intentText: Type.Optional(Type.String()),
				network: nearNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				toAccountId: Type.Optional(Type.String()),
				fromAccountId: Type.Optional(Type.String()),
				amountNear: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				amountYoctoNear: Type.Optional(Type.String()),
				ftContractId: Type.Optional(Type.String()),
				amountRaw: Type.Optional(Type.String()),
				amountInRaw: Type.Optional(Type.String()),
				amountIn: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				tokenInId: Type.Optional(Type.String()),
				tokenOutId: Type.Optional(Type.String()),
				tokenAId: Type.Optional(Type.String()),
				tokenBId: Type.Optional(Type.String()),
				poolId: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				slippageBps: Type.Optional(Type.Number()),
				refContractId: Type.Optional(Type.String()),
				minAmountOutRaw: Type.Optional(Type.String()),
				amountA: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				amountB: Type.Optional(Type.Union([Type.String(), Type.Number()])),
				amountARaw: Type.Optional(Type.String()),
				amountBRaw: Type.Optional(Type.String()),
				shares: Type.Optional(Type.String()),
				minAmountsRaw: Type.Optional(Type.Array(Type.String())),
				minAmountARaw: Type.Optional(Type.String()),
				minAmountBRaw: Type.Optional(Type.String()),
				autoRegisterOutput: Type.Optional(Type.Boolean()),
				autoRegisterExchange: Type.Optional(Type.Boolean()),
				autoRegisterTokens: Type.Optional(Type.Boolean()),
				gas: Type.Optional(Type.String()),
				attachedDepositYoctoNear: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
				privateKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as WorkflowParams;
				const runMode = parseRunMode(params.runMode);
				const network = parseNearNetwork(params.network);
				let runId = createRunId(params.runId);
				let intent: NearWorkflowIntent;

				if (runMode === "execute" && !hasIntentInputs(params)) {
					const session = readWorkflowSession(params.runId);
					if (!session) {
						throw new Error(
							"No prior workflow session found. Provide intent parameters or run analysis/simulate first.",
						);
					}
					runId = session.runId;
					intent = session.intent;
				} else {
					intent = normalizeIntent(params);
				}

				const approvalRequired = network === "mainnet";
				const confirmToken = approvalRequired
					? createConfirmToken({
							runId,
							network,
							intent,
						})
					: null;

				if (runMode === "analysis") {
					rememberWorkflowSession({
						runId,
						network,
						intent,
						confirmToken,
					});
					return {
						content: [
							{ type: "text", text: `Workflow analyzed: ${intent.type}` },
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							approvalRequired,
							confirmToken,
							artifacts: {
								analysis: {
									status: "ready",
								},
							},
						},
					};
				}

				if (runMode === "simulate") {
					const simulateArtifact =
						intent.type === "near.transfer.near"
							? await simulateNearTransfer({
									intent,
									network,
									rpcUrl: params.rpcUrl,
									fromAccountId: params.fromAccountId,
								})
							: intent.type === "near.transfer.ft"
								? await simulateFtTransfer({
										intent,
										network,
										rpcUrl: params.rpcUrl,
										fromAccountId: params.fromAccountId,
									})
								: intent.type === "near.swap.ref"
									? await simulateRefSwap({
											intent,
											network,
											rpcUrl: params.rpcUrl,
											fromAccountId: params.fromAccountId,
										})
									: intent.type === "near.lp.ref.add"
										? await simulateRefAddLiquidity({
												intent,
												network,
												rpcUrl: params.rpcUrl,
												fromAccountId: params.fromAccountId,
											})
										: await simulateRefRemoveLiquidity({
												intent,
												network,
												rpcUrl: params.rpcUrl,
												fromAccountId: params.fromAccountId,
											});
					rememberWorkflowSession({
						runId,
						network,
						intent,
						confirmToken,
					});
					return {
						content: [
							{
								type: "text",
								text: `Workflow simulated: ${intent.type} status=${simulateArtifact.status}`,
							},
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							approvalRequired,
							confirmToken,
							artifacts: {
								simulate: simulateArtifact,
							},
						},
					};
				}

				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				if (approvalRequired && params.confirmToken !== confirmToken) {
					throw new Error(
						`Invalid confirmToken for runId=${runId}. expected=${confirmToken} provided=${params.confirmToken ?? "null"}.`,
					);
				}

				const executeTool =
					intent.type === "near.transfer.near"
						? resolveExecuteTool("near_transferNear")
						: intent.type === "near.transfer.ft"
							? resolveExecuteTool("near_transferFt")
							: intent.type === "near.swap.ref"
								? resolveExecuteTool("near_swapRef")
								: intent.type === "near.lp.ref.add"
									? resolveExecuteTool("near_addLiquidityRef")
									: resolveExecuteTool("near_removeLiquidityRef");
				const executeResult = await executeTool.execute("near-wf-exec", {
					...(intent.type === "near.transfer.near"
						? {
								toAccountId: intent.toAccountId,
								amountYoctoNear: intent.amountYoctoNear,
							}
						: intent.type === "near.transfer.ft"
							? {
									ftContractId: intent.ftContractId,
									toAccountId: intent.toAccountId,
									amountRaw: intent.amountRaw,
									gas: intent.gas,
									attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
								}
							: intent.type === "near.swap.ref"
								? {
										tokenInId: intent.tokenInId,
										tokenOutId: intent.tokenOutId,
										amountInRaw: intent.amountInRaw,
										minAmountOutRaw: intent.minAmountOutRaw,
										poolId: intent.poolId,
										slippageBps: intent.slippageBps,
										refContractId: intent.refContractId,
										autoRegisterOutput: intent.autoRegisterOutput,
										gas: intent.gas,
										attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
									}
								: intent.type === "near.lp.ref.add"
									? {
											poolId: intent.poolId,
											amountARaw: intent.amountARaw,
											amountBRaw: intent.amountBRaw,
											tokenAId: intent.tokenAId,
											tokenBId: intent.tokenBId,
											refContractId: intent.refContractId,
											autoRegisterExchange: intent.autoRegisterExchange,
											autoRegisterTokens: intent.autoRegisterTokens,
											gas: intent.gas,
											attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
										}
									: {
											poolId: intent.poolId,
											shares: intent.shares,
											minAmountsRaw: intent.minAmountsRaw,
											minAmountARaw: intent.minAmountARaw,
											minAmountBRaw: intent.minAmountBRaw,
											refContractId: intent.refContractId,
											gas: intent.gas,
											attachedDepositYoctoNear: intent.attachedDepositYoctoNear,
										}),
					network,
					rpcUrl: params.rpcUrl,
					fromAccountId: intent.fromAccountId ?? params.fromAccountId,
					privateKey: params.privateKey,
					confirmMainnet: params.confirmMainnet,
				});

				const executeDetails = executeResult.details as
					| {
							txHash?: string;
					  }
					| undefined;
				return {
					content: [
						{
							type: "text",
							text: `Workflow executed: ${intent.type} ${buildExecuteResultSummary(executeDetails)}`,
						},
					],
					details: {
						runId,
						runMode,
						network,
						intentType: intent.type,
						intent,
						approvalRequired,
						confirmToken,
						confirmTokenMatched:
							!approvalRequired || params.confirmToken === confirmToken,
						artifacts: {
							execute: executeDetails ?? null,
						},
					},
				};
			},
		}),
	];
}
