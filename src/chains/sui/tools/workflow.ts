import { createHash } from "node:crypto";
import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";
import { initCetusSDK } from "@cetusprotocol/cetus-sui-clmm-sdk";
import { Transaction } from "@mysten/sui/transactions";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	type SuiNetwork,
	getSuiClient,
	getSuiRpcEndpoint,
	parsePositiveBigInt,
	parseSuiNetwork,
	resolveSuiKeypair,
	suiNetworkSchema,
	toMist,
} from "../runtime.js";
import {
	STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
	buildStableLayerBurnTransaction,
	buildStableLayerClaimTransaction,
	buildStableLayerMintTransaction,
	resolveStableLayerNetwork,
} from "../stablelayer.js";
import { createSuiExecuteTools } from "./execute.js";

type WorkflowRunMode = "analysis" | "simulate" | "execute";

type TransferSuiIntent = {
	type: "sui.transfer.sui";
	toAddress: string;
	amountSui?: number;
	amountMist?: string;
};

type TransferCoinIntent = {
	type: "sui.transfer.coin";
	toAddress: string;
	coinType: string;
	amountRaw: string;
	maxCoinObjectsToMerge?: number;
};

type SwapCetusIntent = {
	type: "sui.swap.cetus";
	inputCoinType: string;
	outputCoinType: string;
	amountRaw: string;
	byAmountIn: boolean;
	slippageBps: number;
	providers?: string[];
	depth?: number;
	endpoint?: string;
	apiKey?: string;
};

type CetusAddLiquidityIntent = {
	type: "sui.lp.cetus.add";
	poolId: string;
	positionId: string;
	coinTypeA: string;
	coinTypeB: string;
	tickLower: number;
	tickUpper: number;
	amountA: string;
	amountB: string;
	fixAmountA: boolean;
	slippageBps: number;
	collectFee: boolean;
	rewarderCoinTypes: string[];
};

type CetusRemoveLiquidityIntent = {
	type: "sui.lp.cetus.remove";
	poolId: string;
	positionId: string;
	coinTypeA: string;
	coinTypeB: string;
	deltaLiquidity: string;
	minAmountA: string;
	minAmountB: string;
	collectFee: boolean;
	rewarderCoinTypes: string[];
};

type SuiWorkflowIntent =
	| TransferSuiIntent
	| TransferCoinIntent
	| SwapCetusIntent
	| CetusAddLiquidityIntent
	| CetusRemoveLiquidityIntent;

type ParsedIntentHints = {
	intentType?: SuiWorkflowIntent["type"];
	toAddress?: string;
	amountSui?: number;
	amountRaw?: string;
	coinType?: string;
	inputCoinType?: string;
	outputCoinType?: string;
	poolId?: string;
	positionId?: string;
	coinTypeA?: string;
	coinTypeB?: string;
	tickLower?: number;
	tickUpper?: number;
	amountA?: string;
	amountB?: string;
	deltaLiquidity?: string;
	minAmountA?: string;
	minAmountB?: string;
};

type WorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	intentType?: SuiWorkflowIntent["type"];
	intentText?: string;
	network?: string;
	toAddress?: string;
	amountSui?: number;
	amountRaw?: string;
	coinType?: string;
	inputCoinType?: string;
	outputCoinType?: string;
	byAmountIn?: boolean;
	slippageBps?: number;
	providers?: string[];
	depth?: number;
	poolId?: string;
	positionId?: string;
	coinTypeA?: string;
	coinTypeB?: string;
	tickLower?: number;
	tickUpper?: number;
	amountA?: string;
	amountB?: string;
	fixAmountA?: boolean;
	deltaLiquidity?: string;
	minAmountA?: string;
	minAmountB?: string;
	collectFee?: boolean;
	rewarderCoinTypes?: string[];
	maxCoinObjectsToMerge?: number;
	endpoint?: string;
	apiKey?: string;
	fromPrivateKey?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	waitForLocalExecution?: boolean;
};

type StableLayerMintIntent = {
	type: "sui.stablelayer.mint";
	stableCoinType: string;
	amountUsdcRaw: string;
	usdcCoinType?: string;
};

type StableLayerBurnIntent = {
	type: "sui.stablelayer.burn";
	stableCoinType: string;
	amountStableRaw?: string;
	burnAll: boolean;
};

type StableLayerClaimIntent = {
	type: "sui.stablelayer.claim";
	stableCoinType: string;
};

type StableLayerWorkflowIntent =
	| StableLayerMintIntent
	| StableLayerBurnIntent
	| StableLayerClaimIntent;

type StableLayerWorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	intentType?: StableLayerWorkflowIntent["type"];
	intentText?: string;
	network?: string;
	stableCoinType?: string;
	amountUsdcRaw?: string;
	amountStableRaw?: string;
	burnAll?: boolean;
	usdcCoinType?: string;
	fromPrivateKey?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	waitForLocalExecution?: boolean;
};

type ParsedStableLayerIntentHints = {
	intentType?: StableLayerWorkflowIntent["type"];
	stableCoinType?: string;
	amountRaw?: string;
	burnAll?: boolean;
};

function workflowRunModeSchema() {
	return Type.Optional(
		Type.Union([
			Type.Literal("analysis"),
			Type.Literal("simulate"),
			Type.Literal("execute"),
		]),
	);
}

function parseRunMode(value?: string): WorkflowRunMode {
	if (value === "simulate" || value === "execute") return value;
	return "analysis";
}

function createRunId(input?: string): string {
	if (input?.trim()) return input.trim();
	const nonce = Math.random().toString(36).slice(2, 8);
	return `wf-sui-${Date.now().toString(36)}-${nonce}`;
}

