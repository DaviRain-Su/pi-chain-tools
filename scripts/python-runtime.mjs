#!/usr/bin/env node
import { spawnSync } from "node:child_process";

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
