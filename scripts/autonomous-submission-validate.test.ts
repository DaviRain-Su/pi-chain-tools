import { describe, expect, it } from "vitest";

import { validateAutonomousSubmission } from "./autonomous-submission-validate.mjs";

describe("autonomous-submission-validate", () => {
	it("returns checklist result with four Hyperliquid readiness criteria", async () => {
		const result = await validateAutonomousSubmission();
		expect(["PASS", "WARN"]).toContain(result.status);
		expect(Array.isArray(result.checks)).toBe(true);
		expect(result.checks).toHaveLength(4);
	});
});
