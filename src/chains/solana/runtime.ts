import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type SwapRequest as JupiterSdkSwapRequest,
	createJupiterApiClient,
} from "@jup-ag/api";
import {
	DEFAULT_RECENT_SLOT_DURATION_MS,
	PROGRAM_ID as KAMINO_PROGRAM_ID,
	KaminoAction,
	KaminoMarket,
	VanillaObligation,
} from "@kamino-finance/klend-sdk";
import { fetchPositionsForOwner } from "@orca-so/whirlpools";
import { fetchAllMaybeWhirlpool } from "@orca-so/whirlpools-client";
import {
	API_URLS as RAYDIUM_API_URLS,
	Api as RaydiumApiClient,
	type API_URL_CONFIG as RaydiumApiUrlConfig,
} from "@raydium-io/raydium-sdk-v2";
import { Type } from "@sinclair/typebox";
import {
	AccountRole,
	type Instruction as KitInstruction,
	address,
	createNoopSigner,
	createSolanaRpc,
} from "@solana/kit";
import {
	Connection,
	LAMPORTS_PER_SOL,
	PublicKey,
	Transaction,
	TransactionInstruction,
	VersionedTransaction,
	clusterApiUrl,
} from "@solana/web3.js";
import bs58 from "bs58";

export type SolanaNetwork = "mainnet-beta" | "devnet" | "testnet";
export type CommitmentLevel = "processed" | "confirmed" | "finalized";
export type FinalityLevel = "confirmed" | "finalized";
export type SplTokenProgram = "token" | "token2022";
export type JupiterSwapMode = "ExactIn" | "ExactOut";
export type JupiterPriorityLevel = "medium" | "high" | "veryHigh" | "unsafeMax";
export type RaydiumTxVersion = "V0" | "LEGACY";
export type RaydiumSwapType = "BaseIn" | "BaseOut";

export const TOOL_PREFIX = "solana_";
const DEFAULT_COMMITMENT: CommitmentLevel = "confirmed";

