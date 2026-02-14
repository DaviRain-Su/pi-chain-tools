import { callNearRpc, parseNearNetwork } from "./runtime.js";

export type BurrowNetwork = "mainnet" | "testnet";

type NearCallFunctionResult = {
	result: number[];
	logs: string[];
	block_height: number;
	block_hash: string;
};

export type BurrowAssetPoolView = {
	shares: string;
	balance: string;
};

export type BurrowAssetConfigView = {
	reserve_ratio?: number;
	target_utilization?: number;
	target_utilization_rate?: string;
	max_utilization_rate?: string;
	holding_position_fee_rate?: string;
	volatility_ratio?: number;
	extra_decimals?: number;
	can_deposit?: boolean;
	can_withdraw?: boolean;
	can_use_as_collateral?: boolean;
	can_borrow?: boolean;
	net_tvl_multiplier?: number;
	max_change_rate?: number | null;
	supplied_limit?: string | null;
	borrowed_limit?: string | null;
	min_borrowed_amount?: string | null;
};

export type BurrowAssetDetailedView = {
	token_id: string;
	supplied: BurrowAssetPoolView;
	borrowed: BurrowAssetPoolView;
	margin_debt?: BurrowAssetPoolView;
	margin_pending_debt?: string;
	margin_position?: string;
	reserved?: string;
	prot_fee?: string;
	beneficiary_fees?: Record<string, string>;
	uahpi?: string;
	last_update_timestamp?: string;
	config: BurrowAssetConfigView;
	lostfound_shares?: string;
	supply_apr?: string;
	borrow_apr?: string;
	farms?: unknown[];
};

export type BurrowAccountAssetView = {
	token_id: string;
	balance: string;
	shares: string;
	apr?: string;
};

export type BurrowAccountPositionView = {
	collateral?: BurrowAccountAssetView[];
	borrowed?: BurrowAccountAssetView[];
};

export type BurrowAccountAllPositionsView = {
	account_id: string;
	supplied?: BurrowAccountAssetView[];
	positions?: Record<string, BurrowAccountPositionView>;
	farms?: unknown[];
	has_non_farmed_assets?: boolean;
	booster_staking?: unknown;
	booster_stakings?: Record<string, unknown>;
	is_locked?: boolean;
};

const DEFAULT_BURROW_CONTRACT_BY_NETWORK: Record<BurrowNetwork, string> = {
	mainnet: "contract.main.burrow.near",
	testnet: "contract.beta.burrow.testnet",
};

const BURROW_CONTRACT_ENV_BY_NETWORK: Record<BurrowNetwork, string> = {
	mainnet: "NEAR_BURROW_MAINNET_CONTRACT_ID",
	testnet: "NEAR_BURROW_TESTNET_CONTRACT_ID",
};

const DEFAULT_BURROW_TOKEN_MAP_BY_NETWORK: Record<
	BurrowNetwork,
	Record<string, string[]>
> = {
	mainnet: {
		NEAR: ["wrap.near"],
		WNEAR: ["wrap.near"],
		USDC: [
			"a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
			"usdc.tether-token.near",
		],
		USDT: [
			"dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near",
			"usdt.tether-token.near",
		],
		WBTC: ["2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near"],
		WETH: ["aurora"],
		AURORA: ["aurora"],
		BURROW: ["token.burrow.near"],
	},
	testnet: {
		NEAR: ["wrap.testnet"],
		WNEAR: ["wrap.testnet"],
		USDC: ["usdc.fakes.near"],
		USDT: ["usdt.fakes.near"],
		BURROW: ["token.burrow.testnet"],
	},
};

function parseUnsignedBigInt(value: string, fieldName: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	return BigInt(normalized);
}

function parseNonNegativeInteger(
	value: number | undefined,
	fieldName: string,
	defaultValue: number,
): number {
	if (value == null) return defaultValue;
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		throw new Error(`${fieldName} must be a non-negative integer`);
	}
	return value;
}

function encodeNearCallArgs(args: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(args), "utf8").toString("base64");
}

