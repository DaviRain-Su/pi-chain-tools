#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runAsterDexExecSafe } from "./asterdex-exec-safe.mjs";
import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) ?? process.cwd();
const DEFAULT_OUT = path.join(
	REPO_ROOT,
	"apps",
	"dashboard",
	"data",
	"proofs",
	"autonomous-cycle",
	"latest.json",
);

function parseArgs(rawArgs = process.argv.slice(2)) {
	const args = {
		mode: "dryrun",
		out: DEFAULT_OUT,
		runId: `autonomous-cycle-${Date.now()}`,
	};
	for (let i = 0; i < rawArgs.length; i += 1) {
		const token = String(rawArgs[i] || "");
		if (!token.startsWith("--")) continue;
		const key = token.slice(2);
		const value = rawArgs[i + 1];
		if (value === undefined) throw new Error(`missing value for --${key}`);
		i += 1;
		switch (key) {
			case "mode":
				args.mode = String(value).trim().toLowerCase();
				break;
			case "out":
				args.out = path.resolve(String(value));
				break;
			case "run-id":
				args.runId = String(value).trim();
				break;
			default:
				throw new Error(`unknown argument: --${key}`);
		}
	}
	if (args.mode !== "dryrun" && args.mode !== "live") {
		throw new Error("--mode must be dryrun|live");
	}
	return args;
}

function buildIntent(runId, env) {
	return {
		runId,
		tokenIn: String(
			env.BSC_AUTONOMOUS_ASTERDEX_TOKEN_IN || env.BSC_USDC || "USDC",
		),
		tokenOut: String(
			env.BSC_AUTONOMOUS_ASTERDEX_TOKEN_OUT || env.BSC_USDT || "USDT",
		),
		amountRaw: String(
			env.BSC_AUTONOMOUS_ASTERDEX_AMOUNT_RAW || "1000000000000000",
		),
		routerAddress: String(env.BSC_AUTONOMOUS_ASTERDEX_ROUTER_ADDRESS || ""),
		executorAddress: String(env.BSC_AUTONOMOUS_ASTERDEX_EXECUTOR_ADDRESS || ""),
	};
}

function summarizeReconcile(execResult) {
	if (execResult.status === "executed") {
		return {
			status: execResult.txHash ? "submitted" : "submitted_without_hash",
			notes: ["Execution command completed.", "Verify txHash on BSC explorer."],
		};
	}
	if (execResult.status === "dryrun") {
		return {
			status: "dryrun_only",
			notes: [
				"No state change performed.",
				"Live mode requires explicit confirmation and active binding.",
			],
		};
	}
	return {
		status: "blocked_or_failed",
		notes: [
			"Execution path blocked or failed.",
			"Review blockers/evidence and resolve config guardrails.",
		],
	};
}

export async function runBscAutonomousCycle(
	rawArgs = process.argv.slice(2),
	env = process.env,
) {
	const args = parseArgs(rawArgs);
	const startedAt = new Date().toISOString();
	const intent = buildIntent(args.runId, env);
	const confirm = String(
		env.BSC_AUTONOMOUS_ASTERDEX_CONFIRM_TEXT || "ASTERDEX_EXECUTE_LIVE",
	);
	const execArgs = [
		"--mode",
		args.mode,
		"--intent-json",
		JSON.stringify(intent),
		"--confirm",
		args.mode === "live" ? confirm : "",
	];
	const execution = runAsterDexExecSafe(execArgs, env);
	const decision = execution.ok
		? args.mode === "live"
			? "execute"
			: "simulate_execute"
		: "hold_blocked";
	const proof = {
		suite: "bsc-autonomous-cycle",
		version: 1,
		startedAt,
		finishedAt: new Date().toISOString(),
		mode: args.mode,
		decision,
		intent,
		txEvidence: {
			status: execution.status,
			txHash: execution.txHash || null,
			evidence: execution.evidence || null,
			blockers: execution.blockers || [],
			reason: execution.reason || null,
		},
		reconcileSummary: summarizeReconcile(execution),
		ok: execution.ok,
	};
	await mkdir(path.dirname(args.out), { recursive: true });
	await writeFile(args.out, `${JSON.stringify(proof, null, 2)}\n`);
	return { ok: proof.ok, out: args.out, proof };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runBscAutonomousCycle()
		.then((result) => {
			console.log(JSON.stringify(result, null, 2));
			if (!result.ok) process.exitCode = 1;
		})
		.catch((error) => {
			console.error(
				"[bsc-autonomous-cycle] failed",
				error instanceof Error ? error.message : String(error),
			);
			process.exitCode = 1;
		});
}
