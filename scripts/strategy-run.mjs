#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) {
			args._.push(token);
			continue;
		}
		const [k, v] = token.split("=", 2);
		const key = k.slice(2);
		if (typeof v !== "undefined") {
			args[key] = v;
			continue;
		}
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args[key] = true;
			continue;
		}
		args[key] = next;
		i += 1;
	}
	return args;
}

function usage() {
	return [
		"Usage: node scripts/strategy-run.mjs --spec <path> [--mode dry-run|plan] [--json]",
		"",
		"Notes:",
		"  v0 runner is intentionally non-custodial and plan-first.",
		"  mode=dry-run (default) simulates step execution and emits execution trace.",
	].join("\n");
}

async function loadJson(filePath) {
	const raw = await readFile(filePath, "utf8");
	return JSON.parse(raw);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(usage());
		process.exit(0);
	}
	if (!args.spec) {
		console.error("--spec is required");
		console.error(usage());
		process.exit(1);
	}

	const mode = String(args.mode || "dry-run");
	if (!["dry-run", "plan"].includes(mode)) {
		console.error("--mode must be dry-run or plan");
		process.exit(1);
	}

	const spec = await loadJson(path.resolve(String(args.spec)));
	const steps = Array.isArray(spec?.plan?.steps) ? spec.plan.steps : [];
	if (steps.length === 0) {
		console.error("strategy plan.steps is required");
		process.exit(2);
	}

	const executionTrace = steps.map((step, index) => ({
		index,
		id: step.id,
		action: step.action,
		component: step.component,
		status: mode === "plan" ? "PLANNED" : "SIMULATED_OK",
		ts: new Date().toISOString(),
	}));

	const result = {
		status: "ok",
		mode,
		strategyId: spec.id || null,
		steps: executionTrace,
		evidence: {
			type: "strategy_execution_trace@v0",
			generatedAt: new Date().toISOString(),
		},
	};

	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	console.log(`STRATEGY_RUN_${mode === "plan" ? "PLAN" : "SIMULATION"}_OK`);
	console.log(
		`strategy=${result.strategyId || "unknown"} steps=${steps.length}`,
	);
}

await main();
