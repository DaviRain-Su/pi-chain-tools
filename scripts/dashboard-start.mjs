#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveFromRepo } from "./runtime-paths.mjs";

const relativeServerPath = path.join("apps", "dashboard", "server.mjs");
const resolved = resolveFromRepo(relativeServerPath, process.cwd());

if (!resolved.repoRoot || !resolved.absolutePath) {
	console.warn(
		"[dashboard:start] skipped: unable to resolve pi-chain-tools repo root from current working directory.",
	);
	console.warn(
		"[dashboard:start] run this command inside the repository, e.g. cd /home/davirain/clawd/pi-chain-tools && npm run dashboard:start",
	);
	process.exit(0);
}

if (!existsSync(resolved.absolutePath)) {
	console.warn(
		`[dashboard:start] skipped: missing ${relativeServerPath}. Ensure repository checkout is complete and path exists.`,
	);
	process.exit(0);
}

const child = spawn(process.execPath, [resolved.absolutePath], {
	stdio: "inherit",
	env: process.env,
	cwd: resolved.repoRoot,
});

child.on("close", (code, signal) => {
	if (signal) {
		console.error(`[dashboard:start] server interrupted by signal=${signal}`);
		process.exit(143);
	}
	process.exit(code ?? 1);
});
