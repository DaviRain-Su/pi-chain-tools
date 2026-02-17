import { describe, expect, it } from "vitest";

import { reconcileBscExecutionArtifact } from "./bsc-reconcile.mjs";

describe("bsc post-action reconciliation router", () => {
	it("reconciles successful aave artifact", () => {
		const result = reconcileBscExecutionArtifact({
			type: "bsc_post_action_supply",
			version: "v1",
			protocol: "aave",
			status: "success",
			amountRaw: "12345",
			txHash: `0x${"a".repeat(64)}`,
			provider: "aave-native",
		});
		expect(result.ok).toBe(true);
		expect(result.route).toBe("bsc_post_action_supply_v1:aave");
		expect(result.checks?.providerOk).toBe(true);
	});

	it("flags provider mismatch for protocol adapter", () => {
		const result = reconcileBscExecutionArtifact({
			type: "bsc_post_action_supply",
			version: "v1",
			protocol: "lista",
			status: "success",
			amountRaw: "12345",
			txHash: `0x${"b".repeat(64)}`,
			provider: "wombat-command",
			retryable: true,
		});
		expect(result.ok).toBe(false);
		expect(result.route).toBe("bsc_post_action_supply_v1:lista");
		expect(result.retryable).toBe(true);
		expect(result.checks?.providerOk).toBe(false);
	});

	it("returns unsupported route when protocol adapter missing", () => {
		const result = reconcileBscExecutionArtifact({
			type: "bsc_post_action_supply",
			version: "v1",
			protocol: "venus",
			status: "success",
			amountRaw: "1",
			txHash: `0x${"c".repeat(64)}`,
		});
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("protocol_reconcile_adapter_missing");
		expect(result.route).toContain("venus:unsupported");
	});
});
