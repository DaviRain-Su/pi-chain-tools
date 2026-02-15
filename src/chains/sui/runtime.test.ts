import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { afterEach, describe, expect, it } from "vitest";
import {
	parseSuiNetwork,
	resolveSuiKeypair,
	resolveSuiOwnerAddress,
	toMist,
} from "./runtime.js";

const ORIGINAL_ENV = {
	SUI_PRIVATE_KEY: process.env.SUI_PRIVATE_KEY,
	SUI_CONFIG_DIR: process.env.SUI_CONFIG_DIR,
	SUI_KEYSTORE_PATH: process.env.SUI_KEYSTORE_PATH,
	SUI_CLIENT_CONFIG_PATH: process.env.SUI_CLIENT_CONFIG_PATH,
};
const tempDirs: string[] = [];

function setOptionalEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		Reflect.deleteProperty(process.env, name);
		return;
	}
	process.env[name] = value;
}

function withTempSuiConfig(options: {
	keystoreEntries: unknown[];
	activeAddress?: string | null;
}): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-chain-tools-sui-"));
	tempDirs.push(dir);
	const keystorePath = path.join(dir, "sui.keystore");
	writeFileSync(keystorePath, JSON.stringify(options.keystoreEntries), "utf8");
	const clientPath = path.join(dir, "client.yaml");
	if (options.activeAddress) {
		writeFileSync(
			clientPath,
			`active_env: mainnet\nactive_address: "${options.activeAddress}"\n`,
			"utf8",
		);
	}
	return dir;
}

function useTempSuiConfigDir(dir: string): void {
	process.env.SUI_CONFIG_DIR = dir;
	setOptionalEnv("SUI_KEYSTORE_PATH", undefined);
	setOptionalEnv("SUI_CLIENT_CONFIG_PATH", undefined);
}

