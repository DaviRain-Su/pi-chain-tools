import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	path.resolve("scripts", "dashboard-restart.mjs"),
	"utf8",
);

describe("dashboard restart helper", () => {
	it("contains preflight port collision + health checks", () => {
		expect(source).toContain("lsof -ti tcp");
		expect(source).toContain("/api/health");
		expect(source).toContain("preflightAvoidedCollision");
		expect(source).toContain("dashboard already healthy; skipped restart");
	});
});