function resolveAggregatorEnv(network: SuiNetwork): Env {
	if (network === "mainnet") return Env.Mainnet;
	if (network === "testnet") return Env.Testnet;
	throw new Error(
		"Sui swap workflow currently supports network=mainnet or testnet.",
	);
}

function resolveCetusNetwork(network: SuiNetwork): "mainnet" | "testnet" {
	if (network === "mainnet" || network === "testnet") return network;
	throw new Error(
		"Cetus LP workflow currently supports network=mainnet or testnet.",
	);
}

function parseInteger(value: string | undefined): number | undefined {
	if (!value) return undefined;
	if (!/^-?\d+$/.test(value.trim())) return undefined;
	return Number(value.trim());
}

function parseIntentText(text?: string): ParsedIntentHints {
	if (!text?.trim()) return {};
	const lower = text.toLowerCase();
	const addressMatches = [...text.matchAll(/0x[a-fA-F0-9]{64}/g)].map(
		(entry) => entry[0],
	);
	const coinTypeMatches = [
		...text.matchAll(/0x[a-fA-F0-9]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+/g),
	].map((entry) => entry[0]);
	const suiAmountMatch = text.match(/(\d+(?:\.\d+)?)\s*sui\b/i);
	const integerMatch = text.match(/\b\d+\b/);
	const poolLabelMatch =
		text.match(/(?:pool|poolId|池子|池)\s*[:= ]\s*(0x[a-fA-F0-9]{64})/i) ??
		null;
	const positionLabelMatch =
		text.match(
			/(?:position|positionId|pos|仓位|头寸)\s*[:= ]\s*(0x[a-fA-F0-9]{64})/i,
		) ?? null;
	const tickRangeMatch =
		text.match(
			/(?:tick|ticks|范围)\s*[:= ]?\s*(-?\d+)\s*(?:to|~|-)\s*(-?\d+)/i,
		) ?? null;
	const amountAMatch =
		text.match(/(?:amountA|tokenA|a金额|a_amount)\s*[:= ]\s*(\d+)/i) ?? null;
	const amountBMatch =
		text.match(/(?:amountB|tokenB|b金额|b_amount)\s*[:= ]\s*(\d+)/i) ?? null;
	const deltaLiquidityMatch =
		text.match(
			/(?:deltaLiquidity|delta_liquidity|liquidityDelta|移除流动性|减少流动性|liquidity)\s*[:= ]\s*(\d+)/i,
		) ?? null;
	const minAmountAMatch =
		text.match(/(?:minAmountA|min_a|minA)\s*[:= ]\s*(\d+)/i) ?? null;
	const minAmountBMatch =
		text.match(/(?:minAmountB|min_b|minB)\s*[:= ]\s*(\d+)/i) ?? null;

	if (/(add liquidity|增加流动性|添加流动性|加流动性|加池)/i.test(lower)) {
		return {
			intentType: "sui.lp.cetus.add",
			poolId: poolLabelMatch?.[1] || addressMatches[0],
			positionId: positionLabelMatch?.[1] || addressMatches[1],
			coinTypeA: coinTypeMatches[0],
			coinTypeB: coinTypeMatches[1],
			tickLower: parseInteger(tickRangeMatch?.[1]),
			tickUpper: parseInteger(tickRangeMatch?.[2]),
			amountA: amountAMatch?.[1],
			amountB: amountBMatch?.[1],
		};
	}

	if (/(remove liquidity|移除流动性|减少流动性|撤池|减池)/i.test(lower)) {
		return {
			intentType: "sui.lp.cetus.remove",
			poolId: poolLabelMatch?.[1] || addressMatches[0],
			positionId: positionLabelMatch?.[1] || addressMatches[1],
			coinTypeA: coinTypeMatches[0],
			coinTypeB: coinTypeMatches[1],
			deltaLiquidity: deltaLiquidityMatch?.[1] || integerMatch?.[0],
			minAmountA: minAmountAMatch?.[1],
			minAmountB: minAmountBMatch?.[1],
		};
	}

	if (/(swap|兑换|换币|交易对)/i.test(lower)) {
		return {
			intentType: "sui.swap.cetus",
			inputCoinType: coinTypeMatches[0],
			outputCoinType: coinTypeMatches[1],
			amountRaw: integerMatch?.[0],
		};
	}

	if (/(transfer|send|转账|发送|转给|转)/i.test(lower)) {
		if (suiAmountMatch) {
			return {
				intentType: "sui.transfer.sui",
				toAddress: addressMatches[0],
				amountSui: Number(suiAmountMatch[1]),
			};
		}
		return {
			intentType: "sui.transfer.coin",
			toAddress: addressMatches[0],
			coinType: coinTypeMatches[0],
			amountRaw: integerMatch?.[0],
		};
	}

	return {};
}

function parseStableLayerIntentText(
	text?: string,
): ParsedStableLayerIntentHints {
	if (!text?.trim()) return {};
	const lower = text.toLowerCase();
	const coinTypeMatches = [
		...text.matchAll(/0x[a-fA-F0-9]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+/g),
	].map((entry) => entry[0]);
	const integerMatch = text.match(/\b\d+\b/);
	const burnAll =
		/\bburn\s+all\b|\b全部燃烧\b|\b全部销毁\b|\ball\s+balance\b/i.test(lower);

	if (/\bclaim\b|领取|提取奖励|收获奖励|领收益/i.test(lower)) {
		return {
			intentType: "sui.stablelayer.claim",
			stableCoinType: coinTypeMatches[0],
		};
	}

	if (/\bburn\b|赎回|销毁|回收/i.test(lower)) {
		return {
			intentType: "sui.stablelayer.burn",
			stableCoinType: coinTypeMatches[0],
			amountRaw: integerMatch?.[0],
			burnAll,
		};
	}

	if (/\bmint\b|铸造|生成稳定币|兑换稳定币/i.test(lower)) {
		return {
			intentType: "sui.stablelayer.mint",
			stableCoinType: coinTypeMatches[0],
			amountRaw: integerMatch?.[0],
		};
	}

	return {};
}

