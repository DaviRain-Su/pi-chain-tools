import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverPath = path.resolve("apps", "dashboard", "server.mjs");
const serverSource = readFileSync(serverPath, "utf8");
const uiPath = path.resolve("apps", "dashboard", "index.html");
const uiSource = readFileSync(uiPath, "utf8");

describe("dashboard security watch endpoints + UI", () => {
	it("exposes status and latest report endpoints", () => {
		expect(serverSource).toContain("/api/security/watch/status");
		expect(serverSource).toContain("/api/security/watch/latest");
		expect(serverSource).toContain("readSecurityWatchStatus");
		expect(serverSource).toContain("readSecurityWatchLatestReport");
	});

	it("renders Security Watch card in UI", () => {
		expect(uiSource).toContain("Security Watch");
		expect(uiSource).toContain('id="securityWatchCard"');
		expect(uiSource).toContain("/api/security/watch/status");
		expect(uiSource).toContain("top findings");
	});
});
