import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { KeyPairSigner, type KeyPairString } from "near-api-js";

export type NearNetwork = "mainnet" | "testnet";

export const NEAR_TOOL_PREFIX = "near_";

const DEFAULT_NETWORK: NearNetwork = "mainnet";
const YOCTO_PER_NEAR = 10n ** 24n;
const DEFAULT_FRACTION_DIGITS = 6;
const DEFAULT_NETWORK_FRACTION_DIGITS = 24;

const NEAR_RPC_ENV_BY_NETWORK: Record<NearNetwork, string> = {
	mainnet: "NEAR_MAINNET_RPC_URL",
	testnet: "NEAR_TESTNET_RPC_URL",
};

const NEAR_RPC_URLS_ENV_BY_NETWORK: Record<NearNetwork, string> = {
	mainnet: "NEAR_MAINNET_RPC_URLS",
	testnet: "NEAR_TESTNET_RPC_URLS",
};

const NEAR_DEFAULT_RPC_BY_NETWORK: Record<NearNetwork, string> = {
	mainnet: "https://rpc.mainnet.near.org",
	testnet: "https://rpc.testnet.near.org",
};

const NEAR_EXPLORER_ORIGIN_BY_NETWORK: Record<NearNetwork, string> = {
	mainnet: "https://nearblocks.io",
	testnet: "https://testnet.nearblocks.io",
};

const NEAR_ACCOUNT_ID_ENV = "NEAR_ACCOUNT_ID";
const NEAR_WALLET_ACCOUNT_ID_ENV = "NEAR_WALLET_ACCOUNT_ID";
const NEAR_PRIVATE_KEY_ENV = "NEAR_PRIVATE_KEY";
const NEAR_CREDENTIALS_DIR_ENV = "NEAR_CREDENTIALS_DIR";

type NearRpcErrorPayload = {
	code?: number;
	message?: string;
	data?: unknown;
};

type NearRpcResponse<T> = {
	result?: T;
	error?: NearRpcErrorPayload;
};

export function nearNetworkSchema() {
	return Type.Optional(
		Type.Union([Type.Literal("mainnet"), Type.Literal("testnet")]),
	);
}