function inferStableLayerIntentType(
	params: StableLayerWorkflowParams,
	parsed: ParsedStableLayerIntentHints,
): StableLayerWorkflowIntent["type"] {
	if (params.intentType) return params.intentType;
	if (parsed.intentType) return parsed.intentType;
	if (params.burnAll === true) return "sui.stablelayer.burn";
	if (params.amountUsdcRaw?.trim()) return "sui.stablelayer.mint";
	if (params.amountStableRaw?.trim()) return "sui.stablelayer.burn";
	throw new Error(
		"Cannot infer stable layer intentType. Provide intentType or enough structured fields.",
	);
}

function normalizeStableLayerIntent(
	params: StableLayerWorkflowParams,
): StableLayerWorkflowIntent {
	const parsed = parseStableLayerIntentText(params.intentText);
	const intentType = inferStableLayerIntentType(params, parsed);
	const stableCoinType = params.stableCoinType?.trim() || parsed.stableCoinType;
	if (!stableCoinType) {
		throw new Error("stableCoinType is required for stable layer workflow.");
	}

	if (intentType === "sui.stablelayer.mint") {
		const amountUsdcRaw = params.amountUsdcRaw?.trim() || parsed.amountRaw;
		if (!amountUsdcRaw) {
			throw new Error(
				"amountUsdcRaw is required for intentType=sui.stablelayer.mint",
			);
		}
		parsePositiveBigInt(amountUsdcRaw, "amountUsdcRaw");
		return {
			type: "sui.stablelayer.mint",
			stableCoinType,
			amountUsdcRaw,
			usdcCoinType: params.usdcCoinType?.trim() || undefined,
		};
	}

	if (intentType === "sui.stablelayer.burn") {
		const burnAll = params.burnAll === true || parsed.burnAll === true;
		const amountStableRaw = params.amountStableRaw?.trim() || parsed.amountRaw;
		if (!burnAll && !amountStableRaw) {
			throw new Error(
				"amountStableRaw is required unless burnAll=true for intentType=sui.stablelayer.burn",
			);
		}
		if (amountStableRaw)
			parsePositiveBigInt(amountStableRaw, "amountStableRaw");
		return {
			type: "sui.stablelayer.burn",
			stableCoinType,
			amountStableRaw: amountStableRaw || undefined,
			burnAll,
		};
	}

	return {
		type: "sui.stablelayer.claim",
		stableCoinType,
	};
}

function inferIntentType(params: WorkflowParams, parsed: ParsedIntentHints) {
	if (params.intentType) return params.intentType;
	if (parsed.intentType) return parsed.intentType;
	if (
		params.poolId &&
		params.positionId &&
		params.deltaLiquidity &&
		params.minAmountA &&
		params.minAmountB
	) {
		return "sui.lp.cetus.remove";
	}
	if (
		params.poolId &&
		params.positionId &&
		params.amountA &&
		params.amountB &&
		params.tickLower != null &&
		params.tickUpper != null
	) {
		return "sui.lp.cetus.add";
	}
	if (params.inputCoinType && params.outputCoinType) return "sui.swap.cetus";
	if (params.coinType) return "sui.transfer.coin";
	if (
		params.toAddress &&
		(params.amountSui != null || params.amountRaw != null)
	) {
		return "sui.transfer.sui";
	}
	throw new Error(
		"Cannot infer intentType. Provide intentType or enough structured fields.",
	);
}

