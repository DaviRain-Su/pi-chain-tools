#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function commandPath(bin, env = process.env) {
	const result = spawnSync("bash", ["-lc", `command -v ${bin}`], {
		encoding: "utf8",
		env,
	});
	if (result.status !== 0) return "";
	return String(result.stdout || "").trim();
}

export function ensurePythonAliasEnv(baseEnv = process.env) {
	const pythonPath = commandPath("python", baseEnv);
	if (pythonPath) {
		return {
			env: { ...baseEnv, PYTHON: pythonPath },
			shimDir: null,
			strategy: "native-python",
		};
	}

	const python3Path = commandPath("python3", baseEnv);
	if (!python3Path) {
		return {
			env: { ...baseEnv },
			shimDir: null,
			strategy: "python-missing",
		};
	}

	const shimDir = path.join(
		os.tmpdir(),
		"pi-chain-tools-python-shim",
	);
	const shimPath = path.join(shimDir, "python");
	try {
		mkdirSync(shimDir, { recursive: true });
		writeFileSync(
			shimPath,
			`#!/usr/bin/env bash\nexec ${python3Path} "$@"\n`,
			"utf8",
		);
		chmodSync(shimPath, 0o755);
		const directEnv = {
			...baseEnv,
			PYTHON: python3Path,
			PATH: `${shimDir}:${baseEnv.PATH || ""}`,
		};
		return {
			env: directEnv,
			shimDir,
			strategy: "python3-shim",
		};
	} catch {
		const directEnv = {
			...baseEnv,
			PYTHON: python3Path,
		};
		return {
			env: directEnv,
			shimDir: null,
			strategy: "python3-direct",
		};
	}
}
