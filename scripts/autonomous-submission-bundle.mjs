#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

import { applyLegacyBscAutonomousEnvCompat } from "../scripts/hyperliquid-env-compat.mjs";
applyLegacyBscAutonomousEnvCompat(process.env);
const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) ?? process.cwd();
const OUT_DIR = path.join(
	REPO_ROOT,
	"docs",
	"submission-bundles",
	"autonomous-hyperliquid",
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
	const deploymentPath = path.join(
		REPO_ROOT,
		"contracts",
		"hyperliquid-autonomous",
		"deployments",
		"bscTestnet.latest.json",
	);
	const deployment = await readJsonSafe(deploymentPath);
	const generatedAt = new Date().toISOString();

	const bundle = {
		suite: "autonomous-hyperliquid-submission-bundle",
		version: 2,
		generatedAt,
		artifacts: {
			cycleProofPath: cyclePath,
			liveTestPath,
			readinessPath,
			contractDeploymentPath: deploymentPath,
			contractAbiPath:
				"contracts/hyperliquid-autonomous/artifacts/contracts/BscAutonomousStrategy.sol/BscAutonomousStrategy.json",
		},
		summary: {
			cycleMode: cycle?.mode || "missing",
			cycleDecision: cycle?.decision || "missing",
			cycleTxHash: cycle?.txEvidence?.txHash || null,
			cycleReconcileStatus: cycle?.reconcileSummary?.status || "missing",
			liveTestStatus: liveTest?.ok === true ? "ok" : "missing_or_failed",
			coreFundingRoute: cycle?.coreRouteSelection?.selectedFundingRoute || null,
			onchainVerifiableTransition:
				cycle?.cycleTransitionEvidence?.verifiable === true,
		},
		onchainEvidence: {
			txHash: cycle?.txEvidence?.txHash || null,
			emittedEvents: cycle?.txEvidence?.emittedEvents || [],
			stateDelta: cycle?.txEvidence?.stateDelta || null,
			receiptNormalized: cycle?.txEvidence?.receiptNormalized || null,
			transition: cycle?.cycleTransitionEvidence?.transition || null,
			contractAddress:
				deployment?.address ||
				process.env.HYPERLIQUID_AUTONOMOUS_CONTRACT_ADDRESS ||
				null,
			routerAddress:
				deployment?.routerAddress ||
				process.env.HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS ||
				null,
			entryFunction:
				"runDeterministicCycle((bytes32,uint256,uint256,address,address,bytes,bytes32,bool))",
		},
		contractBinding: {
			network: deployment?.network || "bscTestnet",
			chainId: deployment?.chainId || null,
			address: deployment?.address || null,
			abiPath:
				"contracts/hyperliquid-autonomous/artifacts/contracts/BscAutonomousStrategy.sol/BscAutonomousStrategy.json",
			verifyScript: "npm run contracts:hyperliquid:verify:testnet",
		},
		reproducibility: {
			oneCommand: "npm run autonomous:evidence:regen",
			commandSequence: [
				"npm run autonomous:hyperliquid:cycle -- --mode dryrun --run-id submission-proof-001",
				"npm run live:test:preflight",
				"npm run readiness:refresh",
				"npm run autonomous:submission:bundle",
			],
		},
		links: {
			repo: "https://github.com/davirain/pi-chain-tools",
			demoRunbook: "docs/autonomous-hyperliquid-demo.md",
			readiness: "docs/mainnet-readiness-matrix.md",
			architecture: "docs/autonomous-contract-architecture.md",
		},
	};

	const markdown = [
		"# Autonomous Hyperliquid Submission Bundle",
		"",
		`- Generated: ${generatedAt}`,
		`- Cycle mode: ${bundle.summary.cycleMode}`,
		`- Cycle decision: ${bundle.summary.cycleDecision}`,
		`- Tx hash: ${bundle.summary.cycleTxHash || "n/a"}`,
		`- Reconcile: ${bundle.summary.cycleReconcileStatus}`,
		`- Live-test status: ${bundle.summary.liveTestStatus}`,
		`- Core funding route: ${bundle.summary.coreFundingRoute || "n/a"}`,
		`- Verifiable transition: ${bundle.summary.onchainVerifiableTransition ? "yes" : "no"}`,
		"",
		"## Onchain evidence",
		"",
		`- Strategy contract: ${bundle.onchainEvidence.contractAddress || "n/a"}`,
		`- Router contract: ${bundle.onchainEvidence.routerAddress || "n/a"}`,
		`- Entry function: ${bundle.onchainEvidence.entryFunction}`,
		`- Tx hash: ${bundle.onchainEvidence.txHash || "n/a"}`,
		`- Emitted events: ${Array.isArray(bundle.onchainEvidence.emittedEvents) ? bundle.onchainEvidence.emittedEvents.length : 0}`,
		`- State delta: ${bundle.onchainEvidence.stateDelta ? JSON.stringify(bundle.onchainEvidence.stateDelta) : "n/a"}`,
		`- ABI path: ${bundle.contractBinding.abiPath}`,
		"",
		"## Reproducibility",
		"",
		`- One command: \`${bundle.reproducibility.oneCommand}\``,
		...bundle.reproducibility.commandSequence.map((cmd) => `- \`${cmd}\``),
		"",
		"## Key links",
		"",
		`- Repo: ${bundle.links.repo}`,
		`- Demo script: ${bundle.links.demoRunbook}`,
		`- Readiness matrix: ${bundle.links.readiness}`,
		`- Contract architecture: ${bundle.links.architecture}`,
		"",
		"## Included artifacts",
		"",
		`- ${bundle.artifacts.cycleProofPath}`,
		`- ${bundle.artifacts.liveTestPath}`,
		`- ${bundle.artifacts.readinessPath}`,
		`- ${bundle.artifacts.contractDeploymentPath}`,
		`- ${bundle.artifacts.contractAbiPath}`,
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
