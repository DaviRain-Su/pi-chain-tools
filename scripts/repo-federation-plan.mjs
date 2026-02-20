#!/usr/bin/env node
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_PATH = path.resolve(
	ROOT,
	process.env.FEDERATION_PLAN_OUTPUT_PATH ||
		"docs/architecture/repo-federation-plan.json",
);

const CHAIN_ROOT = path.join(ROOT, "src", "chains");

function safeDirs(dir) {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

function countFilesRecursively(dir) {
	let total = 0;
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			const next = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(next);
				continue;
			}
			if (entry.isFile()) total += 1;
		}
	}
	return total;
}

function summarizeChainDomains() {
	const chains = safeDirs(CHAIN_ROOT);
	return chains.map((chainName) => {
		const fullPath = path.join(CHAIN_ROOT, chainName);
		return {
			chain: chainName,
			sourcePath: path.relative(ROOT, fullPath),
			files: countFilesRecursively(fullPath),
			targetRepo: `chain-${chainName}-tools`,
			targetPackage: `@gradience/chain-${chainName}-tools`,
		};
	});
}

function buildPlan() {
	const chainDomains = summarizeChainDomains();
	return {
		generatedAt: new Date().toISOString(),
		strategy: "multi-mono-federation",
		phases: [
			{
				name: "phase-1-core",
				deliverables: ["w3rt-core", "schema-contracts", "policy-types"],
			},
			{
				name: "phase-2-chain-split",
				deliverables: chainDomains.map((item) => item.targetRepo),
			},
			{
				name: "phase-3-strategy-split",
				deliverables: [
					"strategy-near-yield",
					"strategy-hyperliquid-offchain",
					"strategy-evm-security-watch",
				],
			},
			{
				name: "phase-4-composition",
				deliverables: ["gradience-openclaw-plugin", "gradience-dashboard"],
			},
		],
		domains: {
			chains: chainDomains,
			integration: [
				{ repo: "gradience-openclaw-plugin", role: "dynamic tool loader" },
				{ repo: "gradience-dashboard", role: "ops + strategy visibility" },
			],
		},
		notes: [
			"Keep pi-chain-tools as transition monolith until each target repo has passing CI.",
			"Use npm package boundaries first; split git repos second.",
		],
	};
}

const plan = buildPlan();
mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

const outputStat = statSync(OUTPUT_PATH);
console.log(
	`[repo-federation-plan] wrote ${path.relative(ROOT, OUTPUT_PATH)} (${outputStat.size} bytes)`,
);
