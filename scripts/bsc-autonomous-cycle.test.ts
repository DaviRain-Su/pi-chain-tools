import { describe, expect, it } from "vitest";

import { runBscAutonomousCycle } from "./bsc-autonomous-cycle.mjs";

describe("bsc-autonomous-cycle", () => {
	it("produces deterministic dryrun proof artifact fields", async () => {
		const out = "/tmp/bsc-autonomous-cycle-test.json";
		const result = await runBscAutonomousCycle(
			["--mode", "dryrun", "--run-id", "cycle-test-1", "--out", out],
			{},
		);
		expect(result.ok).toBe(true);
		expect(result.proof.mode).toBe("dryrun");
		expect(result.proof.decision).toBe("simulate_execute");
		expect(result.proof.txEvidence).toBeTruthy();
		expect(result.proof.txEvidence.receiptNormalized?.schema).toBe(
			"tx-receipt-normalized/v1",
		);
		expect(result.proof.reconcileSummary).toBeTruthy();
		expect(result.proof.reconcileSummary.reconcileSnapshot).toBeTruthy();
		expect(result.proof.coreRouteSelection?.selectedFundingRoute).toBe(
			"asterdex_earn_core",
		);
		expect(
			Array.isArray(result.proof.coreRouteSelection?.evidenceMarkers),
		).toBe(true);
	});
});
