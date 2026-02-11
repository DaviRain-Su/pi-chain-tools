import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Type } from "@sinclair/typebox";

export type SuiNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

export const SUI_TOOL_PREFIX = "sui_";
export const SUI_COIN_TYPE = "0x2::sui::SUI";
const MIST_PER_SUI = 1_000_000_000;
const DEFAULT_NETWORK: SuiNetwork = "mainnet";

const SUI_RPC_ENV_BY_NETWORK: Record<SuiNetwork, string> = {
	mainnet: "SUI_MAINNET_RPC_URL",
	testnet: "SUI_TESTNET_RPC_URL",
	devnet: "SUI_DEVNET_RPC_URL",
	localnet: "SUI_LOCALNET_RPC_URL",
};

const SUI_EXPLORER_ORIGIN: Record<Exclude<SuiNetwork, "localnet">, string> = {
	mainnet: "https://suivision.xyz",
	testnet: "https://testnet.suivision.xyz",
	devnet: "https://devnet.suivision.xyz",
};

export function suiNetworkSchema() {
	return Type.Optional(
		Type.Union([
			Type.Literal("mainnet"),
			Type.Literal("testnet"),
			Type.Literal("devnet"),
			Type.Literal("localnet"),
		]),
	);
}

export function normalizeAtPath(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

export function parseSuiNetwork(value?: string): SuiNetwork {
	if (
		value === "mainnet" ||
		value === "testnet" ||
		value === "devnet" ||
		value === "localnet"
	) {
		return value;
	}
	if (value === "mainnet-beta") {
		return "mainnet";
	}
	return DEFAULT_NETWORK;
}

export function getSuiRpcEndpoint(network?: string, rpcUrl?: string): string {
	const explicitRpcUrl = rpcUrl?.trim();
	if (explicitRpcUrl) return explicitRpcUrl;

	const parsedNetwork = parseSuiNetwork(network);
	const networkEnv = process.env[SUI_RPC_ENV_BY_NETWORK[parsedNetwork]]?.trim();
	if (networkEnv) return networkEnv;

	const fallbackEnv = process.env.SUI_RPC_URL?.trim();
	if (fallbackEnv) return fallbackEnv;

	return getJsonRpcFullnodeUrl(parsedNetwork);
}

export function getSuiExplorerTransactionUrl(
	digest: string,
	network?: string,
): string | null {
	const parsedNetwork = parseSuiNetwork(network);
	if (parsedNetwork === "localnet") {
		return null;
	}
	const origin = SUI_EXPLORER_ORIGIN[parsedNetwork];
	return `${origin}/txblock/${encodeURIComponent(digest)}`;
}

export function getSuiClient(
	network?: string,
	rpcUrl?: string,
): SuiJsonRpcClient {
	const parsedNetwork = parseSuiNetwork(network);
	const endpoint = getSuiRpcEndpoint(parsedNetwork, rpcUrl);
	return new SuiJsonRpcClient({
		network: parsedNetwork,
		url: endpoint,
	});
}

export function assertPositiveAmount(amountSui: number): void {
	if (!Number.isFinite(amountSui) || amountSui <= 0) {
		throw new Error("amountSui must be a positive number");
	}
}

export function toMist(amountSui: number): bigint {
	assertPositiveAmount(amountSui);
	const mist = amountSui * MIST_PER_SUI;
	const rounded = Math.round(mist);
	if (!Number.isSafeInteger(rounded)) {
		throw new Error("amountSui is too large");
	}
	if (Math.abs(mist - rounded) > 1e-6) {
		throw new Error("amountSui supports up to 9 decimal places");
	}
	return BigInt(rounded);
}

export function parsePositiveBigInt(
	value: string | number | bigint,
	fieldName = "amount",
): bigint {
	let normalized: string;
	if (typeof value === "bigint") {
		normalized = value.toString();
	} else if (typeof value === "number") {
		if (!Number.isFinite(value) || !Number.isInteger(value)) {
			throw new Error(`${fieldName} must be an integer`);
		}
		normalized = value.toString();
	} else {
		normalized = value.trim();
	}

	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an integer string`);
	}

	const parsed = BigInt(normalized);
	if (parsed <= 0n) {
		throw new Error(`${fieldName} must be greater than 0`);
	}
	return parsed;
}

export function formatCoinAmount(rawAmount: string, decimals: number): string {
	const normalized = rawAmount.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error("rawAmount must be an integer string");
	}
	const amount = BigInt(normalized);
	const base = 10n ** BigInt(decimals);
	const whole = amount / base;
	const fractionRaw = amount % base;
	if (fractionRaw === 0n) {
		return whole.toString();
	}
	const fraction = fractionRaw
		.toString()
		.padStart(decimals, "0")
		.replace(/0+$/, "");
	return `${whole.toString()}.${fraction}`;
}

export function resolveSuiKeypair(privateKey?: string): Ed25519Keypair {
	const key = privateKey?.trim() || process.env.SUI_PRIVATE_KEY?.trim();
	if (!key) {
		throw new Error(
			"No Sui private key provided. Set fromPrivateKey or SUI_PRIVATE_KEY (suiprivkey...).",
		);
	}

	const parsed = decodeSuiPrivateKey(key);
	if (parsed.scheme !== "ED25519") {
		throw new Error(
			`Unsupported Sui key scheme: ${parsed.scheme}. Only ED25519 is supported.`,
		);
	}

	return Ed25519Keypair.fromSecretKey(parsed.secretKey);
}