function normalizeIntent(params: WorkflowParams): SuiWorkflowIntent {
	const parsed = parseIntentText(params.intentText);
	const intentType = inferIntentType(params, parsed);

	if (intentType === "sui.transfer.sui") {
		const toAddress = params.toAddress?.trim() || parsed.toAddress;
		const amountMist = params.amountRaw?.trim();
		const amountSui = params.amountSui ?? parsed.amountSui;
		if (!toAddress)
			throw new Error("toAddress is required for sui.transfer.sui");
		if (!amountMist && amountSui == null) {
			throw new Error("amountRaw(amountMist) or amountSui is required");
		}
		return {
			type: "sui.transfer.sui",
			toAddress,
			amountMist: amountMist || undefined,
			amountSui,
		};
	}

	if (intentType === "sui.transfer.coin") {
		const toAddress = params.toAddress?.trim() || parsed.toAddress;
		const coinType = params.coinType?.trim() || parsed.coinType;
		const amountRaw = params.amountRaw?.trim() || parsed.amountRaw;
		if (!toAddress)
			throw new Error("toAddress is required for sui.transfer.coin");
		if (!coinType)
			throw new Error("coinType is required for sui.transfer.coin");
		if (!amountRaw)
			throw new Error("amountRaw is required for sui.transfer.coin");
		return {
			type: "sui.transfer.coin",
			toAddress,
			coinType,
			amountRaw,
			maxCoinObjectsToMerge: params.maxCoinObjectsToMerge,
		};
	}

	if (intentType === "sui.lp.cetus.add") {
		const poolId = params.poolId?.trim() || parsed.poolId;
		const positionId = params.positionId?.trim() || parsed.positionId;
		const coinTypeA = params.coinTypeA?.trim() || parsed.coinTypeA;
		const coinTypeB = params.coinTypeB?.trim() || parsed.coinTypeB;
		const tickLower = params.tickLower ?? parsed.tickLower;
		const tickUpper = params.tickUpper ?? parsed.tickUpper;
		const amountA = params.amountA?.trim() || parsed.amountA;
		const amountB = params.amountB?.trim() || parsed.amountB;
		if (!poolId) throw new Error("poolId is required for sui.lp.cetus.add");
		if (!positionId)
			throw new Error("positionId is required for sui.lp.cetus.add");
		if (!coinTypeA)
			throw new Error("coinTypeA is required for sui.lp.cetus.add");
		if (!coinTypeB)
			throw new Error("coinTypeB is required for sui.lp.cetus.add");
		if (tickLower == null || tickUpper == null) {
			throw new Error(
				"tickLower and tickUpper are required for sui.lp.cetus.add",
			);
		}
		if (!amountA || !amountB) {
			throw new Error("amountA and amountB are required for sui.lp.cetus.add");
		}
		return {
			type: "sui.lp.cetus.add",
			poolId,
			positionId,
			coinTypeA,
			coinTypeB,
			tickLower,
			tickUpper,
			amountA,
			amountB,
			fixAmountA: params.fixAmountA !== false,
			slippageBps: params.slippageBps ?? 100,
			collectFee: params.collectFee === true,
			rewarderCoinTypes: params.rewarderCoinTypes ?? [],
		};
	}

	if (intentType === "sui.lp.cetus.remove") {
		const poolId = params.poolId?.trim() || parsed.poolId;
		const positionId = params.positionId?.trim() || parsed.positionId;
		const coinTypeA = params.coinTypeA?.trim() || parsed.coinTypeA;
		const coinTypeB = params.coinTypeB?.trim() || parsed.coinTypeB;
		const deltaLiquidity =
			params.deltaLiquidity?.trim() || parsed.deltaLiquidity;
		const minAmountA = params.minAmountA?.trim() || parsed.minAmountA || "0";
		const minAmountB = params.minAmountB?.trim() || parsed.minAmountB || "0";
		if (!poolId) throw new Error("poolId is required for sui.lp.cetus.remove");
		if (!positionId)
			throw new Error("positionId is required for sui.lp.cetus.remove");
		if (!coinTypeA)
			throw new Error("coinTypeA is required for sui.lp.cetus.remove");
		if (!coinTypeB)
			throw new Error("coinTypeB is required for sui.lp.cetus.remove");
		if (!deltaLiquidity) {
			throw new Error("deltaLiquidity is required for sui.lp.cetus.remove");
		}
		return {
			type: "sui.lp.cetus.remove",
			poolId,
			positionId,
			coinTypeA,
			coinTypeB,
			deltaLiquidity,
			minAmountA,
			minAmountB,
			collectFee: params.collectFee !== false,
			rewarderCoinTypes: params.rewarderCoinTypes ?? [],
		};
	}

	const inputCoinType =
		params.inputCoinType?.trim() ||
		parsed.inputCoinType ||
		params.coinType?.trim();
	const outputCoinType = params.outputCoinType?.trim() || parsed.outputCoinType;
	const amountRaw = params.amountRaw?.trim() || parsed.amountRaw;
	if (!inputCoinType)
		throw new Error("inputCoinType is required for sui.swap.cetus");
	if (!outputCoinType)
		throw new Error("outputCoinType is required for sui.swap.cetus");
	if (!amountRaw) throw new Error("amountRaw is required for sui.swap.cetus");
	return {
		type: "sui.swap.cetus",
		inputCoinType,
		outputCoinType,
		amountRaw,
		byAmountIn: params.byAmountIn !== false,
		slippageBps: params.slippageBps ?? 100,
		providers: params.providers?.length ? params.providers : undefined,
		depth: params.depth,
		endpoint: params.endpoint?.trim() || undefined,
		apiKey: params.apiKey?.trim() || undefined,
	};
}

function createConfirmToken(
	runId: string,
	network: string,
	intent: unknown,
): string {
	const digest = createHash("sha256")
		.update(JSON.stringify({ runId, network, intent }))
		.digest("hex")
		.slice(0, 16)
		.toUpperCase();
	return `SUI-${digest}`;
}

function getSimulationStatus(simulation: unknown): {
	status: string;
	error: string | null;
} {
	const payload = simulation as {
		effects?: { status?: { status?: string; error?: string } };
		error?: string;
	};
	const status = payload.effects?.status?.status ?? "unknown";
	const error = payload.effects?.status?.error ?? payload.error ?? null;
	return { status, error };
}

function resolveRequestType(waitForLocalExecution?: boolean) {
	return waitForLocalExecution === false
		? "WaitForEffectsCert"
		: "WaitForLocalExecution";
}

function parseSlippageDecimal(slippageBps?: number): number {
	const bps = slippageBps ?? 100;
	if (!Number.isFinite(bps) || bps <= 0 || bps > 10_000) {
		throw new Error("slippageBps must be between 1 and 10000");
	}
	return bps / 10_000;
}

async function resolveCoinObjectIdsForAmount(
	client: ReturnType<typeof getSuiClient>,
	owner: string,
	coinType: string,
	amountRaw: bigint,
	maxCoinObjects: number,
): Promise<{
	selectedCoinObjectIds: string[];
	selectedBalanceRaw: bigint;
}> {
	let cursor: string | undefined;
	const selectedCoinObjectIds: string[] = [];
	let selectedBalanceRaw = 0n;

	while (
		selectedBalanceRaw < amountRaw &&
		selectedCoinObjectIds.length < maxCoinObjects
	) {
		const page = await client.getCoins({
			owner,
			coinType,
			cursor,
			limit: Math.min(100, maxCoinObjects - selectedCoinObjectIds.length),
		});

		if (!page.data.length) break;

		for (const coin of page.data) {
			const normalized = coin.balance.trim();
			if (!/^\d+$/.test(normalized)) continue;
			const balance = BigInt(normalized);
			if (balance <= 0n) continue;
			selectedCoinObjectIds.push(coin.coinObjectId);
			selectedBalanceRaw += balance;
			if (
				selectedBalanceRaw >= amountRaw ||
				selectedCoinObjectIds.length >= maxCoinObjects
			) {
				break;
			}
		}

		if (selectedBalanceRaw >= amountRaw) break;
		if (!page.hasNextPage || !page.nextCursor) break;
		cursor = page.nextCursor;
	}

	return {
		selectedCoinObjectIds,
		selectedBalanceRaw,
	};
}

