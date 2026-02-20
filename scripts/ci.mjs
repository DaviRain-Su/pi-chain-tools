#!/usr/bin/env node
import { spawn } from "node:child_process";
import { ensurePythonAliasEnv } from "./python-runtime.mjs";
import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) || process.cwd();

function run(command, args, env = process.env) {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			env,
			cwd: REPO_ROOT,
			shell: process.platform === "win32",
		});
		child.on("close", (code, signal) => {
			resolve({ code: code ?? (signal ? 143 : 1), signal: signal || null });
		});
	});
}

const runtime = ensurePythonAliasEnv(process.env);
if (
	runtime.strategy === "python3-direct" ||
	runtime.strategy === "python3-shim"
) {
	console.warn(
		`[ci] python missing; using python3 fallback for this run (${runtime.strategy})`,
	);
} else if (runtime.strategy === "python-missing") {
	console.warn(
		"[ci] precheck: neither python nor python3 found in PATH. Falling back to npm run ci:resilient for actionable diagnostics.",
	);
}

const result = await run("npm", ["run", "ci:resilient"], runtime.env);
if (result.signal) {
	console.error(`[ci] interrupted by signal=${result.signal}`);
}
process.exit(result.code);
