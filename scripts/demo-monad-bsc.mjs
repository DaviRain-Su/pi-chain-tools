#!/usr/bin/env node

const BASE_URL = process.env.DASHBOARD_BASE_URL || "http://127.0.0.1:4173";
const EXECUTE_CONFIRM_TEXT = "I_UNDERSTAND_THIS_WILL_EXECUTE_ONCHAIN";

function parseArgs(argv) {
	const args = {
		execute: false,
		confirmExecute: "",
		amountRaw: "1000",
		protocol: "venus",
		timeoutMs: 20000,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const item = argv[i];
		if (item === "--help" || item === "-h") {
			args.help = true;
			continue;
		}
		if (item === "--execute") {
			args.execute = true;
			continue;
		}
		if (item === "--confirm-execute") {
			args.confirmExecute = String(argv[i + 1] || "");
			i += 1;
			continue;
		}
		if (item === "--amount-raw") {
			args.amountRaw = String(argv[i + 1] || "1000");
			i += 1;
			continue;
		}
		if (item === "--protocol") {
			args.protocol = String(argv[i + 1] || "venus");
			i += 1;
		}
	}
	return args;
}

function printHelp() {
	console.log(
		`demo:monad-bsc\n\nSafe default (dry-run, non-destructive):\n  npm run demo:monad-bsc\n\nLive execute (guarded):\n  npm run demo:monad-bsc -- --execute --confirm-execute ${EXECUTE_CONFIRM_TEXT}\n\nOptions:\n  --execute                 Enable live execute step (disabled by default)\n  --confirm-execute <text>  Must exactly equal ${EXECUTE_CONFIRM_TEXT}\n  --amount-raw <value>      Monad execute amountRaw (default: 1000)\n  --protocol <name>         BSC execution protocol hint (default: venus)\n  --help                    Show this help\n`,
	);
}

async function callApi(method, route, body, timeoutMs = 20000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${BASE_URL}${route}`, {
			method,
			headers: { "content-type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});
		const text = await response.text();
		let json = null;
		try {
			json = JSON.parse(text);
		} catch {
			json = { raw: text };
		}
		return { ok: response.ok, status: response.status, data: json };
	} catch (error) {
		return {
			ok: false,
			status: 0,
			data: { error: error instanceof Error ? error.message : String(error) },
		};
	} finally {
		clearTimeout(timer);
	}
}

function summarizeStep(name, result) {
	const badge = result.ok ? "OK" : "WARN";
	console.log(`[${badge}] ${name} -> status=${result.status}`);
}

function buildReconcileSummary(monadPlan, bscPlan) {
	const canExecute = monadPlan?.data?.readiness?.canExecute;
	const monadBlockers = monadPlan?.data?.readiness?.blockers || [];
	const bscRecommended =
		bscPlan?.data?.executeReadiness?.recommendedProtocol ||
		bscPlan?.data?.recommendedProtocol ||
		"unknown";
	const monadState = canExecute === true ? "ready" : "guarded";
	return {
		monadState,
		monadBlockerCount: Array.isArray(monadBlockers) ? monadBlockers.length : 0,
		bscRecommendedProtocol: bscRecommended,
		note:
			canExecute === true
				? "Monad execute gate looks open."
				: "Monad execute still guarded (expected in many local demo setups).",
	};
}

async function run() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	if (args.execute && args.confirmExecute !== EXECUTE_CONFIRM_TEXT) {
		console.error(
			`Refusing live execution: --confirm-execute must equal ${EXECUTE_CONFIRM_TEXT}`,
		);
		process.exit(2);
	}

	console.log(
		"[demo] mode:",
		args.execute ? "LIVE EXECUTE" : "DRY-RUN (safe default)",
	);
	console.log("[demo] base:", BASE_URL);

	const readStep = await callApi(
		"GET",
		"/api/monad/morpho/earn/markets",
		null,
		args.timeoutMs,
	);
	summarizeStep("read: monad markets", readStep);

	const monadPlanStep = await callApi(
		"POST",
		"/api/monad/morpho/earn/plan",
		{ amountRaw: args.amountRaw },
		args.timeoutMs,
	);
	summarizeStep("plan: monad earn", monadPlanStep);

	const bscPlanStep = await callApi(
		"GET",
		`/api/bsc/yield/plan?executionProtocol=${encodeURIComponent(args.protocol)}`,
		null,
		args.timeoutMs,
	);
	summarizeStep("plan: bsc yield", bscPlanStep);

	const reconcile = buildReconcileSummary(monadPlanStep, bscPlanStep);
	console.log("[INFO] reconcile:", JSON.stringify(reconcile));

	const statusStep = await callApi(
		"GET",
		"/api/acp/status",
		null,
		args.timeoutMs,
	);
	summarizeStep("status: acp status", statusStep);

	let executeMonad = { ok: true, status: 0, data: { skipped: true } };
	let executeBsc = { ok: true, status: 0, data: { skipped: true } };
	if (args.execute) {
		executeMonad = await callApi(
			"POST",
			"/api/monad/morpho/earn/execute",
			{ confirm: true, amountRaw: args.amountRaw },
			args.timeoutMs,
		);
		summarizeStep("execute: monad morpho earn", executeMonad);

		executeBsc = await callApi(
			"POST",
			"/api/bsc/yield/execute",
			{
				confirm: true,
				dryRun: false,
				executionProtocol: args.protocol,
				amountUsd: 10,
			},
			args.timeoutMs,
		);
		summarizeStep("execute: bsc yield", executeBsc);
	}

	console.log("\n=== demo summary ===");
	console.log(
		JSON.stringify(
			{
				mode: args.execute ? "execute" : "dry-run",
				baseUrl: BASE_URL,
				steps: {
					read: { ok: readStep.ok, status: readStep.status },
					planMonad: { ok: monadPlanStep.ok, status: monadPlanStep.status },
					planBsc: { ok: bscPlanStep.ok, status: bscPlanStep.status },
					reconcile,
					status: { ok: statusStep.ok, status: statusStep.status },
					executeMonad: {
						skipped: !args.execute,
						ok: executeMonad.ok,
						status: executeMonad.status,
					},
					executeBsc: {
						skipped: !args.execute,
						ok: executeBsc.ok,
						status: executeBsc.status,
					},
				},
			},
			null,
			2,
		),
	);
}

await run();