async function buildSimulation(
	intent: SuiWorkflowIntent,
	network: SuiNetwork,
	signerAddress: string,
): Promise<{
	tx: Transaction;
	artifacts: Record<string, unknown>;
}> {
	const client = getSuiClient(network);

	if (intent.type === "sui.transfer.sui") {
		const amountMistRaw = intent.amountMist
			? parsePositiveBigInt(intent.amountMist, "amountMist").toString()
			: toMist(intent.amountSui ?? 0).toString();
		const tx = new Transaction();
		const [coin] = tx.splitCoins(tx.gas, [amountMistRaw]);
		tx.transferObjects([coin], intent.toAddress);
		return {
			tx,
			artifacts: {
				amountMist: amountMistRaw,
				toAddress: intent.toAddress,
			},
		};
	}

	if (intent.type === "sui.transfer.coin") {
		const amountRaw = parsePositiveBigInt(intent.amountRaw, "amountRaw");
		const maxCoinObjects = intent.maxCoinObjectsToMerge ?? 20;
		const { selectedCoinObjectIds, selectedBalanceRaw } =
			await resolveCoinObjectIdsForAmount(
				client,
				signerAddress,
				intent.coinType,
				amountRaw,
				maxCoinObjects,
			);
		if (!selectedCoinObjectIds.length || selectedBalanceRaw < amountRaw) {
			throw new Error(
				"Unable to build coin transfer simulation: insufficient coin objects",
			);
		}
		const primary = selectedCoinObjectIds[0];
		if (!primary) {
			throw new Error(
				"Unable to build coin transfer simulation: missing primary coin",
			);
		}
		const tx = new Transaction();
		if (selectedCoinObjectIds.length > 1) {
			tx.mergeCoins(primary, selectedCoinObjectIds.slice(1));
		}
		const [splitCoin] = tx.splitCoins(primary, [amountRaw.toString()]);
		tx.transferObjects([splitCoin], intent.toAddress);
		return {
			tx,
			artifacts: {
				coinType: intent.coinType,
				amountRaw: amountRaw.toString(),
				selectedCoinObjectIds,
				selectedBalanceRaw: selectedBalanceRaw.toString(),
			},
		};
	}

	if (intent.type === "sui.lp.cetus.add") {
		const cetusNetwork = resolveCetusNetwork(network);
		const rpcUrl = getSuiRpcEndpoint(network);
		const sdk = initCetusSDK({
			network: cetusNetwork,
			fullNodeUrl: rpcUrl,
			wallet: signerAddress,
		});
		const tx = await sdk.Position.createAddLiquidityFixTokenPayload({
			pool_id: intent.poolId,
			pos_id: intent.positionId,
			coinTypeA: intent.coinTypeA,
			coinTypeB: intent.coinTypeB,
			tick_lower: intent.tickLower,
			tick_upper: intent.tickUpper,
			amount_a: intent.amountA,
			amount_b: intent.amountB,
			slippage: parseSlippageDecimal(intent.slippageBps),
			fix_amount_a: intent.fixAmountA,
			is_open: false,
			collect_fee: intent.collectFee,
			rewarder_coin_types: intent.rewarderCoinTypes,
		});
		return {
			tx: tx as unknown as Transaction,
			artifacts: {
				poolId: intent.poolId,
				positionId: intent.positionId,
				amountA: intent.amountA,
				amountB: intent.amountB,
				tickLower: intent.tickLower,
				tickUpper: intent.tickUpper,
			},
		};
	}

	if (intent.type === "sui.lp.cetus.remove") {
		const cetusNetwork = resolveCetusNetwork(network);
		const rpcUrl = getSuiRpcEndpoint(network);
		const sdk = initCetusSDK({
			network: cetusNetwork,
			fullNodeUrl: rpcUrl,
			wallet: signerAddress,
		});
		const tx = await sdk.Position.removeLiquidityTransactionPayload({
			pool_id: intent.poolId,
			pos_id: intent.positionId,
			coinTypeA: intent.coinTypeA,
			coinTypeB: intent.coinTypeB,
			delta_liquidity: intent.deltaLiquidity,
			min_amount_a: intent.minAmountA,
			min_amount_b: intent.minAmountB,
			collect_fee: intent.collectFee,
			rewarder_coin_types: intent.rewarderCoinTypes,
		});
		return {
			tx: tx as unknown as Transaction,
			artifacts: {
				poolId: intent.poolId,
				positionId: intent.positionId,
				deltaLiquidity: intent.deltaLiquidity,
				minAmountA: intent.minAmountA,
				minAmountB: intent.minAmountB,
			},
		};
	}

	const env = resolveAggregatorEnv(network);
	const routeClient = new AggregatorClient({
		env,
		endpoint: intent.endpoint,
		apiKey: intent.apiKey || process.env.CETUS_AGGREGATOR_API_KEY?.trim(),
		signer: signerAddress,
	});
	const route = await routeClient.findRouters({
		from: intent.inputCoinType,
		target: intent.outputCoinType,
		amount: parsePositiveBigInt(intent.amountRaw, "amountRaw").toString(),
		byAmountIn: intent.byAmountIn,
		providers: intent.providers,
		depth: intent.depth,
	});
	if (!route || route.insufficientLiquidity || route.paths.length === 0) {
		const errorMessage = route?.error
			? `${route.error.code}: ${route.error.msg}`
			: "No route found";
		throw new Error(`Unable to build swap simulation (${errorMessage})`);
	}
	const tx = new Transaction();
	await routeClient.fastRouterSwap({
		router: route,
		txb: tx as unknown as Parameters<
			AggregatorClient["fastRouterSwap"]
		>[0]["txb"],
		slippage: parseSlippageDecimal(intent.slippageBps),
	});
	return {
		tx,
		artifacts: {
			quoteId: route.quoteID ?? null,
			routeAmountIn: route.amountIn.toString(),
			routeAmountOut: route.amountOut.toString(),
			pathCount: route.paths.length,
			providersUsed: Array.from(
				new Set(route.paths.map((path) => path.provider)),
			),
		},
	};
}

