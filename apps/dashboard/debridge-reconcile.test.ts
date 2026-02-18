import { describe, expect, it } from "vitest";

import {
	buildDebridgeExecutionArtifact,
	classifyDebridgeExecuteError,
	reconcileDebridgeExecutionArtifact,
	validateDebridgeExecutionArtifactV1,
	validateDebridgeExecutionReconciliationV1,
} from "./debridge-reconcile.mjs";

describe("debridge reconcile", () => {
	it("builds + validates execution artifact", () => {
		const artifact = buildDebridgeExecutionArtifact({
			payload: {
				runId: "r1",
				originChain: "ethereum",
				destinationChain: "bsc",
				tokenIn: "ETH",
				tokenOut: "USDC",
				amount: "1000000000000000000",
			},
			status: "success",
			txHash:
				"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		});
		expect(artifact.type).toBe("debridge_crosschain_execute");
		expect(validateDebridgeExecutionArtifactV1(artifact)).toBe(true);
	});

	it("reconciles success artifact and validates reconciliation", () => {
		const artifact = buildDebridgeExecutionArtifact({
			payload: {},
			status: "success",
			txHash:
				"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		});
		const reconciliation = reconcileDebridgeExecutionArtifact(artifact);
		expect(reconciliation.ok).toBe(true);
		expect(reconciliation.issues).toEqual([]);
		expect(validateDebridgeExecutionReconciliationV1(reconciliation)).toBe(
			true,
		);
	});

	it("marks tx_hash_missing issue when success has no tx hash", () => {
		const artifact = buildDebridgeExecutionArtifact({
			payload: {},
			status: "success",
		});
		const reconciliation = reconcileDebridgeExecutionArtifact(artifact);
		expect(reconciliation.ok).toBe(true);
		expect(reconciliation.txHashPresent).toBe(false);
		expect(reconciliation.issues).toContain("tx_hash_missing");
	});

	it("classifies retryable/non-retryable execution errors", () => {
		expect(
			classifyDebridgeExecuteError("Request timed out after 120s"),
		).toEqual(
			expect.objectContaining({
				code: "debridge_execute_timeout",
				retryable: true,
			}),
		);
		expect(
			classifyDebridgeExecuteError("insufficient funds for transfer"),
		).toEqual(
			expect.objectContaining({
				code: "debridge_execute_insufficient_funds",
				retryable: false,
			}),
		);
	});

	it("rejects invalid artifact/reconciliation", () => {
		expect(validateDebridgeExecutionArtifactV1({})).toBe(false);
		expect(validateDebridgeExecutionReconciliationV1({})).toBe(false);
	});
});
