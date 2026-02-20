#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const EXECUTE_CONFIRM_TOKEN = "I_ACKNOWLEDGE_EXECUTION";
const LIVE_EXECUTE_CONFIRM_TOKEN = "I_ACKNOWLEDGE_LIVE_EXECUTION";
const LIVE_EXECUTE_MAX_PER_RUN_USD = 100;
const EXECUTE_ALLOWED_TEMPLATE = "rebalance-crosschain-v0";
const EXECUTE_ALLOWED_CHAINS = new Set(["base", "bsc"]);

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
		"Usage: node scripts/strategy-run.mjs --spec <path> [--mode dry-run|plan|execute] [--json]",
		"",
		"Notes:",
		"  v0 runner is intentionally non-custodial and plan-first.",
		"  execute mode is policy-gated and does not broadcast transactions yet.",
		"",
		"Execute flags:",
		"  --confirmExecuteToken I_ACKNOWLEDGE_EXECUTION",
		"  --live true",
		"  --liveConfirmToken I_ACKNOWLEDGE_LIVE_EXECUTION",
	].join("\n");
}

function asObject(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: null;
}

function toBool(value) {
	if (typeof value === "boolean") return value;
	const text = String(value || "").toLowerCase();
	return text === "1" || text === "true" || text === "yes";
}

function evaluateExecutePolicy(spec) {
	const metadata = asObject(spec.metadata);
	const template = String(metadata?.template || "");
	if (template !== EXECUTE_ALLOWED_TEMPLATE) {
		return {
			ok: false,
			reason: `execute policy allows only template '${EXECUTE_ALLOWED_TEMPLATE}'`,
		};
	}

	const constraints = asObject(spec.constraints);
	const allow = asObject(constraints?.allow);
	const risk = asObject(constraints?.risk);
	const chains = Array.isArray(allow?.chains)
		? allow.chains.map((v) => String(v).toLowerCase())
		: [];
	if (
		chains.length === 0 ||
		chains.some((chain) => !EXECUTE_ALLOWED_CHAINS.has(chain))
	) {
		return { ok: false, reason: "execute policy allows only base/bsc chains" };
	}
	const protocols = Array.isArray(allow?.protocols)
		? allow.protocols.map((v) => String(v).toLowerCase())
		: [];
	if (!protocols.includes("lifi")) {
		return { ok: false, reason: "execute policy requires lifi protocol" };
	}

	const maxPerRunUsd = Number(risk?.maxPerRunUsd || 0);
	if (!Number.isFinite(maxPerRunUsd) || maxPerRunUsd <= 0) {
		return {
			ok: false,
			reason: "execute policy requires valid risk.maxPerRunUsd",
		};
	}
	return { ok: true, reason: "policy-passed", maxPerRunUsd };
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
	if (!["dry-run", "plan", "execute"].includes(mode)) {
		console.error("--mode must be dry-run, plan or execute");
		process.exit(1);
	}

	const spec = await loadJson(path.resolve(String(args.spec)));
	const steps = Array.isArray(spec?.plan?.steps) ? spec.plan.steps : [];
	if (steps.length === 0) {
		console.error("strategy plan.steps is required");
		process.exit(2);
	}

	if (
		mode === "execute" &&
		args.confirmExecuteToken !== EXECUTE_CONFIRM_TOKEN
	) {
		const payload = {
			status: "blocked",
			reason: "execute mode requires explicit confirmExecuteToken",
			requiredToken: EXECUTE_CONFIRM_TOKEN,
		};
		if (args.json) {
			console.log(JSON.stringify(payload, null, 2));
		} else {
			console.log(JSON.stringify(payload));
		}
		process.exit(2);
	}

	const executePolicy =
		mode === "execute"
			? evaluateExecutePolicy(spec)
			: { ok: true, reason: null };
	if (mode === "execute" && !executePolicy.ok) {
		const payload = { status: "blocked", reason: executePolicy.reason };
		if (args.json) {
			console.log(JSON.stringify(payload, null, 2));
		} else {
			console.log(JSON.stringify(payload));
		}
		process.exit(2);
	}

	const live = toBool(args.live);
	if (mode === "execute" && live) {
		if (
			Number(executePolicy.maxPerRunUsd || 0) > LIVE_EXECUTE_MAX_PER_RUN_USD
		) {
			const payload = {
				status: "blocked",
				reason: `live execution cap exceeded (${executePolicy.maxPerRunUsd} > ${LIVE_EXECUTE_MAX_PER_RUN_USD})`,
			};
			if (args.json) {
				console.log(JSON.stringify(payload, null, 2));
			} else {
				console.log(JSON.stringify(payload));
			}
			process.exit(2);
		}
		if (args.liveConfirmToken !== LIVE_EXECUTE_CONFIRM_TOKEN) {
			const payload = {
				status: "blocked",
				reason: "live execution requires explicit liveConfirmToken",
				requiredToken: LIVE_EXECUTE_CONFIRM_TOKEN,
			};
			if (args.json) {
				console.log(JSON.stringify(payload, null, 2));
			} else {
				console.log(JSON.stringify(payload));
			}
			process.exit(2);
		}
	}

	const executionTrace = steps.map((step, index) => ({
		index,
		id: step.id,
		action: step.action,
		component: step.component,
		status:
			mode === "plan"
				? "PLANNED"
				: mode === "execute"
					? "EXECUTE_READY_NOOP"
					: "SIMULATED_OK",
		ts: new Date().toISOString(),
	}));

	const result = {
		status: mode === "execute" ? "ready" : "ok",
		mode,
		strategyId: spec.id || null,
		policy: mode === "execute" ? executePolicy : null,
		liveRequested: mode === "execute" ? live : false,
		broadcastStatus:
			mode === "execute" ? (live ? "not-implemented-yet" : "skipped") : "n/a",
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

	const modeLabel =
		mode === "plan"
			? "PLAN"
			: mode === "execute"
				? "EXECUTE_READY"
				: "SIMULATION";
	console.log(`STRATEGY_RUN_${modeLabel}_OK`);
	console.log(
		`strategy=${result.strategyId || "unknown"} steps=${steps.length}`,
	);
}

await main();