export function normalizeAtPath(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

export function parseNearNetwork(value?: string): NearNetwork {
	if (value === "mainnet" || value === "testnet") {
		return value;
	}
	if (value === "mainnet-beta") {
		return "mainnet";
	}
	return DEFAULT_NETWORK;
}

function parseRpcUrlList(value?: string): string[] {
	if (!value) return [];
	return value
		.split(/[\n,;]/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

export function getNearRpcEndpoints(
	network?: string,
	rpcUrl?: string,
): string[] {
	const explicitRpcUrl = rpcUrl?.trim();
	if (explicitRpcUrl) {
		return [explicitRpcUrl];
	}

	const parsedNetwork = parseNearNetwork(network);
	const networkListEnv = parseRpcUrlList(
		process.env[NEAR_RPC_URLS_ENV_BY_NETWORK[parsedNetwork]],
	);
	if (networkListEnv.length > 0) {
		return networkListEnv;
	}

	const fallbackListEnv = parseRpcUrlList(process.env.NEAR_RPC_URLS);
	if (fallbackListEnv.length > 0) {
		return fallbackListEnv;
	}

	const networkEnv =
		process.env[NEAR_RPC_ENV_BY_NETWORK[parsedNetwork]]?.trim();
	if (networkEnv) {
		return [networkEnv];
	}

	const fallbackEnv = process.env.NEAR_RPC_URL?.trim();
	if (fallbackEnv) {
		return [fallbackEnv];
	}

	return [NEAR_DEFAULT_RPC_BY_NETWORK[parsedNetwork]];
}

export function getNearRpcEndpoint(network?: string, rpcUrl?: string): string {
	return getNearRpcEndpoints(network, rpcUrl)[0] as string;
}

function parseUnsignedBigInt(
	value: string | bigint,
	fieldName: string,
): bigint {
	const normalized =
		typeof value === "bigint" ? value.toString() : value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${fieldName} must be an unsigned integer string`);
	}
	return BigInt(normalized);
}

function parseScaledDecimalToBigInt(
	value: string,
	scale: number,
	fieldName: string,
): bigint {
	const normalized = value.trim();
	if (!/^\d+(\.\d+)?$/.test(normalized)) {
		throw new Error(`${fieldName} must be a positive decimal number`);
	}
	const [wholePart, fractionPart = ""] = normalized.split(".");
	if (fractionPart.length > scale) {
		throw new Error(`${fieldName} supports up to ${scale} decimal places`);
	}
	const whole = BigInt(wholePart);
	const fraction = fractionPart.padEnd(scale, "0");
	const fractionValue = fraction ? BigInt(fraction) : 0n;
	return whole * 10n ** BigInt(scale) + fractionValue;
}

function clampFractionDigits(value: number, max: number): number {
	if (!Number.isFinite(value)) return max;
	const rounded = Math.floor(value);
	if (rounded < 0) return 0;
	if (rounded > max) return max;
	return rounded;
}

export function formatTokenAmount(
	rawAmount: string | bigint,
	decimals: number,
	maxFractionDigits = DEFAULT_FRACTION_DIGITS,
): string {
	const parsedAmount = parseUnsignedBigInt(rawAmount, "rawAmount");
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
		throw new Error("decimals must be an integer between 0 and 255");
	}

	const base = 10n ** BigInt(decimals);
	const whole = parsedAmount / base;
	const fractionRaw = parsedAmount % base;
	if (fractionRaw === 0n) {
		return whole.toString();
	}

	const fractionDigits = clampFractionDigits(maxFractionDigits, decimals);
	let fraction = fractionRaw.toString().padStart(decimals, "0");
	if (fractionDigits < decimals) {
		fraction = fraction.slice(0, fractionDigits);
	}
	fraction = fraction.replace(/0+$/, "");
	if (!fraction) {
		return whole.toString();
	}
	return `${whole.toString()}.${fraction}`;
}

export function formatNearAmount(
	yoctoNear: string | bigint,
	maxFractionDigits = DEFAULT_FRACTION_DIGITS,
): string {
	const fractionDigits = clampFractionDigits(
		maxFractionDigits,
		DEFAULT_NETWORK_FRACTION_DIGITS,
	);
	return formatTokenAmount(
		yoctoNear,
		DEFAULT_NETWORK_FRACTION_DIGITS,
		fractionDigits,
	);
}

export function toYoctoNear(amountNear: string | number): bigint {
	if (typeof amountNear === "number") {
		if (!Number.isFinite(amountNear) || amountNear <= 0) {
			throw new Error("amountNear must be a positive number");
		}
		const textValue = amountNear.toFixed(DEFAULT_NETWORK_FRACTION_DIGITS);
		return parseScaledDecimalToBigInt(
			textValue,
			DEFAULT_NETWORK_FRACTION_DIGITS,
			"amountNear",
		);
	}
	return parseScaledDecimalToBigInt(
		amountNear,
		DEFAULT_NETWORK_FRACTION_DIGITS,
		"amountNear",
	);
}

/**
 * Resolve NEAR credentials directory.
 *
 * Discovery order:
 * 1. Explicit env: NEAR_CREDENTIALS_DIR
 * 2. near-cli-rs / near-cli v4+: ~/.near-credentials/
 * 3. near-cli legacy (v3): ~/.near/credentials/
 *
 * Returns the first existing directory, or falls back to ~/.near-credentials/
 */
function resolveNearCredentialsDir(): string {
	const explicit = process.env[NEAR_CREDENTIALS_DIR_ENV]?.trim();
	if (explicit) {
		return explicit;
	}

	// near-cli-rs / near-cli v4+
	const primaryDir = path.join(os.homedir(), ".near-credentials");
	if (existsSync(primaryDir)) {
		return primaryDir;
	}

	// near-cli legacy (v3 and earlier)
	const legacyDir = path.join(os.homedir(), ".near", "credentials");
	if (existsSync(legacyDir)) {
		return legacyDir;
	}

	// Fallback (will fail gracefully downstream)
	return primaryDir;
}

/**
 * Check if NEAR CLI credentials are available on this machine.
 * Returns a diagnostic object for user-facing messages.
 */
export function checkNearCliCredentials(network?: string): {
	found: boolean;
	credentialsDir: string;
	accountId: string | null;
	hasPrivateKey: boolean;
	nearCliInstalled: boolean;
	hint: string;
} {
	const parsedNetwork = parseNearNetwork(network);
	const credentialsDir = resolveNearCredentialsDir();
	const dirExists = existsSync(credentialsDir);
	const networkDir = path.join(credentialsDir, parsedNetwork);
	const networkDirExists = existsSync(networkDir);

	// Check if near-cli binary is available
	let nearCliInstalled = false;
	try {
		execFileSync("near", ["--version"], {
			stdio: "pipe",
			timeout: 5_000,
		});
		nearCliInstalled = true;
	} catch {
		// near CLI not found
	}

	if (!dirExists || !networkDirExists) {
		const installHint = nearCliInstalled
			? `near-cli is installed but no credentials found for ${parsedNetwork}.\nRun (near-cli-rs): near account import-account using-web-wallet\nOr import key directly: near account import-account using-private-key ed25519:...\n(Legacy near-cli users can also run: near login)`
			: `No NEAR credentials found.\n\nTo get started (recommended near-cli-rs):\n  1. Install near-cli-rs\n  2. Import via web wallet:  near account import-account using-web-wallet\n  3. Or import existing key:  near account import-account using-private-key ed25519:...\n\nCredentials will be saved to ${credentialsDir}/${parsedNetwork}/`;

		return {
			found: false,
			credentialsDir,
			accountId: null,
			hasPrivateKey: false,
			nearCliInstalled,
			hint: installHint,
		};
	}

	const accountId = findAccountIdFromCredentials(parsedNetwork);
	let hasPrivateKey = false;
	if (accountId) {
		const credPath = resolveCredentialPathForAccount(accountId, parsedNetwork);
		if (credPath) {
			hasPrivateKey = findPrivateKeyFromCredentialFile(credPath) !== null;
		}
	}

	if (!accountId) {
		return {
			found: false,
			credentialsDir,
			accountId: null,
			hasPrivateKey: false,
			nearCliInstalled,
			hint: `Credentials directory exists (${networkDir}) but no account files found.\nRun (near-cli-rs): near account import-account using-web-wallet\n(or legacy near-cli: near login)`,
		};
	}

	return {
		found: true,
		credentialsDir,
		accountId,
		hasPrivateKey,
		nearCliInstalled,
		hint: hasPrivateKey
			? `Account ${accountId} ready (credentials at ${credentialsDir}/${parsedNetwork}/)`
			: `Account ${accountId} found but no private key. Re-import with: near account import-account using-private-key ed25519:... --account-id ${accountId}`,
	};
}

type NearCredentialEntry = {
	accountId: string | null;
	privateKey: string | null;
};

function parseCredentialEntry(filePath: string): NearCredentialEntry {
	const fileName = path.basename(filePath);
	if (!fileName.endsWith(".json")) {
		return {
			accountId: null,
			privateKey: null,
		};
	}

	const fallbackFromName = fileName.slice(0, -".json".length).trim();
	try {
		const raw = readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as {
			account_id?: unknown;
			private_key?: unknown;
			secret_key?: unknown;
		};
		const accountId =
			typeof parsed.account_id === "string" && parsed.account_id.trim()
				? parsed.account_id.trim()
				: fallbackFromName || null;
		const privateKeyCandidate =
			typeof parsed.private_key === "string"
				? parsed.private_key.trim()
				: typeof parsed.secret_key === "string"
					? parsed.secret_key.trim()
					: "";
		const privateKey = privateKeyCandidate || null;
		return {
			accountId,
			privateKey,
		};
	} catch {
		return {
			accountId: fallbackFromName || null,
			privateKey: null,
		};
	}
}

function findAccountIdFromCredentialFile(filePath: string): string | null {
	const parsed = parseCredentialEntry(filePath);
	return parsed.accountId;
}

function findPrivateKeyFromCredentialFile(filePath: string): string | null {
	const parsed = parseCredentialEntry(filePath);
	return parsed.privateKey;
}

function resolveCredentialPathForAccount(
	accountId: string,
	network: NearNetwork,
): string | null {
	const credentialsDir = resolveNearCredentialsDir();
	const networkDir = path.join(credentialsDir, network);
	const directFilePath = path.join(networkDir, `${accountId}.json`);
	if (existsSync(directFilePath)) {
		const parsed = parseCredentialEntry(directFilePath);
		if (parsed.accountId || parsed.privateKey) {
			return directFilePath;
		}
	}

	let entries: { isFile(): boolean; name: string }[];
	try {
		entries = readdirSync(networkDir, {
			encoding: "utf8",
			withFileTypes: true,
		});
	} catch {
		return null;
	}

	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		const filePath = path.join(networkDir, entry.name);
		const parsed = parseCredentialEntry(filePath);
		if (parsed.accountId === accountId) {
			return filePath;
		}
	}
	return null;
}

function findAccountIdFromCredentials(network: NearNetwork): string | null {
	const credentialsDir = resolveNearCredentialsDir();
	const networkDir = path.join(credentialsDir, network);
	let entries: { isFile(): boolean; name: string }[];
	try {
		entries = readdirSync(networkDir, {
			encoding: "utf8",
			withFileTypes: true,
		});
	} catch {
		return null;
	}

	const sortedEntries = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right));

	for (const fileName of sortedEntries) {
		const accountId = findAccountIdFromCredentialFile(
			path.join(networkDir, fileName),
		);
		if (accountId) {
			return accountId;
		}
	}

	return null;
}

function normalizeNearAccountId(accountId: string): string {
	const normalized = normalizeAtPath(accountId.trim());
	if (!normalized) {
		throw new Error("accountId cannot be empty");
	}
	return normalized;
}

function normalizeNearPrivateKey(privateKey: string): string {
	const normalized = privateKey.trim();
	if (!normalized) {
		throw new Error("privateKey cannot be empty");
	}
	if (!normalized.startsWith("ed25519:")) {
		throw new Error(
			"Unsupported NEAR private key format. Expected ed25519:...",
		);
	}
	return normalized;
}

export function resolveNearAccountId(
	accountId?: string,
	network?: string,
): string {
	if (typeof accountId === "string" && accountId.trim()) {
		return normalizeNearAccountId(accountId);
	}

	const envAccountId = process.env[NEAR_ACCOUNT_ID_ENV]?.trim();
	if (envAccountId) {
		return normalizeNearAccountId(envAccountId);
	}

	const envWalletAccountId = process.env[NEAR_WALLET_ACCOUNT_ID_ENV]?.trim();
	if (envWalletAccountId) {
		return normalizeNearAccountId(envWalletAccountId);
	}

	const parsedNetwork = parseNearNetwork(network);
	const credentialAccountId = findAccountIdFromCredentials(parsedNetwork);
	if (credentialAccountId) {
		return normalizeNearAccountId(credentialAccountId);
	}

	const diagnostics = checkNearCliCredentials(parsedNetwork);
	throw new Error(
		`No NEAR account id available.\n\n${diagnostics.hint}\n\nAlternatively, set ${NEAR_ACCOUNT_ID_ENV} environment variable.`,
	);
}

export function resolveNearPrivateKey(params: {
	accountId?: string;
	network?: string;
	privateKey?: string;
}): string {
	if (typeof params.privateKey === "string" && params.privateKey.trim()) {
		return normalizeNearPrivateKey(params.privateKey);
	}

	const envPrivateKey = process.env[NEAR_PRIVATE_KEY_ENV]?.trim();
	if (envPrivateKey) {
		return normalizeNearPrivateKey(envPrivateKey);
	}

	const parsedNetwork = parseNearNetwork(params.network);
	const resolvedAccountId = resolveNearAccountId(
		params.accountId,
		parsedNetwork,
	);
	const credentialPath = resolveCredentialPathForAccount(
		resolvedAccountId,
		parsedNetwork,
	);
	if (credentialPath) {
		const privateKey = findPrivateKeyFromCredentialFile(credentialPath);
		if (privateKey) {
			return normalizeNearPrivateKey(privateKey);
		}
	}

	const diagnostics = checkNearCliCredentials(parsedNetwork);
	throw new Error(
		`No NEAR signer key available for ${resolvedAccountId}.\n\n${diagnostics.hint}\n\nAlternatively, set ${NEAR_PRIVATE_KEY_ENV} environment variable.`,
	);
}

export function resolveNearSigner(params: {
	accountId?: string;
	network?: string;
	privateKey?: string;
}): {
	accountId: string;
	signer: KeyPairSigner;
} {
	const parsedNetwork = parseNearNetwork(params.network);
	const accountId = resolveNearAccountId(params.accountId, parsedNetwork);
	const privateKey = resolveNearPrivateKey({
		accountId,
		network: parsedNetwork,
		privateKey: params.privateKey,
	});
	const signer = KeyPairSigner.fromSecretKey(privateKey as KeyPairString);
	return {
		accountId,
		signer,
	};
}

export function getNearExplorerAccountUrl(
	accountId: string,
	network?: string,
): string {
	const parsedNetwork = parseNearNetwork(network);
	const origin = NEAR_EXPLORER_ORIGIN_BY_NETWORK[parsedNetwork];
	return `${origin}/address/${encodeURIComponent(accountId)}`;
}

export function getNearExplorerTransactionUrl(
	txHash: string,
	network?: string,
): string {
	const parsedNetwork = parseNearNetwork(network);
	const origin = NEAR_EXPLORER_ORIGIN_BY_NETWORK[parsedNetwork];
	return `${origin}/txns/${encodeURIComponent(txHash)}`;
}

function isTransientNearRpcError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const text = error.message.toLowerCase();
	return (
		text.includes("429") ||
		text.includes("too many requests") ||
		text.includes("fetch failed") ||
		text.includes("networkerror") ||
		text.includes("timeout")
	);
}

export async function callNearRpc<T>(params: {
	method: string;
	params?: unknown;
	network?: string;
	rpcUrl?: string;
	signal?: AbortSignal;
}): Promise<T> {
	const method = params.method.trim();
	if (!method) {
		throw new Error("NEAR RPC method is required");
	}

	const endpoints = getNearRpcEndpoints(params.network, params.rpcUrl);
	const payload = {
		jsonrpc: "2.0",
		id: "pi-chain-tools",
		method,
		params: params.params ?? {},
	};

	let lastError: Error | null = null;
	for (const endpoint of endpoints) {
		try {
			const response = await fetch(endpoint, {
				body: JSON.stringify(payload),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
				signal: params.signal,
			});

			if (!response.ok) {
				throw new Error(
					`NEAR RPC request failed (${response.status} ${response.statusText})`,
				);
			}

			const json = (await response.json()) as NearRpcResponse<T>;
			if (!json || typeof json !== "object") {
				throw new Error("Invalid NEAR RPC response payload");
			}

			if (json.error) {
				const code =
					typeof json.error.code === "number" ? ` (${json.error.code})` : "";
				const message = json.error.message?.trim() || "Unknown NEAR RPC error";
				throw new Error(`NEAR RPC error${code}: ${message}`);
			}

			if (!("result" in json)) {
				throw new Error("NEAR RPC response missing result");
			}
			return json.result as T;
		} catch (error) {
			if (!(error instanceof Error)) {
				lastError = new Error(String(error));
				continue;
			}
			lastError = error;
			if (!isTransientNearRpcError(error)) {
				throw error;
			}
		}
	}

	if (lastError) {
		if (endpoints.length > 1) {
			throw new Error(
				`NEAR RPC failed across ${endpoints.length} endpoint(s): ${lastError.message}`,
			);
		}
		throw lastError;
	}
	throw new Error("NEAR RPC request failed with unknown error");
}

export const YOCTO_NEAR_PER_NEAR = YOCTO_PER_NEAR;
