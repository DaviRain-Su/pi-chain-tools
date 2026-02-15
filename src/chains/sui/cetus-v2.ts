import { createRequire } from "node:module";
import type { Transaction } from "@mysten/sui/transactions";
import { normalizeStructTag, parseStructTag } from "@mysten/sui/utils";
import { type SuiNetwork, getSuiClient, getSuiRpcEndpoint } from "./runtime.js";

export type CetusV2Network = "mainnet" | "testnet";

type DataPageLike<T> = {
	data?: T[];
	has_next_page?: boolean;
	next_cursor?: string | null;
};

type FarmsPoolLike = {
	id: string;
	clmm_pool_id: string;
	rewarders?: unknown[];
};

type CetusFarmsPoolPair = {
	poolId: string;
	clmmPoolId: string;
	coinTypeA: string;
	coinTypeB: string;
	pairSymbol: string;
};

type FarmsPositionLike = {
	id: string;
	pool_id: string;
	clmm_position_id?: string;
	clmm_pool_id?: string;
	rewards?: unknown[];
};

type VaultBalanceLike = {
	vault_id?: string;
	clmm_pool_id?: string;
	lp_token_balance?: string;
};

type CetusFarmsSDKLike = {
	setSenderAddress(value: string): void;
	Farms: {
		getFarmsPoolList(pagination?: "all"): Promise<DataPageLike<FarmsPoolLike>>;
		getOwnedFarmsPositionNFTList(
			owner: string,
			assignPools?: string[],
			calculateFarmingRewards?: boolean,
			pagination?: "all",
		): Promise<
			DataPageLike<FarmsPositionLike> | Record<string, FarmsPositionLike[]>
		>;
		depositPayload(params: {
			pool_id: string;
			clmm_position_id: string;
			clmm_pool_id: string;
			coin_type_a: string;
			coin_type_b: string;
		}): Transaction;
		withdrawPayload(params: {
			pool_id: string;
			position_nft_id: string;
		}): Promise<Transaction>;
		harvestPayload(params: {
			pool_id: string;
			position_nft_id: string;
		}): Promise<Transaction>;
	};
};

type CetusVaultsSDKLike = {
	setSenderAddress(value: string): void;
	Vaults: {
		getOwnerVaultsBalance(owner: string): Promise<VaultBalanceLike[]>;
	};
};

type CetusFarmsSDKCtor = {
	createSDK(config: {
		env: CetusV2Network;
		full_rpc_url?: string;
	}): CetusFarmsSDKLike;
};

type CetusVaultsSDKCtor = {
	createSDK(config: {
		env: CetusV2Network;
		full_rpc_url?: string;
	}): CetusVaultsSDKLike;
};

let cachedFarmsCtor: CetusFarmsSDKCtor | null = null;
let cachedVaultsCtor: CetusVaultsSDKCtor | null = null;
const require = createRequire(import.meta.url);

function isSdkCtor(
	value: unknown,
): value is { createSDK: (...args: unknown[]) => unknown } {
	if (
		value == null ||
		(typeof value !== "object" && typeof value !== "function") ||
		!("createSDK" in value)
	) {
		return false;
	}
	return typeof (value as { createSDK?: unknown }).createSDK === "function";
}

function parseFarmsCtor(moduleValue: unknown): CetusFarmsSDKCtor | null {
	const typed =
		moduleValue &&
		(typeof moduleValue === "object" || typeof moduleValue === "function")
			? (moduleValue as {
					CetusFarmsSDK?: unknown;
					default?: unknown;
				})
			: null;
	const defaultValue =
		typed?.default &&
		(typeof typed.default === "object" || typeof typed.default === "function")
			? (typed.default as { CetusFarmsSDK?: unknown; default?: unknown })
			: null;
	const candidates = [
		moduleValue,
		typed?.CetusFarmsSDK,
		typed?.default,
		defaultValue?.CetusFarmsSDK,
		defaultValue?.default,
	];
	for (const candidate of candidates) {
		if (isSdkCtor(candidate)) return candidate as CetusFarmsSDKCtor;
	}
	return null;
}

