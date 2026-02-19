import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverPath = path.resolve("apps", "dashboard", "server.mjs");
const serverSource = readFileSync(serverPath, "utf8");
const uiPath = path.resolve("apps", "dashboard", "index.html");
const uiSource = readFileSync(uiPath, "utf8");

describe("dashboard proof summary endpoint + UI", () => {
	it("exposes proof summary endpoint", () => {
		expect(serverSource).toContain("/api/proof/summary");
		expect(serverSource).toContain("readProofSummary");
		expect(serverSource).toContain("findLatestExecutionProof");
	});

	it("renders proof summary card in UI", () => {
		expect(uiSource).toContain("Proof Summary");
		expect(uiSource).toContain('id="proofSummaryCard"');
		expect(uiSource).toContain("/api/proof/summary");
		expect(uiSource).toContain("renderProofRow");
	});
});
