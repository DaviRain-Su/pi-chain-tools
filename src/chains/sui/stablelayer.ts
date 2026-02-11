import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SuiNetwork } from "./runtime.js";

export type StableLayerNetwork = "mainnet" | "testnet";

export const STABLE_LAYER_DEFAULT_USDC_COIN_TYPE =
	"0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

const DUMMY_SENDER =
	"0x0000000000000000000000000000000000000000000000000000000000000000";

type StableLayerClientLike = {
	buildMintTx(args: {
		tx: unknown;
		stableCoinType: string;
		usdcCoin: unknown;
		sender?: string;
		autoTransfer?: boolean;
	}): Promise<unknown>;
	buildBurnTx(args: {
		tx: unknown;
		stableCoinType: string;
		amount?: bigint;
		all?: boolean;
		sender?: string;
		autoTransfer?: boolean;
	}): Promise<unknown>;
	buildClaimTx(args: {
		tx: unknown;
		stableCoinType: string;
		sender?: string;
		autoTransfer?: boolean;
	}): Promise<unknown>;
	getTotalSupply(): Promise<string | undefined>;
	getTotalSupplyByCoinType(coinType: string): Promise<string | undefined>;
};

type StableLayerClientCtor = new (config: {
	network: StableLayerNetwork;
	sender: string;
}) => StableLayerClientLike;

let cachedStableLayerClientCtor: StableLayerClientCtor | null = null;

function parseStableLayerCtor(
	moduleValue: unknown,
): StableLayerClientCtor | null {
	if (!moduleValue || typeof moduleValue !== "object") return null;
	const candidate = (
		moduleValue as {
			StableLayerClient?: unknown;
		}
	).StableLayerClient;
	return typeof candidate === "function"
		? (candidate as StableLayerClientCtor)
		: null;
}

async function getStableLayerClientCtor(): Promise<StableLayerClientCtor> {
	if (cachedStableLayerClientCtor) return cachedStableLayerClientCtor;
	const moduleValue = await import("stable-layer-sdk");
	const ctor = parseStableLayerCtor(moduleValue);
	if (!ctor) {
		throw new Error(
			"Failed to load stable-layer-sdk: StableLayerClient export was not found.",
		);
	}
	cachedStableLayerClientCtor = ctor;
	return ctor;
}

export function resolveStableLayerNetwork(
	network: SuiNetwork,
): StableLayerNetwork {
	if (network === "mainnet" || network === "testnet") return network;
	throw new Error(
		"Stable Layer currently supports network=mainnet or testnet.",
	);
}

async function createStableLayerClient(
	network: StableLayerNetwork,
	sender: string,
): Promise<StableLayerClientLike> {
	const StableLayerClient = await getStableLayerClientCtor();
	return new StableLayerClient({
		network,
		sender,
	});
}

export async function getStableLayerSupply(params: {
	network: StableLayerNetwork;
	stableCoinType?: string;
	sender?: string;
}): Promise<{
	totalSupply: string | null;
	coinTypeSupply: string | null;
}> {
	const sender = params.sender?.trim() || DUMMY_SENDER;
	const client = await createStableLayerClient(params.network, sender);
	const totalSupply = (await client.getTotalSupply()) ?? null;
	if (!params.stableCoinType?.trim()) {
		return {
			totalSupply,
			coinTypeSupply: null,
		};
	}
	const coinTypeSupply =
		(await client.getTotalSupplyByCoinType(params.stableCoinType.trim())) ??
		null;
	return {
		totalSupply,
		coinTypeSupply,
	};
}

export async function buildStableLayerMintTransaction(params: {
	network: StableLayerNetwork;
	sender: string;
	stableCoinType: string;
	amountUsdcRaw: bigint;
	usdcCoinType?: string;
	autoTransfer?: boolean;
	tx?: Transaction;
}): Promise<Transaction> {
	const tx = params.tx ?? new Transaction();
	const client = await createStableLayerClient(params.network, params.sender);
	const usdcCoinType =
		params.usdcCoinType?.trim() || STABLE_LAYER_DEFAULT_USDC_COIN_TYPE;
	const usdcCoin = coinWithBalance({
		balance: params.amountUsdcRaw,
		type: usdcCoinType,
	})(tx);
	await client.buildMintTx({
		tx: tx as unknown,
		stableCoinType: params.stableCoinType.trim(),
		usdcCoin: usdcCoin as unknown,
		sender: params.sender,
		autoTransfer: params.autoTransfer !== false,
	});
	return tx;
}

export async function buildStableLayerBurnTransaction(params: {
	network: StableLayerNetwork;
	sender: string;
	stableCoinType: string;
	amountStableRaw?: bigint;
	burnAll?: boolean;
	autoTransfer?: boolean;
	tx?: Transaction;
}): Promise<Transaction> {
	const tx = params.tx ?? new Transaction();
	const client = await createStableLayerClient(params.network, params.sender);
	const burnAll = params.burnAll === true;
	if (!burnAll && params.amountStableRaw == null) {
		throw new Error("amountStableRaw is required unless burnAll=true.");
	}
	await client.buildBurnTx({
		tx: tx as unknown,
		stableCoinType: params.stableCoinType.trim(),
		amount: params.amountStableRaw,
		all: burnAll,
		sender: params.sender,
		autoTransfer: params.autoTransfer !== false,
	});
	return tx;
}

export async function buildStableLayerClaimTransaction(params: {
	network: StableLayerNetwork;
	sender: string;
	stableCoinType: string;
	autoTransfer?: boolean;
	tx?: Transaction;
}): Promise<Transaction> {
	const tx = params.tx ?? new Transaction();
	const client = await createStableLayerClient(params.network, params.sender);
	await client.buildClaimTx({
		tx: tx as unknown,
		stableCoinType: params.stableCoinType.trim(),
		sender: params.sender,
		autoTransfer: params.autoTransfer !== false,
	});
	return tx;
}