function parseVaultsCtor(moduleValue: unknown): CetusVaultsSDKCtor | null {
	const typed =
		moduleValue &&
		(typeof moduleValue === "object" || typeof moduleValue === "function")
			? (moduleValue as {
					CetusVaultsSDK?: unknown;
					default?: unknown;
				})
			: null;
	const defaultValue =
		typed?.default &&
		(typeof typed.default === "object" || typeof typed.default === "function")
			? (typed.default as { CetusVaultsSDK?: unknown; default?: unknown })
			: null;
	const candidates = [
		moduleValue,
		typed?.CetusVaultsSDK,
		typed?.default,
		defaultValue?.CetusVaultsSDK,
		defaultValue?.default,
	];
	for (const candidate of candidates) {
		if (isSdkCtor(candidate)) return candidate as CetusVaultsSDKCtor;
	}
	return null;
}

async function getFarmsCtor(): Promise<CetusFarmsSDKCtor> {
	if (cachedFarmsCtor) return cachedFarmsCtor;
	const importValue = await import("@cetusprotocol/farms-sdk");
	let ctor = parseFarmsCtor(importValue);
	if (!ctor) {
		try {
			const requireValue = require("@cetusprotocol/farms-sdk");
			ctor = parseFarmsCtor(requireValue);
		} catch {
			// ignore and throw unified error below
		}
	}
	if (!ctor || typeof ctor.createSDK !== "function") {
		throw new Error(
			"Failed to load @cetusprotocol/farms-sdk: CetusFarmsSDK.createSDK not found.",
		);
	}
	cachedFarmsCtor = ctor;
	return ctor;
}

async function getVaultsCtor(): Promise<CetusVaultsSDKCtor> {
	if (cachedVaultsCtor) return cachedVaultsCtor;
	const importValue = await import("@cetusprotocol/vaults-sdk");
	let ctor = parseVaultsCtor(importValue);
	if (!ctor) {
		try {
			const requireValue = require("@cetusprotocol/vaults-sdk");
			ctor = parseVaultsCtor(requireValue);
		} catch {
			// ignore and throw unified error below
		}
	}
	if (!ctor || typeof ctor.createSDK !== "function") {
		throw new Error(
			"Failed to load @cetusprotocol/vaults-sdk: CetusVaultsSDK.createSDK not found.",
		);
	}
	cachedVaultsCtor = ctor;
	return ctor;
}

export function resolveCetusV2Network(network: SuiNetwork): CetusV2Network {
	if (network === "mainnet" || network === "testnet") return network;
	throw new Error(
		"Cetus v2 SDK currently supports network=mainnet or testnet.",
	);
}

async function createFarmsSDK(params: {
	network: CetusV2Network;
	rpcUrl?: string;
	sender?: string;
}): Promise<CetusFarmsSDKLike> {
	const ctor = await getFarmsCtor();
	const resolvedRpcUrl = getSuiRpcEndpoint(params.network, params.rpcUrl);
	const sdk = ctor.createSDK({
		env: params.network,
		full_rpc_url: resolvedRpcUrl,
	});
	if (params.sender?.trim()) {
		sdk.setSenderAddress(params.sender.trim());
	}
	return sdk;
}

async function createVaultsSDK(params: {
	network: CetusV2Network;
	rpcUrl?: string;
	sender?: string;
}): Promise<CetusVaultsSDKLike> {
	const ctor = await getVaultsCtor();
	const resolvedRpcUrl = getSuiRpcEndpoint(params.network, params.rpcUrl);
	const sdk = ctor.createSDK({
		env: params.network,
		full_rpc_url: resolvedRpcUrl,
	});
	if (params.sender?.trim()) {
		sdk.setSenderAddress(params.sender.trim());
	}
	return sdk;
}