export const TOKEN_PROGRAM_ID = new PublicKey(
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
	"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
export const KAMINO_MAINNET_MARKET_ADDRESS =
	"7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
export const DANGEROUS_RPC_METHODS = new Set([
	"sendTransaction",
	"requestAirdrop",
]);
const DANGEROUS_RPC_METHODS_NORMALIZED = new Set(
	[...DANGEROUS_RPC_METHODS].map((method) => method.toLowerCase()),
);

type TokenAmountInfo = {
	amount: string;
	decimals: number;
	uiAmount: number | null;
};

export type ParsedTokenAccountInfo = {
	mint: string;
	owner: string;
	tokenAmount: TokenAmountInfo;
};

export function solanaNetworkSchema() {
	return Type.Optional(
		Type.Union([
			Type.Literal("mainnet-beta"),
			Type.Literal("devnet"),
			Type.Literal("testnet"),
		]),
	);
}

export function commitmentSchema() {
	return Type.Optional(
		Type.Union([
			Type.Literal("processed"),
			Type.Literal("confirmed"),
			Type.Literal("finalized"),
		]),
	);
}

export function splTokenProgramSchema() {
	return Type.Optional(
		Type.Union([Type.Literal("token"), Type.Literal("token2022")]),
	);
}

export function jupiterSwapModeSchema() {
	return Type.Optional(
		Type.Union([Type.Literal("ExactIn"), Type.Literal("ExactOut")]),
	);
}

export function jupiterPriorityLevelSchema() {
	return Type.Optional(
		Type.Union([
			Type.Literal("medium"),
			Type.Literal("high"),
			Type.Literal("veryHigh"),
			Type.Literal("unsafeMax"),
		]),
	);
}

export function raydiumTxVersionSchema() {
	return Type.Optional(
		Type.Union([Type.Literal("V0"), Type.Literal("LEGACY")]),
	);
}

export function raydiumSwapTypeSchema() {
	return Type.Optional(
		Type.Union([Type.Literal("BaseIn"), Type.Literal("BaseOut")]),
	);
}

export function normalizeAtPath(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

export function parseNetwork(value?: string): SolanaNetwork {
	if (value === "devnet" || value === "testnet" || value === "mainnet-beta")
		return value;
	if (value === "mainnet") return "mainnet-beta";
	return "mainnet-beta";
}

export function parseCommitment(value?: string): CommitmentLevel {
	if (value === "processed" || value === "confirmed" || value === "finalized")
		return value;
	return DEFAULT_COMMITMENT;
}

export function parseFinality(value?: string): FinalityLevel {
	if (value === "finalized") return "finalized";
	return "confirmed";
}

export function parseSplTokenProgram(value?: string): SplTokenProgram {
	if (value === "token2022") return "token2022";
	return "token";
}

export function parseJupiterSwapMode(value?: string): JupiterSwapMode {
	if (value === "ExactOut") return "ExactOut";
	return "ExactIn";
}

export function parseJupiterPriorityLevel(
	value?: string,
): JupiterPriorityLevel {
	if (value === "medium") return "medium";
	if (value === "high") return "high";
	if (value === "unsafeMax") return "unsafeMax";
	return "veryHigh";
}

export function parseRaydiumTxVersion(value?: string): RaydiumTxVersion {
	if (value === "LEGACY") return "LEGACY";
	return "V0";
}

export function parseRaydiumSwapType(value?: string): RaydiumSwapType {
	if (value === "BaseOut") return "BaseOut";
	return "BaseIn";
}

export function getSplTokenProgramId(program?: string): PublicKey {
	return parseSplTokenProgram(program) === "token2022"
		? TOKEN_2022_PROGRAM_ID
		: TOKEN_PROGRAM_ID;
}

export function getExplorerCluster(network?: string): SolanaNetwork {
	return parseNetwork(network);
}

export function getExplorerTransactionUrl(
	signature: string,
	network?: string,
): string {
	const cluster = getExplorerCluster(network);
	return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export function getExplorerAddressUrl(
	address: string,
	network?: string,
): string {
	const cluster = getExplorerCluster(network);
	return `https://explorer.solana.com/address/${address}?cluster=${cluster}`;
}

export function isDangerousRpcMethod(method: string): boolean {
	return DANGEROUS_RPC_METHODS_NORMALIZED.has(method.toLowerCase());
}

export function getRpcEndpoint(network?: string): string {
	const selected = parseNetwork(network);
	return process.env.SOLANA_RPC_URL?.trim() || clusterApiUrl(selected);
}

export function getConnection(network?: string): Connection {
	const endpoint = getRpcEndpoint(network);
	const commitment = parseCommitment(process.env.SOLANA_COMMITMENT);
	return new Connection(endpoint, { commitment });
}

export function getJupiterApiKey(): string | null {
	const apiKey = process.env.JUPITER_API_KEY?.trim();
	return apiKey && apiKey.length > 0 ? apiKey : null;
}

export function getJupiterApiBaseUrl(): string {
	const configured = process.env.JUPITER_API_BASE_URL?.trim();
	if (configured && configured.length > 0) {
		return configured.replace(/\/+$/, "");
	}

	// Without API key, default to lite endpoint for easier local usage.
	return getJupiterApiKey() ? "https://api.jup.ag" : "https://lite-api.jup.ag";
}

type JupiterApiClient = ReturnType<typeof createJupiterApiClient>;
let jupiterClientCache: {
	key: string;
	client: JupiterApiClient;
} | null = null;

let raydiumClientCache: {
	key: string;
	client: RaydiumApiClient;
} | null = null;

function getJupiterClientCacheKey(): string {
	const baseUrl = getJupiterApiBaseUrl();
	const apiKey = getJupiterApiKey() ?? "";
	return `${baseUrl}::${apiKey}`;
}

function getJupiterApiClient(): JupiterApiClient {
	const cacheKey = getJupiterClientCacheKey();
	if (jupiterClientCache?.key === cacheKey) {
		return jupiterClientCache.client;
	}

	const basePath = getJupiterApiBaseUrl();
	const apiKey = getJupiterApiKey();
	const client = createJupiterApiClient({
		basePath,
		apiKey: apiKey ?? undefined,
		fetchApi: fetch,
	});
	jupiterClientCache = { key: cacheKey, client };
	return client;
}

export function assertJupiterNetworkSupported(network?: string): void {
	const selected = parseNetwork(network);
	if (selected !== "mainnet-beta") {
		throw new Error(
			"Jupiter API tools currently support mainnet-beta only. For preprod environments, set JUPITER_API_BASE_URL explicitly.",
		);
	}
}

export function assertRaydiumNetworkSupported(network?: string): void {
	const selected = parseNetwork(network);
	if (selected !== "mainnet-beta") {
		throw new Error(
			"Raydium API tools currently support mainnet-beta only. For custom environments, set RAYDIUM_API_BASE_URL and RAYDIUM_PRIORITY_FEE_API_BASE_URL explicitly.",
		);
	}
}

export function getRaydiumApiBaseUrl(): string {
	const configured = process.env.RAYDIUM_API_BASE_URL?.trim();
	if (configured && configured.length > 0) {
		return configured.replace(/\/+$/, "");
	}
	return RAYDIUM_API_URLS.SWAP_HOST;
}

export function getRaydiumPriorityFeeApiBaseUrl(): string {
	const configured = process.env.RAYDIUM_PRIORITY_FEE_API_BASE_URL?.trim();
	if (configured && configured.length > 0) {
		return configured.replace(/\/+$/, "");
	}
	return RAYDIUM_API_URLS.BASE_HOST;
}

function getRaydiumApiPath(path: string): string {
	return path.startsWith("/") ? path : `/${path}`;
}

function getRaydiumApiUrlConfig(): RaydiumApiUrlConfig | undefined {
	const baseHost = getRaydiumPriorityFeeApiBaseUrl();
	const swapHost = getRaydiumApiBaseUrl();
	const urlConfig: RaydiumApiUrlConfig = {};
	if (baseHost !== RAYDIUM_API_URLS.BASE_HOST) {
		urlConfig.BASE_HOST = baseHost;
	}
	if (swapHost !== RAYDIUM_API_URLS.SWAP_HOST) {
		urlConfig.SWAP_HOST = swapHost;
	}
	return Object.keys(urlConfig).length > 0 ? urlConfig : undefined;
}

function getRaydiumClientCacheKey(): string {
	const baseHost = getRaydiumPriorityFeeApiBaseUrl();
	const swapHost = getRaydiumApiBaseUrl();
	return `${baseHost}::${swapHost}`;
}

function getRaydiumApiClient(): RaydiumApiClient {
	const cacheKey = getRaydiumClientCacheKey();
	if (raydiumClientCache?.key === cacheKey) {
		return raydiumClientCache.client;
	}

	const client = new RaydiumApiClient({
		cluster: "mainnet",
		timeout: 20_000,
		logRequests: false,
		urlConfigs: getRaydiumApiUrlConfig(),
	});
	raydiumClientCache = { key: cacheKey, client };
	return client;
}

function parseSecretKey(secretKey: string): Uint8Array {
	const normalized = secretKey.trim();
	if (normalized.startsWith("[")) {
		const arr = JSON.parse(normalized) as number[];
		return Uint8Array.from(arr);
	}
	return bs58.decode(normalized);
}

function resolveHome(filePath: string): string {
	if (filePath === "~") return os.homedir();
	if (filePath.startsWith("~/"))
		return path.join(os.homedir(), filePath.slice(2));
	return filePath;
}

function resolveKeypairPath(): string {
	const configured = process.env.SOLANA_KEYPAIR_PATH?.trim();
	if (configured) return resolveHome(configured);
	return path.join(os.homedir(), ".config", "solana", "id.json");
}

function loadSecretKeyFromDefaultPath(): Uint8Array {
	const keypairPath = resolveKeypairPath();
	const raw = fs.readFileSync(keypairPath, "utf8").trim();
	const arr = JSON.parse(raw) as number[];
	return Uint8Array.from(arr);
}

export function resolveSecretKey(secretKey?: string): Uint8Array {
	if (secretKey && secretKey.trim().length > 0) {
		return parseSecretKey(secretKey);
	}

	const envSecret = process.env.SOLANA_SECRET_KEY?.trim();
	if (envSecret) return parseSecretKey(envSecret);

	return loadSecretKeyFromDefaultPath();
}

export function assertPositiveAmount(amountSol: number): void {
	if (!Number.isFinite(amountSol) || amountSol <= 0) {
		throw new Error("amountSol must be a positive number");
	}
}

export function toLamports(amountSol: number): number {
	assertPositiveAmount(amountSol);
	const lamports = amountSol * LAMPORTS_PER_SOL;
	const rounded = Math.round(lamports);
	if (!Number.isSafeInteger(rounded)) {
		throw new Error("amountSol is too large");
	}
	if (Math.abs(lamports - rounded) > 1e-6) {
		throw new Error("amountSol supports up to 9 decimal places");
	}
	return rounded;
}

export function parsePositiveBigInt(
	value: string,
	fieldName = "amount",
): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an integer string`);
	}
	const amount = BigInt(normalized);
	if (amount <= 0n) {
		throw new Error(`${fieldName} must be greater than 0`);
	}
	return amount;
}

export function stringifyUnknown(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function parseTokenAccountInfo(
	value: unknown,
): ParsedTokenAccountInfo | null {
	if (!value || typeof value !== "object") return null;
	const record = value as { parsed?: unknown };
	if (!record.parsed || typeof record.parsed !== "object") return null;
	const parsed = record.parsed as { info?: unknown };
	if (!parsed.info || typeof parsed.info !== "object") return null;
	const info = parsed.info as {
		mint?: unknown;
		owner?: unknown;
		tokenAmount?: unknown;
	};
	if (typeof info.mint !== "string" || typeof info.owner !== "string")
		return null;
	if (!info.tokenAmount || typeof info.tokenAmount !== "object") return null;

	const tokenAmount = info.tokenAmount as {
		amount?: unknown;
		decimals?: unknown;
		uiAmount?: unknown;
	};
	if (
		typeof tokenAmount.amount !== "string" ||
		typeof tokenAmount.decimals !== "number"
	)
		return null;

	const uiAmount =
		typeof tokenAmount.uiAmount === "number" || tokenAmount.uiAmount === null
			? tokenAmount.uiAmount
			: null;
	return {
		mint: info.mint,
		owner: info.owner,
		tokenAmount: {
			amount: tokenAmount.amount,
			decimals: tokenAmount.decimals,
			uiAmount,
		},
	};
}

export function parseTransactionFromBase64(
	value: string,
): Transaction | VersionedTransaction {
	const raw = Buffer.from(value, "base64");
	try {
		return VersionedTransaction.deserialize(raw);
	} catch {
		return Transaction.from(raw);
	}
}

function isSignerRole(role: AccountRole): boolean {
	return (
		role === AccountRole.READONLY_SIGNER || role === AccountRole.WRITABLE_SIGNER
	);
}

function isWritableRole(role: AccountRole): boolean {
	return role === AccountRole.WRITABLE || role === AccountRole.WRITABLE_SIGNER;
}

function convertKitInstructionToLegacy(
	instruction: KitInstruction,
): TransactionInstruction {
	const keys = (instruction.accounts ?? []).map((account) => ({
		pubkey: new PublicKey(account.address),
		isSigner: isSignerRole(account.role),
		isWritable: isWritableRole(account.role),
	}));
	return new TransactionInstruction({
		programId: new PublicKey(instruction.programAddress),
		keys,
		data: instruction.data ? Buffer.from(instruction.data) : Buffer.alloc(0),
	});
}

function parseKaminoExtraComputeUnits(value: number | undefined): number {
	if (value === undefined) {
		return 1_000_000;
	}
	if (!Number.isInteger(value) || value < 0 || value > 2_000_000) {
		throw new Error(
			"extraComputeUnits must be an integer between 0 and 2000000",
		);
	}
	return value;
}

type KaminoRepayCurrentSlot = Parameters<typeof KaminoAction.buildRepayTxns>[7];

async function resolveKaminoRepayCurrentSlot(
	network: SolanaNetwork,
	value: string | number | bigint | undefined,
): Promise<KaminoRepayCurrentSlot> {
	if (value === undefined) {
		const slot = await getConnection(network).getSlot();
		return BigInt(slot) as KaminoRepayCurrentSlot;
	}
	if (typeof value === "bigint") {
		if (value < 0n) {
			throw new Error("currentSlot must be a non-negative integer");
		}
		return value as KaminoRepayCurrentSlot;
	}
	if (typeof value === "number") {
		if (!Number.isInteger(value) || value < 0) {
			throw new Error("currentSlot must be a non-negative integer");
		}
		return BigInt(value) as KaminoRepayCurrentSlot;
	}
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error("currentSlot must be a non-negative integer");
	}
	return BigInt(normalized) as KaminoRepayCurrentSlot;
}

export async function buildKaminoDepositInstructions(
	request: KaminoDepositInstructionsRequest,
): Promise<KaminoDepositInstructionsResult> {
	const network = parseNetwork(request.network);
	const ownerAddress = new PublicKey(
		normalizeAtPath(request.ownerAddress),
	).toBase58();
	const reserveMint = new PublicKey(
		normalizeAtPath(request.reserveMint),
	).toBase58();
	const marketInput =
		typeof request.marketAddress === "string" &&
		request.marketAddress.trim().length > 0
			? request.marketAddress
			: network === "mainnet-beta"
				? KAMINO_MAINNET_MARKET_ADDRESS
				: null;
	if (!marketInput) {
		throw new Error(
			"marketAddress is required when network is not mainnet-beta",
		);
	}
	const marketAddress = new PublicKey(normalizeAtPath(marketInput)).toBase58();
	const programId = new PublicKey(
		normalizeAtPath(request.programId ?? KAMINO_PROGRAM_ID),
	).toBase58();
	const amountRaw = parsePositiveBigInt(
		request.amountRaw,
		"amountRaw",
	).toString();
	const useV2Ixs = request.useV2Ixs !== false;
	const includeAtaIxs = request.includeAtaIxs !== false;
	const extraComputeUnits = parseKaminoExtraComputeUnits(
		request.extraComputeUnits,
	);
	const requestElevationGroup = request.requestElevationGroup === true;

	const rpc = createSolanaRpc(getRpcEndpoint(network));
	const kaminoMarket = await KaminoMarket.load(
		rpc,
		address(marketAddress),
		DEFAULT_RECENT_SLOT_DURATION_MS,
		address(programId),
	);
	if (!kaminoMarket) {
		throw new Error(`Kamino market not found: ${marketAddress}`);
	}
	const reserve = kaminoMarket.getReserveByMint(address(reserveMint));
	if (!reserve) {
		throw new Error(
			`Kamino reserve not found in market: reserveMint=${reserveMint} marketAddress=${marketAddress}`,
		);
	}
	const action = await KaminoAction.buildDepositTxns(
		kaminoMarket,
		amountRaw,
		reserve.getLiquidityMint(),
		createNoopSigner(address(ownerAddress)),
		new VanillaObligation(address(programId)),
		useV2Ixs,
		undefined,
		extraComputeUnits,
		includeAtaIxs,
		requestElevationGroup,
	);
	const instructions = KaminoAction.actionToIxs(action).map(
		convertKitInstructionToLegacy,
	);
	const obligationAddress = await action.getObligationPda();
	return {
		network,
		ownerAddress,
		marketAddress,
		programId,
		reserveMint,
		reserveAddress: reserve.address,
		reserveSymbol: reserve.symbol ?? null,
		amountRaw,
		useV2Ixs,
		includeAtaIxs,
		extraComputeUnits,
		requestElevationGroup,
		obligationAddress,
		instructionCount: instructions.length,
		setupInstructionCount: action.setupIxs.length,
		lendingInstructionCount: action.lendingIxs.length,
		cleanupInstructionCount: action.cleanupIxs.length,
		setupInstructionLabels: [...action.setupIxsLabels],
		lendingInstructionLabels: [...action.lendingIxsLabels],
		cleanupInstructionLabels: [...action.cleanupIxsLabels],
		instructions,
	};
}

export async function buildKaminoBorrowInstructions(
	request: KaminoBorrowInstructionsRequest,
): Promise<KaminoBorrowInstructionsResult> {
	const network = parseNetwork(request.network);
	const ownerAddress = new PublicKey(
		normalizeAtPath(request.ownerAddress),
	).toBase58();
	const reserveMint = new PublicKey(
		normalizeAtPath(request.reserveMint),
	).toBase58();
	const marketInput =
		typeof request.marketAddress === "string" &&
		request.marketAddress.trim().length > 0
			? request.marketAddress
			: network === "mainnet-beta"
				? KAMINO_MAINNET_MARKET_ADDRESS
				: null;
	if (!marketInput) {
		throw new Error(
			"marketAddress is required when network is not mainnet-beta",
		);
	}
	const marketAddress = new PublicKey(normalizeAtPath(marketInput)).toBase58();
	const programId = new PublicKey(
		normalizeAtPath(request.programId ?? KAMINO_PROGRAM_ID),
	).toBase58();
	const amountRaw = parsePositiveBigInt(
		request.amountRaw,
		"amountRaw",
	).toString();
	const useV2Ixs = request.useV2Ixs !== false;
	const includeAtaIxs = request.includeAtaIxs !== false;
	const extraComputeUnits = parseKaminoExtraComputeUnits(
		request.extraComputeUnits,
	);
	const requestElevationGroup = request.requestElevationGroup === true;

	const rpc = createSolanaRpc(getRpcEndpoint(network));
	const kaminoMarket = await KaminoMarket.load(
		rpc,
		address(marketAddress),
		DEFAULT_RECENT_SLOT_DURATION_MS,
		address(programId),
	);
	if (!kaminoMarket) {
		throw new Error(`Kamino market not found: ${marketAddress}`);
	}
	const reserve = kaminoMarket.getReserveByMint(address(reserveMint));
	if (!reserve) {
		throw new Error(
			`Kamino reserve not found in market: reserveMint=${reserveMint} marketAddress=${marketAddress}`,
		);
	}
	const action = await KaminoAction.buildBorrowTxns(
		kaminoMarket,
		amountRaw,
		reserve.getLiquidityMint(),
		createNoopSigner(address(ownerAddress)),
		new VanillaObligation(address(programId)),
		useV2Ixs,
		undefined,
		extraComputeUnits,
		includeAtaIxs,
		requestElevationGroup,
	);
	const instructions = KaminoAction.actionToIxs(action).map(
		convertKitInstructionToLegacy,
	);
	const obligationAddress = await action.getObligationPda();
	return {
		network,
		ownerAddress,
		marketAddress,
		programId,
		reserveMint,
		reserveAddress: reserve.address,
		reserveSymbol: reserve.symbol ?? null,
		amountRaw,
		useV2Ixs,
		includeAtaIxs,
		extraComputeUnits,
		requestElevationGroup,
		obligationAddress,
		instructionCount: instructions.length,
		setupInstructionCount: action.setupIxs.length,
		lendingInstructionCount: action.lendingIxs.length,
		cleanupInstructionCount: action.cleanupIxs.length,
		setupInstructionLabels: [...action.setupIxsLabels],
		lendingInstructionLabels: [...action.lendingIxsLabels],
		cleanupInstructionLabels: [...action.cleanupIxsLabels],
		instructions,
	};
}

export async function buildKaminoWithdrawInstructions(
	request: KaminoWithdrawInstructionsRequest,
): Promise<KaminoWithdrawInstructionsResult> {
	const network = parseNetwork(request.network);
	const ownerAddress = new PublicKey(
		normalizeAtPath(request.ownerAddress),
	).toBase58();
	const reserveMint = new PublicKey(
		normalizeAtPath(request.reserveMint),
	).toBase58();
	const marketInput =
		typeof request.marketAddress === "string" &&
		request.marketAddress.trim().length > 0
			? request.marketAddress
			: network === "mainnet-beta"
				? KAMINO_MAINNET_MARKET_ADDRESS
				: null;
	if (!marketInput) {
		throw new Error(
			"marketAddress is required when network is not mainnet-beta",
		);
	}
	const marketAddress = new PublicKey(normalizeAtPath(marketInput)).toBase58();
	const programId = new PublicKey(
		normalizeAtPath(request.programId ?? KAMINO_PROGRAM_ID),
	).toBase58();
	const amountRaw = parsePositiveBigInt(
		request.amountRaw,
		"amountRaw",
	).toString();
	const useV2Ixs = request.useV2Ixs !== false;
	const includeAtaIxs = request.includeAtaIxs !== false;
	const extraComputeUnits = parseKaminoExtraComputeUnits(
		request.extraComputeUnits,
	);
	const requestElevationGroup = request.requestElevationGroup === true;

	const rpc = createSolanaRpc(getRpcEndpoint(network));
	const kaminoMarket = await KaminoMarket.load(
		rpc,
		address(marketAddress),
		DEFAULT_RECENT_SLOT_DURATION_MS,
		address(programId),
	);
	if (!kaminoMarket) {
		throw new Error(`Kamino market not found: ${marketAddress}`);
	}
	const reserve = kaminoMarket.getReserveByMint(address(reserveMint));
	if (!reserve) {
		throw new Error(
			`Kamino reserve not found in market: reserveMint=${reserveMint} marketAddress=${marketAddress}`,
		);
	}
	const action = await KaminoAction.buildWithdrawTxns(
		kaminoMarket,
		amountRaw,
		reserve.getLiquidityMint(),
		createNoopSigner(address(ownerAddress)),
		new VanillaObligation(address(programId)),
		useV2Ixs,
		undefined,
		extraComputeUnits,
		includeAtaIxs,
		requestElevationGroup,
	);
	const instructions = KaminoAction.actionToIxs(action).map(
		convertKitInstructionToLegacy,
	);
	const obligationAddress = await action.getObligationPda();
	return {
		network,
		ownerAddress,
		marketAddress,
		programId,
		reserveMint,
		reserveAddress: reserve.address,
		reserveSymbol: reserve.symbol ?? null,
		amountRaw,
		useV2Ixs,
		includeAtaIxs,
		extraComputeUnits,
		requestElevationGroup,
		obligationAddress,
		instructionCount: instructions.length,
		setupInstructionCount: action.setupIxs.length,
		lendingInstructionCount: action.lendingIxs.length,
		cleanupInstructionCount: action.cleanupIxs.length,
		setupInstructionLabels: [...action.setupIxsLabels],
		lendingInstructionLabels: [...action.lendingIxsLabels],
		cleanupInstructionLabels: [...action.cleanupIxsLabels],
		instructions,
	};
}

export async function buildKaminoRepayInstructions(
	request: KaminoRepayInstructionsRequest,
): Promise<KaminoRepayInstructionsResult> {
	const network = parseNetwork(request.network);
	const ownerAddress = new PublicKey(
		normalizeAtPath(request.ownerAddress),
	).toBase58();
	const reserveMint = new PublicKey(
		normalizeAtPath(request.reserveMint),
	).toBase58();
	const marketInput =
		typeof request.marketAddress === "string" &&
		request.marketAddress.trim().length > 0
			? request.marketAddress
			: network === "mainnet-beta"
				? KAMINO_MAINNET_MARKET_ADDRESS
				: null;
	if (!marketInput) {
		throw new Error(
			"marketAddress is required when network is not mainnet-beta",
		);
	}
	const marketAddress = new PublicKey(normalizeAtPath(marketInput)).toBase58();
	const programId = new PublicKey(
		normalizeAtPath(request.programId ?? KAMINO_PROGRAM_ID),
	).toBase58();
	const amountRaw = parsePositiveBigInt(
		request.amountRaw,
		"amountRaw",
	).toString();
	const useV2Ixs = request.useV2Ixs !== false;
	const includeAtaIxs = request.includeAtaIxs !== false;
	const extraComputeUnits = parseKaminoExtraComputeUnits(
		request.extraComputeUnits,
	);
	const requestElevationGroup = request.requestElevationGroup === true;
	const currentSlot = await resolveKaminoRepayCurrentSlot(
		network,
		request.currentSlot,
	);

	const rpc = createSolanaRpc(getRpcEndpoint(network));
	const kaminoMarket = await KaminoMarket.load(
		rpc,
		address(marketAddress),
		DEFAULT_RECENT_SLOT_DURATION_MS,
		address(programId),
	);
	if (!kaminoMarket) {
		throw new Error(`Kamino market not found: ${marketAddress}`);
	}
	const reserve = kaminoMarket.getReserveByMint(address(reserveMint));
	if (!reserve) {
		throw new Error(
			`Kamino reserve not found in market: reserveMint=${reserveMint} marketAddress=${marketAddress}`,
		);
	}
	const action = await KaminoAction.buildRepayTxns(
		kaminoMarket,
		amountRaw,
		reserve.getLiquidityMint(),
		createNoopSigner(address(ownerAddress)),
		new VanillaObligation(address(programId)),
		useV2Ixs,
		undefined,
		currentSlot,
		undefined,
		extraComputeUnits,
		includeAtaIxs,
		requestElevationGroup,
	);
	const instructions = KaminoAction.actionToIxs(action).map(
		convertKitInstructionToLegacy,
	);
	const obligationAddress = await action.getObligationPda();
	return {
		network,
		ownerAddress,
		marketAddress,
		programId,
		reserveMint,
		reserveAddress: reserve.address,
		reserveSymbol: reserve.symbol ?? null,
		amountRaw,
		useV2Ixs,
		includeAtaIxs,
		extraComputeUnits,
		requestElevationGroup,
		currentSlot: currentSlot.toString(),
		obligationAddress,
		instructionCount: instructions.length,
		setupInstructionCount: action.setupIxs.length,
		lendingInstructionCount: action.lendingIxs.length,
		cleanupInstructionCount: action.cleanupIxs.length,
		setupInstructionLabels: [...action.setupIxsLabels],
		lendingInstructionLabels: [...action.lendingIxsLabels],
		cleanupInstructionLabels: [...action.cleanupIxsLabels],
		instructions,
	};
}

export async function buildKaminoDepositAndBorrowInstructions(
	request: KaminoDepositAndBorrowInstructionsRequest,
): Promise<KaminoDepositAndBorrowInstructionsResult> {
	const network = parseNetwork(request.network);
	const ownerAddress = new PublicKey(
		normalizeAtPath(request.ownerAddress),
	).toBase58();
	const depositReserveMint = new PublicKey(
		normalizeAtPath(request.depositReserveMint),
	).toBase58();
	const borrowReserveMint = new PublicKey(
		normalizeAtPath(request.borrowReserveMint),
	).toBase58();
	const marketInput =
		typeof request.marketAddress === "string" &&
		request.marketAddress.trim().length > 0
			? request.marketAddress
			: network === "mainnet-beta"
				? KAMINO_MAINNET_MARKET_ADDRESS
				: null;
	if (!marketInput) {
		throw new Error(
			"marketAddress is required when network is not mainnet-beta",
		);
	}
	const marketAddress = new PublicKey(normalizeAtPath(marketInput)).toBase58();
	const programId = new PublicKey(
		normalizeAtPath(request.programId ?? KAMINO_PROGRAM_ID),
	).toBase58();
	const depositAmountRaw = parsePositiveBigInt(
		request.depositAmountRaw,
		"depositAmountRaw",
	).toString();
	const borrowAmountRaw = parsePositiveBigInt(
		request.borrowAmountRaw,
		"borrowAmountRaw",
	).toString();
	const useV2Ixs = request.useV2Ixs !== false;
	const includeAtaIxs = request.includeAtaIxs !== false;
	const extraComputeUnits = parseKaminoExtraComputeUnits(
		request.extraComputeUnits,
	);
	const requestElevationGroup = request.requestElevationGroup === true;

	const rpc = createSolanaRpc(getRpcEndpoint(network));
	const kaminoMarket = await KaminoMarket.load(
		rpc,
		address(marketAddress),
		DEFAULT_RECENT_SLOT_DURATION_MS,
		address(programId),
	);
	if (!kaminoMarket) {
		throw new Error(`Kamino market not found: ${marketAddress}`);
	}
	const depositReserve = kaminoMarket.getReserveByMint(
		address(depositReserveMint),
	);
	if (!depositReserve) {
		throw new Error(
			`Kamino deposit reserve not found in market: reserveMint=${depositReserveMint} marketAddress=${marketAddress}`,
		);
	}
	const borrowReserve = kaminoMarket.getReserveByMint(
		address(borrowReserveMint),
	);
	if (!borrowReserve) {
		throw new Error(
			`Kamino borrow reserve not found in market: reserveMint=${borrowReserveMint} marketAddress=${marketAddress}`,
		);
	}
	const action = await KaminoAction.buildDepositAndBorrowTxns(
		kaminoMarket,
		depositAmountRaw,
		depositReserve.getLiquidityMint(),
		borrowAmountRaw,
		borrowReserve.getLiquidityMint(),
		createNoopSigner(address(ownerAddress)),
		new VanillaObligation(address(programId)),
		useV2Ixs,
		undefined,
		extraComputeUnits,
		includeAtaIxs,
		requestElevationGroup,
	);
	const instructions = KaminoAction.actionToIxs(action).map(
		convertKitInstructionToLegacy,
	);
	const obligationAddress = await action.getObligationPda();
	return {
		network,
		ownerAddress,
		marketAddress,
		programId,
		depositReserveMint,
		depositReserveAddress: depositReserve.address,
		depositReserveSymbol: depositReserve.symbol ?? null,
		depositAmountRaw,
		borrowReserveMint,
		borrowReserveAddress: borrowReserve.address,
		borrowReserveSymbol: borrowReserve.symbol ?? null,
		borrowAmountRaw,
		useV2Ixs,
		includeAtaIxs,
		extraComputeUnits,
		requestElevationGroup,
		obligationAddress,
		instructionCount: instructions.length,
		setupInstructionCount: action.setupIxs.length,
		lendingInstructionCount: action.lendingIxs.length,
		cleanupInstructionCount: action.cleanupIxs.length,
		setupInstructionLabels: [...action.setupIxsLabels],
		lendingInstructionLabels: [...action.lendingIxsLabels],
		cleanupInstructionLabels: [...action.cleanupIxsLabels],
		instructions,
	};
}

export async function buildKaminoRepayAndWithdrawInstructions(
	request: KaminoRepayAndWithdrawInstructionsRequest,
): Promise<KaminoRepayAndWithdrawInstructionsResult> {
	const network = parseNetwork(request.network);
	const ownerAddress = new PublicKey(
		normalizeAtPath(request.ownerAddress),
	).toBase58();
	const repayReserveMint = new PublicKey(
		normalizeAtPath(request.repayReserveMint),
	).toBase58();
	const withdrawReserveMint = new PublicKey(
		normalizeAtPath(request.withdrawReserveMint),
	).toBase58();
	const marketInput =
		typeof request.marketAddress === "string" &&
		request.marketAddress.trim().length > 0
			? request.marketAddress
			: network === "mainnet-beta"
				? KAMINO_MAINNET_MARKET_ADDRESS
				: null;
	if (!marketInput) {
		throw new Error(
			"marketAddress is required when network is not mainnet-beta",
		);
	}
	const marketAddress = new PublicKey(normalizeAtPath(marketInput)).toBase58();
	const programId = new PublicKey(
		normalizeAtPath(request.programId ?? KAMINO_PROGRAM_ID),
	).toBase58();
	const repayAmountRaw = parsePositiveBigInt(
		request.repayAmountRaw,
		"repayAmountRaw",
	).toString();
	const withdrawAmountRaw = parsePositiveBigInt(
		request.withdrawAmountRaw,
		"withdrawAmountRaw",
	).toString();
	const useV2Ixs = request.useV2Ixs !== false;
	const includeAtaIxs = request.includeAtaIxs !== false;
	const extraComputeUnits = parseKaminoExtraComputeUnits(
		request.extraComputeUnits,
	);
	const requestElevationGroup = request.requestElevationGroup === true;
	const currentSlot = await resolveKaminoRepayCurrentSlot(
		network,
		request.currentSlot,
	);

	const rpc = createSolanaRpc(getRpcEndpoint(network));
	const kaminoMarket = await KaminoMarket.load(
		rpc,
		address(marketAddress),
		DEFAULT_RECENT_SLOT_DURATION_MS,
		address(programId),
	);
	if (!kaminoMarket) {
		throw new Error(`Kamino market not found: ${marketAddress}`);
	}
	const repayReserve = kaminoMarket.getReserveByMint(address(repayReserveMint));
	if (!repayReserve) {
		throw new Error(
			`Kamino repay reserve not found in market: reserveMint=${repayReserveMint} marketAddress=${marketAddress}`,
		);
	}
	const withdrawReserve = kaminoMarket.getReserveByMint(
		address(withdrawReserveMint),
	);
	if (!withdrawReserve) {
		throw new Error(
			`Kamino withdraw reserve not found in market: reserveMint=${withdrawReserveMint} marketAddress=${marketAddress}`,
		);
	}
	const action = await KaminoAction.buildRepayAndWithdrawTxns(
		kaminoMarket,
		repayAmountRaw,
		repayReserve.getLiquidityMint(),
		withdrawAmountRaw,
		withdrawReserve.getLiquidityMint(),
		createNoopSigner(address(ownerAddress)),
		currentSlot,
		new VanillaObligation(address(programId)),
		useV2Ixs,
		undefined,
		extraComputeUnits,
		includeAtaIxs,
		requestElevationGroup,
	);
	const instructions = KaminoAction.actionToIxs(action).map(
		convertKitInstructionToLegacy,
	);
	const obligationAddress = await action.getObligationPda();
	return {
		network,
		ownerAddress,
		marketAddress,
		programId,
		repayReserveMint,
		repayReserveAddress: repayReserve.address,
		repayReserveSymbol: repayReserve.symbol ?? null,
		repayAmountRaw,
		withdrawReserveMint,
		withdrawReserveAddress: withdrawReserve.address,
		withdrawReserveSymbol: withdrawReserve.symbol ?? null,
		withdrawAmountRaw,
		useV2Ixs,
		includeAtaIxs,
		extraComputeUnits,
		requestElevationGroup,
		currentSlot: currentSlot.toString(),
		obligationAddress,
		instructionCount: instructions.length,
		setupInstructionCount: action.setupIxs.length,
		lendingInstructionCount: action.lendingIxs.length,
		cleanupInstructionCount: action.cleanupIxs.length,
		setupInstructionLabels: [...action.setupIxsLabels],
		lendingInstructionLabels: [...action.lendingIxsLabels],
		cleanupInstructionLabels: [...action.cleanupIxsLabels],
		instructions,
	};
}

function truncateText(value: string): string {
	if (value.length <= 500) return value;
	return `${value.slice(0, 500)}...`;
}

type HttpMethod = "GET" | "POST";

type JupiterRequestOptions = {
	method?: HttpMethod;
	query?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
	timeoutMs?: number;
};

export type JupiterQuoteRequest = {
	inputMint: string;
	outputMint: string;
	amount: string;
	slippageBps?: number;
	swapMode?: JupiterSwapMode;
	restrictIntermediateTokens?: boolean;
	onlyDirectRoutes?: boolean;
	asLegacyTransaction?: boolean;
	maxAccounts?: number;
	dexes?: string[];
	excludeDexes?: string[];
};

export type JupiterPriorityFeeConfig = {
	maxLamports?: number;
	global?: boolean;
	priorityLevel?: JupiterPriorityLevel;
};

export type JupiterSwapRequest = {
	userPublicKey: string;
	quoteResponse: unknown;
	wrapAndUnwrapSol?: boolean;
	useSharedAccounts?: boolean;
	dynamicComputeUnitLimit?: boolean;
	skipUserAccountsRpcCalls?: boolean;
	destinationTokenAccount?: string;
	trackingAccount?: string;
	feeAccount?: string;
	asLegacyTransaction?: boolean;
	jitoTipLamports?: number;
	priorityFee?: JupiterPriorityFeeConfig;
};

export type RaydiumQuoteRequest = {
	inputMint: string;
	outputMint: string;
	amount: string;
	slippageBps: number;
	txVersion?: RaydiumTxVersion;
	swapType?: RaydiumSwapType;
};

export type RaydiumSwapRequest = {
	wallet: string;
	txVersion?: RaydiumTxVersion;
	swapType?: RaydiumSwapType;
	quoteResponse: unknown;
	computeUnitPriceMicroLamports: string;
	wrapSol?: boolean;
	unwrapSol?: boolean;
	inputAccount?: string;
	outputAccount?: string;
};

export type KaminoDepositInstructionsRequest = {
	ownerAddress: string;
	reserveMint: string;
	amountRaw: string;
	marketAddress?: string;
	programId?: string;
	useV2Ixs?: boolean;
	includeAtaIxs?: boolean;
	extraComputeUnits?: number;
	requestElevationGroup?: boolean;
	network?: string;
};

export type KaminoDepositInstructionsResult = {
	network: SolanaNetwork;
	ownerAddress: string;
	marketAddress: string;
	programId: string;
	reserveMint: string;
	reserveAddress: string;
	reserveSymbol: string | null;
	amountRaw: string;
	useV2Ixs: boolean;
	includeAtaIxs: boolean;
	extraComputeUnits: number;
	requestElevationGroup: boolean;
	obligationAddress: string;
	instructionCount: number;
	setupInstructionCount: number;
	lendingInstructionCount: number;
	cleanupInstructionCount: number;
	setupInstructionLabels: string[];
	lendingInstructionLabels: string[];
	cleanupInstructionLabels: string[];
	instructions: TransactionInstruction[];
};

export type KaminoWithdrawInstructionsRequest =
	KaminoDepositInstructionsRequest;
export type KaminoWithdrawInstructionsResult = KaminoDepositInstructionsResult;
export type KaminoBorrowInstructionsRequest = KaminoDepositInstructionsRequest;
export type KaminoBorrowInstructionsResult = KaminoDepositInstructionsResult;
export type KaminoRepayInstructionsRequest =
	KaminoDepositInstructionsRequest & {
		currentSlot?: string | number | bigint;
	};
export type KaminoRepayInstructionsResult = KaminoDepositInstructionsResult & {
	currentSlot: string;
};
export type KaminoDepositAndBorrowInstructionsRequest = {
	ownerAddress: string;
	depositReserveMint: string;
	depositAmountRaw: string;
	borrowReserveMint: string;
	borrowAmountRaw: string;
	marketAddress?: string;
	programId?: string;
	useV2Ixs?: boolean;
	includeAtaIxs?: boolean;
	extraComputeUnits?: number;
	requestElevationGroup?: boolean;
	network?: string;
};
export type KaminoDepositAndBorrowInstructionsResult = {
	network: SolanaNetwork;
	ownerAddress: string;
	marketAddress: string;
	programId: string;
	depositReserveMint: string;
	depositReserveAddress: string;
	depositReserveSymbol: string | null;
	depositAmountRaw: string;
	borrowReserveMint: string;
	borrowReserveAddress: string;
	borrowReserveSymbol: string | null;
	borrowAmountRaw: string;
	useV2Ixs: boolean;
	includeAtaIxs: boolean;
	extraComputeUnits: number;
	requestElevationGroup: boolean;
	obligationAddress: string;
	instructionCount: number;
	setupInstructionCount: number;
	lendingInstructionCount: number;
	cleanupInstructionCount: number;
	setupInstructionLabels: string[];
	lendingInstructionLabels: string[];
	cleanupInstructionLabels: string[];
	instructions: TransactionInstruction[];
};
export type KaminoRepayAndWithdrawInstructionsRequest = {
	ownerAddress: string;
	repayReserveMint: string;
	repayAmountRaw: string;
	withdrawReserveMint: string;
	withdrawAmountRaw: string;
	currentSlot?: string | number | bigint;
	marketAddress?: string;
	programId?: string;
	useV2Ixs?: boolean;
	includeAtaIxs?: boolean;
	extraComputeUnits?: number;
	requestElevationGroup?: boolean;
	network?: string;
};
export type KaminoRepayAndWithdrawInstructionsResult = {
	network: SolanaNetwork;
	ownerAddress: string;
	marketAddress: string;
	programId: string;
	repayReserveMint: string;
	repayReserveAddress: string;
	repayReserveSymbol: string | null;
	repayAmountRaw: string;
	withdrawReserveMint: string;
	withdrawReserveAddress: string;
	withdrawReserveSymbol: string | null;
	withdrawAmountRaw: string;
	useV2Ixs: boolean;
	includeAtaIxs: boolean;
	extraComputeUnits: number;
	requestElevationGroup: boolean;
	currentSlot: string;
	obligationAddress: string;
	instructionCount: number;
	setupInstructionCount: number;
	lendingInstructionCount: number;
	cleanupInstructionCount: number;
	setupInstructionLabels: string[];
	lendingInstructionLabels: string[];
	cleanupInstructionLabels: string[];
	instructions: TransactionInstruction[];
};

export type KaminoLendingProtocol = "kamino";
export type KaminoLendingPositionSide = "deposit" | "borrow";

export type KaminoLendingPosition = {
	side: KaminoLendingPositionSide;
	reserveAddress: string | null;
	mint: string | null;
	symbol: string | null;
	amountRaw: string | null;
	amountUi: number | null;
	marketValueUsd: number | null;
	rateApr: number | null;
};

export type KaminoLendingObligation = {
	marketAddress: string;
	obligationAddress: string | null;
	ownerAddress: string | null;
	deposits: KaminoLendingPosition[];
	borrows: KaminoLendingPosition[];
	depositValueUsd: number;
	borrowValueUsd: number;
	netValueUsd: number;
	loanToValueRatio: number | null;
	positionCount: number | null;
};

export type KaminoLendingPositionsRequest = {
	address: string;
	network?: string;
	programId?: string;
	limitMarkets?: number;
};

export type KaminoLendingPositionsResult = {
	protocol: KaminoLendingProtocol;
	address: string;
	network: SolanaNetwork;
	programId: string | null;
	marketCount: number;
	marketCountQueried: number;
	marketQueryLimit: number;
	marketCountWithPositions: number;
	obligationCount: number;
	depositPositionCount: number;
	borrowPositionCount: number;
	totalDepositValueUsd: number;
	totalBorrowValueUsd: number;
	netValueUsd: number;
	marketAddressesQueried: string[];
	marketAddressesWithPositions: string[];
	obligations: KaminoLendingObligation[];
	queryErrors: string[];
};

export type KaminoLendingMarketSummary = {
	marketAddress: string;
	name: string | null;
	description: string | null;
	lookupTableAddress: string | null;
	isPrimary: boolean | null;
	isCurated: boolean | null;
};

export type KaminoLendingMarketsRequest = {
	programId?: string;
	limitMarkets?: number;
};

export type KaminoLendingMarketsResult = {
	protocol: KaminoLendingProtocol;
	programId: string | null;
	marketCount: number;
	marketCountQueried: number;
	marketQueryLimit: number;
	markets: KaminoLendingMarketSummary[];
};

export type OrcaWhirlpoolPositionReward = {
	index: number;
	mint: string | null;
	amountOwedRaw: string;
};

export type OrcaWhirlpoolOwnerPosition = {
	positionAddress: string;
	positionMint: string;
	positionBundleAddress: string | null;
	isBundledPosition: boolean;
	bundlePositionCount: number | null;
	tokenProgram: string | null;
	whirlpoolAddress: string;
	tokenMintA: string | null;
	tokenMintB: string | null;
	tickSpacing: number | null;
	feeRate: number | null;
	currentTickIndex: number | null;
	liquidity: string;
	tickLowerIndex: number;
	tickUpperIndex: number;
	feeOwedA: string;
	feeOwedB: string;
	rewards: OrcaWhirlpoolPositionReward[];
};

export type OrcaWhirlpoolPositionsRequest = {
	address: string;
	network?: string;
};

export type OrcaWhirlpoolPositionsResult = {
	protocol: "orca-whirlpool";
	address: string;
	network: SolanaNetwork;
	positionCount: number;
	bundleCount: number;
	poolCount: number;
	whirlpoolAddresses: string[];
	positions: OrcaWhirlpoolOwnerPosition[];
	queryErrors: string[];
};

function omitUndefined<T extends Record<string, unknown>>(
	value: T,
): Partial<T> {
	const entries = Object.entries(value).filter(
		([, entry]) => entry !== undefined,
	);
	return Object.fromEntries(entries) as Partial<T>;
}

function buildQueryString(
	query?: Record<string, string | number | boolean | undefined>,
): string {
	if (!query) return "";
	const entries = Object.entries(query).filter(
		([, value]) => value !== undefined,
	);
	if (entries.length === 0) return "";
	const params = new URLSearchParams();
	for (const [key, value] of entries) {
		params.set(key, String(value));
	}
	return `?${params.toString()}`;
}

async function callJsonApi(
	url: string,
	method: HttpMethod,
	headers: Record<string, string>,
	body?: unknown,
	timeoutMs = 20_000,
): Promise<unknown> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			method,
			headers,
			body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
			signal: abort.signal,
		});

		const responseText = await response.text();
		let payload: unknown = null;
		if (responseText.trim().length > 0) {
			try {
				payload = JSON.parse(responseText);
			} catch {
				if (!response.ok) {
					throw new Error(
						`HTTP ${response.status} ${response.statusText}: ${truncateText(responseText)}`,
					);
				}
				throw new Error(
					`Unexpected non-JSON response: ${truncateText(responseText)}`,
				);
			}
		}

		if (!response.ok) {
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${stringifyUnknown(payload ?? responseText)}`,
			);
		}
		return payload;
	} finally {
		clearTimeout(timer);
	}
}

