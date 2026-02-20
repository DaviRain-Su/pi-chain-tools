import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverPath = path.resolve("apps", "dashboard", "server.mjs");
const serverSource = readFileSync(serverPath, "utf8");

describe("dashboard bsc autonomous track routing", () => {
	it("keeps legacy compatibility fields present", () => {
		expect(serverSource).toContain("legacyCompatible");
		expect(serverSource).toContain('track: "legacy"');
		expect(serverSource).toContain('governance: "onchain_only"');
		expect(serverSource).toContain('trigger: "external"');
	});

	it("supports flag-on autonomous routing markers", () => {
		expect(serverSource).toContain("BSC_AUTONOMOUS_MODE");
		expect(serverSource).toContain("runBscAutonomousExecution");
		expect(serverSource).toContain('track: "autonomous"');
		expect(serverSource).toContain('governance: "hybrid"');
		expect(serverSource).toContain('trigger: "deterministic_contract_cycle"');
	});
});
