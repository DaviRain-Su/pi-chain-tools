import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = path.resolve("scripts/validate-openclaw-schemas.mjs");
const REQUIRED_FILES = [
	"openclaw-btc5m-workflow.schema.json",
	"openclaw-btc5m-runtime-state.schema.json",
	"openclaw-btc5m-retry-policy.schema.json",
];

function createWorkspace(includeFiles: string[] = REQUIRED_FILES) {
	const workspace = mkdtempSync(
		path.join(os.tmpdir(), "pi-chain-tools-schema-validate-"),
	);
	const schemaDir = path.join(workspace, "docs", "schemas");
	mkdirSync(schemaDir, { recursive: true });
	for (const fileName of includeFiles) {
		writeFileSync(path.join(schemaDir, fileName), "{}", "utf8");
	}

	return workspace;
}

function runValidator(cwd: string, args: string[]) {
	return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
		cwd,
		encoding: "utf8",
	});
}

function getSchemaDir(workspace: string) {
	return path.join(workspace, "docs", "schemas");
}

describe("validate-openclaw-schemas CLI list modes", () => {
	const workspaces: string[] = [];

	afterEach(() => {
		while (workspaces.length > 0) {
			const workspace = workspaces.pop();
			if (workspace) {
				rmSync(workspace, { recursive: true, force: true });
			}
		}
	});

	it("passes --list-strict when all configured schema files exist", () => {
		const workspace = createWorkspace(REQUIRED_FILES);
		workspaces.push(workspace);

		const result = runValidator(workspace, ["--list-strict", "--json"]);
		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.status).toBe("list");
		expect(payload.summary.allExist).toBe(true);
		expect(payload.files).toHaveLength(REQUIRED_FILES.length);
	});

	it("fails --list-strict with status failed when any file is missing", () => {
		const workspace = createWorkspace([
			"openclaw-btc5m-runtime-state.schema.json",
			"openclaw-btc5m-retry-policy.schema.json",
		]);
		workspaces.push(workspace);

		const result = runValidator(workspace, ["--list-strict", "--json"]);
		expect(result.status).toBe(1);
		const payload = JSON.parse(result.stdout);
		expect(payload.status).toBe("failed");
		expect(payload.summary.allExist).toBe(false);
		expect(payload.summary.missingFiles).toBe(1);
		expect(payload.errors).toHaveLength(1);
		expect(payload.errors[0]).toMatchObject({
			code: "missing_file",
			file: "openclaw-btc5m-workflow.schema.json",
		});
	});

	it("treats --list --strict as strict list mode when files are missing", () => {
		const workspace = createWorkspace(["openclaw-btc5m-workflow.schema.json"]);
		workspaces.push(workspace);

		const result = runValidator(workspace, ["--list", "--strict", "--json"]);
		expect(result.status).toBe(1);
		const payload = JSON.parse(result.stdout);
		expect(payload.status).toBe("failed");
		expect(payload.summary.allExist).toBe(false);
		expect(payload.summary.missingFiles).toBe(REQUIRED_FILES.length - 1);
		expect(payload.errors).toHaveLength(REQUIRED_FILES.length - 1);
	});

	it("returns list status even if some file is missing without list-strict", () => {
		const workspace = createWorkspace(["openclaw-btc5m-workflow.schema.json"]);
		workspaces.push(workspace);

		const result = runValidator(workspace, ["--list", "--json"]);
		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.status).toBe("list");
		expect(payload.summary.allExist).toBe(false);
		expect(payload.summary.existingFiles).toBe(1);
		expect(payload.summary.missingFiles).toBe(REQUIRED_FILES.length - 1);
		expect(payload.files).toHaveLength(REQUIRED_FILES.length);
	});

	it("fails --list-strict if a configured file path exists but is directory", () => {
		const workspace = createWorkspace([
			"openclaw-btc5m-workflow.schema.json",
			"openclaw-btc5m-runtime-state.schema.json",
		]);
		workspaces.push(workspace);
		const schemaDir = getSchemaDir(workspace);
		const invalidPath = path.join(
			schemaDir,
			"openclaw-btc5m-retry-policy.schema.json",
		);
		mkdirSync(invalidPath, { recursive: true });

		const result = runValidator(workspace, ["--list-strict", "--json"]);
		expect(result.status).toBe(1);
		const payload = JSON.parse(result.stdout);
		expect(payload.status).toBe("failed");
		expect(payload.summary.missingFiles).toBe(1);
		expect(payload.errors[0]).toMatchObject({
			code: "missing_file",
			file: "openclaw-btc5m-retry-policy.schema.json",
		});
	});

	it("exposes usage with --help", () => {
		const workspace = createWorkspace(REQUIRED_FILES);
		workspaces.push(workspace);

		const result = runValidator(workspace, ["--help"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Usage:");
		expect(result.stdout).toContain("--list-strict");
	});

	it("reports unknown options and exits non-zero", () => {
		const workspace = createWorkspace(REQUIRED_FILES);
		workspaces.push(workspace);

		const result = runValidator(workspace, ["--unknown-flag"]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Unknown options");
		expect(result.stdout + result.stderr).toContain("Usage:");
	});
});