export async function callJupiterApi(
	path: string,
	options: JupiterRequestOptions = {},
): Promise<unknown> {
	const method = options.method ?? "GET";
	const baseUrl = getJupiterApiBaseUrl();
	const query = buildQueryString(options.query);
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	const url = `${baseUrl}${normalizedPath}${query}`;
	const apiKey = getJupiterApiKey();

	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (apiKey) {
		headers["x-api-key"] = apiKey;
	}

	try {
		return await callJsonApi(
			url,
			method,
			headers,
			options.body,
			options.timeoutMs,
		);
	} catch (error) {
		const fallbackToLite =
			!apiKey &&
			baseUrl === "https://api.jup.ag" &&
			error instanceof Error &&
			error.message.includes("401");
		if (!fallbackToLite) throw error;

		const fallbackUrl = `https://lite-api.jup.ag${normalizedPath}${query}`;
		return callJsonApi(
			fallbackUrl,
			method,
			{ "content-type": "application/json" },
			options.body,
			options.timeoutMs,
		);
	}
}

function buildJupiterQuoteQuery(
	request: JupiterQuoteRequest,
): Record<string, string | number | boolean | undefined> {
	return {
		inputMint: request.inputMint,
		outputMint: request.outputMint,
		amount: request.amount,
		slippageBps: request.slippageBps,
		swapMode: request.swapMode,
		restrictIntermediateTokens: request.restrictIntermediateTokens,
		onlyDirectRoutes: request.onlyDirectRoutes,
		asLegacyTransaction: request.asLegacyTransaction,
		maxAccounts: request.maxAccounts,
		dexes:
			request.dexes && request.dexes.length > 0
				? request.dexes.join(",")
				: undefined,
		excludeDexes:
			request.excludeDexes && request.excludeDexes.length > 0
				? request.excludeDexes.join(",")
				: undefined,
	};
}

