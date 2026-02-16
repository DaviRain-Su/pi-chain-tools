import { describe, expect, it } from "vitest";
import {
	type AgentConfig,
	DEFAULT_AGENT_CONFIG,
	calculateOptimizeAmount,
	calculateRepayAmount,
	computeLTV,
	computeYieldSpread,
	decideLtvAction,
} from "./ltv-manager.js";

describe("ltv-manager computeLTV", () => {
	it("returns 0 when no collateral", () => {
		expect(computeLTV(0, 100)).toBe(0);
	});

	it("computes correct LTV", () => {
		expect(computeLTV(1000, 500)).toBe(0.5);
		expect(computeLTV(1000, 750)).toBe(0.75);
		expect(computeLTV(2000, 100)).toBe(0.05);
	});

	it("returns 0 when no borrow", () => {
		expect(computeLTV(1000, 0)).toBe(0);
	});
});

describe("ltv-manager computeYieldSpread", () => {
	it("converts from percentage to ratio", () => {
		// supplyAPY=5%, borrowAPR=3% → spread = 0.02
		expect(computeYieldSpread(5, 3)).toBeCloseTo(0.02);
	});

	it("returns negative spread when borrow costs exceed yield", () => {
		expect(computeYieldSpread(2, 5)).toBeCloseTo(-0.03);
	});

	it("returns zero for equal rates", () => {
		expect(computeYieldSpread(3, 3)).toBe(0);
	});
});

describe("ltv-manager calculateRepayAmount", () => {
	it("calculates repay to reach target LTV", () => {
		// $1000 collateral, $800 borrow, target LTV=0.6
		// target borrow = 0.6 * 1000 = 600, repay = 800 - 600 = 200
		expect(calculateRepayAmount(1000, 800, 0.6)).toBe(200);
	});

	it("returns 0 when already below target", () => {
		expect(calculateRepayAmount(1000, 400, 0.6)).toBe(0);
	});

	it("returns 0 with no collateral", () => {
		expect(calculateRepayAmount(0, 0, 0.6)).toBe(0);
	});
});

describe("ltv-manager calculateOptimizeAmount", () => {
	it("calculates additional borrow to reach target LTV", () => {
		// $1000 collateral, $200 borrow, target LTV=0.6
		// target borrow = 0.6 * 1000 = 600, additional = 600 - 200 = 400
		expect(calculateOptimizeAmount(1000, 200, 0.6)).toBe(400);
	});

	it("returns 0 when already at target", () => {
		expect(calculateOptimizeAmount(1000, 600, 0.6)).toBe(0);
	});

	it("returns 0 when above target", () => {
		expect(calculateOptimizeAmount(1000, 800, 0.6)).toBe(0);
	});
});

