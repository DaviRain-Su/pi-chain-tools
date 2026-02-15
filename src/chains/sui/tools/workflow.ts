import { createHash } from "node:crypto";
import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";
import { Transaction } from "@mysten/sui/transactions";
import { Type } from "@sinclair/typebox";
import { type RegisteredTool, defineTool } from "../../../core/types.js";
import { resolveWorkflowRunMode } from "../../shared/workflow-runtime.js";
import {
	buildCetusFarmsHarvestTransaction,
	buildCetusFarmsStakeTransaction,
	buildCetusFarmsUnstakeTransaction,
	formatCetusFarmsPairError,
	findCetusFarmsPoolsByTokenPair,
	resolveCetusTokenTypesBySymbol,
	resolveCetusV2Network,
} from "../cetus-v2.js";
import {
	SUI_COIN_TYPE,
	type SuiNetwork,
	getSuiClient,
	getSuiExplorerTransactionUrl,
	getSuiRpcEndpoint,
	parsePositiveBigInt,
	parseSuiNetwork,
	resolveSuiKeypair,
	resolveSuiOwnerAddress,
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
	positionId?: string;
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
	byAmountIn?: boolean;
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
	confirmMainnet?: boolean;
	confirmToken?: string;
	confirmRisk?: boolean;
};

type WorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	intentType?: SuiWorkflowIntent["type"];
	intentText?: string;
	network?: string;
	fromPrivateKey?: string;
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
	rpcUrl?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	confirmRisk?: boolean;
	waitForLocalExecution?: boolean;
	signedTransactionBytesBase64?: string;
	signedSignatures?: string[];
	signedSignature?: string;
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
	fromPrivateKey?: string;
	stableCoinType?: string;
	amountUsdcRaw?: string;
	amountStableRaw?: string;
	burnAll?: boolean;
	usdcCoinType?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	confirmRisk?: boolean;
	waitForLocalExecution?: boolean;
	signedTransactionBytesBase64?: string;
	signedSignatures?: string[];
	signedSignature?: string;
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
	fromPrivateKey?: string;
	rpcUrl?: string;
	poolId?: string;
	clmmPositionId?: string;
	clmmPoolId?: string;
	coinTypeA?: string;
	coinTypeB?: string;
	positionNftId?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	confirmRisk?: boolean;
	waitForLocalExecution?: boolean;
	signedTransactionBytesBase64?: string;
	signedSignatures?: string[];
	signedSignature?: string;
};

type ParsedCetusFarmsIntentHints = {
	intentType?: CetusFarmsWorkflowIntent["type"];
	poolId?: string;
	clmmPositionId?: string;
	clmmPoolId?: string;
	coinTypeA?: string;
	coinTypeB?: string;
	positionNftId?: string;
	pairSymbolA?: string;
	pairSymbolB?: string;
};

type SuiDefiWorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	intentType?: string;
	intentText?: string;
	network?: string;
	fromPrivateKey?: string;
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
	confirmRisk?: boolean;
	waitForLocalExecution?: boolean;
	signedTransactionBytesBase64?: string;
	signedSignatures?: string[];
	signedSignature?: string;
};

type SuiWorkflowRiskBand = "safe" | "warning" | "critical" | "unknown";

type SuiWorkflowRiskLevel = "low" | "medium" | "high" | "unknown";

type SuiWorkflowRiskCheck = {
	riskBand: SuiWorkflowRiskBand;
	riskLevel: SuiWorkflowRiskLevel;
	riskEngine: "heuristic";
	requiresExplicitRiskAcceptance: boolean;
	confirmRiskAccepted: boolean | null;
	reasonCodes: string[];
	notes: string[];
};

const DEFAULT_SUI_SWAP_RISK_WARNING_SLIPPAGE_BPS = 300;
const DEFAULT_SUI_SWAP_RISK_CRITICAL_SLIPPAGE_BPS = 1000;
const SUI_OBJECT_ID_PATTERN = /^0x[a-fA-F0-9]{1,64}$/;

type WorkflowSimulationSignerContext = {
	sender: string;
	canSign: boolean;
	signerSource: "fromPrivateKey" | "walletAddress";
};

