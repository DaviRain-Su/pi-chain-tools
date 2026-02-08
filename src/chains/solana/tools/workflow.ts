import { createHash, randomBytes } from "node:crypto";
import { Type } from "@sinclair/typebox";
import {
	Keypair,
	type ParsedAccountData,
	PublicKey,
	SystemProgram,
	Transaction,
	VersionedTransaction,
} from "@solana/web3.js";
import { defineTool } from "../../../core/types.js";
import {
	assertJupiterNetworkSupported,
	buildJupiterSwapTransaction,
	callJupiterApi,
	commitmentSchema,
	getConnection,
	getExplorerAddressUrl,
	getExplorerTransactionUrl,
	getJupiterApiBaseUrl,
	getJupiterQuote,
	jupiterPriorityLevelSchema,
	jupiterSwapModeSchema,
	normalizeAtPath,
	parseFinality,
	parseJupiterPriorityLevel,
	parseJupiterSwapMode,
	parseNetwork,
	parsePositiveBigInt,
	parseTransactionFromBase64,
	resolveSecretKey,
	solanaNetworkSchema,
	toLamports,
} from "../runtime.js";

type WorkflowRunMode = "analysis" | "simulate" | "execute";
type WorkflowIntentType = "solana.transfer.sol" | "solana.swap.jupiter";
type ParsedIntentTextFields = Partial<{
	intentType: WorkflowIntentType;
	toAddress: string;
	amountSol: number;
	amountUi: string;
	inputMint: string;
	outputMint: string;
	amountRaw: string;
	slippageBps: number;
	swapMode: "ExactIn" | "ExactOut";
}>;

type TransferSolIntent = {
	type: "solana.transfer.sol";
	fromAddress: string;
	toAddress: string;
	amountSol: number;
	lamports: number;
};

type JupiterSwapIntent = {
	type: "solana.swap.jupiter";
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
};

type WorkflowIntent = TransferSolIntent | JupiterSwapIntent;

type PreparedTransaction = {
	tx: Transaction | VersionedTransaction;
	version: "legacy" | "v0";
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

function createWorkflowPlan(intentType: WorkflowIntentType): string[] {
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
	const amountMatch =
		intentText.match(/\bamountSol\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)\b/i) ??
		intentText.match(/([0-9]+(?:\.[0-9]+)?)\s*sol\b/i);
	if (amountMatch?.[1]) {
		const amountSol = parsePositiveNumber(amountMatch[1]);
		if (amountSol != null) {
			parsed.amountSol = amountSol;
		}
	}
	return parsed;
}