afterEach(() => {
	setOptionalEnv("SUI_PRIVATE_KEY", ORIGINAL_ENV.SUI_PRIVATE_KEY);
	setOptionalEnv("SUI_CONFIG_DIR", ORIGINAL_ENV.SUI_CONFIG_DIR);
	setOptionalEnv("SUI_KEYSTORE_PATH", ORIGINAL_ENV.SUI_KEYSTORE_PATH);
	setOptionalEnv("SUI_CLIENT_CONFIG_PATH", ORIGINAL_ENV.SUI_CLIENT_CONFIG_PATH);
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

describe("toMist", () => {
	it("converts valid SUI amounts to MIST", () => {
		expect(toMist(1)).toBe(1_000_000_000n);
		expect(toMist(0.000000001)).toBe(1n);
	});

	it("rejects non-positive amounts", () => {
		expect(() => toMist(0)).toThrow("positive");
		expect(() => toMist(-1)).toThrow("positive");
	});

	it("rejects amounts with more than 9 decimal places", () => {
		expect(() => toMist(0.0000000011)).toThrow("9 decimal places");
	});
});

describe("parseSuiNetwork", () => {
	it("normalizes mainnet aliases and defaults", () => {
		expect(parseSuiNetwork("mainnet-beta")).toBe("mainnet");
		expect(parseSuiNetwork("unknown")).toBe("mainnet");
		expect(parseSuiNetwork(undefined)).toBe("mainnet");
	});
});

describe("resolveSuiKeypair", () => {
	it("prefers explicit private key over environment and keystore", () => {
		const explicit = Ed25519Keypair.generate();
		const env = Ed25519Keypair.generate();
		const keystore = Ed25519Keypair.generate();
		const configDir = withTempSuiConfig({
			activeAddress: keystore.toSuiAddress(),
			keystoreEntries: [keystore.getSecretKey()],
		});
		useTempSuiConfigDir(configDir);
		process.env.SUI_PRIVATE_KEY = env.getSecretKey();

		const resolved = resolveSuiKeypair(explicit.getSecretKey());
		expect(resolved.toSuiAddress()).toBe(explicit.toSuiAddress());
	});

	it("uses SUI_PRIVATE_KEY when no explicit private key is provided", () => {
		const env = Ed25519Keypair.generate();
		process.env.SUI_PRIVATE_KEY = env.getSecretKey();

		const resolved = resolveSuiKeypair();
		expect(resolved.toSuiAddress()).toBe(env.toSuiAddress());
	});

	it("falls back to local keystore and selects active_address", () => {
		setOptionalEnv("SUI_PRIVATE_KEY", undefined);
		const first = Ed25519Keypair.generate();
		const active = Ed25519Keypair.generate();
		const configDir = withTempSuiConfig({
			activeAddress: active.toSuiAddress(),
			keystoreEntries: [first.getSecretKey(), active.getSecretKey()],
		});
		useTempSuiConfigDir(configDir);

		const resolved = resolveSuiKeypair();
		expect(resolved.toSuiAddress()).toBe(active.toSuiAddress());
	});

	it("parses keystore entries stored as objects", () => {
		setOptionalEnv("SUI_PRIVATE_KEY", undefined);
		const account = Ed25519Keypair.generate();
		const configDir = withTempSuiConfig({
			activeAddress: account.toSuiAddress(),
			keystoreEntries: [
				{
					publicKey: account.getPublicKey().toBase64(),
					secretKey: account.getSecretKey(),
				},
			],
		});
		useTempSuiConfigDir(configDir);

		const resolved = resolveSuiKeypair();
		expect(resolved.toSuiAddress()).toBe(account.toSuiAddress());
	});

	it("falls back to the first valid keystore entry when active_address does not match", () => {
		setOptionalEnv("SUI_PRIVATE_KEY", undefined);
		const first = Ed25519Keypair.generate();
		const second = Ed25519Keypair.generate();
		const configDir = withTempSuiConfig({
			activeAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			keystoreEntries: ["invalid", first.getSecretKey(), second.getSecretKey()],
		});
		useTempSuiConfigDir(configDir);

		const resolved = resolveSuiKeypair();
		expect(resolved.toSuiAddress()).toBe(first.toSuiAddress());
	});

	it("throws when explicit/env/keystore keys are all unavailable", () => {
		setOptionalEnv("SUI_PRIVATE_KEY", undefined);
		const configDir = withTempSuiConfig({
			keystoreEntries: [],
		});
		useTempSuiConfigDir(configDir);

		expect(() => resolveSuiKeypair()).toThrow("SUI_KEYSTORE_PATH");
	});
});

describe("resolveSuiOwnerAddress", () => {
	it("uses explicit owner argument when provided", () => {
		expect(resolveSuiOwnerAddress("@0xabc")).toBe("0xabc");
	});

	it("uses active_address from local client config when owner is omitted", () => {
		setOptionalEnv("SUI_PRIVATE_KEY", undefined);
		const configDir = withTempSuiConfig({
			activeAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			keystoreEntries: [],
		});
		useTempSuiConfigDir(configDir);

		expect(resolveSuiOwnerAddress()).toBe(
			"0x1111111111111111111111111111111111111111111111111111111111111111",
		);
	});

	it("falls back to SUI_PRIVATE_KEY when active_address is unavailable", () => {
		const env = Ed25519Keypair.generate();
		process.env.SUI_PRIVATE_KEY = env.getSecretKey();
		const configDir = withTempSuiConfig({
			keystoreEntries: [],
		});
		useTempSuiConfigDir(configDir);

		expect(resolveSuiOwnerAddress()).toBe(env.toSuiAddress().toLowerCase());
	});

	it("throws when owner and local signer configuration are all unavailable", () => {
		setOptionalEnv("SUI_PRIVATE_KEY", undefined);
		const configDir = withTempSuiConfig({
			keystoreEntries: [],
		});
		useTempSuiConfigDir(configDir);

		expect(() => resolveSuiOwnerAddress()).toThrow("No Sui owner address");
	});
});