async function buildStableLayerSimulation(
	intent: StableLayerWorkflowIntent,
	network: SuiNetwork,
	signerAddress: string,
): Promise<{
	tx: Transaction;
	artifacts: Record<string, unknown>;
}> {
	const stableLayerNetwork = resolveStableLayerNetwork(network);

	if (intent.type === "sui.stablelayer.mint") {
		const amountUsdcRaw = parsePositiveBigInt(
			intent.amountUsdcRaw,
			"amountUsdcRaw",
		);
		const tx = await buildStableLayerMintTransaction({
			network: stableLayerNetwork,
			sender: signerAddress,
			stableCoinType: intent.stableCoinType,
			amountUsdcRaw,
			usdcCoinType: intent.usdcCoinType,
			autoTransfer: true,
		});
		return {
			tx,
			artifacts: {
				stableLayerNetwork,
				stableCoinType: intent.stableCoinType,
				amountUsdcRaw: amountUsdcRaw.toString(),
				usdcCoinType:
					intent.usdcCoinType ?? STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
			},
		};
	}

	if (intent.type === "sui.stablelayer.burn") {
		const amountStableRaw = intent.amountStableRaw
			? parsePositiveBigInt(intent.amountStableRaw, "amountStableRaw")
			: undefined;
		const tx = await buildStableLayerBurnTransaction({
			network: stableLayerNetwork,
			sender: signerAddress,
			stableCoinType: intent.stableCoinType,
			amountStableRaw,
			burnAll: intent.burnAll,
			autoTransfer: true,
		});
		return {
			tx,
			artifacts: {
				stableLayerNetwork,
				stableCoinType: intent.stableCoinType,
				burnAll: intent.burnAll,
				amountStableRaw: amountStableRaw?.toString() ?? null,
			},
		};
	}

	const tx = await buildStableLayerClaimTransaction({
		network: stableLayerNetwork,
		sender: signerAddress,
		stableCoinType: intent.stableCoinType,
		autoTransfer: true,
	});
	return {
		tx,
		artifacts: {
			stableLayerNetwork,
			stableCoinType: intent.stableCoinType,
		},
	};
}

function resolveExecutionTool(
	name:
		| "sui_transferSui"
		| "sui_transferCoin"
		| "sui_swapCetus"
		| "sui_cetusAddLiquidity"
		| "sui_cetusRemoveLiquidity"
		| "sui_stableLayerMint"
		| "sui_stableLayerBurn"
		| "sui_stableLayerClaim",
) {
	const tool = createSuiExecuteTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`Execution tool not found: ${name}`);
	return tool as unknown as {
		execute(
			toolCallId: string,
			params: Record<string, unknown>,
		): Promise<{ details?: unknown }>;
	};
}

async function executeIntent(
	intent: SuiWorkflowIntent,
	params: WorkflowParams,
	network: SuiNetwork,
) {
	if (intent.type === "sui.transfer.sui") {
		const tool = resolveExecutionTool("sui_transferSui");
		return tool.execute("wf-execute", {
			toAddress: intent.toAddress,
			amountMist: intent.amountMist,
			amountSui: intent.amountSui,
			network,
			fromPrivateKey: params.fromPrivateKey,
			waitForLocalExecution: params.waitForLocalExecution,
			confirmMainnet: params.confirmMainnet,
		});
	}
	if (intent.type === "sui.transfer.coin") {
		const tool = resolveExecutionTool("sui_transferCoin");
		return tool.execute("wf-execute", {
			toAddress: intent.toAddress,
			coinType: intent.coinType,
			amountRaw: intent.amountRaw,
			maxCoinObjectsToMerge: intent.maxCoinObjectsToMerge,
			network,
			fromPrivateKey: params.fromPrivateKey,
			waitForLocalExecution: params.waitForLocalExecution,
			confirmMainnet: params.confirmMainnet,
		});
	}
	if (intent.type === "sui.lp.cetus.add") {
		const tool = resolveExecutionTool("sui_cetusAddLiquidity");
		return tool.execute("wf-execute", {
			poolId: intent.poolId,
			positionId: intent.positionId,
			coinTypeA: intent.coinTypeA,
			coinTypeB: intent.coinTypeB,
			tickLower: intent.tickLower,
			tickUpper: intent.tickUpper,
			amountA: intent.amountA,
			amountB: intent.amountB,
			fixAmountA: intent.fixAmountA,
			slippageBps: intent.slippageBps,
			collectFee: intent.collectFee,
			rewarderCoinTypes: intent.rewarderCoinTypes,
			network,
			fromPrivateKey: params.fromPrivateKey,
			waitForLocalExecution: params.waitForLocalExecution,
			confirmMainnet: params.confirmMainnet,
		});
	}
	if (intent.type === "sui.lp.cetus.remove") {
		const tool = resolveExecutionTool("sui_cetusRemoveLiquidity");
		return tool.execute("wf-execute", {
			poolId: intent.poolId,
			positionId: intent.positionId,
			coinTypeA: intent.coinTypeA,
			coinTypeB: intent.coinTypeB,
			deltaLiquidity: intent.deltaLiquidity,
			minAmountA: intent.minAmountA,
			minAmountB: intent.minAmountB,
			collectFee: intent.collectFee,
			rewarderCoinTypes: intent.rewarderCoinTypes,
			network,
			fromPrivateKey: params.fromPrivateKey,
			waitForLocalExecution: params.waitForLocalExecution,
			confirmMainnet: params.confirmMainnet,
		});
	}
	const tool = resolveExecutionTool("sui_swapCetus");
	return tool.execute("wf-execute", {
		inputCoinType: intent.inputCoinType,
		outputCoinType: intent.outputCoinType,
		amountRaw: intent.amountRaw,
		byAmountIn: intent.byAmountIn,
		slippageBps: intent.slippageBps,
		providers: intent.providers,
		depth: intent.depth,
		endpoint: intent.endpoint,
		apiKey: intent.apiKey,
		network,
		fromPrivateKey: params.fromPrivateKey,
		waitForLocalExecution: params.waitForLocalExecution,
		confirmMainnet: params.confirmMainnet,
	});
}