function decodeNearCallResultJson<T>(payload: NearCallFunctionResult): T {
	if (!Array.isArray(payload.result)) {
		throw new Error("Invalid call_function result payload");
	}
	const utf8 = Buffer.from(Uint8Array.from(payload.result)).toString("utf8");
	if (!utf8.trim()) {
		throw new Error("call_function returned empty payload");
	}
	return JSON.parse(utf8) as T;
}

function normalizeTokenInput(value: string): string {
	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		throw new Error("tokenId is required");
	}
	return normalized;
}

export function getBurrowContractId(
	network?: string,
	contractIdOverride?: string,
): string {
	const explicit = contractIdOverride?.trim();
	if (explicit) return explicit;

	const parsedNetwork = parseNearNetwork(network) as BurrowNetwork;
	const networkEnv =
		process.env[BURROW_CONTRACT_ENV_BY_NETWORK[parsedNetwork]]?.trim();
	if (networkEnv) return networkEnv;
	const globalEnv = process.env.NEAR_BURROW_CONTRACT_ID?.trim();
	if (globalEnv) return globalEnv;
	return DEFAULT_BURROW_CONTRACT_BY_NETWORK[parsedNetwork];
}

export async function fetchBurrowAssetsPagedDetailed(params: {
	network?: string;
	rpcUrl?: string;
	burrowContractId?: string;
	fromIndex?: number;
	limit?: number;
}): Promise<BurrowAssetDetailedView[]> {
	const network = parseNearNetwork(params.network);
	const burrowContractId = getBurrowContractId(
		network,
		params.burrowContractId,
	);
	const fromIndex = parseNonNegativeInteger(params.fromIndex, "fromIndex", 0);
	const limit = parseNonNegativeInteger(params.limit, "limit", 50);
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network,
		rpcUrl: params.rpcUrl,
		params: {
			request_type: "call_function",
			account_id: burrowContractId,
			method_name: "get_assets_paged_detailed",
			args_base64: encodeNearCallArgs({
				from_index: fromIndex,
				limit,
			}),
			finality: "final",
		},
	});
	const decoded = decodeNearCallResultJson<unknown[]>(result);
	if (!Array.isArray(decoded)) {
		throw new Error(
			"Burrow get_assets_paged_detailed returned invalid payload",
		);
	}
	return decoded as BurrowAssetDetailedView[];
}

export async function fetchBurrowAsset(params: {
	network?: string;
	rpcUrl?: string;
	burrowContractId?: string;
	tokenId: string;
}): Promise<BurrowAssetDetailedView | null> {
	const network = parseNearNetwork(params.network);
	const burrowContractId = getBurrowContractId(
		network,
		params.burrowContractId,
	);
	const tokenId = normalizeTokenInput(params.tokenId);
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network,
		rpcUrl: params.rpcUrl,
		params: {
			request_type: "call_function",
			account_id: burrowContractId,
			method_name: "get_asset",
			args_base64: encodeNearCallArgs({ token_id: tokenId }),
			finality: "final",
		},
	});
	const decoded = decodeNearCallResultJson<unknown>(result);
	if (decoded == null) return null;
	if (typeof decoded !== "object") {
		throw new Error("Burrow get_asset returned invalid payload");
	}
	return decoded as BurrowAssetDetailedView;
}

export async function fetchBurrowAccountAllPositions(params: {
	network?: string;
	rpcUrl?: string;
	burrowContractId?: string;
	accountId: string;
}): Promise<BurrowAccountAllPositionsView | null> {
	const network = parseNearNetwork(params.network);
	const burrowContractId = getBurrowContractId(
		network,
		params.burrowContractId,
	);
	const accountId = params.accountId.trim();
	if (!accountId) {
		throw new Error("accountId is required");
	}
	const result = await callNearRpc<NearCallFunctionResult>({
		method: "query",
		network,
		rpcUrl: params.rpcUrl,
		params: {
			request_type: "call_function",
			account_id: burrowContractId,
			method_name: "get_account_all_positions",
			args_base64: encodeNearCallArgs({ account_id: accountId }),
			finality: "final",
		},
	});
	const decoded = decodeNearCallResultJson<unknown>(result);
	if (decoded == null) return null;
	if (typeof decoded !== "object") {
		throw new Error(
			"Burrow get_account_all_positions returned invalid payload",
		);
	}
	return decoded as BurrowAccountAllPositionsView;
}

