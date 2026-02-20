#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const EXECUTE_CONFIRM_TOKEN = "I_ACKNOWLEDGE_EXECUTION";
const LIVE_EXECUTE_CONFIRM_TOKEN = "I_ACKNOWLEDGE_LIVE_EXECUTION";
const LIVE_EXECUTE_MAX_PER_RUN_USD = 100;
const EXECUTE_ALLOWED_TEMPLATES = new Set([
	"rebalance-crosschain-v0",
	"stable-yield-v1",
]);
const EXECUTE_ALLOWED_CHAINS = new Set(["base", "bsc"]);

const EVM_RPC_ENDPOINTS = {
	base: "https://base.publicnode.com",
	bsc: "https://bsc.publicnode.com",
};

function parseBroadcastNetwork(value) {
	const v = String(value || "").toLowerCase();
	return v === "base" ? "base" : "bsc";
}

function getBroadcastRpcEndpoint(network, overrideUrl) {
	if (overrideUrl && String(overrideUrl).trim())
		return String(overrideUrl).trim();
	const envKey = `EVM_RPC_${network.toUpperCase()}_URL`;
	const envOverride = process.env[envKey]?.trim();
	if (envOverride) return envOverride;
	return EVM_RPC_ENDPOINTS[network];
}

function defaultStableYieldEvidencePath(spec, runId) {
	const template = String(spec?.metadata?.template || "").trim();
	if (template !== "stable-yield-v1") return null;
	const day = new Date().toISOString().slice(0, 10);
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const id = runId || `stable-yield-${stamp}`;
	return path.join("docs", "execution-proofs", day, `${id}.json`);
}

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
		"  live execute supports optional signed tx broadcast (raw tx only).",
		"",
		"Execute flags:",
		"  --confirmExecuteToken I_ACKNOWLEDGE_EXECUTION",
		"  --live true",
		"  --liveConfirmToken I_ACKNOWLEDGE_LIVE_EXECUTION",
		"  --signedTxHex 0x... (optional, live execute only)",
		"  --broadcastNetwork bsc|base (default: bsc)",
		"  --broadcastRpcUrl https://... (optional override)",
		"  --runId run-xxx (optional idempotency key)",
		"  --idempotencyPath /tmp/pct-idem.json (optional)",
		"  --evidenceOut /tmp/strategy-evidence.json (optional)",
		"  stable-yield-v1 live: defaults evidence path to docs/execution-proofs/YYYY-MM-DD/*.json",
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
	if (!EXECUTE_ALLOWED_TEMPLATES.has(template)) {
		return {
			ok: false,
			reason: `execute policy allows only templates: ${Array.from(
				EXECUTE_ALLOWED_TEMPLATES,
			).join(", ")}`,
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

async function loadIdempotencyStore(filePath) {
	if (!filePath) return {};
	try {
		return JSON.parse(await readFile(filePath, "utf8"));
	} catch {
		return {};
	}
}

async function saveIdempotencyStore(filePath, data) {
	if (!filePath) return;
	await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function submitSignedTx(params) {
	const signedTxHex = String(params.signedTxHex || "").trim();
	if (!/^0x[0-9a-fA-F]+$/.test(signedTxHex)) {
		throw new Error("signedTxHex must be a 0x-prefixed hex string");
	}
	const network = parseBroadcastNetwork(params.network || "bsc");
	const rpcUrl = getBroadcastRpcEndpoint(network, params.rpcUrl);
	const response = await fetch(rpcUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "eth_sendRawTransaction",
			params: [signedTxHex],
		}),
	});
	if (!response.ok) {
		throw new Error(`broadcast rpc failed: HTTP ${response.status}`);
	}
	const json = await response.json();
	if (json?.error) {
		throw new Error(`broadcast rpc error: ${json.error.message || "unknown"}`);
	}
	const txHash = String(json?.result || "").trim();
	if (!txHash) throw new Error("broadcast rpc returned empty tx hash");
	return { network, rpcUrl, txHash };
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

	const runId = String(args.runId || "").trim();
	const evidenceOut =
		String(args.evidenceOut || "").trim() ||
		defaultStableYieldEvidencePath(spec, runId) ||
		"";
	const idempotencyPath =
		String(args.idempotencyPath || "").trim() ||
		"/tmp/pct-strategy-idempotency.json";
	const idem = await loadIdempotencyStore(idempotencyPath);
	if (mode === "execute" && live && runId && idem[runId]) {
		const payload = {
			status: "blocked",
			reason: `duplicate runId blocked (${runId})`,
			runId,
			previous: idem[runId],
		};
		if (args.json) {
			console.log(JSON.stringify(payload, null, 2));
		} else {
			console.log(JSON.stringify(payload));
		}
		process.exit(2);
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

	let broadcastStatus =
		mode === "execute" ? (live ? "awaiting-signed-tx" : "skipped") : "n/a";
	let broadcast = null;
	if (mode === "execute" && live && args.signedTxHex) {
		try {
			broadcast = await submitSignedTx({
				signedTxHex: args.signedTxHex,
				network: args.broadcastNetwork || "bsc",
				rpcUrl: args.broadcastRpcUrl,
			});
			broadcastStatus = "submitted";
		} catch (error) {
			broadcastStatus = "failed";
			broadcast = {
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	const result = {
		status: mode === "execute" ? "ready" : "ok",
		mode,
		strategyId: spec.id || null,
		policy: mode === "execute" ? executePolicy : null,
		liveRequested: mode === "execute" ? live : false,
		runId: runId || null,
		evidenceOutPath: evidenceOut || null,
		broadcastStatus,
		broadcast,
		steps: executionTrace,
		evidence: {
			type: "strategy_execution_trace@v0",
			generatedAt: new Date().toISOString(),
		},
	};

	if (
		mode === "execute" &&
		live &&
		runId &&
		["submitted", "failed"].includes(String(broadcastStatus))
	) {
		idem[runId] = {
			broadcastStatus,
			broadcast,
			ts: new Date().toISOString(),
		};
		await saveIdempotencyStore(idempotencyPath, idem);
	}

	if (evidenceOut) {
		await mkdir(path.dirname(evidenceOut), { recursive: true });
		await writeFile(
			evidenceOut,
			`${JSON.stringify(result, null, 2)}\n`,
			"utf8",
		);
	}

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