function normalizeDataPage<T>(input: unknown): {
	data: T[];
	hasNextPage: boolean;
	nextCursor: string | null;
} {
	const payload = input as DataPageLike<T>;
	return {
		data: Array.isArray(payload?.data) ? payload.data : [],
		hasNextPage: payload?.has_next_page === true,
		nextCursor:
			typeof payload?.next_cursor === "string" ? payload.next_cursor : null,
	};
}

function isObjectWithStringType(value: unknown): value is { type?: string } {
	if (!value || typeof value !== "object") return false;
	return typeof (value as { type?: unknown }).type === "string";
}

function getPairCoinTypesFromType(typeText: string): {
	coinTypeA: string;
	coinTypeB: string;
} | null {
	let parsedType = typeText.trim();
	if (!parsedType.includes("::Pool<")) return null;
	if (!parsedType.includes(">")) parsedType = `${parsedType}>`;
	try {
		const parsed = parseStructTag(parsedType);
		if (parsed.name !== "Pool") return null;
		if (parsed.typeParams.length < 2) return null;
		const rawA = parsed.typeParams[0];
		const rawB = parsed.typeParams[1];
		const coinTypeA =
			typeof rawA === "string"
				? rawA
				: typeof rawA === "object"
					? normalizeStructTag(rawA)
					: null;
		const coinTypeB =
			typeof rawB === "string"
				? rawB
				: typeof rawB === "object"
					? normalizeStructTag(rawB)
					: null;
		if (!coinTypeA || !coinTypeB) return null;
		return { coinTypeA, coinTypeB };
	} catch {
		return null;
	}
}

function normalizeAddress(value: string): string {
	return value.trim().toLowerCase();
}

function normalizePairKey(coinTypeA: string, coinTypeB: string): string {
	return `${normalizeAddress(coinTypeA)}|${normalizeAddress(coinTypeB)}`;
}

function getCoinSymbolFallback(coinType: string): string {
	const segments = coinType.split("::").map((entry) => entry.trim());
	return segments[segments.length - 1] || coinType;
}

async function resolveCetusFarmsPoolPairs(params: {
	network: CetusV2Network;
	rpcUrl?: string;
	clmmPoolIds: string[];
}): Promise<
	Map<
		string,
		{
			coinTypeA: string;
			coinTypeB: string;
			pairSymbol: string;
		}
	>
> {
	const resolvedPairs = new Map<
		string,
		{
			coinTypeA: string;
			coinTypeB: string;
			pairSymbol: string;
		}
	>();
	const uniquePoolIds = [...new Set(params.clmmPoolIds)];
	if (uniquePoolIds.length === 0) {
		return resolvedPairs;
	}

	const client = getSuiClient(params.network, params.rpcUrl);
	const clientAny = client as {
		multiGetObjects?: (params: {
			ids: string[];
			options?: { showType?: boolean };
		}) => Promise<unknown[]>;
		getCoinMetadata?: (params: {
			coinType: string;
		}) => Promise<{ symbol?: string } | null>;
	};
	if (typeof clientAny.multiGetObjects !== "function") return resolvedPairs;

	const poolObjects = await clientAny.multiGetObjects({
		ids: uniquePoolIds,
		options: { showType: true },
	});
	const types = new Map<string, { coinTypeA: string; coinTypeB: string }>();
	const coinTypes = new Set<string>();
	for (const [index, poolId] of uniquePoolIds.entries()) {
		const entry = poolObjects[index];
		const candidateType = isObjectWithStringType(
			(entry as { data?: { type?: string } })?.data,
		)
			? (entry as { data?: { type?: string } }).data?.type
			: undefined;
		const parsed = candidateType
			? getPairCoinTypesFromType(candidateType)
			: null;
		if (!parsed) continue;
		types.set(poolId, parsed);
		coinTypes.add(parsed.coinTypeA);
		coinTypes.add(parsed.coinTypeB);
	}
	if (types.size === 0) return resolvedPairs;

	const symbolByCoinType = new Map<string, string>();
	for (const coinType of coinTypes) {
		symbolByCoinType.set(coinType, getCoinSymbolFallback(coinType));
	}
	if (typeof clientAny.getCoinMetadata === "function") {
		await Promise.all(
			[...coinTypes].map(async (coinType) => {
				try {
					const metadata = await clientAny.getCoinMetadata?.({
						coinType,
					});
					if (metadata?.symbol) {
						symbolByCoinType.set(coinType, metadata.symbol.trim());
					}
				} catch {
					// ignore; keep fallback symbol
				}
			}),
		);
	}

	for (const [poolId, pair] of types.entries()) {
		const symbolA = symbolByCoinType.get(pair.coinTypeA) ?? pair.coinTypeA;
		const symbolB = symbolByCoinType.get(pair.coinTypeB) ?? pair.coinTypeB;
		resolvedPairs.set(poolId, {
			coinTypeA: pair.coinTypeA,
			coinTypeB: pair.coinTypeB,
			pairSymbol: `${symbolA}/${symbolB}`,
		});
	}

	return resolvedPairs;
}