function parseAmountForJupiterSdk(amount: string): number | null {
	const normalized = amount.trim();
	if (!/^\d+$/.test(normalized)) return null;
	const asBigInt = BigInt(normalized);
	if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER)) return null;
	const asNumber = Number(asBigInt);
	return Number.isSafeInteger(asNumber) ? asNumber : null;
}

export async function getJupiterDexLabels(): Promise<Record<string, string>> {
	try {
		const client = getJupiterApiClient();
		return await client.programIdToLabelGet();
	} catch {
		const payload = await callJupiterApi("/swap/v1/program-id-to-label");
		if (!payload || typeof payload !== "object") return {};
		const entries = Object.entries(payload as Record<string, unknown>).filter(
			([, value]) => typeof value === "string",
		) as [string, string][];
		return Object.fromEntries(entries);
	}
}

export async function getJupiterQuote(
	request: JupiterQuoteRequest,
): Promise<unknown> {
	const amountForSdk = parseAmountForJupiterSdk(request.amount);
	if (amountForSdk === null) {
		return callJupiterApi("/swap/v1/quote", {
			method: "GET",
			query: buildJupiterQuoteQuery(request),
		});
	}

	try {
		const client = getJupiterApiClient();
		return await client.quoteGet({
			inputMint: request.inputMint,
			outputMint: request.outputMint,
			amount: amountForSdk,
			slippageBps: request.slippageBps,
			swapMode: request.swapMode,
			dexes: request.dexes,
			excludeDexes: request.excludeDexes,
			restrictIntermediateTokens: request.restrictIntermediateTokens,
			onlyDirectRoutes: request.onlyDirectRoutes,
			asLegacyTransaction: request.asLegacyTransaction,
			maxAccounts: request.maxAccounts,
		});
	} catch {
		return callJupiterApi("/swap/v1/quote", {
			method: "GET",
			query: buildJupiterQuoteQuery(request),
		});
	}
}

