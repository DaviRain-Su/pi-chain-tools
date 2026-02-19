#!/usr/bin/env node
import { readFileSync } from "node:fs";

function parseArgs(argv) {
	const args = argv.slice(2);
	const parsed = {
		mode: "safe",
		input: "",
		format: "json",
	};
	for (let i = 0; i < args.length; i += 1) {
		const value = args[i];
		if (value === "--mode" && args[i + 1]) {
			parsed.mode = args[i + 1];
			i += 1;
			continue;
		}
		if (value === "--input" && args[i + 1]) {
			parsed.input = args[i + 1];
			i += 1;
			continue;
		}
		if (value === "--format" && args[i + 1]) {
			parsed.format = args[i + 1];
			i += 1;
			continue;
		}
		if (value === "--help") {
			printHelp();
			process.exit(0);
		}
	}
	return parsed;
}

function printHelp() {
	console.log(`solana-bridge-safe-batch

Usage:
  node scripts/solana-bridge-safe-batch.mjs --input <tasks.json> [--mode safe|research] [--format json]

Input format:
  {
    "tasks": [
      { "taskId": "read:solana_getPortfolio", "kind": "read", "metadata": { "operationKind": "read" } }
    ]
  }

Behavior:
  - default mode is safe
  - safe/research both reject execute/mutate intents
  - output is operator-focused batch verdicts only (no autonomous execute)
`);
}

function normalizeMode(mode) {
	return mode === "research" ? "research" : "safe";
}

function hasMutatingIntent(task) {
	const haystack = [
		String(task?.kind || "").toLowerCase(),
		String(task?.taskId || "").toLowerCase(),
		String(task?.metadata?.operationKind || "").toLowerCase(),
		String(task?.title || "").toLowerCase(),
		String(task?.intent || "").toLowerCase(),
	].join(" ");
	return /(execute|mutate|transfer|swap|borrow|withdraw|supply|repay|bridge)/.test(
		haystack,
	);
}

function isReadPlan(task) {
	const operationKind = String(
		task?.metadata?.operationKind || "",
	).toLowerCase();
	if (operationKind === "read" || operationKind === "plan") return true;
	const kind = String(task?.kind || "").toLowerCase();
	return kind === "read" || kind === "task_discovery";
}

function runBatch(tasks, mode) {
	const normalizedMode = normalizeMode(mode);
	const results = tasks.map((task) => {
		if (!isReadPlan(task)) {
			return {
				taskId: task?.taskId || "unknown",
				accepted: false,
				status: "rejected",
				reason: `task is not read/plan compatible in ${normalizedMode} mode`,
			};
		}
		if (hasMutatingIntent(task)) {
			return {
				taskId: task?.taskId || "unknown",
				accepted: false,
				status: "rejected",
				reason:
					"mutating/execute intents are blocked; use guarded confirm/policy/reconcile pipeline",
			};
		}
		return {
			taskId: task?.taskId || "unknown",
			accepted: true,
			status: "accepted",
		};
	});
	const accepted = results.filter((v) => v.accepted).length;
	const rejected = results.length - accepted;
	return {
		mode: normalizedMode,
		totalTasks: tasks.length,
		accepted,
		rejected,
		results,
	};
}

function main() {
	const args = parseArgs(process.argv);
	if (!args.input) {
		console.error("--input is required. Use --help for usage.");
		process.exit(1);
	}
	const payload = JSON.parse(readFileSync(args.input, "utf8"));
	const tasks = Array.isArray(payload)
		? payload
		: Array.isArray(payload.tasks)
			? payload.tasks
			: [];
	const output = runBatch(tasks, args.mode);
	console.log(JSON.stringify(output, null, 2));
}

main();