function formatCetusFarmsPairList(
	pools: Array<{
		poolId: string;
		clmmPoolId: string;
		coinTypeA: string;
		coinTypeB: string;
		pairSymbol: string;
	}>,
): string {
	return pools.map((pool) => `${pool.poolId} (${pool.pairSymbol})`).join(", ");
}

export async function findCetusFarmsPoolsByTokenPair(params: {
	network: CetusV2Network;
	rpcUrl?: string;
	coinTypeA: string;
	coinTypeB: string;
	limit?: number;
}): Promise<CetusFarmsPoolPair[]> {
	const requestedPair = {
		forward: normalizePairKey(params.coinTypeA, params.coinTypeB),
		reverse: normalizePairKey(params.coinTypeB, params.coinTypeA),
	};
	const { pools } = await getCetusFarmsPools({
		network: params.network,
		rpcUrl: params.rpcUrl,
	});
	const clmmPoolIds = pools
		.map((entry) => entry.clmm_pool_id)
		.filter((value) => typeof value === "string" && value.length > 0);
	const pairByClmmPoolId = await resolveCetusFarmsPoolPairs({
		network: params.network,
		rpcUrl: params.rpcUrl,
		clmmPoolIds,
	});

	const requested = new Set([requestedPair.forward, requestedPair.reverse]);
	const poolMatches = pools
		.map((pool) => {
			const pair = pairByClmmPoolId.get(pool.clmm_pool_id);
			if (!pair) return null;
			const poolKey = normalizePairKey(pair.coinTypeA, pair.coinTypeB);
			if (!requested.has(poolKey)) return null;
			return {
				poolId: pool.id,
				clmmPoolId: pool.clmm_pool_id,
				coinTypeA: pair.coinTypeA,
				coinTypeB: pair.coinTypeB,
				pairSymbol: pair.pairSymbol,
			};
		})
		.filter((entry): entry is CetusFarmsPoolPair => Boolean(entry));
	if (typeof params.limit === "number") {
		const safeLimit = Math.max(1, Math.min(200, Math.floor(params.limit)));
		return poolMatches.slice(0, safeLimit);
	}
	return poolMatches;
}

export function formatCetusFarmsPoolPairError(params: {
	coinTypeA: string;
	coinTypeB: string;
	pools: CetusFarmsPoolPair[];
}): string {
	if (params.pools.length === 0) {
		return `No farms pools found for pair ${params.coinTypeA}/${params.coinTypeB}.`;
	}
	const pairSymbol = `${params.coinTypeA}/${params.coinTypeB}`;
	const choices = formatCetusFarmsPairList(params.pools);
	return `${pairSymbol} maps to multiple pools: ${choices}. Please provide poolId.`;
}

