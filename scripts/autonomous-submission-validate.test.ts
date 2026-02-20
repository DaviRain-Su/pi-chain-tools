import { describe, expect, it } from "vitest";

import { validateAutonomousSubmission } from "./autonomous-submission-validate.mjs";

describe("autonomous-submission-validate", () => {
	it("returns checklist result with four Hyperliquid readiness criteria in default offchain mode", async () => {
		const result = await validateAutonomousSubmission();
		expect(result.mode).toBe("offchain");
		expect(result.criteria).toContain("offchain");
		expect(["PASS", "WARN"]).toContain(result.status);
		expect(Array.isArray(result.checks)).toBe(true);
		expect(result.checks).toHaveLength(4);
		expect(result.score.requiredTotal).toBeGreaterThanOrEqual(2);
	});

	it("switches to onchain criteria with stricter required checks", async () => {
		const result = await validateAutonomousSubmission({ mode: "onchain" });
		expect(result.mode).toBe("onchain");
		expect(result.criteria).toContain("onchain");
		expect(result.checks).toHaveLength(4);
		expect(result.score.requiredTotal).toBe(4);
	});
});
