import { describe, expect, it } from "vitest";

import openclawExtension from "./index.ts";

type Registered = {
	name: string;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
	) => Promise<{ content: { text: string }[] }>;
};

type MockRegistrar = {
	registerTool: (tool: Registered) => void;
	tools: Registered[];
};

function createRegistrar(): MockRegistrar {
	const tools: Registered[] = [];
	(globalThis as Record<PropertyKey, unknown>)[
		Symbol.for("pi-chain-tools/openclaw-near/registered")
	] = false;
	return {
		registerTool(tool) {
			tools.push(tool);
		},
		tools,
	};
}

function baseSpec(maxPerRunUsd = 100) {
	return {
		id: "strategy.rebalance.test",
		name: "test",
		version: "0.1.0",
		owner: { namespace: "community", author: "pi-chain-tools" },
		goal: { kind: "rebalance", description: "test" },
		constraints: {
			risk: { maxPerRunUsd, maxSlippageBps: 80, maxDailyRuns: 3 },
			allow: {
				chains: ["base", "bsc"],
				protocols: ["lifi"],
				assets: ["USDC"],
			},
		},
		triggers: [{ type: "manual" }],
		plan: {
			steps: [{ id: "s1", action: "quote", component: "cap.lifi.bridge-swap" }],
		},
		metadata: { template: "rebalance-crosschain-v0" },
	};
}

describe("openclaw strategy tools", () => {
	it("registers strategy tools", () => {
		const registrar = createRegistrar();
		openclawExtension(registrar);
		const names = registrar.tools.map((t) => t.name);
		expect(names).toContain("pct_strategy_compile");
		expect(names).toContain("pct_strategy_validate");
		expect(names).toContain("pct_strategy_templates");
		expect(names).toContain("pct_strategy_run");
		expect(names).toContain("pct_strategy_track");
	});

	it("blocks execute when confirm token missing", async () => {
		const registrar = createRegistrar();
		openclawExtension(registrar);
		const runTool = registrar.tools.find((t) => t.name === "pct_strategy_run");
		if (!runTool) throw new Error("pct_strategy_run not registered");
		const result = await runTool.execute("t1", {
			spec: baseSpec(),
			mode: "execute",
		});
		const payload = JSON.parse(result.content[0].text) as Record<
			string,
			unknown
		>;
		expect(payload.status).toBe("blocked");
		expect(payload.requiredToken).toBe("I_ACKNOWLEDGE_EXECUTION");
	});

	it("filters strategy templates by riskTier", async () => {
		const registrar = createRegistrar();
		openclawExtension(registrar);
		const t = registrar.tools.find((x) => x.name === "pct_strategy_templates");
		if (!t) throw new Error("pct_strategy_templates not registered");
		const result = await t.execute("t3", {
			riskTier: "low",
			strategyType: "yield",
		});
		const payload = JSON.parse(result.content[0].text) as Record<
			string,
			unknown
		>;
		expect(payload.status).toBe("ok");
		const templates = payload.templates as Record<string, unknown>[];
		expect(Array.isArray(templates)).toBe(true);
		expect(templates.length).toBeGreaterThan(0);
		for (const item of templates) {
			expect(item.riskTier).toBe("low");
			expect(item.strategyType).toBe("yield");
		}
	});

	it("supports template sorting and pagination", async () => {
		const registrar = createRegistrar();
		openclawExtension(registrar);
		const t = registrar.tools.find((x) => x.name === "pct_strategy_templates");
		if (!t) throw new Error("pct_strategy_templates not registered");
		const result = await t.execute("t4", {
			sortBy: "recommendedMinUsd",
			sortOrder: "asc",
			limit: 1,
			offset: 0,
		});
		const payload = JSON.parse(result.content[0].text) as Record<
			string,
			unknown
		>;
		expect(payload.status).toBe("ok");
		const page = payload.page as Record<string, unknown>;
		expect(page.limit).toBe(1);
		const templates = payload.templates as Record<string, unknown>[];
		expect(templates.length).toBe(1);
	});

	it("blocks live execute when small-cap policy exceeded", async () => {
		const registrar = createRegistrar();
		openclawExtension(registrar);
		const runTool = registrar.tools.find((t) => t.name === "pct_strategy_run");
		if (!runTool) throw new Error("pct_strategy_run not registered");
		const result = await runTool.execute("t2", {
			spec: baseSpec(101),
			mode: "execute",
			live: true,
			confirmExecuteToken: "I_ACKNOWLEDGE_EXECUTION",
		});
		const payload = JSON.parse(result.content[0].text) as Record<
			string,
			unknown
		>;
		expect(payload.status).toBe("blocked");
		expect(String(payload.reason)).toContain("live execution cap exceeded");
	});
});
