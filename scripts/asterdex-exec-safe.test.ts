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

	it("allows live execution from verifiable onchain trigger without manual confirm", () => {
		const result = runAsterDexExecSafe(
			[
				"--mode",
				"live",
				"--confirm",
				"WRONG_CONFIRM",
				"--intent-json",
				JSON.stringify({
					runId: "r3",
					amountRaw: "1",
					tokenIn: "USDC",
					tokenOut: "USDT",
				}),
				"--trigger-proof-json",
				JSON.stringify({
					txHash: `0x${"ab".repeat(32)}`,
					cycleId: "cycle-bsc-mainnet-v1",
					transitionId: "step-1",
					stateDelta: { previousState: "IDLE", nextState: "EXECUTING" },
				}),
			],
			{
				BSC_AUTONOMOUS_ASTERDEX_EXECUTE_ACTIVE: "true",
				BSC_AUTONOMOUS_ASTERDEX_LIVE_COMMAND:
					"node -e \"console.log('0x' + 'cd'.repeat(32))\"",
			},
		);
		expect(result.ok).toBe(true);
		expect(result.status).toBe("executed");
		expect(result.evidence?.confirmationMode).toBe("onchain_trigger");
	});
});
