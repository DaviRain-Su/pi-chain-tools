import { callNearRpc, parseNearNetwork } from "./runtime.js";

export type RefNetwork = "mainnet" | "testnet";

export type RefPoolView = {
	id: number;
	token_account_ids: string[];
	amounts: string[];
	total_fee: number;
	pool_kind?: string;
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
	source: "explicitPool" | "bestDirectSimplePool";
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

const FEE_DIVISOR = 10_000n;

function encodeNearCallArgs(args: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(args), "utf8").toString("base64");
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
		const result = await callNearRpc<NearCallFunctionResult>({
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
	const result = await callNearRpc<NearCallFunctionResult>({
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
	parsePositiveBigInt(amountOutRaw, "amountOutRaw");
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
	const tokenInId = params.tokenInId.trim();
	const tokenOutId = params.tokenOutId.trim();
	if (!tokenInId || !tokenOutId) {
		throw new Error("tokenInId and tokenOutId are required");
	}
	const amountInRaw = parsePositiveBigInt(params.amountInRaw, "amountInRaw");
	const slippageBps = parseSlippageBps(params.slippageBps);

	if (params.poolId != null) {
		const poolId = parsePoolId(params.poolId);
		const amountOutRaw = parsePositiveBigInt(
			await queryRefReturn({
				network,
				rpcUrl: params.rpcUrl,
				refContractId,
				poolId,
				tokenInId,
				tokenOutId,
				amountInRaw: amountInRaw.toString(),
			}),
			"amountOutRaw",
		);
		const minAmountOutRaw = applySlippage(amountOutRaw, slippageBps);
		return {
			refContractId,
			poolId,
			tokenInId,
			tokenOutId,
			amountInRaw: amountInRaw.toString(),
			amountOutRaw: amountOutRaw.toString(),
			minAmountOutRaw: minAmountOutRaw.toString(),
			feeBps: 0,
			source: "explicitPool",
		};
	}

	const pools = await fetchRefPools({
		network,
		rpcUrl: params.rpcUrl,
		refContractId,
	});
	const candidates = pools.filter(
		(pool) =>
			isSimplePool(pool) &&
			pool.token_account_ids.includes(tokenInId) &&
			pool.token_account_ids.includes(tokenOutId),
	);
	if (candidates.length === 0) {
		throw new Error(
			`No direct simple pools found for ${tokenInId} -> ${tokenOutId} on ${refContractId}.`,
		);
	}

	let best: { pool: RefPoolView; amountOutRaw: bigint } | null = null;
	for (const pool of candidates) {
		const estimatedOut = estimateSimplePoolSwap({
			pool,
			tokenInId,
			tokenOutId,
			amountInRaw,
		});
		if (estimatedOut <= 0n) continue;
		if (!best || estimatedOut > best.amountOutRaw) {
			best = {
				pool,
				amountOutRaw: estimatedOut,
			};
		}
	}

	if (!best) {
		throw new Error(
			`No valid quote for ${tokenInId} -> ${tokenOutId}; all candidate pools returned zero output.`,
		);
	}

	const minAmountOutRaw = applySlippage(best.amountOutRaw, slippageBps);
	return {
		refContractId,
		poolId: best.pool.id,
		tokenInId,
		tokenOutId,
		amountInRaw: amountInRaw.toString(),
		amountOutRaw: best.amountOutRaw.toString(),
		minAmountOutRaw: minAmountOutRaw.toString(),
		feeBps: Number(parseFeeBps(best.pool.total_fee)),
		source: "bestDirectSimplePool",
	};
}
