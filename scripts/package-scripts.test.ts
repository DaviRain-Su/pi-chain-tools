import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageJsonPath = path.resolve("package.json");
const scripts = JSON.parse(readFileSync(packageJsonPath, "utf8")).scripts;

const ciWorkflowPath = path.resolve(".github", "workflows", "ci.yml");
const ciWorkflow = readFileSync(ciWorkflowPath, "utf8");

const quickstartDocPath = path.resolve("docs", "openclaw-acp-quickstart.md");
const quickstartDoc = readFileSync(quickstartDocPath, "utf8");

const schemasDocPath = path.resolve("docs", "schemas", "README.md");
const schemasDoc = readFileSync(schemasDocPath, "utf8");

const schemaScriptContracts = [
	{
		script: "schema:ci-check",
		assertion: "exact",
		expected: "npm run schema:check-files:json && npm run schema:validate",
	},
	{
		script: "schema:check-files:json",
		assertion: "contains",
		expected: "--list-strict --json",
	},
	{
		script: "schema:check-files",
		assertion: "contains",
		expected: "--list-strict",
	},
] as const;

const docAndWorkflowReferences = [
	{
		target: "ci workflow",
		content: ciWorkflow,
		expected: "npm run schema:ci-check",
	},
	{
		target: "quickstart docs",
		content: quickstartDoc,
		expected: "schema:ci-check",
	},
	{
		target: "schemas docs",
		content: schemasDoc,
		expected: "schema:ci-check",
	},
	{
		target: "schemas docs",
		content: schemasDoc,
		expected: "schema:check-files:json",
	},
] as const;

describe("package.json script contracts", () => {
	it.each(schemaScriptContracts)(
		"ensures script $script matches expectation",
		({ script, assertion, expected }) => {
			expect(typeof scripts?.[script as keyof typeof scripts]).toBe("string");
			const value = String(scripts?.[script as keyof typeof scripts]);
			if (assertion === "exact") {
				expect(value).toBe(expected);
				return;
			}
			expect(value).toContain(expected);
		},
	);

	it("keeps schema scripts independent from check pipeline", () => {
		expect(scripts?.check).toBe(
			"npm run lint && npm run typecheck && npm run schema:validate",
		);
		expect(scripts?.ci).toContain("npm run check");
		expect(scripts?.ci).toContain("npm test");
	});

	it.each(docAndWorkflowReferences)(
		"keeps reference aligned in $target",
		({ content, expected }) => {
			expect(content).toContain(expected);
		},
	);
});
