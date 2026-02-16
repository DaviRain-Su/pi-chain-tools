import { callNearRpc, parseNearNetwork } from "./runtime.js";

export type RefNetwork = "mainnet" | "testnet";

export type RefPoolView = {
	id: number;
	token_account_ids: string[];
	amounts: string[];
	total_fee: number;
	pool_kind?: string;
};

export type RefSwapAction = {
	poolId: number;
	tokenInId: string;
	tokenOutId: string;
	amountInRaw?: string;
};

export type RefSwapQuote = {
	refContractId: string;
	poolId: number;
	tokenInId: string;
	tokenOutId: string;
	amountInRaw: string;
	amountOutRaw: string;
	minAmountOutRaw: string;
	feeBps: number;
	source:
		| "explicitPool"
		| "bestDirectSimplePool"
		| "bestDirectPool"
		| "bestTwoHopPoolRoute";
	actions: RefSwapAction[];
};

export type RefPoolPairSelection = {
	refContractId: string;
	poolId: number;
	poolKind?: string;
	tokenAId: string;
	tokenBId: string;
	liquidityScore: string;
	source: "explicitPool" | "bestLiquidityPool";
	pool: RefPoolView;
	candidates: RefPoolPairCandidate[];
};

export type RefPoolPairCandidate = {
	poolId: number;
	poolKind?: string;
	tokenAId: string;
	tokenBId: string;
	liquidityScore: string;
};

type NearCallFunctionResult = {
	result: number[];
	logs: string[];
	block_height: number;
	block_hash: string;
};

const DEFAULT_REF_CONTRACT_BY_NETWORK: Record<RefNetwork, string> = {
	mainnet: "v2.ref-finance.near",
	testnet: "ref-finance-101.testnet",
};

const REF_CONTRACT_ENV_BY_NETWORK: Record<RefNetwork, string> = {
	mainnet: "NEAR_REF_MAINNET_CONTRACT_ID",
	testnet: "NEAR_REF_TESTNET_CONTRACT_ID",
};

const REF_TOKEN_MAP_ENV_BY_NETWORK: Record<RefNetwork, string> = {
	mainnet: "NEAR_REF_TOKEN_MAP_MAINNET",
	testnet: "NEAR_REF_TOKEN_MAP_TESTNET",
};

const REF_TOKEN_DECIMALS_ENV_BY_NETWORK: Record<RefNetwork, string> = {
	mainnet: "NEAR_REF_TOKEN_DECIMALS_MAINNET",
	testnet: "NEAR_REF_TOKEN_DECIMALS_TESTNET",
};

const DEFAULT_REF_TOKEN_MAP_BY_NETWORK: Record<
	RefNetwork,
	Record<string, string[]>
> = {
	mainnet: {
		NEAR: ["wrap.near"],
		WNEAR: ["wrap.near"],
		USDT: ["usdt.tether-token.near"],
		USDC: [
			"a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
			"usdc.tether-token.near",
			"usdc.fakes.near",
		],
	},
	testnet: {
		NEAR: ["wrap.testnet"],
		WNEAR: ["wrap.testnet"],
		USDT: ["usdt.fakes.near", "usdt.tether-token.testnet"],
		USDC: ["usdc.fakes.near"],
	},
};

const DEFAULT_REF_TOKEN_DECIMALS_BY_NETWORK: Record<
	RefNetwork,
	Record<string, number>
> = {
	mainnet: {
		NEAR: 24,
		WNEAR: 24,
		"wrap.near": 24,
		USDT: 6,
		"usdt.tether-token.near": 6,
		USDC: 6,
		"usdc.tether-token.near": 6,
		"usdc.fakes.near": 6,
		"a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near": 6,
	},
	testnet: {
		NEAR: 24,
		WNEAR: 24,
		"wrap.testnet": 24,
		USDT: 6,
		"usdt.fakes.near": 6,
		"usdt.tether-token.testnet": 6,
		USDC: 6,
		"usdc.fakes.near": 6,
	},
};

const FEE_DIVISOR = 10_000n;
const DEFAULT_REF_POOL_PAIR_CANDIDATES = 3;
const MAX_REF_POOL_PAIR_CANDIDATES = 10;

function encodeNearCallArgs(args: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(args), "utf8").toString("base64");
}

function isTransientRefRpcError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const text = error.message.toLowerCase();
	return (
		text.includes("429") ||
		text.includes("too many requests") ||
		text.includes("fetch failed") ||
		text.includes("timeout") ||
		text.includes("503")
	);
}

