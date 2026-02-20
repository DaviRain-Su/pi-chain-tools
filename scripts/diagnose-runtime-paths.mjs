#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";

import { resolveFromRepo, resolveRepoRoot } from "./runtime-paths.mjs";

function line(text = "") {
	process.stdout.write(`${text}\n`);
}

function checkPath(label, targetPath) {
	const exists = existsSync(targetPath);
	line(`- ${label}: ${exists ? "ok" : "missing"} (${targetPath})`);
	return exists;
}

function main() {
	const cwd = process.cwd();
	const repoRoot = resolveRepoRoot(cwd);
	const pkg = resolveFromRepo("package.json", cwd).absolutePath;
	const metrics = resolveFromRepo(
		"apps/dashboard/data/rebalance-metrics.json",
		cwd,
	).absolutePath;
	const cycleLatest = resolveFromRepo(
		"apps/dashboard/data/proofs/autonomous-cycle/latest.json",
		cwd,
	).absolutePath;

	line("[diagnose-runtime-paths]");
	line(`- cwd: ${cwd}`);
	line(`- repoRoot: ${repoRoot || "(not detected)"}`);

	if (!repoRoot) {
		line("- verdict: repo root not detected");
		line(
			"- fix: run commands from repo root, e.g. `cd /home/davirain/clawd/pi-chain-tools`",
		);
		line(
			"- fix: or set absolute paths for scripts that support --out/--state-path",
		);
		process.exitCode = 1;
		return;
	}

	const checks = [
		checkPath("package.json", pkg),
		checkPath("rebalance-metrics", metrics),
		checkPath("autonomous-cycle latest", cycleLatest),
	];
	const ok = checks.every(Boolean);
	line(`- verdict: ${ok ? "healthy" : "degraded"}`);
	if (!ok) {
		line(
			"- suggested command: npm run autonomous:bsc:runs -- --limit 5 (observability check)",
		);
		line(
			"- suggested command: npm run autonomous:bsc:cycle -- --mode dryrun --run-id diag-dryrun-001",
		);
	}
}

main();
