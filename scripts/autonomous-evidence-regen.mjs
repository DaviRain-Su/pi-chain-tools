#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function runStep(command, args) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		env: process.env,
	});
	return {
		step: [command, ...args].join(" "),
		ok: result.status === 0,
		exitCode: result.status,
		stdoutTail: String(result.stdout || "").slice(-800),
		stderrTail: String(result.stderr || "").slice(-800),
	};
}

export function regenerateAutonomousEvidence() {
	const runId = `submission-proof-${Date.now()}`;
	const steps = [
		runStep("npm", [
			"run",
			"autonomous:hyperliquid:cycle",
			"--",
			"--mode",
			"dryrun",
			"--run-id",
			runId,
		]),
		runStep("npm", ["run", "live:test:preflight"]),
		runStep("npm", ["run", "readiness:refresh"]),
		runStep("npm", ["run", "autonomous:submission:bundle"]),
	];
	const ok = steps.every((step) => step.ok);
	return { ok, runId, steps };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const result = regenerateAutonomousEvidence();
	console.log(JSON.stringify(result, null, 2));
	if (!result.ok) process.exitCode = 1;
}