function buildJupiterSwapBody(
	request: JupiterSwapRequest,
): Record<string, unknown> {
	const priorityLevel = request.priorityFee?.priorityLevel;
	const priorityBody =
		request.jitoTipLamports !== undefined
			? { jitoTipLamports: request.jitoTipLamports }
			: priorityLevel
				? {
						priorityLevelWithMaxLamports: {
							maxLamports: request.priorityFee?.maxLamports ?? 5_000_000,
							global: request.priorityFee?.global ?? false,
							priorityLevel,
						},
					}
				: undefined;

	return omitUndefined({
		userPublicKey: request.userPublicKey,
		quoteResponse: request.quoteResponse,
		wrapAndUnwrapSol: request.wrapAndUnwrapSol,
		useSharedAccounts: request.useSharedAccounts,
		dynamicComputeUnitLimit: request.dynamicComputeUnitLimit,
		skipUserAccountsRpcCalls: request.skipUserAccountsRpcCalls,
		destinationTokenAccount: request.destinationTokenAccount,
		trackingAccount: request.trackingAccount,
		feeAccount: request.feeAccount,
		asLegacyTransaction: request.asLegacyTransaction,
		prioritizationFeeLamports: priorityBody,
	});
}

export async function buildJupiterSwapTransaction(
	request: JupiterSwapRequest,
): Promise<unknown> {
	const swapRequest = buildJupiterSwapBody(request);
	try {
		const client = getJupiterApiClient();
		return await client.swapPost({
			swapRequest: swapRequest as unknown as JupiterSdkSwapRequest,
		});
	} catch {
		return callJupiterApi("/swap/v1/swap", {
			method: "POST",
			body: swapRequest,
		});
	}
}

