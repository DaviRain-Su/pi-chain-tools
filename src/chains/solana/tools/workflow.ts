import { createHash, randomBytes } from "node:crypto";
import { Type } from "@sinclair/typebox";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountInstruction,
	createTransferInstruction,
	getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
	Authorized,
	type Connection,
	Keypair,
	type ParsedAccountData,
	PublicKey,
	StakeAuthorizationLayout,
	StakeProgram,
	SystemProgram,
	Transaction,
	type TransactionInstruction,
	VersionedTransaction,
} from "@solana/web3.js";
import { defineTool } from "../../../core/types.js";
import {
	KAMINO_MAINNET_MARKET_ADDRESS,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	assertJupiterNetworkSupported,
	assertRaydiumNetworkSupported,
	buildJupiterSwapTransaction,
	buildKaminoBorrowInstructions,
	buildKaminoDepositAndBorrowInstructions,
	buildKaminoDepositInstructions,
	buildKaminoRepayAndWithdrawInstructions,
	buildKaminoRepayInstructions,
	buildKaminoWithdrawInstructions,
	buildOrcaDecreaseLiquidityInstructions,
	buildOrcaIncreaseLiquidityInstructions,
	buildRaydiumSwapTransactions,
	callJupiterApi,
	commitmentSchema,
	getConnection,
	getExplorerAddressUrl,
	getExplorerTransactionUrl,
	getJupiterApiBaseUrl,
	getJupiterQuote,
	getKaminoLendingMarkets,
	getKaminoLendingPositions,
	getOrcaWhirlpoolPositions,
	getRaydiumApiBaseUrl,
	getRaydiumPriorityFee,
	getRaydiumPriorityFeeMicroLamports,
	getRaydiumQuote,
	getSplTokenProgramId,
	jupiterPriorityLevelSchema,
	jupiterSwapModeSchema,
	normalizeAtPath,
	parseFinality,
	parseJupiterPriorityLevel,
	parseJupiterSwapMode,
	parseNetwork,
	parsePositiveBigInt,
	parseRaydiumSwapType,
	parseRaydiumTxVersion,
	parseSplTokenProgram,
	parseTokenAccountInfo,
	parseTransactionFromBase64,
	raydiumSwapTypeSchema,
	raydiumTxVersionSchema,
	resolveSecretKey,
	solanaNetworkSchema,
	splTokenProgramSchema,
	stringifyUnknown,
	toLamports,
} from "../runtime.js";

type WorkflowRunMode = "analysis" | "simulate" | "execute";
type WorkflowIntentType =
	| "solana.transfer.sol"
	| "solana.transfer.spl"
	| "solana.lend.kamino.borrow"
	| "solana.lend.kamino.deposit"
	| "solana.lend.kamino.depositAndBorrow"
	| "solana.lend.kamino.repay"
	| "solana.lend.kamino.repayAndWithdraw"
	| "solana.lend.kamino.withdraw"
	| "solana.stake.createAndDelegate"
	| "solana.stake.delegate"
	| "solana.stake.authorizeStaker"
	| "solana.stake.authorizeWithdrawer"
	| "solana.stake.deactivate"
	| "solana.stake.withdraw"
	| "solana.lp.orca.increase"
	| "solana.lp.orca.decrease"
	| "solana.swap.jupiter"
	| "solana.swap.raydium"
	| "solana.swap.orca"
	| "solana.swap.meteora"
	| "solana.read.balance"
	| "solana.read.orcaPositions"
	| "solana.read.tokenBalance"
	| "solana.read.portfolio"
	| "solana.read.defiPositions"
	| "solana.read.lendingMarkets"
	| "solana.read.lendingPositions";
type ParsedIntentTextFields = Partial<{
	intentType: WorkflowIntentType;
	address: string;
	toAddress: string;
	amountSol: number;
	amountUi: string;
	depositAmountUi: string;
	borrowAmountUi: string;
	repayAmountUi: string;
	withdrawAmountUi: string;
	tokenMint: string;
	positionMint: string;
	reserveMint: string;
	depositReserveMint: string;
	borrowReserveMint: string;
	repayReserveMint: string;
	withdrawReserveMint: string;
	inputMint: string;
	outputMint: string;
	amountRaw: string;
	liquidityAmountRaw: string;
	tokenAAmountRaw: string;
	tokenBAmountRaw: string;
	depositAmountRaw: string;
	borrowAmountRaw: string;
	repayAmountRaw: string;
	withdrawAmountRaw: string;
	marketAddress: string;
	ownerAddress: string;
	currentSlot: string;
	useV2Ixs: boolean;
	includeAtaIxs: boolean;
	extraComputeUnits: number;
	requestElevationGroup: boolean;
	stakeSeed: string;
	stakeAuthorityAddress: string;
	withdrawAuthorityAddress: string;
	newAuthorityAddress: string;
	authorizationType: "staker" | "withdrawer";
	stakeAccountAddress: string;
	voteAccountAddress: string;
	slippageBps: number;
	swapMode: "ExactIn" | "ExactOut";
	dexes: string[];
	excludeDexes: string[];
	includeStakeAccounts: boolean;
	protocol: string;
	programId: string;
	limitMarkets: number;
}>;

type TransferSolIntent = {
	type: "solana.transfer.sol";
	fromAddress: string;
	toAddress: string;
	amountSol: number;
	lamports: number;
};

type TransferSplIntent = {
	type: "solana.transfer.spl";
	fromAddress: string;
	toAddress: string;
	tokenMint: string;
	amountRaw: string;
	tokenProgram: "token" | "token2022";
	sourceTokenAccount?: string;
	destinationTokenAccount?: string;
	createDestinationAtaIfMissing: boolean;
};

type StakeDelegateIntent = {
	type: "solana.stake.delegate";
	stakeAuthorityAddress: string;
	stakeAccountAddress: string;
	voteAccountAddress: string;
};

type StakeCreateAndDelegateIntent = {
	type: "solana.stake.createAndDelegate";
	stakeAuthorityAddress: string;
	withdrawAuthorityAddress: string;
	stakeAccountAddress: string;
	stakeSeed: string;
	voteAccountAddress: string;
	amountSol: number;
	lamports: number;
};

type StakeAuthorizeIntent =
	| {
			type: "solana.stake.authorizeStaker";
			stakeAuthorityAddress: string;
			stakeAccountAddress: string;
			newAuthorityAddress: string;
	  }
	| {
			type: "solana.stake.authorizeWithdrawer";
			stakeAuthorityAddress: string;
			stakeAccountAddress: string;
			newAuthorityAddress: string;
	  };

type StakeDeactivateIntent = {
	type: "solana.stake.deactivate";
	stakeAuthorityAddress: string;
	stakeAccountAddress: string;
};

type StakeWithdrawIntent = {
	type: "solana.stake.withdraw";
	withdrawAuthorityAddress: string;
	stakeAccountAddress: string;
	toAddress: string;
	amountSol: number;
	lamports: number;
};

type KaminoDepositIntent = {
	type: "solana.lend.kamino.deposit";
	ownerAddress: string;
	marketAddress: string;
	programId?: string;
	reserveMint: string;
	amountRaw: string;
	useV2Ixs: boolean;
	includeAtaIxs: boolean;
	extraComputeUnits?: number;
	requestElevationGroup: boolean;
};

type KaminoBorrowIntent = {
	type: "solana.lend.kamino.borrow";
	ownerAddress: string;
	marketAddress: string;
	programId?: string;
	reserveMint: string;
	amountRaw: string;
	useV2Ixs: boolean;
	includeAtaIxs: boolean;
	extraComputeUnits?: number;
	requestElevationGroup: boolean;
};

type KaminoWithdrawIntent = {
	type: "solana.lend.kamino.withdraw";
	ownerAddress: string;
	marketAddress: string;
	programId?: string;
	reserveMint: string;
	amountRaw: string;
	useV2Ixs: boolean;
	includeAtaIxs: boolean;
	extraComputeUnits?: number;
	requestElevationGroup: boolean;
};

type KaminoRepayIntent = {
	type: "solana.lend.kamino.repay";
	ownerAddress: string;
	marketAddress: string;
	programId?: string;
	reserveMint: string;
	amountRaw: string;
	useV2Ixs: boolean;
	includeAtaIxs: boolean;
	extraComputeUnits?: number;
	requestElevationGroup: boolean;
	currentSlot?: string;
};

type KaminoDepositAndBorrowIntent = {
	type: "solana.lend.kamino.depositAndBorrow";
	ownerAddress: string;
	marketAddress: string;
	programId?: string;
	depositReserveMint: string;
	depositAmountRaw: string;
	borrowReserveMint: string;
	borrowAmountRaw: string;
	useV2Ixs: boolean;
	includeAtaIxs: boolean;
	extraComputeUnits?: number;
	requestElevationGroup: boolean;
};

type KaminoRepayAndWithdrawIntent = {
	type: "solana.lend.kamino.repayAndWithdraw";
	ownerAddress: string;
	marketAddress: string;
	programId?: string;
	repayReserveMint: string;
	repayAmountRaw: string;
	withdrawReserveMint: string;
	withdrawAmountRaw: string;
	useV2Ixs: boolean;
	includeAtaIxs: boolean;
	extraComputeUnits?: number;
	requestElevationGroup: boolean;
	currentSlot?: string;
};

type OrcaLiquidityIntentInput = {
	ownerAddress: string;
	positionMint: string;
	liquidityAmountRaw?: string;
	tokenAAmountRaw?: string;
	tokenBAmountRaw?: string;
	slippageBps?: number;
};

type OrcaIncreaseLiquidityIntent = {
	type: "solana.lp.orca.increase";
} & OrcaLiquidityIntentInput;

type OrcaDecreaseLiquidityIntent = {
	type: "solana.lp.orca.decrease";
} & OrcaLiquidityIntentInput;

type JupiterSwapIntent = {
	type: "solana.swap.jupiter" | "solana.swap.orca" | "solana.swap.meteora";
	userPublicKey: string;
	inputMint: string;
	outputMint: string;
	amountRaw: string;
	slippageBps?: number;
	swapMode: "ExactIn" | "ExactOut";
	restrictIntermediateTokens?: boolean;
	onlyDirectRoutes?: boolean;
	maxAccounts?: number;
	dexes?: string[];
	excludeDexes?: string[];
	asLegacyTransaction?: boolean;
	fallbackToJupiterOnNoRoute?: boolean;
};

type RaydiumSwapIntent = {
	type: "solana.swap.raydium";
	userPublicKey: string;
	inputMint: string;
	outputMint: string;
	amountRaw: string;
	slippageBps: number;
	txVersion: "V0" | "LEGACY";
	swapType: "BaseIn" | "BaseOut";
	computeUnitPriceMicroLamports?: string;
	wrapSol?: boolean;
	unwrapSol?: boolean;
	inputAccount?: string;
	outputAccount?: string;
};

type WorkflowIntent =
	| TransferSolIntent
	| TransferSplIntent
	| StakeCreateAndDelegateIntent
	| StakeDelegateIntent
	| StakeAuthorizeIntent
	| StakeDeactivateIntent
	| StakeWithdrawIntent
	| KaminoBorrowIntent
	| KaminoDepositAndBorrowIntent
	| KaminoDepositIntent
	| KaminoRepayIntent
	| KaminoRepayAndWithdrawIntent
	| KaminoWithdrawIntent
	| OrcaIncreaseLiquidityIntent
	| OrcaDecreaseLiquidityIntent
	| JupiterSwapIntent
	| RaydiumSwapIntent
	| {
			type: "solana.read.balance";
			address: string;
	  }
	| {
			type: "solana.read.orcaPositions";
			address: string;
	  }
	| {
			type: "solana.read.tokenBalance";
			address: string;
			tokenMint: string;
			includeToken2022: boolean;
	  }
	| {
			type: "solana.read.portfolio";
			address: string;
			includeZero: boolean;
			includeToken2022: boolean;
	  }
	| {
			type: "solana.read.defiPositions";
			address: string;
			includeZero: boolean;
			includeToken2022: boolean;
			includeStakeAccounts: boolean;
	  }
	| {
			type: "solana.read.lendingMarkets";
			protocol: "kamino";
			programId?: string;
			limitMarkets: number;
	  }
	| {
			type: "solana.read.lendingPositions";
			address: string;
			protocol: "kamino";
			programId?: string;
			limitMarkets: number;
	  };
type ReadWorkflowIntent = Extract<
	WorkflowIntent,
	{ type: `solana.read.${string}` }
>;
type TransactionWorkflowIntent = Exclude<WorkflowIntent, ReadWorkflowIntent>;

type PreparedTransaction = {
	tx: Transaction | VersionedTransaction;
	version: "legacy" | "v0";
	signedTransactions?: Array<{
		tx: Transaction | VersionedTransaction;
		version: "legacy" | "v0";
	}>;
	simulation: {
		ok: boolean;
		err: unknown;
		logs: string[];
		unitsConsumed: number | null;
	};
	context: Record<string, unknown>;
};

type KnownToken = {
	mint: string;
	decimals: number;
	aliases: string[];
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const RAY_MINT = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";
const ORCA_MINT = "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE";
const MSOL_MINT = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
const BSOL_MINT = "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1";
const BONK_MINT = "6dhTynDkYsVM7cbF7TKfC9DWB636TcEM935fq7JzL2ES";
const KNOWN_TOKENS: KnownToken[] = [
	{
		mint: SOL_MINT,
		decimals: 9,
		aliases: ["SOL", "WSOL"],
	},
	{
		mint: USDC_MINT,
		decimals: 6,
		aliases: ["USDC"],
	},
	{
		mint: USDT_MINT,
		decimals: 6,
		aliases: ["USDT"],
	},
	{
		mint: RAY_MINT,
		decimals: 6,
		aliases: ["RAY"],
	},
	{
		mint: ORCA_MINT,
		decimals: 6,
		aliases: ["ORCA"],
	},
	{
		mint: MSOL_MINT,
		decimals: 9,
		aliases: ["MSOL", "mSOL"],
	},
	{
		mint: BSOL_MINT,
		decimals: 9,
		aliases: ["BSOL", "bSOL"],
	},
	{
		mint: BONK_MINT,
		decimals: 9,
		aliases: ["BONK"],
	},
];
const TOKEN_ALIAS_MAP = new Map(
	KNOWN_TOKENS.flatMap((token) =>
		token.aliases.map((alias) => [alias.toUpperCase(), token] as const),
	),
);
const TOKEN_BY_MINT_MAP = new Map(
	KNOWN_TOKENS.map((token) => [token.mint, token] as const),
);
const TOKEN_DECIMALS_CACHE = new Map<string, number>();
const TOKEN_SYMBOL_MINT_CACHE = new Map<string, string | null>();

const BASE58_PUBLIC_KEY_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_PUBLIC_KEY_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const TOKEN_SYMBOL_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{1,15}$/;
const SWAP_KEYWORD_REGEX = /(swap|兑换|换成|换到|互换|兑成|兑为)/i;
const TRANSFER_KEYWORD_REGEX = /(transfer|send|转账|转到|发送|打款)/i;
const STAKE_OPERATION_KEYWORD_REGEX =
	/(delegate|delegation|deactivate|unstake|withdraw|authorize|change\s+authority|rotate\s+authority|委托质押|解除质押|提取质押|提取.*质押|质押.*提取|更换.*权限|变更.*权限|授权.*质押)/i;
const READ_KEYWORD_REGEX = /(balance|余额|portfolio|资产|持仓)/i;
const PORTFOLIO_KEYWORD_REGEX =
	/(portfolio|资产|持仓|all\s+balances?|全部余额|token\s+positions?)/i;
const LENDING_MARKETS_KEYWORD_REGEX =
	/(lending\s+markets?|markets?.*lending|kamino\s+markets?|借贷市场|贷款市场|借贷池)/i;
const LENDING_POSITIONS_KEYWORD_REGEX =
	/(lending|lend\s+positions?|loan\s+positions?|借贷|借款|贷款|kamino)/i;
const DEFI_POSITIONS_KEYWORD_REGEX =
	/(defi|de-fi|protocol\s+positions?|协议仓位|staking|stake|质押|farm|yield|收益)/i;
const ORCA_POSITIONS_KEYWORD_REGEX =
	/(orca.*(whirlpool|lp|liquidity|position|positions|仓位|流动性)|(whirlpool|lp|liquidity|position|positions|仓位|流动性).*orca)/i;
const ORCA_INCREASE_LIQUIDITY_KEYWORD_REGEX =
	/(orca.*(\badd\b|\bincrease\b|\bprovide\b|\bdeposit\b|增加|添加|注入).*(liquidity|lp|流动性)|(liquidity|lp|流动性).*(orca).*(\badd\b|\bincrease\b|\bprovide\b|\bdeposit\b|增加|添加|注入))/i;
const ORCA_DECREASE_LIQUIDITY_KEYWORD_REGEX =
	/(orca.*(\bremove\b|\bdecrease\b|\bwithdraw\b|\breduce\b|减少|移除|提取).*(liquidity|lp|流动性)|(liquidity|lp|流动性).*(orca).*(\bremove\b|\bdecrease\b|\bwithdraw\b|\breduce\b|减少|移除|提取))/i;
const KAMINO_DEPOSIT_KEYWORD_REGEX =
	/(kamino.*(\bdeposit\b|\bsupply\b|\blend\b|存入|出借|借出)|(\bdeposit\b|\bsupply\b|\blend\b|存入|出借|借出).*kamino)/i;
const KAMINO_BORROW_KEYWORD_REGEX =
	/(kamino.*(\bborrow\b|\bborrowed\b|\bloan\b|借入|借款)|(\bborrow\b|\bborrowed\b|\bloan\b|借入|借款).*kamino)/i;
const KAMINO_WITHDRAW_KEYWORD_REGEX =
	/(kamino.*(\bwithdraw\b|\bredeem\b|取回|赎回|提取)|(\bwithdraw\b|\bredeem\b|取回|赎回|提取).*kamino)/i;
const KAMINO_REPAY_KEYWORD_REGEX =
	/(kamino.*(\brepay\b|还款|偿还|归还)|(\brepay\b|还款|偿还|归还).*kamino)/i;
const KAMINO_DEPOSIT_AND_BORROW_KEYWORD_REGEX =
	/(kamino.*(\bdeposit\b|\bsupply\b|\blend\b|存入|出借|借出).*(\bborrow\b|\bborrowed\b|\bloan\b|借入|借款)|kamino.*(\bborrow\b|\bborrowed\b|\bloan\b|借入|借款).*(\bdeposit\b|\bsupply\b|\blend\b|存入|出借|借出))/i;
const KAMINO_REPAY_AND_WITHDRAW_KEYWORD_REGEX =
	/(kamino.*(\brepay\b|还款|偿还|归还).*(\bwithdraw\b|\bredeem\b|取回|赎回|提取)|kamino.*(\bwithdraw\b|\bredeem\b|取回|赎回|提取).*(\brepay\b|还款|偿还|归还))/i;
const ORCA_DEFAULT_DEXES = ["Orca V2", "Orca Whirlpool"] as const;
const METEORA_DEFAULT_DEXES = ["Meteora DLMM"] as const;
const RAYDIUM_DEFAULT_DEXES = ["Raydium CLMM", "Raydium CPMM"] as const;
const DEFI_TOKEN_PROFILES: Record<
	string,
	{
		symbol: string;
		protocol: string;
		category: "liquid-staking" | "dex-token" | "stablecoin";
	}
> = {
	[USDC_MINT]: {
		symbol: "USDC",
		protocol: "stablecoin",
		category: "stablecoin",
	},
	[USDT_MINT]: {
		symbol: "USDT",
		protocol: "stablecoin",
		category: "stablecoin",
	},
	[RAY_MINT]: {
		symbol: "RAY",
		protocol: "raydium",
		category: "dex-token",
	},
	[ORCA_MINT]: {
		symbol: "ORCA",
		protocol: "orca",
		category: "dex-token",
	},
	[MSOL_MINT]: {
		symbol: "mSOL",
		protocol: "marinade",
		category: "liquid-staking",
	},
	[BSOL_MINT]: {
		symbol: "bSOL",
		protocol: "blaze",
		category: "liquid-staking",
	},
};

function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const normalized = value.trim();
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

function splitDexLabels(value: string): string[] {
	return uniqueStrings(
		value
			.split(/[,，|]/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0),
	);
}

function getDexesForProtocolKeyword(keyword: string): string[] | undefined {
	const lower = keyword.toLowerCase();
	if (lower === "orca") {
		return [...ORCA_DEFAULT_DEXES];
	}
	if (lower === "meteora" || lower === "dlmm") {
		return [...METEORA_DEFAULT_DEXES];
	}
	if (lower === "raydium") {
		return [...RAYDIUM_DEFAULT_DEXES];
	}
	return undefined;
}

function getIntentTypeForProtocolKeyword(
	keyword: string,
): WorkflowIntentType | undefined {
	const lower = keyword.toLowerCase();
	if (lower === "orca") {
		return "solana.swap.orca";
	}
	if (lower === "meteora" || lower === "dlmm") {
		return "solana.swap.meteora";
	}
	if (lower === "raydium") {
		return "solana.swap.raydium";
	}
	if (lower === "jupiter") {
		return "solana.swap.jupiter";
	}
	return undefined;
}

function parseRunMode(value?: string): WorkflowRunMode {
	if (value === "analysis" || value === "simulate" || value === "execute") {
		return value;
	}
	return "execute";
}

function ensureString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${field} is required`);
	}
	return value;
}

function ensureNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${field} is required`);
	}
	return value;
}

function normalizeStakeSeed(value: unknown, runId: string): string {
	const rawSeed =
		typeof value === "string" && value.trim().length > 0
			? value.trim()
			: `w3rt-${runId}`;
	const sanitized = rawSeed.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
	if (sanitized.length === 0) {
		throw new Error(
			"stakeSeed is invalid. Provide 1-32 chars using letters, numbers, _ or -.",
		);
	}
	return sanitized;
}

function createRunId(): string {
	return `w3rt_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function createConfirmToken(
	runId: string,
	network: string,
	intent: WorkflowIntent,
) {
	const payload = JSON.stringify({
		runId,
		network,
		intent,
	});
	const digest = createHash("sha256").update(payload).digest("hex");
	return `SOL-${digest.slice(0, 12).toUpperCase()}`;
}

function isReadIntentType(intentType: WorkflowIntentType): boolean {
	return (
		intentType === "solana.read.balance" ||
		intentType === "solana.read.orcaPositions" ||
		intentType === "solana.read.tokenBalance" ||
		intentType === "solana.read.portfolio" ||
		intentType === "solana.read.defiPositions" ||
		intentType === "solana.read.lendingMarkets" ||
		intentType === "solana.read.lendingPositions"
	);
}

function getDefaultDexesForIntentType(
	intentType: WorkflowIntentType,
): string[] | undefined {
	if (intentType === "solana.swap.orca") {
		return [...ORCA_DEFAULT_DEXES];
	}
	if (intentType === "solana.swap.meteora") {
		return [...METEORA_DEFAULT_DEXES];
	}
	return undefined;
}

function isScopedJupiterIntentType(
	intentType: WorkflowIntentType,
): intentType is "solana.swap.orca" | "solana.swap.meteora" {
	return (
		intentType === "solana.swap.orca" || intentType === "solana.swap.meteora"
	);
}

function hasPositiveOutAmount(outAmount: string | null): boolean {
	return (
		typeof outAmount === "string" &&
		/^\d+$/.test(outAmount) &&
		BigInt(outAmount) > 0n
	);
}

function hasProtocolRouteAvailability(
	routePlan: unknown[],
	outAmount: string | null,
): boolean {
	return routePlan.length > 0 || hasPositiveOutAmount(outAmount);
}

function parseQuoteRouteContext(quote: unknown): {
	outAmount: string | null;
	routePlan: unknown[];
	hasRoute: boolean;
} {
	const quotePayload =
		quote && typeof quote === "object"
			? (quote as Record<string, unknown>)
			: {};
	const routePlan = Array.isArray(quotePayload.routePlan)
		? quotePayload.routePlan
		: [];
	const outAmount =
		typeof quotePayload.outAmount === "string" ? quotePayload.outAmount : null;
	return {
		outAmount,
		routePlan,
		hasRoute: hasProtocolRouteAvailability(routePlan, outAmount),
	};
}

function assertProtocolRouteAvailability(
	intentType: WorkflowIntentType,
	dexes: string[] | undefined,
	routePlan: unknown[],
	outAmount: string | null,
): void {
	if (!isScopedJupiterIntentType(intentType)) {
		return;
	}
	if (hasProtocolRouteAvailability(routePlan, outAmount)) {
		return;
	}
	const protocol = intentType === "solana.swap.orca" ? "Orca" : "Meteora";
	const resolvedDexes =
		dexes && dexes.length > 0
			? dexes
			: (getDefaultDexesForIntentType(intentType) ?? []);
	throw new Error(
		`No ${protocol} route found under dex constraints [${resolvedDexes.join(", ")}]. Set fallbackToJupiterOnNoRoute=true, try intentType=solana.swap.jupiter, or relax dex constraints.`,
	);
}

function isReadIntent(intent: WorkflowIntent): intent is ReadWorkflowIntent {
	return isReadIntentType(intent.type);
}

function createWorkflowPlan(intentType: WorkflowIntentType): string[] {
	if (isReadIntentType(intentType)) {
		return [`analysis:${intentType}`, "read:fetch", "respond:result"];
	}
	return [
		`analysis:${intentType}`,
		"simulate:transaction",
		"approval:policy",
		"execute:broadcast",
		"monitor:confirm",
	];
}

function parsePositiveNumber(value: string): number | null {
	const parsed = Number.parseFloat(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}
	return parsed;
}

function sanitizeTokenCandidate(value: string): string {
	return value.trim().replace(/^[`"' ]+|[`"'., ]+$/g, "");
}