describe("ltv-manager decideLtvAction", () => {
	const baseConfig: AgentConfig = {
		maxLTV: 0.75,
		targetLTV: 0.6,
		minYieldSpread: 0.02,
		paused: false,
	};

	it("returns hold when agent is paused", () => {
		const result = decideLtvAction({
			collateralValueUsd: 1000,
			borrowValueUsd: 500,
			supplyAPY: 5,
			borrowAPR: 3,
			config: { ...baseConfig, paused: true },
		});
		expect(result.action).toBe("hold");
		expect(result.reason).toContain("paused");
	});

	it("returns hold when no position exists", () => {
		const result = decideLtvAction({
			collateralValueUsd: 0,
			borrowValueUsd: 0,
			supplyAPY: 0,
			borrowAPR: 0,
			config: baseConfig,
		});
		expect(result.action).toBe("hold");
		expect(result.reason).toContain("No active position");
	});

	it("returns repay when LTV exceeds safety threshold", () => {
		// maxLTV=0.75, safety=0.75*0.95=0.7125
		// LTV = 800/1000 = 0.80 > 0.7125
		const result = decideLtvAction({
			collateralValueUsd: 1000,
			borrowValueUsd: 800,
			supplyAPY: 5,
			borrowAPR: 3,
			config: baseConfig,
		});
		expect(result.action).toBe("repay");
		if (result.action === "repay") {
			expect(result.repayAmountUsd).toBe(200); // 800 - (0.6 * 1000)
			expect(result.reason).toContain("safety threshold");
		}
	});

	it("returns optimize when LTV is low and yield spread is good", () => {
		// LTV = 200/1000 = 0.20 < 0.6*0.8 = 0.48 (optimize threshold)
		// spread = (5-3)/100 = 0.02 = minYieldSpread → just meets threshold
		const result = decideLtvAction({
			collateralValueUsd: 1000,
			borrowValueUsd: 200,
			supplyAPY: 5,
			borrowAPR: 2.9, // spread = 0.021 > 0.02
			config: baseConfig,
		});
		expect(result.action).toBe("optimize");
		if (result.action === "optimize") {
			expect(result.borrowMoreUsd).toBe(400); // (0.6*1000) - 200
			expect(result.reason).toContain("Borrow");
		}
	});

	it("returns hold when LTV is low but yield spread is insufficient", () => {
		// LTV = 200/1000 = 0.20 < optimize threshold
		// spread = (3-2)/100 = 0.01 < 0.02 minYieldSpread
		const result = decideLtvAction({
			collateralValueUsd: 1000,
			borrowValueUsd: 200,
			supplyAPY: 3,
			borrowAPR: 2,
			config: baseConfig,
		});
		expect(result.action).toBe("hold");
		expect(result.reason).toContain("safe range");
	});

	it("returns hold when LTV is in normal range", () => {
		// LTV = 550/1000 = 0.55
		// optimize threshold = 0.48, safety threshold = 0.7125
		// 0.48 < 0.55 < 0.7125 → hold
		const result = decideLtvAction({
			collateralValueUsd: 1000,
			borrowValueUsd: 550,
			supplyAPY: 5,
			borrowAPR: 3,
			config: baseConfig,
		});
		expect(result.action).toBe("hold");
		expect(result.reason).toContain("safe range");
	});

	it("returns hold when at exactly the optimize threshold boundary", () => {
		// LTV = 480/1000 = 0.48 = optimize threshold exactly
		// Not strictly < threshold, so hold
		const result = decideLtvAction({
			collateralValueUsd: 1000,
			borrowValueUsd: 480,
			supplyAPY: 5,
			borrowAPR: 3,
			config: baseConfig,
		});
		expect(result.action).toBe("hold");
	});

	it("defaults match DEFAULT_AGENT_CONFIG", () => {
		expect(DEFAULT_AGENT_CONFIG.maxLTV).toBe(0.75);
		expect(DEFAULT_AGENT_CONFIG.targetLTV).toBe(0.6);
		expect(DEFAULT_AGENT_CONFIG.minYieldSpread).toBe(0.02);
		expect(DEFAULT_AGENT_CONFIG.paused).toBe(false);
	});

	it("repay amount is always non-negative", () => {
		const result = decideLtvAction({
			collateralValueUsd: 1000,
			borrowValueUsd: 720, // LTV 0.72 > 0.7125 safety
			supplyAPY: 5,
			borrowAPR: 3,
			config: baseConfig,
		});
		expect(result.action).toBe("repay");
		if (result.action === "repay") {
			expect(result.repayAmountUsd).toBeGreaterThanOrEqual(0);
		}
	});

	it("optimize with custom config", () => {
		const customConfig: AgentConfig = {
			maxLTV: 0.8,
			targetLTV: 0.5,
			minYieldSpread: 0.01, // 1%
			paused: false,
		};
		// LTV = 100/1000 = 0.10 < 0.5*0.8 = 0.40
		// spread = (4-2)/100 = 0.02 > 0.01
		const result = decideLtvAction({
			collateralValueUsd: 1000,
			borrowValueUsd: 100,
			supplyAPY: 4,
			borrowAPR: 2,
			config: customConfig,
		});
		expect(result.action).toBe("optimize");
		if (result.action === "optimize") {
			expect(result.borrowMoreUsd).toBe(400); // (0.5*1000) - 100
		}
	});
});
