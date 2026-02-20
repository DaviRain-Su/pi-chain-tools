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
			"hyperliquid_earn_core",
		);
		expect(
			Array.isArray(result.proof.coreRouteSelection?.evidenceMarkers),
		).toBe(true);
	});

	it("uses contract emitted transition evidence in live mode", async () => {
		const out = "/tmp/bsc-autonomous-cycle-live-test.json";
		const unique = Date.now();
		const result = await runBscAutonomousCycle(
			[
				"--mode",
				"live",
				"--run-id",
				`cycle-live-${unique}`,
				"--out",
				out,
				"--state-path",
				`/tmp/bsc-autonomous-cycle-live-state-${unique}.json`,
			],
			{
				BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_ACTIVE: "true",
				BSC_AUTONOMOUS_HYPERLIQUID_LIVE_COMMAND:
					"node -e \"console.log(JSON.stringify({txHash:'0x' + 'ef'.repeat(32),emittedEvents:['CycleStateTransition','ExecutionDecision'],stateDelta:{previousState:'0',nextState:'0'},transition:{cycleId:'cycle-live',transitionId:'1',eventName:'CycleStateTransition',emittedEvents:['CycleStateTransition'],stateDelta:{previousState:'0',nextState:'0'}}}))\"",
				BSC_AUTONOMOUS_HYPERLIQUID_CONFIRM_TEXT: "HYPERLIQUID_EXECUTE_LIVE",
				BSC_AUTONOMOUS_CONTRACT_ENTRYPOINT_ENABLED: "true",
				BSC_AUTONOMOUS_CYCLE_MIN_LIVE_INTERVAL_SECONDS: "1",
			},
		);
		expect(result.ok).toBe(true);
		expect(result.proof.cycleTransitionEvidence?.verifiable).toBe(true);
		expect(result.proof.txEvidence?.emittedEvents).toContain(
			"CycleStateTransition",
		);
		expect(result.proof.txEvidence?.stateDelta?.previousState).toBe("0");
	});
});