function isTokenSymbol(value: string): boolean {
	return TOKEN_SYMBOL_PATTERN.test(value);
}

function parseMintFromCandidate(value: string): string | undefined {
	const candidate = normalizeAtPath(value);
	if (!BASE58_PUBLIC_KEY_PATTERN.test(candidate)) {
		return undefined;
	}
	try {
		return new PublicKey(candidate).toBase58();
	} catch {
		return undefined;
	}
}

function parseMintOrSymbolCandidate(value: string): string | undefined {
	const sanitized = sanitizeTokenCandidate(value);
	if (!sanitized) {
		return undefined;
	}
	const symbolToken = TOKEN_ALIAS_MAP.get(sanitized.toUpperCase());
	if (symbolToken) {
		return symbolToken.mint;
	}
	const mint = parseMintFromCandidate(sanitized);
	if (mint) {
		return mint;
	}
	if (isTokenSymbol(sanitized)) {
		return sanitized;
	}
	return undefined;
}

function parseMintOrKnownSymbolCandidate(value: string): string | undefined {
	const sanitized = sanitizeTokenCandidate(value);
	if (!sanitized) {
		return undefined;
	}
	const symbolToken = TOKEN_ALIAS_MAP.get(sanitized.toUpperCase());
	if (symbolToken) {
		return symbolToken.mint;
	}
	return parseMintFromCandidate(sanitized);
}

