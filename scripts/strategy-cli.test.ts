import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const workspaceList = [];
const COMPILE = path.resolve("scripts/strategy-compile.mjs");
const VALIDATE = path.resolve("scripts/strategy-validate.mjs");
const RUNNER = path.resolve("scripts/strategy-run.mjs");

function run(scriptPath, args = []) {
	return spawnSync(process.execPath, [scriptPath, ...args], {
		cwd: path.resolve("."),
		encoding: "utf8",
	});
}

function makeTmpDir() {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pct-strategy-cli-"));
	workspaceList.push(dir);
	return dir;
}

afterEach(() => {
	while (workspaceList.length > 0) {
		const p = workspaceList.pop();
		if (p) rmSync(p, { recursive: true, force: true });
	}
});

describe("strategy CLI flow", () => {
	it("compile -> validate -> run works", () => {
		const outDir = makeTmpDir();
		const outSpec = path.join(outDir, "strategy.json");

		const c = run(COMPILE, [
			"--template",
			"rebalance-crosschain-v0",
			"--out",
			outSpec,
		]);
		expect(c.status).toBe(0);
		const spec = JSON.parse(readFileSync(outSpec, "utf8"));
		expect(spec.plan.steps.length).toBeGreaterThan(0);

		const v = run(VALIDATE, ["--spec", outSpec, "--json"]);
		expect(v.status).toBe(0);
		expect(JSON.parse(v.stdout).status).toBe("ok");

		const r = run(RUNNER, ["--spec", outSpec, "--mode", "dry-run", "--json"]);
		expect(r.status).toBe(0);
		const payload = JSON.parse(r.stdout);
		expect(payload.status).toBe("ok");
		expect(payload.steps.length).toBe(spec.plan.steps.length);
	});

	it("execute mode blocks without confirm token", () => {
		const outDir = makeTmpDir();
		const outSpec = path.join(outDir, "strategy.json");
		const c = run(COMPILE, [
			"--template",
			"rebalance-crosschain-v0",
			"--out",
			outSpec,
		]);
		expect(c.status).toBe(0);

		const r = run(RUNNER, ["--spec", outSpec, "--mode", "execute", "--json"]);
		expect(r.status).toBe(2);
		const payload = JSON.parse(r.stdout);
		expect(payload.status).toBe("blocked");
		expect(payload.requiredToken).toBe("I_ACKNOWLEDGE_EXECUTION");
	});

	it("execute mode returns ready with explicit token", () => {
		const outDir = makeTmpDir();
		const outSpec = path.join(outDir, "strategy.json");
		const c = run(COMPILE, [
			"--template",
			"rebalance-crosschain-v0",
			"--out",
			outSpec,
		]);
		expect(c.status).toBe(0);

		const r = run(RUNNER, [
			"--spec",
			outSpec,
			"--mode",
			"execute",
			"--confirmExecuteToken",
			"I_ACKNOWLEDGE_EXECUTION",
			"--json",
		]);
		expect(r.status).toBe(0);
		const payload = JSON.parse(r.stdout);
		expect(payload.status).toBe("ready");
		expect(payload.broadcastStatus).toBe("skipped");
	});

	it("stable-yield live sets default evidence path", () => {
		const r = run(RUNNER, [
			"--spec",
			"docs/schemas/examples/strategy-stable-yield-v1.json",
			"--mode",
			"execute",
			"--confirmExecuteToken",
			"I_ACKNOWLEDGE_EXECUTION",
			"--live",
			"true",
			"--liveConfirmToken",
			"I_ACKNOWLEDGE_LIVE_EXECUTION",
			"--json",
		]);
		expect(r.status).toBe(0);
		const payload = JSON.parse(r.stdout);
		expect(payload.status).toBe("ready");
		expect(payload.evidenceOutPath).toContain("docs/execution-proofs/");
	});

	it("validate fails invalid structure", () => {
		const outDir = makeTmpDir();
		const badSpec = path.join(outDir, "bad.json");
		writeFileSync(badSpec, JSON.stringify({ id: "bad" }), "utf8");
		const v = run(VALIDATE, ["--spec", badSpec, "--json"]);
		expect(v.status).toBe(2);
		expect(JSON.parse(v.stdout).status).toBe("failed");
	});
});
