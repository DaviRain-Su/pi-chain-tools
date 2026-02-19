import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverPath = path.resolve("apps", "dashboard", "server.mjs");
const serverSource = readFileSync(serverPath, "utf8");
const uiPath = path.resolve("apps", "dashboard", "index.html");
const uiSource = readFileSync(uiPath, "utf8");

describe("dashboard PI-MCP safe-only routes + UI card", () => {
	it("exposes discover + run endpoints", () => {
		expect(serverSource).toContain("/api/pi-mcp/discover");
		expect(serverSource).toContain("/api/pi-mcp/run");
	});

	it("hard-blocks execute/mutate intents with stable code", () => {
		expect(serverSource).toContain("PI_MCP_EXECUTE_BLOCKED");
		expect(serverSource).toContain(
			"Execute/mutate is hard-blocked on dashboard PI-MCP boundary",
		);
		expect(serverSource).toContain("safe-only-read-plan");
	});

	it("renders PI-MCP card counters in dashboard UI", () => {
		expect(uiSource).toContain("PI-MCP (Safe-only)");
		expect(uiSource).toContain('id="piMcpCard"');
		expect(uiSource).toContain("discoveredTaskCount");
		expect(uiSource).toContain("recentRuns");
		expect(uiSource).toContain("executeRejectionCount");
		expect(uiSource).toContain("/api/pi-mcp/discover");
	});
});
