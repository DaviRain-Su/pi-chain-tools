import { describe, expect, it, vi } from "vitest";
import { executeWombatSupplySdkFirst } from "./bsc-wombat-execute.mjs";

describe("wombat execute sdk-first routing", () => {
	it("uses sdk context + canonical executor and emits canonical marker", async () => {
		const createAdapter = vi.fn(async () => ({
			provider: { id: "p1" },
			meta: { client: "wombat-configx" },
		}));
		const executeCanonical = vi.fn(async ({ providerOverride }) => ({
			ok: true,
			provider: "wombat-native-rpc",
			providerSeen: providerOverride?.id || null,
		}));
		const result = await executeWombatSupplySdkFirst({
			sdkEnabled: true,
			createAdapter,
			executeCanonical,
		});

		expect(createAdapter).toHaveBeenCalledTimes(1);
		expect(executeCanonical).toHaveBeenCalledTimes(1);
		expect(result.mode).toBe("sdk");
		expect(result.providerSeen).toBe("p1");
		expect(result.warnings).toContain(
			"wombat_execute_tx_uses_canonical_ethers_signer_no_official_sdk_executor",
		);
		expect(result.remainingNonSdkPath?.marker).toBe(
			"wombat_execute_canonical_ethers_path_no_official_sdk_executor",
		);
		expect(result.sdk?.used).toBe(true);
		expect(result.fallback?.used).toBe(false);
	});

	it("falls back to native canonical executor when sdk adapter init fails", async () => {
		const executeCanonical = vi.fn(async () => ({
			ok: true,
			provider: "wombat-native-rpc",
		}));
		const result = await executeWombatSupplySdkFirst({
			sdkEnabled: true,
			fallbackToNative: true,
			createAdapter: vi.fn(async () => {
				throw new Error("wombat_sdk_probe_failed");
			}),
			executeCanonical,
		});

		expect(result.mode).toBe("native-fallback");
		expect(result.fallback?.used).toBe(true);
		expect(result.warnings).toContain(
			"wombat_sdk_execute_failed_fallback_to_native",
		);
		expect(result.warnings).toContain(
			"wombat_execute_path_native_fallback_active",
		);
		expect(result.remainingNonSdkPath?.reason).toContain(
			"wombat_sdk_probe_failed",
		);
	});
});
