#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const TARGET = "apps/dashboard/data/rebalance-metrics.json";

if (!existsSync(TARGET)) {
	process.exit(0);
}

const result = spawnSync("npx", ["biome", "format", "--write", TARGET], {
	encoding: "utf8",
	stdio: "pipe",
});

if (result.status !== 0) {
	console.warn(
		`[normalize-runtime-metrics] skipped: ${String(result.stderr || result.stdout || "biome format failed").trim()}`,
	);
	process.exit(0);
}

console.log(`[normalize-runtime-metrics] normalized ${TARGET}`);
