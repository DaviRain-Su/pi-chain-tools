import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	formatNearAmount,
	parseNearNetwork,
	resolveNearAccountId,
	resolveNearPrivateKey,
	toYoctoNear,
} from "./runtime.js";

const ORIGINAL_ENV = {
	NEAR_ACCOUNT_ID: process.env.NEAR_ACCOUNT_ID,
	NEAR_WALLET_ACCOUNT_ID: process.env.NEAR_WALLET_ACCOUNT_ID,
	NEAR_PRIVATE_KEY: process.env.NEAR_PRIVATE_KEY,
	NEAR_CREDENTIALS_DIR: process.env.NEAR_CREDENTIALS_DIR,
};

const tempDirs: string[] = [];

function setOptionalEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		Reflect.deleteProperty(process.env, name);
		return;
	}
	process.env[name] = value;
}

function withTempNearCredentials(options: {
	network: "mainnet" | "testnet";
	files: Array<{ name: string; accountId?: string; privateKey?: string }>;
}): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-chain-tools-near-"));
	tempDirs.push(dir);
	const networkDir = path.join(dir, options.network);
	mkdirSync(networkDir, { recursive: true });
	for (const file of options.files) {
		const payload =
			file.accountId === undefined && file.privateKey === undefined
				? {}
				: {
						account_id: file.accountId,
						private_key: file.privateKey,
					};
		writeFileSync(
			path.join(networkDir, file.name),
			JSON.stringify(payload),
			"utf8",
		);
	}
	return dir;
}

afterEach(() => {
	setOptionalEnv("NEAR_ACCOUNT_ID", ORIGINAL_ENV.NEAR_ACCOUNT_ID);
	setOptionalEnv("NEAR_WALLET_ACCOUNT_ID", ORIGINAL_ENV.NEAR_WALLET_ACCOUNT_ID);
	setOptionalEnv("NEAR_PRIVATE_KEY", ORIGINAL_ENV.NEAR_PRIVATE_KEY);
	setOptionalEnv("NEAR_CREDENTIALS_DIR", ORIGINAL_ENV.NEAR_CREDENTIALS_DIR);
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, {
				force: true,
				recursive: true,
			});
		}
	}
});

describe("parseNearNetwork", () => {
	it("normalizes values and defaults to mainnet", () => {
		expect(parseNearNetwork("mainnet")).toBe("mainnet");
		expect(parseNearNetwork("testnet")).toBe("testnet");
		expect(parseNearNetwork("mainnet-beta")).toBe("mainnet");
		expect(parseNearNetwork("unknown")).toBe("mainnet");
		expect(parseNearNetwork(undefined)).toBe("mainnet");
	});
});

describe("formatNearAmount", () => {
	it("formats yoctoNEAR into readable NEAR", () => {
		expect(formatNearAmount("1000000000000000000000000")).toBe("1");
		expect(formatNearAmount("1234500000000000000000000")).toBe("1.2345");
		expect(formatNearAmount("1000000000000000000", 8)).toBe("0.000001");
	});
});

describe("toYoctoNear", () => {
	it("converts near decimal values into yoctoNEAR", () => {
		expect(toYoctoNear("1")).toBe(1_000_000_000_000_000_000_000_000n);
		expect(toYoctoNear("0.001")).toBe(1_000_000_000_000_000_000_000n);
	});
});

describe("resolveNearAccountId", () => {
	it("prefers explicit account id", () => {
		process.env.NEAR_ACCOUNT_ID = "env.near";
		expect(resolveNearAccountId("@alice.near", "mainnet")).toBe("alice.near");
	});

	it("uses NEAR_ACCOUNT_ID when explicit account is missing", () => {
		process.env.NEAR_ACCOUNT_ID = "owner.near";
		expect(resolveNearAccountId(undefined, "mainnet")).toBe("owner.near");
	});

	it("falls back to credential files for the network", () => {
		setOptionalEnv("NEAR_ACCOUNT_ID", undefined);
		setOptionalEnv("NEAR_WALLET_ACCOUNT_ID", undefined);
		const credentialsDir = withTempNearCredentials({
			files: [{ name: "alice.near.json", accountId: "alice.near" }],
			network: "mainnet",
		});
		process.env.NEAR_CREDENTIALS_DIR = credentialsDir;

		expect(resolveNearAccountId(undefined, "mainnet")).toBe("alice.near");
	});

	it("throws when no account id source is available", () => {
		setOptionalEnv("NEAR_ACCOUNT_ID", undefined);
		setOptionalEnv("NEAR_WALLET_ACCOUNT_ID", undefined);
		const credentialsDir = withTempNearCredentials({
			files: [],
			network: "mainnet",
		});
		process.env.NEAR_CREDENTIALS_DIR = credentialsDir;

		expect(() => resolveNearAccountId(undefined, "mainnet")).toThrow(
			"No NEAR account id available",
		);
	});
});

describe("resolveNearPrivateKey", () => {
	it("prefers explicit private key", () => {
		process.env.NEAR_PRIVATE_KEY = "ed25519:env";
		expect(
			resolveNearPrivateKey({
				privateKey: "ed25519:explicit",
				accountId: "alice.near",
				network: "mainnet",
			}),
		).toBe("ed25519:explicit");
	});

	it("reads private key from credentials when env is unavailable", () => {
		setOptionalEnv("NEAR_PRIVATE_KEY", undefined);
		setOptionalEnv("NEAR_ACCOUNT_ID", undefined);
		setOptionalEnv("NEAR_WALLET_ACCOUNT_ID", undefined);
		const credentialsDir = withTempNearCredentials({
			files: [
				{
					name: "alice.near.json",
					accountId: "alice.near",
					privateKey: "ed25519:from-credentials",
				},
			],
			network: "mainnet",
		});
		process.env.NEAR_CREDENTIALS_DIR = credentialsDir;

		expect(
			resolveNearPrivateKey({
				accountId: "alice.near",
				network: "mainnet",
			}),
		).toBe("ed25519:from-credentials");
	});
});
