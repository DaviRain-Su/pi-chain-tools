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

function pushCheck(result, name, pass, passHint, failHint, required = true) {
	result.checks.push({
		name,
		required,
		status: pass ? "PASS" : "WARN",
		detail: pass ? passHint : failHint,
	});
	if (!pass) result.gaps.push({ name, required, action: failHint });
}

export async function validateAutonomousSubmission() {
	const cyclePath = path.join(
		REPO_ROOT,
		"apps",
		"dashboard",
		"data",
		"proofs",
		"autonomous-cycle",
		"latest.json",
	);
	const bundlePath = path.join(
		REPO_ROOT,
		"docs",
		"submission-bundles",
		"autonomous-hyperliquid",
		"bundle.json",
	);
	const demoPath = path.join(
		REPO_ROOT,
		"docs",
		"autonomous-hyperliquid-demo.md",
	);
	const readmePath = path.join(REPO_ROOT, "README.md");

	const cycle = await readJsonSafe(cyclePath);
	const bundle = await readJsonSafe(bundlePath);

	const result = {
		suite: "hyperliquid-offchain-orchestrator-submission-validator",
		version: 1,
		generatedAt: new Date().toISOString(),
		status: "PASS",
		checks: [],
		gaps: [],
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
		"Hyperliquid core route evidence present (offchain orchestrator)",
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
	const txEvidenceRequired = cycle?.mode === "live";
	pushCheck(
		result,
		"onchain execution evidence present (tx hash/events/state delta)",
		txOk,
		"tx hash + decoded events + state delta found",
		"run a live testnet cycle and store latest proof: npm run autonomous:hyperliquid:testnet:evidence",
		txEvidenceRequired,
	);

	const nonManualOk =
		cycle?.cycleTransitionEvidence?.verifiable === true &&
		cycle?.txEvidence?.receiptNormalized?.chain === "bsc";
	pushCheck(
		result,
		"autonomous onchain trigger proof present (optional in declared model)",
		nonManualOk,
		"verifiable transition + normalized onchain receipt found",
		"optional: enable onchain trigger proof and rerun live cycle to populate cycleTransitionEvidence.verifiable=true",
		false,
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

	if (result.gaps.some((gap) => gap.required !== false)) result.status = "WARN";
	console.log(JSON.stringify(result, null, 2));
	return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	validateAutonomousSubmission()
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
