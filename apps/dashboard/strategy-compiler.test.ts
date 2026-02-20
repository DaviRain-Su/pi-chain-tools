import { describe, expect, it } from "vitest";

import {
	compileStrategySpecV0,
	validatePlanAgainstCapabilities,
} from "./strategy-compiler.mjs";

describe("strategy compiler v0", () => {
	it("compiles rebalance template", () => {
		const result = compileStrategySpecV0({
			template: "rebalance-crosschain-v0",
			fromChain: "base",
			toChain: "bsc",
			asset: "USDC",
			maxPerRunUsd: 2500,
		});
		expect(result.ok).toBe(true);
		expect(result.spec.plan.steps).toHaveLength(3);
		expect(result.spec.constraints.allow.protocols).toContain("lifi");
	});

	it("compiles lending template", () => {
		const result = compileStrategySpecV0({
			template: "lending-risk-balance-v0",
			asset: "USDT",
		});
		expect(result.ok).toBe(true);
		expect(result.spec.plan.steps).toHaveLength(4);
		expect(result.spec.constraints.allow.protocols).toEqual([
			"venus",
			"morpho",
		]);
	});

	it("fails for unsupported template", () => {
		const result = compileStrategySpecV0({ template: "unknown-template" });
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain("unsupported template");
	});

	it("validates plan actions against capability manifests", () => {
		const compiled = compileStrategySpecV0({
			template: "rebalance-crosschain-v0",
		});
		expect(compiled.ok).toBe(true);

		const check = validatePlanAgainstCapabilities(compiled.spec, [
			{ id: "cap.lifi.bridge-swap", actions: ["quote", "execute", "status"] },
		]);
		expect(check.ok).toBe(true);
		expect(check.errors).toHaveLength(0);
	});

	it("catches missing manifest and unsupported action", () => {
		const compiled = compileStrategySpecV0({
			template: "lending-risk-balance-v0",
		});
		expect(compiled.ok).toBe(true);

		const check = validatePlanAgainstCapabilities(compiled.spec, [
			{ id: "cap.venus.lending", actions: ["read", "repay"] },
			{ id: "cap.morpho.lending", actions: ["read"] },
		]);
		expect(check.ok).toBe(false);
		expect(check.errors.join("\n")).toContain(
			"action 'supply' is not supported",
		);
	});
});
