#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveFromRepo } from "./runtime-paths.mjs";

const DEFAULT_TARGET_RELATIVE = "apps/dashboard/data/rebalance-metrics.json";
const DEFAULT_CACHE_RELATIVE =
	"apps/dashboard/data/.normalize-runtime-metrics-cache.json";
const targetInput =
	process.env.NEAR_DASHBOARD_METRICS_PATH || DEFAULT_TARGET_RELATIVE;
const cacheInput =
	process.env.NEAR_DASHBOARD_NORMALIZE_CACHE_PATH || DEFAULT_CACHE_RELATIVE;

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

function resolvePath(input, cwd) {
	if (path.isAbsolute(input)) return input;
	const resolved = resolveFromRepo(input, cwd).absolutePath;
	return resolved || null;
}

function readJsonSafe(filePath) {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
}

const targetPath = resolvePath(targetInput, process.cwd());
const cachePath = resolvePath(cacheInput, process.cwd());

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

let targetStat;
try {
	targetStat = statSync(targetPath);
} catch {
	console.log(
		`[normalize-runtime-metrics] skipped: target unavailable (${targetInput})`,
	);
	process.exit(0);
}

const cache =
	cachePath && existsSync(cachePath) ? readJsonSafe(cachePath) : null;
if (
	cache &&
	cache.targetPath === targetPath &&
	Number(cache.size) === Number(targetStat.size) &&
	Number(cache.mtimeMs) === Number(targetStat.mtimeMs)
) {
	console.log(
		`[normalize-runtime-metrics] fast-skip unchanged ${targetInput} (cache-hit)`,
	);
	process.exit(0);
}

let parsed;
let current;
try {
	current = readFileSync(targetPath, "utf8");
	parsed = JSON.parse(current);
} catch (error) {
	console.warn(
		`[normalize-runtime-metrics] skipped: invalid json (${error instanceof Error ? error.message : String(error)})`,
	);
	process.exit(0);
}

const normalized = `${JSON.stringify(stableNormalize(parsed), null, "\t")}\n`;
if (normalized === current) {
	if (cachePath) {
		try {
			writeFileSync(
				cachePath,
				`${JSON.stringify(
					{
						targetPath,
						size: targetStat.size,
						mtimeMs: targetStat.mtimeMs,
						updatedAt: new Date().toISOString(),
					},
					null,
					2,
				)}\n`,
				"utf8",
			);
		} catch {
			// best-effort cache write
		}
	}
	console.log(`[normalize-runtime-metrics] already normalized ${targetInput}`);
	process.exit(0);
}

try {
	writeFileSync(targetPath, normalized, "utf8");
	const normalizedStat = statSync(targetPath);
	if (cachePath) {
		try {
			writeFileSync(
				cachePath,
				`${JSON.stringify(
					{
						targetPath,
						size: normalizedStat.size,
						mtimeMs: normalizedStat.mtimeMs,
						updatedAt: new Date().toISOString(),
					},
					null,
					2,
				)}\n`,
				"utf8",
			);
		} catch {
			// best-effort cache write
		}
	}
	console.log(`[normalize-runtime-metrics] normalized ${targetInput}`);
} catch (error) {
	if (
		error &&
		typeof error === "object" &&
		"code" in error &&
		String(error.code) === "ENOENT"
	) {
		console.log(
			`[normalize-runtime-metrics] skipped: target disappeared during write (${targetInput})`,
		);
		process.exit(0);
	}
	throw error;
}
