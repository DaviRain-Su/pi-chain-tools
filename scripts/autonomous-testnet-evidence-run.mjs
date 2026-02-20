#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

import { applyLegacyBscAutonomousEnvCompat } from "../scripts/hyperliquid-env-compat.mjs";
applyLegacyBscAutonomousEnvCompat(process.env);
const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) ?? process.cwd();
const DEFAULT_ENV_FILE = path.join(REPO_ROOT, ".env.bsc.local");
const DEFAULT_OUTPUT = path.join(
	REPO_ROOT,
	"docs",
	"submission-bundles",
	"autonomous-hyperliquid",
	"testnet-cycle-evidence.json",
);

const BASE_REQUIRED_KEYS = [
	"HYPERLIQUID_TESTNET_RPC_URL or BSC_RPC_URL",
	"HYPERLIQUID_TESTNET_PRIVATE_KEY or BSC_EXECUTE_PRIVATE_KEY",
	"HYPERLIQUID_AUTONOMOUS_TOKEN_IN or BSC_USDC",
	"HYPERLIQUID_AUTONOMOUS_TOKEN_OUT or BSC_USDT",
	"HYPERLIQUID_AUTONOMOUS_AMOUNT_RAW",
];

const OPTIONAL_KEYS = [
	"HYPERLIQUID_AUTONOMOUS_EXECUTE_ACTIVE",
	"HYPERLIQUID_AUTONOMOUS_LIVE_COMMAND",
	"HYPERLIQUID_AUTONOMOUS_CONFIRM_TEXT",
	"HYPERLIQUID_AUTONOMOUS_MAX_AMOUNT_RAW",
	"HYPERLIQUID_AUTONOMOUS_CYCLE_MIN_LIVE_INTERVAL_SECONDS",
	"HYPERLIQUID_AUTONOMOUS_CONTRACT_ADDRESS",
	"HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS",
];

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

function resolveEvidenceMode(env) {
	const onchainMode =
		String(env.HYPERLIQUID_AUTONOMOUS_MODE || "")
			.trim()
			.toLowerCase() === "true";
	return {
		mode: onchainMode ? "onchain-contract-cycle" : "offchain-orchestrator",
		evidenceType: onchainMode
			? "onchain_contract_cycle_evidence"
			: "offchain_orchestrator_evidence",
		onchainMode,
	};
}

function pushMissing(missing, condition, field) {
	if (condition) missing.push(field);
}

function resolveChecklist(modeInfo) {
	const requiredKeys = [...BASE_REQUIRED_KEYS];
	if (modeInfo.onchainMode) {
		requiredKeys.push(
			"HYPERLIQUID_AUTONOMOUS_CONTRACT_ADDRESS or HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS",
		);
	}
	return { requiredKeys, optionalKeys: OPTIONAL_KEYS };
}

function printChecklistSummary(phase, summary) {
	console.log(`[evidence:${phase}] mode=${summary.mode}`);
	console.log(`[evidence:${phase}] output=${summary.output}`);
	console.log(`[evidence:${phase}] required keys:`);
	for (const key of summary.requiredKeys) {
		console.log(`  - ${key}`);
	}
	console.log(`[evidence:${phase}] optional keys:`);
	for (const key of summary.optionalKeys) {
		console.log(`  - ${key}`);
	}
	if (summary.missing?.length) {
		console.log(`[evidence:${phase}] missing:`);
		for (const key of summary.missing) console.log(`  - ${key}`);
	}
}

