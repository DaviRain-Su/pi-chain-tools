#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import { runReadinessMatrix } from "./readiness-matrix.mjs";

function runStep(command, args) {
	const startedAt = new Date().toISOString();
	const result = spawnSync(command, args, {
		encoding: "utf8",
		env: process.env,
	});
	return {
		step: [command, ...args].join(" "),
		startedAt,
		finishedAt: new Date().toISOString(),
		ok: result.status === 0,
		exitCode: result.status,
		stdoutTail: String(result.stdout || "").slice(-1000),
		stderrTail: String(result.stderr || "").slice(-1000),
	};
}

export async function runReadinessRefresh() {
	const steps = [];
	steps.push(runStep("npm", ["run", "live:test:preflight"]));
	const matrix = await runReadinessMatrix([]);
	const ok = steps.every((s) => s.ok) && matrix.ok;
	return {
		ok,
		steps,
		matrix,
		note: ok
			? "refresh complete"
			: "refresh completed with warnings (see failing steps)",
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runReadinessRefresh()
		.then((result) => {
			console.log(JSON.stringify(result, null, 2));
			if (!result.ok) process.exitCode = 1;
		})
		.catch((error) => {
			console.error(
				"[readiness-refresh] failed",
				error instanceof Error ? error.message : String(error),
			);
			process.exitCode = 1;
		});
}
