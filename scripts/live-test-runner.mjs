#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

const VALID_MODES = new Set(["preflight", "dryrun", "execute", "full"]);
const VALID_CHAINS = new Set(["bsc", "starknet", "solana", "all"]);
const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) ?? process.cwd();
const PROOFS_DIR = path.join(
	REPO_ROOT,
	"apps",
	"dashboard",
	"data",
	"proofs",
	"live-test",
);
const LATEST_JSON_PATH = path.join(PROOFS_DIR, "latest.json");
const LATEST_MD_PATH = path.join(PROOFS_DIR, "latest.md");

function parseArgs(rawArgs = process.argv.slice(2)) {
	const args = {
		mode: "preflight",
		confirmLive: false,
		maxUsd: 5,
		targetChain: "all",
		out: LATEST_JSON_PATH,
		panicStop: "",
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
			case "confirm-live":
				args.confirmLive = String(value).trim().toLowerCase() === "true";
				break;
			case "max-usd":
				args.maxUsd = Number.parseFloat(String(value));
				break;
			case "target-chain":
				args.targetChain = String(value).trim().toLowerCase();
				break;
			case "out":
				args.out = path.resolve(String(value));
				break;
			case "panic-stop":
				args.panicStop = path.resolve(String(value));
				break;
			default:
				throw new Error(`unknown argument: --${key}`);
		}
	}

	if (!VALID_MODES.has(args.mode)) {
		throw new Error("--mode must be preflight|dryrun|execute|full");
	}
	if (!VALID_CHAINS.has(args.targetChain)) {
		throw new Error("--target-chain must be bsc|starknet|solana|all");
	}
	if (!Number.isFinite(args.maxUsd) || args.maxUsd <= 0) {
		throw new Error("--max-usd must be a positive number");
	}
	return args;
}

function selectedChains(targetChain) {
	if (targetChain === "all") return ["bsc", "starknet", "solana"];
	return [targetChain];
}

function evaluateAutonomousTrack(env, mode) {
	const autonomousMode =
		String(env.BSC_AUTONOMOUS_MODE || "")
			.trim()
			.toLowerCase() === "true";
	const asterDexBindingRequired =
		String(env.BSC_AUTONOMOUS_ASTERDEX_EXECUTE_BINDING_REQUIRED || "")
			.trim()
			.toLowerCase() === "true";
	const asterDexBindingEnabled =
		String(env.BSC_AUTONOMOUS_ASTERDEX_EXECUTE_BINDING_ENABLED || "")
			.trim()
			.toLowerCase() === "true";
	const asterDexExecuteActive =
		String(env.BSC_AUTONOMOUS_ASTERDEX_EXECUTE_ACTIVE || "")
			.trim()
			.toLowerCase() === "true";
	const asterDexConfigReady = Boolean(
		asterDexBindingEnabled &&
			String(env.BSC_AUTONOMOUS_ASTERDEX_EXECUTE_COMMAND || "").trim() &&
			String(env.BSC_AUTONOMOUS_ASTERDEX_ROUTER_ADDRESS || "").trim() &&
			String(env.BSC_AUTONOMOUS_ASTERDEX_EXECUTOR_ADDRESS || "").trim(),
	);
	const asterDexExecuteBinding =
		!autonomousMode || !asterDexConfigReady
			? "none"
			: asterDexExecuteActive
				? "active"
				: "prepared";

	if (!autonomousMode) {
		return {
			enabled: false,
			health: "legacy-track",
			blockers: [],
			actions: [
				"Set BSC_AUTONOMOUS_MODE=true to validate autonomous controls.",
			],
			evidence: {
				autonomousMode: false,
				cycleConfigPresent: false,
				asterDexExecuteBinding,
				asterDexExecuteBindingRequired: false,
				asterDexExecuteBindingReady: true,
			},
		};
	}
	const cycleId = String(env.BSC_AUTONOMOUS_CYCLE_ID || "").trim();
	const interval = Number.parseInt(
		String(env.BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS || "").trim(),
		10,
	);
	const blockers = [];
	if (!cycleId || !Number.isFinite(interval) || interval <= 0) {
		blockers.push(
			"deterministic cycle config missing (BSC_AUTONOMOUS_CYCLE_ID, BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS)",
		);
	}
	if (asterDexBindingRequired && asterDexExecuteBinding === "none") {
		blockers.push(
			"AsterDEX execute binding required but unavailable (set BSC_AUTONOMOUS_ASTERDEX_EXECUTE_BINDING_ENABLED=true with *_EXECUTE_COMMAND, *_ROUTER_ADDRESS, *_EXECUTOR_ADDRESS)",
		);
	}
	if (mode !== "full") {
		blockers.push(
			`manual mode '${mode}' is external; autonomous track allows deterministic contract cycle only`,
		);
	}
	return {
		enabled: true,
		health: blockers.length === 0 ? "healthy" : "blocked",
		blockers,
		actions:
			blockers.length === 0
				? ["Maintain deterministic cycle execution path only."]
				: [
						"Route calls through deterministic contract cycle.",
						"Disable BSC_AUTONOMOUS_MODE for manual preflight/dryrun testing.",
						"If AsterDEX binding is required, set binding envs before rerun.",
					],
		evidence: {
			autonomousMode: true,
			cycleConfigPresent: Boolean(
				cycleId && Number.isFinite(interval) && interval > 0,
			),
			cycleId: cycleId || undefined,
			intervalSeconds: Number.isFinite(interval) ? interval : undefined,
			requestMode: mode,
			asterDexExecuteBinding,
			asterDexExecuteBindingRequired: asterDexBindingRequired,
			asterDexExecuteBindingReady:
				asterDexBindingRequired !== true || asterDexExecuteBinding !== "none",
		},
	};
}

