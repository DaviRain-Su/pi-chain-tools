import { describe, expect, it } from "vitest";

import { runHyperliquidExecSafe } from "./hyperliquid-exec-safe.mjs";

describe("hyperliquid-exec-safe", () => {
	it("returns blocked when live mode is not fully configured", () => {
		const result = runHyperliquidExecSafe(
			[
				"--mode",
				"live",
				"--confirm",
				"HYPERLIQUID_EXECUTE_LIVE",
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
		const result = runHyperliquidExecSafe(
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
		const result = runHyperliquidExecSafe(
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
					cycleId: "cycle-hyperliquid-mainnet-v1",
					transitionId: "step-1",
					stateDelta: { previousState: "IDLE", nextState: "EXECUTING" },
				}),
			],
			{
				HYPERLIQUID_AUTONOMOUS_EXECUTE_ACTIVE: "true",
				HYPERLIQUID_AUTONOMOUS_LIVE_COMMAND:
					"node -e \"console.log(JSON.stringify({txHash:'0x' + 'cd'.repeat(32),emittedEvents:['CycleStateTransition','ExecutionDecision'],stateDelta:{previousState:'0',nextState:'0'}}))\"",
			},
		);
		expect(result.ok).toBe(true);
		expect(result.status).toBe("executed");
		expect(result.evidence?.confirmationMode).toBe("onchain_trigger");
		expect(result.evidence?.decodedEvents).toContain("CycleStateTransition");
		expect(result.evidence?.stateDelta?.previousState).toBe("0");
	});
});