async function executeStableLayerIntent(
	intent: StableLayerWorkflowIntent,
	params: StableLayerWorkflowParams,
	network: SuiNetwork,
) {
	if (intent.type === "sui.stablelayer.mint") {
		const tool = resolveExecutionTool("sui_stableLayerMint");
		return tool.execute("wf-stablelayer-execute", {
			stableCoinType: intent.stableCoinType,
			amountUsdcRaw: intent.amountUsdcRaw,
			usdcCoinType: intent.usdcCoinType,
			network,
			fromPrivateKey: params.fromPrivateKey,
			waitForLocalExecution: params.waitForLocalExecution,
			confirmMainnet: params.confirmMainnet,
		});
	}
	if (intent.type === "sui.stablelayer.burn") {
		const tool = resolveExecutionTool("sui_stableLayerBurn");
		return tool.execute("wf-stablelayer-execute", {
			stableCoinType: intent.stableCoinType,
			amountStableRaw: intent.amountStableRaw,
			burnAll: intent.burnAll,
			network,
			fromPrivateKey: params.fromPrivateKey,
			waitForLocalExecution: params.waitForLocalExecution,
			confirmMainnet: params.confirmMainnet,
		});
	}
	const tool = resolveExecutionTool("sui_stableLayerClaim");
	return tool.execute("wf-stablelayer-execute", {
		stableCoinType: intent.stableCoinType,
		network,
		fromPrivateKey: params.fromPrivateKey,
		waitForLocalExecution: params.waitForLocalExecution,
		confirmMainnet: params.confirmMainnet,
	});
}

