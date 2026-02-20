#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) ?? process.cwd();
const DEFAULT_ROOT = path.join(
	REPO_ROOT,
	"apps",
	"dashboard",
	"data",
	"proofs",
	"autonomous-cycle",
);
const DEFAULT_HISTORY_DIR = path.join(DEFAULT_ROOT, "runs");
const DEFAULT_LATEST_PATH = path.join(DEFAULT_ROOT, "latest.json");

function parseArgs(rawArgs = process.argv.slice(2)) {
	const out = {
		limit: 10,
		historyDir: DEFAULT_HISTORY_DIR,
		latestPath: DEFAULT_LATEST_PATH,
	};
	for (let i = 0; i < rawArgs.length; i += 1) {
		const token = String(rawArgs[i] || "");
		if (!token.startsWith("--")) continue;
		const key = token.slice(2);
		const value = rawArgs[i + 1];
		if (value === undefined) throw new Error(`missing value for --${key}`);
		i += 1;
		switch (key) {
			case "limit": {
				const limit = Number.parseInt(String(value), 10);
				if (!Number.isFinite(limit) || limit <= 0) {
					throw new Error("--limit must be a positive integer");
				}
				out.limit = Math.min(100, limit);
				break;
			}
			case "history-dir":
				out.historyDir = path.resolve(String(value));
				break;
			case "latest":
				out.latestPath = path.resolve(String(value));
				break;
			default:
				throw new Error(`unknown argument: --${key}`);
		}
	}
	return out;
}

async function readJsonSafe(filePath) {
	try {
		const raw = await readFile(filePath, "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function toRow(proof, sourcePath) {
	const txEvidence = proof?.txEvidence || {};
	const blockers = Array.isArray(txEvidence.blockers)
		? txEvidence.blockers
		: [];
	return {
		runId: String(proof?.intent?.runId || proof?.runId || "unknown"),
		mode: String(proof?.mode || "unknown"),
		startedAt: proof?.startedAt || null,
		finishedAt: proof?.finishedAt || null,
		ok: proof?.ok === true,
		status: String(txEvidence.status || "unknown"),
		txHash: txEvidence.txHash || null,
		blockers,
		blockerCount: blockers.length,
		sourcePath,
	};
}

export async function listAutonomousCycleRuns(rawArgs = process.argv.slice(2)) {
	const args = parseArgs(rawArgs);
	const rows = [];
	const errors = [];

	try {
		const files = await readdir(args.historyDir);
		const ordered = files
			.filter((name) => name.endsWith(".json"))
			.sort((a, b) => b.localeCompare(a))
			.slice(0, args.limit * 3);
		for (const name of ordered) {
			if (rows.length >= args.limit) break;
			const fullPath = path.join(args.historyDir, name);
			const proof = await readJsonSafe(fullPath);
			if (!proof) continue;
			rows.push(toRow(proof, fullPath));
		}
	} catch {
		errors.push(`history_missing_or_unreadable:${args.historyDir}`);
	}

	if (rows.length === 0) {
		const latest = await readJsonSafe(args.latestPath);
		if (latest) rows.push(toRow(latest, args.latestPath));
		else errors.push(`latest_missing_or_unreadable:${args.latestPath}`);
	}

	return {
		ok: rows.length > 0,
		generatedAt: new Date().toISOString(),
		root: DEFAULT_ROOT,
		historyDir: args.historyDir,
		latestPath: args.latestPath,
		count: rows.length,
		runs: rows,
		errors,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	listAutonomousCycleRuns()
		.then((result) => {
			console.log(JSON.stringify(result, null, 2));
			if (!result.ok) process.exitCode = 1;
		})
		.catch((error) => {
			console.error(
				"[autonomous-cycle-runs] failed",
				error instanceof Error ? error.message : String(error),
			);
			process.exitCode = 1;
		});
}
