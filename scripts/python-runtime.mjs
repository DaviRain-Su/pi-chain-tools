#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
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

export function ensurePythonAliasEnv(
	baseEnv = process.env,
	shimPrefix = "python-shim-",
) {
	const pythonPath = commandPath("python", baseEnv);
	if (pythonPath) {
		return {
			env: { ...baseEnv },
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

	const shimDir = mkdtempSync(path.join(os.tmpdir(), shimPrefix));
	const shimPath = path.join(shimDir, "python");
	try {
		symlinkSync(python3Path, shimPath);
	} catch {
		const script = `#!/usr/bin/env bash\nexec "${python3Path}" "$@"\n`;
		writeFileSync(shimPath, script, { encoding: "utf8", mode: 0o755 });
	}

	return {
		env: {
			...baseEnv,
			PATH: `${shimDir}:${baseEnv.PATH || ""}`,
		},
		shimDir,
		strategy: "python3-shim",
	};
}
