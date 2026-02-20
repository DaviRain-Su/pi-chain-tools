import { describe, expect, it } from "vitest";

import { getBscExecutionMarkers, isBscAutonomousModeEnabled } from "./track.js";

describe("bsc autonomous mode routing", () => {
	it("keeps legacy markers when flag is off/missing", () => {
		expect(isBscAutonomousModeEnabled({ env: {} })).toBe(false);
		expect(
			getBscExecutionMarkers(isBscAutonomousModeEnabled({ env: {} })),
		).toEqual({
			track: "legacy",
			governance: "onchain_only",
			trigger: "external",
		});
	});

	it("switches to autonomous markers when flag is on", () => {
		const enabled = isBscAutonomousModeEnabled({
			env: { BSC_AUTONOMOUS_MODE: "true" },
		});
		expect(enabled).toBe(true);
		expect(getBscExecutionMarkers(enabled)).toEqual({
			track: "autonomous",
			governance: "hybrid",
			trigger: "deterministic_contract_cycle",
		});
	});
});
