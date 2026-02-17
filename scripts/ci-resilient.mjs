#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function run(command, args, label, env = process.env) {
	return new Promise((resolve) => {
		let output = "";
		const child = spawn(command, args, {
			stdio: ["inherit", "pipe", "pipe"],
			env,
			shell: process.platform === "win32",
		});
		child.stdout.on("data", (chunk) => {
			const text = String(chunk);
			output += text;
			process.stdout.write(text);
		});
		child.stderr.on("data", (chunk) => {
			const text = String(chunk);
			output += text;
			process.stderr.write(text);
		});
		child.on("exit", (code) => {
			resolve({ code: code ?? 1, output, label });
		});
	});
}

function commandPath(bin, env = process.env) {
	const result = spawnSync("bash", ["-lc", `command -v ${bin}`], {
		encoding: "utf8",
		env,
	});
	if (result.status !== 0) return "";
	return String(result.stdout || "").trim();
}

function ensurePythonAliasEnv(baseEnv = process.env) {
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

	const shimDir = mkdtempSync(
		path.join(os.tmpdir(), "ci-resilient-python-shim-"),
	);
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

function shouldApplyBiomeHotfix(output) {
	const lower = output.toLowerCase();
	return (
		lower.includes("internalerror/io") ||
		lower.includes("formatted") ||
		lower.includes("apps/dashboard/data/rebalance-metrics.json")
	);
}

async function applyBiomeHotfix(env) {
	console.log(
		"[ci-resilient] applying biome hotfix for dashboard metrics file...",
	);
	await run(
		"npx",
		["biome", "check", "--write", "apps/dashboard/data/rebalance-metrics.json"],
		"biome-hotfix",
		env,
	);
}

async function main() {
	const runtime = ensurePythonAliasEnv(process.env);
	if (runtime.strategy === "python3-shim") {
		console.log(
			"[ci-resilient] python missing, attached python3 shim for this CI run",
		);
	} else if (runtime.strategy === "python-missing") {
		console.warn(
			"[ci-resilient] warning: neither python nor python3 found in PATH",
		);
	}

	await applyBiomeHotfix(runtime.env);

	console.log("[ci-resilient] step 1/3: npm run check");
	let check = await run("npm", ["run", "check"], "check", runtime.env);
	if (check.code !== 0 && shouldApplyBiomeHotfix(check.output)) {
		console.log(
			"[ci-resilient] detected formatter/io drift, running targeted biome hotfix...",
		);
		await applyBiomeHotfix(runtime.env);
		console.log("[ci-resilient] re-running npm run check after hotfix");
		check = await run("npm", ["run", "check"], "check(retry)", runtime.env);
	}
	if (check.code !== 0) {
		console.error("[ci-resilient] check failed");
		process.exit(check.code);
	}

	console.log("[ci-resilient] step 2/3: npm run security:check");
	const security = await run(
		"npm",
		["run", "security:check"],
		"security",
		runtime.env,
	);
	if (security.code !== 0) {
		console.error("[ci-resilient] security:check failed");
		process.exit(security.code);
	}

	console.log("[ci-resilient] step 3/3: npm test (with one retry for flake)");
	let test = await run("npm", ["test"], "test", runtime.env);
	if (test.code !== 0) {
		console.log("[ci-resilient] first npm test failed, retrying once...");
		test = await run("npm", ["test"], "test(retry)", runtime.env);
	}
	if (test.code !== 0) {
		console.error("[ci-resilient] tests failed");
		process.exit(test.code);
	}

	console.log("[ci-resilient] success");
}

await main();