type CetusClmmSdkLike = {
	getPositionList?(
		accountAddress: string,
		assignPoolIds?: string[],
		showDisplay?: boolean,
	): Promise<unknown>;
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

type CetusClmmPositionCandidate = {
	positionId: string;
	poolId: string;
	coinTypeA: string;
	coinTypeB: string;
	coinPairKey: string;
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

function resolveWorkflowSimulationSigner(
	fromPrivateKey?: string,
): WorkflowSimulationSignerContext {
	if (fromPrivateKey?.trim()) {
		const signer = resolveSuiKeypair(fromPrivateKey);
		return {
			sender: signer.toSuiAddress(),
			canSign: true,
			signerSource: "fromPrivateKey",
		};
	}

	const sender = resolveSuiOwnerAddress();
	let canSign = false;
	try {
		const signer = resolveSuiKeypair();
		const signerAddress = normalizeSuiAddressForCompare(signer.toSuiAddress());
		const senderAddress = normalizeSuiAddressForCompare(sender);
		canSign = signerAddress === senderAddress;
		if (!canSign) {
			return {
				sender,
				canSign: false,
				signerSource: "walletAddress",
			};
		}
		canSign = true;
	} catch {
		canSign = false;
	}

	return {
		sender,
		canSign,
		signerSource: canSign ? "fromPrivateKey" : "walletAddress",
	};
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
	simulatedTransaction?: Transaction;
	simulatedSignerAddress?: string;
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
const DEFAULT_CETUS_TICK_LOWER = -443636;
const DEFAULT_CETUS_TICK_UPPER = 443636;

const TOKEN_NAME_PATTERN = "[A-Za-z][A-Za-z0-9_]{1,15}";

function parseTokenPairFromText(text: string): {
	left: string;
	right: string;
} | null {
	const pairPatterns: Array<string> = [
		`\\b(${TOKEN_NAME_PATTERN})\\s*\\/\\s*(${TOKEN_NAME_PATTERN})\\b`,
		`\\b(${TOKEN_NAME_PATTERN})\\s*\\|\\s*(${TOKEN_NAME_PATTERN})\\b`,
		`\\b(${TOKEN_NAME_PATTERN})\\s*[\\-–—]\\s*(${TOKEN_NAME_PATTERN})\\b`,
	];
	for (const pattern of pairPatterns) {
		const pairMatch = text.match(new RegExp(pattern, "i"));
		if (pairMatch?.[1] && pairMatch?.[2]) {
			return { left: pairMatch[1].trim(), right: pairMatch[2].trim() };
		}
	}

	const arrowMatch = text.match(
		new RegExp(
			`\\b(${TOKEN_NAME_PATTERN})\\s*(?:->|=>|→|↔|↔️|to|换|换成|换为|兑|兑换|兑换为|换入|兑换到)\\s*(${TOKEN_NAME_PATTERN})\\b`,
			"i",
		),
	);
	if (arrowMatch?.[1] && arrowMatch?.[2]) {
		return { left: arrowMatch[1].trim(), right: arrowMatch[2].trim() };
	}

	const pairWordMatch = text.match(
		new RegExp(
			`\\b(${TOKEN_NAME_PATTERN})\\s*(?:和|与|对)\\s*(${TOKEN_NAME_PATTERN})(?:\\s*交易对)?\\b`,
			"i",
		),
	);
	if (pairWordMatch?.[1] && pairWordMatch?.[2]) {
		return { left: pairWordMatch[1].trim(), right: pairWordMatch[2].trim() };
	}

	return null;
}

function parseMinOutputNarrativeAmounts(params: {
	text: string;
	sideASymbol?: string;
	sideBSymbol?: string;
}): {
	minAmountA?: string;
	minAmountB?: string;
} {
	const minOutputMatch = params.text.match(
		/(?:最少拿到|至少拿到|最小输出|最低输出|至少有|不少于|至少回收|最少回收|最少领取|至少领取|最低领取)([^。！？!?;；,，]*)/i,
	);
	if (!minOutputMatch) return {};

	const section = minOutputMatch[1] ?? "";
	const sideA = params.sideASymbol?.trim().toUpperCase();
	const sideB = params.sideBSymbol?.trim().toUpperCase();
	if (!sideA && !sideB) return {};

	const result: { minAmountA?: string; minAmountB?: string } = {};
	const symbolMatchedAmounts: string[] = [];
	const symbolAmountMatches = [
		...section.matchAll(/(\d+(?:\.\d+)?)\s*([A-Za-z][A-Za-z0-9_]{1,15})/g),
	];
	for (const match of symbolAmountMatches) {
		const amount = match[1];
		const symbol = match[2]?.trim().toUpperCase();
		if (!amount || !symbol) continue;
		if (sideA && symbol === sideA && !result.minAmountA) {
			result.minAmountA = amount;
			continue;
		}
		if (sideB && symbol === sideB && !result.minAmountB) {
			result.minAmountB = amount;
			continue;
		}
		symbolMatchedAmounts.push(amount);
	}

	const plainAmounts = [...section.matchAll(/(\d+(?:\.\d+)?)/g)].map(
		(match) => match[1],
	);
	const symbolAmountValues = symbolAmountMatches.map((match) => match[1]);
	const bareAmounts = plainAmounts.filter(
		(amount) => !symbolAmountValues.includes(amount),
	);
	const unassignedAmounts = [...symbolMatchedAmounts, ...bareAmounts];
	const remaining = unassignedAmounts.filter(
		(amount) => amount !== result.minAmountA && amount !== result.minAmountB,
	);
	if (!result.minAmountA && remaining[0]) {
		result.minAmountA = remaining[0];
	}
	if (!result.minAmountB && remaining[1]) {
		result.minAmountB = remaining[1];
	}

	return {
		minAmountA: result.minAmountA,
		minAmountB: result.minAmountB,
	};
}

function normalizePairSymbolHints(params: {
	coinTypeA?: string;
	coinTypeB?: string;
}): [string | undefined, string | undefined] {
	return [
		params.coinTypeA?.trim().toUpperCase() || undefined,
		params.coinTypeB?.trim().toUpperCase() || undefined,
	];
}

function formatCetusPoolCandidates(
	candidates: Array<{
		poolId: string;
		clmmPoolId: string;
		pairSymbol: string;
	}>,
): string {
	return candidates
		.map(
			(entry, index) =>
				`${index + 1}) ${entry.pairSymbol} poolId=${entry.poolId}`,
		)
		.join("; ");
}

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

function resolveKnownSuiTokenByCoinType(
	coinType: string,
): KnownSuiToken | undefined {
	return KNOWN_SUI_TOKEN_BY_COIN_TYPE.get(coinType.trim());
}

function parseUiOrRawAmount(
	amountText: string | undefined,
): "raw" | "ui" | undefined {
	if (!amountText) return undefined;
	const normalized = amountText.trim();
	if (!normalized) return undefined;
	if (/^\d+$/.test(normalized)) return "raw";
	if (/^\d+\.\d+$/.test(normalized)) return "ui";
	return undefined;
}

const LP_AMOUNT_DECIMALS_BY_COIN_CACHE = new Map<string, number | null>();

async function resolveCetusLPPoolTokenDecimals(
	network: SuiNetwork,
	rpcUrl: string | undefined,
	coinType: string,
): Promise<number | undefined> {
	const known = resolveKnownSuiTokenByCoinType(coinType);
	if (known) return known.decimals;

	const cacheKey = `${network}:${coinType}`;
	const cached = LP_AMOUNT_DECIMALS_BY_COIN_CACHE.get(cacheKey);
	if (cached !== undefined) return cached || undefined;

	const client = getSuiClient(network, rpcUrl);
	try {
		const metadata = await client.getCoinMetadata({
			coinType,
		});
		if (metadata?.decimals == null) {
			LP_AMOUNT_DECIMALS_BY_COIN_CACHE.set(cacheKey, null);
			return undefined;
		}
		const decimals = Number(metadata.decimals);
		if (!Number.isSafeInteger(decimals) || decimals < 0) {
			LP_AMOUNT_DECIMALS_BY_COIN_CACHE.set(cacheKey, null);
			return undefined;
		}
		LP_AMOUNT_DECIMALS_BY_COIN_CACHE.set(cacheKey, decimals);
		return decimals;
	} catch {
		LP_AMOUNT_DECIMALS_BY_COIN_CACHE.set(cacheKey, null);
		return undefined;
	}
}

async function normalizeLpAmountToRaw(params: {
	amount: string | undefined;
	coinType: string | undefined;
	network: SuiNetwork;
	rpcUrl: string | undefined;
	fieldName: string;
}): Promise<string | undefined> {
	if (!params.amount) return undefined;
	const mode = parseUiOrRawAmount(params.amount);
	if (!mode) {
		throw new Error(
			`${params.fieldName} must be a positive integer string or decimal string`,
		);
	}
	if (!params.coinType) return params.amount.trim();

	if (mode === "raw") {
		return params.amount.trim();
	}

	const decimals = await resolveCetusLPPoolTokenDecimals(
		params.network,
		params.rpcUrl,
		params.coinType,
	);
	if (decimals == null) {
		throw new Error(
			`${params.fieldName} uses decimal notation but decimals for ${params.coinType} are unknown. Provide integer raw amount instead.`,
		);
	}
	return decimalUiAmountToRaw(params.amount.trim(), decimals, params.fieldName);
}

function isStructTag(value: string): boolean {
	return /^0x[a-fA-F0-9]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+$/.test(
		value.trim(),
	);
}

async function resolveCoinTypeBySymbol(params: {
	network: SuiNetwork;
	rpcUrl?: string;
	value?: string;
}): Promise<string | undefined> {
	const raw = params.value?.trim();
	if (!raw) return undefined;
	if (isStructTag(raw)) return raw;
	const known = resolveKnownSuiToken(raw);
	if (known) return known.coinType;

	try {
		const matches = await resolveCetusTokenTypesBySymbol({
			network: resolveCetusV2Network(params.network),
			rpcUrl: params.rpcUrl,
			symbol: raw,
		});
		if (matches.length === 1) return matches[0];
	} catch {
		// ignore and fail with undefined
	}
	return undefined;
}

async function resolveCoinTypeFromHint(
	value: string | undefined,
	network: SuiNetwork,
	rpcUrl?: string,
): Promise<string | undefined> {
	return resolveCoinTypeBySymbol({ network, rpcUrl, value });
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
	outputCoinType?: string;
	minOutputMode?: boolean;
	fallbackAmountRaw?: string;
}): string | undefined {
	const explicitRaw =
		params.text.match(/\bamountRaw\s*[=:]\s*([0-9]+)\b/i)?.[1] ??
		params.text.match(/\b([0-9]+)\s*raw\b/i)?.[1];
	if (explicitRaw) return explicitRaw;

	const minOutputMatch = params.text.match(
		/(?:至少拿到|最少拿到|最小输出|最低输出|至少.*拿到|at\s*least|min(?:imum)?(?:\s*output)|min\s*out)\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z][A-Za-z0-9_]{1,15})?/i,
	);
	if (minOutputMatch?.[1]) {
		const amountUi = minOutputMatch[1];
		const symbol = minOutputMatch[2];
		if (symbol) {
			const token = resolveKnownSuiToken(symbol);
			if (!token) {
				throw new Error(
					`swap amount uses token ${symbol} but token decimals unknown. Please specify amountRaw or use a supported symbol.`,
				);
			}
			return decimalUiAmountToRaw(amountUi, token.decimals, "amountUi");
		}
		if (params.outputCoinType) {
			const outputToken =
				resolveKnownSuiTokenByCoinType(params.outputCoinType) ??
				resolveKnownSuiToken(params.outputCoinType);
			if (outputToken) {
				return decimalUiAmountToRaw(amountUi, outputToken.decimals, "amountUi");
			}
		}
		if (params.minOutputMode) {
			throw new Error(
				"swap minimum-output amount requires a known output token (for decimals) or amountRaw.",
			);
		}
	}

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

function extractConfirmTokenFromText(text?: string): string | undefined {
	if (!text?.trim()) return undefined;
	const explicit =
		text.match(/\bconfirmToken\s*[:= ]\s*(SUI-[A-Za-z0-9]+)\b/i)?.[1] ??
		text.match(/\b(SUI-[A-Za-z0-9]{8,})\b/i)?.[1];
	return explicit?.trim();
}

function hasConfirmMainnetPhrase(text?: string): boolean {
	if (!text?.trim()) return false;
	const lower = text.toLowerCase();
	return (
		lower.includes("确认主网执行") ||
		lower.includes("确认主网") ||
		lower.includes("confirm mainnet") ||
		lower.includes("confirmmainnet=true") ||
		lower.includes("confirmmainnet true")
	);
}

function hasConfirmRiskPhrase(text?: string): boolean {
	if (!text?.trim()) return false;
	const lower = text.toLowerCase();
	return (
		lower.includes("确认风险执行") ||
		lower.includes("确认风险") ||
		lower.includes("确认高风险执行") ||
		lower.includes("确认风险继续执行") ||
		lower.includes("接受风险执行") ||
		lower.includes("接受高风险执行") ||
		lower.includes("我接受风险") ||
		lower.includes("我已知晓风险") ||
		lower.includes("风险已知晓") ||
		lower.includes("高风险也执行") ||
		lower.includes("强制执行") ||
		lower.includes("accept risk") ||
		lower.includes("accept the risk") ||
		lower.includes("i accept risk") ||
		lower.includes("risk accepted") ||
		lower.includes("confirm risk") ||
		lower.includes("confirm risk execute") ||
		lower.includes("proceed with risk") ||
		lower.includes("force execute") ||
		lower.includes("force execution") ||
		lower.includes("confirmrisk=true") ||
		lower.includes("confirmrisk true")
	);
}

function resolveSuiRiskLevelFromBand(
	riskBand: SuiWorkflowRiskBand,
): SuiWorkflowRiskLevel {
	if (riskBand === "critical") return "high";
	if (riskBand === "warning") return "medium";
	if (riskBand === "safe") return "low";
	return "unknown";
}

function parseNonNegativeBigInt(value: string): bigint | null {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) return null;
	return BigInt(normalized);
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") return null;
	return value as Record<string, unknown>;
}

function extractObjectIdFromUnknown(
	value: unknown,
	maxDepth = 4,
): string | undefined {
	if (maxDepth < 0) return undefined;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (SUI_OBJECT_ID_PATTERN.test(trimmed)) return trimmed;
		return undefined;
	}
	const record = asObjectRecord(value);
	if (!record) return undefined;

	const directKeys = ["id", "objectId", "object_id"];
	for (const key of directKeys) {
		const candidate = record[key];
		if (
			typeof candidate === "string" &&
			SUI_OBJECT_ID_PATTERN.test(candidate)
		) {
			return candidate;
		}
	}
	for (const key of directKeys) {
		const nested = extractObjectIdFromUnknown(record[key], maxDepth - 1);
		if (nested) return nested;
	}
	const fieldsNested = extractObjectIdFromUnknown(record.fields, maxDepth - 1);
	if (fieldsNested) return fieldsNested;
	return undefined;
}

function extractPoolIdFromSuiObjectResponse(
	response: unknown,
): string | undefined {
	const root = asObjectRecord(response);
	if (!root) return undefined;
	const data = asObjectRecord(root.data);
	const content = asObjectRecord(data?.content);
	const fields = asObjectRecord(content?.fields);
	if (!fields) return undefined;

	const candidateKeys = [
		"pool",
		"pool_id",
		"poolId",
		"clmm_pool_id",
		"clmmPoolId",
		"clmm_pool",
		"clmmPool",
	];
	for (const key of candidateKeys) {
		const candidate = extractObjectIdFromUnknown(fields[key], 5);
		if (candidate) return candidate;
	}
	return undefined;
}