export function createSuiWorkflowTools() {
	return [
		defineTool({
			name: "w3rt_run_sui_workflow_v0",
			label: "W3RT Sui Workflow v0",
			description:
				"Deterministic Sui workflow entrypoint: analysis -> simulate -> execute",
			parameters: Type.Object({
				runId: Type.Optional(Type.String()),
				runMode: workflowRunModeSchema(),
				intentType: Type.Optional(
					Type.Union([
						Type.Literal("sui.transfer.sui"),
						Type.Literal("sui.transfer.coin"),
						Type.Literal("sui.swap.cetus"),
						Type.Literal("sui.lp.cetus.add"),
						Type.Literal("sui.lp.cetus.remove"),
					]),
				),
				intentText: Type.Optional(Type.String()),
				network: suiNetworkSchema(),
				toAddress: Type.Optional(Type.String()),
				amountSui: Type.Optional(Type.Number()),
				amountRaw: Type.Optional(Type.String()),
				coinType: Type.Optional(Type.String()),
				inputCoinType: Type.Optional(Type.String()),
				outputCoinType: Type.Optional(Type.String()),
				byAmountIn: Type.Optional(Type.Boolean()),
				slippageBps: Type.Optional(
					Type.Number({ minimum: 1, maximum: 10_000 }),
				),
				providers: Type.Optional(
					Type.Array(Type.String(), { minItems: 1, maxItems: 50 }),
				),
				depth: Type.Optional(Type.Number({ minimum: 1, maximum: 8 })),
				poolId: Type.Optional(Type.String()),
				positionId: Type.Optional(Type.String()),
				coinTypeA: Type.Optional(Type.String()),
				coinTypeB: Type.Optional(Type.String()),
				tickLower: Type.Optional(Type.Number()),
				tickUpper: Type.Optional(Type.Number()),
				amountA: Type.Optional(Type.String()),
				amountB: Type.Optional(Type.String()),
				fixAmountA: Type.Optional(Type.Boolean()),
				deltaLiquidity: Type.Optional(Type.String()),
				minAmountA: Type.Optional(Type.String()),
				minAmountB: Type.Optional(Type.String()),
				collectFee: Type.Optional(Type.Boolean()),
				rewarderCoinTypes: Type.Optional(
					Type.Array(Type.String(), { minItems: 0, maxItems: 16 }),
				),
				maxCoinObjectsToMerge: Type.Optional(
					Type.Number({ minimum: 1, maximum: 100 }),
				),
				endpoint: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				fromPrivateKey: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as WorkflowParams;
				const runId = createRunId(params.runId);
				const runMode = parseRunMode(params.runMode);
				const network = parseSuiNetwork(params.network);
				const intent = normalizeIntent(params);
				const needsMainnetConfirmation = network === "mainnet";
				const confirmToken = createConfirmToken(runId, network, intent);
				const plan = ["analysis", "simulate", "execute"];

				if (runMode === "analysis") {
					return {
						content: [
							{
								type: "text",
								text: `Workflow analyzed: ${intent.type}`,
							},
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation,
							confirmToken,
							artifacts: {
								analysis: {
									intent,
									plan,
								},
							},
						},
					};
				}

				if (runMode === "simulate") {
					const signer = resolveSuiKeypair(params.fromPrivateKey);
					const sender = signer.toSuiAddress();
					const { tx, artifacts } = await buildSimulation(
						intent,
						network,
						sender,
					);
					tx.setSender(sender);
					const client = getSuiClient(network);
					const simulation = await client.devInspectTransactionBlock({
						sender,
						transactionBlock: tx,
					});
					const { status, error } = getSimulationStatus(simulation);
					if (status !== "success") {
						throw new Error(
							`Simulation failed: ${error ?? "unknown error"} (intent=${intent.type})`,
						);
					}
					return {
						content: [
							{
								type: "text",
								text: `Workflow simulated: ${intent.type} status=${status}`,
							},
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation,
							confirmToken,
							artifacts: {
								simulate: {
									status,
									error,
									...artifacts,
								},
							},
						},
					};
				}

				if (needsMainnetConfirmation) {
					if (params.confirmMainnet !== true) {
						throw new Error(
							"Mainnet workflow execute is blocked. Set confirmMainnet=true.",
						);
					}
					if (!params.confirmToken || params.confirmToken !== confirmToken) {
						throw new Error(
							"Invalid confirmToken for mainnet execute. Run simulate first and pass returned confirmToken.",
						);
					}
				}

				const executeResult = await executeIntent(intent, params, network);
				return {
					content: [
						{
							type: "text",
							text: `Workflow executed: ${intent.type}`,
						},
					],
					details: {
						runId,
						runMode,
						network,
						intentType: intent.type,
						intent,
						needsMainnetConfirmation,
						confirmToken,
						requestType: resolveRequestType(params.waitForLocalExecution),
						artifacts: {
							execute: executeResult.details ?? null,
						},
					},
				};
			},
		}),
		defineTool({
			name: "w3rt_run_sui_stablelayer_workflow_v0",
			label: "W3RT Sui Stable Layer Workflow v0",
			description:
				"Deterministic Stable Layer workflow entrypoint: analysis -> simulate -> execute",
			parameters: Type.Object({
				runId: Type.Optional(Type.String()),
				runMode: workflowRunModeSchema(),
				intentType: Type.Optional(
					Type.Union([
						Type.Literal("sui.stablelayer.mint"),
						Type.Literal("sui.stablelayer.burn"),
						Type.Literal("sui.stablelayer.claim"),
					]),
				),
				intentText: Type.Optional(Type.String()),
				network: suiNetworkSchema(),
				stableCoinType: Type.Optional(Type.String()),
				amountUsdcRaw: Type.Optional(Type.String()),
				amountStableRaw: Type.Optional(Type.String()),
				burnAll: Type.Optional(Type.Boolean()),
				usdcCoinType: Type.Optional(Type.String()),
				fromPrivateKey: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as StableLayerWorkflowParams;
				const runId = createRunId(params.runId);
				const runMode = parseRunMode(params.runMode);
				const network = parseSuiNetwork(params.network);
				const stableLayerNetwork = resolveStableLayerNetwork(network);
				const intent = normalizeStableLayerIntent(params);
				const needsMainnetConfirmation = network === "mainnet";
				const confirmToken = createConfirmToken(runId, network, intent);
				const plan = ["analysis", "simulate", "execute"];

				if (runMode === "analysis") {
					return {
						content: [
							{
								type: "text",
								text: `Workflow analyzed: ${intent.type}`,
							},
						],
						details: {
							runId,
							runMode,
							network,
							stableLayerNetwork,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation,
							confirmToken,
							artifacts: {
								analysis: {
									intent,
									plan,
								},
							},
						},
					};
				}

				if (runMode === "simulate") {
					const signer = resolveSuiKeypair(params.fromPrivateKey);
					const sender = signer.toSuiAddress();
					const { tx, artifacts } = await buildStableLayerSimulation(
						intent,
						network,
						sender,
					);
					tx.setSender(sender);
					const client = getSuiClient(network);
					const simulation = await client.devInspectTransactionBlock({
						sender,
						transactionBlock: tx,
					});
					const { status, error } = getSimulationStatus(simulation);
					if (status !== "success") {
						throw new Error(
							`Simulation failed: ${error ?? "unknown error"} (intent=${intent.type})`,
						);
					}
					return {
						content: [
							{
								type: "text",
								text: `Workflow simulated: ${intent.type} status=${status}`,
							},
						],
						details: {
							runId,
							runMode,
							network,
							stableLayerNetwork,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation,
							confirmToken,
							artifacts: {
								simulate: {
									status,
									error,
									...artifacts,
								},
							},
						},
					};
				}

				if (needsMainnetConfirmation) {
					if (params.confirmMainnet !== true) {
						throw new Error(
							"Mainnet workflow execute is blocked. Set confirmMainnet=true.",
						);
					}
					if (!params.confirmToken || params.confirmToken !== confirmToken) {
						throw new Error(
							"Invalid confirmToken for mainnet execute. Run simulate first and pass returned confirmToken.",
						);
					}
				}

				const executeResult = await executeStableLayerIntent(
					intent,
					params,
					network,
				);
				return {
					content: [
						{
							type: "text",
							text: `Workflow executed: ${intent.type}`,
						},
					],
					details: {
						runId,
						runMode,
						network,
						stableLayerNetwork,
						intentType: intent.type,
						intent,
						needsMainnetConfirmation,
						confirmToken,
						requestType: resolveRequestType(params.waitForLocalExecution),
						artifacts: {
							execute: executeResult.details ?? null,
						},
					},
				};
			},
		}),
	];
}
