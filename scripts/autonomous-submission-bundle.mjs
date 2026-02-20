#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) ?? process.cwd();
const OUT_DIR = path.join(
	REPO_ROOT,
	"docs",
	"submission-bundles",
	"autonomous-bsc",
);

async function readJsonSafe(filePath) {
	try {
		const raw = await readFile(filePath, "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export async function buildAutonomousSubmissionBundle() {
	const cyclePath = path.join(
		REPO_ROOT,
		"apps",
		"dashboard",
		"data",
		"proofs",
		"autonomous-cycle",
		"latest.json",
	);
	const liveTestPath = path.join(
		REPO_ROOT,
		"apps",
		"dashboard",
		"data",
		"proofs",
		"live-test",
		"latest.json",
	);
	const readinessPath = path.join(
		REPO_ROOT,
		"docs",
		"mainnet-readiness-matrix.md",
	);
	const cycle = await readJsonSafe(cyclePath);
	const liveTest = await readJsonSafe(liveTestPath);
	const generatedAt = new Date().toISOString();

	const bundle = {
		suite: "autonomous-bsc-submission-bundle",
		version: 1,
		generatedAt,
		artifacts: {
			cycleProofPath: cyclePath,
			liveTestPath,
			readinessPath,
		},
		summary: {
			cycleMode: cycle?.mode || "missing",
			cycleDecision: cycle?.decision || "missing",
			cycleTxHash: cycle?.txEvidence?.txHash || null,
			cycleReconcileStatus: cycle?.reconcileSummary?.status || "missing",
			liveTestStatus: liveTest?.ok === true ? "ok" : "missing_or_failed",
		},
		links: {
			repo: "https://github.com/davirain/pi-chain-tools",
			demoRunbook: "docs/autonomous-bsc-demo.md",
			readiness: "docs/mainnet-readiness-matrix.md",
		},
	};

	const markdown = [
		"# Autonomous BSC Submission Bundle",
		"",
		`- Generated: ${generatedAt}`,
		`- Cycle mode: ${bundle.summary.cycleMode}`,
		`- Cycle decision: ${bundle.summary.cycleDecision}`,
		`- Tx hash: ${bundle.summary.cycleTxHash || "n/a"}`,
		`- Reconcile: ${bundle.summary.cycleReconcileStatus}`,
		`- Live-test status: ${bundle.summary.liveTestStatus}`,
		"",
		"## Key links",
		"",
		`- Repo: ${bundle.links.repo}`,
		`- Demo script: ${bundle.links.demoRunbook}`,
		`- Readiness matrix: ${bundle.links.readiness}`,
		"",
		"## Included artifacts",
		"",
		`- ${bundle.artifacts.cycleProofPath}`,
		`- ${bundle.artifacts.liveTestPath}`,
		`- ${bundle.artifacts.readinessPath}`,
		"",
	].join("\n");

	await mkdir(OUT_DIR, { recursive: true });
	const jsonPath = path.join(OUT_DIR, "bundle.json");
	const mdPath = path.join(OUT_DIR, "bundle.md");
	await writeFile(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`);
	await writeFile(mdPath, `${markdown}\n`);
	return { ok: true, jsonPath, mdPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	buildAutonomousSubmissionBundle()
		.then((result) => {
			console.log(JSON.stringify(result, null, 2));
		})
		.catch((error) => {
			console.error(
				"[autonomous-submission-bundle] failed",
				error instanceof Error ? error.message : String(error),
			);
			process.exitCode = 1;
		});
}
