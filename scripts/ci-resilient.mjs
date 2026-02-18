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
		child.on("close", (code, signal) => {
			if (signal) {
				output += `\n[ci-resilient] process interrupted by signal=${signal}\n`;
			}
			resolve({
				code: code ?? (signal ? 143 : 1),
				signal: signal || null,
				output,
				label,
			});
		});
	});
}

async function runWithSigtermRetry(command, args, label, env, signatures) {
	let result = await run(command, args, label, env);
	if (result.signal === "SIGTERM") {
		signatures.sigtermDetections += 1;
		console.warn(
			`[ci-resilient] ${label} interrupted by SIGTERM, retrying once`,
		);
		result = await run(command, args, `${label}(sigterm-retry)`, env);
	}
	return result;
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

function hasNormalizeRuntimeMetricsSignature(output) {
	const lower = String(output || "").toLowerCase();
	return (
		lower.includes("normalize-runtime-metrics") ||
		lower.includes("scripts/normalize-runtime-metrics.mjs")
	);
}

function classifyCheckFailure(output) {
	const lower = String(output || "").toLowerCase();
	if (
		lower.includes("signal=sigterm") ||
		lower.includes("aborted by signal sigterm")
	) {
		if (hasNormalizeRuntimeMetricsSignature(lower)) {
			return "normalize-runtime-metrics-interrupted";
		}
		if (lower.includes("npm run check")) return "check-interrupted";
		return "sigterm";
	}
	if (hasPythonMissingSignature(lower)) return "python-missing";
	if (hasNormalizeRuntimeMetricsSignature(lower)) {
		return "normalize-runtime-metrics";
	}
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

function retryHintForSignatures(signatures) {
	if (signatures.pythonPrecheckBlocked > 0) {
		return "Install python3 (or provide python alias), then rerun: npm run ci:resilient";
	}
	if (signatures.checkFailureKind === "normalize-runtime-metrics-interrupted") {
		return "normalize-runtime-metrics was interrupted (SIGTERM). Retry once: npm run ci:resilient. If persistent, check host restarts and avoid overlapping CI runs.";
	}
	if (signatures.checkFailureKind === "normalize-runtime-metrics") {
		return "normalize-runtime-metrics failed. Validate JSON file exists and is writable: apps/dashboard/data/rebalance-metrics.json";
	}
	if (
		signatures.checkFailureKind === "sigterm" ||
		signatures.checkFailureKind === "check-interrupted" ||
		signatures.sigtermDetections > 0
	) {
		return "Detected SIGTERM interruption. Retry with bounded backoff: CI_RETRY_SIGTERM_MAX=3 npm run ci:retry";
	}
	if (signatures.checkFailureKind === "python-missing") {
		return "Python missing signature detected. Use npm run ci:resilient (auto python3 shim) and confirm python3 is on PATH.";
	}
	return "Retry with npm run ci:retry and inspect apps/dashboard/data/ci-signatures.jsonl for recurring signatures.";
}

function printSignatureSummary(signatures, retryHint = "") {
	console.log(
		`[ci-resilient] failure-signatures ${JSON.stringify(signatures)}`,
	);
	if (retryHint) {
		console.log(`[ci-resilient] retry-hint ${retryHint}`);
	}
}

function appendSignatureSummary(signatures, status, retryHint = "") {
	try {
		const payload = {
			ts: new Date().toISOString(),
			status,
			signatures,
			retryHint,
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
	const retryHint = retryHintForSignatures(signatures);
	printSignatureSummary(signatures, retryHint);
	appendSignatureSummary(signatures, "failed", retryHint);
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
		pythonPrecheckBlocked: 0,
		biomeIoDetections: 0,
		biomeHotfixRuns: 0,
		testRetryCount: 0,
		testFlakeRecovered: 0,
		sigtermDetections: 0,
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
		signatures.pythonPrecheckBlocked += 1;
		failWithSummary(
			2,
			"[ci-resilient] precheck blocked: neither python nor python3 found in PATH. Install python3 (or provide python alias) and rerun.",
			signatures,
		);
	}

	const normalizeStep = await runWithSigtermRetry(
		"node",
		["scripts/normalize-runtime-metrics.mjs"],
		"normalize-runtime-metrics",
		runtime.env,
		signatures,
	);
	if (normalizeStep.code !== 0) {
		signatures.checkFailureKind = classifyCheckFailure(normalizeStep.output);
		failWithSummary(
			normalizeStep.code,
			`[ci-resilient] normalize-runtime-metrics failed (${signatures.checkFailureKind})`,
			signatures,
		);
	}
	await applyBiomeHotfix(runtime.env, signatures, "proactive");

	console.log("[ci-resilient] step 1/3: npm run check");
	let check = await runWithSigtermRetry(
		"npm",
		["run", "check"],
		"check",
		runtime.env,
		signatures,
	);
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
		check = await runWithSigtermRetry(
			"npm",
			["run", "check"],
			"check(retry)",
			runtime.env,
			signatures,
		);
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
	const security = await runWithSigtermRetry(
		"npm",
		["run", "security:check"],
		"security",
		runtime.env,
		signatures,
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
	let test = await runWithSigtermRetry(
		"npm",
		["test"],
		"test",
		runtime.env,
		signatures,
	);
	if (hasPythonMissingSignature(test.output)) {
		signatures.pythonMissingDetections += 1;
	}
	if (test.code !== 0) {
		signatures.testRetryCount += 1;
		console.log("[ci-resilient] first npm test failed, retrying once...");
		test = await runWithSigtermRetry(
			"npm",
			["test"],
			"test(retry)",
			runtime.env,
			signatures,
		);
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
	const retryHint = "none";
	printSignatureSummary(signatures, retryHint);
	appendSignatureSummary(signatures, "success", retryHint);
}

await main();