function parseSwapIntentText(intentText: string): ParsedIntentTextFields {
	const parsed: ParsedIntentTextFields = {
		intentType: "solana.swap.jupiter",
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
	return parsed;
}

function parseIntentTextFields(intentText: unknown): ParsedIntentTextFields {
	if (typeof intentText !== "string" || intentText.trim().length === 0) {
		return {};
	}
	const trimmed = intentText.trim();
	const lower = trimmed.toLowerCase();
	if (lower.includes("solana.transfer.sol")) {
		return parseTransferIntentText(trimmed);
	}
	if (lower.includes("solana.swap.jupiter")) {
		return parseSwapIntentText(trimmed);
	}
	const hasSwapKeywords = SWAP_KEYWORD_REGEX.test(trimmed);
	const hasTransferKeywords = TRANSFER_KEYWORD_REGEX.test(trimmed);
	if (hasSwapKeywords && !hasTransferKeywords) {
		return parseSwapIntentText(trimmed);
	}
	if (hasTransferKeywords && !hasSwapKeywords) {
		return parseTransferIntentText(trimmed);
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
	const transferFields = parseTransferIntentText(trimmed);
	if (transferFields.toAddress || transferFields.amountSol) {
		return transferFields;
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
		params.intentType === "solana.swap.jupiter"
	) {
		return params.intentType;
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

async function normalizeIntent(
	params: Record<string, unknown>,
	signerPublicKey: string,
	network: string,
): Promise<WorkflowIntent> {
	const normalizedParams = mergeIntentParams(params);
	const intentType = resolveIntentType(normalizedParams);
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
		dexes: Array.isArray(normalizedParams.dexes)
			? normalizedParams.dexes.filter(
					(entry): entry is string => typeof entry === "string",
				)
			: undefined,
		excludeDexes: Array.isArray(normalizedParams.excludeDexes)
			? normalizedParams.excludeDexes.filter(
					(entry): entry is string => typeof entry === "string",
				)
			: undefined,
		asLegacyTransaction:
			typeof normalizedParams.asLegacyTransaction === "boolean"
				? normalizedParams.asLegacyTransaction
				: undefined,
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

async function prepareJupiterSwapSimulation(
	network: string,
	signer: Keypair,
	intent: JupiterSwapIntent,
	params: Record<string, unknown>,
): Promise<PreparedTransaction> {
	assertJupiterNetworkSupported(network);
	const quote = await getJupiterQuote({
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
	});
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
	const quotePayload =
		quote && typeof quote === "object"
			? (quote as Record<string, unknown>)
			: {};
	const routePlan = Array.isArray(quotePayload.routePlan)
		? quotePayload.routePlan
		: [];
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
			swapResponse: swapPayload,
			outAmount:
				typeof quotePayload.outAmount === "string"
					? quotePayload.outAmount
					: null,
			routeCount: routePlan.length,
			jupiterBaseUrl: getJupiterApiBaseUrl(),
		},
	};
}

async function prepareSimulation(
	network: string,
	signer: Keypair,
	intent: WorkflowIntent,
	params: Record<string, unknown>,
): Promise<PreparedTransaction> {
	if (intent.type === "solana.transfer.sol") {
		return prepareTransferSolSimulation(network, signer, intent);
	}
	return prepareJupiterSwapSimulation(network, signer, intent, params);
}

async function executePreparedTransaction(
	network: string,
	prepared: PreparedTransaction,
	params: Record<string, unknown>,
): Promise<{
	signature: string;
	confirmed: boolean;
}> {
	const connection = getConnection(network);
	const signature = await connection.sendRawTransaction(
		prepared.tx.serialize(),
		{
			skipPreflight: params.skipPreflight === true,
			maxRetries:
				typeof params.maxRetries === "number" ? params.maxRetries : undefined,
		},
	);
	const commitment = parseFinality(
		typeof params.commitment === "string" ? params.commitment : undefined,
	);
	let confirmationErr: unknown = null;
	if (params.confirm !== false) {
		const confirmation = await connection.confirmTransaction(
			signature,
			commitment,
		);
		confirmationErr = confirmation.value.err;
	}
	if (confirmationErr) {
		throw new Error(
			`Transaction confirmed with error: ${JSON.stringify(confirmationErr)}`,
		);
	}
	return {
		signature,
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
						Type.Literal("solana.swap.jupiter"),
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
				toAddress: Type.Optional(
					Type.String({
						description:
							"Destination address for intentType=solana.transfer.sol",
					}),
				),
				amountSol: Type.Optional(
					Type.Number({
						description: "Amount in SOL for intentType=solana.transfer.sol",
					}),
				),
				inputMint: Type.Optional(
					Type.String({
						description: "Input mint for intentType=solana.swap.jupiter",
					}),
				),
				outputMint: Type.Optional(
					Type.String({
						description: "Output mint for intentType=solana.swap.jupiter",
					}),
				),
				amountRaw: Type.Optional(
					Type.String({
						description:
							"Raw integer amount for intentType=solana.swap.jupiter",
					}),
				),
				amountUi: Type.Optional(
					Type.String({
						description:
							"Optional human-readable token amount for swaps (for known mints like SOL/USDC/USDT).",
					}),
				),
				slippageBps: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
				swapMode: jupiterSwapModeSchema(),
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
				destinationTokenAccount: Type.Optional(Type.String()),
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
				);
				const confirmToken = createConfirmToken(runId, network, intent);
				const approvalRequired = network === "mainnet-beta";
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
							"Mainnet execute requires confirmMainnet=true. Run analysis/simulate first to obtain confirmToken.",
						);
					}
					if (params.confirmToken !== confirmToken) {
						throw new Error(
							`Invalid confirmToken for runId=${runId}. Expected ${confirmToken}.`,
						);
					}
				}
				if (!prepared.simulation.ok) {
					throw new Error(
						"Simulation failed; execution blocked by workflow policy",
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
					confirmed: execution.confirmed,
					version: prepared.version,
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