async function resolvePoolIdByPositionId(
	network: SuiNetwork,
	positionId: string,
): Promise<string | undefined> {
	const client = getSuiClient(network) as {
		getObject?: (params: {
			id: string;
			options?: { showContent?: boolean };
		}) => Promise<unknown>;
	};
	if (typeof client.getObject !== "function") return undefined;

	try {
		const objectData = await client.getObject({
			id: positionId,
			options: { showContent: true },
		});
		return extractPoolIdFromSuiObjectResponse(objectData);
	} catch {
		return undefined;
	}
}

function normalizePositionAddress(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeCoinPairTypes(
	coinTypeA: string,
	coinTypeB: string,
): [string, string] {
	return [
		normalizePositionAddress(coinTypeA),
		normalizePositionAddress(coinTypeB),
	];
}

function normalizePositionCandidateCoinType(
	value: unknown,
): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed;
}

function normalizePositionCandidatePoolId(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!SUI_OBJECT_ID_PATTERN.test(trimmed)) return undefined;
	return trimmed;
}

function normalizePairKey(coinTypeA: string, coinTypeB: string): string {
	const [lower, upper] = normalizeCoinPairTypes(coinTypeA, coinTypeB);
	return `${lower}|${upper}`;
}

function extractCetusPositionCandidates(
	value: unknown,
): CetusClmmPositionCandidate[] {
	const items = (() => {
		if (Array.isArray(value)) return value;
		if (
			value &&
			typeof value === "object" &&
			Array.isArray((value as { data?: unknown }).data)
		) {
			return (value as { data: unknown[] }).data;
		}
		return [];
	})();

	const candidates: CetusClmmPositionCandidate[] = [];
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const record = item as Record<string, unknown>;
		const positionId = normalizePositionCandidatePoolId(
			record.position_id ??
				record.pos_object_id ??
				record.positionId ??
				record.id,
		);
		const poolId = normalizePositionCandidatePoolId(
			record.pool_id ?? record.clmm_pool_id ?? record.pool ?? record.poolId,
		);
		const coinTypeA = normalizePositionCandidateCoinType(
			record.coin_type_a ?? record.coinTypeA,
		);
		const coinTypeB = normalizePositionCandidateCoinType(
			record.coin_type_b ?? record.coinTypeB,
		);
		if (!positionId || !poolId || !coinTypeA || !coinTypeB) continue;
		candidates.push({
			positionId,
			poolId,
			coinTypeA,
			coinTypeB,
			coinPairKey: normalizePairKey(coinTypeA, coinTypeB),
		});
	}

	return candidates;
}

function formatCandidateListForError(
	candidates: CetusClmmPositionCandidate[],
): string {
	return candidates
		.map((candidate, index) => {
			const tag = `${index + 1}) position=${candidate.positionId} pool=${candidate.poolId}`;
			return tag;
		})
		.slice(0, 6)
		.join("; ");
}

async function resolveLpClmmPoolByPair(params: {
	network: SuiNetwork;
	coinTypeA: string;
	coinTypeB: string;
	rpcUrl?: string;
}): Promise<string | undefined> {
	const { network, coinTypeA, coinTypeB, rpcUrl } = params;
	const poolCandidates = await findCetusFarmsPoolsByTokenPair({
		network: resolveCetusV2Network(network),
		rpcUrl,
		coinTypeA,
		coinTypeB,
	});

	if (poolCandidates.length === 1) {
		return poolCandidates[0].clmmPoolId || poolCandidates[0].poolId;
	}
	if (poolCandidates.length > 1) {
		const formattedCandidates = poolCandidates.map((candidate) => ({
			poolId: candidate.clmmPoolId || candidate.poolId,
			pairSymbol: candidate.pairSymbol,
		}));
		throw new Error(
			formatCetusFarmsPairError({
				coinTypeA,
				coinTypeB,
				pools: formattedCandidates,
			}),
		);
	}
	return undefined;
}

async function resolveLpPositionByPair(params: {
	network: SuiNetwork;
	coinTypeA?: string;
	coinTypeB?: string;
	poolId?: string;
	owner?: string;
}): Promise<CetusClmmPositionCandidate[]> {
	if (!params.coinTypeA || !params.coinTypeB) return [];

	const targetOwner = params.owner?.trim();
	if (!targetOwner) {
		return [];
	}

	const initCetusSDK = await getInitCetusSDK();
	const sdk = initCetusSDK({
		network: resolveCetusNetwork(params.network),
		fullNodeUrl: getSuiRpcEndpoint(params.network),
		wallet: targetOwner,
	});

	if (typeof sdk.getPositionList !== "function") {
		return [];
	}

	const [coinLower, coinUpper] = normalizeCoinPairTypes(
		params.coinTypeA,
		params.coinTypeB,
	);
	const targetPairKey = `${coinLower}|${coinUpper}`;
	const reversePairKey = `${coinUpper}|${coinLower}`;
	const normalizedPoolId = params.poolId?.trim();
	const poolIds = normalizedPoolId ? [normalizedPoolId] : undefined;
	const raw = await sdk.getPositionList(targetOwner, poolIds);
	const candidates = extractCetusPositionCandidates(raw);
	const byPoolId = poolIds
		? candidates.filter(
				(candidate) =>
					normalizePositionAddress(candidate.poolId) ===
					normalizePositionAddress(poolIds[0] as string),
			)
		: candidates;

	return byPoolId.filter((candidate) => {
		const candidatePairKey = candidate.coinPairKey;
		return (
			candidatePairKey === targetPairKey || candidatePairKey === reversePairKey
		);
	});
}

function derivePoolAndPositionIds(params: {
	objectIdMatches: string[];
	poolLabelMatch: RegExpMatchArray | null;
	positionLabelMatch: RegExpMatchArray | null;
}): {
	poolId: string | undefined;
	positionId: string | undefined;
} {
	const explicitPoolId = params.poolLabelMatch?.[1];
	const explicitPositionId = params.positionLabelMatch?.[1];
	let poolId = explicitPoolId;
	let positionId = explicitPositionId;

	for (const candidate of params.objectIdMatches) {
		if (!poolId && candidate !== positionId) {
			poolId = candidate;
			continue;
		}
		if (!positionId && candidate !== poolId) {
			positionId = candidate;
		}
	}

	if (!explicitPoolId && poolId && positionId && poolId === positionId) {
		poolId = undefined;
	}

	return { poolId, positionId };
}

function buildSuiRiskReadableHint(risk: SuiWorkflowRiskCheck): string | null {
	if (risk.riskBand === "safe") return null;
	const label =
		risk.riskBand === "critical"
			? "高风险"
			: risk.riskBand === "warning"
				? "中风险"
				: "未知风险";
	const reasons =
		risk.notes.length > 0 ? `原因：${risk.notes.join("；")}。` : "";
	const confirmText =
		risk.confirmRiskAccepted === true
			? "已确认风险执行。"
			: risk.confirmRiskAccepted === false
				? "未确认风险执行。"
				: "";
	return `风险提示：${label}（${risk.riskBand}）。${reasons}${confirmText}`.trim();
}

function assessSuiIntentRisk(
	intent: SuiWorkflowIntent,
	confirmRiskAccepted: boolean | null,
): SuiWorkflowRiskCheck {
	const reasonCodes: string[] = [];
	const notes: string[] = [];
	let riskBand: SuiWorkflowRiskBand = "safe";

	if (intent.type === "sui.swap.cetus") {
		const slippageBps = intent.slippageBps;
		if (slippageBps >= DEFAULT_SUI_SWAP_RISK_CRITICAL_SLIPPAGE_BPS) {
			riskBand = "critical";
			reasonCodes.push("swap_high_slippage_critical");
			notes.push(
				`swap slippage=${slippageBps}bps (>=${DEFAULT_SUI_SWAP_RISK_CRITICAL_SLIPPAGE_BPS}bps)`,
			);
		} else if (slippageBps >= DEFAULT_SUI_SWAP_RISK_WARNING_SLIPPAGE_BPS) {
			riskBand = "warning";
			reasonCodes.push("swap_high_slippage_warning");
			notes.push(
				`swap slippage=${slippageBps}bps (>=${DEFAULT_SUI_SWAP_RISK_WARNING_SLIPPAGE_BPS}bps)`,
			);
		}
	}

	if (intent.type === "sui.lp.cetus.add") {
		const slippageBps = intent.slippageBps;
		if (slippageBps >= DEFAULT_SUI_SWAP_RISK_CRITICAL_SLIPPAGE_BPS) {
			riskBand = "critical";
			reasonCodes.push("lp_add_high_slippage_critical");
			notes.push(
				`LP add slippage=${slippageBps}bps (>=${DEFAULT_SUI_SWAP_RISK_CRITICAL_SLIPPAGE_BPS}bps)`,
			);
		} else if (slippageBps >= DEFAULT_SUI_SWAP_RISK_WARNING_SLIPPAGE_BPS) {
			riskBand = "warning";
			reasonCodes.push("lp_add_high_slippage_warning");
			notes.push(
				`LP add slippage=${slippageBps}bps (>=${DEFAULT_SUI_SWAP_RISK_WARNING_SLIPPAGE_BPS}bps)`,
			);
		}
	}

	if (intent.type === "sui.lp.cetus.remove") {
		const minAmountA = parseNonNegativeBigInt(intent.minAmountA);
		const minAmountB = parseNonNegativeBigInt(intent.minAmountB);
		if (minAmountA === 0n && minAmountB === 0n) {
			if (riskBand === "safe") riskBand = "warning";
			reasonCodes.push("lp_remove_zero_min_amounts");
			notes.push(
				"LP remove minAmountA/minAmountB are both 0 (no min output guard)",
			);
		}
	}

	return {
		riskBand,
		riskLevel: resolveSuiRiskLevelFromBand(riskBand),
		riskEngine: "heuristic",
		requiresExplicitRiskAcceptance:
			riskBand === "warning" || riskBand === "critical",
		confirmRiskAccepted,
		reasonCodes,
		notes,
	};
}

