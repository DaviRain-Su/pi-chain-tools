import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tests for signer-types.ts (resolveSignerBackend)
// ---------------------------------------------------------------------------
describe("resolveSignerBackend", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("prefers explicit fromPrivateKey over all env vars", async () => {
		process.env.EVM_PRIVATE_KEY = "env-key";
		process.env.PRIVY_WALLET_ID = "wallet-1";
		process.env.PRIVY_APP_ID = "app-1";
		process.env.PRIVY_APP_SECRET = "secret-1";

		const { resolveSignerBackend } = await import("./signer-types.js");
		const result = resolveSignerBackend({
			fromPrivateKey: "explicit-key",
			network: "bsc",
		});

		expect(result.mode).toBe("local");
		if (result.mode === "local") {
			expect(result.privateKey).toBe("explicit-key");
		}
	});

	it("falls back to EVM_PRIVATE_KEY when no fromPrivateKey", async () => {
		process.env.EVM_PRIVATE_KEY = "env-key-123";
		process.env.PRIVY_WALLET_ID = undefined;

		const { resolveSignerBackend } = await import("./signer-types.js");
		const result = resolveSignerBackend({ network: "bsc" });

		expect(result.mode).toBe("local");
		if (result.mode === "local") {
			expect(result.privateKey).toBe("env-key-123");
		}
	});

	it("falls back to POLYMARKET_PRIVATE_KEY", async () => {
		process.env.EVM_PRIVATE_KEY = undefined;
		process.env.POLYMARKET_PRIVATE_KEY = "poly-key";

		const { resolveSignerBackend } = await import("./signer-types.js");
		const result = resolveSignerBackend({ network: "ethereum" });

		expect(result.mode).toBe("local");
		if (result.mode === "local") {
			expect(result.privateKey).toBe("poly-key");
		}
	});

	it("falls back to Privy when no local key available", async () => {
		process.env.EVM_PRIVATE_KEY = undefined;
		process.env.POLYMARKET_PRIVATE_KEY = undefined;
		process.env.PRIVY_WALLET_ID = "w-1";
		process.env.PRIVY_APP_ID = "a-1";
		process.env.PRIVY_APP_SECRET = "s-1";

		const { resolveSignerBackend } = await import("./signer-types.js");
		const result = resolveSignerBackend({ network: "bsc" });

		expect(result.mode).toBe("privy");
		if (result.mode === "privy") {
			expect(result.walletId).toBe("w-1");
			expect(result.appId).toBe("a-1");
			expect(result.appSecret).toBe("s-1");
		}
	});

	it("throws when nothing is available", async () => {
		process.env.EVM_PRIVATE_KEY = undefined;
		process.env.POLYMARKET_PRIVATE_KEY = undefined;
		process.env.PRIVY_WALLET_ID = undefined;
		process.env.PRIVY_APP_ID = undefined;
		process.env.PRIVY_APP_SECRET = undefined;

		const { resolveSignerBackend } = await import("./signer-types.js");
		expect(() => resolveSignerBackend({ network: "bsc" })).toThrow(
			"No EVM signer available",
		);
	});

	it("treats whitespace-only keys as empty", async () => {
		process.env.EVM_PRIVATE_KEY = "   ";
		process.env.POLYMARKET_PRIVATE_KEY = undefined;
		process.env.PRIVY_WALLET_ID = undefined;

		const { resolveSignerBackend } = await import("./signer-types.js");
		expect(() => resolveSignerBackend({ network: "bsc" })).toThrow(
			"No EVM signer available",
		);
	});

	it("requires all three Privy env vars", async () => {
		process.env.EVM_PRIVATE_KEY = undefined;
		process.env.POLYMARKET_PRIVATE_KEY = undefined;
		process.env.PRIVY_WALLET_ID = "w-1";
		process.env.PRIVY_APP_ID = "a-1";
		// Missing PRIVY_APP_SECRET

		const { resolveSignerBackend } = await import("./signer-types.js");
		expect(() => resolveSignerBackend({ network: "bsc" })).toThrow(
			"No EVM signer available",
		);
	});
});

