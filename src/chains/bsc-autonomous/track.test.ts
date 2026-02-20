import { describe, expect, it } from "vitest";

import {
	evaluateBscAutonomousPolicy,
	getBscExecutionMarkers,
	isBscAutonomousModeEnabled,
	parseDeterministicCycleConfig,
} from "./track.js";

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

	it("requires deterministic cycle config when autonomous mode is on", () => {
		const result = evaluateBscAutonomousPolicy({
			env: { BSC_AUTONOMOUS_MODE: "true" },
			requestTrigger: "deterministic_contract_cycle",
		});
		expect(result.allowed).toBe(false);
		expect(result.blockers.map((x) => x.code)).toContain(
			"AUTONOMOUS_CYCLE_CONFIG_MISSING",
		);
		expect(result.blockers[0]?.remediation).toContain(
			"BSC_AUTONOMOUS_CYCLE_ID",
		);
		expect(result.evidence.cycleConfigPresent).toBe(false);
	});

	it("blocks external/manual triggers in autonomous mode", () => {
		const result = evaluateBscAutonomousPolicy({
			env: {
				BSC_AUTONOMOUS_MODE: "true",
				BSC_AUTONOMOUS_CYCLE_ID: "cycle-bsc-mainnet-v1",
				BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS: "300",
			},
			requestTrigger: "external",
		});
		expect(result.allowed).toBe(false);
		expect(result.blockers.map((x) => x.code)).toContain(
			"AUTONOMOUS_EXTERNAL_TRIGGER_BLOCKED",
		);
		expect(result.evidence.requestTrigger).toBe("external");
	});

	it("emits Hyperliquid execute binding blocker when required but missing", () => {
		const result = evaluateBscAutonomousPolicy({
			env: {
				BSC_AUTONOMOUS_MODE: "true",
				BSC_AUTONOMOUS_CYCLE_ID: "cycle-bsc-mainnet-v1",
				BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS: "300",
				BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_REQUIRED: "true",
			},
			requestTrigger: "deterministic_contract_cycle",
		});
		expect(result.allowed).toBe(false);
		expect(result.blockers.map((x) => x.code)).toContain(
			"AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_UNAVAILABLE",
		);
		expect(result.blockers[0]?.remediation).toContain(
			"BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_ENABLED",
		);
	});

	it("accepts prepared Hyperliquid execute binding when required", () => {
		const result = evaluateBscAutonomousPolicy({
			env: {
				BSC_AUTONOMOUS_MODE: "true",
				BSC_AUTONOMOUS_CYCLE_ID: "cycle-bsc-mainnet-v1",
				BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS: "300",
				BSC_AUTONOMOUS_HYPERLIQUID_ENABLED: "true",
				BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_ENABLED: "true",
				BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_REQUIRED: "true",
				BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_COMMAND: "node scripts/exec.mjs",
				BSC_AUTONOMOUS_HYPERLIQUID_ROUTER_ADDRESS: "0xrouter",
				BSC_AUTONOMOUS_HYPERLIQUID_EXECUTOR_ADDRESS: "0xexecutor",
			},
			requestTrigger: "deterministic_contract_cycle",
		});
		expect(result.allowed).toBe(true);
		expect(result.evidence.hyperliquidExecuteBinding).toBe("prepared");
		expect(result.evidence.hyperliquidExecuteBindingReady).toBe(true);
	});

	it("marks active Hyperliquid execute binding when active flag is set", () => {
		const result = evaluateBscAutonomousPolicy({
			env: {
				BSC_AUTONOMOUS_MODE: "true",
				BSC_AUTONOMOUS_CYCLE_ID: "cycle-bsc-mainnet-v1",
				BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS: "300",
				BSC_AUTONOMOUS_HYPERLIQUID_ENABLED: "true",
				BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_ENABLED: "true",
				BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_REQUIRED: "true",
				BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_ACTIVE: "true",
				BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_COMMAND:
					"node scripts/hyperliquid-exec-safe.mjs",
				BSC_AUTONOMOUS_HYPERLIQUID_ROUTER_ADDRESS: "0xrouter",
				BSC_AUTONOMOUS_HYPERLIQUID_EXECUTOR_ADDRESS: "0xexecutor",
			},
			requestTrigger: "deterministic_contract_cycle",
		});
		expect(result.allowed).toBe(true);
		expect(result.evidence.hyperliquidExecuteBinding).toBe("active");
		expect(result.evidence.hyperliquidExecuteBindingReady).toBe(true);
	});

	it("keeps compatibility when binding requirement flag is off", () => {
		const result = evaluateBscAutonomousPolicy({
			env: {
				BSC_AUTONOMOUS_MODE: "true",
				BSC_AUTONOMOUS_CYCLE_ID: "cycle-bsc-mainnet-v1",
				BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS: "300",
			},
			requestTrigger: "deterministic_contract_cycle",
		});
		expect(result.allowed).toBe(true);
		expect(result.evidence.hyperliquidExecuteBindingRequired).toBe(false);
	});

	it("marks deterministic autonomous request as ready with evidence", () => {
		const result = evaluateBscAutonomousPolicy({
			env: {
				BSC_AUTONOMOUS_MODE: "true",
				BSC_AUTONOMOUS_CYCLE_ID: "cycle-bsc-mainnet-v1",
				BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS: "300",
			},
			requestTrigger: "deterministic_contract_cycle",
		});
		expect(result.allowed).toBe(true);
		expect(result.blockers).toHaveLength(0);
		expect(result.evidence).toMatchObject({
			autonomousMode: true,
			requestTrigger: "deterministic_contract_cycle",
			cycleConfigPresent: true,
			deterministicReady: true,
			hyperliquidExecuteBinding: "none",
		});
	});

	it("parses deterministic cycle config from env", () => {
		expect(
			parseDeterministicCycleConfig({
				env: {
					BSC_AUTONOMOUS_CYCLE_ID: "cycle-bsc-mainnet-v1",
					BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS: "300",
				},
			}),
		).toEqual({
			cycleId: "cycle-bsc-mainnet-v1",
			intervalSeconds: 300,
		});
	});
});
