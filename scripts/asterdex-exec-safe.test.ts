import { describe, expect, it } from "vitest";

import { runAsterDexExecSafe } from "./asterdex-exec-safe.mjs";

describe("asterdex-exec-safe", () => {
	it("returns blocked when live mode is not fully configured", () => {
		const result = runAsterDexExecSafe(
			[
				"--mode",
				"live",
				"--confirm",
				"ASTERDEX_EXECUTE_LIVE",
				"--intent-json",
				JSON.stringify({
					runId: "r1",
					amountRaw: "1",
					tokenIn: "USDC",
					tokenOut: "USDT",
				}),
			],
			{},
		);
		expect(result.ok).toBe(false);
		expect(result.status).toBe("blocked");
		expect(result.reason).toBe("execute_binding_not_active");
	});

	it("supports dryrun mode and emits evidence", () => {
		const result = runAsterDexExecSafe(
			[
				"--mode",
				"dryrun",
				"--intent-json",
				JSON.stringify({
					runId: "r2",
					amountRaw: "100",
					tokenIn: "USDC",
					tokenOut: "USDT",
				}),
			],
			{},
		);
		expect(result.ok).toBe(true);
		expect(result.status).toBe("dryrun");
		expect(result.evidence?.runId).toBe("r2");
	});
});
