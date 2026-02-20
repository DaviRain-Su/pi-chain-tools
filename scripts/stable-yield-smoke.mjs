#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

const RUNNER = path.resolve("scripts", "strategy-run.mjs");
const SPEC = path.resolve(
	"docs",
	"schemas",
	"examples",
	"strategy-stable-yield-v1.json",
);

function run(args) {
	return spawnSync(process.execPath, [RUNNER, ...args], {
		cwd: path.resolve("."),
		encoding: "utf8",
	});
}

const result = run([
	"--spec",
	SPEC,
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

if (result.status !== 0) {
	console.error(result.stdout || result.stderr || "stable-yield smoke failed");
	process.exit(result.status || 1);
}

const payload = JSON.parse(result.stdout || "{}");
if (payload.status !== "ready") {
	console.error(JSON.stringify(payload, null, 2));
	process.exit(2);
}
if (payload.liveRequested !== true) {
	console.error("stable-yield smoke expected liveRequested=true");
	process.exit(3);
}
if (
	!["awaiting-signed-tx", "submitted"].includes(String(payload.broadcastStatus))
) {
	console.error(`unexpected broadcastStatus: ${payload.broadcastStatus}`);
	process.exit(4);
}

console.log(
	JSON.stringify(
		{
			status: "ok",
			suite: "stable-yield-smoke",
			strategyId: payload.strategyId,
			broadcastStatus: payload.broadcastStatus,
			evidenceOutPath: payload.evidenceOutPath || null,
		},
		null,
		2,
	),
);
