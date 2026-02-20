#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

import { applyLegacyBscAutonomousEnvCompat } from "../scripts/hyperliquid-env-compat.mjs";
applyLegacyBscAutonomousEnvCompat(process.env);

const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) ?? process.cwd();
const REPORT_PATH = path.join(
	REPO_ROOT,
	"docs",
	"submission-bundles",
	"autonomous-hyperliquid",
	"local-bootstrap-ready.json",
);

const REQUIRED_KEYS = [
	"HYPERLIQUID_TESTNET_RPC_URL",
	"HYPERLIQUID_TESTNET_PRIVATE_KEY",
	"HYPERLIQUID_AUTONOMOUS_TOKEN_IN",
	"HYPERLIQUID_AUTONOMOUS_TOKEN_OUT",
	"HYPERLIQUID_AUTONOMOUS_AMOUNT_RAW",
];

const OPTIONAL_KEYS = [
	"HYPERLIQUID_AUTONOMOUS_EXECUTE_ACTIVE",
	"HYPERLIQUID_AUTONOMOUS_LIVE_COMMAND",
	"HYPERLIQUID_AUTONOMOUS_CONFIRM_TEXT",
	"HYPERLIQUID_AUTONOMOUS_MAX_AMOUNT_RAW",
	"HYPERLIQUID_AUTONOMOUS_CYCLE_MIN_LIVE_INTERVAL_SECONDS",
	"HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS",
	"HYPERLIQUID_AUTONOMOUS_CONTRACT_ADDRESS",
];

function hasValue(env, key) {
	return String(env[key] || "").trim().length > 0;
}

function resolveMode(env) {
	const onchainMode =
		String(env.HYPERLIQUID_AUTONOMOUS_MODE || "")
			.trim()
			.toLowerCase() === "true";
	return onchainMode ? "onchain-contract-cycle" : "offchain-orchestrator";
}

function keyState(env, key) {
	return hasValue(env, key) ? "set" : "missing";
}

function parseArgs(argv = process.argv.slice(2)) {
	const out = { report: REPORT_PATH };
	for (let i = 0; i < argv.length; i += 1) {
		const token = String(argv[i] || "");
		if (!token.startsWith("--")) continue;
		const key = token.slice(2);
		if (key !== "report") throw new Error(`unknown argument --${key}`);
		const value = argv[i + 1];
		if (value === undefined) throw new Error("missing value for --report");
		i += 1;
		out.report = path.resolve(String(value));
	}
	return out;
}

export function buildLocalBootstrapReport(env = process.env) {
	const mode = resolveMode(env);
	const required = REQUIRED_KEYS.map((key) => ({
		key,
		status: keyState(env, key),
	}));
	const optional = OPTIONAL_KEYS.map((key) => ({
		key,
		status: keyState(env, key),
	}));
	const missingRequired = required.filter((item) => item.status === "missing");
	const ready = missingRequired.length === 0;

	const nextCommands = ready
		? [
				"npm run autonomous:hyperliquid:testnet:evidence",
				"npm run autonomous:submission:bundle",
				"npm run autonomous:submission:validate",
			]
		: [
				"cp .env.bsc.example .env.bsc.local",
				"edit .env.bsc.local and fill all missing required keys",
				"npm run autonomous:hyperliquid:bootstrap",
			];

	return {
		suite: "hyperliquid-local-offchain-bootstrap",
		version: 1,
		generatedAt: new Date().toISOString(),
		mode,
		ready,
		required,
		optional,
		missingRequired: missingRequired.map((item) => item.key),
		nextCommands,
		notes:
			mode === "offchain-orchestrator"
				? "contract/router are optional in offchain-orchestrator mode"
				: "onchain-contract-cycle mode will require contract/router at evidence step",
	};
}

export async function runLocalBootstrap(
	rawArgs = process.argv.slice(2),
	env = process.env,
) {
	const args = parseArgs(rawArgs);
	const report = buildLocalBootstrapReport(env);
	await mkdir(path.dirname(args.report), { recursive: true });
	await writeFile(args.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");

	const header = report.ready ? "READY" : "NOT READY";
	console.log(`[bootstrap] mode=${report.mode} status=${header}`);
	console.log(`[bootstrap] report=${args.report}`);
	for (const item of report.required) {
		console.log(`[bootstrap] required ${item.key}: ${item.status}`);
	}
	for (const item of report.optional) {
		console.log(`[bootstrap] optional ${item.key}: ${item.status}`);
	}
	console.log("[bootstrap] next:");
	for (const command of report.nextCommands) {
		console.log(`  - ${command}`);
	}
	console.log(
		JSON.stringify(
			{ ok: report.ready, reportPath: args.report, report },
			null,
			2,
		),
	);

	if (!report.ready) process.exitCode = 2;
	return { ok: report.ready, reportPath: args.report, report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runLocalBootstrap().catch((error) => {
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
