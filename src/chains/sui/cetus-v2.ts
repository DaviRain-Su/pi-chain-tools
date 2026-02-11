import { createRequire } from "node:module";
import type { Transaction } from "@mysten/sui/transactions";
import { type SuiNetwork, getSuiRpcEndpoint } from "./runtime.js";

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