function parseIntentText(text?: string): ParsedIntentHints {
	if (!text?.trim()) return {};
	const lower = text.toLowerCase();
	const objectIdMatches = [...text.matchAll(/0x[a-fA-F0-9]{1,64}(?!::)/g)].map(
		(entry) => entry[0],
	);
	const pair = parseTokenPairFromText(text);
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
	const poolAndPositionIds = derivePoolAndPositionIds({
		objectIdMatches,
		poolLabelMatch,
		positionLabelMatch,
	});
	const tickRangeMatch =
		text.match(
			/(?:tick|ticks|范围)\s*[:= ]?\s*(-?\d+)\s*(?:to|~|-)\s*(-?\d+)/i,
		) ?? null;
	const amountAMatch =
		text.match(
			/(?:amountA|tokenA|a金额|a_amount|amount a|a amount|币A|代币A)\s*[:= ]\s*(\d+(?:\.\d+)?)/i,
		) ??
		text.match(/\ba\s*[:= ]\s*(\d+(?:\.\d+)?)\b/i) ??
		null;
	const amountBMatch =
		text.match(
			/(?:amountB|tokenB|b金额|b_amount|amount b|b amount|币B|代币B)\s*[:= ]\s*(\d+(?:\.\d+)?)/i,
		) ??
		text.match(/\bb\s*[:= ]\s*(\d+(?:\.\d+)?)\b/i) ??
		null;
	const deltaLiquidityMatch =
		text.match(
			/(?:deltaLiquidity|delta_liquidity|liquidityDelta|移除流动性|减少流动性|liquidity)\s*[:= ]\s*(\d+)/i,
		) ?? null;
	const minAmountAMatch =
		text.match(
			/(?:minAmountA|min_a|minA|min a|min amount A|a min|最小A|最少A|至少A)\s*[:= ]\s*(\d+(?:\.\d+)?)/i,
		) ?? null;
	const minAmountBMatch =
		text.match(
			/(?:minAmountB|min_b|minB|min b|min amount B|b min|最小B|最少B|至少B)\s*[:= ]\s*(\d+(?:\.\d+)?)/i,
		) ?? null;
	const minOutputNarrative = parseMinOutputNarrativeAmounts({
		sideASymbol: pair?.left,
		sideBSymbol: pair?.right,
		text,
	});
	const controlHints: Pick<
		ParsedIntentHints,
		"confirmMainnet" | "confirmToken" | "confirmRisk"
	> = {
		confirmMainnet: hasConfirmMainnetPhrase(text) ? true : undefined,
		confirmToken: extractConfirmTokenFromText(text),
		confirmRisk: hasConfirmRiskPhrase(text) ? true : undefined,
	};

	if (
		/(add liquidity|provide liquidity|open position|increase liquidity|增加流动性|添加流动性|加流动性|加池|做市|开仓|加仓|\blp\b|\bLP\b)/i.test(
			lower,
		)
	) {
		const [pairA, pairB] = pair
			? normalizePairSymbolHints({
					coinTypeA: pair.left,
					coinTypeB: pair.right,
				})
			: [undefined, undefined];
		return {
			...controlHints,
			intentType: "sui.lp.cetus.add",
			poolId: poolAndPositionIds.poolId,
			positionId: poolAndPositionIds.positionId,
			coinTypeA: pairA || coinTypeCandidates[0],
			coinTypeB: pairB || coinTypeCandidates[1],
			tickLower: parseInteger(tickRangeMatch?.[1]),
			tickUpper: parseInteger(tickRangeMatch?.[2]),
			amountA: amountAMatch?.[1],
			amountB: amountBMatch?.[1],
		};
	}

	if (
		/(remove liquidity|withdraw liquidity|close position|decrease liquidity|移除流动性|减少流动性|撤池|减池|平仓|撤流动性|减仓|\brm liquidity\b|\brm lp\b|\blp remove\b|\blp withdraw\b|\b取消流动性\b|移除lp)/i.test(
			lower,
		)
	) {
		const [pairA, pairB] = pair
			? normalizePairSymbolHints({
					coinTypeA: pair.left,
					coinTypeB: pair.right,
				})
			: [undefined, undefined];
		return {
			...controlHints,
			intentType: "sui.lp.cetus.remove",
			poolId: poolAndPositionIds.poolId,
			positionId: poolAndPositionIds.positionId,
			coinTypeA: pairA || coinTypeCandidates[0],
			coinTypeB: pairB || coinTypeCandidates[1],
			deltaLiquidity: deltaLiquidityMatch?.[1] || integerMatch?.[0],
			minAmountA: minAmountAMatch?.[1] || minOutputNarrative.minAmountA,
			minAmountB: minAmountBMatch?.[1] || minOutputNarrative.minAmountB,
		};
	}

	if (
		/(swap|兑换|换币|交易对|换成|换为|兑换成|->|=>|→|↔|↔️| to | to$|^to\s)/i.test(
			lower,
		)
	) {
		const inputCoinType = coinTypeCandidates[0];
		const outputCoinType = coinTypeCandidates[1];
		const [resolvedInput, resolvedOutput] = pair
			? normalizePairSymbolHints({
					coinTypeA: pair.left,
					coinTypeB: pair.right,
				})
			: [undefined, undefined];
		const resolvedInputType = resolveKnownSuiToken(
			resolvedInput || inputCoinType || "",
		)?.coinType;
		const resolvedOutputType = resolveKnownSuiToken(
			resolvedOutput || outputCoinType || "",
		)?.coinType;
		const swapMinOutputMode =
			/(?:至少拿到|最少拿到|最小输出|最低输出|至少.*拿到|at\s*least|min(?:imum)?(?:\s*output)|min\s*out)/i.test(
				text,
			);
		const inputForAmount = resolvedInputType || resolvedInput || inputCoinType;
		const outputForAmount =
			resolvedOutputType || resolvedOutput || outputCoinType;
		return {
			...controlHints,
			intentType: "sui.swap.cetus",
			inputCoinType: resolvedInput || inputCoinType,
			outputCoinType: resolvedOutput || outputCoinType,
			byAmountIn: swapMinOutputMode ? false : undefined,
			amountRaw: parseSwapAmountRawFromText({
				text,
				inputCoinType: inputForAmount,
				outputCoinType: outputForAmount,
				minOutputMode: swapMinOutputMode,
				fallbackAmountRaw: integerMatch?.[0],
			}),
		};
	}

	if (/(transfer|send|转账|发送|转给|转)/i.test(lower)) {
		if (suiAmountMatch) {
			return {
				...controlHints,
				intentType: "sui.transfer.sui",
				toAddress: objectIdMatches[0],
				amountSui: Number(suiAmountMatch[1]),
			};
		}
		return {
			...controlHints,
			intentType: "sui.transfer.coin",
			toAddress: objectIdMatches[0],
			coinType: coinTypeCandidates[0],
			amountRaw: integerMatch?.[0],
		};
	}

	return controlHints;
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
	const pair = parseTokenPairFromText(text);
	const [pairByTextA, pairByTextB] = pair
		? normalizePairSymbolHints({
				coinTypeA: pair.left,
				coinTypeB: pair.right,
			})
		: [undefined, undefined];
	const coinTypeCandidates = collectCoinTypeCandidates(text);

	const poolLabelMatch =
		text.match(
			/(?:\bfarm pool\b|\bfarms pool\b|\bpoolId\b|\bfarm\b|\b池子\b|\bpool\b)\s*[:= ]\s*(0x[a-fA-F0-9]{1,64})/i,
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
		const poolIdFallback =
			poolLabelMatch?.[1] ||
			(!clmmPoolLabelMatch ? objectIdMatches[0] : undefined);
		return {
			intentType: "sui.cetus.farms.stake",
			poolId: poolIdFallback,
			clmmPositionId: clmmPositionLabelMatch?.[1] || objectIdMatches[1],
			clmmPoolId: clmmPoolLabelMatch?.[1] || objectIdMatches[2],
			coinTypeA: pairByTextA || coinTypeCandidates[0],
			coinTypeB: pairByTextB || coinTypeCandidates[1],
			pairSymbolA: pair?.left,
			pairSymbolB: pair?.right,
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

async function normalizeCetusFarmsIntent(
	params: CetusFarmsWorkflowParams,
): Promise<CetusFarmsWorkflowIntent> {
	const parsed = parseCetusFarmsIntentText(params.intentText);
	const intentType = inferCetusFarmsIntentType(params, parsed);
	let poolId = params.poolId?.trim() || parsed.poolId;

	const resolvedPair = normalizePairSymbolHints({
		coinTypeA: parsed.pairSymbolA || params.coinTypeA,
		coinTypeB: parsed.pairSymbolB || params.coinTypeB,
	});
	const parsedNetwork = parseSuiNetwork(params.network);
	const resolvedCoinTypeA = await resolveCoinTypeFromHint(
		params.coinTypeA || parsed.coinTypeA || resolvedPair[0],
		parsedNetwork,
		params.rpcUrl,
	);
	const resolvedCoinTypeB = await resolveCoinTypeFromHint(
		params.coinTypeB || parsed.coinTypeB || resolvedPair[1],
		parsedNetwork,
		params.rpcUrl,
	);

	if (!poolId && intentType === "sui.cetus.farms.stake") {
		if (resolvedCoinTypeA && resolvedCoinTypeB) {
			const poolCandidates = await findCetusFarmsPoolsByTokenPair({
				network: resolveCetusV2Network(parseSuiNetwork(params.network)),
				rpcUrl: params.rpcUrl?.trim(),
				coinTypeA: resolvedCoinTypeA,
				coinTypeB: resolvedCoinTypeB,
			});
			if (poolCandidates.length === 1) {
				poolId = poolCandidates[0].poolId;
			} else if (poolCandidates.length > 1) {
				throw new Error(
					`Multiple farms pools found for ${resolvedCoinTypeA}/${resolvedCoinTypeB}. ${formatCetusPoolCandidates(
						poolCandidates,
					)} Please provide poolId.`,
				);
			}
		}
	}
	if (!poolId) {
		throw new Error("poolId is required for Cetus farms workflow.");
	}

	if (intentType === "sui.cetus.farms.stake") {
		const clmmPositionId =
			params.clmmPositionId?.trim() || parsed.clmmPositionId;
		const clmmPoolId = params.clmmPoolId?.trim() || parsed.clmmPoolId;
		const coinTypeA = resolvedCoinTypeA;
		const coinTypeB = resolvedCoinTypeB;
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
		params.amountA &&
		params.amountB &&
		params.coinTypeA &&
		params.coinTypeB
	) {
		return "sui.lp.cetus.add";
	}
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

async function normalizeIntent(
	params: WorkflowParams,
	network: SuiNetwork,
): Promise<SuiWorkflowIntent> {
	const parsed = parseIntentText(params.intentText);
	const parsedNetwork = parseSuiNetwork(network);
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
		const coinType = await resolveCoinTypeFromHint(
			params.coinType || parsed.coinType,
			parsedNetwork,
		);
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
		let poolId = params.poolId?.trim() || parsed.poolId;
		let positionId = params.positionId?.trim() || parsed.positionId;
		const coinTypeA = await resolveCoinTypeFromHint(
			params.coinTypeA || parsed.coinTypeA,
			parsedNetwork,
		);
		const coinTypeB = await resolveCoinTypeFromHint(
			params.coinTypeB || parsed.coinTypeB,
			parsedNetwork,
		);
		let tickLower = params.tickLower ?? parsed.tickLower;
		let tickUpper = params.tickUpper ?? parsed.tickUpper;
		tickLower = tickLower ?? DEFAULT_CETUS_TICK_LOWER;
		tickUpper = tickUpper ?? DEFAULT_CETUS_TICK_UPPER;
		const rpcUrl = params.rpcUrl;
		const [amountARaw, amountBRaw] = await Promise.all([
			normalizeLpAmountToRaw({
				amount: params.amountA?.trim() || parsed.amountA,
				coinType: coinTypeA,
				network: parsedNetwork,
				rpcUrl,
				fieldName: "amountA",
			}),
			normalizeLpAmountToRaw({
				amount: params.amountB?.trim() || parsed.amountB,
				coinType: coinTypeB,
				network: parsedNetwork,
				rpcUrl,
				fieldName: "amountB",
			}),
		]);
		if (!poolId && positionId) {
			poolId = await resolvePoolIdByPositionId(network, positionId);
		}
		if (!positionId && coinTypeA && coinTypeB) {
			let owner: string;
			try {
				owner = resolveSuiOwnerAddress();
			} catch {
				owner = "";
			}
			const candidates = await resolveLpPositionByPair({
				network,
				coinTypeA,
				coinTypeB,
				poolId,
				owner,
			});
			if (candidates.length === 1) {
				positionId = candidates[0].positionId;
				if (!poolId) {
					poolId = candidates[0].poolId;
				}
			} else if (candidates.length > 1) {
				const candidateList = formatCandidateListForError(candidates);
				throw new Error(
					`Multiple LP positions found for ${coinTypeA}/${coinTypeB} in owner wallet. Please provide positionId. candidates=${candidateList}`,
				);
			}
		}
		if (!poolId && coinTypeA && coinTypeB) {
			const resolvedPoolId = await resolveLpClmmPoolByPair({
				network,
				rpcUrl,
				coinTypeA,
				coinTypeB,
			});
			if (resolvedPoolId) {
				poolId = resolvedPoolId;
			}
		}
		if (!poolId) {
			throw new Error(
				positionId
					? "poolId is required for sui.lp.cetus.add and could not be auto-resolved from positionId. Tip: provide poolId explicitly or verify positionId belongs to a Cetus position object."
					: "poolId is required for sui.lp.cetus.add. Tip: provide poolId to create a new LP position.",
			);
		}
		if (!coinTypeA)
			throw new Error("coinTypeA is required for sui.lp.cetus.add");
		if (!coinTypeB)
			throw new Error("coinTypeB is required for sui.lp.cetus.add");
		if (!amountARaw || !amountBRaw) {
			throw new Error("amountA and amountB are required for sui.lp.cetus.add");
		}
		if (tickLower > tickUpper) {
			const tmp = tickLower;
			tickLower = tickUpper;
			tickUpper = tmp;
		}
		return {
			type: "sui.lp.cetus.add",
			poolId,
			positionId,
			coinTypeA,
			coinTypeB,
			tickLower,
			tickUpper,
			amountA: amountARaw,
			amountB: amountBRaw,
			fixAmountA: params.fixAmountA !== false,
			slippageBps: params.slippageBps ?? 100,
			collectFee: params.collectFee === true,
			rewarderCoinTypes: params.rewarderCoinTypes ?? [],
		};
	}

	if (intentType === "sui.lp.cetus.remove") {
		let poolId = params.poolId?.trim() || parsed.poolId;
		let positionId = params.positionId?.trim() || parsed.positionId;
		const coinTypeA = await resolveCoinTypeFromHint(
			params.coinTypeA || parsed.coinTypeA,
			parsedNetwork,
		);
		const coinTypeB = await resolveCoinTypeFromHint(
			params.coinTypeB || parsed.coinTypeB,
			parsedNetwork,
		);
		const deltaLiquidity =
			params.deltaLiquidity?.trim() || parsed.deltaLiquidity;
		const minAmountA = params.minAmountA?.trim() || parsed.minAmountA || "0";
		const minAmountB = params.minAmountB?.trim() || parsed.minAmountB || "0";
		const rpcUrl = params.rpcUrl;
		const [normalizedMinAmountA, normalizedMinAmountB] = await Promise.all([
			normalizeLpAmountToRaw({
				amount: minAmountA,
				coinType: coinTypeA,
				network: parsedNetwork,
				rpcUrl,
				fieldName: "minAmountA",
			}),
			normalizeLpAmountToRaw({
				amount: minAmountB,
				coinType: coinTypeB,
				network: parsedNetwork,
				rpcUrl,
				fieldName: "minAmountB",
			}),
		]);
		const minAmountARaw = normalizedMinAmountA ?? "0";
		const minAmountBRaw = normalizedMinAmountB ?? "0";
		if (!poolId && positionId) {
			poolId = await resolvePoolIdByPositionId(network, positionId);
		}
		if (!positionId && coinTypeA && coinTypeB) {
			let owner: string;
			try {
				owner = resolveSuiOwnerAddress();
			} catch {
				owner = "";
			}
			const candidates = await resolveLpPositionByPair({
				network,
				coinTypeA,
				coinTypeB,
				poolId,
				owner,
			});
			if (candidates.length === 1) {
				positionId = candidates[0].positionId;
				if (!poolId) {
					poolId = candidates[0].poolId;
				}
			} else if (candidates.length > 1) {
				const candidateList = formatCandidateListForError(candidates);
				throw new Error(
					`Multiple LP positions found for ${coinTypeA}/${coinTypeB} in owner wallet. Please provide positionId. candidates=${candidateList}`,
				);
			} else if (!poolId) {
				throw new Error(
					"No matching LP position found for this coin pair. Specify positionId (preferred) or add poolId+positionId before execution.",
				);
			}
		}
		if (!poolId) {
			throw new Error(
				positionId
					? "poolId is required for sui.lp.cetus.remove and could not be auto-resolved from positionId. Tip: provide poolId explicitly or verify positionId belongs to a Cetus position object."
					: "poolId is required for sui.lp.cetus.remove. Tip: first query Cetus pools and choose a poolId.",
			);
		}
		if (!positionId) {
			throw new Error(
				"positionId is required for sui.lp.cetus.remove. Tip: LP remove currently targets an existing positionId.",
			);
		}
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
			minAmountA: minAmountARaw,
			minAmountB: minAmountBRaw,
			collectFee: params.collectFee !== false,
			rewarderCoinTypes: params.rewarderCoinTypes ?? [],
		};
	}

	const inputCoinType = await resolveCoinTypeFromHint(
		params.inputCoinType || parsed.inputCoinType || params.coinType,
		parsedNetwork,
	);
	const outputCoinType = await resolveCoinTypeFromHint(
		params.outputCoinType || parsed.outputCoinType,
		parsedNetwork,
	);
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
		byAmountIn: parsed.byAmountIn ?? params.byAmountIn !== false,
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
	const parsedFromText = parseIntentText(params.intentText);
	const hasActionableIntentFromText = Boolean(
		parsedFromText.intentType ||
			parsedFromText.toAddress ||
			parsedFromText.amountSui != null ||
			parsedFromText.amountRaw ||
			parsedFromText.coinType ||
			parsedFromText.inputCoinType ||
			parsedFromText.outputCoinType ||
			parsedFromText.poolId ||
			parsedFromText.positionId ||
			parsedFromText.coinTypeA ||
			parsedFromText.coinTypeB ||
			parsedFromText.tickLower != null ||
			parsedFromText.tickUpper != null ||
			parsedFromText.amountA ||
			parsedFromText.amountB ||
			parsedFromText.deltaLiquidity ||
			parsedFromText.minAmountA ||
			parsedFromText.minAmountB,
	);
	return Boolean(
		params.intentType ||
			hasActionableIntentFromText ||
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

type SignedSubmission = {
	signedTransactionBytesBase64: string;
	signedSignatures: string[];
};

function normalizeSuiAddressForCompare(value: string): string {
	const trimmed = value.trim().toLowerCase();
	return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function resolveSignedSubmission(params: {
	signedTransactionBytesBase64?: string;
	signedSignatures?: string[];
	signedSignature?: string;
}): SignedSubmission | null {
	const signedTransactionBytesBase64 =
		params.signedTransactionBytesBase64?.trim() || "";
	const signatureFromSingle = params.signedSignature?.trim();
	const signaturesFromArray = Array.isArray(params.signedSignatures)
		? params.signedSignatures
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0)
		: [];
	const signedSignatures = signatureFromSingle
		? [signatureFromSingle, ...signaturesFromArray]
		: signaturesFromArray;
	if (!signedTransactionBytesBase64 && signedSignatures.length === 0) {
		return null;
	}
	if (!signedTransactionBytesBase64) {
		throw new Error(
			"signedTransactionBytesBase64 is required when signedSignatures/signedSignature is provided.",
		);
	}
	if (signedSignatures.length === 0) {
		throw new Error(
			"signedSignatures (or signedSignature) is required when signedTransactionBytesBase64 is provided.",
		);
	}
	return {
		signedTransactionBytesBase64,
		signedSignatures,
	};
}

function decodeBase64Bytes(value: string, fieldName: string): Uint8Array {
	try {
		const decoded = Buffer.from(value, "base64");
		if (decoded.length === 0) {
			throw new Error(`${fieldName} decoded to empty bytes.`);
		}
		return decoded;
	} catch (error) {
		throw new Error(
			`${fieldName} must be valid base64: ${stringifyError(error)}`,
		);
	}
}

async function executeSignedTransactionBlock(params: {
	network: SuiNetwork;
	rpcUrl?: string;
	signed: SignedSubmission;
	waitForLocalExecution?: boolean;
}): Promise<Record<string, unknown>> {
	const requestType = resolveRequestType(params.waitForLocalExecution);
	const client = getSuiClient(params.network, params.rpcUrl);
	const transactionBlock = decodeBase64Bytes(
		params.signed.signedTransactionBytesBase64,
		"signedTransactionBytesBase64",
	);
	const response = await client.executeTransactionBlock({
		transactionBlock,
		signature:
			params.signed.signedSignatures.length === 1
				? params.signed.signedSignatures[0]
				: params.signed.signedSignatures,
		options: {
			showEffects: true,
			showEvents: true,
			showObjectChanges: true,
			showBalanceChanges: true,
		},
		requestType,
	});
	const status = response.effects?.status?.status ?? "unknown";
	const error = response.effects?.status?.error ?? response.errors?.[0] ?? null;
	if (status === "failure") {
		throw new Error(
			`Sui signed transaction execute failed: ${error ?? "unknown error"} (digest=${response.digest})`,
		);
	}
	return {
		digest: response.digest,
		status,
		error,
		confirmedLocalExecution: response.confirmedLocalExecution ?? null,
		network: params.network,
		rpcUrl: getSuiRpcEndpoint(params.network, params.rpcUrl),
		requestType,
		signatureCount: params.signed.signedSignatures.length,
		executeVia: "signed_payload",
		explorer: getSuiExplorerTransactionUrl(response.digest, params.network),
	};
}

async function executeSimulatedTransactionBlock(params: {
	network: SuiNetwork;
	rpcUrl?: string;
	transaction: Transaction;
	expectedSignerAddress?: string;
	fromPrivateKey?: string;
	waitForLocalExecution?: boolean;
}): Promise<Record<string, unknown>> {
	let signer:
		| Awaited<ReturnType<typeof resolveSuiKeypair>>
		| null = null;
	try {
		signer = resolveSuiKeypair(params.fromPrivateKey);
	} catch (error) {
		throw new Error(
			`No local signer available for simulated tx execute${params.expectedSignerAddress ? ` (expected=${params.expectedSignerAddress})` : ""}. Provide fromPrivateKey (suiprivkey) or signed payload (signedTransactionBytesBase64 + signedSignatures) from the simulate step.`,
		);
	}

	if (!signer) {
		throw new Error(
			`No local signer available for simulated tx execute${params.expectedSignerAddress ? ` (expected=${params.expectedSignerAddress})` : ""}.`,
		);
	}
	const signerAddress = signer.toSuiAddress();
	if (params.expectedSignerAddress?.trim()) {
		const normalizedExpected = normalizeSuiAddressForCompare(
			params.expectedSignerAddress,
		);
		const normalizedSigner = normalizeSuiAddressForCompare(signerAddress);
		if (normalizedExpected !== normalizedSigner) {
			throw new Error(
				`Local signer address mismatch for simulated tx execute. expected=${params.expectedSignerAddress} actual=${signerAddress}`,
			);
		}
	}
	const requestType = resolveRequestType(params.waitForLocalExecution);
	const client = getSuiClient(params.network, params.rpcUrl);
	const response = await client.signAndExecuteTransaction({
		signer,
		transaction: params.transaction,
		options: {
			showEffects: true,
			showEvents: true,
			showObjectChanges: true,
			showBalanceChanges: true,
		},
		requestType,
	});
	const status = response.effects?.status?.status ?? "unknown";
	const error = response.effects?.status?.error ?? response.errors?.[0] ?? null;
	if (status === "failure") {
		throw new Error(
			`Sui simulated tx execute failed: ${error ?? "unknown error"} (digest=${response.digest})`,
		);
	}
	return {
		digest: response.digest,
		status,
		error,
		confirmedLocalExecution: response.confirmedLocalExecution ?? null,
		network: params.network,
		rpcUrl: getSuiRpcEndpoint(params.network, params.rpcUrl),
		requestType,
		executeVia: "simulated_tx_local_signer",
		signerAddress,
		explorer: getSuiExplorerTransactionUrl(response.digest, params.network),
	};
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

function isRecordObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortenSummaryValue(value: string): string {
	const normalized = value.trim();
	if (normalized.length <= 18) return normalized;
	return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}

function resolveSuiRiskCheckNode(value: unknown): SuiWorkflowRiskCheck | null {
	if (!isRecordObject(value)) return null;
	const band = value.riskBand;
	const level = value.riskLevel;
	const engine = value.riskEngine;
	if (
		(band !== "safe" &&
			band !== "warning" &&
			band !== "critical" &&
			band !== "unknown") ||
		(level !== "low" &&
			level !== "medium" &&
			level !== "high" &&
			level !== "unknown") ||
		engine !== "heuristic"
	) {
		return null;
	}
	const confirmRiskAccepted =
		typeof value.confirmRiskAccepted === "boolean"
			? value.confirmRiskAccepted
			: null;
	const requiresExplicitRiskAcceptance =
		value.requiresExplicitRiskAcceptance === true;
	const reasonCodes = Array.isArray(value.reasonCodes)
		? value.reasonCodes.filter(
				(item): item is string =>
					typeof item === "string" && item.trim().length > 0,
			)
		: [];
	const notes = Array.isArray(value.notes)
		? value.notes.filter(
				(item): item is string =>
					typeof item === "string" && item.trim().length > 0,
			)
		: [];
	return {
		riskBand: band,
		riskLevel: level,
		riskEngine: "heuristic",
		requiresExplicitRiskAcceptance,
		confirmRiskAccepted,
		reasonCodes,
		notes,
	};
}

function buildSuiExecuteSummaryLine(
	intentType: string,
	executeDetails: unknown,
): string {
	const details = isRecordObject(executeDetails) ? executeDetails : null;
	const parts: string[] = [intentType, "executed"];
	if (!details) {
		return parts.join(" ");
	}
	const status =
		typeof details.status === "string" && details.status.trim()
			? details.status.trim()
			: null;
	const digest =
		typeof details.digest === "string" && details.digest.trim()
			? details.digest.trim()
			: null;
	const executeVia =
		typeof details.executeVia === "string" && details.executeVia.trim()
			? details.executeVia.trim()
			: null;
	if (status) {
		parts.push(`status=${status}`);
	}
	if (digest) {
		parts.push(`digest=${shortenSummaryValue(digest)}`);
	}
	if (executeVia) {
		parts.push(`via=${executeVia}`);
	}
	if (typeof details.confirmedLocalExecution === "boolean") {
		parts.push(
			`localExecution=${details.confirmedLocalExecution ? "confirmed" : "pending"}`,
		);
	}
	const riskCheck = resolveSuiRiskCheckNode(details.riskCheck);
	if (riskCheck) {
		parts.push(`risk=${riskCheck.riskBand}`);
		parts.push(`riskLevel=${riskCheck.riskLevel}`);
		parts.push(`riskEngine=${riskCheck.riskEngine}`);
		if (riskCheck.confirmRiskAccepted === true) {
			parts.push("confirmRisk=accepted");
		} else if (riskCheck.confirmRiskAccepted === false) {
			parts.push("confirmRisk=not_accepted");
		}
	}
	return parts.join(" ");
}

function buildSuiWorkflowPhaseSummary(params: {
	phase: "analysis" | "simulate" | "execute";
	intentType: string;
	status: string;
	line: string;
}) {
	return {
		schema: "w3rt.workflow.summary.v1",
		phase: params.phase,
		intentType: params.intentType,
		status: params.status,
		line: params.line,
	};
}

function resolveSuiExecuteStatus(executeDetails: unknown): string {
	if (!isRecordObject(executeDetails)) {
		return "submitted";
	}
	const status =
		typeof executeDetails.status === "string" && executeDetails.status.trim()
			? executeDetails.status.trim()
			: null;
	if (status) return status;
	return "submitted";
}

function attachExecuteSummary(
	intentType: string,
	executeDetails: unknown,
): Record<string, unknown> {
	const summaryLine = buildSuiExecuteSummaryLine(intentType, executeDetails);
	const summary = buildSuiWorkflowPhaseSummary({
		phase: "execute",
		intentType,
		status: resolveSuiExecuteStatus(executeDetails),
		line: summaryLine,
	});
	if (isRecordObject(executeDetails)) {
		return {
			...executeDetails,
			summaryLine,
			summary,
		};
	}
	return {
		details: executeDetails ?? null,
		summaryLine,
		summary,
	};
}

function formatExecuteSummaryText(
	intentType: string,
	executeArtifact: Record<string, unknown>,
): string {
	const summaryLine =
		typeof executeArtifact.summaryLine === "string" &&
		executeArtifact.summaryLine.trim()
			? executeArtifact.summaryLine.trim()
			: `${intentType} executed`;
	const riskCheck = resolveSuiRiskCheckNode(executeArtifact.riskCheck);
	const riskHint = riskCheck ? buildSuiRiskReadableHint(riskCheck) : null;
	return `Workflow executed: ${summaryLine}${riskHint ? ` ${riskHint}` : ""}`;
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
	canExecuteWithLocalSigner?: boolean;
	unsignedPayload: {
		unsignedTransactionBytesBase64?: string;
		unsignedPayloadError?: string;
	};
	riskCheck?: SuiWorkflowRiskCheck;
}): string {
	const riskHint = params.riskCheck
		? buildSuiRiskReadableHint(params.riskCheck)
		: null;
	const riskSuffix =
		params.riskCheck && params.riskCheck.riskBand !== "safe"
			? ` risk=${params.riskCheck.riskBand}${riskHint ? ` ${riskHint}` : ""}`
			: "";
	const localSignerHint = params.canExecuteWithLocalSigner
		? "execute can proceed with local signer"
		: "execute requires fromPrivateKey or signed payload";
	const localSignerHintSuffix = ` (${localSignerHint})`;
	if (params.unsignedPayload.unsignedTransactionBytesBase64) {
		return `Workflow simulated: ${params.intentType} status=${params.status} signer=${params.signerAddress} unsignedPayload=exported${localSignerHintSuffix}${riskSuffix}`;
	}
	if (params.unsignedPayload.unsignedPayloadError) {
		return `Workflow simulated: ${params.intentType} status=${params.status} signer=${params.signerAddress} unsignedPayload=unavailable${localSignerHintSuffix}${riskSuffix}`;
	}
	return `Workflow simulated: ${params.intentType} status=${params.status} signer=${params.signerAddress}${riskSuffix}`;
}

function buildSuiAnalysisSummaryLine(
	intentType: string,
	needsMainnetConfirmation: boolean,
	confirmToken: string,
	riskCheck?: SuiWorkflowRiskCheck,
): string {
	const parts = [intentType, "analysis=ready"];
	if (riskCheck) {
		parts.push(`risk=${riskCheck.riskBand}`);
		parts.push(`riskLevel=${riskCheck.riskLevel}`);
		parts.push("riskEngine=heuristic");
		if (riskCheck.requiresExplicitRiskAcceptance) {
			parts.push("riskGate=confirmRiskOnWarning");
		}
	}
	if (needsMainnetConfirmation) {
		parts.push(`mainnetGuard=on confirmToken=${confirmToken}`);
	}
	return parts.join(" ");
}

function buildSuiSimulationSummaryLine(params: {
	intentType: string;
	status: string;
	signerAddress: string;
	canExecuteWithLocalSigner?: boolean;
	signerSource?: "fromPrivateKey" | "walletAddress";
	unsignedPayload: {
		unsignedTransactionBytesBase64?: string;
		unsignedPayloadError?: string;
	};
	riskCheck?: SuiWorkflowRiskCheck;
}): string {
	const parts = [
		params.intentType,
		`simulate=${params.status}`,
		`signer=${shortenSummaryValue(params.signerAddress)}`,
	];
	if (params.signerSource) {
		parts.push(`signerSource=${params.signerSource}`);
	}
	if (params.canExecuteWithLocalSigner === false) {
		parts.push("localSigner=unavailable");
	}
	if (params.riskCheck) {
		parts.push(`risk=${params.riskCheck.riskBand}`);
		parts.push(`riskLevel=${params.riskCheck.riskLevel}`);
		parts.push("riskEngine=heuristic");
	}
	if (params.unsignedPayload.unsignedTransactionBytesBase64) {
		parts.push("unsignedPayload=exported");
	} else if (params.unsignedPayload.unsignedPayloadError) {
		parts.push("unsignedPayload=unavailable");
	}
	return parts.join(" ");
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
		const positionId = intent.positionId?.trim() ?? "";
		const isOpenPosition = !positionId;
		const sdk = initCetusSDK({
			network: cetusNetwork,
			fullNodeUrl: rpcUrl,
			wallet: signerAddress,
		});
		const tx = await sdk.Position.createAddLiquidityFixTokenPayload({
			pool_id: intent.poolId,
			pos_id: positionId,
			coinTypeA: intent.coinTypeA,
			coinTypeB: intent.coinTypeB,
			tick_lower: intent.tickLower,
			tick_upper: intent.tickUpper,
			amount_a: intent.amountA,
			amount_b: intent.amountB,
			slippage: parseSlippageDecimal(intent.slippageBps),
			fix_amount_a: intent.fixAmountA,
			is_open: isOpenPosition,
			collect_fee: intent.collectFee,
			rewarder_coin_types: intent.rewarderCoinTypes,
		});
		return {
			tx: tx as unknown as Transaction,
			artifacts: {
				poolId: intent.poolId,
				positionId,
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
			fromPrivateKey: params.fromPrivateKey,
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
			fromPrivateKey: params.fromPrivateKey,
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
			fromPrivateKey: params.fromPrivateKey,
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
			fromPrivateKey: params.fromPrivateKey,
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
		fromPrivateKey: params.fromPrivateKey,
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
			fromPrivateKey: params.fromPrivateKey,
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
			fromPrivateKey: params.fromPrivateKey,
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
		fromPrivateKey: params.fromPrivateKey,
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
			fromPrivateKey: params.fromPrivateKey,
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
			fromPrivateKey: params.fromPrivateKey,
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
		fromPrivateKey: params.fromPrivateKey,
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

	const runMode = resolveWorkflowRunMode(params.runMode, params.intentText, {
		allowCompose: false,
	});
	const hasRoutingHints = Boolean(
		intentType ||
			params.stableCoinType?.trim() ||
			params.amountUsdcRaw?.trim() ||
			params.amountStableRaw?.trim() ||
			params.clmmPositionId?.trim() ||
			params.clmmPoolId?.trim() ||
			params.positionNftId?.trim(),
	);
	if (runMode === "execute" && !hasRoutingHints) {
		const explicitRunId = params.runId?.trim();
		if (explicitRunId) {
			const routedByRunId =
				readWorkflowSession("w3rt_run_sui_workflow_v0", explicitRunId) ??
				readWorkflowSession(
					"w3rt_run_sui_stablelayer_workflow_v0",
					explicitRunId,
				) ??
				readWorkflowSession(
					"w3rt_run_sui_cetus_farms_workflow_v0",
					explicitRunId,
				);
			if (routedByRunId?.route) {
				return routedByRunId.route;
			}
			if (latestWorkflowSession?.runId === explicitRunId) {
				return latestWorkflowSession.route;
			}
		}
		if (latestWorkflowSession) {
			return latestWorkflowSession.route;
		}
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
				fromPrivateKey: Type.Optional(Type.String()),
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
				signedTransactionBytesBase64: Type.Optional(Type.String()),
				signedSignatures: Type.Optional(
					Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
				),
				signedSignature: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
				confirmRisk: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as WorkflowParams;
				const runMode = resolveWorkflowRunMode(
					params.runMode,
					params.intentText,
					{
						allowCompose: false,
					},
				);
				const intentHints = parseIntentText(params.intentText);
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
						: await normalizeIntent(params, network);
				const effectiveConfirmMainnet =
					params.confirmMainnet === true || intentHints.confirmMainnet === true;
				const providedConfirmTokenRaw =
					params.confirmToken?.trim() || intentHints.confirmToken?.trim();
				const effectiveConfirmRisk =
					params.confirmRisk === true || intentHints.confirmRisk === true;
				const needsMainnetConfirmation = network === "mainnet";
				const confirmToken = createConfirmToken(runId, network, intent);
				const hasSessionConfirmation =
					runMode === "execute" &&
					!providedConfirmTokenRaw &&
					priorSession?.runId === runId &&
					priorSession.network === network &&
					intentsMatch(priorSession.intent, intent);
				const plan = ["analysis", "simulate", "execute"];
				const analysisRiskCheck = assessSuiIntentRisk(intent, null);

				if (runMode === "analysis") {
					const analysisSummaryLine = buildSuiAnalysisSummaryLine(
						intent.type,
						needsMainnetConfirmation,
						confirmToken,
						analysisRiskCheck,
					);
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
									riskCheck: analysisRiskCheck,
									summaryLine: analysisSummaryLine,
									summary: buildSuiWorkflowPhaseSummary({
										phase: "analysis",
										intentType: intent.type,
										status: "ready",
										line: analysisSummaryLine,
									}),
								},
							},
						},
					};
				}

				if (runMode === "simulate") {
					const simulateRiskCheck = assessSuiIntentRisk(intent, null);
					const simulationSigner = resolveWorkflowSimulationSigner(
						params.fromPrivateKey,
					);
					const sender = simulationSigner.sender;
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
						simulatedTransaction: tx,
						simulatedSignerAddress: sender,
					});
					const simulateSummaryLine = buildSuiSimulationSummaryLine({
						intentType: intent.type,
						status,
						signerAddress: sender,
						signerSource: simulationSigner.signerSource,
						canExecuteWithLocalSigner: simulationSigner.canSign,
						unsignedPayload,
						riskCheck: simulateRiskCheck,
					});
					return {
						content: [
							{
								type: "text",
								text: formatSimulationSummary({
									intentType: intent.type,
									status,
									signerAddress: sender,
									canExecuteWithLocalSigner: simulationSigner.canSign,
									unsignedPayload,
									riskCheck: simulateRiskCheck,
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
									signerSource: simulationSigner.signerSource,
									canExecuteWithLocalSigner: simulationSigner.canSign,
									status,
									error,
									riskCheck: simulateRiskCheck,
									...artifacts,
									...unsignedPayload,
									summaryLine: simulateSummaryLine,
									summary: buildSuiWorkflowPhaseSummary({
										phase: "simulate",
										intentType: intent.type,
										status,
										line: simulateSummaryLine,
									}),
								},
							},
						},
					};
				}

				if (needsMainnetConfirmation) {
					if (effectiveConfirmMainnet !== true) {
						throw new Error(
							"Mainnet workflow execute is blocked. Set confirmMainnet=true.",
						);
					}
					const providedConfirmToken = providedConfirmTokenRaw;
					if (
						(!providedConfirmToken || providedConfirmToken !== confirmToken) &&
						!hasSessionConfirmation
					) {
						throw new Error(
							"Invalid confirmToken for mainnet execute. Run simulate first and pass returned confirmToken.",
						);
					}
				}
				const executeRiskCheck = assessSuiIntentRisk(
					intent,
					!!effectiveConfirmRisk,
				);
				if (
					needsMainnetConfirmation &&
					executeRiskCheck.requiresExplicitRiskAcceptance &&
					effectiveConfirmRisk !== true
				) {
					const riskHint = buildSuiRiskReadableHint(executeRiskCheck);
					throw new Error(
						`Mainnet workflow risk gate blocked execute. ${riskHint ? `${riskHint} ` : ""}Set confirmRisk=true (or say "我接受风险继续执行").`,
					);
				}

				const signedSubmission = resolveSignedSubmission({
					signedTransactionBytesBase64: params.signedTransactionBytesBase64,
					signedSignatures: params.signedSignatures,
					signedSignature: params.signedSignature,
				});
				const canReuseSimulatedTransaction =
					runMode === "execute" &&
					!hasCoreIntentInput(params) &&
					!!priorSession?.simulatedTransaction &&
					priorSession.network === network &&
					intentsMatch(priorSession.intent, intent);
				const executeDetailsBase = signedSubmission
					? await executeSignedTransactionBlock({
							network,
							signed: signedSubmission,
							waitForLocalExecution: params.waitForLocalExecution,
						})
					: canReuseSimulatedTransaction
						? await executeSimulatedTransactionBlock({
								network,
								transaction: priorSession.simulatedTransaction as Transaction,
								expectedSignerAddress: priorSession?.simulatedSignerAddress,
								fromPrivateKey: params.fromPrivateKey,
								waitForLocalExecution: params.waitForLocalExecution,
							})
						: await executeIntent(intent, params, network).then((result) =>
								isRecordObject(result.details)
									? result.details
									: { details: result.details ?? null },
							);
				const executeDetails = {
					...executeDetailsBase,
					riskCheck: executeRiskCheck,
				};
				const executeArtifact = attachExecuteSummary(
					intent.type,
					executeDetails,
				);
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
							text: formatExecuteSummaryText(intent.type, executeArtifact),
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
							execute: executeArtifact,
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
				fromPrivateKey: Type.Optional(Type.String()),
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
				signedTransactionBytesBase64: Type.Optional(Type.String()),
				signedSignatures: Type.Optional(
					Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
				),
				signedSignature: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
				confirmRisk: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as StableLayerWorkflowParams;
				const runMode = resolveWorkflowRunMode(
					params.runMode,
					params.intentText,
					{
						allowCompose: false,
					},
				);
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
					const analysisSummaryLine = buildSuiAnalysisSummaryLine(
						intent.type,
						needsMainnetConfirmation,
						confirmToken,
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
									summaryLine: analysisSummaryLine,
									summary: buildSuiWorkflowPhaseSummary({
										phase: "analysis",
										intentType: intent.type,
										status: "ready",
										line: analysisSummaryLine,
									}),
								},
							},
						},
					};
				}

				if (runMode === "simulate") {
					const simulationSigner = resolveWorkflowSimulationSigner(
						params.fromPrivateKey,
					);
					const sender = simulationSigner.sender;
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
						simulatedTransaction: tx,
						simulatedSignerAddress: sender,
					});
					const simulateSummaryLine = buildSuiSimulationSummaryLine({
						intentType: intent.type,
						status,
						signerAddress: sender,
						signerSource: simulationSigner.signerSource,
						canExecuteWithLocalSigner: simulationSigner.canSign,
						unsignedPayload,
					});
					return {
						content: [
							{
								type: "text",
								text: formatSimulationSummary({
									intentType: intent.type,
									status,
									signerAddress: sender,
									canExecuteWithLocalSigner: simulationSigner.canSign,
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
									signerSource: simulationSigner.signerSource,
									canExecuteWithLocalSigner: simulationSigner.canSign,
									status,
									error,
									...artifacts,
									...unsignedPayload,
									summaryLine: simulateSummaryLine,
									summary: buildSuiWorkflowPhaseSummary({
										phase: "simulate",
										intentType: intent.type,
										status,
										line: simulateSummaryLine,
									}),
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

				const signedSubmission = resolveSignedSubmission({
					signedTransactionBytesBase64: params.signedTransactionBytesBase64,
					signedSignatures: params.signedSignatures,
					signedSignature: params.signedSignature,
				});
				const canReuseSimulatedTransaction =
					runMode === "execute" &&
					!hasStableLayerIntentInput(params) &&
					!!priorSession?.simulatedTransaction &&
					priorSession.network === network &&
					intentsMatch(priorSession.intent, intent);
				const executeResult = signedSubmission
					? {
							details: await executeSignedTransactionBlock({
								network,
								signed: signedSubmission,
								waitForLocalExecution: params.waitForLocalExecution,
							}),
						}
					: canReuseSimulatedTransaction
						? {
								details: await executeSimulatedTransactionBlock({
									network,
									transaction: priorSession.simulatedTransaction as Transaction,
									expectedSignerAddress: priorSession?.simulatedSignerAddress,
									fromPrivateKey: params.fromPrivateKey,
									waitForLocalExecution: params.waitForLocalExecution,
								}),
							}
						: await executeStableLayerIntent(intent, params, network);
				const executeArtifact = attachExecuteSummary(
					intent.type,
					executeResult.details ?? null,
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
							text: formatExecuteSummaryText(intent.type, executeArtifact),
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
							execute: executeArtifact,
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
				fromPrivateKey: Type.Optional(Type.String()),
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
				signedTransactionBytesBase64: Type.Optional(Type.String()),
				signedSignatures: Type.Optional(
					Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
				),
				signedSignature: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
				confirmRisk: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as CetusFarmsWorkflowParams;
				const runMode = resolveWorkflowRunMode(
					params.runMode,
					params.intentText,
					{
						allowCompose: false,
					},
				);
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
						: await normalizeCetusFarmsIntent(params);
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
					const analysisSummaryLine = buildSuiAnalysisSummaryLine(
						intent.type,
						needsMainnetConfirmation,
						confirmToken,
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
									summaryLine: analysisSummaryLine,
									summary: buildSuiWorkflowPhaseSummary({
										phase: "analysis",
										intentType: intent.type,
										status: "ready",
										line: analysisSummaryLine,
									}),
								},
							},
						},
					};
				}

	if (runMode === "simulate") {
		const simulationSigner = resolveWorkflowSimulationSigner(
			params.fromPrivateKey,
		);
		const sender = simulationSigner.sender;
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
						simulatedTransaction: tx,
						simulatedSignerAddress: sender,
					});
					const simulateSummaryLine = buildSuiSimulationSummaryLine({
						intentType: intent.type,
						status,
						signerAddress: sender,
						signerSource: simulationSigner.signerSource,
						canExecuteWithLocalSigner: simulationSigner.canSign,
						unsignedPayload,
					});
					return {
						content: [
							{
								type: "text",
								text: formatSimulationSummary({
									intentType: intent.type,
									status,
									signerAddress: sender,
									canExecuteWithLocalSigner: simulationSigner.canSign,
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
									signerSource: simulationSigner.signerSource,
									canExecuteWithLocalSigner: simulationSigner.canSign,
									status,
									error,
									...artifacts,
									...unsignedPayload,
									summaryLine: simulateSummaryLine,
									summary: buildSuiWorkflowPhaseSummary({
										phase: "simulate",
										intentType: intent.type,
										status,
										line: simulateSummaryLine,
									}),
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

				const signedSubmission = resolveSignedSubmission({
					signedTransactionBytesBase64: params.signedTransactionBytesBase64,
					signedSignatures: params.signedSignatures,
					signedSignature: params.signedSignature,
				});
				const canReuseSimulatedTransaction =
					runMode === "execute" &&
					!hasCetusFarmsIntentInput(params) &&
					!!priorSession?.simulatedTransaction &&
					priorSession.network === network &&
					intentsMatch(priorSession.intent, intent);
				const executeResult = signedSubmission
					? {
							details: await executeSignedTransactionBlock({
								network,
								rpcUrl: params.rpcUrl,
								signed: signedSubmission,
								waitForLocalExecution: params.waitForLocalExecution,
							}),
						}
					: canReuseSimulatedTransaction
						? {
								details: await executeSimulatedTransactionBlock({
									network,
									rpcUrl: params.rpcUrl,
									transaction: priorSession.simulatedTransaction as Transaction,
									expectedSignerAddress: priorSession?.simulatedSignerAddress,
									fromPrivateKey: params.fromPrivateKey,
									waitForLocalExecution: params.waitForLocalExecution,
								}),
							}
						: await executeCetusFarmsIntent(intent, params, network);
				const executeArtifact = attachExecuteSummary(
					intent.type,
					executeResult.details ?? null,
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
							text: formatExecuteSummaryText(intent.type, executeArtifact),
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
							execute: executeArtifact,
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
				fromPrivateKey: Type.Optional(Type.String()),
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
				signedTransactionBytesBase64: Type.Optional(Type.String()),
				signedSignatures: Type.Optional(
					Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
				),
				signedSignature: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
				confirmRisk: Type.Optional(Type.Boolean()),
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
