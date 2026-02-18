import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type CoverageEntry = {
	protocol: string;
	action: string;
	endpoint: string;
	currentMode: "official-sdk" | "canonical-client" | "native-fallback";
	ragStatus: "green" | "yellow" | "red";
	status: string;
	blockers: string[];
	nextAction: string;
	codeMarkers: string[];
};

describe("sdk coverage report consistency", () => {
	const jsonPath = path.resolve("docs", "sdk-coverage-report.json");
	const mdPath = path.resolve("docs", "sdk-coverage-report.md");
	const report = JSON.parse(readFileSync(jsonPath, "utf8"));
	const markdown = readFileSync(mdPath, "utf8");
	const entries = report.entries as CoverageEntry[];

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
		const protocols = new Set(entries.map((entry) => entry.protocol));
		expect(protocols.has("Monad+Morpho")).toBe(true);
		expect(protocols.has("Venus")).toBe(true);
		expect(protocols.has("Lista")).toBe(true);
		expect(protocols.has("Wombat")).toBe(true);
	});

	it("keeps markdown matrix aligned with json actions", () => {
		for (const entry of entries) {
			expect(markdown).toContain(`| ${entry.protocol} | ${entry.action} |`);
		}
	});

	it("enforces rag/currentMode coherence", () => {
		for (const entry of entries) {
			if (entry.ragStatus === "green") {
				expect(entry.currentMode).toBe("official-sdk");
			}
			if (entry.ragStatus === "yellow") {
				expect(entry.currentMode).toBe("canonical-client");
			}
			if (entry.ragStatus === "red") {
				expect(entry.currentMode).toBe("native-fallback");
			}
		}
	});

	it("requires explicit blocker + nextAction for every non-green row", () => {
		for (const entry of entries) {
			if (entry.ragStatus === "green") continue;
			expect(Array.isArray(entry.blockers)).toBe(true);
			expect(entry.blockers.length).toBeGreaterThan(0);
			expect(typeof entry.nextAction).toBe("string");
			expect(entry.nextAction.trim().length).toBeGreaterThan(0);
		}
	});

	it("requires code marker alignment for every non-green row", () => {
		for (const entry of entries) {
			if (entry.ragStatus === "green") continue;
			expect(Array.isArray(entry.codeMarkers)).toBe(true);
			expect(entry.codeMarkers.length).toBeGreaterThan(0);
			for (const marker of entry.codeMarkers) {
				expect(typeof marker).toBe("string");
				expect(marker.trim().length).toBeGreaterThan(0);
				expect(markdown).toContain(marker);
			}
		}
	});

	it("contains known execute-path marker strings", () => {
		const knownMarkers = [
			"morpho_execute_canonical_ethers_path_no_official_sdk_executor",
			"venus_execute_canonical_ethers_path_no_official_sdk_executor",
			"lista_execute_canonical_ethers_path_no_official_sdk_executor",
			"wombat_execute_canonical_ethers_path_no_official_sdk_executor",
		];
		const seenMarkers = new Set(entries.flatMap((entry) => entry.codeMarkers));
		for (const marker of knownMarkers) {
			expect(seenMarkers.has(marker)).toBe(true);
		}
	});
});
