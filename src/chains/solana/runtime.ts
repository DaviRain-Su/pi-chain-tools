import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
	Connection,
	PublicKey,
	Transaction,
	VersionedTransaction,
	clusterApiUrl,
} from "@solana/web3.js";
import bs58 from "bs58";

export type SolanaNetwork = "mainnet-beta" | "devnet" | "testnet";
export type CommitmentLevel = "processed" | "confirmed" | "finalized";
export type FinalityLevel = "confirmed" | "finalized";

export const TOOL_PREFIX = "solana_";
const DEFAULT_COMMITMENT: CommitmentLevel = "confirmed";

export const TOKEN_PROGRAM_ID = new PublicKey(
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const DANGEROUS_RPC_METHODS = new Set([
	"sendTransaction",
	"requestAirdrop",
]);

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

export function getRpcEndpoint(network?: string): string {
	const selected = parseNetwork(network);
	return process.env.SOLANA_RPC_URL?.trim() || clusterApiUrl(selected);
}

export function getConnection(network?: string): Connection {
	const endpoint = getRpcEndpoint(network);
	const commitment = parseCommitment(process.env.SOLANA_COMMITMENT);
	return new Connection(endpoint, { commitment });
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
	const payload = (await response.json()) as {
		result?: unknown;
		error?: { code?: number; message?: string; data?: unknown };
	};

	if (!response.ok) {
		throw new Error(
			`RPC request failed with HTTP ${response.status}: ${stringifyUnknown(payload.error ?? payload)}`,
		);
	}

	if (payload.error) {
		const code = payload.error.code ?? -1;
		const message = payload.error.message ?? "Unknown RPC error";
		throw new Error(`RPC ${method} failed (${code}): ${message}`);
	}

	return payload.result ?? null;
}