async function fetchJson(url, init = {}) {
	try {
		const response = await fetch(url, init);
		const payload = await response.json().catch(() => null);
		return { ok: response.ok, status: response.status, payload, url };
	} catch (error) {
		return {
			ok: false,
			status: 0,
			error: error instanceof Error ? error.message : String(error),
			payload: null,
			url,
		};
	}
}

function runNpmScript(name) {
	const result = spawnSync("npm", ["run", name], {
		encoding: "utf8",
		env: process.env,
	});
	return {
		script: name,
		ok: result.status === 0,
		status: result.status,
		stdout: (result.stdout || "").slice(-1500),
		stderr: (result.stderr || "").slice(-1500),
	};
}

async function runPreflight({ dashboardBaseUrl, chains }) {
	const envChecks = {
		DASHBOARD_BASE_URL: Boolean(process.env.DASHBOARD_BASE_URL || ""),
		BSC_EXECUTE_ENABLED: Boolean(process.env.BSC_EXECUTE_ENABLED || ""),
		BSC_RPC_URL: Boolean(process.env.BSC_RPC_URL || ""),
		BREEZE_API_BASE_URL: Boolean(process.env.BREEZE_API_BASE_URL || ""),
		BREEZE_API_KEY: Boolean(process.env.BREEZE_API_KEY || ""),
	};
	const dashboardHealth = await fetchJson(`${dashboardBaseUrl}/api/health`);
	const dashboardProofSummary = await fetchJson(
		`${dashboardBaseUrl}/api/proof/summary`,
	);

	const chainReachability = {};
	for (const chain of chains) {
		if (chain === "bsc") {
			chainReachability.bsc = await fetchJson(
				"https://bsc-dataseed.binance.org",
			);
		} else if (chain === "starknet") {
			chainReachability.starknet = await fetchJson(
				"https://starknet-mainnet.public.blastapi.io",
			);
		} else if (chain === "solana") {
			chainReachability.solana = await fetchJson(
				"https://api.mainnet-beta.solana.com",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "getHealth",
						params: [],
					}),
				},
			);
		}
	}

	const ok = Boolean(dashboardHealth.ok);
	return {
		ok,
		envChecks,
		dashboard: {
			baseUrl: dashboardBaseUrl,
			health: dashboardHealth,
			proofSummary: dashboardProofSummary,
		},
		chainReachability,
	};
}

