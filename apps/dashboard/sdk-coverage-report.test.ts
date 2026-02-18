import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("sdk coverage report consistency", () => {
	const jsonPath = path.resolve("docs", "sdk-coverage-report.json");
	const mdPath = path.resolve("docs", "sdk-coverage-report.md");
	const report = JSON.parse(readFileSync(jsonPath, "utf8"));
	const markdown = readFileSync(mdPath, "utf8");

	it("contains supported mode enums and non-empty entries", () => {
		expect(report?.modes).toEqual([
			"official-sdk",
			"canonical-client",
			"native-fallback",
		]);
		expect(Array.isArray(report?.entries)).toBe(true);
		expect(report.entries.length).toBeGreaterThan(0);
	});

	it("covers all target protocols", () => {
		const protocols = new Set(
			report.entries.map((entry: { protocol: string }) => entry.protocol),
		);
		expect(protocols.has("Monad+Morpho")).toBe(true);
		expect(protocols.has("Venus")).toBe(true);
		expect(protocols.has("Lista")).toBe(true);
		expect(protocols.has("Wombat")).toBe(true);
	});

	it("keeps markdown matrix aligned with json actions", () => {
		for (const entry of report.entries) {
			expect(markdown).toContain(`| ${entry.protocol} | ${entry.action} |`);
		}
	});
});
