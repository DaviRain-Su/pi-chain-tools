import { describe, expect, it } from "vitest";
import { __morphoSdkInternals } from "./monad-morpho-sdk.mjs";

describe("morpho execute non-sdk marker coverage", () => {
	it("marks canonical signer path when sdk path is active", () => {
		const marker = __morphoSdkInternals.buildMorphoRemainingNonSdkPath({
			sdkEnabled: true,
			sdkFallbackUsed: false,
		});
		expect(marker.active).toBe(true);
		expect(marker.marker).toBe(
			"morpho_execute_canonical_ethers_path_no_official_sdk_executor",
		);
		expect(marker.reason).toContain("no_public_execute_signer_pipeline");
	});

	it("marks native fallback path and carries sdk error", () => {
		const marker = __morphoSdkInternals.buildMorphoRemainingNonSdkPath({
			sdkEnabled: true,
			sdkFallbackUsed: true,
			sdkError: "sdk_probe_failed",
		});
		expect(marker.marker).toBe("morpho_execute_non_sdk_native_fallback_path");
		expect(marker.reason).toContain("sdk_probe_failed");
	});
});