function formatTokenUiAmount(amountRaw: bigint, decimals: number): string {
	if (decimals <= 0) {
		return amountRaw.toString();
	}
	const base = 10n ** BigInt(decimals);
	const whole = amountRaw / base;
	const fractionRaw = amountRaw % base;
	if (fractionRaw === 0n) {
		return whole.toString();
	}
	const fraction = fractionRaw
		.toString()
		.padStart(decimals, "0")
		.replace(/0+$/, "");
	return `${whole.toString()}.${fraction}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	return value as Record<string, unknown>;
}

function parseStakePositionFromAccount(entry: {
	pubkey: PublicKey;
	account: {
		lamports: number;
		data: unknown;
	};
}) {
	const parsedData = entry.account.data as ParsedAccountData;
	if (!parsedData || typeof parsedData !== "object") {
		return null;
	}
	const parsed = asRecord(parsedData.parsed);
	if (!parsed) {
		return null;
	}
	const info = asRecord(parsed.info);
	if (!info) {
		return null;
	}
	const meta = asRecord(info.meta);
	const authorized = asRecord(meta?.authorized);
	const stake = asRecord(info.stake);
	const delegation = asRecord(stake?.delegation);
	const delegatedLamports =
		typeof delegation?.stake === "string" && /^\d+$/.test(delegation.stake)
			? delegation.stake
			: null;
	return {
		stakeAccount: entry.pubkey.toBase58(),
		state: typeof parsed.type === "string" ? parsed.type : "unknown",
		lamports: entry.account.lamports,
		lamportsUiAmount: formatTokenUiAmount(BigInt(entry.account.lamports), 9),
		delegatedLamports,
		delegatedUiAmount:
			delegatedLamports == null
				? null
				: formatTokenUiAmount(BigInt(delegatedLamports), 9),
		voter:
			typeof delegation?.voter === "string"
				? (delegation.voter as string)
				: null,
		activationEpoch:
			typeof delegation?.activationEpoch === "string"
				? (delegation.activationEpoch as string)
				: null,
		deactivationEpoch:
			typeof delegation?.deactivationEpoch === "string"
				? (delegation.deactivationEpoch as string)
				: null,
		staker:
			typeof authorized?.staker === "string"
				? (authorized.staker as string)
				: null,
		withdrawer:
			typeof authorized?.withdrawer === "string"
				? (authorized.withdrawer as string)
				: null,
	};
}

function registerResolvedTokenSymbol(
	symbol: string,
	mint: string,
	decimals: number,
): void {
	const upper = symbol.toUpperCase();
	const token: KnownToken = {
		mint,
		decimals,
		aliases: [upper],
	};
	TOKEN_ALIAS_MAP.set(upper, token);
	TOKEN_BY_MINT_MAP.set(mint, token);
	TOKEN_DECIMALS_CACHE.set(mint, decimals);
	TOKEN_SYMBOL_MINT_CACHE.set(upper, mint);
}

function parseRemoteDecimals(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}
	if (typeof value === "string" && /^\d+$/.test(value)) {
		return Number.parseInt(value, 10);
	}
	return undefined;
}

function parseRemoteTokenEntry(value: unknown): {
	symbol: string;
	mint: string;
	decimals: number;
	priority: number;
} | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const entry = value as Record<string, unknown>;
	const symbolRaw =
		typeof entry.symbol === "string"
			? entry.symbol
			: typeof entry.ticker === "string"
				? entry.ticker
				: null;
	const mintRaw =
		typeof entry.address === "string"
			? entry.address
			: typeof entry.mint === "string"
				? entry.mint
				: null;
	const decimalsRaw = parseRemoteDecimals(entry.decimals);
	if (!symbolRaw || !mintRaw || decimalsRaw === undefined) {
		return null;
	}
	if (decimalsRaw < 0 || decimalsRaw > 18) {
		return null;
	}
	const mint = parseMintFromCandidate(mintRaw);
	if (!mint) {
		return null;
	}
	const chainId =
		typeof entry.chainId === "number" && Number.isInteger(entry.chainId)
			? entry.chainId
			: undefined;
	const priority = chainId === 101 ? 1 : 0;
	return {
		symbol: symbolRaw,
		mint,
		decimals: decimalsRaw,
		priority,
	};
}

function findTokenEntries(payload: unknown): unknown[] {
	if (Array.isArray(payload)) {
		return payload;
	}
	if (payload && typeof payload === "object") {
		const object = payload as Record<string, unknown>;
		if (Array.isArray(object.data)) {
			return object.data;
		}
		if (Array.isArray(object.tokens)) {
			return object.tokens;
		}
		return [object];
	}
	return [];
}

async function resolveTokenSymbolViaJupiter(
	symbol: string,
): Promise<string | undefined> {
	const upper = symbol.toUpperCase();
	const cachedMint = TOKEN_SYMBOL_MINT_CACHE.get(upper);
	if (cachedMint !== undefined) {
		return cachedMint ?? undefined;
	}

	const local = TOKEN_ALIAS_MAP.get(upper);
	if (local) {
		TOKEN_SYMBOL_MINT_CACHE.set(upper, local.mint);
		return local.mint;
	}

	const queries: Array<Record<string, string | number>> = [
		{ query: upper, limit: 25 },
		{ q: upper, limit: 25 },
		{ symbol: upper, limit: 25 },
	];

	for (const query of queries) {
		try {
			const payload = await callJupiterApi("/tokens/v1/search", {
				method: "GET",
				query,
				timeoutMs: 5_000,
			});
			const entries = findTokenEntries(payload);
			let best: {
				symbol: string;
				mint: string;
				decimals: number;
				priority: number;
			} | null = null;
			for (const entry of entries) {
				const candidate = parseRemoteTokenEntry(entry);
				if (!candidate) {
					continue;
				}
				if (candidate.symbol.toUpperCase() !== upper) {
					continue;
				}
				if (!best || candidate.priority > best.priority) {
					best = candidate;
				}
			}
			if (best) {
				registerResolvedTokenSymbol(upper, best.mint, best.decimals);
				return best.mint;
			}
		} catch {
			// Ignore unavailable token index endpoints and fallback to local aliases.
		}
	}

	TOKEN_SYMBOL_MINT_CACHE.set(upper, null);
	return undefined;
}

function getKnownTokenByMint(mint: string): KnownToken | undefined {
	return TOKEN_BY_MINT_MAP.get(mint);
}

function getTokenDecimalsByMint(mint: string): number | undefined {
	return getKnownTokenByMint(mint)?.decimals ?? TOKEN_DECIMALS_CACHE.get(mint);
}

function parseMintDecimals(accountData: ParsedAccountData): number | null {
	const parsed = accountData.parsed;
	if (!parsed || typeof parsed !== "object") {
		return null;
	}
	const info = (parsed as Record<string, unknown>).info;
	if (!info || typeof info !== "object") {
		return null;
	}
	const decimals = (info as Record<string, unknown>).decimals;
	if (
		typeof decimals !== "number" ||
		!Number.isInteger(decimals) ||
		decimals < 0 ||
		decimals > 18
	) {
		return null;
	}
	return decimals;
}

async function fetchTokenDecimals(
	network: string,
	mintAddress: string,
): Promise<number> {
	const cached = getTokenDecimalsByMint(mintAddress);
	if (cached !== undefined) {
		return cached;
	}
	const connection = getConnection(network);
	const mint = new PublicKey(mintAddress);
	const accountInfo = await connection.getParsedAccountInfo(mint);
	if (!accountInfo.value) {
		throw new Error(
			`Cannot infer amountRaw: mint account not found for inputMint=${mintAddress}.`,
		);
	}
	if (typeof accountInfo.value.data !== "object") {
		throw new Error(
			`Cannot infer amountRaw: mint account is not parsed for inputMint=${mintAddress}.`,
		);
	}
	const parsedData = accountInfo.value.data;
	if (!("parsed" in parsedData)) {
		throw new Error(
			`Cannot infer amountRaw: mint account is not parsed for inputMint=${mintAddress}.`,
		);
	}
	const decimals = parseMintDecimals(parsedData as ParsedAccountData);
	if (decimals == null) {
		throw new Error(
			`Cannot infer amountRaw: mint decimals unavailable for inputMint=${mintAddress}.`,
		);
	}
	TOKEN_DECIMALS_CACHE.set(mintAddress, decimals);
	return decimals;
}

function normalizeMintCandidate(value: string): string | undefined {
	const sanitized = sanitizeTokenCandidate(value);
	if (!sanitized) {
		return undefined;
	}
	const symbolToken = TOKEN_ALIAS_MAP.get(sanitized.toUpperCase());
	if (symbolToken) {
		return symbolToken.mint;
	}
	return parseMintFromCandidate(sanitized);
}

function decimalUiAmountToRaw(
	amountUi: string,
	decimals: number,
	field: string,
): string {
	const trimmed = amountUi.trim();
	const match = trimmed.match(/^([0-9]+)(?:\.([0-9]+))?$/);
	if (!match) {
		throw new Error(`${field} must be a positive decimal string`);
	}
	const whole = match[1] ?? "0";
	const fraction = match[2] ?? "";
	if (fraction.length > decimals) {
		throw new Error(
			`${field} has too many decimal places for token decimals=${decimals}`,
		);
	}
	const base = 10n ** BigInt(decimals);
	const wholeRaw = BigInt(whole) * base;
	const paddedFraction = fraction.padEnd(decimals, "0");
	const fractionRaw = paddedFraction.length > 0 ? BigInt(paddedFraction) : 0n;
	const raw = wholeRaw + fractionRaw;
	if (raw <= 0n) {
		throw new Error(`${field} must be positive`);
	}
	return raw.toString();
}

function parseUiAmountWithToken(intentText: string): ParsedIntentTextFields {
	const parsed: ParsedIntentTextFields = {};
	const matches = intentText.matchAll(
		/([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z][A-Za-z0-9._-]{1,15}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/gi,
	);
	for (const match of matches) {
		const amountUi = match[1];
		const tokenCandidate = match[2];
		if (!amountUi || !tokenCandidate) {
			continue;
		}
		const candidate = parseMintOrSymbolCandidate(tokenCandidate);
		if (!candidate) {
			continue;
		}
		parsed.amountUi = amountUi;
		parsed.inputMint = candidate;
		if (
			candidate === SOL_MINT ||
			sanitizeTokenCandidate(tokenCandidate).toUpperCase() === "SOL" ||
			sanitizeTokenCandidate(tokenCandidate).toUpperCase() === "WSOL"
		) {
			const amountSol = parsePositiveNumber(amountUi);
			if (amountSol != null) {
				parsed.amountSol = amountSol;
			}
		}
		break;
	}
	return parsed;
}

function parseTransferIntentText(intentText: string): ParsedIntentTextFields {
	const parsed: ParsedIntentTextFields = {
		intentType: "solana.transfer.sol",
	};
	const toMatch = intentText.match(
		/(?:\bto\b|->|=>|到|给)\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i,
	);
	if (toMatch?.[1]) {
		parsed.toAddress = toMatch[1];
	}
	if (!parsed.toAddress) {
		const addresses = intentText.match(BASE58_PUBLIC_KEY_REGEX);
		if (addresses && addresses.length > 0) {
			parsed.toAddress = addresses[addresses.length - 1];
		}
	}
	const tokenMintMatch = intentText.match(
		/\btokenMint\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})\b/i,
	);
	const tokenMint = tokenMintMatch?.[1]
		? parseMintOrSymbolCandidate(tokenMintMatch[1])
		: undefined;
	if (tokenMint) {
		parsed.tokenMint = tokenMint;
	}
	const amountRawMatch =
		intentText.match(/\bamountRaw\s*[=:]\s*([0-9]+)\b/i) ??
		intentText.match(/\b([0-9]+)\s*raw\b/i);
	if (amountRawMatch?.[1]) {
		parsed.amountRaw = amountRawMatch[1];
	}
	const amountUiMatch = intentText.match(
		/\b(?:amount|amountUi)\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i,
	);
	if (amountUiMatch?.[1]) {
		parsed.amountUi = amountUiMatch[1];
	}
	const uiAmountWithToken = parseUiAmountWithToken(intentText);
	if (uiAmountWithToken.inputMint) {
		if (uiAmountWithToken.inputMint === SOL_MINT) {
			if (typeof uiAmountWithToken.amountSol === "number") {
				parsed.amountSol = parsed.amountSol ?? uiAmountWithToken.amountSol;
			}
		} else {
			parsed.tokenMint = parsed.tokenMint ?? uiAmountWithToken.inputMint;
			if (uiAmountWithToken.amountUi) {
				parsed.amountUi = parsed.amountUi ?? uiAmountWithToken.amountUi;
			}
		}
	}
	const amountMatch =
		intentText.match(/\bamountSol\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i) ??
		intentText.match(/([0-9]+(?:\.[0-9]+)?)\s*sol\b/i);
	if (amountMatch?.[1]) {
		const amountSol = parsePositiveNumber(amountMatch[1]);
		if (amountSol != null) {
			parsed.amountSol = amountSol;
		}
	}
	if (parsed.tokenMint === SOL_MINT) {
		if (parsed.amountSol === undefined && parsed.amountUi) {
			const amountSol = parsePositiveNumber(parsed.amountUi);
			if (amountSol != null) {
				parsed.amountSol = amountSol;
			}
		}
		parsed.tokenMint = undefined;
	}
	if (parsed.tokenMint || /\bspl\b/i.test(intentText)) {
		parsed.intentType = "solana.transfer.spl";
	}
	return parsed;
}

function parseKaminoIntentText(
	intentText: string,
	intentType:
		| "solana.lend.kamino.borrow"
		| "solana.lend.kamino.deposit"
		| "solana.lend.kamino.repay"
		| "solana.lend.kamino.withdraw",
): ParsedIntentTextFields {
	const parsed: ParsedIntentTextFields = {
		...parseKaminoCommonIntentText(intentText),
		intentType,
	};
	const reserveMintMatch = intentText.match(
		/\b(?:reserveMint|tokenMint|mint)\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})\b/i,
	);
	if (reserveMintMatch?.[1]) {
		const reserveMint = parseMintOrSymbolCandidate(reserveMintMatch[1]);
		if (reserveMint) {
			parsed.reserveMint = reserveMint;
		}
	}
	const amountRawMatch =
		intentText.match(/\bamountRaw\s*[=:]\s*([0-9]+)\b/i) ??
		intentText.match(/\b([0-9]+)\s*raw\b/i);
	if (amountRawMatch?.[1]) {
		parsed.amountRaw = amountRawMatch[1];
	}
	const amountUiMatch = intentText.match(
		/\b(?:amount|amountUi)\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i,
	);
	if (amountUiMatch?.[1]) {
		parsed.amountUi = amountUiMatch[1];
	}
	const amountSolMatch =
		intentText.match(/\bamountSol\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i) ??
		intentText.match(/([0-9]+(?:\.[0-9]+)?)\s*sol\b/i);
	if (amountSolMatch?.[1]) {
		const amountSol = parsePositiveNumber(amountSolMatch[1]);
		if (amountSol != null) {
			parsed.amountSol = amountSol;
		}
	}
	const uiAmountWithToken = parseUiAmountWithToken(intentText);
	if (uiAmountWithToken.inputMint) {
		parsed.reserveMint = parsed.reserveMint ?? uiAmountWithToken.inputMint;
		if (uiAmountWithToken.amountUi) {
			parsed.amountUi = parsed.amountUi ?? uiAmountWithToken.amountUi;
		}
		if (
			parsed.amountSol === undefined &&
			typeof uiAmountWithToken.amountSol === "number"
		) {
			parsed.amountSol = uiAmountWithToken.amountSol;
		}
	}
	return parsed;
}

function parseKaminoCommonIntentText(
	intentText: string,
): ParsedIntentTextFields {
	const parsed: ParsedIntentTextFields = {
		protocol: "kamino",
	};
	const ownerAddressMatch = intentText.match(
		/\bownerAddress\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (ownerAddressMatch?.[1]) {
		parsed.ownerAddress = ownerAddressMatch[1];
	}
	const marketAddressMatch = intentText.match(
		/\bmarketAddress\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (marketAddressMatch?.[1]) {
		parsed.marketAddress = marketAddressMatch[1];
	}
	const programIdMatch = intentText.match(
		/\bprogramId\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (programIdMatch?.[1]) {
		parsed.programId = programIdMatch[1];
	}
	if (/\buseV2Ixs\s*[=:]\s*false\b/i.test(intentText)) {
		parsed.useV2Ixs = false;
	}
	if (/\bincludeAtaIxs\s*[=:]\s*false\b/i.test(intentText)) {
		parsed.includeAtaIxs = false;
	}
	const extraComputeUnitsMatch = intentText.match(
		/\bextraComputeUnits\s*[=:]\s*([0-9]+)\b/i,
	);
	if (extraComputeUnitsMatch?.[1]) {
		const extraComputeUnits = Number.parseInt(extraComputeUnitsMatch[1], 10);
		if (Number.isInteger(extraComputeUnits) && extraComputeUnits >= 0) {
			parsed.extraComputeUnits = extraComputeUnits;
		}
	}
	if (/\brequestElevationGroup\s*[=:]\s*true\b/i.test(intentText)) {
		parsed.requestElevationGroup = true;
	}
	const currentSlotMatch = intentText.match(
		/\bcurrentSlot\s*[=:]\s*([0-9]+)\b/i,
	);
	if (currentSlotMatch?.[1]) {
		parsed.currentSlot = currentSlotMatch[1];
	}
	return parsed;
}

function parseKaminoVerbAmountAndMint(
	intentText: string,
	verbPattern: string,
): {
	amountUi?: string;
	reserveMint?: string;
} {
	const tokenPattern =
		"([A-Za-z][A-Za-z0-9._-]{1,15}|[1-9A-HJ-NP-Za-km-z]{32,44})";
	const match = intentText.match(
		new RegExp(
			`(?:${verbPattern})\\s*([0-9]+(?:\\.[0-9]+)?)\\s*${tokenPattern}\\b`,
			"i",
		),
	);
	const amountUi = match?.[1];
	const tokenCandidate = match?.[2];
	if (!amountUi || !tokenCandidate) {
		return {};
	}
	const reserveMint = parseMintOrSymbolCandidate(tokenCandidate);
	return {
		amountUi,
		...(reserveMint ? { reserveMint } : {}),
	};
}

function parseKaminoComboIntentText(
	intentText: string,
	intentType:
		| "solana.lend.kamino.depositAndBorrow"
		| "solana.lend.kamino.repayAndWithdraw",
): ParsedIntentTextFields {
	const parsed: ParsedIntentTextFields = {
		...parseKaminoCommonIntentText(intentText),
		intentType,
	};

	if (intentType === "solana.lend.kamino.depositAndBorrow") {
		const depositReserveMintMatch = intentText.match(
			/\b(?:depositReserveMint|depositMint)\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})\b/i,
		);
		if (depositReserveMintMatch?.[1]) {
			const depositReserveMint = parseMintOrSymbolCandidate(
				depositReserveMintMatch[1],
			);
			if (depositReserveMint) {
				parsed.depositReserveMint = depositReserveMint;
			}
		}
		const depositAmountRawMatch = intentText.match(
			/\bdepositAmountRaw\s*[=:]\s*([0-9]+)\b/i,
		);
		if (depositAmountRawMatch?.[1]) {
			parsed.depositAmountRaw = depositAmountRawMatch[1];
		}
		const depositAmountUiMatch = intentText.match(
			/\b(?:depositAmountUi|depositAmount)\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i,
		);
		if (depositAmountUiMatch?.[1]) {
			parsed.depositAmountUi = depositAmountUiMatch[1];
		}
		const depositLeg = parseKaminoVerbAmountAndMint(
			intentText,
			"\\bdeposit\\b|\\bsupply\\b|\\blend\\b|存入|出借|借出",
		);
		if (!parsed.depositReserveMint && depositLeg.reserveMint) {
			parsed.depositReserveMint = depositLeg.reserveMint;
		}
		if (!parsed.depositAmountUi && depositLeg.amountUi) {
			parsed.depositAmountUi = depositLeg.amountUi;
		}

		const borrowReserveMintMatch = intentText.match(
			/\b(?:borrowReserveMint|borrowMint)\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})\b/i,
		);
		if (borrowReserveMintMatch?.[1]) {
			const borrowReserveMint = parseMintOrSymbolCandidate(
				borrowReserveMintMatch[1],
			);
			if (borrowReserveMint) {
				parsed.borrowReserveMint = borrowReserveMint;
			}
		}
		const borrowAmountRawMatch = intentText.match(
			/\bborrowAmountRaw\s*[=:]\s*([0-9]+)\b/i,
		);
		if (borrowAmountRawMatch?.[1]) {
			parsed.borrowAmountRaw = borrowAmountRawMatch[1];
		}
		const borrowAmountUiMatch = intentText.match(
			/\b(?:borrowAmountUi|borrowAmount)\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i,
		);
		if (borrowAmountUiMatch?.[1]) {
			parsed.borrowAmountUi = borrowAmountUiMatch[1];
		}
		const borrowLeg = parseKaminoVerbAmountAndMint(
			intentText,
			"\\bborrow\\b|\\bborrowed\\b|\\bloan\\b|借入|借款",
		);
		if (!parsed.borrowReserveMint && borrowLeg.reserveMint) {
			parsed.borrowReserveMint = borrowLeg.reserveMint;
		}
		if (!parsed.borrowAmountUi && borrowLeg.amountUi) {
			parsed.borrowAmountUi = borrowLeg.amountUi;
		}
		return parsed;
	}

	const repayReserveMintMatch = intentText.match(
		/\b(?:repayReserveMint|repayMint)\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})\b/i,
	);
	if (repayReserveMintMatch?.[1]) {
		const repayReserveMint = parseMintOrSymbolCandidate(
			repayReserveMintMatch[1],
		);
		if (repayReserveMint) {
			parsed.repayReserveMint = repayReserveMint;
		}
	}
	const repayAmountRawMatch = intentText.match(
		/\brepayAmountRaw\s*[=:]\s*([0-9]+)\b/i,
	);
	if (repayAmountRawMatch?.[1]) {
		parsed.repayAmountRaw = repayAmountRawMatch[1];
	}
	const repayAmountUiMatch = intentText.match(
		/\b(?:repayAmountUi|repayAmount)\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i,
	);
	if (repayAmountUiMatch?.[1]) {
		parsed.repayAmountUi = repayAmountUiMatch[1];
	}
	const repayLeg = parseKaminoVerbAmountAndMint(
		intentText,
		"\\brepay\\b|还款|偿还|归还",
	);
	if (!parsed.repayReserveMint && repayLeg.reserveMint) {
		parsed.repayReserveMint = repayLeg.reserveMint;
	}
	if (!parsed.repayAmountUi && repayLeg.amountUi) {
		parsed.repayAmountUi = repayLeg.amountUi;
	}

	const withdrawReserveMintMatch = intentText.match(
		/\b(?:withdrawReserveMint|withdrawMint)\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})\b/i,
	);
	if (withdrawReserveMintMatch?.[1]) {
		const withdrawReserveMint = parseMintOrSymbolCandidate(
			withdrawReserveMintMatch[1],
		);
		if (withdrawReserveMint) {
			parsed.withdrawReserveMint = withdrawReserveMint;
		}
	}
	const withdrawAmountRawMatch = intentText.match(
		/\bwithdrawAmountRaw\s*[=:]\s*([0-9]+)\b/i,
	);
	if (withdrawAmountRawMatch?.[1]) {
		parsed.withdrawAmountRaw = withdrawAmountRawMatch[1];
	}
	const withdrawAmountUiMatch = intentText.match(
		/\b(?:withdrawAmountUi|withdrawAmount)\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i,
	);
	if (withdrawAmountUiMatch?.[1]) {
		parsed.withdrawAmountUi = withdrawAmountUiMatch[1];
	}
	const withdrawLeg = parseKaminoVerbAmountAndMint(
		intentText,
		"\\bwithdraw\\b|\\bredeem\\b|取回|赎回|提取",
	);
	if (!parsed.withdrawReserveMint && withdrawLeg.reserveMint) {
		parsed.withdrawReserveMint = withdrawLeg.reserveMint;
	}
	if (!parsed.withdrawAmountUi && withdrawLeg.amountUi) {
		parsed.withdrawAmountUi = withdrawLeg.amountUi;
	}
	return parsed;
}

function parseKaminoBorrowIntentText(
	intentText: string,
): ParsedIntentTextFields {
	return parseKaminoIntentText(intentText, "solana.lend.kamino.borrow");
}

function parseKaminoDepositIntentText(
	intentText: string,
): ParsedIntentTextFields {
	return parseKaminoIntentText(intentText, "solana.lend.kamino.deposit");
}

function parseKaminoRepayIntentText(
	intentText: string,
): ParsedIntentTextFields {
	return parseKaminoIntentText(intentText, "solana.lend.kamino.repay");
}

function parseKaminoWithdrawIntentText(
	intentText: string,
): ParsedIntentTextFields {
	return parseKaminoIntentText(intentText, "solana.lend.kamino.withdraw");
}

function parseKaminoDepositAndBorrowIntentText(
	intentText: string,
): ParsedIntentTextFields {
	return parseKaminoComboIntentText(
		intentText,
		"solana.lend.kamino.depositAndBorrow",
	);
}

function parseKaminoRepayAndWithdrawIntentText(
	intentText: string,
): ParsedIntentTextFields {
	return parseKaminoComboIntentText(
		intentText,
		"solana.lend.kamino.repayAndWithdraw",
	);
}

function parseOrcaLiquidityIntentText(
	intentText: string,
): ParsedIntentTextFields {
	const parsed: ParsedIntentTextFields = {};
	const lower = intentText.toLowerCase();
	if (lower.includes("solana.lp.orca.increase")) {
		parsed.intentType = "solana.lp.orca.increase";
	} else if (lower.includes("solana.lp.orca.decrease")) {
		parsed.intentType = "solana.lp.orca.decrease";
	} else if (ORCA_DECREASE_LIQUIDITY_KEYWORD_REGEX.test(intentText)) {
		parsed.intentType = "solana.lp.orca.decrease";
	} else if (ORCA_INCREASE_LIQUIDITY_KEYWORD_REGEX.test(intentText)) {
		parsed.intentType = "solana.lp.orca.increase";
	}
	const ownerAddressMatch = intentText.match(
		/\bownerAddress\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (ownerAddressMatch?.[1]) {
		const ownerAddress = parseMintFromCandidate(ownerAddressMatch[1]);
		if (ownerAddress) {
			parsed.ownerAddress = ownerAddress;
		}
	}
	const positionMintMatch = intentText.match(
		/\bpositionMint\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (positionMintMatch?.[1]) {
		const positionMint = parseMintFromCandidate(positionMintMatch[1]);
		if (positionMint) {
			parsed.positionMint = positionMint;
		}
	}
	const liquidityAmountRawMatch = intentText.match(
		/\bliquidityAmountRaw\s*[=:]\s*([0-9]+)\b/i,
	);
	if (liquidityAmountRawMatch?.[1]) {
		parsed.liquidityAmountRaw = liquidityAmountRawMatch[1];
	}
	const tokenAAmountRawMatch = intentText.match(
		/\btokenAAmountRaw\s*[=:]\s*([0-9]+)\b/i,
	);
	if (tokenAAmountRawMatch?.[1]) {
		parsed.tokenAAmountRaw = tokenAAmountRawMatch[1];
	}
	const tokenBAmountRawMatch = intentText.match(
		/\btokenBAmountRaw\s*[=:]\s*([0-9]+)\b/i,
	);
	if (tokenBAmountRawMatch?.[1]) {
		parsed.tokenBAmountRaw = tokenBAmountRawMatch[1];
	}
	const slippageBpsMatch = intentText.match(
		/\bslippageBps\s*[=:]\s*([0-9]+)\b/i,
	);
	if (slippageBpsMatch?.[1]) {
		const slippageBps = Number.parseInt(slippageBpsMatch[1], 10);
		if (Number.isFinite(slippageBps)) {
			parsed.slippageBps = slippageBps;
		}
	}
	return parsed;
}

function detectStakeIntentTypeFromText(
	intentText: string,
): Extract<WorkflowIntentType, `solana.stake.${string}`> | undefined {
	const lower = intentText.toLowerCase();
	if (lower.includes("solana.stake.createanddelegate")) {
		return "solana.stake.createAndDelegate";
	}
	if (lower.includes("solana.stake.authorizestaker")) {
		return "solana.stake.authorizeStaker";
	}
	if (lower.includes("solana.stake.authorizewithdrawer")) {
		return "solana.stake.authorizeWithdrawer";
	}
	if (lower.includes("solana.stake.delegate")) {
		return "solana.stake.delegate";
	}
	if (lower.includes("solana.stake.deactivate")) {
		return "solana.stake.deactivate";
	}
	if (lower.includes("solana.stake.withdraw")) {
		return "solana.stake.withdraw";
	}
	if (
		/\bwithdraw\b|\bwithdrawal\b|提取|提现/i.test(intentText) &&
		/\bstake\b|质押/i.test(intentText)
	) {
		return "solana.stake.withdraw";
	}
	if (
		/\b(authorize|set|change|rotate)\b.*\bwithdraw(er| authority)?\b/i.test(
			intentText,
		) ||
		/(更新|修改|变更|更换).*?(withdraw|withdrawer|提取权限|提币权限)/i.test(
			intentText,
		)
	) {
		return "solana.stake.authorizeWithdrawer";
	}
	if (
		/\b(authorize|set|change|rotate)\b.*\b(staker|stake authority)\b/i.test(
			intentText,
		) ||
		/(更新|修改|变更|更换).*?(staker|质押权限|stake authority)/i.test(
			intentText,
		)
	) {
		return "solana.stake.authorizeStaker";
	}
	if (
		/\b(create|new)\b.*\bstake\b|创建.*质押|新建.*质押/i.test(intentText) ||
		(/\bstake\b|质押/i.test(intentText) &&
			(/\bamountSol\s*[=:]\s*[0-9]+(?:\.[0-9]+)?\b/i.test(intentText) ||
				/[0-9]+(?:\.[0-9]+)?\s*sol\b/i.test(intentText)) &&
			(/\bvoteAccount(?:Address)?\b/i.test(intentText) ||
				/\bvalidator\b|验证者/i.test(intentText) ||
				/\bto\b|到|给/i.test(intentText)))
	) {
		return "solana.stake.createAndDelegate";
	}
	if (/\b(delegate|delegation)\b|委托质押|质押到|委托到/i.test(intentText)) {
		return "solana.stake.delegate";
	}
	if (
		/\bdeactivate\b|\bunstake\b|解除质押|取消质押|停止质押/i.test(intentText)
	) {
		return "solana.stake.deactivate";
	}
	return undefined;
}

function parseStakeIntentText(intentText: string): ParsedIntentTextFields {
	const intentType = detectStakeIntentTypeFromText(intentText);
	if (!intentType) {
		return {};
	}
	const parsed: ParsedIntentTextFields = {
		intentType,
	};
	const stakeAuthorityMatch = intentText.match(
		/\bstakeAuthority(?:Address)?\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (stakeAuthorityMatch?.[1]) {
		parsed.stakeAuthorityAddress = stakeAuthorityMatch[1];
	}
	const withdrawAuthorityMatch = intentText.match(
		/\bwithdrawAuthority(?:Address)?\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (withdrawAuthorityMatch?.[1]) {
		parsed.withdrawAuthorityAddress = withdrawAuthorityMatch[1];
	}
	const newAuthorityMatch = intentText.match(
		/\b(?:newAuthority|newAuthorityAddress|newStaker|newStakerAddress|newWithdraw(?:er|Authority)?(?:Address)?)\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (newAuthorityMatch?.[1]) {
		parsed.newAuthorityAddress = newAuthorityMatch[1];
	}
	const authorizationTypeMatch = intentText.match(
		/\bauthorizationType\s*[=:]\s*(staker|withdrawer)\b/i,
	);
	if (authorizationTypeMatch?.[1]) {
		parsed.authorizationType = authorizationTypeMatch[1].toLowerCase() as
			| "staker"
			| "withdrawer";
	}
	const stakeAccountMatch = intentText.match(
		/\bstakeAccount(?:Address)?\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (stakeAccountMatch?.[1]) {
		parsed.stakeAccountAddress = stakeAccountMatch[1];
	}
	const voteAccountMatch = intentText.match(
		/\bvoteAccount(?:Address)?\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (voteAccountMatch?.[1]) {
		parsed.voteAccountAddress = voteAccountMatch[1];
	}
	const stakeSeedMatch = intentText.match(
		/\bstakeSeed\s*[=:]\s*([A-Za-z0-9_-]{1,64})\b/i,
	);
	if (stakeSeedMatch?.[1]) {
		parsed.stakeSeed = stakeSeedMatch[1];
	}
	const toMatch = intentText.match(
		/(?:\bto\b|->|=>|到|给)\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i,
	);
	if (toMatch?.[1]) {
		parsed.toAddress = toMatch[1];
	}
	const amountSolMatch =
		intentText.match(/\bamountSol\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i) ??
		intentText.match(/([0-9]+(?:\.[0-9]+)?)\s*sol\b/i);
	if (amountSolMatch?.[1]) {
		const amountSol = parsePositiveNumber(amountSolMatch[1]);
		if (amountSol != null) {
			parsed.amountSol = amountSol;
		}
	}

	const addresses = intentText.match(BASE58_PUBLIC_KEY_REGEX) ?? [];
	if (
		intentType !== "solana.stake.createAndDelegate" &&
		!parsed.stakeAccountAddress &&
		addresses.length > 0
	) {
		parsed.stakeAccountAddress = addresses[0];
	}
	if (
		intentType === "solana.stake.createAndDelegate" &&
		!parsed.voteAccountAddress &&
		toMatch?.[1]
	) {
		parsed.voteAccountAddress = toMatch[1];
	}
	if (
		intentType === "solana.stake.createAndDelegate" &&
		!parsed.voteAccountAddress &&
		addresses.length > 0
	) {
		parsed.voteAccountAddress = addresses[addresses.length - 1];
	}
	if (
		(intentType === "solana.stake.authorizeStaker" ||
			intentType === "solana.stake.authorizeWithdrawer") &&
		!parsed.newAuthorityAddress
	) {
		const candidates = addresses.filter(
			(address) => address !== parsed.stakeAccountAddress,
		);
		if (candidates.length > 0) {
			parsed.newAuthorityAddress = candidates[candidates.length - 1];
		}
	}
	if (intentType === "solana.stake.delegate" && !parsed.voteAccountAddress) {
		const candidates = addresses.filter(
			(address) => address !== parsed.stakeAccountAddress,
		);
		if (candidates.length > 0) {
			parsed.voteAccountAddress = candidates[0];
		}
	}
	if (intentType === "solana.stake.withdraw" && !parsed.toAddress) {
		const candidates = addresses.filter(
			(address) => address !== parsed.stakeAccountAddress,
		);
		if (candidates.length > 0) {
			parsed.toAddress = candidates[candidates.length - 1];
		}
	}
	return parsed;
}

function parseReadIntentText(intentText: string): ParsedIntentTextFields {
	const parsed: ParsedIntentTextFields = {};
	const addressMatch = intentText.match(
		/\baddress\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (addressMatch?.[1]) {
		parsed.address = addressMatch[1];
	}
	if (!parsed.address) {
		const addresses = intentText.match(BASE58_PUBLIC_KEY_REGEX);
		if (addresses && addresses.length > 0) {
			parsed.address = addresses[addresses.length - 1];
		}
	}

	const tokenMintMatch = intentText.match(
		/\btokenMint\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})\b/i,
	);
	if (tokenMintMatch?.[1]) {
		const tokenMint = parseMintOrSymbolCandidate(tokenMintMatch[1]);
		if (tokenMint) {
			parsed.tokenMint = tokenMint;
		}
	}
	if (!parsed.tokenMint) {
		const tokenPatterns = [
			/([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})\s*(?:token\s*)?(?:balance|余额)/i,
			/(?:balance|余额)\s*(?:of|for|查询)?\s*([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})/i,
		];
		for (const pattern of tokenPatterns) {
			const match = intentText.match(pattern);
			const candidate = match?.[1];
			if (!candidate) {
				continue;
			}
			const tokenMint = parseMintOrKnownSymbolCandidate(candidate);
			if (tokenMint && tokenMint !== SOL_MINT) {
				parsed.tokenMint = tokenMint;
				break;
			}
		}
	}

	const protocolMatch = intentText.match(
		/\bprotocol\s*[=:]\s*([A-Za-z][A-Za-z0-9._-]{1,15})\b/i,
	);
	if (protocolMatch?.[1]) {
		parsed.protocol = protocolMatch[1].toLowerCase();
	}
	const programIdMatch = intentText.match(
		/\bprogramId\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
	);
	if (programIdMatch?.[1]) {
		parsed.programId = programIdMatch[1];
	}
	const limitMarketsMatch = intentText.match(
		/\blimitMarkets\s*[=:]\s*([0-9]{1,3})\b/i,
	);
	if (limitMarketsMatch?.[1]) {
		const limitMarkets = Number.parseInt(limitMarketsMatch[1], 10);
		if (Number.isInteger(limitMarkets) && limitMarkets > 0) {
			parsed.limitMarkets = limitMarkets;
		}
	}

	if (LENDING_MARKETS_KEYWORD_REGEX.test(intentText)) {
		parsed.intentType = "solana.read.lendingMarkets";
		if (!parsed.protocol) {
			parsed.protocol = "kamino";
		}
		return parsed;
	}
	if (LENDING_POSITIONS_KEYWORD_REGEX.test(intentText)) {
		parsed.intentType = "solana.read.lendingPositions";
		if (!parsed.protocol) {
			parsed.protocol = "kamino";
		}
		return parsed;
	}
	if (ORCA_POSITIONS_KEYWORD_REGEX.test(intentText)) {
		parsed.intentType = "solana.read.orcaPositions";
		return parsed;
	}
	if (DEFI_POSITIONS_KEYWORD_REGEX.test(intentText)) {
		parsed.intentType = "solana.read.defiPositions";
		return parsed;
	}
	if (PORTFOLIO_KEYWORD_REGEX.test(intentText)) {
		parsed.intentType = "solana.read.portfolio";
		return parsed;
	}
	if (parsed.tokenMint) {
		parsed.intentType = "solana.read.tokenBalance";
		return parsed;
	}
	parsed.intentType = "solana.read.balance";
	return parsed;
}

function detectSwapIntentTypeFromText(intentText: string): WorkflowIntentType {
	const lower = intentText.toLowerCase();
	if (lower.includes("solana.swap.raydium")) return "solana.swap.raydium";
	if (lower.includes("solana.swap.orca")) return "solana.swap.orca";
	if (lower.includes("solana.swap.meteora")) return "solana.swap.meteora";
	if (lower.includes("solana.swap.jupiter")) return "solana.swap.jupiter";

	const protocolPatterns = [
		/\b(?:only|just)\s*(?:on|via)?\s*(orca|meteora|dlmm|raydium|jupiter)\b/i,
		/\b(?:on|via)\s*(orca|meteora|dlmm|raydium|jupiter)\b/i,
		/(?:只走|仅走|只用|仅用|在|通过|走)\s*(orca|meteora|dlmm|raydium|jupiter)/i,
	];
	for (const pattern of protocolPatterns) {
		const match = intentText.match(pattern);
		const keyword = match?.[1];
		if (!keyword) continue;
		const intentType = getIntentTypeForProtocolKeyword(keyword);
		if (intentType) return intentType;
	}
	return "solana.swap.jupiter";
}

function parseSwapIntentText(intentText: string): ParsedIntentTextFields {
	const intentType = detectSwapIntentTypeFromText(intentText);
	const parsed: ParsedIntentTextFields = {
		intentType,
	};
	const inputMatch = intentText.match(
		/\binputMint\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})\b/i,
	);
	const outputMatch = intentText.match(
		/\boutputMint\s*[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})\b/i,
	);
	const inputMint = inputMatch?.[1]
		? parseMintOrSymbolCandidate(inputMatch[1])
		: undefined;
	const outputMint = outputMatch?.[1]
		? parseMintOrSymbolCandidate(outputMatch[1])
		: undefined;
	if (inputMint) {
		parsed.inputMint = inputMint;
	}
	if (outputMint) {
		parsed.outputMint = outputMint;
	}
	if (!parsed.inputMint || !parsed.outputMint) {
		const pairPattern =
			/([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})\s*(?:->|to|for|换成|换到|兑成|兑为)\s*([1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9._-]{1,15})/gi;
		let pairMatch: RegExpExecArray | null = null;
		for (const match of intentText.matchAll(pairPattern)) {
			pairMatch = match;
		}
		if (pairMatch) {
			const pairInputMint = parseMintOrSymbolCandidate(pairMatch[1]);
			const pairOutputMint = parseMintOrSymbolCandidate(pairMatch[2]);
			if (!parsed.inputMint && pairInputMint) {
				parsed.inputMint = pairInputMint;
			}
			if (!parsed.outputMint && pairOutputMint) {
				parsed.outputMint = pairOutputMint;
			}
		}
	}
	const uiAmountWithToken = parseUiAmountWithToken(intentText);
	if (uiAmountWithToken.inputMint) {
		const sameInputMint =
			!parsed.inputMint || parsed.inputMint === uiAmountWithToken.inputMint;
		if (sameInputMint) {
			parsed.inputMint = parsed.inputMint ?? uiAmountWithToken.inputMint;
			if (uiAmountWithToken.amountUi) {
				parsed.amountUi = uiAmountWithToken.amountUi;
			}
			if (
				parsed.amountSol === undefined &&
				typeof uiAmountWithToken.amountSol === "number"
			) {
				parsed.amountSol = uiAmountWithToken.amountSol;
			}
		}
	}
	const amountRawMatch =
		intentText.match(/\bamountRaw\s*[=:]\s*([0-9]+)\b/i) ??
		intentText.match(/\b([0-9]+)\s*(?:raw|lamports?)\b/i);
	if (amountRawMatch?.[1]) {
		parsed.amountRaw = amountRawMatch[1];
	}
	const amountUiMatch = intentText.match(
		/\b(?:amount|amountIn|amountUi)\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i,
	);
	if (amountUiMatch?.[1]) {
		parsed.amountUi = amountUiMatch[1];
	}
	const amountSolMatch =
		intentText.match(/\bamountSol\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i) ??
		intentText.match(/([0-9]+(?:\.[0-9]+)?)\s*sol\b/i);
	if (amountSolMatch?.[1]) {
		const amountSol = parsePositiveNumber(amountSolMatch[1]);
		if (amountSol != null) {
			parsed.amountSol = amountSol;
		}
	}
	const slippageMatch =
		intentText.match(/\bslippageBps\s*[=:]\s*([0-9]+)\b/i) ??
		intentText.match(/\b([0-9]+)\s*bps\b/i);
	if (slippageMatch?.[1]) {
		const slippageBps = Number.parseInt(slippageMatch[1], 10);
		if (Number.isInteger(slippageBps) && slippageBps > 0) {
			parsed.slippageBps = slippageBps;
		}
	}
	if (parsed.slippageBps === undefined) {
		const slippagePercentMatch =
			intentText.match(/\bslippage\s*[=:]?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i) ??
			intentText.match(/滑点\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
		if (slippagePercentMatch?.[1]) {
			const slippagePercent = parsePositiveNumber(slippagePercentMatch[1]);
			if (slippagePercent != null) {
				parsed.slippageBps = Math.round(slippagePercent * 100);
			}
		}
	}
	if (/\bexact\s*out\b|\bexactout\b/i.test(intentText)) {
		parsed.swapMode = "ExactOut";
	} else if (/\bexact\s*in\b|\bexactin\b/i.test(intentText)) {
		parsed.swapMode = "ExactIn";
	}
	const dexesMatch = intentText.match(
		/\bdexes?\s*[=:]\s*([A-Za-z0-9._\- /,|]+)/i,
	);
	if (dexesMatch?.[1]) {
		parsed.dexes = splitDexLabels(dexesMatch[1]);
	}
	const excludeDexesMatch = intentText.match(
		/\bexcludeDexes?\s*[=:]\s*([A-Za-z0-9._\- /,|]+)/i,
	);
	if (excludeDexesMatch?.[1]) {
		parsed.excludeDexes = splitDexLabels(excludeDexesMatch[1]);
	}
	const excludedProtocolDexes: string[] = [];
	for (const match of intentText.matchAll(
		/(?:exclude|without|排除|不要|不走)\s*(orca|meteora|dlmm|raydium)\b/gi,
	)) {
		const keyword = match[1];
		if (!keyword) continue;
		const dexes = getDexesForProtocolKeyword(keyword);
		if (!dexes) continue;
		excludedProtocolDexes.push(...dexes);
	}
	if (excludedProtocolDexes.length > 0) {
		parsed.excludeDexes = uniqueStrings([
			...(parsed.excludeDexes ?? []),
			...excludedProtocolDexes,
		]);
	}
	if (!parsed.dexes) {
		const defaultDexes = getDefaultDexesForIntentType(intentType);
		if (defaultDexes) {
			parsed.dexes = defaultDexes;
		}
	}
	return parsed;
}

function parseIntentTextFields(intentText: unknown): ParsedIntentTextFields {
	if (typeof intentText !== "string" || intentText.trim().length === 0) {
		return {};
	}
	const trimmed = intentText.trim();
	const lower = trimmed.toLowerCase();
	if (lower.includes("solana.read.balance")) {
		return {
			...parseReadIntentText(trimmed),
			intentType: "solana.read.balance",
		};
	}
	if (lower.includes("solana.read.orcapositions")) {
		return {
			...parseReadIntentText(trimmed),
			intentType: "solana.read.orcaPositions",
		};
	}
	if (lower.includes("solana.read.tokenbalance")) {
		return {
			...parseReadIntentText(trimmed),
			intentType: "solana.read.tokenBalance",
		};
	}
	if (lower.includes("solana.read.portfolio")) {
		return {
			...parseReadIntentText(trimmed),
			intentType: "solana.read.portfolio",
		};
	}
	if (lower.includes("solana.read.defipositions")) {
		return {
			...parseReadIntentText(trimmed),
			intentType: "solana.read.defiPositions",
		};
	}
	if (lower.includes("solana.read.lendingmarkets")) {
		return {
			...parseReadIntentText(trimmed),
			intentType: "solana.read.lendingMarkets",
		};
	}
	if (lower.includes("solana.read.lendingpositions")) {
		return {
			...parseReadIntentText(trimmed),
			intentType: "solana.read.lendingPositions",
		};
	}
	if (lower.includes("solana.transfer.sol")) {
		return parseTransferIntentText(trimmed);
	}
	if (lower.includes("solana.transfer.spl")) {
		return {
			...parseTransferIntentText(trimmed),
			intentType: "solana.transfer.spl",
		};
	}
	if (lower.includes("solana.lend.kamino.depositandborrow")) {
		return {
			...parseKaminoDepositAndBorrowIntentText(trimmed),
			intentType: "solana.lend.kamino.depositAndBorrow",
		};
	}
	if (lower.includes("solana.lend.kamino.repayandwithdraw")) {
		return {
			...parseKaminoRepayAndWithdrawIntentText(trimmed),
			intentType: "solana.lend.kamino.repayAndWithdraw",
		};
	}
	if (lower.includes("solana.lend.kamino.borrow")) {
		return {
			...parseKaminoBorrowIntentText(trimmed),
			intentType: "solana.lend.kamino.borrow",
		};
	}
	if (lower.includes("solana.lend.kamino.deposit")) {
		return {
			...parseKaminoDepositIntentText(trimmed),
			intentType: "solana.lend.kamino.deposit",
		};
	}
	if (lower.includes("solana.lend.kamino.repay")) {
		return {
			...parseKaminoRepayIntentText(trimmed),
			intentType: "solana.lend.kamino.repay",
		};
	}
	if (lower.includes("solana.lend.kamino.withdraw")) {
		return {
			...parseKaminoWithdrawIntentText(trimmed),
			intentType: "solana.lend.kamino.withdraw",
		};
	}
	if (lower.includes("solana.lp.orca.increase")) {
		return {
			...parseOrcaLiquidityIntentText(trimmed),
			intentType: "solana.lp.orca.increase",
		};
	}
	if (lower.includes("solana.lp.orca.decrease")) {
		return {
			...parseOrcaLiquidityIntentText(trimmed),
			intentType: "solana.lp.orca.decrease",
		};
	}
	if (lower.includes("solana.stake.createanddelegate")) {
		return {
			...parseStakeIntentText(trimmed),
			intentType: "solana.stake.createAndDelegate",
		};
	}
	if (lower.includes("solana.stake.authorizestaker")) {
		return {
			...parseStakeIntentText(trimmed),
			intentType: "solana.stake.authorizeStaker",
		};
	}
	if (lower.includes("solana.stake.authorizewithdrawer")) {
		return {
			...parseStakeIntentText(trimmed),
			intentType: "solana.stake.authorizeWithdrawer",
		};
	}
	if (lower.includes("solana.stake.delegate")) {
		return {
			...parseStakeIntentText(trimmed),
			intentType: "solana.stake.delegate",
		};
	}
	if (lower.includes("solana.stake.deactivate")) {
		return {
			...parseStakeIntentText(trimmed),
			intentType: "solana.stake.deactivate",
		};
	}
	if (lower.includes("solana.stake.withdraw")) {
		return {
			...parseStakeIntentText(trimmed),
			intentType: "solana.stake.withdraw",
		};
	}
	if (lower.includes("solana.swap.jupiter")) {
		return parseSwapIntentText(trimmed);
	}
	if (lower.includes("solana.swap.orca")) {
		return {
			...parseSwapIntentText(trimmed),
			intentType: "solana.swap.orca",
		};
	}
	if (lower.includes("solana.swap.meteora")) {
		return {
			...parseSwapIntentText(trimmed),
			intentType: "solana.swap.meteora",
		};
	}
	if (lower.includes("solana.swap.raydium")) {
		return {
			...parseSwapIntentText(trimmed),
			intentType: "solana.swap.raydium",
		};
	}
	const hasSwapKeywords = SWAP_KEYWORD_REGEX.test(trimmed);
	const hasTransferKeywords = TRANSFER_KEYWORD_REGEX.test(trimmed);
	const hasStakeOperationKeywords = STAKE_OPERATION_KEYWORD_REGEX.test(trimmed);
	const hasReadKeywords = READ_KEYWORD_REGEX.test(trimmed);
	if (hasSwapKeywords && !hasTransferKeywords) {
		return parseSwapIntentText(trimmed);
	}
	if (KAMINO_REPAY_AND_WITHDRAW_KEYWORD_REGEX.test(trimmed)) {
		return parseKaminoRepayAndWithdrawIntentText(trimmed);
	}
	if (KAMINO_DEPOSIT_AND_BORROW_KEYWORD_REGEX.test(trimmed)) {
		return parseKaminoDepositAndBorrowIntentText(trimmed);
	}
	if (KAMINO_REPAY_KEYWORD_REGEX.test(trimmed)) {
		return parseKaminoRepayIntentText(trimmed);
	}
	if (KAMINO_WITHDRAW_KEYWORD_REGEX.test(trimmed)) {
		return parseKaminoWithdrawIntentText(trimmed);
	}
	if (KAMINO_BORROW_KEYWORD_REGEX.test(trimmed)) {
		return parseKaminoBorrowIntentText(trimmed);
	}
	if (KAMINO_DEPOSIT_KEYWORD_REGEX.test(trimmed)) {
		return parseKaminoDepositIntentText(trimmed);
	}
	if (
		ORCA_INCREASE_LIQUIDITY_KEYWORD_REGEX.test(trimmed) ||
		ORCA_DECREASE_LIQUIDITY_KEYWORD_REGEX.test(trimmed)
	) {
		return parseOrcaLiquidityIntentText(trimmed);
	}
	if (hasStakeOperationKeywords && !hasSwapKeywords && !hasTransferKeywords) {
		return parseStakeIntentText(trimmed);
	}
	if (hasTransferKeywords && !hasSwapKeywords) {
		return parseTransferIntentText(trimmed);
	}
	if (hasReadKeywords && !hasSwapKeywords && !hasTransferKeywords) {
		return parseReadIntentText(trimmed);
	}
	const stakeFields = parseStakeIntentText(trimmed);
	if (stakeFields.intentType) {
		return stakeFields;
	}
	const orcaLiquidityFields = parseOrcaLiquidityIntentText(trimmed);
	if (
		orcaLiquidityFields.intentType ||
		orcaLiquidityFields.positionMint ||
		orcaLiquidityFields.liquidityAmountRaw ||
		orcaLiquidityFields.tokenAAmountRaw ||
		orcaLiquidityFields.tokenBAmountRaw
	) {
		return orcaLiquidityFields;
	}
	const swapFields = parseSwapIntentText(trimmed);
	if (
		swapFields.inputMint ||
		swapFields.outputMint ||
		swapFields.amountRaw ||
		swapFields.amountUi ||
		swapFields.swapMode
	) {
		return swapFields;
	}
	if (
		stakeFields.stakeAccountAddress ||
		stakeFields.voteAccountAddress ||
		stakeFields.newAuthorityAddress
	) {
		return stakeFields;
	}
	const transferFields = parseTransferIntentText(trimmed);
	if (transferFields.toAddress || transferFields.amountSol) {
		return transferFields;
	}
	const readFields = parseReadIntentText(trimmed);
	if (readFields.intentType || readFields.address || readFields.tokenMint) {
		return readFields;
	}
	return {};
}

function mergeIntentParams(
	params: Record<string, unknown>,
): Record<string, unknown> {
	const parsedFromText = parseIntentTextFields(params.intentText);
	if (Object.keys(parsedFromText).length === 0) {
		return params;
	}
	const merged: Record<string, unknown> = {
		...parsedFromText,
	};
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) {
			merged[key] = value;
		}
	}
	return merged;
}

function resolveIntentType(
	params: Record<string, unknown>,
): WorkflowIntentType {
	if (
		params.intentType === "solana.transfer.sol" ||
		params.intentType === "solana.transfer.spl" ||
		params.intentType === "solana.lend.kamino.borrow" ||
		params.intentType === "solana.lend.kamino.deposit" ||
		params.intentType === "solana.lend.kamino.depositAndBorrow" ||
		params.intentType === "solana.lend.kamino.repay" ||
		params.intentType === "solana.lend.kamino.repayAndWithdraw" ||
		params.intentType === "solana.lend.kamino.withdraw" ||
		params.intentType === "solana.stake.createAndDelegate" ||
		params.intentType === "solana.stake.delegate" ||
		params.intentType === "solana.stake.authorizeStaker" ||
		params.intentType === "solana.stake.authorizeWithdrawer" ||
		params.intentType === "solana.stake.deactivate" ||
		params.intentType === "solana.stake.withdraw" ||
		params.intentType === "solana.lp.orca.increase" ||
		params.intentType === "solana.lp.orca.decrease" ||
		params.intentType === "solana.swap.jupiter" ||
		params.intentType === "solana.swap.raydium" ||
		params.intentType === "solana.swap.orca" ||
		params.intentType === "solana.swap.meteora" ||
		params.intentType === "solana.read.balance" ||
		params.intentType === "solana.read.orcaPositions" ||
		params.intentType === "solana.read.tokenBalance" ||
		params.intentType === "solana.read.portfolio" ||
		params.intentType === "solana.read.defiPositions" ||
		params.intentType === "solana.read.lendingMarkets" ||
		params.intentType === "solana.read.lendingPositions"
	) {
		return params.intentType;
	}
	const hasOrcaLiquidityAmountField =
		typeof params.liquidityAmountRaw === "string" ||
		typeof params.tokenAAmountRaw === "string" ||
		typeof params.tokenBAmountRaw === "string";
	if (typeof params.positionMint === "string" && hasOrcaLiquidityAmountField) {
		const intentText =
			typeof params.intentText === "string" ? params.intentText : "";
		if (ORCA_DECREASE_LIQUIDITY_KEYWORD_REGEX.test(intentText)) {
			return "solana.lp.orca.decrease";
		}
		return "solana.lp.orca.increase";
	}
	if (
		typeof params.intentText === "string" &&
		ORCA_DECREASE_LIQUIDITY_KEYWORD_REGEX.test(params.intentText)
	) {
		return "solana.lp.orca.decrease";
	}
	if (
		typeof params.intentText === "string" &&
		ORCA_INCREASE_LIQUIDITY_KEYWORD_REGEX.test(params.intentText)
	) {
		return "solana.lp.orca.increase";
	}
	if (
		typeof params.address === "string" &&
		typeof params.toAddress !== "string" &&
		typeof params.inputMint !== "string" &&
		typeof params.outputMint !== "string" &&
		typeof params.amountSol !== "number" &&
		typeof params.amountRaw !== "string"
	) {
		if (
			typeof params.protocol === "string" &&
			params.protocol.trim().toLowerCase() === "orca"
		) {
			return "solana.read.orcaPositions";
		}
		if (typeof params.tokenMint === "string") {
			return "solana.read.tokenBalance";
		}
		if (typeof params.includeStakeAccounts === "boolean") {
			return "solana.read.defiPositions";
		}
		if (
			typeof params.includeZero === "boolean" ||
			typeof params.includeToken2022 === "boolean"
		) {
			return "solana.read.portfolio";
		}
		return "solana.read.balance";
	}
	if (
		typeof params.tokenMint === "string" &&
		(typeof params.toAddress === "string" ||
			typeof params.sourceTokenAccount === "string" ||
			typeof params.destinationTokenAccount === "string")
	) {
		return "solana.transfer.spl";
	}
	const hasDepositAndBorrowFields =
		(typeof params.depositReserveMint === "string" ||
			typeof params.depositMint === "string") &&
		(typeof params.depositAmountRaw === "string" ||
			typeof params.depositAmountUi === "string" ||
			typeof params.depositAmountSol === "number") &&
		(typeof params.borrowReserveMint === "string" ||
			typeof params.borrowMint === "string") &&
		(typeof params.borrowAmountRaw === "string" ||
			typeof params.borrowAmountUi === "string" ||
			typeof params.borrowAmountSol === "number");
	const hasRepayAndWithdrawFields =
		(typeof params.repayReserveMint === "string" ||
			typeof params.repayMint === "string") &&
		(typeof params.repayAmountRaw === "string" ||
			typeof params.repayAmountUi === "string" ||
			typeof params.repayAmountSol === "number") &&
		(typeof params.withdrawReserveMint === "string" ||
			typeof params.withdrawMint === "string") &&
		(typeof params.withdrawAmountRaw === "string" ||
			typeof params.withdrawAmountUi === "string" ||
			typeof params.withdrawAmountSol === "number");
	if (hasRepayAndWithdrawFields) {
		return "solana.lend.kamino.repayAndWithdraw";
	}
	if (hasDepositAndBorrowFields) {
		return "solana.lend.kamino.depositAndBorrow";
	}
	if (
		typeof params.intentText === "string" &&
		KAMINO_REPAY_AND_WITHDRAW_KEYWORD_REGEX.test(params.intentText)
	) {
		return "solana.lend.kamino.repayAndWithdraw";
	}
	if (
		typeof params.intentText === "string" &&
		KAMINO_DEPOSIT_AND_BORROW_KEYWORD_REGEX.test(params.intentText)
	) {
		return "solana.lend.kamino.depositAndBorrow";
	}
	if (
		typeof params.intentText === "string" &&
		KAMINO_REPAY_KEYWORD_REGEX.test(params.intentText)
	) {
		return "solana.lend.kamino.repay";
	}
	if (
		typeof params.intentText === "string" &&
		KAMINO_WITHDRAW_KEYWORD_REGEX.test(params.intentText)
	) {
		return "solana.lend.kamino.withdraw";
	}
	if (
		typeof params.intentText === "string" &&
		KAMINO_BORROW_KEYWORD_REGEX.test(params.intentText)
	) {
		return "solana.lend.kamino.borrow";
	}
	if (
		typeof params.intentText === "string" &&
		KAMINO_DEPOSIT_KEYWORD_REGEX.test(params.intentText)
	) {
		return "solana.lend.kamino.deposit";
	}
	const protocolHint =
		typeof params.protocol === "string"
			? params.protocol.trim().toLowerCase()
			: null;
	if (
		protocolHint === "kamino" &&
		(typeof params.reserveMint === "string" ||
			typeof params.tokenMint === "string") &&
		(typeof params.amountRaw === "string" ||
			typeof params.amountUi === "string" ||
			typeof params.amountSol === "number")
	) {
		return "solana.lend.kamino.deposit";
	}
	const stakeIntentFromText =
		typeof params.intentText === "string"
			? detectStakeIntentTypeFromText(params.intentText)
			: undefined;
	if (
		((typeof params.voteAccountAddress === "string" ||
			typeof params.stakeSeed === "string") &&
			typeof params.amountSol === "number" &&
			typeof params.stakeAccountAddress !== "string") ||
		stakeIntentFromText === "solana.stake.createAndDelegate"
	) {
		return "solana.stake.createAndDelegate";
	}
	if (
		(typeof params.voteAccountAddress === "string" &&
			typeof params.stakeAccountAddress === "string") ||
		stakeIntentFromText === "solana.stake.delegate"
	) {
		return "solana.stake.delegate";
	}
	if (
		(typeof params.newAuthorityAddress === "string" &&
			typeof params.stakeAccountAddress === "string") ||
		stakeIntentFromText === "solana.stake.authorizeStaker" ||
		stakeIntentFromText === "solana.stake.authorizeWithdrawer"
	) {
		if (
			params.authorizationType === "withdrawer" ||
			stakeIntentFromText === "solana.stake.authorizeWithdrawer"
		) {
			return "solana.stake.authorizeWithdrawer";
		}
		return "solana.stake.authorizeStaker";
	}
	if (
		(typeof params.stakeAccountAddress === "string" &&
			typeof params.toAddress === "string" &&
			typeof params.amountSol === "number") ||
		typeof params.withdrawAuthorityAddress === "string" ||
		stakeIntentFromText === "solana.stake.withdraw"
	) {
		return "solana.stake.withdraw";
	}
	if (
		typeof params.stakeAccountAddress === "string" ||
		typeof params.stakeAuthorityAddress === "string" ||
		stakeIntentFromText === "solana.stake.deactivate"
	) {
		return "solana.stake.deactivate";
	}
	if (
		typeof params.txVersion === "string" ||
		typeof params.swapType === "string" ||
		typeof params.computeUnitPriceMicroLamports === "string" ||
		(typeof params.intentText === "string" &&
			params.intentText.toLowerCase().includes("raydium"))
	) {
		return "solana.swap.raydium";
	}
	if (Array.isArray(params.dexes)) {
		const labels = params.dexes.filter(
			(entry): entry is string => typeof entry === "string",
		);
		const lowerJoined = labels.join(" ").toLowerCase();
		if (lowerJoined.includes("meteora") || lowerJoined.includes("dlmm")) {
			return "solana.swap.meteora";
		}
		if (lowerJoined.includes("orca")) {
			return "solana.swap.orca";
		}
	}
	if (
		typeof params.inputMint === "string" ||
		typeof params.outputMint === "string" ||
		typeof params.amountRaw === "string" ||
		typeof params.amountUi === "string" ||
		typeof params.slippageBps === "number"
	) {
		return "solana.swap.jupiter";
	}
	if (
		typeof params.tokenMint === "string" &&
		typeof params.toAddress !== "string" &&
		typeof params.amountRaw !== "string" &&
		typeof params.amountUi !== "string"
	) {
		return "solana.read.tokenBalance";
	}
	if (typeof params.includeZero === "boolean") {
		return "solana.read.portfolio";
	}
	if (typeof params.includeStakeAccounts === "boolean") {
		return "solana.read.defiPositions";
	}
	if (
		typeof params.intentText === "string" &&
		ORCA_POSITIONS_KEYWORD_REGEX.test(params.intentText)
	) {
		return "solana.read.orcaPositions";
	}
	if (
		typeof params.protocol === "string" &&
		params.protocol.trim().toLowerCase() === "orca" &&
		typeof params.address === "string"
	) {
		return "solana.read.orcaPositions";
	}
	if (
		typeof params.intentText === "string" &&
		LENDING_MARKETS_KEYWORD_REGEX.test(params.intentText)
	) {
		return "solana.read.lendingMarkets";
	}
	if (
		typeof params.programId === "string" ||
		typeof params.limitMarkets === "number" ||
		(typeof params.protocol === "string" &&
			params.protocol.trim().toLowerCase() === "kamino")
	) {
		if (
			typeof params.intentText === "string" &&
			LENDING_POSITIONS_KEYWORD_REGEX.test(params.intentText)
		) {
			return "solana.read.lendingPositions";
		}
		if (typeof params.address === "string") {
			return "solana.read.lendingPositions";
		}
		return "solana.read.lendingMarkets";
	}
	if (
		typeof params.intentText === "string" &&
		LENDING_POSITIONS_KEYWORD_REGEX.test(params.intentText)
	) {
		return "solana.read.lendingPositions";
	}
	if (typeof params.address === "string") {
		return "solana.read.balance";
	}
	if (
		typeof params.toAddress === "string" ||
		typeof params.amountSol === "number"
	) {
		return "solana.transfer.sol";
	}
	throw new Error(
		"intentType is required. Provide intentType or parsable intentText.",
	);
}

async function ensureMint(value: unknown, field: string): Promise<string> {
	const raw = ensureString(value, field);
	const normalized = normalizeMintCandidate(raw);
	if (normalized) {
		return normalized;
	}
	const candidate = sanitizeTokenCandidate(raw);
	if (isTokenSymbol(candidate)) {
		const resolved = await resolveTokenSymbolViaJupiter(candidate);
		if (resolved) {
			return resolved;
		}
	}
	throw new Error(`${field} is invalid`);
}

async function resolveAmountRawForMint(args: {
	network: string;
	mint: string;
	amountRaw: unknown;
	amountUi: unknown;
	amountSol: unknown;
	amountRawField: string;
	amountUiField: string;
	amountSolField: string;
}): Promise<string> {
	let amountRawValue = args.amountRaw;
	if (
		(typeof amountRawValue !== "string" ||
			amountRawValue.trim().length === 0) &&
		typeof args.amountUi === "string"
	) {
		const decimals = await fetchTokenDecimals(args.network, args.mint);
		amountRawValue = decimalUiAmountToRaw(
			args.amountUi,
			decimals,
			args.amountUiField,
		);
	}
	if (
		(typeof amountRawValue !== "string" ||
			amountRawValue.trim().length === 0) &&
		args.mint === SOL_MINT &&
		typeof args.amountSol === "number"
	) {
		amountRawValue = toLamports(
			ensureNumber(args.amountSol, args.amountSolField),
		).toString();
	}
	return parsePositiveBigInt(
		ensureString(amountRawValue, args.amountRawField),
		args.amountRawField,
	).toString();
}

function parseOptionalCurrentSlot(value: unknown): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === "string") {
		const parsedSlot = value.trim();
		if (!/^\d+$/.test(parsedSlot)) {
			throw new Error("currentSlot must be a non-negative integer");
		}
		return parsedSlot;
	}
	if (typeof value === "number") {
		if (!Number.isInteger(value) || value < 0) {
			throw new Error("currentSlot must be a non-negative integer");
		}
		return Math.floor(value).toString();
	}
	throw new Error("currentSlot must be a non-negative integer");
}

function parseOptionalOrcaSlippageBps(value: unknown): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error("slippageBps must be an integer between 0 and 10000");
	}
	const normalized = Math.floor(value);
	if (normalized < 0 || normalized > 10_000) {
		throw new Error("slippageBps must be an integer between 0 and 10000");
	}
	return normalized;
}

function parseOrcaLiquidityActionInput(params: Record<string, unknown>): {
	liquidityAmountRaw?: string;
	tokenAAmountRaw?: string;
	tokenBAmountRaw?: string;
} {
	const liquidityAmountRaw =
		typeof params.liquidityAmountRaw === "string" &&
		params.liquidityAmountRaw.trim().length > 0
			? parsePositiveBigInt(
					params.liquidityAmountRaw,
					"liquidityAmountRaw",
				).toString()
			: undefined;
	const tokenAAmountRaw =
		typeof params.tokenAAmountRaw === "string" &&
		params.tokenAAmountRaw.trim().length > 0
			? parsePositiveBigInt(
					params.tokenAAmountRaw,
					"tokenAAmountRaw",
				).toString()
			: undefined;
	const tokenBAmountRaw =
		typeof params.tokenBAmountRaw === "string" &&
		params.tokenBAmountRaw.trim().length > 0
			? parsePositiveBigInt(
					params.tokenBAmountRaw,
					"tokenBAmountRaw",
				).toString()
			: undefined;
	const providedCount = [
		liquidityAmountRaw,
		tokenAAmountRaw,
		tokenBAmountRaw,
	].filter((value) => value !== undefined).length;
	if (providedCount !== 1) {
		throw new Error(
			"Provide exactly one of liquidityAmountRaw, tokenAAmountRaw, tokenBAmountRaw",
		);
	}
	return {
		liquidityAmountRaw,
		tokenAAmountRaw,
		tokenBAmountRaw,
	};
}

async function normalizeIntent(
	params: Record<string, unknown>,
	signerPublicKey: string,
	network: string,
	runId: string,
): Promise<WorkflowIntent> {
	const normalizedParams = mergeIntentParams(params);
	const intentType = resolveIntentType(normalizedParams);
	if (intentType === "solana.read.balance") {
		const address = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.address === "string"
					? normalizedParams.address
					: signerPublicKey,
			),
		).toBase58();
		return {
			type: intentType,
			address,
		};
	}
	if (intentType === "solana.read.orcaPositions") {
		const address = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.address === "string"
					? normalizedParams.address
					: signerPublicKey,
			),
		).toBase58();
		return {
			type: intentType,
			address,
		};
	}
	if (intentType === "solana.read.tokenBalance") {
		const address = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.address === "string"
					? normalizedParams.address
					: signerPublicKey,
			),
		).toBase58();
		const tokenMint = await ensureMint(normalizedParams.tokenMint, "tokenMint");
		return {
			type: intentType,
			address,
			tokenMint,
			includeToken2022: normalizedParams.includeToken2022 !== false,
		};
	}
	if (intentType === "solana.read.portfolio") {
		const address = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.address === "string"
					? normalizedParams.address
					: signerPublicKey,
			),
		).toBase58();
		return {
			type: intentType,
			address,
			includeZero: normalizedParams.includeZero === true,
			includeToken2022: normalizedParams.includeToken2022 !== false,
		};
	}
	if (intentType === "solana.read.defiPositions") {
		const address = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.address === "string"
					? normalizedParams.address
					: signerPublicKey,
			),
		).toBase58();
		return {
			type: intentType,
			address,
			includeZero: normalizedParams.includeZero === true,
			includeToken2022: normalizedParams.includeToken2022 !== false,
			includeStakeAccounts: normalizedParams.includeStakeAccounts !== false,
		};
	}
	if (intentType === "solana.read.lendingMarkets") {
		const protocolRaw =
			typeof normalizedParams.protocol === "string"
				? normalizedParams.protocol.trim().toLowerCase()
				: "kamino";
		if (protocolRaw !== "kamino") {
			throw new Error(
				`Unsupported lending protocol: ${protocolRaw}. Supported values: kamino`,
			);
		}
		const programId =
			typeof normalizedParams.programId === "string" &&
			normalizedParams.programId.trim().length > 0
				? new PublicKey(normalizeAtPath(normalizedParams.programId)).toBase58()
				: undefined;
		let limitMarkets = 20;
		if (normalizedParams.limitMarkets !== undefined) {
			if (
				typeof normalizedParams.limitMarkets !== "number" ||
				!Number.isFinite(normalizedParams.limitMarkets)
			) {
				throw new Error("limitMarkets must be a positive integer");
			}
			limitMarkets = Math.floor(normalizedParams.limitMarkets);
			if (limitMarkets < 1 || limitMarkets > 200) {
				throw new Error("limitMarkets must be between 1 and 200");
			}
		}
		return {
			type: intentType,
			protocol: "kamino",
			programId,
			limitMarkets,
		};
	}
	if (intentType === "solana.read.lendingPositions") {
		const address = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.address === "string"
					? normalizedParams.address
					: signerPublicKey,
			),
		).toBase58();
		const protocolRaw =
			typeof normalizedParams.protocol === "string"
				? normalizedParams.protocol.trim().toLowerCase()
				: "kamino";
		if (protocolRaw !== "kamino") {
			throw new Error(
				`Unsupported lending protocol: ${protocolRaw}. Supported values: kamino`,
			);
		}
		const programId =
			typeof normalizedParams.programId === "string" &&
			normalizedParams.programId.trim().length > 0
				? new PublicKey(normalizeAtPath(normalizedParams.programId)).toBase58()
				: undefined;
		let limitMarkets = 20;
		if (normalizedParams.limitMarkets !== undefined) {
			if (
				typeof normalizedParams.limitMarkets !== "number" ||
				!Number.isFinite(normalizedParams.limitMarkets)
			) {
				throw new Error("limitMarkets must be a positive integer");
			}
			limitMarkets = Math.floor(normalizedParams.limitMarkets);
			if (limitMarkets < 1 || limitMarkets > 200) {
				throw new Error("limitMarkets must be between 1 and 200");
			}
		}
		return {
			type: intentType,
			address,
			protocol: "kamino",
			programId,
			limitMarkets,
		};
	}
	if (
		intentType === "solana.lp.orca.increase" ||
		intentType === "solana.lp.orca.decrease"
	) {
		const ownerAddress = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.ownerAddress === "string"
					? normalizedParams.ownerAddress
					: signerPublicKey,
			),
		).toBase58();
		if (ownerAddress !== signerPublicKey) {
			throw new Error(
				`ownerAddress mismatch: expected ${signerPublicKey}, got ${ownerAddress}`,
			);
		}
		const positionMint = new PublicKey(
			normalizeAtPath(
				ensureString(normalizedParams.positionMint, "positionMint"),
			),
		).toBase58();
		const liquidityAction = parseOrcaLiquidityActionInput(normalizedParams);
		return {
			type: intentType,
			ownerAddress,
			positionMint,
			...liquidityAction,
			slippageBps: parseOptionalOrcaSlippageBps(normalizedParams.slippageBps),
		};
	}
	if (intentType === "solana.lend.kamino.depositAndBorrow") {
		const ownerAddress = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.ownerAddress === "string"
					? normalizedParams.ownerAddress
					: signerPublicKey,
			),
		).toBase58();
		if (ownerAddress !== signerPublicKey) {
			throw new Error(
				`ownerAddress mismatch: expected ${signerPublicKey}, got ${ownerAddress}`,
			);
		}
		const depositReserveMint = await ensureMint(
			normalizedParams.depositReserveMint ?? normalizedParams.depositMint,
			"depositReserveMint",
		);
		const borrowReserveMint = await ensureMint(
			normalizedParams.borrowReserveMint ?? normalizedParams.borrowMint,
			"borrowReserveMint",
		);
		const depositAmountRaw = await resolveAmountRawForMint({
			network,
			mint: depositReserveMint,
			amountRaw: normalizedParams.depositAmountRaw,
			amountUi: normalizedParams.depositAmountUi,
			amountSol: normalizedParams.depositAmountSol,
			amountRawField: "depositAmountRaw",
			amountUiField: "depositAmountUi",
			amountSolField: "depositAmountSol",
		});
		const borrowAmountRaw = await resolveAmountRawForMint({
			network,
			mint: borrowReserveMint,
			amountRaw: normalizedParams.borrowAmountRaw,
			amountUi: normalizedParams.borrowAmountUi,
			amountSol: normalizedParams.borrowAmountSol,
			amountRawField: "borrowAmountRaw",
			amountUiField: "borrowAmountUi",
			amountSolField: "borrowAmountSol",
		});
		const marketInput =
			typeof normalizedParams.marketAddress === "string" &&
			normalizedParams.marketAddress.trim().length > 0
				? normalizedParams.marketAddress
				: network === "mainnet-beta"
					? KAMINO_MAINNET_MARKET_ADDRESS
					: null;
		if (!marketInput) {
			throw new Error(
				`marketAddress is required for ${intentType} when network is not mainnet-beta`,
			);
		}
		const marketAddress = new PublicKey(
			normalizeAtPath(marketInput),
		).toBase58();
		const programId =
			typeof normalizedParams.programId === "string" &&
			normalizedParams.programId.trim().length > 0
				? new PublicKey(normalizeAtPath(normalizedParams.programId)).toBase58()
				: undefined;
		const extraComputeUnits =
			typeof normalizedParams.extraComputeUnits === "number"
				? Math.floor(normalizedParams.extraComputeUnits)
				: undefined;
		if (
			extraComputeUnits !== undefined &&
			(extraComputeUnits < 0 || extraComputeUnits > 2_000_000)
		) {
			throw new Error(
				"extraComputeUnits must be an integer between 0 and 2000000",
			);
		}
		return {
			type: intentType,
			ownerAddress,
			marketAddress,
			programId,
			depositReserveMint,
			depositAmountRaw,
			borrowReserveMint,
			borrowAmountRaw,
			useV2Ixs: normalizedParams.useV2Ixs !== false,
			includeAtaIxs: normalizedParams.includeAtaIxs !== false,
			extraComputeUnits,
			requestElevationGroup: normalizedParams.requestElevationGroup === true,
		};
	}
	if (intentType === "solana.lend.kamino.repayAndWithdraw") {
		const ownerAddress = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.ownerAddress === "string"
					? normalizedParams.ownerAddress
					: signerPublicKey,
			),
		).toBase58();
		if (ownerAddress !== signerPublicKey) {
			throw new Error(
				`ownerAddress mismatch: expected ${signerPublicKey}, got ${ownerAddress}`,
			);
		}
		const repayReserveMint = await ensureMint(
			normalizedParams.repayReserveMint ?? normalizedParams.repayMint,
			"repayReserveMint",
		);
		const withdrawReserveMint = await ensureMint(
			normalizedParams.withdrawReserveMint ?? normalizedParams.withdrawMint,
			"withdrawReserveMint",
		);
		const repayAmountRaw = await resolveAmountRawForMint({
			network,
			mint: repayReserveMint,
			amountRaw: normalizedParams.repayAmountRaw,
			amountUi: normalizedParams.repayAmountUi,
			amountSol: normalizedParams.repayAmountSol,
			amountRawField: "repayAmountRaw",
			amountUiField: "repayAmountUi",
			amountSolField: "repayAmountSol",
		});
		const withdrawAmountRaw = await resolveAmountRawForMint({
			network,
			mint: withdrawReserveMint,
			amountRaw: normalizedParams.withdrawAmountRaw,
			amountUi: normalizedParams.withdrawAmountUi,
			amountSol: normalizedParams.withdrawAmountSol,
			amountRawField: "withdrawAmountRaw",
			amountUiField: "withdrawAmountUi",
			amountSolField: "withdrawAmountSol",
		});
		const marketInput =
			typeof normalizedParams.marketAddress === "string" &&
			normalizedParams.marketAddress.trim().length > 0
				? normalizedParams.marketAddress
				: network === "mainnet-beta"
					? KAMINO_MAINNET_MARKET_ADDRESS
					: null;
		if (!marketInput) {
			throw new Error(
				`marketAddress is required for ${intentType} when network is not mainnet-beta`,
			);
		}
		const marketAddress = new PublicKey(
			normalizeAtPath(marketInput),
		).toBase58();
		const programId =
			typeof normalizedParams.programId === "string" &&
			normalizedParams.programId.trim().length > 0
				? new PublicKey(normalizeAtPath(normalizedParams.programId)).toBase58()
				: undefined;
		const extraComputeUnits =
			typeof normalizedParams.extraComputeUnits === "number"
				? Math.floor(normalizedParams.extraComputeUnits)
				: undefined;
		if (
			extraComputeUnits !== undefined &&
			(extraComputeUnits < 0 || extraComputeUnits > 2_000_000)
		) {
			throw new Error(
				"extraComputeUnits must be an integer between 0 and 2000000",
			);
		}
		return {
			type: intentType,
			ownerAddress,
			marketAddress,
			programId,
			repayReserveMint,
			repayAmountRaw,
			withdrawReserveMint,
			withdrawAmountRaw,
			useV2Ixs: normalizedParams.useV2Ixs !== false,
			includeAtaIxs: normalizedParams.includeAtaIxs !== false,
			extraComputeUnits,
			requestElevationGroup: normalizedParams.requestElevationGroup === true,
			currentSlot: parseOptionalCurrentSlot(normalizedParams.currentSlot),
		};
	}
	if (
		intentType === "solana.lend.kamino.borrow" ||
		intentType === "solana.lend.kamino.deposit" ||
		intentType === "solana.lend.kamino.repay" ||
		intentType === "solana.lend.kamino.withdraw"
	) {
		const ownerAddress = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.ownerAddress === "string"
					? normalizedParams.ownerAddress
					: signerPublicKey,
			),
		).toBase58();
		if (ownerAddress !== signerPublicKey) {
			throw new Error(
				`ownerAddress mismatch: expected ${signerPublicKey}, got ${ownerAddress}`,
			);
		}
		const reserveMint = await ensureMint(
			normalizedParams.reserveMint ?? normalizedParams.tokenMint,
			"reserveMint",
		);
		const amountRaw = await resolveAmountRawForMint({
			network,
			mint: reserveMint,
			amountRaw: normalizedParams.amountRaw,
			amountUi: normalizedParams.amountUi,
			amountSol: normalizedParams.amountSol,
			amountRawField: "amountRaw",
			amountUiField: "amountUi",
			amountSolField: "amountSol",
		});
		const marketInput =
			typeof normalizedParams.marketAddress === "string" &&
			normalizedParams.marketAddress.trim().length > 0
				? normalizedParams.marketAddress
				: network === "mainnet-beta"
					? KAMINO_MAINNET_MARKET_ADDRESS
					: null;
		if (!marketInput) {
			throw new Error(
				`marketAddress is required for ${intentType} when network is not mainnet-beta`,
			);
		}
		const marketAddress = new PublicKey(
			normalizeAtPath(marketInput),
		).toBase58();
		const programId =
			typeof normalizedParams.programId === "string" &&
			normalizedParams.programId.trim().length > 0
				? new PublicKey(normalizeAtPath(normalizedParams.programId)).toBase58()
				: undefined;
		const extraComputeUnits =
			typeof normalizedParams.extraComputeUnits === "number"
				? Math.floor(normalizedParams.extraComputeUnits)
				: undefined;
		if (
			extraComputeUnits !== undefined &&
			(extraComputeUnits < 0 || extraComputeUnits > 2_000_000)
		) {
			throw new Error(
				"extraComputeUnits must be an integer between 0 and 2000000",
			);
		}
		const currentSlot = parseOptionalCurrentSlot(normalizedParams.currentSlot);
		return {
			type: intentType,
			ownerAddress,
			marketAddress,
			programId,
			reserveMint,
			amountRaw,
			useV2Ixs: normalizedParams.useV2Ixs !== false,
			includeAtaIxs: normalizedParams.includeAtaIxs !== false,
			extraComputeUnits,
			requestElevationGroup: normalizedParams.requestElevationGroup === true,
			...(intentType === "solana.lend.kamino.repay" ? { currentSlot } : {}),
		};
	}
	if (intentType === "solana.transfer.sol") {
		const toAddress = new PublicKey(
			normalizeAtPath(ensureString(normalizedParams.toAddress, "toAddress")),
		).toBase58();
		const amountSol = ensureNumber(normalizedParams.amountSol, "amountSol");
		const lamports = toLamports(amountSol);
		return {
			type: intentType,
			fromAddress: signerPublicKey,
			toAddress,
			amountSol,
			lamports,
		};
	}
	if (intentType === "solana.transfer.spl") {
		const toAddress = new PublicKey(
			normalizeAtPath(ensureString(normalizedParams.toAddress, "toAddress")),
		).toBase58();
		const tokenMint = await ensureMint(normalizedParams.tokenMint, "tokenMint");
		let amountRawValue = normalizedParams.amountRaw;
		if (
			(typeof amountRawValue !== "string" ||
				amountRawValue.trim().length === 0) &&
			typeof normalizedParams.amountUi === "string"
		) {
			const decimals = await fetchTokenDecimals(network, tokenMint);
			amountRawValue = decimalUiAmountToRaw(
				normalizedParams.amountUi,
				decimals,
				"amountUi",
			);
		}
		const amountRaw = parsePositiveBigInt(
			ensureString(amountRawValue, "amountRaw"),
			"amountRaw",
		).toString();
		const tokenProgram = parseSplTokenProgram(
			typeof normalizedParams.tokenProgram === "string"
				? normalizedParams.tokenProgram
				: undefined,
		);
		const sourceTokenAccount =
			typeof normalizedParams.sourceTokenAccount === "string"
				? new PublicKey(
						normalizeAtPath(normalizedParams.sourceTokenAccount),
					).toBase58()
				: undefined;
		const destinationTokenAccount =
			typeof normalizedParams.destinationTokenAccount === "string"
				? new PublicKey(
						normalizeAtPath(normalizedParams.destinationTokenAccount),
					).toBase58()
				: undefined;
		return {
			type: intentType,
			fromAddress: signerPublicKey,
			toAddress,
			tokenMint,
			amountRaw,
			tokenProgram,
			sourceTokenAccount,
			destinationTokenAccount,
			createDestinationAtaIfMissing:
				normalizedParams.createDestinationAtaIfMissing !== false,
		};
	}
	if (intentType === "solana.stake.createAndDelegate") {
		const voteAccountAddress = new PublicKey(
			normalizeAtPath(
				ensureString(normalizedParams.voteAccountAddress, "voteAccountAddress"),
			),
		).toBase58();
		const amountSol = ensureNumber(normalizedParams.amountSol, "amountSol");
		const lamports = toLamports(amountSol);
		const stakeAuthorityAddress = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.stakeAuthorityAddress === "string"
					? normalizedParams.stakeAuthorityAddress
					: signerPublicKey,
			),
		).toBase58();
		const withdrawAuthorityAddress = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.withdrawAuthorityAddress === "string"
					? normalizedParams.withdrawAuthorityAddress
					: signerPublicKey,
			),
		).toBase58();
		if (stakeAuthorityAddress !== signerPublicKey) {
			throw new Error(
				`stakeAuthorityAddress mismatch: expected ${signerPublicKey}, got ${stakeAuthorityAddress}`,
			);
		}
		if (withdrawAuthorityAddress !== signerPublicKey) {
			throw new Error(
				`withdrawAuthorityAddress mismatch: expected ${signerPublicKey}, got ${withdrawAuthorityAddress}`,
			);
		}
		const stakeSeed = normalizeStakeSeed(normalizedParams.stakeSeed, runId);
		const stakeAccountAddress = (
			await PublicKey.createWithSeed(
				new PublicKey(stakeAuthorityAddress),
				stakeSeed,
				StakeProgram.programId,
			)
		).toBase58();
		return {
			type: intentType,
			stakeAuthorityAddress,
			withdrawAuthorityAddress,
			stakeAccountAddress,
			stakeSeed,
			voteAccountAddress,
			amountSol,
			lamports,
		};
	}
	if (intentType === "solana.stake.delegate") {
		const stakeAccountAddress = new PublicKey(
			normalizeAtPath(
				ensureString(
					normalizedParams.stakeAccountAddress,
					"stakeAccountAddress",
				),
			),
		).toBase58();
		const voteAccountAddress = new PublicKey(
			normalizeAtPath(
				ensureString(normalizedParams.voteAccountAddress, "voteAccountAddress"),
			),
		).toBase58();
		const stakeAuthorityAddress = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.stakeAuthorityAddress === "string"
					? normalizedParams.stakeAuthorityAddress
					: signerPublicKey,
			),
		).toBase58();
		if (stakeAuthorityAddress !== signerPublicKey) {
			throw new Error(
				`stakeAuthorityAddress mismatch: expected ${signerPublicKey}, got ${stakeAuthorityAddress}`,
			);
		}
		return {
			type: intentType,
			stakeAuthorityAddress,
			stakeAccountAddress,
			voteAccountAddress,
		};
	}
	if (
		intentType === "solana.stake.authorizeStaker" ||
		intentType === "solana.stake.authorizeWithdrawer"
	) {
		const stakeAccountAddress = new PublicKey(
			normalizeAtPath(
				ensureString(
					normalizedParams.stakeAccountAddress,
					"stakeAccountAddress",
				),
			),
		).toBase58();
		const newAuthorityAddress = new PublicKey(
			normalizeAtPath(
				ensureString(
					normalizedParams.newAuthorityAddress,
					"newAuthorityAddress",
				),
			),
		).toBase58();
		const stakeAuthorityAddress = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.stakeAuthorityAddress === "string"
					? normalizedParams.stakeAuthorityAddress
					: signerPublicKey,
			),
		).toBase58();
		if (stakeAuthorityAddress !== signerPublicKey) {
			throw new Error(
				`stakeAuthorityAddress mismatch: expected ${signerPublicKey}, got ${stakeAuthorityAddress}`,
			);
		}
		return {
			type: intentType,
			stakeAuthorityAddress,
			stakeAccountAddress,
			newAuthorityAddress,
		};
	}
	if (intentType === "solana.stake.deactivate") {
		const stakeAccountAddress = new PublicKey(
			normalizeAtPath(
				ensureString(
					normalizedParams.stakeAccountAddress,
					"stakeAccountAddress",
				),
			),
		).toBase58();
		const stakeAuthorityAddress = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.stakeAuthorityAddress === "string"
					? normalizedParams.stakeAuthorityAddress
					: signerPublicKey,
			),
		).toBase58();
		if (stakeAuthorityAddress !== signerPublicKey) {
			throw new Error(
				`stakeAuthorityAddress mismatch: expected ${signerPublicKey}, got ${stakeAuthorityAddress}`,
			);
		}
		return {
			type: intentType,
			stakeAuthorityAddress,
			stakeAccountAddress,
		};
	}
	if (intentType === "solana.stake.withdraw") {
		const stakeAccountAddress = new PublicKey(
			normalizeAtPath(
				ensureString(
					normalizedParams.stakeAccountAddress,
					"stakeAccountAddress",
				),
			),
		).toBase58();
		const toAddress = new PublicKey(
			normalizeAtPath(ensureString(normalizedParams.toAddress, "toAddress")),
		).toBase58();
		const amountSol = ensureNumber(normalizedParams.amountSol, "amountSol");
		const lamports = toLamports(amountSol);
		const withdrawAuthorityAddress = new PublicKey(
			normalizeAtPath(
				typeof normalizedParams.withdrawAuthorityAddress === "string"
					? normalizedParams.withdrawAuthorityAddress
					: signerPublicKey,
			),
		).toBase58();
		if (withdrawAuthorityAddress !== signerPublicKey) {
			throw new Error(
				`withdrawAuthorityAddress mismatch: expected ${signerPublicKey}, got ${withdrawAuthorityAddress}`,
			);
		}
		return {
			type: intentType,
			withdrawAuthorityAddress,
			stakeAccountAddress,
			toAddress,
			amountSol,
			lamports,
		};
	}

	const inputMint = await ensureMint(normalizedParams.inputMint, "inputMint");
	const outputMint = await ensureMint(
		normalizedParams.outputMint,
		"outputMint",
	);
	let amountRawValue = normalizedParams.amountRaw;
	if (
		(typeof amountRawValue !== "string" ||
			amountRawValue.trim().length === 0) &&
		inputMint === SOL_MINT &&
		typeof normalizedParams.amountSol === "number"
	) {
		const amountSol = ensureNumber(normalizedParams.amountSol, "amountSol");
		amountRawValue = toLamports(amountSol).toString();
	}
	if (
		(typeof amountRawValue !== "string" ||
			amountRawValue.trim().length === 0) &&
		typeof normalizedParams.amountUi === "string"
	) {
		const decimals = await fetchTokenDecimals(network, inputMint);
		amountRawValue = decimalUiAmountToRaw(
			normalizedParams.amountUi,
			decimals,
			"amountUi",
		);
	}
	const amountRaw = parsePositiveBigInt(
		ensureString(amountRawValue, "amountRaw"),
		"amountRaw",
	).toString();
	if (intentType === "solana.swap.raydium") {
		const inputAccount =
			typeof normalizedParams.inputAccount === "string"
				? new PublicKey(
						normalizeAtPath(normalizedParams.inputAccount),
					).toBase58()
				: undefined;
		const outputAccount =
			typeof normalizedParams.outputAccount === "string"
				? new PublicKey(
						normalizeAtPath(normalizedParams.outputAccount),
					).toBase58()
				: undefined;
		const slippageBps =
			typeof normalizedParams.slippageBps === "number"
				? normalizedParams.slippageBps
				: undefined;
		if (!slippageBps) {
			throw new Error("slippageBps is required");
		}
		return {
			type: intentType,
			userPublicKey: signerPublicKey,
			inputMint,
			outputMint,
			amountRaw,
			slippageBps,
			txVersion: parseRaydiumTxVersion(
				typeof normalizedParams.txVersion === "string"
					? normalizedParams.txVersion
					: undefined,
			),
			swapType: parseRaydiumSwapType(
				typeof normalizedParams.swapType === "string"
					? normalizedParams.swapType
					: undefined,
			),
			computeUnitPriceMicroLamports:
				typeof normalizedParams.computeUnitPriceMicroLamports === "string"
					? normalizedParams.computeUnitPriceMicroLamports
					: undefined,
			wrapSol:
				typeof normalizedParams.wrapSol === "boolean"
					? normalizedParams.wrapSol
					: undefined,
			unwrapSol:
				typeof normalizedParams.unwrapSol === "boolean"
					? normalizedParams.unwrapSol
					: undefined,
			inputAccount,
			outputAccount,
		};
	}
	const explicitDexes = Array.isArray(normalizedParams.dexes)
		? normalizedParams.dexes.filter(
				(entry): entry is string => typeof entry === "string",
			)
		: undefined;
	const defaultDexes = getDefaultDexesForIntentType(intentType);
	return {
		type: intentType,
		userPublicKey: signerPublicKey,
		inputMint,
		outputMint,
		amountRaw,
		slippageBps:
			typeof normalizedParams.slippageBps === "number"
				? normalizedParams.slippageBps
				: undefined,
		swapMode: parseJupiterSwapMode(
			typeof normalizedParams.swapMode === "string"
				? normalizedParams.swapMode
				: undefined,
		),
		restrictIntermediateTokens:
			typeof normalizedParams.restrictIntermediateTokens === "boolean"
				? normalizedParams.restrictIntermediateTokens
				: undefined,
		onlyDirectRoutes:
			typeof normalizedParams.onlyDirectRoutes === "boolean"
				? normalizedParams.onlyDirectRoutes
				: undefined,
		maxAccounts:
			typeof normalizedParams.maxAccounts === "number"
				? normalizedParams.maxAccounts
				: undefined,
		dexes:
			explicitDexes && explicitDexes.length > 0 ? explicitDexes : defaultDexes,
		excludeDexes: Array.isArray(normalizedParams.excludeDexes)
			? normalizedParams.excludeDexes.filter(
					(entry): entry is string => typeof entry === "string",
				)
			: undefined,
		asLegacyTransaction:
			typeof normalizedParams.asLegacyTransaction === "boolean"
				? normalizedParams.asLegacyTransaction
				: undefined,
		fallbackToJupiterOnNoRoute:
			typeof normalizedParams.fallbackToJupiterOnNoRoute === "boolean"
				? normalizedParams.fallbackToJupiterOnNoRoute
				: undefined,
	};
}

async function buildSplTransferInstructions(
	connection: Connection,
	fromOwner: PublicKey,
	toOwner: PublicKey,
	mint: PublicKey,
	sourceTokenAccount: PublicKey,
	destinationTokenAccount: PublicKey,
	amountRaw: bigint,
	tokenProgramId: PublicKey,
	createDestinationAtaIfMissing: boolean,
): Promise<{
	instructions: TransactionInstruction[];
	destinationAtaCreateIncluded: boolean;
}> {
	const sourceInfo = await connection.getAccountInfo(sourceTokenAccount);
	if (!sourceInfo) {
		throw new Error(
			`Source token account not found: ${sourceTokenAccount.toBase58()}`,
		);
	}

	const instructions: TransactionInstruction[] = [];
	const destinationInfo = await connection.getAccountInfo(
		destinationTokenAccount,
	);
	let destinationAtaCreateIncluded = false;

	if (!destinationInfo && createDestinationAtaIfMissing) {
		instructions.push(
			createAssociatedTokenAccountInstruction(
				fromOwner,
				destinationTokenAccount,
				toOwner,
				mint,
				tokenProgramId,
				ASSOCIATED_TOKEN_PROGRAM_ID,
			),
		);
		destinationAtaCreateIncluded = true;
	}
	if (!destinationInfo && !destinationAtaCreateIncluded) {
		throw new Error(
			`Destination token account not found: ${destinationTokenAccount.toBase58()}. Set createDestinationAtaIfMissing=true or provide an existing destinationTokenAccount.`,
		);
	}

	instructions.push(
		createTransferInstruction(
			sourceTokenAccount,
			destinationTokenAccount,
			fromOwner,
			amountRaw,
			[],
			tokenProgramId,
		),
	);
	return { instructions, destinationAtaCreateIncluded };
}

function extractRaydiumTransactions(response: unknown): string[] {
	if (!response || typeof response !== "object") return [];
	const payload = response as Record<string, unknown>;
	const data = payload.data;
	if (Array.isArray(data)) {
		return data
			.map((entry) => {
				if (!entry || typeof entry !== "object") return null;
				const record = entry as Record<string, unknown>;
				return typeof record.transaction === "string"
					? record.transaction
					: null;
			})
			.filter((entry): entry is string => entry !== null);
	}
	if (data && typeof data === "object") {
		const record = data as Record<string, unknown>;
		if (typeof record.transaction === "string") {
			return [record.transaction];
		}
	}
	if (typeof payload.transaction === "string") {
		return [payload.transaction];
	}
	return [];
}

async function executeReadIntent(
	network: string,
	intent: ReadWorkflowIntent,
): Promise<{
	summary: string;
	details: Record<string, unknown>;
}> {
	const connection = getConnection(network);
	if (intent.type === "solana.read.balance") {
		const address = new PublicKey(intent.address).toBase58();
		const lamports = await connection.getBalance(new PublicKey(address));
		const sol = lamports / 1_000_000_000;
		return {
			summary: `Balance: ${sol} SOL (${lamports} lamports)`,
			details: {
				intentType: intent.type,
				address,
				lamports,
				sol,
				network,
				addressExplorer: getExplorerAddressUrl(address, network),
			},
		};
	}

	if (intent.type === "solana.read.orcaPositions") {
		const positions = await getOrcaWhirlpoolPositions({
			address: intent.address,
			network,
		});
		return {
			summary: `Orca Whirlpool positions: ${positions.positionCount} position(s) across ${positions.poolCount} pool(s)`,
			details: {
				intentType: intent.type,
				...positions,
				addressExplorer: getExplorerAddressUrl(intent.address, network),
			},
		};
	}

	if (intent.type === "solana.read.tokenBalance") {
		const owner = new PublicKey(intent.address);
		const mint = new PublicKey(intent.tokenMint);
		const [tokenProgramResponse, token2022Response] = await Promise.all([
			connection.getParsedTokenAccountsByOwner(owner, {
				programId: TOKEN_PROGRAM_ID,
			}),
			intent.includeToken2022
				? connection.getParsedTokenAccountsByOwner(owner, {
						programId: TOKEN_2022_PROGRAM_ID,
					})
				: Promise.resolve(null),
		]);
		const accounts = [
			...tokenProgramResponse.value,
			...(token2022Response?.value ?? []),
		];
		let totalAmountRaw = 0n;
		let decimals = 0;
		let tokenAccountCount = 0;
		for (const entry of accounts) {
			const tokenInfo = parseTokenAccountInfo(entry.account.data);
			if (!tokenInfo) continue;
			if (tokenInfo.mint !== mint.toBase58()) continue;
			totalAmountRaw += BigInt(tokenInfo.tokenAmount.amount);
			decimals = tokenInfo.tokenAmount.decimals;
			tokenAccountCount += 1;
		}
		const uiAmount = formatTokenUiAmount(totalAmountRaw, decimals);
		return {
			summary: `Token balance: ${uiAmount} (raw ${totalAmountRaw.toString()})`,
			details: {
				intentType: intent.type,
				address: owner.toBase58(),
				tokenMint: mint.toBase58(),
				amount: totalAmountRaw.toString(),
				uiAmount,
				decimals,
				tokenAccountCount,
				tokenProgramAccountCount: tokenProgramResponse.value.length,
				token2022AccountCount: token2022Response?.value.length ?? 0,
				network,
				addressExplorer: getExplorerAddressUrl(owner.toBase58(), network),
				tokenMintExplorer: getExplorerAddressUrl(mint.toBase58(), network),
			},
		};
	}

	if (intent.type === "solana.read.lendingMarkets") {
		const lendingMarkets = await getKaminoLendingMarkets({
			programId: intent.programId,
			limitMarkets: intent.limitMarkets,
		});
		return {
			summary: `Lending markets (${intent.protocol}): ${lendingMarkets.marketCountQueried}/${lendingMarkets.marketCount}`,
			details: {
				intentType: intent.type,
				...lendingMarkets,
				network: parseNetwork(network),
			},
		};
	}

	if (intent.type === "solana.read.lendingPositions") {
		const lending = await getKaminoLendingPositions({
			address: intent.address,
			network,
			programId: intent.programId,
			limitMarkets: intent.limitMarkets,
		});
		return {
			summary: `Lending positions (${intent.protocol}): ${lending.obligationCount} obligation(s), ${lending.depositPositionCount} deposit(s), ${lending.borrowPositionCount} borrow(s)`,
			details: {
				intentType: intent.type,
				...lending,
				addressExplorer: getExplorerAddressUrl(intent.address, network),
			},
		};
	}

	if (intent.type === "solana.read.defiPositions") {
		const owner = new PublicKey(intent.address);
		const [lamports, tokenProgramResponse, token2022Response] =
			await Promise.all([
				connection.getBalance(owner),
				connection.getParsedTokenAccountsByOwner(owner, {
					programId: TOKEN_PROGRAM_ID,
				}),
				intent.includeToken2022
					? connection.getParsedTokenAccountsByOwner(owner, {
							programId: TOKEN_2022_PROGRAM_ID,
						})
					: Promise.resolve(null),
			]);

		const tokenAccounts = [
			...tokenProgramResponse.value,
			...(token2022Response?.value ?? []),
		];
		const positions = new Map<
			string,
			{
				amountRaw: bigint;
				decimals: number;
				tokenAccountCount: number;
			}
		>();
		for (const entry of tokenAccounts) {
			const tokenInfo = parseTokenAccountInfo(entry.account.data);
			if (!tokenInfo) continue;
			const amountRaw = BigInt(tokenInfo.tokenAmount.amount);
			const existing = positions.get(tokenInfo.mint);
			if (!existing) {
				positions.set(tokenInfo.mint, {
					amountRaw,
					decimals: tokenInfo.tokenAmount.decimals,
					tokenAccountCount: 1,
				});
				continue;
			}
			existing.amountRaw += amountRaw;
			existing.tokenAccountCount += 1;
		}
		const tokens = [...positions.entries()]
			.map(([mint, position]) => ({
				mint,
				symbol: TOKEN_BY_MINT_MAP.get(mint)?.aliases[0] ?? null,
				amount: position.amountRaw.toString(),
				uiAmount: formatTokenUiAmount(position.amountRaw, position.decimals),
				decimals: position.decimals,
				tokenAccountCount: position.tokenAccountCount,
				explorer: getExplorerAddressUrl(mint, network),
			}))
			.filter((position) =>
				intent.includeZero ? true : BigInt(position.amount) > 0n,
			)
			.sort((a, b) => {
				if (a.symbol && b.symbol) return a.symbol.localeCompare(b.symbol);
				if (a.symbol) return -1;
				if (b.symbol) return 1;
				return a.mint.localeCompare(b.mint);
			});
		const defiTokenPositions = tokens
			.map((token) => {
				const profile = DEFI_TOKEN_PROFILES[token.mint];
				if (!profile) return null;
				return {
					...token,
					symbol: profile.symbol,
					protocol: profile.protocol,
					category: profile.category,
				};
			})
			.filter(
				(position): position is NonNullable<typeof position> =>
					position !== null,
			);
		const categoryExposureCounts = defiTokenPositions.reduce<
			Record<string, number>
		>((acc, position) => {
			acc[position.category] = (acc[position.category] ?? 0) + 1;
			return acc;
		}, {});
		const protocolExposureCounts = defiTokenPositions.reduce<
			Record<string, number>
		>((acc, position) => {
			acc[position.protocol] = (acc[position.protocol] ?? 0) + 1;
			return acc;
		}, {});

		let rawStakeAccounts: Array<{
			pubkey: PublicKey;
			account: {
				lamports: number;
				data: unknown;
			};
		}> = [];
		const stakeQueryErrors: string[] = [];
		if (intent.includeStakeAccounts) {
			const ownerAddress = owner.toBase58();
			const stakeFilters = [
				{ memcmp: { offset: 12, bytes: ownerAddress } },
				{ memcmp: { offset: 44, bytes: ownerAddress } },
			];
			const settled = await Promise.all(
				stakeFilters.map((filter) =>
					connection
						.getParsedProgramAccounts(StakeProgram.programId, {
							filters: [filter],
						})
						.catch((error: unknown) => {
							stakeQueryErrors.push(String(error));
							return [];
						}),
				),
			);
			const deduped = new Map<string, (typeof settled)[number][number]>();
			for (const accounts of settled) {
				for (const account of accounts) {
					deduped.set(account.pubkey.toBase58(), account);
				}
			}
			rawStakeAccounts = [...deduped.values()].map((entry) => ({
				pubkey: entry.pubkey,
				account: {
					lamports: entry.account.lamports,
					data: entry.account.data,
				},
			}));
		}
		const stakeAccounts = rawStakeAccounts
			.map((entry) => parseStakePositionFromAccount(entry))
			.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
			.sort((a, b) => a.stakeAccount.localeCompare(b.stakeAccount));
		const totalDelegatedStakeLamports = stakeAccounts.reduce(
			(total, entry) => total + BigInt(entry.delegatedLamports ?? "0"),
			0n,
		);
		const sol = lamports / 1_000_000_000;
		return {
			summary: `DeFi positions: ${defiTokenPositions.length} token exposure(s), ${stakeAccounts.length} stake account(s)`,
			details: {
				intentType: intent.type,
				address: owner.toBase58(),
				network,
				addressExplorer: getExplorerAddressUrl(owner.toBase58(), network),
				sol: {
					lamports,
					uiAmount: sol,
				},
				tokenCount: tokens.length,
				tokenAccountCount: tokenAccounts.length,
				tokenProgramAccountCount: tokenProgramResponse.value.length,
				token2022AccountCount: token2022Response?.value.length ?? 0,
				tokens,
				defiTokenPositionCount: defiTokenPositions.length,
				defiTokenPositions,
				categoryExposureCounts,
				protocolExposureCounts,
				stakeAccountCount: stakeAccounts.length,
				stakeAccounts,
				stakeQueryErrors,
				totalDelegatedStakeLamports: totalDelegatedStakeLamports.toString(),
				totalDelegatedStakeUiAmount: formatTokenUiAmount(
					totalDelegatedStakeLamports,
					9,
				),
			},
		};
	}

	const owner = new PublicKey(intent.address);
	const [lamports, tokenProgramResponse, token2022Response] = await Promise.all(
		[
			connection.getBalance(owner),
			connection.getParsedTokenAccountsByOwner(owner, {
				programId: TOKEN_PROGRAM_ID,
			}),
			intent.includeToken2022
				? connection.getParsedTokenAccountsByOwner(owner, {
						programId: TOKEN_2022_PROGRAM_ID,
					})
				: Promise.resolve(null),
		],
	);
	const tokenAccounts = [
		...tokenProgramResponse.value,
		...(token2022Response?.value ?? []),
	];
	const positions = new Map<
		string,
		{
			amountRaw: bigint;
			decimals: number;
			tokenAccountCount: number;
		}
	>();
	for (const entry of tokenAccounts) {
		const tokenInfo = parseTokenAccountInfo(entry.account.data);
		if (!tokenInfo) continue;
		const amountRaw = BigInt(tokenInfo.tokenAmount.amount);
		const existing = positions.get(tokenInfo.mint);
		if (!existing) {
			positions.set(tokenInfo.mint, {
				amountRaw,
				decimals: tokenInfo.tokenAmount.decimals,
				tokenAccountCount: 1,
			});
			continue;
		}
		existing.amountRaw += amountRaw;
		existing.tokenAccountCount += 1;
	}
	const tokens = [...positions.entries()]
		.map(([mint, position]) => ({
			mint,
			symbol: TOKEN_BY_MINT_MAP.get(mint)?.aliases[0] ?? null,
			amount: position.amountRaw.toString(),
			uiAmount: formatTokenUiAmount(position.amountRaw, position.decimals),
			decimals: position.decimals,
			tokenAccountCount: position.tokenAccountCount,
			explorer: getExplorerAddressUrl(mint, network),
		}))
		.filter((position) =>
			intent.includeZero ? true : BigInt(position.amount) > 0n,
		)
		.sort((a, b) => {
			if (a.symbol && b.symbol) return a.symbol.localeCompare(b.symbol);
			if (a.symbol) return -1;
			if (b.symbol) return 1;
			return a.mint.localeCompare(b.mint);
		});

	const sol = lamports / 1_000_000_000;
	return {
		summary: `Portfolio: ${sol} SOL + ${tokens.length} token position(s)`,
		details: {
			intentType: intent.type,
			address: owner.toBase58(),
			network,
			addressExplorer: getExplorerAddressUrl(owner.toBase58(), network),
			sol: {
				lamports,
				uiAmount: sol,
			},
			tokenCount: tokens.length,
			tokenAccountCount: tokenAccounts.length,
			tokenProgramAccountCount: tokenProgramResponse.value.length,
			token2022AccountCount: token2022Response?.value.length ?? 0,
			tokens,
		},
	};
}

async function prepareTransferSolSimulation(
	network: string,
	signer: Keypair,
	intent: TransferSolIntent,
): Promise<PreparedTransaction> {
	const connection = getConnection(network);
	const tx = new Transaction().add(
		SystemProgram.transfer({
			fromPubkey: signer.publicKey,
			toPubkey: new PublicKey(intent.toAddress),
			lamports: intent.lamports,
		}),
	);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			latestBlockhash,
			lamports: intent.lamports,
			fromAddress: intent.fromAddress,
			toAddress: intent.toAddress,
			amountSol: intent.amountSol,
		},
	};
}

async function prepareTransferSplSimulation(
	network: string,
	signer: Keypair,
	intent: TransferSplIntent,
): Promise<PreparedTransaction> {
	const connection = getConnection(network);
	const toOwner = new PublicKey(intent.toAddress);
	const mint = new PublicKey(intent.tokenMint);
	const tokenProgramId = getSplTokenProgramId(intent.tokenProgram);
	const sourceTokenAccount = intent.sourceTokenAccount
		? new PublicKey(intent.sourceTokenAccount)
		: getAssociatedTokenAddressSync(
				mint,
				signer.publicKey,
				false,
				tokenProgramId,
				ASSOCIATED_TOKEN_PROGRAM_ID,
			);
	const destinationTokenAccount = intent.destinationTokenAccount
		? new PublicKey(intent.destinationTokenAccount)
		: getAssociatedTokenAddressSync(
				mint,
				toOwner,
				false,
				tokenProgramId,
				ASSOCIATED_TOKEN_PROGRAM_ID,
			);

	const { instructions, destinationAtaCreateIncluded } =
		await buildSplTransferInstructions(
			connection,
			signer.publicKey,
			toOwner,
			mint,
			sourceTokenAccount,
			destinationTokenAccount,
			parsePositiveBigInt(intent.amountRaw, "amountRaw"),
			tokenProgramId,
			intent.createDestinationAtaIfMissing,
		);
	const tx = new Transaction().add(...instructions);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			latestBlockhash,
			fromAddress: intent.fromAddress,
			toAddress: intent.toAddress,
			tokenMint: intent.tokenMint,
			amountRaw: intent.amountRaw,
			tokenProgram: intent.tokenProgram,
			tokenProgramId: tokenProgramId.toBase58(),
			sourceTokenAccount: sourceTokenAccount.toBase58(),
			destinationTokenAccount: destinationTokenAccount.toBase58(),
			destinationAtaCreateIncluded,
		},
	};
}

async function prepareKaminoDepositSimulation(
	network: string,
	signer: Keypair,
	intent: KaminoDepositIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.ownerAddress !== signerAddress) {
		throw new Error(
			`ownerAddress mismatch: expected ${signerAddress}, got ${intent.ownerAddress}`,
		);
	}
	const connection = getConnection(network);
	const build = await buildKaminoDepositInstructions({
		ownerAddress: intent.ownerAddress,
		reserveMint: intent.reserveMint,
		amountRaw: intent.amountRaw,
		marketAddress: intent.marketAddress,
		programId: intent.programId,
		useV2Ixs: intent.useV2Ixs,
		includeAtaIxs: intent.includeAtaIxs,
		extraComputeUnits: intent.extraComputeUnits,
		requestElevationGroup: intent.requestElevationGroup,
		network,
	});
	const tx = new Transaction().add(...build.instructions);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			latestBlockhash,
			ownerAddress: build.ownerAddress,
			marketAddress: build.marketAddress,
			programId: build.programId,
			reserveMint: build.reserveMint,
			reserveAddress: build.reserveAddress,
			reserveSymbol: build.reserveSymbol,
			amountRaw: build.amountRaw,
			obligationAddress: build.obligationAddress,
			instructionCount: build.instructionCount,
			setupInstructionCount: build.setupInstructionCount,
			lendingInstructionCount: build.lendingInstructionCount,
			cleanupInstructionCount: build.cleanupInstructionCount,
			setupInstructionLabels: build.setupInstructionLabels,
			lendingInstructionLabels: build.lendingInstructionLabels,
			cleanupInstructionLabels: build.cleanupInstructionLabels,
		},
	};
}

async function prepareKaminoBorrowSimulation(
	network: string,
	signer: Keypair,
	intent: KaminoBorrowIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.ownerAddress !== signerAddress) {
		throw new Error(
			`ownerAddress mismatch: expected ${signerAddress}, got ${intent.ownerAddress}`,
		);
	}
	const connection = getConnection(network);
	const build = await buildKaminoBorrowInstructions({
		ownerAddress: intent.ownerAddress,
		reserveMint: intent.reserveMint,
		amountRaw: intent.amountRaw,
		marketAddress: intent.marketAddress,
		programId: intent.programId,
		useV2Ixs: intent.useV2Ixs,
		includeAtaIxs: intent.includeAtaIxs,
		extraComputeUnits: intent.extraComputeUnits,
		requestElevationGroup: intent.requestElevationGroup,
		network,
	});
	const tx = new Transaction().add(...build.instructions);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			latestBlockhash,
			ownerAddress: build.ownerAddress,
			marketAddress: build.marketAddress,
			programId: build.programId,
			reserveMint: build.reserveMint,
			reserveAddress: build.reserveAddress,
			reserveSymbol: build.reserveSymbol,
			amountRaw: build.amountRaw,
			obligationAddress: build.obligationAddress,
			instructionCount: build.instructionCount,
			setupInstructionCount: build.setupInstructionCount,
			lendingInstructionCount: build.lendingInstructionCount,
			cleanupInstructionCount: build.cleanupInstructionCount,
			setupInstructionLabels: build.setupInstructionLabels,
			lendingInstructionLabels: build.lendingInstructionLabels,
			cleanupInstructionLabels: build.cleanupInstructionLabels,
		},
	};
}

async function prepareKaminoWithdrawSimulation(
	network: string,
	signer: Keypair,
	intent: KaminoWithdrawIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.ownerAddress !== signerAddress) {
		throw new Error(
			`ownerAddress mismatch: expected ${signerAddress}, got ${intent.ownerAddress}`,
		);
	}
	const connection = getConnection(network);
	const build = await buildKaminoWithdrawInstructions({
		ownerAddress: intent.ownerAddress,
		reserveMint: intent.reserveMint,
		amountRaw: intent.amountRaw,
		marketAddress: intent.marketAddress,
		programId: intent.programId,
		useV2Ixs: intent.useV2Ixs,
		includeAtaIxs: intent.includeAtaIxs,
		extraComputeUnits: intent.extraComputeUnits,
		requestElevationGroup: intent.requestElevationGroup,
		network,
	});
	const tx = new Transaction().add(...build.instructions);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			latestBlockhash,
			ownerAddress: build.ownerAddress,
			marketAddress: build.marketAddress,
			programId: build.programId,
			reserveMint: build.reserveMint,
			reserveAddress: build.reserveAddress,
			reserveSymbol: build.reserveSymbol,
			amountRaw: build.amountRaw,
			obligationAddress: build.obligationAddress,
			instructionCount: build.instructionCount,
			setupInstructionCount: build.setupInstructionCount,
			lendingInstructionCount: build.lendingInstructionCount,
			cleanupInstructionCount: build.cleanupInstructionCount,
			setupInstructionLabels: build.setupInstructionLabels,
			lendingInstructionLabels: build.lendingInstructionLabels,
			cleanupInstructionLabels: build.cleanupInstructionLabels,
		},
	};
}

async function prepareKaminoRepaySimulation(
	network: string,
	signer: Keypair,
	intent: KaminoRepayIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.ownerAddress !== signerAddress) {
		throw new Error(
			`ownerAddress mismatch: expected ${signerAddress}, got ${intent.ownerAddress}`,
		);
	}
	const connection = getConnection(network);
	const build = await buildKaminoRepayInstructions({
		ownerAddress: intent.ownerAddress,
		reserveMint: intent.reserveMint,
		amountRaw: intent.amountRaw,
		marketAddress: intent.marketAddress,
		programId: intent.programId,
		useV2Ixs: intent.useV2Ixs,
		includeAtaIxs: intent.includeAtaIxs,
		extraComputeUnits: intent.extraComputeUnits,
		requestElevationGroup: intent.requestElevationGroup,
		currentSlot: intent.currentSlot,
		network,
	});
	const tx = new Transaction().add(...build.instructions);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			latestBlockhash,
			ownerAddress: build.ownerAddress,
			marketAddress: build.marketAddress,
			programId: build.programId,
			reserveMint: build.reserveMint,
			reserveAddress: build.reserveAddress,
			reserveSymbol: build.reserveSymbol,
			amountRaw: build.amountRaw,
			currentSlot: build.currentSlot,
			obligationAddress: build.obligationAddress,
			instructionCount: build.instructionCount,
			setupInstructionCount: build.setupInstructionCount,
			lendingInstructionCount: build.lendingInstructionCount,
			cleanupInstructionCount: build.cleanupInstructionCount,
			setupInstructionLabels: build.setupInstructionLabels,
			lendingInstructionLabels: build.lendingInstructionLabels,
			cleanupInstructionLabels: build.cleanupInstructionLabels,
		},
	};
}

async function prepareKaminoDepositAndBorrowSimulation(
	network: string,
	signer: Keypair,
	intent: KaminoDepositAndBorrowIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.ownerAddress !== signerAddress) {
		throw new Error(
			`ownerAddress mismatch: expected ${signerAddress}, got ${intent.ownerAddress}`,
		);
	}
	const connection = getConnection(network);
	const build = await buildKaminoDepositAndBorrowInstructions({
		ownerAddress: intent.ownerAddress,
		depositReserveMint: intent.depositReserveMint,
		depositAmountRaw: intent.depositAmountRaw,
		borrowReserveMint: intent.borrowReserveMint,
		borrowAmountRaw: intent.borrowAmountRaw,
		marketAddress: intent.marketAddress,
		programId: intent.programId,
		useV2Ixs: intent.useV2Ixs,
		includeAtaIxs: intent.includeAtaIxs,
		extraComputeUnits: intent.extraComputeUnits,
		requestElevationGroup: intent.requestElevationGroup,
		network,
	});
	const tx = new Transaction().add(...build.instructions);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			latestBlockhash,
			ownerAddress: build.ownerAddress,
			marketAddress: build.marketAddress,
			programId: build.programId,
			depositReserveMint: build.depositReserveMint,
			depositReserveAddress: build.depositReserveAddress,
			depositReserveSymbol: build.depositReserveSymbol,
			depositAmountRaw: build.depositAmountRaw,
			borrowReserveMint: build.borrowReserveMint,
			borrowReserveAddress: build.borrowReserveAddress,
			borrowReserveSymbol: build.borrowReserveSymbol,
			borrowAmountRaw: build.borrowAmountRaw,
			obligationAddress: build.obligationAddress,
			instructionCount: build.instructionCount,
			setupInstructionCount: build.setupInstructionCount,
			lendingInstructionCount: build.lendingInstructionCount,
			cleanupInstructionCount: build.cleanupInstructionCount,
			setupInstructionLabels: build.setupInstructionLabels,
			lendingInstructionLabels: build.lendingInstructionLabels,
			cleanupInstructionLabels: build.cleanupInstructionLabels,
		},
	};
}

async function prepareKaminoRepayAndWithdrawSimulation(
	network: string,
	signer: Keypair,
	intent: KaminoRepayAndWithdrawIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.ownerAddress !== signerAddress) {
		throw new Error(
			`ownerAddress mismatch: expected ${signerAddress}, got ${intent.ownerAddress}`,
		);
	}
	const connection = getConnection(network);
	const build = await buildKaminoRepayAndWithdrawInstructions({
		ownerAddress: intent.ownerAddress,
		repayReserveMint: intent.repayReserveMint,
		repayAmountRaw: intent.repayAmountRaw,
		withdrawReserveMint: intent.withdrawReserveMint,
		withdrawAmountRaw: intent.withdrawAmountRaw,
		currentSlot: intent.currentSlot,
		marketAddress: intent.marketAddress,
		programId: intent.programId,
		useV2Ixs: intent.useV2Ixs,
		includeAtaIxs: intent.includeAtaIxs,
		extraComputeUnits: intent.extraComputeUnits,
		requestElevationGroup: intent.requestElevationGroup,
		network,
	});
	const tx = new Transaction().add(...build.instructions);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			latestBlockhash,
			ownerAddress: build.ownerAddress,
			marketAddress: build.marketAddress,
			programId: build.programId,
			repayReserveMint: build.repayReserveMint,
			repayReserveAddress: build.repayReserveAddress,
			repayReserveSymbol: build.repayReserveSymbol,
			repayAmountRaw: build.repayAmountRaw,
			withdrawReserveMint: build.withdrawReserveMint,
			withdrawReserveAddress: build.withdrawReserveAddress,
			withdrawReserveSymbol: build.withdrawReserveSymbol,
			withdrawAmountRaw: build.withdrawAmountRaw,
			currentSlot: build.currentSlot,
			obligationAddress: build.obligationAddress,
			instructionCount: build.instructionCount,
			setupInstructionCount: build.setupInstructionCount,
			lendingInstructionCount: build.lendingInstructionCount,
			cleanupInstructionCount: build.cleanupInstructionCount,
			setupInstructionLabels: build.setupInstructionLabels,
			lendingInstructionLabels: build.lendingInstructionLabels,
			cleanupInstructionLabels: build.cleanupInstructionLabels,
		},
	};
}

async function prepareOrcaIncreaseLiquiditySimulation(
	network: string,
	signer: Keypair,
	intent: OrcaIncreaseLiquidityIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.ownerAddress !== signerAddress) {
		throw new Error(
			`ownerAddress mismatch: expected ${signerAddress}, got ${intent.ownerAddress}`,
		);
	}
	const connection = getConnection(network);
	const build = await buildOrcaIncreaseLiquidityInstructions({
		ownerAddress: intent.ownerAddress,
		positionMint: intent.positionMint,
		liquidityAmountRaw: intent.liquidityAmountRaw,
		tokenAAmountRaw: intent.tokenAAmountRaw,
		tokenBAmountRaw: intent.tokenBAmountRaw,
		slippageBps: intent.slippageBps,
		network,
	});
	const tx = new Transaction().add(...build.instructions);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			latestBlockhash,
			ownerAddress: build.ownerAddress,
			positionMint: build.positionMint,
			quoteParamKind: build.quoteParamKind,
			quoteParamAmountRaw: build.quoteParamAmountRaw,
			slippageBps: build.slippageBps,
			instructionCount: build.instructionCount,
			quote: build.quote,
		},
	};
}

async function prepareOrcaDecreaseLiquiditySimulation(
	network: string,
	signer: Keypair,
	intent: OrcaDecreaseLiquidityIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.ownerAddress !== signerAddress) {
		throw new Error(
			`ownerAddress mismatch: expected ${signerAddress}, got ${intent.ownerAddress}`,
		);
	}
	const connection = getConnection(network);
	const build = await buildOrcaDecreaseLiquidityInstructions({
		ownerAddress: intent.ownerAddress,
		positionMint: intent.positionMint,
		liquidityAmountRaw: intent.liquidityAmountRaw,
		tokenAAmountRaw: intent.tokenAAmountRaw,
		tokenBAmountRaw: intent.tokenBAmountRaw,
		slippageBps: intent.slippageBps,
		network,
	});
	const tx = new Transaction().add(...build.instructions);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			latestBlockhash,
			ownerAddress: build.ownerAddress,
			positionMint: build.positionMint,
			quoteParamKind: build.quoteParamKind,
			quoteParamAmountRaw: build.quoteParamAmountRaw,
			slippageBps: build.slippageBps,
			instructionCount: build.instructionCount,
			quote: build.quote,
		},
	};
}

async function prepareStakeCreateAndDelegateSimulation(
	network: string,
	signer: Keypair,
	intent: StakeCreateAndDelegateIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.stakeAuthorityAddress !== signerAddress) {
		throw new Error(
			`stakeAuthorityAddress mismatch: expected ${signerAddress}, got ${intent.stakeAuthorityAddress}`,
		);
	}
	if (intent.withdrawAuthorityAddress !== signerAddress) {
		throw new Error(
			`withdrawAuthorityAddress mismatch: expected ${signerAddress}, got ${intent.withdrawAuthorityAddress}`,
		);
	}
	const connection = getConnection(network);
	const stakeAccount = new PublicKey(intent.stakeAccountAddress);
	const createStakeTx = StakeProgram.createAccountWithSeed({
		fromPubkey: signer.publicKey,
		stakePubkey: stakeAccount,
		basePubkey: signer.publicKey,
		seed: intent.stakeSeed,
		authorized: new Authorized(signer.publicKey, signer.publicKey),
		lamports: intent.lamports,
	});
	const delegateStakeTx = StakeProgram.delegate({
		stakePubkey: stakeAccount,
		authorizedPubkey: signer.publicKey,
		votePubkey: new PublicKey(intent.voteAccountAddress),
	});
	const tx = new Transaction().add(
		...createStakeTx.instructions,
		...delegateStakeTx.instructions,
	);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			action: "createAndDelegate",
			latestBlockhash,
			stakeAuthorityAddress: intent.stakeAuthorityAddress,
			withdrawAuthorityAddress: intent.withdrawAuthorityAddress,
			stakeAccountAddress: intent.stakeAccountAddress,
			stakeSeed: intent.stakeSeed,
			voteAccountAddress: intent.voteAccountAddress,
			amountSol: intent.amountSol,
			lamports: intent.lamports,
		},
	};
}

async function prepareStakeDelegateSimulation(
	network: string,
	signer: Keypair,
	intent: StakeDelegateIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.stakeAuthorityAddress !== signerAddress) {
		throw new Error(
			`stakeAuthorityAddress mismatch: expected ${signerAddress}, got ${intent.stakeAuthorityAddress}`,
		);
	}
	const connection = getConnection(network);
	const tx = new Transaction().add(
		StakeProgram.delegate({
			stakePubkey: new PublicKey(intent.stakeAccountAddress),
			authorizedPubkey: signer.publicKey,
			votePubkey: new PublicKey(intent.voteAccountAddress),
		}),
	);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			action: "delegate",
			latestBlockhash,
			stakeAuthorityAddress: intent.stakeAuthorityAddress,
			stakeAccountAddress: intent.stakeAccountAddress,
			voteAccountAddress: intent.voteAccountAddress,
		},
	};
}

async function prepareStakeAuthorizeSimulation(
	network: string,
	signer: Keypair,
	intent: StakeAuthorizeIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.stakeAuthorityAddress !== signerAddress) {
		throw new Error(
			`stakeAuthorityAddress mismatch: expected ${signerAddress}, got ${intent.stakeAuthorityAddress}`,
		);
	}
	const connection = getConnection(network);
	const authorizationType =
		intent.type === "solana.stake.authorizeWithdrawer"
			? "withdrawer"
			: "staker";
	const tx = new Transaction().add(
		StakeProgram.authorize({
			stakePubkey: new PublicKey(intent.stakeAccountAddress),
			authorizedPubkey: signer.publicKey,
			newAuthorizedPubkey: new PublicKey(intent.newAuthorityAddress),
			stakeAuthorizationType:
				authorizationType === "withdrawer"
					? StakeAuthorizationLayout.Withdrawer
					: StakeAuthorizationLayout.Staker,
		}),
	);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			action: "authorize",
			authorizationType,
			latestBlockhash,
			stakeAuthorityAddress: intent.stakeAuthorityAddress,
			stakeAccountAddress: intent.stakeAccountAddress,
			newAuthorityAddress: intent.newAuthorityAddress,
		},
	};
}

async function prepareStakeDeactivateSimulation(
	network: string,
	signer: Keypair,
	intent: StakeDeactivateIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.stakeAuthorityAddress !== signerAddress) {
		throw new Error(
			`stakeAuthorityAddress mismatch: expected ${signerAddress}, got ${intent.stakeAuthorityAddress}`,
		);
	}
	const connection = getConnection(network);
	const tx = new Transaction().add(
		StakeProgram.deactivate({
			stakePubkey: new PublicKey(intent.stakeAccountAddress),
			authorizedPubkey: signer.publicKey,
		}),
	);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			action: "deactivate",
			latestBlockhash,
			stakeAuthorityAddress: intent.stakeAuthorityAddress,
			stakeAccountAddress: intent.stakeAccountAddress,
		},
	};
}

async function prepareStakeWithdrawSimulation(
	network: string,
	signer: Keypair,
	intent: StakeWithdrawIntent,
): Promise<PreparedTransaction> {
	const signerAddress = signer.publicKey.toBase58();
	if (intent.withdrawAuthorityAddress !== signerAddress) {
		throw new Error(
			`withdrawAuthorityAddress mismatch: expected ${signerAddress}, got ${intent.withdrawAuthorityAddress}`,
		);
	}
	const connection = getConnection(network);
	const tx = new Transaction().add(
		StakeProgram.withdraw({
			stakePubkey: new PublicKey(intent.stakeAccountAddress),
			authorizedPubkey: signer.publicKey,
			toPubkey: new PublicKey(intent.toAddress),
			lamports: intent.lamports,
		}),
	);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			action: "withdraw",
			latestBlockhash,
			withdrawAuthorityAddress: intent.withdrawAuthorityAddress,
			stakeAccountAddress: intent.stakeAccountAddress,
			toAddress: intent.toAddress,
			amountSol: intent.amountSol,
			lamports: intent.lamports,
		},
	};
}

async function prepareJupiterSwapSimulation(
	network: string,
	signer: Keypair,
	intent: JupiterSwapIntent,
	params: Record<string, unknown>,
): Promise<PreparedTransaction> {
	assertJupiterNetworkSupported(network);
	const quoteRequest = {
		inputMint: intent.inputMint,
		outputMint: intent.outputMint,
		amount: intent.amountRaw,
		slippageBps: intent.slippageBps,
		swapMode: intent.swapMode,
		restrictIntermediateTokens: intent.restrictIntermediateTokens,
		onlyDirectRoutes: intent.onlyDirectRoutes,
		asLegacyTransaction: intent.asLegacyTransaction,
		maxAccounts: intent.maxAccounts,
		dexes: intent.dexes,
		excludeDexes: intent.excludeDexes,
	};
	const scopedQuote = await getJupiterQuote(quoteRequest);
	const scopedIntent = isScopedJupiterIntentType(intent.type);
	const fallbackRequested = intent.fallbackToJupiterOnNoRoute === true;
	let fallbackApplied = false;
	let quote = scopedQuote;
	let quoteRoute = parseQuoteRouteContext(scopedQuote);
	if (scopedIntent && !quoteRoute.hasRoute) {
		if (fallbackRequested) {
			const fallbackQuote = await getJupiterQuote({
				...quoteRequest,
				dexes: undefined,
			});
			const fallbackRoute = parseQuoteRouteContext(fallbackQuote);
			if (!fallbackRoute.hasRoute) {
				const protocolLabel =
					intent.type === "solana.swap.orca" ? "Orca" : "Meteora";
				throw new Error(
					`No ${protocolLabel} route found under dex constraints [${(intent.dexes ?? []).join(", ")}], and Jupiter fallback also returned no route.`,
				);
			}
			quote = fallbackQuote;
			quoteRoute = fallbackRoute;
			fallbackApplied = true;
		} else {
			assertProtocolRouteAvailability(
				intent.type,
				intent.dexes,
				quoteRoute.routePlan,
				quoteRoute.outAmount,
			);
		}
	}
	const priorityLevel = parseJupiterPriorityLevel(
		typeof params.priorityLevel === "string" ? params.priorityLevel : undefined,
	);
	const swapResponse = await buildJupiterSwapTransaction({
		userPublicKey: signer.publicKey.toBase58(),
		quoteResponse: quote,
		asLegacyTransaction: intent.asLegacyTransaction,
		wrapAndUnwrapSol:
			typeof params.wrapAndUnwrapSol === "boolean"
				? params.wrapAndUnwrapSol
				: undefined,
		useSharedAccounts:
			typeof params.useSharedAccounts === "boolean"
				? params.useSharedAccounts
				: undefined,
		dynamicComputeUnitLimit:
			typeof params.dynamicComputeUnitLimit === "boolean"
				? params.dynamicComputeUnitLimit
				: true,
		skipUserAccountsRpcCalls:
			typeof params.skipUserAccountsRpcCalls === "boolean"
				? params.skipUserAccountsRpcCalls
				: undefined,
		destinationTokenAccount:
			typeof params.destinationTokenAccount === "string"
				? params.destinationTokenAccount
				: undefined,
		trackingAccount:
			typeof params.trackingAccount === "string"
				? params.trackingAccount
				: undefined,
		feeAccount:
			typeof params.feeAccount === "string" ? params.feeAccount : undefined,
		jitoTipLamports:
			typeof params.jitoTipLamports === "number"
				? params.jitoTipLamports
				: undefined,
		priorityFee:
			typeof params.jitoTipLamports === "number"
				? undefined
				: {
						priorityLevel,
						maxLamports:
							typeof params.priorityMaxLamports === "number"
								? params.priorityMaxLamports
								: undefined,
						global:
							typeof params.priorityGlobal === "boolean"
								? params.priorityGlobal
								: undefined,
					},
	});
	const swapPayload =
		swapResponse && typeof swapResponse === "object"
			? (swapResponse as Record<string, unknown>)
			: {};
	const txBase64 =
		typeof swapPayload.swapTransaction === "string"
			? swapPayload.swapTransaction
			: "";
	if (!txBase64) {
		throw new Error("Jupiter swap response missing swapTransaction");
	}
	const tx = parseTransactionFromBase64(txBase64);
	let version: "legacy" | "v0" = "legacy";
	if (tx instanceof VersionedTransaction) {
		tx.sign([signer]);
		version = "v0";
	} else {
		tx.partialSign(signer);
	}
	const connection = getConnection(network);
	const commitment = parseFinality(
		typeof params.commitment === "string" ? params.commitment : undefined,
	);
	const simulation =
		tx instanceof VersionedTransaction
			? await connection.simulateTransaction(tx, {
					sigVerify: true,
					replaceRecentBlockhash: false,
					commitment,
				})
			: await connection.simulateTransaction(tx);
	return {
		tx,
		version,
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			quote,
			scopedQuote: fallbackApplied ? scopedQuote : undefined,
			swapResponse: swapPayload,
			outAmount: quoteRoute.outAmount,
			routeCount: quoteRoute.routePlan.length,
			dexes: intent.dexes,
			effectiveDexes: fallbackApplied ? null : intent.dexes,
			fallbackToJupiterOnNoRoute: fallbackRequested,
			fallbackApplied,
			routeSource: fallbackApplied
				? "jupiter-fallback"
				: scopedIntent
					? "scoped"
					: "jupiter",
			jupiterBaseUrl: getJupiterApiBaseUrl(),
		},
	};
}

async function prepareRaydiumSwapSimulation(
	network: string,
	signer: Keypair,
	intent: RaydiumSwapIntent,
	params: Record<string, unknown>,
): Promise<PreparedTransaction> {
	assertRaydiumNetworkSupported(network);
	const quote = await getRaydiumQuote({
		inputMint: intent.inputMint,
		outputMint: intent.outputMint,
		amount: intent.amountRaw,
		slippageBps: intent.slippageBps,
		txVersion: intent.txVersion,
		swapType: intent.swapType,
	});
	let autoFeePayload: unknown = null;
	let computeUnitPriceMicroLamports = intent.computeUnitPriceMicroLamports;
	if (!computeUnitPriceMicroLamports) {
		autoFeePayload = await getRaydiumPriorityFee();
		computeUnitPriceMicroLamports =
			getRaydiumPriorityFeeMicroLamports(autoFeePayload) ?? undefined;
	}
	if (!computeUnitPriceMicroLamports) {
		throw new Error(
			"Unable to resolve Raydium computeUnitPriceMicroLamports from auto-fee endpoint. Provide computeUnitPriceMicroLamports explicitly.",
		);
	}
	const swapResponse = await buildRaydiumSwapTransactions({
		wallet: signer.publicKey.toBase58(),
		txVersion: intent.txVersion,
		swapType: intent.swapType,
		quoteResponse: quote,
		computeUnitPriceMicroLamports,
		wrapSol: intent.wrapSol,
		unwrapSol: intent.unwrapSol,
		inputAccount: intent.inputAccount,
		outputAccount: intent.outputAccount,
	});
	const txBase64List = extractRaydiumTransactions(swapResponse);
	if (txBase64List.length === 0) {
		throw new Error("Raydium swap response missing serialized transaction");
	}
	const signedTransactions = txBase64List.map((txBase64) => {
		const tx = parseTransactionFromBase64(txBase64);
		let version: "legacy" | "v0" = "legacy";
		if (tx instanceof VersionedTransaction) {
			tx.sign([signer]);
			version = "v0";
		} else {
			tx.partialSign(signer);
		}
		return { tx, version };
	});
	const commitment = parseFinality(
		typeof params.commitment === "string" ? params.commitment : undefined,
	);
	const connection = getConnection(network);
	const simulations = [];
	for (const [index, entry] of signedTransactions.entries()) {
		const simulation =
			entry.tx instanceof VersionedTransaction
				? await connection.simulateTransaction(entry.tx, {
						sigVerify: true,
						replaceRecentBlockhash: false,
						commitment,
					})
				: await connection.simulateTransaction(entry.tx);
		simulations.push({
			index,
			version: entry.version,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		});
	}
	const simulationOk = simulations.every((item) => item.err == null);
	const firstErr = simulations.find((item) => item.err != null)?.err ?? null;
	const combinedLogs = simulations.flatMap((item) => item.logs);
	const totalUnits = simulations.reduce<number | null>((total, item) => {
		if (item.unitsConsumed == null) {
			return total;
		}
		return (total ?? 0) + item.unitsConsumed;
	}, null);
	const primary = signedTransactions[0];
	if (!primary) {
		throw new Error("Raydium swap produced no signed transaction");
	}
	return {
		tx: primary.tx,
		version: primary.version,
		signedTransactions,
		simulation: {
			ok: simulationOk,
			err: firstErr,
			logs: combinedLogs,
			unitsConsumed: totalUnits,
		},
		context: {
			txCount: signedTransactions.length,
			txVersions: signedTransactions.map((entry) => entry.version),
			simulations,
			inputMint: intent.inputMint,
			outputMint: intent.outputMint,
			amountRaw: intent.amountRaw,
			slippageBps: intent.slippageBps,
			txVersion: intent.txVersion,
			swapType: intent.swapType,
			computeUnitPriceMicroLamports,
			quote,
			swapResponse,
			autoFeePayload,
			raydiumApiBaseUrl: getRaydiumApiBaseUrl(),
		},
	};
}

async function prepareSimulation(
	network: string,
	signer: Keypair,
	intent: TransactionWorkflowIntent,
	params: Record<string, unknown>,
): Promise<PreparedTransaction> {
	if (intent.type === "solana.transfer.sol") {
		return prepareTransferSolSimulation(network, signer, intent);
	}
	if (intent.type === "solana.transfer.spl") {
		return prepareTransferSplSimulation(network, signer, intent);
	}
	if (intent.type === "solana.lend.kamino.borrow") {
		return prepareKaminoBorrowSimulation(network, signer, intent);
	}
	if (intent.type === "solana.lend.kamino.deposit") {
		return prepareKaminoDepositSimulation(network, signer, intent);
	}
	if (intent.type === "solana.lend.kamino.depositAndBorrow") {
		return prepareKaminoDepositAndBorrowSimulation(network, signer, intent);
	}
	if (intent.type === "solana.lend.kamino.repay") {
		return prepareKaminoRepaySimulation(network, signer, intent);
	}
	if (intent.type === "solana.lend.kamino.repayAndWithdraw") {
		return prepareKaminoRepayAndWithdrawSimulation(network, signer, intent);
	}
	if (intent.type === "solana.lend.kamino.withdraw") {
		return prepareKaminoWithdrawSimulation(network, signer, intent);
	}
	if (intent.type === "solana.lp.orca.increase") {
		return prepareOrcaIncreaseLiquiditySimulation(network, signer, intent);
	}
	if (intent.type === "solana.lp.orca.decrease") {
		return prepareOrcaDecreaseLiquiditySimulation(network, signer, intent);
	}
	if (intent.type === "solana.stake.createAndDelegate") {
		return prepareStakeCreateAndDelegateSimulation(network, signer, intent);
	}
	if (intent.type === "solana.stake.delegate") {
		return prepareStakeDelegateSimulation(network, signer, intent);
	}
	if (
		intent.type === "solana.stake.authorizeStaker" ||
		intent.type === "solana.stake.authorizeWithdrawer"
	) {
		return prepareStakeAuthorizeSimulation(network, signer, intent);
	}
	if (intent.type === "solana.stake.deactivate") {
		return prepareStakeDeactivateSimulation(network, signer, intent);
	}
	if (intent.type === "solana.stake.withdraw") {
		return prepareStakeWithdrawSimulation(network, signer, intent);
	}
	if (intent.type === "solana.swap.raydium") {
		return prepareRaydiumSwapSimulation(network, signer, intent, params);
	}
	return prepareJupiterSwapSimulation(network, signer, intent, params);
}

async function executePreparedTransaction(
	network: string,
	prepared: PreparedTransaction,
	params: Record<string, unknown>,
): Promise<{
	signature: string;
	signatures: string[];
	confirmed: boolean;
}> {
	const connection = getConnection(network);
	const commitment = parseFinality(
		typeof params.commitment === "string" ? params.commitment : undefined,
	);
	const signedTransactions =
		prepared.signedTransactions && prepared.signedTransactions.length > 0
			? prepared.signedTransactions
			: [{ tx: prepared.tx, version: prepared.version }];
	const signatures: string[] = [];
	for (const entry of signedTransactions) {
		const signature = await connection.sendRawTransaction(
			entry.tx.serialize(),
			{
				skipPreflight: params.skipPreflight === true,
				maxRetries:
					typeof params.maxRetries === "number" ? params.maxRetries : undefined,
			},
		);
		signatures.push(signature);
		if (params.confirm !== false) {
			const confirmation = await connection.confirmTransaction(
				signature,
				commitment,
			);
			const confirmationErr = confirmation.value.err;
			if (confirmationErr) {
				throw new Error(
					`Transaction confirmed with error: ${stringifyUnknown(confirmationErr)}`,
				);
			}
		}
	}
	const signature = signatures[signatures.length - 1];
	if (!signature) {
		throw new Error("No signature returned");
	}
	return {
		signature,
		signatures,
		confirmed: params.confirm !== false,
	};
}

export function createSolanaWorkflowTools() {
	return [
		defineTool({
			name: "w3rt_run_workflow_v0",
			label: "W3RT Run Workflow V0 (Solana)",
			description:
				"Deterministic Solana workflow entrypoint: analysis -> simulation -> approval -> execution -> monitor",
			parameters: Type.Object({
				runId: Type.Optional(
					Type.String({
						description:
							"Optional workflow run id. Provide the same id when replaying simulate->execute on mainnet.",
					}),
				),
				intentType: Type.Optional(
					Type.Union([
						Type.Literal("solana.transfer.sol"),
						Type.Literal("solana.transfer.spl"),
						Type.Literal("solana.lend.kamino.borrow"),
						Type.Literal("solana.lend.kamino.deposit"),
						Type.Literal("solana.lend.kamino.depositAndBorrow"),
						Type.Literal("solana.lend.kamino.repay"),
						Type.Literal("solana.lend.kamino.repayAndWithdraw"),
						Type.Literal("solana.lend.kamino.withdraw"),
						Type.Literal("solana.stake.createAndDelegate"),
						Type.Literal("solana.stake.delegate"),
						Type.Literal("solana.stake.authorizeStaker"),
						Type.Literal("solana.stake.authorizeWithdrawer"),
						Type.Literal("solana.stake.deactivate"),
						Type.Literal("solana.stake.withdraw"),
						Type.Literal("solana.lp.orca.increase"),
						Type.Literal("solana.lp.orca.decrease"),
						Type.Literal("solana.swap.jupiter"),
						Type.Literal("solana.swap.orca"),
						Type.Literal("solana.swap.meteora"),
						Type.Literal("solana.swap.raydium"),
						Type.Literal("solana.read.balance"),
						Type.Literal("solana.read.orcaPositions"),
						Type.Literal("solana.read.tokenBalance"),
						Type.Literal("solana.read.portfolio"),
						Type.Literal("solana.read.defiPositions"),
						Type.Literal("solana.read.lendingMarkets"),
						Type.Literal("solana.read.lendingPositions"),
					]),
				),
				intentText: Type.Optional(
					Type.String({
						description:
							"Optional natural-language intent. Structured fields override parsed values.",
					}),
				),
				runMode: Type.Optional(
					Type.Union([
						Type.Literal("analysis"),
						Type.Literal("simulate"),
						Type.Literal("execute"),
					]),
				),
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				network: solanaNetworkSchema(),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required for mainnet execute mode",
					}),
				),
				confirmToken: Type.Optional(
					Type.String({
						description:
							"Mainnet confirmation token returned by a previous analysis/simulate call for the same runId",
					}),
				),
				commitment: commitmentSchema(),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				address: Type.Optional(
					Type.String({
						description:
							"Target wallet address for read intents. Defaults to signer address.",
					}),
				),
				toAddress: Type.Optional(
					Type.String({
						description:
							"Destination address for intentType=solana.transfer.sol / solana.transfer.spl / solana.stake.withdraw",
					}),
				),
				amountSol: Type.Optional(
					Type.Number({
						description:
							"Amount in SOL for intentType=solana.transfer.sol / solana.stake.createAndDelegate / solana.stake.withdraw, or for solana.lend.kamino.borrow|solana.lend.kamino.deposit|solana.lend.kamino.repay|solana.lend.kamino.withdraw when reserveMint is SOL",
					}),
				),
				stakeAccountAddress: Type.Optional(
					Type.String({
						description:
							"Stake account for intentType=solana.stake.delegate / solana.stake.authorizeStaker / solana.stake.authorizeWithdrawer / solana.stake.deactivate / solana.stake.withdraw",
					}),
				),
				newAuthorityAddress: Type.Optional(
					Type.String({
						description:
							"New authority for intentType=solana.stake.authorizeStaker / solana.stake.authorizeWithdrawer",
					}),
				),
				authorizationType: Type.Optional(
					Type.Union([Type.Literal("staker"), Type.Literal("withdrawer")], {
						description:
							"Authority type hint when intentType omitted. Used by stake authorize intents.",
					}),
				),
				stakeSeed: Type.Optional(
					Type.String({
						description:
							"Optional stake account seed for intentType=solana.stake.createAndDelegate (1-32 chars after sanitization). Defaults to runId-derived seed.",
					}),
				),
				voteAccountAddress: Type.Optional(
					Type.String({
						description:
							"Validator vote account for intentType=solana.stake.createAndDelegate / solana.stake.delegate",
					}),
				),
				stakeAuthorityAddress: Type.Optional(
					Type.String({
						description:
							"Optional authority assertion for intentType=solana.stake.createAndDelegate / solana.stake.delegate / solana.stake.deactivate",
					}),
				),
				withdrawAuthorityAddress: Type.Optional(
					Type.String({
						description:
							"Optional authority assertion for intentType=solana.stake.createAndDelegate / solana.stake.withdraw",
					}),
				),
				tokenMint: Type.Optional(
					Type.String({
						description: "Token mint for intentType=solana.transfer.spl",
					}),
				),
				ownerAddress: Type.Optional(
					Type.String({
						description:
							"Optional owner assertion for Kamino lending intents. Must match signer address.",
					}),
				),
				positionMint: Type.Optional(
					Type.String({
						description:
							"Orca position mint for intentType=solana.lp.orca.increase / solana.lp.orca.decrease",
					}),
				),
				reserveMint: Type.Optional(
					Type.String({
						description:
							"Reserve mint for single-leg Kamino intents (borrow/deposit/repay/withdraw).",
					}),
				),
				depositReserveMint: Type.Optional(
					Type.String({
						description:
							"Deposit reserve mint for intentType=solana.lend.kamino.depositAndBorrow",
					}),
				),
				borrowReserveMint: Type.Optional(
					Type.String({
						description:
							"Borrow reserve mint for intentType=solana.lend.kamino.depositAndBorrow",
					}),
				),
				repayReserveMint: Type.Optional(
					Type.String({
						description:
							"Repay reserve mint for intentType=solana.lend.kamino.repayAndWithdraw",
					}),
				),
				withdrawReserveMint: Type.Optional(
					Type.String({
						description:
							"Withdraw reserve mint for intentType=solana.lend.kamino.repayAndWithdraw",
					}),
				),
				marketAddress: Type.Optional(
					Type.String({
						description:
							"Optional Kamino market address for all Kamino lending intents. Defaults to main market on mainnet-beta.",
					}),
				),
				inputMint: Type.Optional(
					Type.String({
						description:
							"Input mint for intentType=solana.swap.jupiter or solana.swap.raydium",
					}),
				),
				outputMint: Type.Optional(
					Type.String({
						description:
							"Output mint for intentType=solana.swap.jupiter or solana.swap.raydium",
					}),
				),
				amountRaw: Type.Optional(
					Type.String({
						description:
							"Raw integer amount for intentType=solana.swap.jupiter / solana.swap.raydium / solana.transfer.spl / solana.lend.kamino.borrow / solana.lend.kamino.deposit / solana.lend.kamino.repay / solana.lend.kamino.withdraw",
					}),
				),
				liquidityAmountRaw: Type.Optional(
					Type.String({
						description:
							"Liquidity amount (raw integer) for intentType=solana.lp.orca.increase / solana.lp.orca.decrease. Provide exactly one of liquidityAmountRaw/tokenAAmountRaw/tokenBAmountRaw.",
					}),
				),
				tokenAAmountRaw: Type.Optional(
					Type.String({
						description:
							"Token A amount (raw integer) for intentType=solana.lp.orca.increase / solana.lp.orca.decrease. Provide exactly one of liquidityAmountRaw/tokenAAmountRaw/tokenBAmountRaw.",
					}),
				),
				tokenBAmountRaw: Type.Optional(
					Type.String({
						description:
							"Token B amount (raw integer) for intentType=solana.lp.orca.increase / solana.lp.orca.decrease. Provide exactly one of liquidityAmountRaw/tokenAAmountRaw/tokenBAmountRaw.",
					}),
				),
				depositAmountRaw: Type.Optional(
					Type.String({
						description:
							"Deposit amount (raw integer) for intentType=solana.lend.kamino.depositAndBorrow",
					}),
				),
				borrowAmountRaw: Type.Optional(
					Type.String({
						description:
							"Borrow amount (raw integer) for intentType=solana.lend.kamino.depositAndBorrow",
					}),
				),
				repayAmountRaw: Type.Optional(
					Type.String({
						description:
							"Repay amount (raw integer) for intentType=solana.lend.kamino.repayAndWithdraw",
					}),
				),
				withdrawAmountRaw: Type.Optional(
					Type.String({
						description:
							"Withdraw amount (raw integer) for intentType=solana.lend.kamino.repayAndWithdraw",
					}),
				),
				amountUi: Type.Optional(
					Type.String({
						description:
							"Optional human-readable token amount for swaps, SPL transfers, and Kamino lending actions (for known mints like SOL/USDC/USDT).",
					}),
				),
				depositAmountUi: Type.Optional(
					Type.String({
						description:
							"Deposit amount (human-readable) for intentType=solana.lend.kamino.depositAndBorrow",
					}),
				),
				borrowAmountUi: Type.Optional(
					Type.String({
						description:
							"Borrow amount (human-readable) for intentType=solana.lend.kamino.depositAndBorrow",
					}),
				),
				repayAmountUi: Type.Optional(
					Type.String({
						description:
							"Repay amount (human-readable) for intentType=solana.lend.kamino.repayAndWithdraw",
					}),
				),
				withdrawAmountUi: Type.Optional(
					Type.String({
						description:
							"Withdraw amount (human-readable) for intentType=solana.lend.kamino.repayAndWithdraw",
					}),
				),
				currentSlot: Type.Optional(
					Type.String({
						description:
							"Optional slot override for intentType=solana.lend.kamino.repay / solana.lend.kamino.repayAndWithdraw. Defaults to current RPC slot.",
					}),
				),
				useV2Ixs: Type.Optional(
					Type.Boolean({
						description:
							"Use Kamino V2 instructions for all Kamino lending intents (default true)",
					}),
				),
				includeAtaIxs: Type.Optional(
					Type.Boolean({
						description:
							"Include ATA setup instructions for all Kamino lending intents (default true)",
					}),
				),
				extraComputeUnits: Type.Optional(
					Type.Integer({
						minimum: 0,
						maximum: 2_000_000,
						description:
							"Optional compute unit limit for all Kamino lending intents",
					}),
				),
				requestElevationGroup: Type.Optional(
					Type.Boolean({
						description:
							"Request Kamino elevation group for all Kamino lending intents (default false)",
					}),
				),
				includeZero: Type.Optional(
					Type.Boolean({
						description:
							"Include zero-balance token positions for intentType=solana.read.portfolio or solana.read.defiPositions",
					}),
				),
				includeToken2022: Type.Optional(
					Type.Boolean({
						description:
							"Include Token-2022 accounts for read intents and token/portfolio/defi balance queries",
					}),
				),
				includeStakeAccounts: Type.Optional(
					Type.Boolean({
						description:
							"Include native stake account discovery for intentType=solana.read.defiPositions",
					}),
				),
				protocol: Type.Optional(
					Type.String({
						description:
							"Protocol hint for read intents. Supports 'kamino' for lending intents and 'orca' for liquidity position reads.",
					}),
				),
				programId: Type.Optional(
					Type.String({
						description:
							"Optional Kamino lending program id. For read intents it is a filter; for Kamino transaction intents it overrides the default program id.",
					}),
				),
				limitMarkets: Type.Optional(
					Type.Integer({
						minimum: 1,
						maximum: 200,
						description:
							"Maximum markets to query/return for intentType=solana.read.lendingMarkets or solana.read.lendingPositions",
					}),
				),
				slippageBps: Type.Optional(
					Type.Integer({
						minimum: 0,
						maximum: 10_000,
						description:
							"Slippage in bps for swap intents and Orca liquidity intents",
					}),
				),
				swapMode: jupiterSwapModeSchema(),
				txVersion: raydiumTxVersionSchema(),
				swapType: raydiumSwapTypeSchema(),
				computeUnitPriceMicroLamports: Type.Optional(Type.String()),
				restrictIntermediateTokens: Type.Optional(Type.Boolean()),
				onlyDirectRoutes: Type.Optional(Type.Boolean()),
				asLegacyTransaction: Type.Optional(Type.Boolean()),
				maxAccounts: Type.Optional(Type.Integer({ minimum: 8, maximum: 256 })),
				dexes: Type.Optional(
					Type.Array(Type.String({ description: "DEX labels to include" }), {
						minItems: 1,
						maxItems: 20,
					}),
				),
				excludeDexes: Type.Optional(
					Type.Array(Type.String({ description: "DEX labels to exclude" }), {
						minItems: 1,
						maxItems: 20,
					}),
				),
				fallbackToJupiterOnNoRoute: Type.Optional(
					Type.Boolean({
						description:
							"When intentType=solana.swap.orca|solana.swap.meteora, fallback to unconstrained Jupiter routing if scoped dexes have no route",
					}),
				),
				priorityLevel: jupiterPriorityLevelSchema(),
				priorityMaxLamports: Type.Optional(
					Type.Integer({ minimum: 1, maximum: 20_000_000 }),
				),
				priorityGlobal: Type.Optional(Type.Boolean()),
				jitoTipLamports: Type.Optional(
					Type.Integer({ minimum: 1, maximum: 20_000_000 }),
				),
				wrapAndUnwrapSol: Type.Optional(Type.Boolean()),
				useSharedAccounts: Type.Optional(Type.Boolean()),
				dynamicComputeUnitLimit: Type.Optional(Type.Boolean()),
				skipUserAccountsRpcCalls: Type.Optional(Type.Boolean()),
				wrapSol: Type.Optional(Type.Boolean()),
				unwrapSol: Type.Optional(Type.Boolean()),
				destinationTokenAccount: Type.Optional(Type.String()),
				sourceTokenAccount: Type.Optional(Type.String()),
				inputAccount: Type.Optional(Type.String()),
				outputAccount: Type.Optional(Type.String()),
				createDestinationAtaIfMissing: Type.Optional(Type.Boolean()),
				tokenProgram: splTokenProgramSchema(),
				trackingAccount: Type.Optional(Type.String()),
				feeAccount: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const runMode = parseRunMode(params.runMode);
				const network = parseNetwork(params.network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				const runId =
					typeof params.runId === "string" && params.runId.trim().length > 0
						? params.runId.trim()
						: createRunId();
				const intent = await normalizeIntent(
					params as Record<string, unknown>,
					signerPublicKey,
					network,
					runId,
				);
				const confirmToken = createConfirmToken(runId, network, intent);
				const approvalRequired =
					network === "mainnet-beta" && !isReadIntent(intent);
				const plan = createWorkflowPlan(intent.type);

				const analysisArtifact = {
					stage: "analysis",
					intent,
					plan,
					signer: signerPublicKey,
					network,
					runMode,
				};
				const approvalArtifact = {
					stage: "approval",
					required: approvalRequired,
					runId,
					confirmToken: approvalRequired ? confirmToken : null,
					confirmMainnet: params.confirmMainnet === true,
					providedConfirmToken: params.confirmToken ?? null,
				};

				if (runMode === "analysis") {
					const tokenText =
						approvalRequired && approvalArtifact.confirmToken
							? approvalArtifact.confirmToken
							: "N/A";
					return {
						content: [
							{
								type: "text",
								text: `Workflow analyzed: ${intent.type}`,
							},
							{
								type: "text",
								text: `runId=${runId} approvalRequired=${approvalRequired} confirmToken=${tokenText}`,
							},
						],
						details: {
							runId,
							intentType: intent.type,
							runMode,
							network,
							status: "analysis",
							artifacts: {
								analysis: analysisArtifact,
								simulate: null,
								approval: approvalArtifact,
								execute: null,
								monitor: null,
							},
						},
					};
				}

				if (isReadIntent(intent)) {
					const readResult = await executeReadIntent(network, intent);
					const simulationArtifact = {
						stage: "simulate",
						ok: true,
						err: null,
						logs: [],
						unitsConsumed: null,
						version: null,
						context: readResult.details,
					};
					if (runMode === "simulate") {
						return {
							content: [
								{
									type: "text",
									text: `Workflow read simulation: ${readResult.summary}`,
								},
								{
									type: "text",
									text: `runId=${runId} approvalRequired=false confirmToken=N/A`,
								},
							],
							details: {
								runId,
								intentType: intent.type,
								runMode,
								network,
								status: "simulated",
								artifacts: {
									analysis: analysisArtifact,
									simulate: simulationArtifact,
									approval: approvalArtifact,
									execute: null,
									monitor: null,
								},
							},
						};
					}
					return {
						content: [
							{
								type: "text",
								text: `Workflow read executed: ${readResult.summary}`,
							},
							{
								type: "text",
								text: `runId=${runId}`,
							},
						],
						details: {
							runId,
							intentType: intent.type,
							runMode,
							network,
							status: "executed",
							artifacts: {
								analysis: analysisArtifact,
								simulate: simulationArtifact,
								approval: {
									...approvalArtifact,
									approved: true,
								},
								execute: {
									stage: "execute",
									read: true,
									guardChecks: {
										readOnly: true,
										approvalRequired: false,
										confirmMainnetRequired: false,
										confirmTokenRequired: false,
									},
									result: readResult.details,
								},
								monitor: null,
							},
						},
					};
				}

				const prepared = await prepareSimulation(
					network,
					signer,
					intent,
					params as Record<string, unknown>,
				);
				const simulationArtifact = {
					stage: "simulate",
					ok: prepared.simulation.ok,
					err: prepared.simulation.err,
					logs: prepared.simulation.logs,
					unitsConsumed: prepared.simulation.unitsConsumed,
					version: prepared.version,
					context: prepared.context,
				};

				if (runMode === "simulate") {
					const tokenText =
						approvalRequired && approvalArtifact.confirmToken
							? approvalArtifact.confirmToken
							: "N/A";
					return {
						content: [
							{
								type: "text",
								text: `Workflow simulation ${prepared.simulation.ok ? "succeeded" : "failed"}`,
							},
							{
								type: "text",
								text: `runId=${runId} approvalRequired=${approvalRequired} confirmToken=${tokenText}`,
							},
						],
						details: {
							runId,
							intentType: intent.type,
							runMode,
							network,
							status: "simulated",
							artifacts: {
								analysis: analysisArtifact,
								simulate: simulationArtifact,
								approval: approvalArtifact,
								execute: null,
								monitor: null,
							},
						},
					};
				}

				if (approvalRequired) {
					if (params.confirmMainnet !== true) {
						throw new Error(
							`Mainnet execute requires confirmMainnet=true for runId=${runId}. Run analysis/simulate first to obtain confirmToken.`,
						);
					}
					if (params.confirmToken !== confirmToken) {
						throw new Error(
							`Invalid confirmToken for runId=${runId}. expected=${confirmToken} provided=${params.confirmToken ?? "null"}.`,
						);
					}
				}
				if (!prepared.simulation.ok) {
					throw new Error(
						`Simulation failed for runId=${runId}; execution blocked by workflow policy`,
					);
				}

				const execution = await executePreparedTransaction(
					network,
					prepared,
					params as Record<string, unknown>,
				);
				const executeArtifact = {
					stage: "execute",
					signature: execution.signature,
					signatures: execution.signatures,
					confirmed: execution.confirmed,
					version: prepared.version,
					guardChecks: {
						approvalRequired,
						confirmMainnetProvided: params.confirmMainnet === true,
						confirmTokenMatched:
							!approvalRequired || params.confirmToken === confirmToken,
						simulationOk: prepared.simulation.ok,
					},
				};
				const monitorArtifact = {
					stage: "monitor",
					signature: execution.signature,
					explorer: getExplorerTransactionUrl(execution.signature, network),
					signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
				};

				return {
					content: [
						{
							type: "text",
							text: `Workflow executed: ${execution.signature}`,
						},
						{
							type: "text",
							text: `runId=${runId}`,
						},
					],
					details: {
						runId,
						intentType: intent.type,
						runMode,
						network,
						status: "executed",
						artifacts: {
							analysis: analysisArtifact,
							simulate: simulationArtifact,
							approval: {
								...approvalArtifact,
								approved:
									!approvalRequired || params.confirmToken === confirmToken,
							},
							execute: executeArtifact,
							monitor: monitorArtifact,
						},
					},
				};
			},
		}),
	];
}
