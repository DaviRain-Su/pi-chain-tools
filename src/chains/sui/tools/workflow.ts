import { createHash } from "node:crypto";
import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";
import { Transaction } from "@mysten/sui/transactions";
import { Type } from "@sinclair/typebox";
import { type RegisteredTool, defineTool } from "../../../core/types.js";
import {
	buildCetusFarmsHarvestTransaction,
	buildCetusFarmsStakeTransaction,
	buildCetusFarmsUnstakeTransaction,
	resolveCetusV2Network,
} from "../cetus-v2.js";
import {
	SUI_COIN_TYPE,
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

type CetusFarmsStakeIntent = {
	type: "sui.cetus.farms.stake";
	poolId: string;
	clmmPositionId: string;
	clmmPoolId: string;
	coinTypeA: string;
	coinTypeB: string;
};

type CetusFarmsUnstakeIntent = {
	type: "sui.cetus.farms.unstake";
	poolId: string;
	positionNftId: string;
};

type CetusFarmsHarvestIntent = {
	type: "sui.cetus.farms.harvest";
	poolId: string;
	positionNftId: string;
};

type CetusFarmsWorkflowIntent =
	| CetusFarmsStakeIntent
	| CetusFarmsUnstakeIntent
	| CetusFarmsHarvestIntent;

type CetusFarmsWorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	intentType?: CetusFarmsWorkflowIntent["type"];
	intentText?: string;
	network?: string;
	rpcUrl?: string;
	poolId?: string;
	clmmPositionId?: string;
	clmmPoolId?: string;
	coinTypeA?: string;
	coinTypeB?: string;
	positionNftId?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	waitForLocalExecution?: boolean;
};

type ParsedCetusFarmsIntentHints = {
	intentType?: CetusFarmsWorkflowIntent["type"];
	poolId?: string;
	clmmPositionId?: string;
	clmmPoolId?: string;
	coinTypeA?: string;
	coinTypeB?: string;
	positionNftId?: string;
};

type SuiDefiWorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	intentType?: string;
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
	stableCoinType?: string;
	amountUsdcRaw?: string;
	amountStableRaw?: string;
	burnAll?: boolean;
	usdcCoinType?: string;
	rpcUrl?: string;
	clmmPositionId?: string;
	clmmPoolId?: string;
	positionNftId?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	waitForLocalExecution?: boolean;
};

type CetusClmmSdkLike = {
	Position: {
		createAddLiquidityFixTokenPayload(params: {
			pool_id: string;
			pos_id: string;
			coinTypeA: string;
			coinTypeB: string;
			tick_lower: number;
			tick_upper: number;
			amount_a: string;
			amount_b: string;
			slippage: number;
			fix_amount_a: boolean;
			is_open: boolean;
			collect_fee: boolean;
			rewarder_coin_types: string[];
		}): Promise<unknown>;
		removeLiquidityTransactionPayload(params: {
			pool_id: string;
			pos_id: string;
			coinTypeA: string;
			coinTypeB: string;
			delta_liquidity: string;
			min_amount_a: string;
			min_amount_b: string;
			collect_fee: boolean;
			rewarder_coin_types: string[];
		}): Promise<unknown>;
	};
};

type InitCetusSDKFn = (config: {
	network: "mainnet" | "testnet";
	fullNodeUrl: string;
	wallet: string;
}) => CetusClmmSdkLike;

let cachedInitCetusSDK: InitCetusSDKFn | null = null;

