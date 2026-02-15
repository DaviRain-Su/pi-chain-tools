import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
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

const SUI_CONFIG_DIR_ENV = "SUI_CONFIG_DIR";
const SUI_KEYSTORE_PATH_ENV = "SUI_KEYSTORE_PATH";
const SUI_CLIENT_CONFIG_PATH_ENV = "SUI_CLIENT_CONFIG_PATH";
const ED25519_FLAG = 0;

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

	return getFullnodeUrl(parsedNetwork);
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

export function getSuiClient(network?: string, rpcUrl?: string): SuiClient {
	const parsedNetwork = parseSuiNetwork(network);
	const endpoint = getSuiRpcEndpoint(parsedNetwork, rpcUrl);
	return new SuiClient({
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

function resolveSuiConfigDir(): string {
	const explicitConfigDir = process.env[SUI_CONFIG_DIR_ENV]?.trim();
	if (explicitConfigDir) return explicitConfigDir;
	return path.join(os.homedir(), ".sui", "sui_config");
}

function resolveSuiClientConfigPath(): string {
	const configDir = resolveSuiConfigDir();
	return (
		process.env[SUI_CLIENT_CONFIG_PATH_ENV]?.trim() ||
		path.join(configDir, "client.yaml")
	);
}

function normalizeAddress(value: string): string {
	const lower = value.trim().toLowerCase();
	return lower.startsWith("0x") ? lower : `0x${lower}`;
}

function parseActiveAddress(clientConfigPath: string): string | null {
	try {
		const content = readFileSync(clientConfigPath, "utf8");
		const matched = content.match(
			/^\s*active_address\s*:\s*["']?(0x[a-fA-F0-9]{1,64})["']?\s*$/m,
		);
		if (!matched?.[1]) return null;
		return normalizeAddress(matched[1]);
	} catch {
		return null;
	}
}

function parseEd25519FromKeyMaterial(
	keyMaterial: Uint8Array,
): Ed25519Keypair | null {
	if (keyMaterial.length === 32) {
		try {
			return Ed25519Keypair.fromSecretKey(keyMaterial);
		} catch {
			return null;
		}
	}
	if (keyMaterial.length === 33 && keyMaterial[0] === ED25519_FLAG) {
		try {
			return Ed25519Keypair.fromSecretKey(keyMaterial.slice(1));
		} catch {
			return null;
		}
	}
	if (keyMaterial.length === 64) {
		try {
			return Ed25519Keypair.fromSecretKey(keyMaterial.slice(0, 32));
		} catch {
			return null;
		}
	}
	return null;
}

function parseEd25519FromStringLike(input: string): Ed25519Keypair | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	if (trimmed.startsWith("suiprivkey")) {
		try {
			const parsed = decodeSuiPrivateKey(trimmed);
			if (parsed.scheme !== "ED25519") return null;
			return Ed25519Keypair.fromSecretKey(parsed.secretKey);
		} catch {
			return null;
		}
	}

	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
		return null;
	}

	try {
		const decoded = Buffer.from(trimmed, "base64");
		return parseEd25519FromKeyMaterial(new Uint8Array(decoded));
	} catch {
		return null;
	}
}

function parseEd25519FromKeystoreEntry(entry: unknown): Ed25519Keypair | null {
	if (typeof entry !== "string") return null;
	return parseEd25519FromStringLike(entry);
}

function resolveSuiKeypairFromLocalKeystore(): Ed25519Keypair | null {
	const configDir = resolveSuiConfigDir();
	const keystorePath =
		process.env[SUI_KEYSTORE_PATH_ENV]?.trim() ||
		path.join(configDir, "sui.keystore");
	const clientConfigPath = resolveSuiClientConfigPath();
	const activeAddress = parseActiveAddress(clientConfigPath);

	try {
		const raw = readFileSync(keystorePath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return null;

		let fallbackKeypair: Ed25519Keypair | null = null;
		for (const entry of parsed) {
			if (typeof entry === "object" && entry && !Array.isArray(entry)) {
				const record = entry as Record<string, unknown>;
				const values = [
					record.secretKey,
					record.privateKey,
					record.private_key,
					record.privKey,
					record.priv_key,
					record.encodedPrivateKey,
					record.value,
				];
				for (const value of values) {
					if (typeof value === "string") {
						const keypair = parseEd25519FromStringLike(value);
						if (keypair) {
							if (!fallbackKeypair) fallbackKeypair = keypair;
							if (activeAddress) {
								const candidateAddress = normalizeAddress(
									keypair.toSuiAddress(),
								);
								if (candidateAddress === activeAddress) {
									return keypair;
								}
								continue;
							}
							break;
						}
					}
				}
				continue;
			}

			const keypair = parseEd25519FromKeystoreEntry(entry);
			if (!keypair) continue;
			if (!fallbackKeypair) fallbackKeypair = keypair;

			if (activeAddress) {
				const candidateAddress = normalizeAddress(keypair.toSuiAddress());
				if (candidateAddress === activeAddress) {
					return keypair;
				}
			}
		}
		return fallbackKeypair;
	} catch {
		return null;
	}
}

export function resolveSuiOwnerAddress(owner?: string): string {
	if (typeof owner === "string" && owner.trim().length > 0) {
		return normalizeAtPath(owner.trim());
	}

	const activeAddress = parseActiveAddress(resolveSuiClientConfigPath());
	if (activeAddress) {
		return activeAddress;
	}

	const envPrivateKey = process.env.SUI_PRIVATE_KEY?.trim();
	if (envPrivateKey) {
		const keypair = resolveSuiKeypair(envPrivateKey);
		return normalizeAddress(keypair.toSuiAddress());
	}

	const fallbackKeypair = resolveSuiKeypairFromLocalKeystore();
	if (fallbackKeypair) {
		return normalizeAddress(fallbackKeypair.toSuiAddress());
	}

	throw new Error(
		"No Sui owner address available. Provide owner, or configure Sui client active-address (client.yaml), or set SUI_PRIVATE_KEY / SUI_KEYSTORE_PATH / ~/.sui/sui_config/sui.keystore.",
	);
}

export function resolveSuiKeypair(privateKey?: string): Ed25519Keypair {
	const key = privateKey?.trim() || process.env.SUI_PRIVATE_KEY?.trim();
	if (!key) {
		const fallbackKeypair = resolveSuiKeypairFromLocalKeystore();
		if (fallbackKeypair) {
			return fallbackKeypair;
		}
		throw new Error(
			"No signer key available. Set fromPrivateKey (suiprivkey...), SUI_PRIVATE_KEY, or configure SUI_KEYSTORE_PATH / ~/.sui/sui_config/sui.keystore with an ED25519 key.",
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
