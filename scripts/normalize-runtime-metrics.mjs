#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const TARGET = "apps/dashboard/data/rebalance-metrics.json";

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

if (!existsSync(TARGET)) {
	process.exit(0);
}

let parsed;
try {
	parsed = JSON.parse(readFileSync(TARGET, "utf8"));
} catch (error) {
	console.warn(
		`[normalize-runtime-metrics] skipped: invalid json (${error instanceof Error ? error.message : String(error)})`,
	);
	process.exit(0);
}

const normalized = `${JSON.stringify(stableNormalize(parsed), null, "\t")}\n`;
const current = readFileSync(TARGET, "utf8");

if (normalized === current) {
	console.log(`[normalize-runtime-metrics] already normalized ${TARGET}`);
	process.exit(0);
}

writeFileSync(TARGET, normalized, "utf8");
console.log(`[normalize-runtime-metrics] normalized ${TARGET}`);