export async function buildJupiterSwapInstructions(
	request: JupiterSwapRequest,
): Promise<unknown> {
	const swapRequest = buildJupiterSwapBody(request);
	try {
		const client = getJupiterApiClient();
		return await client.swapInstructionsPost({
			swapRequest: swapRequest as unknown as JupiterSdkSwapRequest,
		});
	} catch {
		return callJupiterApi("/swap/v1/swap-instructions", {
			method: "POST",
			body: swapRequest,
		});
	}
}

export async function callRaydiumApi(
	path: string,
	options: {
		method?: HttpMethod;
		query?: Record<string, string | number | boolean | undefined>;
		body?: unknown;
		timeoutMs?: number;
	} = {},
): Promise<unknown> {
	const method = options.method ?? "GET";
	const normalizedPath = getRaydiumApiPath(path);
	try {
		const client = getRaydiumApiClient();
		return await client.api.request({
			baseURL: getRaydiumApiBaseUrl(),
			url: normalizedPath,
			method,
			params: options.query,
			data: method === "POST" ? (options.body ?? {}) : undefined,
			timeout: options.timeoutMs ?? 20_000,
		});
	} catch {
		const baseUrl = getRaydiumApiBaseUrl();
		const query = buildQueryString(options.query);
		const url = `${baseUrl}${normalizedPath}${query}`;
		return callJsonApi(
			url,
			method,
			{ "content-type": "application/json" },
			options.body,
			options.timeoutMs,
		);
	}
}

export async function getRaydiumPriorityFee(): Promise<unknown> {
	try {
		const client = getRaydiumApiClient();
		return await client.api.get(RAYDIUM_API_URLS.PRIORITY_FEE);
	} catch {
		const baseUrl = getRaydiumPriorityFeeApiBaseUrl();
		return callJsonApi(
			`${baseUrl}${RAYDIUM_API_URLS.PRIORITY_FEE}`,
			"GET",
			{ "content-type": "application/json" },
			undefined,
			20_000,
		);
	}
}

function findNumericString(value: unknown, depth = 0): string | null {
	if (depth > 4) return null;
	if (typeof value === "string" && /^\d+$/.test(value)) return value;
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.round(value).toString();
	}
	if (!value || typeof value !== "object") return null;
	if (Array.isArray(value)) {
		for (const entry of value) {
			const found = findNumericString(entry, depth + 1);
			if (found) return found;
		}
		return null;
	}
	const record = value as Record<string, unknown>;
	const preferredOrder = ["vh", "h", "m", "default", "data"];
	for (const key of preferredOrder) {
		if (!(key in record)) continue;
		const found = findNumericString(record[key], depth + 1);
		if (found) return found;
	}
	for (const entry of Object.values(record)) {
		const found = findNumericString(entry, depth + 1);
		if (found) return found;
	}
	return null;
}

export function getRaydiumPriorityFeeMicroLamports(
	feePayload: unknown,
): string | null {
	return findNumericString(feePayload);
}

function buildRaydiumQuotePath(swapType: RaydiumSwapType): string {
	return swapType === "BaseOut"
		? "/compute/swap-base-out"
		: "/compute/swap-base-in";
}

export async function getRaydiumQuote(
	request: RaydiumQuoteRequest,
): Promise<unknown> {
	const txVersion = parseRaydiumTxVersion(request.txVersion);
	const swapType = parseRaydiumSwapType(request.swapType);
	return callRaydiumApi(buildRaydiumQuotePath(swapType), {
		method: "GET",
		query: {
			inputMint: request.inputMint,
			outputMint: request.outputMint,
			amount: request.amount,
			slippageBps: request.slippageBps,
			txVersion,
		},
	});
}

function buildRaydiumSwapBody(
	request: RaydiumSwapRequest,
): Record<string, unknown> {
	const txVersion = parseRaydiumTxVersion(request.txVersion);
	return omitUndefined({
		txVersion,
		wallet: request.wallet,
		computeUnitPriceMicroLamports: request.computeUnitPriceMicroLamports,
		swapResponse: request.quoteResponse,
		wrapSol: request.wrapSol,
		unwrapSol: request.unwrapSol,
		inputAccount: request.inputAccount,
		outputAccount: request.outputAccount,
	});
}

function buildRaydiumSwapPath(swapType: RaydiumSwapType): string {
	return swapType === "BaseOut"
		? "/transaction/swap-base-out"
		: "/transaction/swap-base-in";
}

export async function buildRaydiumSwapTransactions(
	request: RaydiumSwapRequest,
): Promise<unknown> {
	const swapType = parseRaydiumSwapType(request.swapType);
	return callRaydiumApi(buildRaydiumSwapPath(swapType), {
		method: "POST",
		body: buildRaydiumSwapBody(request),
	});
}

type KaminoRequestOptions = {
	method?: HttpMethod;
	query?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
	timeoutMs?: number;
};

function asObjectRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim().replace(/,/g, "");
	if (normalized.length === 0) {
		return null;
	}
	const isPercent = normalized.endsWith("%");
	const numeric = isPercent ? normalized.slice(0, -1).trim() : normalized;
	if (!/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(numeric)) {
		return null;
	}
	const parsed = Number(numeric);
	if (!Number.isFinite(parsed)) {
		return null;
	}
	return isPercent ? parsed / 100 : parsed;
}

function toBoolean(value: unknown): boolean | null {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		if (value === 1) return true;
		if (value === 0) return false;
		return null;
	}
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim().toLowerCase();
	if (
		normalized === "true" ||
		normalized === "1" ||
		normalized === "yes" ||
		normalized === "y"
	) {
		return true;
	}
	if (
		normalized === "false" ||
		normalized === "0" ||
		normalized === "no" ||
		normalized === "n"
	) {
		return false;
	}
	return null;
}

function toPositiveIntegerString(value: unknown): string | null {
	if (typeof value === "bigint") {
		return value >= 0n ? value.toString() : null;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
			return null;
		}
		return value.toString();
	}
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		return null;
	}
	return normalized;
}

function pickString(
	record: Record<string, unknown>,
	keys: string[],
): string | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
}

function pickStringFromRecords(
	records: Array<Record<string, unknown> | null>,
	keys: string[],
): string | null {
	for (const record of records) {
		if (!record) continue;
		const value = pickString(record, keys);
		if (value !== null) {
			return value;
		}
	}
	return null;
}

function pickNumber(
	record: Record<string, unknown>,
	keys: string[],
): number | null {
	for (const key of keys) {
		const parsed = toFiniteNumber(record[key]);
		if (parsed !== null) {
			return parsed;
		}
	}
	return null;
}

function pickBoolean(
	record: Record<string, unknown>,
	keys: string[],
): boolean | null {
	for (const key of keys) {
		const parsed = toBoolean(record[key]);
		if (parsed !== null) {
			return parsed;
		}
	}
	return null;
}

function pickIntegerString(
	record: Record<string, unknown>,
	keys: string[],
): string | null {
	for (const key of keys) {
		const parsed = toPositiveIntegerString(record[key]);
		if (parsed !== null) {
			return parsed;
		}
	}
	return null;
}

function pickNumberFromRecords(
	records: Array<Record<string, unknown> | null>,
	keys: string[],
): number | null {
	for (const record of records) {
		if (!record) continue;
		const value = pickNumber(record, keys);
		if (value !== null) {
			return value;
		}
	}
	return null;
}

function pickBooleanFromRecords(
	records: Array<Record<string, unknown> | null>,
	keys: string[],
): boolean | null {
	for (const record of records) {
		if (!record) continue;
		const value = pickBoolean(record, keys);
		if (value !== null) {
			return value;
		}
	}
	return null;
}

function normalizePublicKey(value: string | null): string | null {
	if (!value) return null;
	try {
		return new PublicKey(normalizeAtPath(value)).toBase58();
	} catch {
		return null;
	}
}

function resolveKaminoMarketAddress(
	record: Record<string, unknown>,
): string | null {
	const direct = pickString(record, [
		"lendingMarket",
		"market",
		"marketAddress",
		"address",
		"pubkey",
		"id",
	]);
	const normalized = normalizePublicKey(direct);
	if (normalized) {
		return normalized;
	}

	const nestedMarket = asObjectRecord(record.market);
	if (nestedMarket) {
		const nested = resolveKaminoMarketAddress(nestedMarket);
		if (nested) {
			return nested;
		}
	}

	const nestedLendingMarket = asObjectRecord(record.lendingMarket);
	if (nestedLendingMarket) {
		const nested = resolveKaminoMarketAddress(nestedLendingMarket);
		if (nested) {
			return nested;
		}
	}

	return null;
}

function resolveKaminoObligationAddress(
	record: Record<string, unknown>,
): string | null {
	const direct = pickString(record, [
		"obligation",
		"obligationAddress",
		"address",
		"pubkey",
		"id",
	]);
	const normalized = normalizePublicKey(direct);
	if (normalized) {
		return normalized;
	}

	const nested = asObjectRecord(record.obligation);
	if (nested) {
		const nestedAddress = resolveKaminoObligationAddress(nested);
		if (nestedAddress) {
			return nestedAddress;
		}
	}

	return null;
}

function normalizeKaminoRecordArray(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) {
		return value
			.map((entry) => asObjectRecord(entry))
			.filter((entry): entry is Record<string, unknown> => entry !== null);
	}
	const record = asObjectRecord(value);
	if (!record) {
		return [];
	}
	return Object.values(record)
		.map((entry) => asObjectRecord(entry))
		.filter((entry): entry is Record<string, unknown> => entry !== null);
}

