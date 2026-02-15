import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageJsonPath = path.resolve("package.json");
const scripts = JSON.parse(readFileSync(packageJsonPath, "utf8")).scripts;

describe("package.json script contracts", () => {
	it("defines schema:ci-check as manifest JSON + full validation", () => {
		expect(typeof scripts?.["schema:ci-check"]).toBe("string");
		expect(scripts["schema:ci-check"]).toBe(
			"npm run schema:check-files:json && npm run schema:validate",
		);
		expect(scripts["schema:check-files:json"]).toContain(
			"--list-strict --json",
		);
		expect(scripts["schema:check-files"]).toContain("--list-strict");
	});

	it("keeps schema scripts independent from check pipeline", () => {
		expect(scripts?.check).toBe(
			"npm run lint && npm run typecheck && npm run schema:validate",
		);
		expect(scripts?.ci).toContain("npm run check");
		expect(scripts?.ci).toContain("npm test");
	});
});
