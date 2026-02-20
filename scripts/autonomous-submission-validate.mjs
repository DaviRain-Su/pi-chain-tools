#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

import { applyLegacyBscAutonomousEnvCompat } from "../scripts/hyperliquid-env-compat.mjs";
applyLegacyBscAutonomousEnvCompat(process.env);
const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) ?? process.cwd();

async function readJsonSafe(filePath) {
	try {
		return JSON.parse(await readFile(filePath, "utf8"));
	} catch {
		return null;
	}
}

function parseArgs(argv = process.argv.slice(2)) {
	const out = { mode: "offchain" };
	for (let i = 0; i < argv.length; i += 1) {
		const token = String(argv[i] || "");
		if (token !== "--mode") continue;
		const value = String(argv[i + 1] || "")
			.trim()
			.toLowerCase();
		if (!value) throw new Error("missing value for --mode");
		if (value !== "offchain" && value !== "onchain") {
			throw new Error("--mode must be offchain or onchain");
		}
		out.mode = value;
		i += 1;
	}
	return out;
}

function pushCheck(result, name, pass, passHint, failHint, required = true) {
	result.checks.push({
		name,
		required,
		status: pass ? "PASS" : "WARN",
		detail: pass ? passHint : failHint,
	});
	if (!pass) result.gaps.push({ name, required, action: failHint });
}

function finalizeResult(result) {
	const requiredChecks = result.checks.filter(
		(item) => item.required !== false,
	);
	const passedRequired = requiredChecks.filter(
		(item) => item.status === "PASS",
	);
	result.score = {
		requiredPassed: passedRequired.length,
		requiredTotal: requiredChecks.length,
		percent:
			requiredChecks.length === 0
				? 100
				: Math.round((passedRequired.length / requiredChecks.length) * 100),
	};
	if (result.gaps.some((gap) => gap.required !== false)) result.status = "WARN";
}

export async function validateAutonomousSubmission(options = {}) {
	const mode = options.mode === "onchain" ? "onchain" : "offchain";
	const cyclePath =
		options.cyclePath ||
		path.join(
			REPO_ROOT,
			"apps",
			"dashboard",
			"data",
			"proofs",
			"autonomous-cycle",
			"latest.json",
		);
	const bundlePath =
		options.bundlePath ||
		path.join(
			REPO_ROOT,
			"docs",
			"submission-bundles",
			"autonomous-hyperliquid",
			"bundle.json",
		);
	const demoPath =
		options.demoPath ||
		path.join(REPO_ROOT, "docs", "autonomous-hyperliquid-demo.md");
	const readmePath = options.readmePath || path.join(REPO_ROOT, "README.md");

	const cycle = await readJsonSafe(cyclePath);
	const bundle = await readJsonSafe(bundlePath);

	const result = {
		suite: "hyperliquid-offchain-orchestrator-submission-validator",
		version: 2,
		generatedAt: new Date().toISOString(),
		mode,
		status: "PASS",
		checks: [],
		gaps: [],
		score: {
			requiredPassed: 0,
			requiredTotal: 0,
			percent: 0,
		},
		criteria:
			mode === "offchain"
				? "offchain: route evidence + docs + live tx evidence required only when cycle mode is live"
				: "onchain: route evidence + tx hash/events/state delta + verifiable transition are all required",
	};

	const routeOk =
		cycle?.coreRouteSelection?.selectedFundingRoute ===
			"hyperliquid_earn_core" &&
		Array.isArray(cycle?.coreRouteSelection?.evidenceMarkers) &&
		cycle.coreRouteSelection.evidenceMarkers.includes(
			"ROUTE_CORE_HYPERLIQUID_EARN",
		);
	pushCheck(
		result,
		"Hyperliquid core route evidence present",
		routeOk,
		"cycle proof marks core route hyperliquid_earn_core",
		`run: npm run autonomous:hyperliquid:cycle -- --mode dryrun --run-id validator-refresh and verify ${cyclePath}`,
	);

	const txOk =
		typeof cycle?.txEvidence?.txHash === "string" &&
		cycle.txEvidence.txHash.startsWith("0x") &&
		Array.isArray(cycle?.txEvidence?.emittedEvents) &&
		cycle.txEvidence.emittedEvents.length > 0 &&
		cycle?.txEvidence?.stateDelta;
	const txEvidenceRequired = mode === "onchain" || cycle?.mode === "live";
	pushCheck(
		result,
		"onchain execution evidence present (tx hash/events/state delta)",
		txOk,
		"tx hash + decoded events + state delta found",
		"run a live testnet cycle and store latest proof: npm run autonomous:hyperliquid:testnet:evidence",
		txEvidenceRequired,
	);

	const receiptChain = cycle?.txEvidence?.receiptNormalized?.chain;
	const transitionOk =
		cycle?.cycleTransitionEvidence?.verifiable === true &&
		(receiptChain === "hyperliquid" ||
			receiptChain === "offchain-orchestrator");
	pushCheck(
		result,
		"autonomous trigger transition is verifiable",
		transitionOk,
		"verifiable transition + normalized receipt found",
		"rerun cycle with verifiable transition evidence enabled and confirm receiptNormalized.chain",
		mode === "onchain",
	);

	const docsOk =
		existsSync(demoPath) &&
		existsSync(readmePath) &&
		typeof bundle?.links?.repo === "string" &&
		bundle.links.repo.includes("github.com");
	pushCheck(
		result,
		"demo + README + repo evidence present",
		docsOk,
		"demo doc + README + repo link verified",
		`ensure files exist (${demoPath}, ${readmePath}) and regenerate bundle: npm run autonomous:submission:bundle`,
	);

	finalizeResult(result);
	console.log(JSON.stringify(result, null, 2));
	return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = parseArgs();
	validateAutonomousSubmission({ mode: args.mode })
		.then((res) => {
			if (res.status !== "PASS") process.exitCode = 1;
		})
		.catch((error) => {
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