// ---------------------------------------------------------------------------
// Tests for signer-local.ts (LocalKeySigner)
// ---------------------------------------------------------------------------
describe("LocalKeySigner", () => {
	it("constructs from private key and returns address", async () => {
		const { LocalKeySigner } = await import("./signer-local.js");
		// Known test key (do NOT use in production)
		const testKey =
			"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
		const signer = new LocalKeySigner(testKey);
		const addr = await signer.getAddress("bsc");
		expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/);
		expect(signer.id).toBe("local-key");
	});

	it("createLocalKeySigner throws without key", async () => {
		const originalEnv = { ...process.env };
		process.env.EVM_PRIVATE_KEY = undefined;
		process.env.POLYMARKET_PRIVATE_KEY = undefined;

		const { createLocalKeySigner } = await import("./signer-local.js");
		expect(() => createLocalKeySigner()).toThrow("No EVM private key");

		process.env = originalEnv;
	});
});

// ---------------------------------------------------------------------------
// Tests for signer-privy.ts (PrivyEvmSigner)
// ---------------------------------------------------------------------------
describe("PrivyEvmSigner", () => {
	it("throws when @privy-io/node is not installed", async () => {
		const { PrivyEvmSigner } = await import("./signer-privy.js");
		const signer = new PrivyEvmSigner({
			walletId: "test-wallet",
			appId: "test-app",
			appSecret: "test-secret",
		});
		expect(signer.id).toBe("privy");

		// Attempting to use it should fail (module not installed in test env)
		await expect(signer.getAddress("bsc")).rejects.toThrow();
	});

	it("createPrivyEvmSigner throws without config", async () => {
		const originalEnv = { ...process.env };
		process.env.PRIVY_WALLET_ID = undefined;
		process.env.PRIVY_APP_ID = undefined;
		process.env.PRIVY_APP_SECRET = undefined;

		const { createPrivyEvmSigner } = await import("./signer-privy.js");
		expect(() => createPrivyEvmSigner()).toThrow("requires PRIVY_APP_ID");

		process.env = originalEnv;
	});

	it("createPrivyEvmSigner succeeds with explicit params", async () => {
		const { createPrivyEvmSigner } = await import("./signer-privy.js");
		const signer = createPrivyEvmSigner({
			walletId: "w",
			appId: "a",
			appSecret: "s",
		});
		expect(signer.id).toBe("privy");
	});
});

// ---------------------------------------------------------------------------
// Tests for signer-resolve.ts (resolveEvmSigner)
// ---------------------------------------------------------------------------
describe("resolveEvmSigner", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns LocalKeySigner when private key available", async () => {
		process.env.EVM_PRIVATE_KEY =
			"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

		const { resolveEvmSigner } = await import("./signer-resolve.js");
		const signer = resolveEvmSigner({ network: "bsc" });
		expect(signer.id).toBe("local-key");
	});

	it("returns PrivyEvmSigner when only Privy config available", async () => {
		process.env.EVM_PRIVATE_KEY = undefined;
		process.env.POLYMARKET_PRIVATE_KEY = undefined;
		process.env.PRIVY_WALLET_ID = "w-1";
		process.env.PRIVY_APP_ID = "a-1";
		process.env.PRIVY_APP_SECRET = "s-1";

		const { resolveEvmSigner } = await import("./signer-resolve.js");
		const signer = resolveEvmSigner({ network: "bsc" });
		expect(signer.id).toBe("privy");
	});

	it("prefers local key over Privy", async () => {
		process.env.EVM_PRIVATE_KEY =
			"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
		process.env.PRIVY_WALLET_ID = "w-1";
		process.env.PRIVY_APP_ID = "a-1";
		process.env.PRIVY_APP_SECRET = "s-1";

		const { resolveEvmSigner } = await import("./signer-resolve.js");
		const signer = resolveEvmSigner({ network: "ethereum" });
		expect(signer.id).toBe("local-key");
	});

	it("fromPrivateKey param overrides everything", async () => {
		process.env.PRIVY_WALLET_ID = "w-1";
		process.env.PRIVY_APP_ID = "a-1";
		process.env.PRIVY_APP_SECRET = "s-1";

		const { resolveEvmSigner } = await import("./signer-resolve.js");
		const signer = resolveEvmSigner({
			fromPrivateKey:
				"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
			network: "bsc",
		});
		expect(signer.id).toBe("local-key");
	});
});
