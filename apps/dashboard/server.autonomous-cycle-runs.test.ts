import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverPath = path.resolve("apps", "dashboard", "server.mjs");
const uiPath = path.resolve("apps", "dashboard", "index.html");

describe("dashboard autonomous cycle observability", () => {
	it("exposes autonomous cycle recent runs endpoint", () => {
		const serverSource = readFileSync(serverPath, "utf8");
		expect(serverSource).toContain('"/api/autonomous/cycle/runs"');
		expect(serverSource).toContain("readAutonomousCycleRunsLatest");
		expect(serverSource).toContain("malformedSkippedCount");
	});

	it("renders compact autonomous cycle runs table", () => {
		const uiSource = readFileSync(uiPath, "utf8");
		expect(uiSource).toContain("autonomousCycleRunsRows");
		expect(uiSource).toContain("Autonomous Cycle Recent Runs");
		expect(uiSource).toContain("malformed skipped");
	});
});
