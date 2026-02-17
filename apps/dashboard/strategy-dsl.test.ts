import { describe, expect, it } from "vitest";

import {
	buildStrategyDslFromLegacy,
	validateStrategyDslV1,
} from "./strategy-dsl.mjs";

describe("strategy dsl v1 validator", () => {
	it("accepts a valid dsl", () => {
		const result = validateStrategyDslV1({
			id: "stable-001",
			name: "USDT->USDC.e Rebalance",
			creator: "davi",
			version: "1.0.0",
			targetChain: "near",
			intentType: "rebalance.usdt_to_usdce",
			pricing: { priceUsd: 12.5, currency: "USDC" },
			risk: { maxAmountUsd: 1000, maxSlippageBps: 80, dailyRunLimit: 3 },
			execution: { mode: "plan-only" },
			inputs: { tokenIn: "USDt", tokenOut: "USDC.e" },
		});
		expect(result.ok).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.normalized.pricing.currency).toBe("USDC");
	});

	it("rejects invalid risk bounds", () => {
		const result = validateStrategyDslV1({
			id: "s1",
			name: "x",
			creator: "y",
			version: "1",
			targetChain: "near",
			intentType: "rebalance.usdt_to_usdce",
			pricing: { priceUsd: 1, currency: "USDC" },
			risk: { maxAmountUsd: 100, maxSlippageBps: 2000, dailyRunLimit: 0 },
			execution: { mode: "execute" },
		});
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain("maxSlippageBps");
		expect(result.errors.join(" ")).toContain("dailyRunLimit");
	});

	it("builds legacy payload into dsl shape", () => {
		const dsl = buildStrategyDslFromLegacy({
			id: "legacy-a",
			name: "legacy",
			creator: "alice",
			priceUsd: 10,
			targetChain: "bsc",
			intentType: "swap.stable",
		});
		const result = validateStrategyDslV1(dsl);
		expect(result.ok).toBe(true);
		expect(result.normalized.targetChain).toBe("bsc");
	});
});
