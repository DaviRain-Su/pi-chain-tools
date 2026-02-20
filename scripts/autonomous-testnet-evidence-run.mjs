#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) ?? process.cwd();
const DEFAULT_ENV_FILE = path.join(REPO_ROOT, ".env.bsc.local");
const DEFAULT_OUTPUT = path.join(
	REPO_ROOT,
	"docs",
	"submission-bundles",
	"autonomous-bsc",
	"testnet-cycle-evidence.json",
);

function parseDotEnv(content) {
	const out = {};
	for (const line of String(content).split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const idx = trimmed.indexOf("=");
		if (idx <= 0) continue;
		const key = trimmed.slice(0, idx).trim();
		let value = trimmed.slice(idx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

function loadEnv(baseEnv) {
	if (!existsSync(DEFAULT_ENV_FILE)) return { ...baseEnv };
	try {
		const parsed = parseDotEnv(readFileSync(DEFAULT_ENV_FILE, "utf8"));
		return { ...parsed, ...baseEnv };
	} catch {
		return { ...baseEnv };
	}
}

function parseArgs(argv = process.argv.slice(2)) {
	const out = {
		output: DEFAULT_OUTPUT,
		runId: `testnet-cycle-${Date.now()}`,
		doCompile: true,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const token = String(argv[i] || "");
		if (!token.startsWith("--")) continue;
		const key = token.slice(2);
		if (key === "no-compile") {
			out.doCompile = false;
			continue;
		}
		const value = argv[i + 1];
		if (value === undefined) throw new Error(`missing value for --${key}`);
		i += 1;
		switch (key) {
			case "output":
				out.output = path.resolve(String(value));
				break;
			case "run-id":
				out.runId = String(value).trim() || out.runId;
				break;
			default:
				throw new Error(`unknown argument --${key}`);
		}
	}
	return out;
}

function hasValue(env, key) {
	return String(env[key] || "").trim().length > 0;
}

function validatePrerequisites(env) {
	const missing = [];
	if (!hasValue(env, "BSC_TESTNET_RPC_URL") && !hasValue(env, "BSC_RPC_URL")) {
		missing.push("BSC_TESTNET_RPC_URL or BSC_RPC_URL");
	}
	if (
		!hasValue(env, "BSC_TESTNET_PRIVATE_KEY") &&
		!hasValue(env, "BSC_EXECUTE_PRIVATE_KEY")
	) {
		missing.push("BSC_TESTNET_PRIVATE_KEY or BSC_EXECUTE_PRIVATE_KEY");
	}
	if (
		!hasValue(env, "BSC_AUTONOMOUS_CONTRACT_ADDRESS") &&
		!hasValue(env, "BSC_AUTONOMOUS_ROUTER_ADDRESS")
	) {
		missing.push(
			"BSC_AUTONOMOUS_CONTRACT_ADDRESS or BSC_AUTONOMOUS_ROUTER_ADDRESS",
		);
	}
	return {
		ok: missing.length === 0,
		missing,
	};
}

function runNodeScript(scriptPath, args, env) {
	const out = spawnSync(process.execPath, [scriptPath, ...args], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		env,
	});
	const stdout = String(out.stdout || "").trim();
	const stderr = String(out.stderr || "").trim();
	return {
		status: out.status,
		stdout,
		stderr,
		ok: out.status === 0,
	};
}

function parseJsonFromOutput(step) {
	for (const raw of [step.stdout, step.stderr]) {
		if (!raw) continue;
		const start = raw.indexOf("{");
		const end = raw.lastIndexOf("}");
		if (start < 0 || end < 0 || end < start) continue;
		try {
			return JSON.parse(raw.slice(start, end + 1));
		} catch {
			// continue
		}
	}
	return null;
}

function deterministicGuidance(missing) {
	return {
		status: "missing_prerequisites",
		missing,
		nextSteps: [
			"cp .env.bsc.example .env.bsc.local",
			"fill all missing keys listed above",
			"npm run contracts:bsc:compile",
			"npm run autonomous:bsc:testnet:evidence",
		],
	};
}

export async function runAutonomousTestnetEvidence(
	rawArgs = process.argv.slice(2),
	envIn = process.env,
) {
	const args = parseArgs(rawArgs);
	const env = loadEnv(envIn);
	const precheck = validatePrerequisites(env);
	if (!precheck.ok) {
		const guidance = deterministicGuidance(precheck.missing);
		console.error(JSON.stringify(guidance, null, 2));
		process.exitCode = 2;
		return { ok: false, guidance };
	}

	if (args.doCompile) {
		const compile = spawnSync("npm", ["run", "contracts:bsc:compile"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env,
		});
		if (compile.status !== 0) {
			throw new Error(
				`compile failed: ${String(compile.stderr || compile.stdout || "unknown")}`,
			);
		}
	}

	let strategyAddress = String(
		env.BSC_AUTONOMOUS_CONTRACT_ADDRESS || "",
	).trim();
	let deployEvidence = null;
	if (!strategyAddress) {
		const deploy = runNodeScript(
			path.join(
				REPO_ROOT,
				"contracts",
				"bsc-autonomous",
				"scripts",
				"deploy.mjs",
			),
			[],
			env,
		);
		if (!deploy.ok) {
			throw new Error(
				`deploy failed: ${deploy.stderr || deploy.stdout || "unknown"}`,
			);
		}
		deployEvidence = parseJsonFromOutput(deploy);
		strategyAddress = String(deployEvidence?.deployment?.address || "").trim();
		if (!strategyAddress)
			throw new Error(
				"deploy succeeded but no contract address found in output",
			);
	}

	const cycle = runNodeScript(
		path.join(
			REPO_ROOT,
			"contracts",
			"bsc-autonomous",
			"scripts",
			"run-cycle.mjs",
		),
		[
			"--contract",
			strategyAddress,
			"--transitionNonce",
			String(env.BSC_AUTONOMOUS_CONTRACT_NEXT_NONCE || "1"),
		],
		env,
	);
	if (!cycle.ok) {
		throw new Error(
			`cycle failed: ${cycle.stderr || cycle.stdout || "unknown"}`,
		);
	}
	const cycleEvidence = parseJsonFromOutput(cycle);

	const evidence = {
		suite: "autonomous-bsc-testnet-evidence",
		version: 1,
		generatedAt: new Date().toISOString(),
		network: "bscTestnet",
		contractAddress: strategyAddress,
		deployment: deployEvidence?.deployment || null,
		cycle: {
			txHash: cycleEvidence?.txHash || null,
			blockNumber: cycleEvidence?.blockNumber || null,
			emittedEvents: cycleEvidence?.emittedEvents || [],
			decision: cycleEvidence?.decision || null,
			stateDelta: cycleEvidence?.stateDelta || null,
			raw: cycleEvidence || null,
		},
	};

	await mkdir(path.dirname(args.output), { recursive: true });
	await writeFile(
		args.output,
		`${JSON.stringify(evidence, null, 2)}\n`,
		"utf8",
	);
	console.log(
		JSON.stringify({ ok: true, output: args.output, evidence }, null, 2),
	);
	return { ok: true, output: args.output, evidence };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runAutonomousTestnetEvidence().catch((error) => {
		console.error(
			JSON.stringify(
				{
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				},
				null,
				2,
			),
		);
		process.exitCode = 1;
	});
}
