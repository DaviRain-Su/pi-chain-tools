import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageJsonPath = path.resolve("package.json");
const scripts = JSON.parse(readFileSync(packageJsonPath, "utf8")).scripts;

const schemaValidatorScript = path.resolve(
	"scripts",
	"validate-openclaw-schemas.mjs",
);

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
		script: "schema:audit",
		assertion: "exact",
		expected:
			"npm run schema:check-files:json && npm run schema:validate -- --strict --json",
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
		target: "quickstart docs",
		content: quickstartDoc,
		expected: "schema:audit",
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
	{
		target: "schemas docs",
		content: schemasDoc,
		expected: "schema:audit",
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
			"node scripts/normalize-runtime-metrics.mjs && npm run lint && npm run typecheck && npm run schema:validate",
		);
		expect(
			String(scripts?.check).startsWith(
				"node scripts/normalize-runtime-metrics.mjs &&",
			),
		).toBe(true);
		expect(scripts?.ci).toBe("node scripts/ci.mjs");
		expect(typeof scripts?.["ci:resilient"]).toBe("string");
		expect(String(scripts?.["ci:resilient"])).toContain(
			"node scripts/ci-resilient.mjs",
		);
		expect(scripts?.["submission:evidence"]).toBe(
			"node scripts/submission-evidence.mjs",
		);
		expect(scripts?.["execute:proof"]).toBe("node scripts/execute-proof.mjs");
		expect(scripts?.["execute:proof:morpho"]).toBe(
			"node scripts/execute-proof.mjs --protocol=morpho",
		);
		expect(scripts?.["execute:proof:bsc"]).toBe(
			"node scripts/execute-proof.mjs --protocol=bsc",
		);
		expect(scripts?.["execute:proof:lifi"]).toBe(
			"node scripts/execute-proof.mjs --protocol=lifi",
		);
		expect(scripts?.["demo:monad-bsc"]).toBe("node scripts/demo-monad-bsc.mjs");
		expect(scripts?.["ops:smoke"]).toBe("node scripts/ops-smoke.mjs");
		expect(scripts?.["stable-yield:smoke"]).toBe(
			"node scripts/stable-yield-smoke.mjs",
		);
		expect(scripts?.["stable-yield:auto-migrate:v1"]).toBe(
			"node scripts/stable-yield-auto-migrate-v1.mjs",
		);
		expect(scripts?.["stable-yield:auto-migrate:v1:cron-install"]).toBe(
			"bash scripts/install-stable-yield-auto-migrate-cron.sh",
		);
		expect(scripts?.["dashboard:restart"]).toContain(
			"node scripts/dashboard-restart.mjs --restart",
		);
		expect(scripts?.["dashboard:ensure"]).toBe(
			"node scripts/dashboard-restart.mjs",
		);
		expect(scripts?.["sdk:upgrade-readiness"]).toBe(
			"node scripts/sdk-upgrade-readiness.mjs",
		);
		expect(scripts?.["sdk:capability-diff"]).toBe(
			"node scripts/sdk-capability-diff.mjs",
		);
		expect(scripts?.["autonomous:hyperliquid:runs"]).toBe(
			"node scripts/autonomous-cycle-runs.mjs",
		);
		expect(scripts?.["doctor:paths"]).toBe(
			"node scripts/diagnose-runtime-paths.mjs",
		);
	});

	it("keeps CI schema validation as single-step command", () => {
		expect(ciWorkflow).toContain(
			"- name: Validate OpenClaw BTC5m schema artifacts",
		);
		expect(ciWorkflow).toContain("run: npm run schema:ci-check");
		expect(ciWorkflow).not.toMatch(
			/npm run schema:check-files:json[\s\S]{0,32}npm run schema:validate/,
		);
		expect(ciWorkflow.match(/npm run schema:ci-check/g) ?? []).toHaveLength(1);
	});

	it.each(docAndWorkflowReferences)(
		"keeps reference aligned in $target",
		({ content, expected }) => {
			expect(content).toContain(expected);
		},
	);

	it("documents helper entrypoints in CLI usage output", () => {
		const result = spawnSync(
			process.execPath,
			[schemaValidatorScript, "--help"],
			{
				encoding: "utf8",
			},
		);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("npm script helpers:");
		expect(result.stdout).toContain("schema:check-files");
		expect(result.stdout).toContain("schema:check-files:json");
		expect(result.stdout).toContain("schema:ci-check");
		expect(result.stdout).toContain("schema:audit");
		expect(result.stdout).toContain("schema:validate");
	});
});
