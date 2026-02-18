#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const CI_SIGNATURES_JSONL_PATH =
	process.env.CI_SIGNATURES_JSONL_PATH ||
	"apps/dashboard/data/ci-signatures.jsonl";

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

function hasPythonMissingSignature(output) {
	const lower = String(output || "").toLowerCase();
	return (
		lower.includes("python: not found") ||
		lower.includes("python: command not found") ||
		lower.includes("python: 未找到命令")
	);
}

function classifyCheckFailure(output) {
	const lower = String(output || "").toLowerCase();
	if (hasPythonMissingSignature(lower)) return "python-missing";
	if (lower.includes("npm run lint") || lower.includes("biome check")) {
		if (lower.includes("internalerror/io")) return "lint-biome-io";
		return "lint";
	}
	if (lower.includes("npm run typecheck") || lower.includes("tsc --noemit")) {
		return "typecheck";
	}
	if (
		lower.includes("schema_validation_failed") ||
		lower.includes("npm run schema:validate")
	) {
		return "schema-validate";
	}
	return "check-unknown";
}

function printSignatureSummary(signatures) {
	console.log(
		`[ci-resilient] failure-signatures ${JSON.stringify(signatures)}`,
	);
}

function appendSignatureSummary(signatures, status) {
	try {
		const payload = {
			ts: new Date().toISOString(),
			status,
			signatures,
		};
		mkdirSync(path.dirname(CI_SIGNATURES_JSONL_PATH), { recursive: true });
		appendFileSync(
			CI_SIGNATURES_JSONL_PATH,
			`${JSON.stringify(payload)}\n`,
			"utf8",
		);
	} catch (error) {
		console.warn(
			`[ci-resilient] failed to append signature log: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function failWithSummary(code, message, signatures) {
	console.error(message);
	printSignatureSummary(signatures);
	appendSignatureSummary(signatures, "failed");
	process.exit(code);
}

async function applyBiomeHotfix(env, signatures, reason = "proactive") {
	signatures.biomeHotfixRuns += 1;
	console.log(
		`[ci-resilient] applying biome hotfix for dashboard metrics file (${reason})...`,
	);
	const result = await run(
		"npx",
		["biome", "check", "--write", "apps/dashboard/data/rebalance-metrics.json"],
		"biome-hotfix",
		env,
	);
	if (hasPythonMissingSignature(result.output)) {
		signatures.pythonMissingDetections += 1;
	}
	return result;
}

async function main() {
	const signatures = {
		pythonShimApplied: 0,
		pythonMissingDetections: 0,
		biomeIoDetections: 0,
		biomeHotfixRuns: 0,
		testRetryCount: 0,
		testFlakeRecovered: 0,
		checkFailureKind: "",
	};

	const runtime = ensurePythonAliasEnv(process.env);
	if (runtime.strategy === "python3-shim") {
		signatures.pythonShimApplied = 1;
		console.log(
			"[ci-resilient] python missing, attached python3 shim for this CI run",
		);
	} else if (runtime.strategy === "python-missing") {
		signatures.pythonMissingDetections += 1;
		console.warn(
			"[ci-resilient] warning: neither python nor python3 found in PATH",
		);
	}

	await applyBiomeHotfix(runtime.env, signatures, "proactive");

	console.log("[ci-resilient] step 1/3: npm run check");
	let check = await run("npm", ["run", "check"], "check", runtime.env);
	if (hasPythonMissingSignature(check.output)) {
		signatures.pythonMissingDetections += 1;
	}
	if (check.code !== 0 && shouldApplyBiomeHotfix(check.output)) {
		signatures.biomeIoDetections += 1;
		console.log(
			"[ci-resilient] detected formatter/io drift, running targeted biome hotfix...",
		);
		await applyBiomeHotfix(runtime.env, signatures, "check-retry");
		console.log("[ci-resilient] re-running npm run check after hotfix");
		check = await run("npm", ["run", "check"], "check(retry)", runtime.env);
		if (hasPythonMissingSignature(check.output)) {
			signatures.pythonMissingDetections += 1;
		}
	}
	if (check.code !== 0) {
		signatures.checkFailureKind = classifyCheckFailure(check.output);
		failWithSummary(
			check.code,
			`[ci-resilient] check failed (${signatures.checkFailureKind})`,
			signatures,
		);
	}

	console.log("[ci-resilient] step 2/3: npm run security:check");
	const security = await run(
		"npm",
		["run", "security:check"],
		"security",
		runtime.env,
	);
	if (hasPythonMissingSignature(security.output)) {
		signatures.pythonMissingDetections += 1;
	}
	if (security.code !== 0) {
		failWithSummary(
			security.code,
			"[ci-resilient] security:check failed",
			signatures,
		);
	}

	console.log("[ci-resilient] step 3/3: npm test (with one retry for flake)");
	let test = await run("npm", ["test"], "test", runtime.env);
	if (hasPythonMissingSignature(test.output)) {
		signatures.pythonMissingDetections += 1;
	}
	if (test.code !== 0) {
		signatures.testRetryCount += 1;
		console.log("[ci-resilient] first npm test failed, retrying once...");
		test = await run("npm", ["test"], "test(retry)", runtime.env);
		if (hasPythonMissingSignature(test.output)) {
			signatures.pythonMissingDetections += 1;
		}
		if (test.code === 0) {
			signatures.testFlakeRecovered += 1;
		}
	}
	if (test.code !== 0) {
		failWithSummary(test.code, "[ci-resilient] tests failed", signatures);
	}

	console.log("[ci-resilient] success");
	printSignatureSummary(signatures);
	appendSignatureSummary(signatures, "success");
}

await main();