export function validatePrerequisites(
	env,
	modeInfo = resolveEvidenceMode(env),
) {
	const missing = [];
	pushMissing(
		missing,
		!hasValue(env, "HYPERLIQUID_TESTNET_RPC_URL") &&
			!hasValue(env, "BSC_RPC_URL"),
		"HYPERLIQUID_TESTNET_RPC_URL or BSC_RPC_URL",
	);
	pushMissing(
		missing,
		!hasValue(env, "HYPERLIQUID_TESTNET_PRIVATE_KEY") &&
			!hasValue(env, "BSC_EXECUTE_PRIVATE_KEY"),
		"HYPERLIQUID_TESTNET_PRIVATE_KEY or BSC_EXECUTE_PRIVATE_KEY",
	);
	pushMissing(
		missing,
		!hasValue(env, "HYPERLIQUID_AUTONOMOUS_TOKEN_IN") &&
			!hasValue(env, "BSC_USDC"),
		"HYPERLIQUID_AUTONOMOUS_TOKEN_IN or BSC_USDC",
	);
	pushMissing(
		missing,
		!hasValue(env, "HYPERLIQUID_AUTONOMOUS_TOKEN_OUT") &&
			!hasValue(env, "BSC_USDT"),
		"HYPERLIQUID_AUTONOMOUS_TOKEN_OUT or BSC_USDT",
	);
	pushMissing(
		missing,
		!hasValue(env, "HYPERLIQUID_AUTONOMOUS_AMOUNT_RAW"),
		"HYPERLIQUID_AUTONOMOUS_AMOUNT_RAW",
	);

	if (modeInfo.onchainMode) {
		pushMissing(
			missing,
			!hasValue(env, "HYPERLIQUID_AUTONOMOUS_CONTRACT_ADDRESS") &&
				!hasValue(env, "HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS"),
			"HYPERLIQUID_AUTONOMOUS_CONTRACT_ADDRESS or HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS",
		);
	}

	return {
		ok: missing.length === 0,
		missing,
		mode: modeInfo.mode,
		evidenceType: modeInfo.evidenceType,
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

function deterministicGuidance(precheck) {
	const nextSteps = [
		"cp .env.bsc.example .env.bsc.local",
		"fill all missing keys listed above",
	];
	if (precheck.mode === "onchain-contract-cycle") {
		nextSteps.push(
			"npm run contracts:hyperliquid:compile",
			"npm run autonomous:hyperliquid:testnet:evidence",
		);
	} else {
		nextSteps.push(
			"set HYPERLIQUID_AUTONOMOUS_EXECUTE_ACTIVE=true and HYPERLIQUID_AUTONOMOUS_LIVE_COMMAND",
			"npm run autonomous:hyperliquid:testnet:evidence",
		);
	}
	return {
		status: "missing_prerequisites",
		mode: precheck.mode,
		evidenceType: precheck.evidenceType,
		missing: precheck.missing,
		nextSteps,
	};
}

export async function runAutonomousTestnetEvidence(
	rawArgs = process.argv.slice(2),
	envIn = process.env,
) {
	const args = parseArgs(rawArgs);
	const env = loadEnv(envIn);
	const modeInfo = resolveEvidenceMode(env);
	const checklist = resolveChecklist(modeInfo);
	const precheck = validatePrerequisites(env, modeInfo);

	printChecklistSummary("start", {
		mode: modeInfo.mode,
		output: args.output,
		requiredKeys: checklist.requiredKeys,
		optionalKeys: checklist.optionalKeys,
		missing: precheck.missing,
	});

	if (!precheck.ok) {
		const guidance = deterministicGuidance(precheck);
		console.error(JSON.stringify(guidance, null, 2));
		printChecklistSummary("end", {
			mode: modeInfo.mode,
			output: args.output,
			requiredKeys: checklist.requiredKeys,
			optionalKeys: checklist.optionalKeys,
			missing: precheck.missing,
		});
		process.exitCode = 2;
		return { ok: false, guidance };
	}

	if (modeInfo.onchainMode) {
		if (args.doCompile) {
			const compile = spawnSync(
				"npm",
				["run", "contracts:hyperliquid:compile"],
				{
					cwd: REPO_ROOT,
					encoding: "utf8",
					env,
				},
			);
			if (compile.status !== 0) {
				throw new Error(
					`compile failed: ${String(compile.stderr || compile.stdout || "unknown")}`,
				);
			}
		}

		let strategyAddress = String(
			env.HYPERLIQUID_AUTONOMOUS_CONTRACT_ADDRESS || "",
		).trim();
		let deployEvidence = null;
		if (!strategyAddress) {
			const deploy = runNodeScript(
				path.join(
					REPO_ROOT,
					"contracts",
					"hyperliquid-autonomous",
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
			strategyAddress = String(
				deployEvidence?.deployment?.address || "",
			).trim();
			if (!strategyAddress)
				throw new Error(
					"deploy succeeded but no contract address found in output",
				);
		}

		const cycle = runNodeScript(
			path.join(
				REPO_ROOT,
				"contracts",
				"hyperliquid-autonomous",
				"scripts",
				"run-cycle.mjs",
			),
			[
				"--contract",
				strategyAddress,
				"--transitionNonce",
				String(env.HYPERLIQUID_AUTONOMOUS_CONTRACT_NEXT_NONCE || "1"),
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
			suite: "autonomous-hyperliquid-testnet-evidence",
			version: 2,
			generatedAt: new Date().toISOString(),
			network: "bscTestnet",
			mode: modeInfo.mode,
			evidenceType: modeInfo.evidenceType,
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
		printChecklistSummary("end", {
			mode: modeInfo.mode,
			output: args.output,
			requiredKeys: checklist.requiredKeys,
			optionalKeys: checklist.optionalKeys,
			missing: [],
		});
		console.log(
			JSON.stringify(
				{
					ok: true,
					mode: modeInfo.mode,
					evidenceType: modeInfo.evidenceType,
					output: args.output,
					evidence,
				},
				null,
				2,
			),
		);
		return {
			ok: true,
			mode: modeInfo.mode,
			evidenceType: modeInfo.evidenceType,
			output: args.output,
			evidence,
		};
	}

	const cycle = runNodeScript(
		path.join(REPO_ROOT, "scripts", "hyperliquid-autonomous-cycle.mjs"),
		["--mode", "live", "--run-id", args.runId, "--out", args.output],
		env,
	);
	if (!cycle.ok) {
		throw new Error(
			`offchain evidence cycle failed: ${cycle.stderr || cycle.stdout || "unknown"}`,
		);
	}
	const cycleRun = parseJsonFromOutput(cycle);
	const cycleProof = cycleRun?.proof || cycleRun?.evidence || cycleRun || null;
	const evidence = {
		suite: "autonomous-hyperliquid-testnet-evidence",
		version: 2,
		generatedAt: new Date().toISOString(),
		network: "bscTestnet",
		mode: modeInfo.mode,
		evidenceType: modeInfo.evidenceType,
		cycle: cycleProof,
	};

	await mkdir(path.dirname(args.output), { recursive: true });
	await writeFile(
		args.output,
		`${JSON.stringify(evidence, null, 2)}\n`,
		"utf8",
	);
	printChecklistSummary("end", {
		mode: modeInfo.mode,
		output: args.output,
		requiredKeys: checklist.requiredKeys,
		optionalKeys: checklist.optionalKeys,
		missing: [],
	});
	console.log(
		JSON.stringify(
			{
				ok: true,
				mode: modeInfo.mode,
				evidenceType: modeInfo.evidenceType,
				output: args.output,
				evidence,
			},
			null,
			2,
		),
	);
	return {
		ok: true,
		mode: modeInfo.mode,
		evidenceType: modeInfo.evidenceType,
		output: args.output,
		evidence,
	};
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
