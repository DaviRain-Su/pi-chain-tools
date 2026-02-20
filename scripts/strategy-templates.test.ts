import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts", "strategy-templates.mjs");

function run(args: string[] = []) {
	return spawnSync(process.execPath, [SCRIPT, ...args], {
		cwd: path.resolve("."),
		encoding: "utf8",
	});
}

describe("strategy templates cli", () => {
	it("lists template manifests", () => {
		const r = run(["--json"]);
		expect(r.status).toBe(0);
		const payload = JSON.parse(r.stdout);
		expect(payload.status).toBe("ok");
		expect(Array.isArray(payload.templates)).toBe(true);
		expect(payload.templates.length).toBeGreaterThan(0);
	});

	it("fetches stable-yield manifest", () => {
		const r = run(["--template", "stable-yield-v1", "--json"]);
		expect(r.status).toBe(0);
		const payload = JSON.parse(r.stdout);
		expect(payload.status).toBe("ok");
		expect(payload.manifest.template).toBe("stable-yield-v1");
	});

	it("filters templates by risk tier and type", () => {
		const r = run([
			"--riskTier",
			"low",
			"--strategyType",
			"yield",
			"--status",
			"active",
			"--json",
		]);
		expect(r.status).toBe(0);
		const payload = JSON.parse(r.stdout);
		expect(payload.status).toBe("ok");
		expect(payload.templates.length).toBeGreaterThan(0);
		for (const item of payload.templates) {
			expect(item.riskTier).toBe("low");
			expect(item.strategyType).toBe("yield");
			expect(item.status).toBe("active");
		}
	});
});
