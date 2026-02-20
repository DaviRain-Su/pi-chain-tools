import { describe, expect, it } from "vitest";

import {
	evaluateCycleTransitionEvidence,
	parseCycleTriggerProof,
} from "./autonomous-cycle-trigger-adapter.mjs";

describe("autonomous-cycle-trigger-adapter", () => {
	it("parses valid trigger proof with state transition evidence", () => {
		const proof = parseCycleTriggerProof(
			JSON.stringify({
				txHash: `0x${"ab".repeat(32)}`,
				cycleId: "cycle-bsc-mainnet-v1",
				transitionId: "step-42",
				eventName: "CycleTriggered",
				stateDelta: { previousState: "IDLE", nextState: "EXECUTING" },
				emittedEvents: [{ name: "CycleTriggered", args: { cycleId: "x" } }],
			}),
		);
		expect(proof.valid).toBe(true);
		expect(proof.stateDelta?.label).toBe("IDLE->EXECUTING");
	});

	it("flags missing fields and returns non-verifiable transition evidence", () => {
		const parsed = parseCycleTriggerProof(JSON.stringify({ cycleId: "x" }));
		expect(parsed.valid).toBe(false);
		const transition = evaluateCycleTransitionEvidence({ proof: parsed });
		expect(transition.verifiable).toBe(false);
		expect(transition.blockers.length).toBeGreaterThan(0);
	});
});