async function runDryRun({ dashboardBaseUrl }) {
	const proofSummary = await fetchJson(`${dashboardBaseUrl}/api/proof/summary`);
	const smoke = runNpmScript("breeze:smoke");
	const securityScan = runNpmScript("security:scan:once");
	const opsSmoke = runNpmScript("ops:smoke");
	const ok = Boolean(
		proofSummary.ok && smoke.ok && securityScan.ok && opsSmoke.ok,
	);
	return {
		ok,
		proofSummary,
		scripts: {
			breezeSmoke: smoke,
			securityScanOnce: securityScan,
			opsSmoke,
		},
		nonMutatingChecks: [
			"GET /api/proof/summary",
			"npm run breeze:smoke",
			"npm run security:scan:once",
			"npm run ops:smoke",
		],
	};
}

async function runExecute({
	dashboardBaseUrl,
	chains,
	confirmLive,
	maxUsd,
	panicStop,
}) {
	if (confirmLive !== true) {
		return {
			ok: false,
			blocked: true,
			reason: "execute requires --confirm-live true",
			executions: [],
		};
	}
	if (panicStop && existsSync(panicStop)) {
		return {
			ok: false,
			aborted: true,
			reason: `panic-stop flag exists: ${panicStop}`,
			executions: [],
		};
	}

	const executions = [];
	for (const chain of chains) {
		if (chain === "bsc") {
			const amountInUi = String(Math.min(maxUsd, 1));
			const result = await fetchJson(`${dashboardBaseUrl}/api/bsc/swap`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					confirm: true,
					tokenIn: "BNB",
					tokenOut: "USDT",
					amountInUi,
					runId: `live-test-${Date.now()}`,
					step: "live-test-runner",
				}),
			});
			executions.push({
				chain,
				ok: Boolean(result.ok && result.payload?.ok),
				request: { amountInUi, capUsd: maxUsd },
				response: result,
			});
			continue;
		}
		executions.push({
			chain,
			ok: false,
			skipped: true,
			reason:
				"live execute endpoint not wired in dashboard for this chain; preflight/dryrun only",
		});
	}

	const hasAttempt = executions.some((x) => x.chain === "bsc");
	const ok = hasAttempt ? executions.every((x) => x.skipped || x.ok) : false;
	return {
		ok,
		executions,
	};
}

function buildRollbackGuidance(args) {
	return {
		notes: [
			"If panic-stop was triggered, remove/rename the panic file only after manual review.",
			"Verify latest proof and tx details in apps/dashboard/data/proofs/live-test/latest.json.",
			"For BSC tx verification, inspect dashboard logs and chain explorer using returned txHash.",
		],
		nextCommands: [
			"npm run live:test:preflight",
			"npm run live:test:dryrun",
			`node scripts/live-test-runner.mjs --mode execute --confirm-live true --max-usd ${args.maxUsd} --target-chain ${args.targetChain}`,
		],
		emergencyStop: args.panicStop
			? `touch ${args.panicStop}`
			: "rerun with --panic-stop ./ops/PANIC_STOP",
	};
}