function normalizeKaminoMarketEntries(
	payload: unknown,
): Record<string, unknown>[] {
	if (Array.isArray(payload)) {
		return normalizeKaminoRecordArray(payload);
	}
	const record = asObjectRecord(payload);
	if (!record) {
		return [];
	}
	for (const key of ["markets", "data", "result", "items"]) {
		if (key in record) {
			const entries = normalizeKaminoRecordArray(record[key]);
			if (entries.length > 0) {
				return entries;
			}
		}
	}
	return normalizeKaminoRecordArray(payload);
}

function normalizeKaminoObligationEntries(
	payload: unknown,
): Record<string, unknown>[] {
	if (Array.isArray(payload)) {
		return normalizeKaminoRecordArray(payload);
	}
	const record = asObjectRecord(payload);
	if (!record) {
		return [];
	}
	for (const key of ["obligations", "data", "result", "items"]) {
		if (key in record) {
			const entries = normalizeKaminoRecordArray(record[key]);
			if (entries.length > 0) {
				return entries;
			}
		}
	}
	return normalizeKaminoRecordArray(payload);
}

function normalizeKaminoLendingPosition(
	value: unknown,
	side: KaminoLendingPositionSide,
): KaminoLendingPosition | null {
	const record = asObjectRecord(value);
	if (!record) {
		return null;
	}
	return {
		side,
		reserveAddress: normalizePublicKey(
			pickString(record, [
				"reserveAddress",
				"reserve",
				"reservePubkey",
				"reserveId",
			]),
		),
		mint: normalizePublicKey(
			pickString(record, [
				"mint",
				"mintAddress",
				"liquidityMint",
				"tokenMint",
				"assetMint",
			]),
		),
		symbol: pickString(record, [
			"symbol",
			"tokenSymbol",
			"assetSymbol",
			"liquiditySymbol",
		]),
		amountRaw: pickIntegerString(record, [
			"amountRaw",
			"amount",
			"liquidityAmount",
			"depositedAmount",
			"borrowedAmount",
			"tokenAmount",
		]),
		amountUi: pickNumber(record, [
			"amountUi",
			"uiAmount",
			"depositedAmount",
			"borrowedAmount",
			"positionAmount",
			"value",
		]),
		marketValueUsd: pickNumber(record, [
			"marketValueRefreshed",
			"marketValue",
			"usdValue",
			"valueUsd",
			"amountUsd",
			"usd",
		]),
		rateApr: pickNumber(record, [
			"apr",
			"apy",
			"supplyApr",
			"supplyApy",
			"borrowApr",
			"borrowApy",
			"rate",
		]),
	};
}

function normalizeKaminoLendingMarket(
	record: Record<string, unknown>,
): KaminoLendingMarketSummary | null {
	const marketAddress = resolveKaminoMarketAddress(record);
	if (!marketAddress) {
		return null;
	}
	const marketRecord = asObjectRecord(record.market);
	const metadataRecord =
		asObjectRecord(record.metadata) ??
		asObjectRecord(record.meta) ??
		asObjectRecord(record.marketMeta);
	const lookupTableAddress = normalizePublicKey(
		pickStringFromRecords(
			[record, marketRecord, metadataRecord],
			["lookupTable", "lookupTableAddress", "addressLookupTable", "lut"],
		),
	);
	return {
		marketAddress,
		name: pickStringFromRecords(
			[record, marketRecord, metadataRecord],
			["name", "marketName", "displayName", "label"],
		),
		description: pickStringFromRecords(
			[record, marketRecord, metadataRecord],
			["description", "marketDescription", "summary"],
		),
		lookupTableAddress,
		isPrimary: pickBooleanFromRecords(
			[record, marketRecord, metadataRecord],
			["isPrimary", "primary", "isMain", "main"],
		),
		isCurated: pickBooleanFromRecords(
			[record, marketRecord, metadataRecord],
			["isCurated", "curated", "isVerified", "verified"],
		),
	};
}

function normalizeKaminoMarketLimit(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 20;
	}
	const integer = Math.floor(value);
	if (integer < 1) return 1;
	if (integer > 200) return 200;
	return integer;
}

function roundUsd(value: number): number {
	return Number(value.toFixed(6));
}

export function getKaminoApiBaseUrl(): string {
	const configured = process.env.KAMINO_API_BASE_URL?.trim();
	if (configured && configured.length > 0) {
		return configured.replace(/\/+$/, "");
	}
	return "https://api.kamino.finance";
}

export async function callKaminoApi(
	path: string,
	options: KaminoRequestOptions = {},
): Promise<unknown> {
	const method = options.method ?? "GET";
	const query = buildQueryString(options.query);
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	const url = `${getKaminoApiBaseUrl()}${normalizedPath}${query}`;
	return callJsonApi(
		url,
		method,
		{ "content-type": "application/json" },
		options.body,
		options.timeoutMs,
	);
}

export async function getKaminoMarkets(
	options: {
		programId?: string;
	} = {},
): Promise<Record<string, unknown>[]> {
	const programId = normalizePublicKey(
		typeof options.programId === "string" ? options.programId : null,
	);
	const query = typeof programId === "string" ? { programId } : undefined;
	try {
		const payload = await callKaminoApi("/v2/kamino-market", {
			method: "GET",
			query,
		});
		return normalizeKaminoMarketEntries(payload);
	} catch {
		const payload = await callKaminoApi("/kamino-market", {
			method: "GET",
			query,
		});
		return normalizeKaminoMarketEntries(payload);
	}
}

export async function getKaminoLendingMarkets(
	request: KaminoLendingMarketsRequest = {},
): Promise<KaminoLendingMarketsResult> {
	const programId = normalizePublicKey(
		typeof request.programId === "string" ? request.programId : null,
	);
	const marketQueryLimit = normalizeKaminoMarketLimit(request.limitMarkets);
	const markets = await getKaminoMarkets({ programId: programId ?? undefined });
	const byMarketAddress = new Map<string, KaminoLendingMarketSummary>();
	for (const entry of markets) {
		const normalized = normalizeKaminoLendingMarket(entry);
		if (!normalized) continue;
		byMarketAddress.set(normalized.marketAddress, normalized);
	}
	const sorted = [...byMarketAddress.values()].sort((a, b) => {
		if (a.isPrimary === true && b.isPrimary !== true) return -1;
		if (a.isPrimary !== true && b.isPrimary === true) return 1;
		const aName = a.name ?? a.marketAddress;
		const bName = b.name ?? b.marketAddress;
		const nameCmp = aName.localeCompare(bName);
		if (nameCmp !== 0) {
			return nameCmp;
		}
		return a.marketAddress.localeCompare(b.marketAddress);
	});
	const limited = sorted.slice(0, marketQueryLimit);
	return {
		protocol: "kamino",
		programId,
		marketCount: sorted.length,
		marketCountQueried: limited.length,
		marketQueryLimit,
		markets: limited,
	};
}

export async function getKaminoUserObligations(
	walletAddress: string,
	marketAddress: string,
	network?: string,
): Promise<Record<string, unknown>[]> {
	const wallet = new PublicKey(normalizeAtPath(walletAddress)).toBase58();
	const market = new PublicKey(normalizeAtPath(marketAddress)).toBase58();
	const env = parseNetwork(network);
	const paths = [
		`/kamino-market/${encodeURIComponent(market)}/users/${encodeURIComponent(wallet)}/obligations`,
		`/v2/kamino-market/${encodeURIComponent(market)}/users/${encodeURIComponent(wallet)}/obligations`,
	];
	let lastError: unknown = null;
	for (const path of paths) {
		try {
			const payload = await callKaminoApi(path, {
				method: "GET",
				query: { env },
			});
			return normalizeKaminoObligationEntries(payload);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("Could not get user obligations")) {
				return [];
			}
			lastError = error;
		}
	}
	if (lastError) {
		throw lastError;
	}
	return [];
}

