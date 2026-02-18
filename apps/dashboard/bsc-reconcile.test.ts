import { describe, expect, it } from "vitest";

import {
	reconcileBscExecutionArtifact,
	validateBscPostActionArtifactV1,
} from "./bsc-reconcile.mjs";

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
			token: "usdc",
		});
		expect(result.ok).toBe(true);
		expect(result.route).toBe("bsc_post_action_supply_v1:aave");
		expect(result.checks?.providerOk).toBe(true);
	});

	it("accepts lista native-rpc provider label", () => {
		const result = reconcileBscExecutionArtifact({
			type: "bsc_post_action_supply",
			version: "v1",
			protocol: "lista",
			status: "success",
			amountRaw: "12345",
			txHash: `0x${"f".repeat(64)}`,
			provider: "lista-native-rpc",
			token: "usdc",
		});
		expect(result.ok).toBe(true);
		expect(result.route).toBe("bsc_post_action_supply_v1:lista");
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
			token: "usdc",
		});
		expect(result.ok).toBe(false);
		expect(result.route).toBe("bsc_post_action_supply_v1:lista");
		expect(result.retryable).toBe(true);
		expect(result.checks?.providerOk).toBe(false);
	});

	it("returns artifact_invalid when protocol adapter missing", () => {
		const result = reconcileBscExecutionArtifact({
			type: "bsc_post_action_supply",
			version: "v1",
			protocol: "venus",
			status: "success",
			amountRaw: "1",
			txHash: `0x${"c".repeat(64)}`,
			token: "usdc",
		});
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("artifact_invalid");
		expect(result.reason).toContain("protocol_invalid");
		expect(result.route).toBe("unsupported");
	});

	it("keeps reconciliation response contract stable", () => {
		const result = reconcileBscExecutionArtifact({
			type: "bsc_post_action_supply",
			version: "v1",
			protocol: "wombat",
			status: "success",
			amountRaw: "99",
			txHash: `0x${"e".repeat(64)}`,
			provider: "wombat-command",
			token: "usdc",
			retryable: false,
		});
		expect(Object.keys(result).sort()).toEqual(
			expect.arrayContaining([
				"ok",
				"route",
				"reason",
				"retryable",
				"checks",
				"checkedAt",
			]),
		);
		expect(result.route).toBe("bsc_post_action_supply_v1:wombat");
		expect(result.checks).toMatchObject({
			protocol: "wombat",
			status: "success",
			hasValidAmount: true,
			hasTxHash: true,
			providerOk: true,
		});
		expect(typeof result.checkedAt).toBe("string");
	});
});

describe("bsc post-action artifact validator", () => {
	it("returns normalized artifact for valid payload", () => {
		const result = validateBscPostActionArtifactV1({
			type: "bsc_post_action_supply",
			version: "v1",
			protocol: "WOMBAT",
			status: "SUCCESS",
			amountRaw: "10",
			txHash: `0x${"d".repeat(64)}`,
			provider: "wombat-command",
			token: "USDC",
		});
		expect(result.ok).toBe(true);
		expect(result.normalized.protocol).toBe("wombat");
		expect(result.normalized.status).toBe("success");
		expect(result.normalized.token).toBe("usdc");
	});

	it("captures schema violations", () => {
		const result = validateBscPostActionArtifactV1({
			type: "bad",
			version: "v0",
			protocol: "bad",
			status: "done",
			amountRaw: "0",
			txHash: "0x123",
			token: "",
		});
		expect(result.ok).toBe(false);
		expect(result.errors).toEqual(
			expect.arrayContaining([
				"type_invalid",
				"version_invalid",
				"protocol_invalid",
				"status_invalid",
				"amount_raw_invalid",
				"tx_hash_invalid",
				"token_missing",
			]),
		);
	});
});