export async function getCetusFarmsPools(params: {
	network: CetusV2Network;
	rpcUrl?: string;
}): Promise<{
	pools: FarmsPoolLike[];
	hasNextPage: boolean;
	nextCursor: string | null;
}> {
	const sdk = await createFarmsSDK(params);
	const page = await sdk.Farms.getFarmsPoolList("all");
	const parsed = normalizeDataPage<FarmsPoolLike>(page);
	return {
		pools: parsed.data,
		hasNextPage: parsed.hasNextPage,
		nextCursor: parsed.nextCursor,
	};
}

export async function getCetusFarmsPositions(params: {
	network: CetusV2Network;
	rpcUrl?: string;
	owner: string;
	calculateRewards?: boolean;
}): Promise<{
	positions: FarmsPositionLike[];
	hasNextPage: boolean;
	nextCursor: string | null;
}> {
	const sdk = await createFarmsSDK(params);
	const response = await sdk.Farms.getOwnedFarmsPositionNFTList(
		params.owner,
		[],
		params.calculateRewards !== false,
		"all",
	);
	const asPage = normalizeDataPage<FarmsPositionLike>(response);
	if (asPage.data.length > 0 || !response || typeof response !== "object") {
		return {
			positions: asPage.data,
			hasNextPage: asPage.hasNextPage,
			nextCursor: asPage.nextCursor,
		};
	}
	const map = response as Record<string, FarmsPositionLike[]>;
	const merged = Object.values(map).flatMap((entry) =>
		Array.isArray(entry) ? entry : [],
	);
	return {
		positions: merged,
		hasNextPage: false,
		nextCursor: null,
	};
}

export async function getCetusVaultsBalances(params: {
	network: CetusV2Network;
	rpcUrl?: string;
	owner: string;
}): Promise<VaultBalanceLike[]> {
	const sdk = await createVaultsSDK(params);
	const list = await sdk.Vaults.getOwnerVaultsBalance(params.owner);
	return Array.isArray(list) ? list : [];
}

export async function buildCetusFarmsStakeTransaction(params: {
	network: CetusV2Network;
	rpcUrl?: string;
	sender: string;
	poolId: string;
	clmmPositionId: string;
	clmmPoolId: string;
	coinTypeA: string;
	coinTypeB: string;
}): Promise<Transaction> {
	const sdk = await createFarmsSDK({
		network: params.network,
		rpcUrl: params.rpcUrl,
		sender: params.sender,
	});
	return sdk.Farms.depositPayload({
		pool_id: params.poolId.trim(),
		clmm_position_id: params.clmmPositionId.trim(),
		clmm_pool_id: params.clmmPoolId.trim(),
		coin_type_a: params.coinTypeA.trim(),
		coin_type_b: params.coinTypeB.trim(),
	});
}

export async function buildCetusFarmsUnstakeTransaction(params: {
	network: CetusV2Network;
	rpcUrl?: string;
	sender: string;
	poolId: string;
	positionNftId: string;
}): Promise<Transaction> {
	const sdk = await createFarmsSDK({
		network: params.network,
		rpcUrl: params.rpcUrl,
		sender: params.sender,
	});
	return sdk.Farms.withdrawPayload({
		pool_id: params.poolId.trim(),
		position_nft_id: params.positionNftId.trim(),
	});
}

export async function buildCetusFarmsHarvestTransaction(params: {
	network: CetusV2Network;
	rpcUrl?: string;
	sender: string;
	poolId: string;
	positionNftId: string;
}): Promise<Transaction> {
	const sdk = await createFarmsSDK({
		network: params.network,
		rpcUrl: params.rpcUrl,
		sender: params.sender,
	});
	return sdk.Farms.harvestPayload({
		pool_id: params.poolId.trim(),
		position_nft_id: params.positionNftId.trim(),
	});
}