export function parseBurrowExtraDecimals(value: unknown): number {
	if (
		!Number.isInteger(value) ||
		(value as number) < 0 ||
		(value as number) > 36
	) {
		return 0;
	}
	return value as number;
}

export function toBurrowInnerAmount(
	rawAmount: string,
	extraDecimals: number,
): string {
	const rawValue = parseUnsignedBigInt(rawAmount, "amountRaw");
	if (rawValue <= 0n) {
		throw new Error("amountRaw must be greater than 0");
	}
	const extra = parseBurrowExtraDecimals(extraDecimals);
	if (extra <= 0) return rawValue.toString();
	return (rawValue * 10n ** BigInt(extra)).toString();
}

export function fromBurrowInnerAmount(
	innerAmount: string,
	extraDecimals: number,
): string {
	const inner = parseUnsignedBigInt(innerAmount, "innerAmount");
	const extra = parseBurrowExtraDecimals(extraDecimals);
	if (extra <= 0) return inner.toString();
	return (inner / 10n ** BigInt(extra)).toString();
}

export function resolveBurrowTokenId(params: {
	network?: string;
	tokenInput: string;
	availableTokenIds?: string[];
}): string {
	const network = parseNearNetwork(params.network) as BurrowNetwork;
	const tokenInput = normalizeTokenInput(params.tokenInput);
	const availableTokenIds = Array.isArray(params.availableTokenIds)
		? params.availableTokenIds.map((token) => token.trim().toLowerCase())
		: [];
	const availableSet = new Set(availableTokenIds);
	if (availableSet.has(tokenInput)) return tokenInput;
	if (tokenInput.includes(".") || tokenInput.includes(":")) {
		if (availableSet.size === 0 || availableSet.has(tokenInput)) {
			return tokenInput;
		}
		throw new Error(`Token is not listed in Burrow markets: ${tokenInput}`);
	}
	const symbolKey = tokenInput.toUpperCase();
	const mapped = DEFAULT_BURROW_TOKEN_MAP_BY_NETWORK[network][symbolKey] ?? [];
	if (mapped.length > 0) {
		const normalizedMapped = mapped.map((tokenId) => tokenId.toLowerCase());
		if (availableSet.size === 0) {
			return normalizedMapped[0];
		}
		for (const candidate of normalizedMapped) {
			if (availableSet.has(candidate)) return candidate;
		}
	}
	if (availableSet.size > 0) {
		throw new Error(
			`Cannot resolve token '${params.tokenInput}'. Provide an explicit tokenId from Burrow markets.`,
		);
	}
	return tokenInput;
}

export async function fetchBurrowAssetsIndex(params: {
	network?: string;
	rpcUrl?: string;
	burrowContractId?: string;
	maxAssets?: number;
	pageSize?: number;
}): Promise<BurrowAssetDetailedView[]> {
	const maxAssets = parseNonNegativeInteger(params.maxAssets, "maxAssets", 200);
	if (maxAssets === 0) return [];
	const pageSize = Math.max(
		1,
		parseNonNegativeInteger(params.pageSize, "pageSize", 50),
	);
	const assets: BurrowAssetDetailedView[] = [];
	let fromIndex = 0;
	while (assets.length < maxAssets) {
		const page = await fetchBurrowAssetsPagedDetailed({
			network: params.network,
			rpcUrl: params.rpcUrl,
			burrowContractId: params.burrowContractId,
			fromIndex,
			limit: Math.min(pageSize, maxAssets - assets.length),
		});
		if (page.length === 0) break;
		assets.push(...page);
		if (page.length < pageSize) break;
		fromIndex += page.length;
	}
	return assets;
}

export function parseBurrowActionAmountRaw(
	value: string,
	fieldName: string,
): string {
	const amount = parseUnsignedBigInt(value, fieldName);
	if (amount <= 0n) {
		throw new Error(`${fieldName} must be greater than 0`);
	}
	return amount.toString();
}