async function callNearRpcWithRetry<T>(params: {
	method: string;
	network?: string;
	rpcUrl?: string;
	params: unknown;
	maxAttempts?: number;
}): Promise<T> {
	const maxAttempts = Math.max(1, Math.min(4, params.maxAttempts ?? 3));
	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			return await callNearRpc<T>({
				method: params.method,
				network: params.network,
				rpcUrl: params.rpcUrl,
				params: params.params,
			});
		} catch (error) {
			lastError = error;
			if (attempt >= maxAttempts || !isTransientRefRpcError(error)) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error("NEAR RPC retry failed");
}

function decodeNearCallResult<T>(payload: NearCallFunctionResult): T {
	if (!Array.isArray(payload.result)) {
		throw new Error("Invalid call_function result payload");
	}
	const utf8 = Buffer.from(Uint8Array.from(payload.result)).toString("utf8");
	if (!utf8.trim()) {
		throw new Error("call_function returned empty payload");
	}
	return JSON.parse(utf8) as T;
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

function parsePoolId(poolId: number | string): number {
	const normalized = typeof poolId === "number" ? poolId : Number(poolId);
	if (
		!Number.isFinite(normalized) ||
		!Number.isInteger(normalized) ||
		normalized < 0
	) {
		throw new Error("poolId must be a non-negative integer");
	}
	return normalized;
}

function parseMaxCandidates(maxCandidates?: number): number {
	if (maxCandidates == null) return DEFAULT_REF_POOL_PAIR_CANDIDATES;
	if (!Number.isFinite(maxCandidates) || maxCandidates <= 0) {
		throw new Error("maxCandidates must be a positive number");
	}
	return Math.min(MAX_REF_POOL_PAIR_CANDIDATES, Math.floor(maxCandidates));
}

function parseSlippageBps(slippageBps?: number): number {
	if (slippageBps == null) return 50;
	if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 5000) {
		throw new Error("slippageBps must be between 0 and 5000");
	}
	return Math.floor(slippageBps);
}

function parseFeeBps(rawFee: number): bigint {
	const normalizedFee = Number.isFinite(rawFee) ? Math.floor(rawFee) : 0;
	if (normalizedFee < 0) return 0n;
	if (normalizedFee > Number(FEE_DIVISOR)) return FEE_DIVISOR;
	return BigInt(normalizedFee);
}

function isSimplePool(pool: RefPoolView): boolean {
	return !pool.pool_kind || pool.pool_kind === "SIMPLE_POOL";
}

