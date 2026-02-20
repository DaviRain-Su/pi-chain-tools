import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverPath = path.resolve("apps", "dashboard", "server.mjs");
const serverSource = readFileSync(serverPath, "utf8");
const uiPath = path.resolve("apps", "dashboard", "index.html");
const uiSource = readFileSync(uiPath, "utf8");

describe("dashboard readiness matrix endpoint + UI", () => {
	it("exposes readiness matrix endpoint", () => {
		expect(serverSource).toContain("/api/readiness/matrix");
		expect(serverSource).toContain("readReadinessMatrixLatest");
		expect(serverSource).toContain("READINESS_MATRIX_PATH");
	});

	it("renders readiness card in UI", () => {
		expect(uiSource).toContain("Mainnet Readiness");
		expect(uiSource).toContain('id="readinessCard"');
		expect(uiSource).toContain("/api/readiness/matrix");
	});
});
