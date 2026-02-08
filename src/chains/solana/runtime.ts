import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
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
  return "https://transaction-v1.raydium.io";
}

export function getRaydiumPriorityFeeApiBaseUrl(): string {
  const configured = process.env.RAYDIUM_PRIORITY_FEE_API_BASE_URL?.trim();
  if (configured && configured.length > 0) {
    return configured.replace(/\/+$/, "");
  }
  return "https://api-v3.raydium.io";
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

export async function getJupiterDexLabels(): Promise<Record<string, string>> {
  const payload = await callJupiterApi("/swap/v1/program-id-to-label");
  if (!payload || typeof payload !== "object") return {};
  const entries = Object.entries(payload as Record<string, unknown>).filter(
    ([, value]) => typeof value === "string",
  ) as [string, string][];
  return Object.fromEntries(entries);
}

export async function getJupiterQuote(
  request: JupiterQuoteRequest,
): Promise<unknown> {
  return callJupiterApi("/swap/v1/quote", {
    method: "GET",
    query: buildJupiterQuoteQuery(request),
  });
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
  return callJupiterApi("/swap/v1/swap", {
    method: "POST",
    body: buildJupiterSwapBody(request),
  });
}

export async function buildJupiterSwapInstructions(
  request: JupiterSwapRequest,
): Promise<unknown> {
  return callJupiterApi("/swap/v1/swap-instructions", {
    method: "POST",
    body: buildJupiterSwapBody(request),
  });
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
  const baseUrl = getRaydiumApiBaseUrl();
  const query = buildQueryString(options.query);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${baseUrl}${normalizedPath}${query}`;
  return callJsonApi(
    url,
    method,
    { "content-type": "application/json" },
    options.body,
    options.timeoutMs,
  );
}

export async function getRaydiumPriorityFee(): Promise<unknown> {
  const baseUrl = getRaydiumPriorityFeeApiBaseUrl();
  return callJsonApi(
    `${baseUrl}/main/auto-fee`,
    "GET",
    { "content-type": "application/json" },
    undefined,
    20_000,
  );
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