function estimateSimplePoolSwap(params: {
	pool: RefPoolView;
	tokenInId: string;
	tokenOutId: string;
	amountInRaw: bigint;
}): bigint {
	const inIndex = params.pool.token_account_ids.findIndex(
		(tokenId) => tokenId === params.tokenInId,
	);
	const outIndex = params.pool.token_account_ids.findIndex(
		(tokenId) => tokenId === params.tokenOutId,
	);
	if (inIndex < 0 || outIndex < 0) return 0n;
	if (
		inIndex >= params.pool.amounts.length ||
		outIndex >= params.pool.amounts.length
	) {
		return 0n;
	}

	const reserveIn = parseNonNegativeBigInt(
		params.pool.amounts[inIndex] ?? "0",
		"reserveIn",
	);
	const reserveOut = parseNonNegativeBigInt(
		params.pool.amounts[outIndex] ?? "0",
		"reserveOut",
	);
	if (reserveIn <= 0n || reserveOut <= 0n) {
		return 0n;
	}
	const feeBps = parseFeeBps(params.pool.total_fee);
	const amountInAfterFee =
		(params.amountInRaw * (FEE_DIVISOR - feeBps)) / FEE_DIVISOR;
	if (amountInAfterFee <= 0n) return 0n;

	return (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
}

function applySlippage(amountOutRaw: bigint, slippageBps: number): bigint {
	const bps = BigInt(parseSlippageBps(slippageBps));
	const numerator = FEE_DIVISOR - bps;
	if (numerator <= 0n) return 0n;
	return (amountOutRaw * numerator) / FEE_DIVISOR;
}

function normalizeTokenLookupKey(value: string): string {
	const normalized = value.trim();
	if (!normalized) return "";
	return normalized.includes(".")
		? normalized.toLowerCase()
		: normalized.toUpperCase();
}

function isAccountLikeTokenId(value: string): boolean {
	return value.includes(".");
}

function parseTokenMapEnv(value: string | undefined): Record<string, string[]> {
	const normalized = value?.trim();
	if (!normalized) return {};
	try {
		const parsed = JSON.parse(normalized) as unknown;
		if (!parsed || typeof parsed !== "object") return {};
		const map: Record<string, string[]> = {};
		for (const [rawKey, rawValue] of Object.entries(parsed)) {
			if (typeof rawKey !== "string") continue;
			const key = normalizeTokenLookupKey(rawKey);
			if (!key) continue;
			if (typeof rawValue === "string" && rawValue.trim()) {
				map[key] = [rawValue.trim()];
				continue;
			}
			if (Array.isArray(rawValue)) {
				const values = rawValue
					.filter((entry): entry is string => typeof entry === "string")
					.map((entry) => entry.trim())
					.filter(Boolean);
				if (values.length > 0) {
					map[key] = values;
				}
			}
		}
		return map;
	} catch {
		return {};
	}
}

function parseTokenDecimalsEnv(
	value: string | undefined,
): Record<string, number> {
	const normalized = value?.trim();
	if (!normalized) return {};
	try {
		const parsed = JSON.parse(normalized) as unknown;
		if (!parsed || typeof parsed !== "object") return {};
		const map: Record<string, number> = {};
		for (const [rawKey, rawValue] of Object.entries(parsed)) {
			if (typeof rawKey !== "string") continue;
			const key = normalizeTokenLookupKey(rawKey);
			if (!key) continue;
			const parsedValue =
				typeof rawValue === "number" ? rawValue : Number(rawValue);
			if (
				Number.isFinite(parsedValue) &&
				Number.isInteger(parsedValue) &&
				parsedValue >= 0 &&
				parsedValue <= 255
			) {
				map[key] = parsedValue;
			}
		}
		return map;
	} catch {
		return {};
	}
}

function resolveTokenMap(network: RefNetwork): Record<string, string[]> {
	const globalMap = parseTokenMapEnv(process.env.NEAR_REF_TOKEN_MAP);
	const networkMap = parseTokenMapEnv(
		process.env[REF_TOKEN_MAP_ENV_BY_NETWORK[network]],
	);
	return {
		...DEFAULT_REF_TOKEN_MAP_BY_NETWORK[network],
		...globalMap,
		...networkMap,
	};
}

function resolveTokenDecimalsMap(network: RefNetwork): Record<string, number> {
	const globalMap = parseTokenDecimalsEnv(process.env.NEAR_REF_TOKEN_DECIMALS);
	const networkMap = parseTokenDecimalsEnv(
		process.env[REF_TOKEN_DECIMALS_ENV_BY_NETWORK[network]],
	);
	return {
		...DEFAULT_REF_TOKEN_DECIMALS_BY_NETWORK[network],
		...globalMap,
		...networkMap,
	};
}

function dedupeStrings(values: string[]): string[] {
	return [...new Set(values)];
}

function collectPoolTokenIds(pools: RefPoolView[]): Set<string> {
	const tokenIds = new Set<string>();
	for (const pool of pools) {
		for (const tokenId of pool.token_account_ids) {
			tokenIds.add(tokenId);
		}
	}
	return tokenIds;
}

function collectPoolsByTokenId(
	pools: RefPoolView[],
): Map<string, RefPoolView[]> {
	const map = new Map<string, RefPoolView[]>();
	for (const pool of pools) {
		for (const tokenId of pool.token_account_ids) {
			const list = map.get(tokenId) ?? [];
			list.push(pool);
			map.set(tokenId, list);
		}
	}
	return map;
}

function readPoolReserve(pool: RefPoolView, tokenId: string): bigint | null {
	const index = pool.token_account_ids.findIndex(
		(candidate) => candidate === tokenId,
	);
	if (index < 0 || index >= pool.amounts.length) return null;
	return parseNonNegativeBigInt(pool.amounts[index] ?? "0", "reserve");
}

function estimatePairLiquidityScore(params: {
	pool: RefPoolView;
	tokenAId: string;
	tokenBId: string;
}): bigint | null {
	const reserveA = readPoolReserve(params.pool, params.tokenAId);
	const reserveB = readPoolReserve(params.pool, params.tokenBId);
	if (reserveA == null || reserveB == null) return null;
	return reserveA * reserveB;
}

function resolveBestPairInPool(params: {
	pool: RefPoolView;
	tokenACandidates: string[];
	tokenBCandidates: string[];
}): {
	tokenAId: string;
	tokenBId: string;
	liquidityScore: bigint;
} | null {
	let best: {
		tokenAId: string;
		tokenBId: string;
		liquidityScore: bigint;
	} | null = null;
	for (const tokenAId of params.tokenACandidates) {
		if (!params.pool.token_account_ids.includes(tokenAId)) continue;
		for (const tokenBId of params.tokenBCandidates) {
			if (tokenAId === tokenBId) continue;
			if (!params.pool.token_account_ids.includes(tokenBId)) continue;
			const score = estimatePairLiquidityScore({
				pool: params.pool,
				tokenAId,
				tokenBId,
			});
			if (score == null) continue;
			if (!best || score > best.liquidityScore) {
				best = {
					tokenAId,
					tokenBId,
					liquidityScore: score,
				};
			}
		}
	}
	return best;
}

function resolveTokenCandidates(params: {
	network: RefNetwork;
	tokenInput: string;
	poolTokenIds?: Set<string>;
}): string[] {
	const rawInput = params.tokenInput.trim();
	if (!rawInput) {
		throw new Error("token input is required");
	}
	if (isAccountLikeTokenId(rawInput)) {
		return [rawInput.toLowerCase()];
	}

	const tokenMap = resolveTokenMap(params.network);
	const key = normalizeTokenLookupKey(rawInput);
	const candidates = dedupeStrings(
		(tokenMap[key] ?? []).map((tokenId) => tokenId.toLowerCase()),
	);
	if (candidates.length === 0) {
		throw new Error(
			`Unknown token symbol: ${rawInput}. Provide contract id directly or configure ${REF_TOKEN_MAP_ENV_BY_NETWORK[params.network]}.`,
		);
	}

	if (!params.poolTokenIds) return candidates;
	const poolTokenIds = params.poolTokenIds;
	const filtered = candidates.filter((tokenId) => poolTokenIds.has(tokenId));
	if (filtered.length > 0) return filtered;
	return candidates;
}

export function resolveRefTokenIds(params: {
	network?: string;
	tokenIdOrSymbol: string;
	availableTokenIds?: string[] | Set<string>;
}): string[] {
	const network = parseNearNetwork(params.network);
	const availableTokenIds = params.availableTokenIds
		? Array.isArray(params.availableTokenIds)
			? new Set(
					params.availableTokenIds.map((tokenId) => tokenId.toLowerCase()),
				)
			: new Set(
					[...params.availableTokenIds].map((tokenId) => tokenId.toLowerCase()),
				)
		: undefined;
	return resolveTokenCandidates({
		network,
		tokenInput: params.tokenIdOrSymbol,
		poolTokenIds: availableTokenIds,
	});
}

export function getRefTokenDecimalsHint(params: {
	network?: string;
	tokenIdOrSymbol: string;
}): number | null {
	const network = parseNearNetwork(params.network);
	const key = normalizeTokenLookupKey(params.tokenIdOrSymbol);
	if (!key) return null;
	const decimalsMap = resolveTokenDecimalsMap(network);
	return Number.isInteger(decimalsMap[key]) ? decimalsMap[key] : null;
}

export function getRefContractId(
	network?: string,
	refContractId?: string,
): string {
	const explicit = refContractId?.trim();
	if (explicit) return explicit;

	const parsedNetwork = parseNearNetwork(network);
	const networkEnv =
		process.env[REF_CONTRACT_ENV_BY_NETWORK[parsedNetwork]]?.trim();
	if (networkEnv) return networkEnv;

	const fallbackEnv = process.env.NEAR_REF_CONTRACT_ID?.trim();
	if (fallbackEnv) return fallbackEnv;

	return DEFAULT_REF_CONTRACT_BY_NETWORK[parsedNetwork];
}

export async function fetchRefPools(params: {
	network?: string;
	rpcUrl?: string;
	refContractId?: string;
	limit?: number;
}): Promise<RefPoolView[]> {
	const network = parseNearNetwork(params.network);
	const refContractId = getRefContractId(network, params.refContractId);
	const pageLimit = Math.max(1, Math.min(300, Math.floor(params.limit ?? 200)));
	const maxPages = 40;

	const pools: RefPoolView[] = [];
	let fromIndex = 0;

	for (let page = 0; page < maxPages; page += 1) {
		const result = await callNearRpcWithRetry<NearCallFunctionResult>({
			method: "query",
			network,
			rpcUrl: params.rpcUrl,
			params: {
				request_type: "call_function",
				account_id: refContractId,
				method_name: "get_pools",
				args_base64: encodeNearCallArgs({
					from_index: fromIndex,
					limit: pageLimit,
				}),
				finality: "final",
			},
		});

		const chunk = decodeNearCallResult<RefPoolView[]>(result);
		if (!Array.isArray(chunk) || chunk.length === 0) break;
		for (const [offset, rawPool] of chunk.entries()) {
			if (!rawPool || typeof rawPool !== "object") continue;
			const tokenIds = Array.isArray(rawPool.token_account_ids)
				? rawPool.token_account_ids.filter(
						(entry): entry is string => typeof entry === "string",
					)
				: [];
			const amounts = Array.isArray(rawPool.amounts)
				? rawPool.amounts.filter(
						(entry): entry is string => typeof entry === "string",
					)
				: [];
			if (tokenIds.length < 2 || amounts.length < 2) continue;
			const poolId =
				typeof rawPool.id === "number" && Number.isInteger(rawPool.id)
					? rawPool.id
					: fromIndex + offset;
			pools.push({
				id: poolId,
				token_account_ids: tokenIds,
				amounts,
				total_fee:
					typeof rawPool.total_fee === "number" &&
					Number.isFinite(rawPool.total_fee)
						? rawPool.total_fee
						: 0,
				pool_kind:
					typeof rawPool.pool_kind === "string" ? rawPool.pool_kind : undefined,
			});
		}

		if (chunk.length < pageLimit) break;
		fromIndex += chunk.length;
	}

	return pools;
}

export async function fetchRefPoolById(params: {
	network?: string;
	rpcUrl?: string;
	refContractId?: string;
	poolId: number | string;
}): Promise<RefPoolView> {
	const network = parseNearNetwork(params.network);
	const refContractId = getRefContractId(network, params.refContractId);
	const poolId = parsePoolId(params.poolId);

	const result = await callNearRpcWithRetry<NearCallFunctionResult>({
		method: "query",
		network,
		rpcUrl: params.rpcUrl,
		params: {
			request_type: "call_function",
			account_id: refContractId,
			method_name: "get_pool",
			args_base64: encodeNearCallArgs({
				pool_id: poolId,
			}),
			finality: "final",
		},
	});

	const rawPool = decodeNearCallResult<Partial<RefPoolView> | null>(result);
	if (!rawPool || typeof rawPool !== "object") {
		throw new Error(`Pool ${poolId} not found on ${refContractId}.`);
	}

	const tokenIds = Array.isArray(rawPool.token_account_ids)
		? rawPool.token_account_ids.filter(
				(entry): entry is string => typeof entry === "string",
			)
		: [];
	const amounts = Array.isArray(rawPool.amounts)
		? rawPool.amounts.filter(
				(entry): entry is string => typeof entry === "string",
			)
		: [];
	if (tokenIds.length < 2 || amounts.length < 2) {
		throw new Error(`Pool ${poolId} is missing token/amount metadata.`);
	}

	return {
		id: poolId,
		token_account_ids: tokenIds.map((tokenId) => tokenId.toLowerCase()),
		amounts,
		total_fee:
			typeof rawPool.total_fee === "number" &&
			Number.isFinite(rawPool.total_fee)
				? rawPool.total_fee
				: 0,
		pool_kind:
			typeof rawPool.pool_kind === "string" ? rawPool.pool_kind : undefined,
	};
}

export async function findRefPoolForPair(params: {
	network?: string;
	rpcUrl?: string;
	refContractId?: string;
	tokenAId: string;
	tokenBId: string;
	poolId?: number | string;
	maxCandidates?: number;
}): Promise<RefPoolPairSelection> {
	const network = parseNearNetwork(params.network);
	const refContractId = getRefContractId(network, params.refContractId);
	const maxCandidates = parseMaxCandidates(params.maxCandidates);
	const tokenAInput = params.tokenAId.trim();
	const tokenBInput = params.tokenBId.trim();
	if (!tokenAInput || !tokenBInput) {
		throw new Error("tokenAId and tokenBId are required");
	}
	const explicitPoolId =
		params.poolId != null ? parsePoolId(params.poolId) : undefined;

	if (explicitPoolId != null) {
		const pool = await fetchRefPoolById({
			network,
			rpcUrl: params.rpcUrl,
			refContractId,
			poolId: explicitPoolId,
		});
		const poolTokenIds = new Set(
			pool.token_account_ids.map((tokenId) => tokenId.toLowerCase()),
		);
		const tokenACandidates = resolveTokenCandidates({
			network,
			tokenInput: tokenAInput,
			poolTokenIds,
		});
		const tokenBCandidates = resolveTokenCandidates({
			network,
			tokenInput: tokenBInput,
			poolTokenIds,
		});
		const pair = resolveBestPairInPool({
			pool,
			tokenACandidates,
			tokenBCandidates,
		});
		if (!pair) {
			throw new Error(
				`Pool ${explicitPoolId} does not support token pair ${tokenAInput} / ${tokenBInput}.`,
			);
		}
		return {
			refContractId,
			poolId: explicitPoolId,
			poolKind: pool.pool_kind,
			tokenAId: pair.tokenAId,
			tokenBId: pair.tokenBId,
			liquidityScore: pair.liquidityScore.toString(),
			source: "explicitPool",
			pool,
			candidates: [
				{
					poolId: explicitPoolId,
					poolKind: pool.pool_kind,
					tokenAId: pair.tokenAId,
					tokenBId: pair.tokenBId,
					liquidityScore: pair.liquidityScore.toString(),
				},
			],
		};
	}

	const pools = await fetchRefPools({
		network,
		rpcUrl: params.rpcUrl,
		refContractId,
	});
	const poolTokenIds = collectPoolTokenIds(pools);
	const tokenACandidates = resolveTokenCandidates({
		network,
		tokenInput: tokenAInput,
		poolTokenIds,
	});
	const tokenBCandidates = resolveTokenCandidates({
		network,
		tokenInput: tokenBInput,
		poolTokenIds,
	});

	const candidates: Array<{
		pool: RefPoolView;
		tokenAId: string;
		tokenBId: string;
		liquidityScore: bigint;
	}> = [];

	for (const pool of pools) {
		const pair = resolveBestPairInPool({
			pool,
			tokenACandidates,
			tokenBCandidates,
		});
		if (!pair) continue;
		candidates.push({
			pool,
			tokenAId: pair.tokenAId,
			tokenBId: pair.tokenBId,
			liquidityScore: pair.liquidityScore,
		});
	}
	if (candidates.length === 0) {
		throw new Error(
			`No Ref pool found for token pair ${tokenAInput} / ${tokenBInput}.`,
		);
	}
	candidates.sort((left, right) => {
		if (left.liquidityScore === right.liquidityScore) {
			return left.pool.id - right.pool.id;
		}
		return left.liquidityScore > right.liquidityScore ? -1 : 1;
	});
	const best = candidates[0];
	const summarizedCandidates = candidates
		.slice(0, maxCandidates)
		.map((candidate) => ({
			poolId: candidate.pool.id,
			poolKind: candidate.pool.pool_kind,
			tokenAId: candidate.tokenAId,
			tokenBId: candidate.tokenBId,
			liquidityScore: candidate.liquidityScore.toString(),
		}));
	return {
		refContractId,
		poolId: best.pool.id,
		poolKind: best.pool.pool_kind,
		tokenAId: best.tokenAId,
		tokenBId: best.tokenBId,
		liquidityScore: best.liquidityScore.toString(),
		source: "bestLiquidityPool",
		pool: best.pool,
		candidates: summarizedCandidates,
	};
}

async function queryRefReturn(params: {
	network?: string;
	rpcUrl?: string;
	refContractId?: string;
	poolId: number;
	tokenInId: string;
	tokenOutId: string;
	amountInRaw: string;
}): Promise<string> {
	const network = parseNearNetwork(params.network);
	const refContractId = getRefContractId(network, params.refContractId);
	const result = await callNearRpcWithRetry<NearCallFunctionResult>({
		method: "query",
		network,
		rpcUrl: params.rpcUrl,
		params: {
			request_type: "call_function",
			account_id: refContractId,
			method_name: "get_return",
			args_base64: encodeNearCallArgs({
				pool_id: params.poolId,
				token_in: params.tokenInId,
				amount_in: params.amountInRaw,
				token_out: params.tokenOutId,
			}),
			finality: "final",
		},
	});
	const amountOutRaw = decodeNearCallResult<string>(result);
	parseNonNegativeBigInt(amountOutRaw, "amountOutRaw");
	return amountOutRaw;
}

export async function getRefSwapQuote(params: {
	network?: string;
	rpcUrl?: string;
	refContractId?: string;
	tokenInId: string;
	tokenOutId: string;
	amountInRaw: string;
	poolId?: number | string;
	slippageBps?: number;
}): Promise<RefSwapQuote> {
	const network = parseNearNetwork(params.network);
	const refContractId = getRefContractId(network, params.refContractId);
	const tokenInInput = params.tokenInId.trim();
	const tokenOutInput = params.tokenOutId.trim();
	if (!tokenInInput || !tokenOutInput) {
		throw new Error("tokenInId and tokenOutId are required");
	}
	const amountInRaw = parsePositiveBigInt(params.amountInRaw, "amountInRaw");
	const slippageBps = parseSlippageBps(params.slippageBps);
	const hasSymbolInput =
		!isAccountLikeTokenId(tokenInInput) || !isAccountLikeTokenId(tokenOutInput);
	const explicitPoolId =
		params.poolId != null ? parsePoolId(params.poolId) : undefined;

	if (explicitPoolId != null && !hasSymbolInput) {
		const tokenInId = tokenInInput.toLowerCase();
		const tokenOutId = tokenOutInput.toLowerCase();
		const amountOutRaw = parsePositiveBigInt(
			await queryRefReturn({
				network,
				rpcUrl: params.rpcUrl,
				refContractId,
				poolId: explicitPoolId,
				tokenInId,
				tokenOutId,
				amountInRaw: amountInRaw.toString(),
			}),
			"amountOutRaw",
		);
		const minAmountOutRaw = applySlippage(amountOutRaw, slippageBps);
		return {
			refContractId,
			poolId: explicitPoolId,
			tokenInId,
			tokenOutId,
			amountInRaw: amountInRaw.toString(),
			amountOutRaw: amountOutRaw.toString(),
			minAmountOutRaw: minAmountOutRaw.toString(),
			feeBps: 0,
			source: "explicitPool",
			actions: [
				{
					poolId: explicitPoolId,
					tokenInId,
					tokenOutId,
					amountInRaw: amountInRaw.toString(),
				},
			],
		};
	}

	const pools = await fetchRefPools({
		network,
		rpcUrl: params.rpcUrl,
		refContractId,
	});
	const poolTokenIds = collectPoolTokenIds(pools);
	const tokenInCandidates = resolveTokenCandidates({
		network,
		tokenInput: tokenInInput,
		poolTokenIds,
	});
	const tokenOutCandidates = resolveTokenCandidates({
		network,
		tokenInput: tokenOutInput,
		poolTokenIds,
	});

	if (explicitPoolId != null) {
		const explicitPool = pools.find((pool) => pool.id === explicitPoolId);
		if (!explicitPool) {
			throw new Error(`Pool ${explicitPoolId} not found on ${refContractId}.`);
		}
		const tokenInId = tokenInCandidates.find((candidate) =>
			explicitPool.token_account_ids.includes(candidate),
		);
		const tokenOutId = tokenOutCandidates.find((candidate) =>
			explicitPool.token_account_ids.includes(candidate),
		);
		if (!tokenInId || !tokenOutId || tokenInId === tokenOutId) {
			throw new Error(
				`Pool ${explicitPoolId} does not support token pair ${tokenInInput} -> ${tokenOutInput}.`,
			);
		}
		const amountOutRaw = parsePositiveBigInt(
			await queryRefReturn({
				network,
				rpcUrl: params.rpcUrl,
				refContractId,
				poolId: explicitPoolId,
				tokenInId,
				tokenOutId,
				amountInRaw: amountInRaw.toString(),
			}),
			"amountOutRaw",
		);
		const minAmountOutRaw = applySlippage(amountOutRaw, slippageBps);
		return {
			refContractId,
			poolId: explicitPoolId,
			tokenInId,
			tokenOutId,
			amountInRaw: amountInRaw.toString(),
			amountOutRaw: amountOutRaw.toString(),
			minAmountOutRaw: minAmountOutRaw.toString(),
			feeBps: Number(parseFeeBps(explicitPool.total_fee)),
			source: "explicitPool",
			actions: [
				{
					poolId: explicitPoolId,
					tokenInId,
					tokenOutId,
					amountInRaw: amountInRaw.toString(),
				},
			],
		};
	}

	let bestSimple: {
		pool: RefPoolView;
		tokenInId: string;
		tokenOutId: string;
		amountOutRaw: bigint;
	} | null = null;

	for (const pool of pools) {
		if (!isSimplePool(pool)) continue;
		for (const tokenInId of tokenInCandidates) {
			if (!pool.token_account_ids.includes(tokenInId)) continue;
			for (const tokenOutId of tokenOutCandidates) {
				if (tokenInId === tokenOutId) continue;
				if (!pool.token_account_ids.includes(tokenOutId)) continue;
				const estimatedOut = estimateSimplePoolSwap({
					pool,
					tokenInId,
					tokenOutId,
					amountInRaw,
				});
				if (estimatedOut <= 0n) continue;
				if (!bestSimple || estimatedOut > bestSimple.amountOutRaw) {
					bestSimple = {
						pool,
						tokenInId,
						tokenOutId,
						amountOutRaw: estimatedOut,
					};
				}
			}
		}
	}

	if (bestSimple) {
		const minAmountOutRaw = applySlippage(bestSimple.amountOutRaw, slippageBps);
		return {
			refContractId,
			poolId: bestSimple.pool.id,
			tokenInId: bestSimple.tokenInId,
			tokenOutId: bestSimple.tokenOutId,
			amountInRaw: amountInRaw.toString(),
			amountOutRaw: bestSimple.amountOutRaw.toString(),
			minAmountOutRaw: minAmountOutRaw.toString(),
			feeBps: Number(parseFeeBps(bestSimple.pool.total_fee)),
			source: "bestDirectSimplePool",
			actions: [
				{
					poolId: bestSimple.pool.id,
					tokenInId: bestSimple.tokenInId,
					tokenOutId: bestSimple.tokenOutId,
					amountInRaw: amountInRaw.toString(),
				},
			],
		};
	}

	let bestDirect: {
		pool: RefPoolView;
		tokenInId: string;
		tokenOutId: string;
		amountOutRaw: bigint;
	} | null = null;

	for (const pool of pools) {
		for (const tokenInId of tokenInCandidates) {
			if (!pool.token_account_ids.includes(tokenInId)) continue;
			for (const tokenOutId of tokenOutCandidates) {
				if (tokenInId === tokenOutId) continue;
				if (!pool.token_account_ids.includes(tokenOutId)) continue;
				const quoted = parseNonNegativeBigInt(
					(await queryRefReturn({
						network,
						rpcUrl: params.rpcUrl,
						refContractId,
						poolId: pool.id,
						tokenInId,
						tokenOutId,
						amountInRaw: amountInRaw.toString(),
					})) || "0",
					"amountOutRaw",
				);
				if (quoted <= 0n) continue;
				if (!bestDirect || quoted > bestDirect.amountOutRaw) {
					bestDirect = {
						pool,
						tokenInId,
						tokenOutId,
						amountOutRaw: quoted,
					};
				}
			}
		}
	}

	if (bestDirect) {
		const minAmountOutRaw = applySlippage(bestDirect.amountOutRaw, slippageBps);
		return {
			refContractId,
			poolId: bestDirect.pool.id,
			tokenInId: bestDirect.tokenInId,
			tokenOutId: bestDirect.tokenOutId,
			amountInRaw: amountInRaw.toString(),
			amountOutRaw: bestDirect.amountOutRaw.toString(),
			minAmountOutRaw: minAmountOutRaw.toString(),
			feeBps: Number(parseFeeBps(bestDirect.pool.total_fee)),
			source: "bestDirectPool",
			actions: [
				{
					poolId: bestDirect.pool.id,
					tokenInId: bestDirect.tokenInId,
					tokenOutId: bestDirect.tokenOutId,
					amountInRaw: amountInRaw.toString(),
				},
			],
		};
	}

	const poolsByTokenId = collectPoolsByTokenId(pools);
	let bestTwoHop: {
		firstPool: RefPoolView;
		secondPool: RefPoolView;
		tokenInId: string;
		tokenMidId: string;
		tokenOutId: string;
		amountMidRaw: bigint;
		amountOutRaw: bigint;
	} | null = null;

	for (const tokenInId of tokenInCandidates) {
		const firstPools = poolsByTokenId.get(tokenInId) ?? [];
		for (const firstPool of firstPools) {
			for (const tokenMidId of firstPool.token_account_ids) {
				if (tokenMidId === tokenInId) continue;
				const secondPools = poolsByTokenId.get(tokenMidId) ?? [];
				if (secondPools.length === 0) continue;

				const amountMidRaw = parseNonNegativeBigInt(
					await queryRefReturn({
						network,
						rpcUrl: params.rpcUrl,
						refContractId,
						poolId: firstPool.id,
						tokenInId,
						tokenOutId: tokenMidId,
						amountInRaw: amountInRaw.toString(),
					}),
					"amountMidRaw",
				);
				if (amountMidRaw <= 0n) continue;

				for (const secondPool of secondPools) {
					if (secondPool.id === firstPool.id) continue;
					for (const tokenOutId of tokenOutCandidates) {
						if (tokenOutId === tokenMidId || tokenOutId === tokenInId) continue;
						if (!secondPool.token_account_ids.includes(tokenOutId)) continue;
						const amountOutRaw = parseNonNegativeBigInt(
							await queryRefReturn({
								network,
								rpcUrl: params.rpcUrl,
								refContractId,
								poolId: secondPool.id,
								tokenInId: tokenMidId,
								tokenOutId,
								amountInRaw: amountMidRaw.toString(),
							}),
							"amountOutRaw",
						);
						if (amountOutRaw <= 0n) continue;
						if (!bestTwoHop || amountOutRaw > bestTwoHop.amountOutRaw) {
							bestTwoHop = {
								firstPool,
								secondPool,
								tokenInId,
								tokenMidId,
								tokenOutId,
								amountMidRaw,
								amountOutRaw,
							};
						}
					}
				}
			}
		}
	}

	if (!bestTwoHop) {
		throw new Error(
			`No pool route found for ${tokenInInput} -> ${tokenOutInput} on ${refContractId}.`,
		);
	}

	const minAmountOutRaw = applySlippage(bestTwoHop.amountOutRaw, slippageBps);
	const combinedFeeBps = Number(
		parseFeeBps(bestTwoHop.firstPool.total_fee) +
			parseFeeBps(bestTwoHop.secondPool.total_fee),
	);
	return {
		refContractId,
		poolId: bestTwoHop.firstPool.id,
		tokenInId: bestTwoHop.tokenInId,
		tokenOutId: bestTwoHop.tokenOutId,
		amountInRaw: amountInRaw.toString(),
		amountOutRaw: bestTwoHop.amountOutRaw.toString(),
		minAmountOutRaw: minAmountOutRaw.toString(),
		feeBps: combinedFeeBps,
		source: "bestTwoHopPoolRoute",
		actions: [
			{
				poolId: bestTwoHop.firstPool.id,
				tokenInId: bestTwoHop.tokenInId,
				tokenOutId: bestTwoHop.tokenMidId,
				amountInRaw: amountInRaw.toString(),
			},
			{
				poolId: bestTwoHop.secondPool.id,
				tokenInId: bestTwoHop.tokenMidId,
				tokenOutId: bestTwoHop.tokenOutId,
				amountInRaw: bestTwoHop.amountMidRaw.toString(),
			},
		],
	};
}