function toMarkdown(report) {
	const lines = [
		"# Live Test Runner Report",
		"",
		`- Generated: ${report.finishedAt}`,
		`- Mode: ${report.args.mode}`,
		`- Status: ${report.ok ? "ok" : "failed"}`,
		`- Target chain: ${report.args.targetChain}`,
		`- Max USD cap: ${report.args.maxUsd}`,
		"",
		"## Phase results",
		"",
		`- preflight: ${report.phases.preflight?.ok ? "ok" : "failed/skipped"}`,
		`- dryrun: ${report.phases.dryrun?.ok ? "ok" : "failed/skipped"}`,
		`- execute: ${report.phases.execute?.ok ? "ok" : "failed/skipped"}`,
		`- autonomous health: ${report.autonomousTrack?.health ?? "legacy-track"}`,
		"",
		"## Rollback guidance",
		"",
	];
	for (const note of report.rollbackGuidance.notes) lines.push(`- ${note}`);
	lines.push("", "### Next commands", "");
	for (const cmd of report.rollbackGuidance.nextCommands)
		lines.push(`- \`${cmd}\``);
	lines.push(
		"",
		`- Emergency stop: \`${report.rollbackGuidance.emergencyStop}\``,
	);
	return `${lines.join("\n")}\n`;
}

export async function runLiveTestRunner(rawArgs = process.argv.slice(2)) {
	const args = parseArgs(rawArgs);
	const chains = selectedChains(args.targetChain);
	const dashboardBaseUrl = String(
		process.env.DASHBOARD_BASE_URL || "http://127.0.0.1:4173",
	)
		.trim()
		.replace(/\/$/, "");

	const autonomousTrack = evaluateAutonomousTrack(process.env, args.mode);
	const report = {
		suite: "live-test-runner",
		version: 1,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		ok: false,
		args,
		phases: {
			preflight: null,
			dryrun: null,
			execute: null,
		},
		rollbackGuidance: null,
		autonomousTrack: {
			chain: "bsc",
			enabled: autonomousTrack.enabled,
			health: autonomousTrack.health,
			blockers: autonomousTrack.blockers,
			actions: autonomousTrack.actions,
			evidence: autonomousTrack.evidence,
			execution: autonomousTrack.enabled
				? {
						track: "autonomous",
						governance: "hybrid",
						trigger: "deterministic_contract_cycle",
					}
				: {
						track: "legacy",
						governance: "onchain_only",
						trigger: "external",
					},
		},
	};

	const shouldRunPreflight = [
		"preflight",
		"dryrun",
		"execute",
		"full",
	].includes(args.mode);
	const shouldRunDryRun = ["dryrun", "full"].includes(args.mode);
	const shouldRunExecute = ["execute", "full"].includes(args.mode);

	if (shouldRunPreflight) {
		report.phases.preflight = await runPreflight({ dashboardBaseUrl, chains });
	}
	if (shouldRunDryRun) {
		report.phases.dryrun = await runDryRun({ dashboardBaseUrl });
	}
	if (shouldRunExecute) {
		report.phases.execute = await runExecute({
			dashboardBaseUrl,
			chains,
			confirmLive: args.confirmLive,
			maxUsd: args.maxUsd,
			panicStop: args.panicStop,
		});
	}

	report.rollbackGuidance = buildRollbackGuidance(args);
	report.finishedAt = new Date().toISOString();
	report.ok = [
		report.phases.preflight,
		report.phases.dryrun,
		report.phases.execute,
	]
		.filter(Boolean)
		.every((phase) => phase?.ok === true);

	await mkdir(PROOFS_DIR, { recursive: true });
	await writeFile(LATEST_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
	await writeFile(LATEST_MD_PATH, toMarkdown(report));
	if (args.out && path.resolve(args.out) !== path.resolve(LATEST_JSON_PATH)) {
		await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
		await writeFile(
			path.resolve(args.out),
			`${JSON.stringify(report, null, 2)}\n`,
		);
	}
	return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runLiveTestRunner()
		.then((report) => {
			console.log(
				JSON.stringify(
					{
						ok: report.ok,
						mode: report.args.mode,
						report: LATEST_JSON_PATH,
						markdown: LATEST_MD_PATH,
					},
					null,
					2,
				),
			);
			if (!report.ok) process.exitCode = 1;
		})
		.catch((error) => {
			console.error(
				"[live-test-runner] failed",
				error instanceof Error ? error.message : String(error),
			);
			process.exitCode = 1;
		});
}
