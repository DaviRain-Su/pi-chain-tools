import { describe, expect, it, vi } from "vitest";
import { executeListaSupplySdkFirst } from "./bsc-lista-execute.mjs";

describe("lista execute sdk-first routing", () => {
	it("uses sdk context + canonical executor and emits canonical marker", async () => {
		const createAdapter = vi.fn(async () => ({
			provider: { id: "p1" },
			meta: { client: "lista-ethers-client" },
		}));
		const executeCanonical = vi.fn(async ({ providerOverride }) => ({
			ok: true,
			provider: "lista-native-rpc",
			providerSeen: providerOverride?.id || null,
		}));
		const result = await executeListaSupplySdkFirst({
			sdkEnabled: true,
			createAdapter,
			executeCanonical,
		});

		expect(createAdapter).toHaveBeenCalledTimes(1);
		expect(executeCanonical).toHaveBeenCalledTimes(1);
		expect(result.mode).toBe("sdk");
		expect(result.providerSeen).toBe("p1");
		expect(result.warnings).toContain(
			"lista_execute_tx_uses_canonical_ethers_signer_no_official_sdk_executor",
		);
		expect(result.remainingNonSdkPath?.marker).toBe(
			"lista_execute_canonical_ethers_path_no_official_sdk_executor",
		);
		expect(result.sdk?.used).toBe(true);
		expect(result.fallback?.used).toBe(false);
		expect(result.executeDetectors?.machineReadable).toBe(true);
		expect(result.remainingNonSdkPath?.checks).toMatchObject({
			sdkEnabled: true,
			sdkAdapterResolved: true,
			fallbackUsed: false,
		});
	});

	it("falls back to native canonical executor when sdk adapter init fails", async () => {
		const executeCanonical = vi.fn(async () => ({
			ok: true,
			provider: "lista-native-rpc",
		}));
		const result = await executeListaSupplySdkFirst({
			sdkEnabled: true,
			fallbackToNative: true,
			createAdapter: vi.fn(async () => {
				throw new Error("lista_sdk_probe_failed");
			}),
			executeCanonical,
		});

		expect(result.mode).toBe("native-fallback");
		expect(result.fallback?.used).toBe(true);
		expect(result.warnings).toContain(
			"lista_sdk_execute_failed_fallback_to_native",
		);
		expect(result.warnings).toContain(
			"lista_execute_path_native_fallback_active",
		);
		expect(result.remainingNonSdkPath?.reason).toContain(
			"lista_sdk_probe_failed",
		);
	});
});
