#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveFromRepo } from "./runtime-paths.mjs";

const DEFAULT_TARGET_RELATIVE = "apps/dashboard/data/rebalance-metrics.json";
const targetInput =
	process.env.NEAR_DASHBOARD_METRICS_PATH || DEFAULT_TARGET_RELATIVE;

function stableNormalize(value) {
	if (Array.isArray(value)) {
		return value.map((item) => stableNormalize(item));
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value).sort(([a], [b]) =>
			a.localeCompare(b),
		);
		return Object.fromEntries(
			entries.map(([key, nested]) => [key, stableNormalize(nested)]),
		);
	}
	return value;
}

const targetPath = path.isAbsolute(targetInput)
	? targetInput
	: resolveFromRepo(targetInput, process.cwd()).absolutePath;

if (!targetPath) {
	console.warn(
		"[normalize-runtime-metrics] skipped: could not resolve repository root from current directory",
	);
	process.exit(0);
}

if (!existsSync(targetPath)) {
	console.log(
		`[normalize-runtime-metrics] skipped: target missing (${targetInput})`,
	);
	process.exit(0);
}

let parsed;
try {
	parsed = JSON.parse(readFileSync(targetPath, "utf8"));
} catch (error) {
	console.warn(
		`[normalize-runtime-metrics] skipped: invalid json (${error instanceof Error ? error.message : String(error)})`,
	);
	process.exit(0);
}

const normalized = `${JSON.stringify(stableNormalize(parsed), null, "\t")}\n`;
const current = readFileSync(targetPath, "utf8");

if (normalized === current) {
	console.log(`[normalize-runtime-metrics] already normalized ${targetInput}`);
	process.exit(0);
}

writeFileSync(targetPath, normalized, "utf8");
console.log(`[normalize-runtime-metrics] normalized ${targetInput}`);