export async function getKaminoLendingPositions(
	request: KaminoLendingPositionsRequest,
): Promise<KaminoLendingPositionsResult> {
	const address = new PublicKey(normalizeAtPath(request.address)).toBase58();
	const network = parseNetwork(request.network);
	const programId = normalizePublicKey(
		typeof request.programId === "string" ? request.programId : null,
	);
	const marketQueryLimit = normalizeKaminoMarketLimit(request.limitMarkets);
	const markets = await getKaminoMarkets({ programId: programId ?? undefined });
	const allMarketAddresses = markets
		.map((entry) => resolveKaminoMarketAddress(entry))
		.filter((entry): entry is string => typeof entry === "string");
	const uniqueMarketAddresses = [...new Set(allMarketAddresses)];
	const marketAddressesQueried = uniqueMarketAddresses.slice(
		0,
		marketQueryLimit,
	);
	const queryErrors: string[] = [];
	const obligations: KaminoLendingObligation[] = [];

	await Promise.all(
		marketAddressesQueried.map(async (marketAddress) => {
			try {
				const entries = await getKaminoUserObligations(
					address,
					marketAddress,
					network,
				);
				for (const entry of entries) {
					const stats =
						asObjectRecord(entry.refreshedStats) ??
						asObjectRecord(entry.stats) ??
						asObjectRecord(entry.metrics);
					const deposits = normalizeKaminoRecordArray(entry.deposits)
						.map((position) =>
							normalizeKaminoLendingPosition(position, "deposit"),
						)
						.filter(
							(position): position is KaminoLendingPosition =>
								position !== null,
						);
					const borrows = normalizeKaminoRecordArray(entry.borrows)
						.map((position) =>
							normalizeKaminoLendingPosition(position, "borrow"),
						)
						.filter(
							(position): position is KaminoLendingPosition =>
								position !== null,
						);
					const depositValueUsd =
						pickNumberFromRecords(
							[stats, entry],
							[
								"totalDepositValue",
								"totalDepositValueUsd",
								"depositedValueUsd",
								"depositsValueUsd",
							],
						) ?? 0;
					const borrowValueUsd =
						pickNumberFromRecords(
							[stats, entry],
							[
								"totalBorrowValue",
								"totalBorrowValueUsd",
								"borrowedValueUsd",
								"borrowsValueUsd",
							],
						) ?? 0;
					const positionCount =
						pickNumberFromRecords(
							[stats, entry],
							["numberOfPositions", "positionCount"],
						) ?? null;
					obligations.push({
						marketAddress,
						obligationAddress: resolveKaminoObligationAddress(entry),
						ownerAddress: normalizePublicKey(
							pickString(entry, [
								"owner",
								"user",
								"userAddress",
								"userPubkey",
								"authority",
								"walletAddress",
							]),
						),
						deposits,
						borrows,
						depositValueUsd: roundUsd(depositValueUsd),
						borrowValueUsd: roundUsd(borrowValueUsd),
						netValueUsd: roundUsd(depositValueUsd - borrowValueUsd),
						loanToValueRatio: pickNumberFromRecords(
							[stats, entry],
							["loanToValue", "ltv", "userLtv"],
						),
						positionCount,
					});
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				queryErrors.push(`${marketAddress}: ${message}`);
			}
		}),
	);

	obligations.sort((a, b) => {
		const marketCmp = a.marketAddress.localeCompare(b.marketAddress);
		if (marketCmp !== 0) {
			return marketCmp;
		}
		return (a.obligationAddress ?? "").localeCompare(b.obligationAddress ?? "");
	});
	queryErrors.sort((a, b) => a.localeCompare(b));

	const marketsWithPositions = [
		...new Set(
			obligations
				.filter(
					(entry) =>
						entry.deposits.length > 0 ||
						entry.borrows.length > 0 ||
						entry.depositValueUsd > 0 ||
						entry.borrowValueUsd > 0,
				)
				.map((entry) => entry.marketAddress),
		),
	];
	const depositPositionCount = obligations.reduce(
		(total, entry) => total + entry.deposits.length,
		0,
	);
	const borrowPositionCount = obligations.reduce(
		(total, entry) => total + entry.borrows.length,
		0,
	);
	const totalDepositValueUsd = obligations.reduce(
		(total, entry) => total + entry.depositValueUsd,
		0,
	);
	const totalBorrowValueUsd = obligations.reduce(
		(total, entry) => total + entry.borrowValueUsd,
		0,
	);

	return {
		protocol: "kamino",
		address,
		network,
		programId,
		marketCount: uniqueMarketAddresses.length,
		marketCountQueried: marketAddressesQueried.length,
		marketQueryLimit,
		marketCountWithPositions: marketsWithPositions.length,
		obligationCount: obligations.length,
		depositPositionCount,
		borrowPositionCount,
		totalDepositValueUsd: roundUsd(totalDepositValueUsd),
		totalBorrowValueUsd: roundUsd(totalBorrowValueUsd),
		netValueUsd: roundUsd(totalDepositValueUsd - totalBorrowValueUsd),
		marketAddressesQueried,
		marketAddressesWithPositions: marketsWithPositions,
		obligations,
		queryErrors,
	};
}

export async function getOrcaWhirlpoolPositions(
	request: OrcaWhirlpoolPositionsRequest,
): Promise<OrcaWhirlpoolPositionsResult> {
	const ownerAddress = new PublicKey(
		normalizeAtPath(request.address),
	).toBase58();
	const network = parseNetwork(request.network);
	const rpc = createSolanaRpc(getRpcEndpoint(network));
	const owner = address(ownerAddress);
	const rawPositions = (await fetchPositionsForOwner(
		rpc as never,
		owner as never,
	)) as unknown[];

	const toBigIntString = (value: unknown): string | null => {
		if (typeof value === "bigint") {
			return value.toString();
		}
		if (typeof value === "number" && Number.isFinite(value)) {
			return Math.trunc(value).toString();
		}
		if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
			return value.trim();
		}
		return null;
	};
	const toNumber = (value: unknown): number | null => {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (typeof value === "bigint") {
			return Number(value);
		}
		if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
			const parsed = Number.parseInt(value.trim(), 10);
			if (Number.isFinite(parsed)) return parsed;
		}
		return null;
	};
	const toAddress = (value: unknown): string | null =>
		typeof value === "string" ? normalizePublicKey(value) : null;

	const queryErrors: string[] = [];
	const positions: OrcaWhirlpoolOwnerPosition[] = [];
	const whirlpoolAddressSet = new Set<string>();
	const pushPosition = (
		record: unknown,
		context: {
			positionBundleAddress: string | null;
			isBundledPosition: boolean;
			bundlePositionCount: number | null;
			tokenProgram: string | null;
		},
	): void => {
		const account = asObjectRecord(record);
		const data = asObjectRecord(account?.data);
		if (!account || !data) {
			return;
		}
		const positionAddress = toAddress(account.address);
		const positionMint = toAddress(data.positionMint);
		const whirlpoolAddress = toAddress(data.whirlpool);
		const liquidity = toBigIntString(data.liquidity);
		const tickLowerIndex = toNumber(data.tickLowerIndex);
		const tickUpperIndex = toNumber(data.tickUpperIndex);
		const feeOwedA = toBigIntString(data.feeOwedA);
		const feeOwedB = toBigIntString(data.feeOwedB);
		if (
			!positionAddress ||
			!positionMint ||
			!whirlpoolAddress ||
			liquidity == null ||
			tickLowerIndex == null ||
			tickUpperIndex == null ||
			feeOwedA == null ||
			feeOwedB == null
		) {
			return;
		}
		whirlpoolAddressSet.add(whirlpoolAddress);
		const rewards = (
			Array.isArray(data.rewardInfos) ? data.rewardInfos : []
		).map((rewardInfo, index) => {
			const reward = asObjectRecord(rewardInfo);
			return {
				index,
				mint: null,
				amountOwedRaw: toBigIntString(reward?.amountOwed) ?? "0",
			} satisfies OrcaWhirlpoolPositionReward;
		});
		positions.push({
			positionAddress,
			positionMint,
			positionBundleAddress: context.positionBundleAddress,
			isBundledPosition: context.isBundledPosition,
			bundlePositionCount: context.bundlePositionCount,
			tokenProgram: context.tokenProgram,
			whirlpoolAddress,
			tokenMintA: null,
			tokenMintB: null,
			tickSpacing: null,
			feeRate: null,
			currentTickIndex: null,
			liquidity,
			tickLowerIndex,
			tickUpperIndex,
			feeOwedA,
			feeOwedB,
			rewards,
		});
	};

	for (const rawEntry of rawPositions) {
		const entry = asObjectRecord(rawEntry);
		if (!entry) {
			continue;
		}
		const tokenProgram = toAddress(entry.tokenProgram);
		if (entry.isPositionBundle === true) {
			const positionBundleAddress = toAddress(entry.address);
			const bundledPositions = Array.isArray(entry.positions)
				? entry.positions
				: [];
			for (const bundledPosition of bundledPositions) {
				pushPosition(bundledPosition, {
					positionBundleAddress,
					isBundledPosition: true,
					bundlePositionCount: bundledPositions.length,
					tokenProgram,
				});
			}
			continue;
		}
		pushPosition(rawEntry, {
			positionBundleAddress: null,
			isBundledPosition: false,
			bundlePositionCount: null,
			tokenProgram,
		});
	}

	const whirlpoolAddresses = [...whirlpoolAddressSet].sort((a, b) =>
		a.localeCompare(b),
	);
	type WhirlpoolSnapshot = {
		tokenMintA: string | null;
		tokenMintB: string | null;
		tickSpacing: number | null;
		feeRate: number | null;
		currentTickIndex: number | null;
		rewardMints: Array<string | null>;
	};
	const whirlpoolByAddress = new Map<string, WhirlpoolSnapshot>();
	if (whirlpoolAddresses.length > 0) {
		const maybeWhirlpools = await fetchAllMaybeWhirlpool(
			rpc as never,
			whirlpoolAddresses.map((value) => address(value)),
		);
		for (const [index, maybeWhirlpool] of maybeWhirlpools.entries()) {
			const expectedAddress = whirlpoolAddresses[index];
			if (!expectedAddress) continue;
			const account = asObjectRecord(maybeWhirlpool);
			if (!account || account.exists !== true) {
				queryErrors.push(`${expectedAddress}: whirlpool account not found`);
				continue;
			}
			const data = asObjectRecord(account.data);
			if (!data) {
				queryErrors.push(`${expectedAddress}: invalid whirlpool account data`);
				continue;
			}
			const rewardMints = (
				Array.isArray(data.rewardInfos) ? data.rewardInfos : []
			).map((rewardInfo) => {
				const reward = asObjectRecord(rewardInfo);
				return toAddress(reward?.mint);
			});
			whirlpoolByAddress.set(expectedAddress, {
				tokenMintA: toAddress(data.tokenMintA),
				tokenMintB: toAddress(data.tokenMintB),
				tickSpacing: toNumber(data.tickSpacing),
				feeRate: toNumber(data.feeRate),
				currentTickIndex: toNumber(data.tickCurrentIndex),
				rewardMints,
			});
		}
	}

	for (const position of positions) {
		const whirlpool = whirlpoolByAddress.get(position.whirlpoolAddress);
		if (!whirlpool) continue;
		position.tokenMintA = whirlpool.tokenMintA;
		position.tokenMintB = whirlpool.tokenMintB;
		position.tickSpacing = whirlpool.tickSpacing;
		position.feeRate = whirlpool.feeRate;
		position.currentTickIndex = whirlpool.currentTickIndex;
		position.rewards = position.rewards.map((reward) => ({
			...reward,
			mint: whirlpool.rewardMints[reward.index] ?? null,
		}));
	}

	positions.sort((a, b) => {
		const poolCmp = a.whirlpoolAddress.localeCompare(b.whirlpoolAddress);
		if (poolCmp !== 0) {
			return poolCmp;
		}
		return a.positionAddress.localeCompare(b.positionAddress);
	});
	queryErrors.sort((a, b) => a.localeCompare(b));

	const bundleAddresses = new Set(
		positions
			.map((position) => position.positionBundleAddress)
			.filter((value): value is string => typeof value === "string"),
	);
	return {
		protocol: "orca-whirlpool",
		address: ownerAddress,
		network,
		positionCount: positions.length,
		bundleCount: bundleAddresses.size,
		poolCount: new Set(positions.map((position) => position.whirlpoolAddress))
			.size,
		whirlpoolAddresses,
		positions,
		queryErrors,
	};
}

export async function callSolanaRpc(
	method: string,
	params: unknown[],
	network?: string,
): Promise<unknown> {
	const endpoint = getRpcEndpoint(network);
	const response = await fetch(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: Date.now(),
			method,
			params,
		}),
	});
	const bodyText = await response.text();
	let payload: {
		result?: unknown;
		error?: { code?: number; message?: string; data?: unknown };
	} = {};
	if (bodyText.trim().length > 0) {
		try {
			payload = JSON.parse(bodyText) as {
				result?: unknown;
				error?: { code?: number; message?: string; data?: unknown };
			};
		} catch {
			const detail = truncateText(bodyText);
			if (!response.ok) {
				throw new Error(
					`RPC request failed with HTTP ${response.status}: ${detail}`,
				);
			}
			throw new Error(`RPC ${method} returned non-JSON response: ${detail}`);
		}
	}

	if (!response.ok) {
		const hasPayloadFields = Object.keys(payload).length > 0;
		const detail =
			payload.error ??
			(hasPayloadFields ? payload : truncateText(bodyText) || "empty response");
		throw new Error(
			`RPC request failed with HTTP ${response.status}: ${stringifyUnknown(detail)}`,
		);
	}

	if (payload.error) {
		const code = payload.error.code ?? -1;
		const message = payload.error.message ?? "Unknown RPC error";
		const errorData =
			payload.error.data == null
				? ""
				: ` data=${stringifyUnknown(payload.error.data)}`;
		throw new Error(`RPC ${method} failed (${code}): ${message}${errorData}`);
	}

	return payload.result ?? null;
}