async function getInitCetusSDK(): Promise<InitCetusSDKFn> {
	if (cachedInitCetusSDK) return cachedInitCetusSDK;
	const moduleValue = await import("@cetusprotocol/cetus-sui-clmm-sdk");
	const candidate = (moduleValue as { initCetusSDK?: unknown }).initCetusSDK;
	if (typeof candidate !== "function") {
		throw new Error(
			"Failed to load @cetusprotocol/cetus-sui-clmm-sdk: initCetusSDK not found.",
		);
	}
	cachedInitCetusSDK = candidate as InitCetusSDKFn;
	return cachedInitCetusSDK;
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

function parseRunMode(value?: string): WorkflowRunMode {
	if (value === "simulate" || value === "execute") return value;
	return "analysis";
}

function createRunId(input?: string): string {
	if (input?.trim()) return input.trim();
	const nonce = Math.random().toString(36).slice(2, 8);
	return `wf-sui-${Date.now().toString(36)}-${nonce}`;
}

type WorkflowToolRoute =
	| "w3rt_run_sui_workflow_v0"
	| "w3rt_run_sui_stablelayer_workflow_v0"
	| "w3rt_run_sui_cetus_farms_workflow_v0";

type WorkflowSessionRecord = {
	route: WorkflowToolRoute;
	runId: string;
	network: SuiNetwork;
	intent: unknown;
};

const WORKFLOW_SESSION_BY_RUN_ID = new Map<string, WorkflowSessionRecord>();
let latestWorkflowSession: WorkflowSessionRecord | null = null;

function rememberWorkflowSession(record: WorkflowSessionRecord): void {
	WORKFLOW_SESSION_BY_RUN_ID.set(record.runId, record);
	latestWorkflowSession = record;
}

function readWorkflowSession(
	route: WorkflowToolRoute,
	runId?: string,
): WorkflowSessionRecord | null {
	if (runId?.trim()) {
		const found = WORKFLOW_SESSION_BY_RUN_ID.get(runId.trim());
		if (found && found.route === route) return found;
	}
	if (latestWorkflowSession?.route === route) {
		return latestWorkflowSession;
	}
	return null;
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

type KnownSuiToken = {
	coinType: string;
	decimals: number;
	aliases: string[];
};

const KNOWN_SUI_TOKENS: KnownSuiToken[] = [
	{
		coinType: SUI_COIN_TYPE,
		decimals: 9,
		aliases: ["SUI", "WSUI"],
	},
	{
		coinType: STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
		decimals: 6,
		aliases: ["USDC"],
	},
];

const KNOWN_SUI_TOKEN_BY_ALIAS = new Map<string, KnownSuiToken>(
	KNOWN_SUI_TOKENS.flatMap((token) =>
		token.aliases.map((alias) => [alias.toUpperCase(), token] as const),
	),
);

const KNOWN_SUI_TOKEN_BY_COIN_TYPE = new Map<string, KnownSuiToken>(
	KNOWN_SUI_TOKENS.map((token) => [token.coinType, token] as const),
);

function decimalUiAmountToRaw(
	amountUi: string,
	decimals: number,
	fieldName: string,
): string {
	const trimmed = amountUi.trim();
	const matched = trimmed.match(/^([0-9]+)(?:\.([0-9]+))?$/);
	if (!matched) {
		throw new Error(`${fieldName} must be a positive decimal string`);
	}
	const whole = matched[1] ?? "0";
	const fraction = matched[2] ?? "";
	if (fraction.length > decimals) {
		throw new Error(
			`${fieldName} has too many decimal places for token decimals=${decimals}`,
		);
	}
	const base = 10n ** BigInt(decimals);
	const wholeRaw = BigInt(whole) * base;
	const paddedFraction = fraction.padEnd(decimals, "0");
	const fractionRaw = paddedFraction ? BigInt(paddedFraction) : 0n;
	const raw = wholeRaw + fractionRaw;
	if (raw <= 0n) {
		throw new Error(`${fieldName} must be positive`);
	}
	return raw.toString();
}

function resolveKnownSuiToken(input: string): KnownSuiToken | undefined {
	const normalized = input.trim().toUpperCase();
	if (!normalized) return undefined;
	return KNOWN_SUI_TOKEN_BY_ALIAS.get(normalized);
}

function normalizeCoinTypeOrSymbol(value?: string): string | undefined {
	if (!value?.trim()) return undefined;
	const normalized = value.trim();
	if (/^0x[a-fA-F0-9]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+$/.test(normalized)) {
		return normalized;
	}
	return resolveKnownSuiToken(normalized)?.coinType;
}

function collectCoinTypeCandidates(text: string): string[] {
	const coinTypesFromTag = [
		...text.matchAll(/0x[a-fA-F0-9]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+/g),
	].map((entry) => entry[0]);
	const symbolMatches = [...text.matchAll(/\b[A-Za-z][A-Za-z0-9_]{1,15}\b/g)]
		.map((entry) => entry[0])
		.map((symbol) => resolveKnownSuiToken(symbol)?.coinType)
		.filter((value): value is string => Boolean(value));

	const merged = [...coinTypesFromTag, ...symbolMatches];
	const deduped: string[] = [];
	const seen = new Set<string>();
	for (const candidate of merged) {
		if (seen.has(candidate)) continue;
		seen.add(candidate);
		deduped.push(candidate);
	}
	return deduped;
}

function parseSwapAmountRawFromText(params: {
	text: string;
	inputCoinType?: string;
	fallbackAmountRaw?: string;
}): string | undefined {
	const explicitRaw =
		params.text.match(/\bamountRaw\s*[=:]\s*([0-9]+)\b/i)?.[1] ??
		params.text.match(/\b([0-9]+)\s*raw\b/i)?.[1];
	if (explicitRaw) return explicitRaw;

	const symbolAmountMatches = [
		...params.text.matchAll(
			/([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z][A-Za-z0-9_]{1,15})\b/g,
		),
	];
	for (const match of symbolAmountMatches) {
		const amountUi = match[1];
		const symbol = match[2];
		if (!amountUi || !symbol) continue;
		const token = resolveKnownSuiToken(symbol);
		if (!token) continue;
		if (
			params.inputCoinType &&
			token.coinType.toLowerCase() !== params.inputCoinType.toLowerCase()
		) {
			continue;
		}
		return decimalUiAmountToRaw(amountUi, token.decimals, "amountUi");
	}

	return params.fallbackAmountRaw;
}

function parseIntentText(text?: string): ParsedIntentHints {
	if (!text?.trim()) return {};
	const lower = text.toLowerCase();
	const objectIdMatches = [...text.matchAll(/0x[a-fA-F0-9]{1,64}(?!::)/g)].map(
		(entry) => entry[0],
	);
	const coinTypeCandidates = collectCoinTypeCandidates(text);
	const suiAmountMatch = text.match(/(\d+(?:\.\d+)?)\s*sui\b/i);
	const integerMatch = text.match(/\b\d+\b/);
	const poolLabelMatch =
		text.match(/(?:pool|poolId|池子|池)\s*[:= ]\s*(0x[a-fA-F0-9]{1,64})/i) ??
		null;
	const positionLabelMatch =
		text.match(
			/(?:position|positionId|pos|仓位|头寸)\s*[:= ]\s*(0x[a-fA-F0-9]{1,64})/i,
		) ?? null;
	const tickRangeMatch =
		text.match(
			/(?:tick|ticks|范围)\s*[:= ]?\s*(-?\d+)\s*(?:to|~|-)\s*(-?\d+)/i,
		) ?? null;
	const amountAMatch =
		text.match(
			/(?:amountA|tokenA|a金额|a_amount|amount a|a amount|币A|代币A)\s*[:= ]\s*(\d+)/i,
		) ??
		text.match(/\ba\s*[:= ]\s*(\d+)\b/i) ??
		null;
	const amountBMatch =
		text.match(
			/(?:amountB|tokenB|b金额|b_amount|amount b|b amount|币B|代币B)\s*[:= ]\s*(\d+)/i,
		) ??
		text.match(/\bb\s*[:= ]\s*(\d+)\b/i) ??
		null;
	const deltaLiquidityMatch =
		text.match(
			/(?:deltaLiquidity|delta_liquidity|liquidityDelta|移除流动性|减少流动性|liquidity)\s*[:= ]\s*(\d+)/i,
		) ?? null;
	const minAmountAMatch =
		text.match(/(?:minAmountA|min_a|minA)\s*[:= ]\s*(\d+)/i) ?? null;
	const minAmountBMatch =
		text.match(/(?:minAmountB|min_b|minB)\s*[:= ]\s*(\d+)/i) ?? null;

	if (
		/(add liquidity|provide liquidity|open position|increase liquidity|增加流动性|添加流动性|加流动性|加池|做市|开仓|加仓)/i.test(
			lower,
		)
	) {
		return {
			intentType: "sui.lp.cetus.add",
			poolId: poolLabelMatch?.[1] || objectIdMatches[0],
			positionId: positionLabelMatch?.[1] || objectIdMatches[1],
			coinTypeA: coinTypeCandidates[0],
			coinTypeB: coinTypeCandidates[1],
			tickLower: parseInteger(tickRangeMatch?.[1]),
			tickUpper: parseInteger(tickRangeMatch?.[2]),
			amountA: amountAMatch?.[1],
			amountB: amountBMatch?.[1],
		};
	}

	if (
		/(remove liquidity|withdraw liquidity|close position|decrease liquidity|移除流动性|减少流动性|撤池|减池|平仓|撤流动性|减仓)/i.test(
			lower,
		)
	) {
		return {
			intentType: "sui.lp.cetus.remove",
			poolId: poolLabelMatch?.[1] || objectIdMatches[0],
			positionId: positionLabelMatch?.[1] || objectIdMatches[1],
			coinTypeA: coinTypeCandidates[0],
			coinTypeB: coinTypeCandidates[1],
			deltaLiquidity: deltaLiquidityMatch?.[1] || integerMatch?.[0],
			minAmountA: minAmountAMatch?.[1],
			minAmountB: minAmountBMatch?.[1],
		};
	}

	if (/(swap|兑换|换币|交易对|换成|换为|兑换成)/i.test(lower)) {
		const inputCoinType = coinTypeCandidates[0];
		const outputCoinType = coinTypeCandidates[1];
		return {
			intentType: "sui.swap.cetus",
			inputCoinType,
			outputCoinType,
			amountRaw: parseSwapAmountRawFromText({
				text,
				inputCoinType,
				fallbackAmountRaw: integerMatch?.[0],
			}),
		};
	}

	if (/(transfer|send|转账|发送|转给|转)/i.test(lower)) {
		if (suiAmountMatch) {
			return {
				intentType: "sui.transfer.sui",
				toAddress: objectIdMatches[0],
				amountSui: Number(suiAmountMatch[1]),
			};
		}
		return {
			intentType: "sui.transfer.coin",
			toAddress: objectIdMatches[0],
			coinType: coinTypeCandidates[0],
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
	const amountLabelMatch = text.match(
		/(?:amount|数量|金额|额度|数量为)\s*[:= ]\s*(\d+)/i,
	);
	const integerMatch = amountLabelMatch?.[1] ?? text.match(/\b\d+\b/)?.[0];
	const burnAll =
		/\bburn\s+all\b|\b全部燃烧\b|\b全部销毁\b|\ball\s+balance\b/i.test(lower);

	if (/\bclaim\b|领取|提取奖励|收获奖励|领收益|领取稳定币收益/i.test(lower)) {
		return {
			intentType: "sui.stablelayer.claim",
			stableCoinType: coinTypeMatches[0],
		};
	}

	if (/\bburn\b|\bredeem\b|赎回|销毁|回收/i.test(lower)) {
		return {
			intentType: "sui.stablelayer.burn",
			stableCoinType: coinTypeMatches[0],
			amountRaw: integerMatch,
			burnAll,
		};
	}

	if (/\bmint\b|铸造|生成稳定币|兑换稳定币|铸稳定币/i.test(lower)) {
		return {
			intentType: "sui.stablelayer.mint",
			stableCoinType: coinTypeMatches[0],
			amountRaw: integerMatch,
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

function parseCetusFarmsIntentText(text?: string): ParsedCetusFarmsIntentHints {
	if (!text?.trim()) return {};
	const lower = text.toLowerCase();
	const objectIdMatches = [...text.matchAll(/0x[a-fA-F0-9]{1,64}(?!::)/g)].map(
		(entry) => entry[0],
	);
	const coinTypeCandidates = collectCoinTypeCandidates(text);

	const poolLabelMatch =
		text.match(
			/(?:pool|poolId|farm pool|farms pool|farm|池子)\s*[:= ]\s*(0x[a-fA-F0-9]{1,64})/i,
		) ?? null;
	const clmmPositionLabelMatch =
		text.match(
			/(?:clmmPositionId|clmm position|positionId|position|仓位)\s*[:= ]\s*(0x[a-fA-F0-9]{1,64})/i,
		) ?? null;
	const clmmPoolLabelMatch =
		text.match(/(?:clmmPoolId|clmm pool)\s*[:= ]\s*(0x[a-fA-F0-9]{1,64})/i) ??
		null;
	const positionNftLabelMatch =
		text.match(
			/(?:positionNftId|position nft|nft|farm position|头寸|pos nft)\s*[:= ]\s*(0x[a-fA-F0-9]{1,64})/i,
		) ?? null;

	if (
		/\bharvest\b|\bclaim\b|\bclaim reward\b|\bcollect reward\b|领取奖励|收获奖励|提取奖励|收割/i.test(
			lower,
		)
	) {
		return {
			intentType: "sui.cetus.farms.harvest",
			poolId: poolLabelMatch?.[1] || objectIdMatches[0],
			positionNftId: positionNftLabelMatch?.[1] || objectIdMatches[1],
		};
	}

	if (
		/\bunstake\b|\bwithdraw\b|\bwithdraw farm\b|解除质押|解质押|取回仓位|移除质押/i.test(
			lower,
		)
	) {
		return {
			intentType: "sui.cetus.farms.unstake",
			poolId: poolLabelMatch?.[1] || objectIdMatches[0],
			positionNftId: positionNftLabelMatch?.[1] || objectIdMatches[1],
		};
	}

	if (
		/\bstake\b|\bdeposit\b|\bfarm stake\b|\bfarm deposit\b|质押|存入农场|存入farm/i.test(
			lower,
		)
	) {
		return {
			intentType: "sui.cetus.farms.stake",
			poolId: poolLabelMatch?.[1] || objectIdMatches[0],
			clmmPositionId: clmmPositionLabelMatch?.[1] || objectIdMatches[1],
			clmmPoolId: clmmPoolLabelMatch?.[1] || objectIdMatches[2],
			coinTypeA: coinTypeCandidates[0],
			coinTypeB: coinTypeCandidates[1],
		};
	}

	return {};
}

function inferCetusFarmsIntentType(
	params: CetusFarmsWorkflowParams,
	parsed: ParsedCetusFarmsIntentHints,
): CetusFarmsWorkflowIntent["type"] {
	if (params.intentType) return params.intentType;
	if (parsed.intentType) return parsed.intentType;
	if (params.positionNftId?.trim()) return "sui.cetus.farms.unstake";
	if (
		params.clmmPositionId?.trim() &&
		params.clmmPoolId?.trim() &&
		params.coinTypeA?.trim() &&
		params.coinTypeB?.trim()
	) {
		return "sui.cetus.farms.stake";
	}
	throw new Error(
		"Cannot infer Cetus farms intentType. Provide intentType or enough structured fields.",
	);
}

function normalizeCetusFarmsIntent(
	params: CetusFarmsWorkflowParams,
): CetusFarmsWorkflowIntent {
	const parsed = parseCetusFarmsIntentText(params.intentText);
	const intentType = inferCetusFarmsIntentType(params, parsed);
	const poolId = params.poolId?.trim() || parsed.poolId;
	if (!poolId) {
		throw new Error("poolId is required for Cetus farms workflow.");
	}

	if (intentType === "sui.cetus.farms.stake") {
		const clmmPositionId =
			params.clmmPositionId?.trim() || parsed.clmmPositionId;
		const clmmPoolId = params.clmmPoolId?.trim() || parsed.clmmPoolId;
		const coinTypeA =
			normalizeCoinTypeOrSymbol(params.coinTypeA?.trim()) || parsed.coinTypeA;
		const coinTypeB =
			normalizeCoinTypeOrSymbol(params.coinTypeB?.trim()) || parsed.coinTypeB;
		if (!clmmPositionId) {
			throw new Error(
				"clmmPositionId is required for intentType=sui.cetus.farms.stake",
			);
		}
		if (!clmmPoolId) {
			throw new Error(
				"clmmPoolId is required for intentType=sui.cetus.farms.stake",
			);
		}
		if (!coinTypeA || !coinTypeB) {
			throw new Error(
				"coinTypeA and coinTypeB are required for intentType=sui.cetus.farms.stake",
			);
		}
		return {
			type: "sui.cetus.farms.stake",
			poolId,
			clmmPositionId,
			clmmPoolId,
			coinTypeA,
			coinTypeB,
		};
	}

	const positionNftId = params.positionNftId?.trim() || parsed.positionNftId;
	if (!positionNftId) {
		throw new Error(
			"positionNftId is required for Cetus farms unstake/harvest intents",
		);
	}
	if (intentType === "sui.cetus.farms.harvest") {
		return {
			type: "sui.cetus.farms.harvest",
			poolId,
			positionNftId,
		};
	}

	return {
		type: "sui.cetus.farms.unstake",
		poolId,
		positionNftId,
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
		const coinType =
			normalizeCoinTypeOrSymbol(params.coinType?.trim()) || parsed.coinType;
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
		const coinTypeA =
			normalizeCoinTypeOrSymbol(params.coinTypeA?.trim()) || parsed.coinTypeA;
		const coinTypeB =
			normalizeCoinTypeOrSymbol(params.coinTypeB?.trim()) || parsed.coinTypeB;
		const tickLower = params.tickLower ?? parsed.tickLower;
		const tickUpper = params.tickUpper ?? parsed.tickUpper;
		const amountA = params.amountA?.trim() || parsed.amountA;
		const amountB = params.amountB?.trim() || parsed.amountB;
		if (!poolId) {
			throw new Error(
				"poolId is required for sui.lp.cetus.add. Tip: first query Cetus pools and choose a poolId.",
			);
		}
		if (!positionId)
			throw new Error(
				"positionId is required for sui.lp.cetus.add. Tip: LP add currently targets an existing positionId.",
			);
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
		const coinTypeA =
			normalizeCoinTypeOrSymbol(params.coinTypeA?.trim()) || parsed.coinTypeA;
		const coinTypeB =
			normalizeCoinTypeOrSymbol(params.coinTypeB?.trim()) || parsed.coinTypeB;
		const deltaLiquidity =
			params.deltaLiquidity?.trim() || parsed.deltaLiquidity;
		const minAmountA = params.minAmountA?.trim() || parsed.minAmountA || "0";
		const minAmountB = params.minAmountB?.trim() || parsed.minAmountB || "0";
		if (!poolId) {
			throw new Error(
				"poolId is required for sui.lp.cetus.remove. Tip: first query Cetus pools and choose a poolId.",
			);
		}
		if (!positionId)
			throw new Error(
				"positionId is required for sui.lp.cetus.remove. Tip: LP remove currently targets an existing positionId.",
			);
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
		normalizeCoinTypeOrSymbol(params.inputCoinType?.trim()) ||
		parsed.inputCoinType ||
		normalizeCoinTypeOrSymbol(params.coinType?.trim());
	const outputCoinType =
		normalizeCoinTypeOrSymbol(params.outputCoinType?.trim()) ||
		parsed.outputCoinType;
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

function intentsMatch(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function hasCoreIntentInput(params: WorkflowParams): boolean {
	return Boolean(
		params.intentType ||
			params.intentText ||
			params.toAddress?.trim() ||
			params.amountSui != null ||
			params.amountRaw?.trim() ||
			params.coinType?.trim() ||
			params.inputCoinType?.trim() ||
			params.outputCoinType?.trim() ||
			params.poolId?.trim() ||
			params.positionId?.trim() ||
			params.coinTypeA?.trim() ||
			params.coinTypeB?.trim() ||
			params.tickLower != null ||
			params.tickUpper != null ||
			params.amountA?.trim() ||
			params.amountB?.trim() ||
			params.deltaLiquidity?.trim() ||
			params.minAmountA?.trim() ||
			params.minAmountB?.trim() ||
			params.collectFee != null ||
			params.rewarderCoinTypes?.length ||
			params.maxCoinObjectsToMerge != null ||
			params.providers?.length ||
			params.depth != null ||
			params.endpoint?.trim() ||
			params.apiKey?.trim(),
	);
}

function hasStableLayerIntentInput(params: StableLayerWorkflowParams): boolean {
	return Boolean(
		params.intentType ||
			params.intentText ||
			params.stableCoinType?.trim() ||
			params.amountUsdcRaw?.trim() ||
			params.amountStableRaw?.trim() ||
			params.burnAll === true ||
			params.usdcCoinType?.trim(),
	);
}

function hasCetusFarmsIntentInput(params: CetusFarmsWorkflowParams): boolean {
	return Boolean(
		params.intentType ||
			params.intentText ||
			params.poolId?.trim() ||
			params.clmmPositionId?.trim() ||
			params.clmmPoolId?.trim() ||
			params.coinTypeA?.trim() ||
			params.coinTypeB?.trim() ||
			params.positionNftId?.trim(),
	);
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

function stringifyError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

async function exportUnsignedPayload(
	tx: Transaction,
	client: ReturnType<typeof getSuiClient>,
): Promise<{
	unsignedTransactionBytesBase64?: string;
	unsignedTransactionBytesLength?: number;
	serializedTransaction?: string | null;
	unsignedPayloadError?: string;
}> {
	try {
		const built = await tx.build({ client });
		let serializedTransaction: string | null = null;
		try {
			serializedTransaction = tx.serialize();
		} catch {
			serializedTransaction = null;
		}
		return {
			unsignedTransactionBytesBase64: Buffer.from(built).toString("base64"),
			unsignedTransactionBytesLength: built.length,
			serializedTransaction,
		};
	} catch (error) {
		return {
			unsignedPayloadError: stringifyError(error),
		};
	}
}

function formatSimulationSummary(params: {
	intentType: string;
	status: string;
	signerAddress: string;
	unsignedPayload: {
		unsignedTransactionBytesBase64?: string;
		unsignedPayloadError?: string;
	};
}): string {
	if (params.unsignedPayload.unsignedTransactionBytesBase64) {
		return `Workflow simulated: ${params.intentType} status=${params.status} signer=${params.signerAddress} unsignedPayload=exported (execute can proceed with local signer)`;
	}
	if (params.unsignedPayload.unsignedPayloadError) {
		return `Workflow simulated: ${params.intentType} status=${params.status} signer=${params.signerAddress} unsignedPayload=unavailable`;
	}
	return `Workflow simulated: ${params.intentType} status=${params.status} signer=${params.signerAddress}`;
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
		const initCetusSDK = await getInitCetusSDK();
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
		const initCetusSDK = await getInitCetusSDK();
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

async function buildCetusFarmsSimulation(
	intent: CetusFarmsWorkflowIntent,
	network: SuiNetwork,
	signerAddress: string,
	rpcUrl?: string,
): Promise<{
	tx: Transaction;
	artifacts: Record<string, unknown>;
}> {
	const cetusNetwork = resolveCetusV2Network(network);
	const normalizedRpcUrl = rpcUrl?.trim();

	if (intent.type === "sui.cetus.farms.stake") {
		const tx = await buildCetusFarmsStakeTransaction({
			network: cetusNetwork,
			rpcUrl: normalizedRpcUrl,
			sender: signerAddress,
			poolId: intent.poolId,
			clmmPositionId: intent.clmmPositionId,
			clmmPoolId: intent.clmmPoolId,
			coinTypeA: intent.coinTypeA,
			coinTypeB: intent.coinTypeB,
		});
		return {
			tx,
			artifacts: {
				cetusNetwork,
				rpcUrl: normalizedRpcUrl ?? null,
				poolId: intent.poolId,
				clmmPositionId: intent.clmmPositionId,
				clmmPoolId: intent.clmmPoolId,
				coinTypeA: intent.coinTypeA,
				coinTypeB: intent.coinTypeB,
			},
		};
	}

	if (intent.type === "sui.cetus.farms.unstake") {
		const tx = await buildCetusFarmsUnstakeTransaction({
			network: cetusNetwork,
			rpcUrl: normalizedRpcUrl,
			sender: signerAddress,
			poolId: intent.poolId,
			positionNftId: intent.positionNftId,
		});
		return {
			tx,
			artifacts: {
				cetusNetwork,
				rpcUrl: normalizedRpcUrl ?? null,
				poolId: intent.poolId,
				positionNftId: intent.positionNftId,
			},
		};
	}

	const tx = await buildCetusFarmsHarvestTransaction({
		network: cetusNetwork,
		rpcUrl: normalizedRpcUrl,
		sender: signerAddress,
		poolId: intent.poolId,
		positionNftId: intent.positionNftId,
	});
	return {
		tx,
		artifacts: {
			cetusNetwork,
			rpcUrl: normalizedRpcUrl ?? null,
			poolId: intent.poolId,
			positionNftId: intent.positionNftId,
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
		| "sui_cetusFarmsStake"
		| "sui_cetusFarmsUnstake"
		| "sui_cetusFarmsHarvest"
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
			waitForLocalExecution: params.waitForLocalExecution,
			confirmMainnet: params.confirmMainnet,
		});
	}
	const tool = resolveExecutionTool("sui_stableLayerClaim");
	return tool.execute("wf-stablelayer-execute", {
		stableCoinType: intent.stableCoinType,
		network,
		waitForLocalExecution: params.waitForLocalExecution,
		confirmMainnet: params.confirmMainnet,
	});
}

async function executeCetusFarmsIntent(
	intent: CetusFarmsWorkflowIntent,
	params: CetusFarmsWorkflowParams,
	network: SuiNetwork,
) {
	if (intent.type === "sui.cetus.farms.stake") {
		const tool = resolveExecutionTool("sui_cetusFarmsStake");
		return tool.execute("wf-cetus-farms-execute", {
			poolId: intent.poolId,
			clmmPositionId: intent.clmmPositionId,
			clmmPoolId: intent.clmmPoolId,
			coinTypeA: intent.coinTypeA,
			coinTypeB: intent.coinTypeB,
			network,
			rpcUrl: params.rpcUrl,
			waitForLocalExecution: params.waitForLocalExecution,
			confirmMainnet: params.confirmMainnet,
		});
	}
	if (intent.type === "sui.cetus.farms.unstake") {
		const tool = resolveExecutionTool("sui_cetusFarmsUnstake");
		return tool.execute("wf-cetus-farms-execute", {
			poolId: intent.poolId,
			positionNftId: intent.positionNftId,
			network,
			rpcUrl: params.rpcUrl,
			waitForLocalExecution: params.waitForLocalExecution,
			confirmMainnet: params.confirmMainnet,
		});
	}
	const tool = resolveExecutionTool("sui_cetusFarmsHarvest");
	return tool.execute("wf-cetus-farms-execute", {
		poolId: intent.poolId,
		positionNftId: intent.positionNftId,
		network,
		rpcUrl: params.rpcUrl,
		waitForLocalExecution: params.waitForLocalExecution,
		confirmMainnet: params.confirmMainnet,
	});
}

function resolveWorkflowTool(
	name:
		| "w3rt_run_sui_workflow_v0"
		| "w3rt_run_sui_stablelayer_workflow_v0"
		| "w3rt_run_sui_cetus_farms_workflow_v0",
): {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{
		content: { type: string; text: string }[];
		details?: unknown;
	}>;
} {
	const tool = createSuiWorkflowTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`Workflow tool not found: ${name}`);
	return tool as unknown as {
		execute(
			toolCallId: string,
			params: Record<string, unknown>,
		): Promise<{
			content: { type: string; text: string }[];
			details?: unknown;
		}>;
	};
}

function resolveDefiWorkflowRoute(
	params: SuiDefiWorkflowParams,
): WorkflowToolRoute {
	const intentType = params.intentType?.trim().toLowerCase();
	if (intentType?.startsWith("sui.stablelayer.")) {
		return "w3rt_run_sui_stablelayer_workflow_v0";
	}
	if (intentType?.startsWith("sui.cetus.farms.")) {
		return "w3rt_run_sui_cetus_farms_workflow_v0";
	}

	if (
		params.stableCoinType?.trim() ||
		params.amountUsdcRaw?.trim() ||
		params.amountStableRaw?.trim() ||
		params.burnAll === true
	) {
		return "w3rt_run_sui_stablelayer_workflow_v0";
	}

	if (
		params.clmmPositionId?.trim() ||
		params.clmmPoolId?.trim() ||
		params.positionNftId?.trim()
	) {
		return "w3rt_run_sui_cetus_farms_workflow_v0";
	}

	const lowerIntentText = params.intentText?.toLowerCase() ?? "";
	if (
		/\bfarm\b|\bstake\b|\bunstake\b|\bharvest\b|农场|挖矿|质押|解质押|收割|收获farm/i.test(
			lowerIntentText,
		)
	) {
		return "w3rt_run_sui_cetus_farms_workflow_v0";
	}
	if (
		/\bstablelayer\b|\bstable layer\b|\bmint\b|\bburn\b|\bclaim\b|稳定币|铸造|赎回|销毁|领取奖励|提取奖励/i.test(
			lowerIntentText,
		)
	) {
		return "w3rt_run_sui_stablelayer_workflow_v0";
	}

	const runMode = parseRunMode(params.runMode);
	const hasRoutingHints = Boolean(
		intentType ||
			params.intentText?.trim() ||
			params.stableCoinType?.trim() ||
			params.amountUsdcRaw?.trim() ||
			params.amountStableRaw?.trim() ||
			params.clmmPositionId?.trim() ||
			params.clmmPoolId?.trim() ||
			params.positionNftId?.trim(),
	);
	if (runMode === "execute" && !hasRoutingHints && latestWorkflowSession) {
		return latestWorkflowSession.route;
	}

	return "w3rt_run_sui_workflow_v0";
}

export function createSuiWorkflowTools(): RegisteredTool[] {
	return [
		defineTool({
			name: "w3rt_run_sui_workflow_v0",
			label: "W3RT Sui Workflow v0",
			description:
				"Deterministic Sui workflow entrypoint: analysis -> simulate -> execute. Signer auto-loads from local Sui keystore or SUI_PRIVATE_KEY.",
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
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as WorkflowParams;
				const runMode = parseRunMode(params.runMode);
				const priorSession =
					runMode === "execute"
						? readWorkflowSession("w3rt_run_sui_workflow_v0", params.runId)
						: null;
				const runId = createRunId(
					params.runId ||
						(runMode === "execute" ? priorSession?.runId : undefined),
				);
				const network = parseSuiNetwork(
					params.network ||
						(runMode === "execute" ? priorSession?.network : undefined),
				);
				const intent =
					runMode === "execute" &&
					!hasCoreIntentInput(params) &&
					priorSession?.intent
						? (priorSession.intent as SuiWorkflowIntent)
						: normalizeIntent(params);
				const needsMainnetConfirmation = network === "mainnet";
				const confirmToken = createConfirmToken(runId, network, intent);
				const hasSessionConfirmation =
					runMode === "execute" &&
					!params.confirmToken &&
					priorSession?.runId === runId &&
					priorSession.network === network &&
					intentsMatch(priorSession.intent, intent);
				const plan = ["analysis", "simulate", "execute"];

				if (runMode === "analysis") {
					rememberWorkflowSession({
						route: "w3rt_run_sui_workflow_v0",
						runId,
						network,
						intent,
					});
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
					const signer = resolveSuiKeypair();
					const sender = signer.toSuiAddress();
					const { tx, artifacts } = await buildSimulation(
						intent,
						network,
						sender,
					);
					tx.setSender(sender);
					const client = getSuiClient(network);
					const unsignedPayload = await exportUnsignedPayload(tx, client);
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
					rememberWorkflowSession({
						route: "w3rt_run_sui_workflow_v0",
						runId,
						network,
						intent,
					});
					return {
						content: [
							{
								type: "text",
								text: formatSimulationSummary({
									intentType: intent.type,
									status,
									signerAddress: sender,
									unsignedPayload,
								}),
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
									signerAddress: sender,
									status,
									error,
									...artifacts,
									...unsignedPayload,
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
					const providedConfirmToken = params.confirmToken?.trim();
					if (
						(!providedConfirmToken || providedConfirmToken !== confirmToken) &&
						!hasSessionConfirmation
					) {
						throw new Error(
							"Invalid confirmToken for mainnet execute. Run simulate first and pass returned confirmToken.",
						);
					}
				}

				const executeResult = await executeIntent(intent, params, network);
				rememberWorkflowSession({
					route: "w3rt_run_sui_workflow_v0",
					runId,
					network,
					intent,
				});
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
				"Deterministic Stable Layer workflow entrypoint: analysis -> simulate -> execute. Signer auto-loads from local Sui keystore or SUI_PRIVATE_KEY.",
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
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as StableLayerWorkflowParams;
				const runMode = parseRunMode(params.runMode);
				const priorSession =
					runMode === "execute"
						? readWorkflowSession(
								"w3rt_run_sui_stablelayer_workflow_v0",
								params.runId,
							)
						: null;
				const runId = createRunId(
					params.runId ||
						(runMode === "execute" ? priorSession?.runId : undefined),
				);
				const network = parseSuiNetwork(
					params.network ||
						(runMode === "execute" ? priorSession?.network : undefined),
				);
				const stableLayerNetwork = resolveStableLayerNetwork(network);
				const intent =
					runMode === "execute" &&
					!hasStableLayerIntentInput(params) &&
					priorSession?.intent
						? (priorSession.intent as StableLayerWorkflowIntent)
						: normalizeStableLayerIntent(params);
				const needsMainnetConfirmation = network === "mainnet";
				const confirmToken = createConfirmToken(runId, network, intent);
				const hasSessionConfirmation =
					runMode === "execute" &&
					!params.confirmToken &&
					priorSession?.runId === runId &&
					priorSession.network === network &&
					intentsMatch(priorSession.intent, intent);
				const plan = ["analysis", "simulate", "execute"];

				if (runMode === "analysis") {
					rememberWorkflowSession({
						route: "w3rt_run_sui_stablelayer_workflow_v0",
						runId,
						network,
						intent,
					});
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
					const signer = resolveSuiKeypair();
					const sender = signer.toSuiAddress();
					const { tx, artifacts } = await buildStableLayerSimulation(
						intent,
						network,
						sender,
					);
					tx.setSender(sender);
					const client = getSuiClient(network);
					const unsignedPayload = await exportUnsignedPayload(tx, client);
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
					rememberWorkflowSession({
						route: "w3rt_run_sui_stablelayer_workflow_v0",
						runId,
						network,
						intent,
					});
					return {
						content: [
							{
								type: "text",
								text: formatSimulationSummary({
									intentType: intent.type,
									status,
									signerAddress: sender,
									unsignedPayload,
								}),
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
									signerAddress: sender,
									status,
									error,
									...artifacts,
									...unsignedPayload,
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
					const providedConfirmToken = params.confirmToken?.trim();
					if (
						(!providedConfirmToken || providedConfirmToken !== confirmToken) &&
						!hasSessionConfirmation
					) {
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
				rememberWorkflowSession({
					route: "w3rt_run_sui_stablelayer_workflow_v0",
					runId,
					network,
					intent,
				});
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
		defineTool({
			name: "w3rt_run_sui_cetus_farms_workflow_v0",
			label: "W3RT Sui Cetus Farms Workflow v0",
			description:
				"Deterministic Cetus farms workflow entrypoint: analysis -> simulate -> execute. Signer auto-loads from local Sui keystore or SUI_PRIVATE_KEY.",
			parameters: Type.Object({
				runId: Type.Optional(Type.String()),
				runMode: workflowRunModeSchema(),
				intentType: Type.Optional(
					Type.Union([
						Type.Literal("sui.cetus.farms.stake"),
						Type.Literal("sui.cetus.farms.unstake"),
						Type.Literal("sui.cetus.farms.harvest"),
					]),
				),
				intentText: Type.Optional(Type.String()),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				poolId: Type.Optional(Type.String()),
				clmmPositionId: Type.Optional(Type.String()),
				clmmPoolId: Type.Optional(Type.String()),
				coinTypeA: Type.Optional(Type.String()),
				coinTypeB: Type.Optional(Type.String()),
				positionNftId: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as CetusFarmsWorkflowParams;
				const runMode = parseRunMode(params.runMode);
				const priorSession =
					runMode === "execute"
						? readWorkflowSession(
								"w3rt_run_sui_cetus_farms_workflow_v0",
								params.runId,
							)
						: null;
				const runId = createRunId(
					params.runId ||
						(runMode === "execute" ? priorSession?.runId : undefined),
				);
				const network = parseSuiNetwork(
					params.network ||
						(runMode === "execute" ? priorSession?.network : undefined),
				);
				const cetusNetwork = resolveCetusV2Network(network);
				const intent =
					runMode === "execute" &&
					!hasCetusFarmsIntentInput(params) &&
					priorSession?.intent
						? (priorSession.intent as CetusFarmsWorkflowIntent)
						: normalizeCetusFarmsIntent(params);
				const needsMainnetConfirmation = network === "mainnet";
				const confirmToken = createConfirmToken(runId, network, intent);
				const hasSessionConfirmation =
					runMode === "execute" &&
					!params.confirmToken &&
					priorSession?.runId === runId &&
					priorSession.network === network &&
					intentsMatch(priorSession.intent, intent);
				const plan = ["analysis", "simulate", "execute"];

				if (runMode === "analysis") {
					rememberWorkflowSession({
						route: "w3rt_run_sui_cetus_farms_workflow_v0",
						runId,
						network,
						intent,
					});
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
							cetusNetwork,
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
					const signer = resolveSuiKeypair();
					const sender = signer.toSuiAddress();
					const { tx, artifacts } = await buildCetusFarmsSimulation(
						intent,
						network,
						sender,
						params.rpcUrl,
					);
					tx.setSender(sender);
					const client = getSuiClient(network, params.rpcUrl);
					const unsignedPayload = await exportUnsignedPayload(tx, client);
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
					rememberWorkflowSession({
						route: "w3rt_run_sui_cetus_farms_workflow_v0",
						runId,
						network,
						intent,
					});
					return {
						content: [
							{
								type: "text",
								text: formatSimulationSummary({
									intentType: intent.type,
									status,
									signerAddress: sender,
									unsignedPayload,
								}),
							},
						],
						details: {
							runId,
							runMode,
							network,
							cetusNetwork,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation,
							confirmToken,
							artifacts: {
								simulate: {
									signerAddress: sender,
									status,
									error,
									...artifacts,
									...unsignedPayload,
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
					const providedConfirmToken = params.confirmToken?.trim();
					if (
						(!providedConfirmToken || providedConfirmToken !== confirmToken) &&
						!hasSessionConfirmation
					) {
						throw new Error(
							"Invalid confirmToken for mainnet execute. Run simulate first and pass returned confirmToken.",
						);
					}
				}

				const executeResult = await executeCetusFarmsIntent(
					intent,
					params,
					network,
				);
				rememberWorkflowSession({
					route: "w3rt_run_sui_cetus_farms_workflow_v0",
					runId,
					network,
					intent,
				});
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
						cetusNetwork,
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
			name: "w3rt_run_sui_defi_workflow_v0",
			label: "W3RT Sui DeFi Workflow v0",
			description:
				"Unified Sui DeFi workflow router. Automatically routes to core/swap-lp, stablelayer, or cetus-farms workflows, with signer auto-loaded from local keystore by default.",
			parameters: Type.Object({
				runId: Type.Optional(Type.String()),
				runMode: workflowRunModeSchema(),
				intentType: Type.Optional(Type.String()),
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
				stableCoinType: Type.Optional(Type.String()),
				amountUsdcRaw: Type.Optional(Type.String()),
				amountStableRaw: Type.Optional(Type.String()),
				burnAll: Type.Optional(Type.Boolean()),
				usdcCoinType: Type.Optional(Type.String()),
				rpcUrl: Type.Optional(Type.String()),
				clmmPositionId: Type.Optional(Type.String()),
				clmmPoolId: Type.Optional(Type.String()),
				positionNftId: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiDefiWorkflowParams;
				const targetWorkflow = resolveDefiWorkflowRoute(params);
				const workflow = resolveWorkflowTool(targetWorkflow);
				const routed = await workflow.execute("wf-sui-defi-route", {
					...(rawParams as Record<string, unknown>),
				});
				const details =
					routed.details && typeof routed.details === "object"
						? {
								...(routed.details as Record<string, unknown>),
								routedWorkflow: targetWorkflow,
							}
						: {
								routedWorkflow: targetWorkflow,
								innerDetails: routed.details ?? null,
							};
				return {
					content: routed.content,
					details,
				};
			},
		}),
	];
}
