#!/usr/bin/env node
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CHAIN_ROOT = path.join(ROOT, "src", "chains");
const SCAFFOLD_ROOT = path.resolve(
	ROOT,
	process.env.FEDERATION_SCAFFOLD_OUTPUT_DIR ||
		"docs/architecture/federation-scaffold",
);

function safeChainDirs() {
	try {
		return readdirSync(CHAIN_ROOT, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

function writeJson(filePath, value) {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeRepoScaffold(repoName, pkgName, description) {
	const repoDir = path.join(SCAFFOLD_ROOT, repoName);
	mkdirSync(repoDir, { recursive: true });
	writeJson(path.join(repoDir, "package.json"), {
		name: pkgName,
		version: "0.1.0",
		private: false,
		type: "module",
		description,
		main: "dist/index.js",
		types: "dist/index.d.ts",
		scripts: {
			build: "tsc -p tsconfig.json",
			typecheck: "tsc --noEmit",
			test: "vitest run",
		},
	});
	writeFileSync(
		path.join(repoDir, "README.md"),
		`# ${repoName}\n\nScaffold generated from pi-chain-tools federation planner.\n\n- Package: \`${pkgName}\`\n- Source migration target: \`${description}\`\n`,
		"utf8",
	);
}

function main() {
	mkdirSync(SCAFFOLD_ROOT, { recursive: true });

	writeRepoScaffold(
		"w3rt-core",
		"@gradience/w3rt-core",
		"Shared interfaces/types/policy contracts extracted from pi-chain-tools",
	);
	writeRepoScaffold(
		"gradience-openclaw-plugin",
		"@gradience/openclaw-plugin",
		"OpenClaw integration/composition layer",
	);
	writeRepoScaffold(
		"gradience-dashboard",
		"@gradience/dashboard",
		"Dashboard runtime + API",
	);

	const chainRepos = [];
	for (const chain of safeChainDirs()) {
		const repoName = `chain-${chain}-tools`;
		const pkgName = `@gradience/chain-${chain}-tools`;
		writeRepoScaffold(
			repoName,
			pkgName,
			`Migration target for src/chains/${chain}`,
		);
		chainRepos.push(repoName);
	}

	const indexPath = path.join(SCAFFOLD_ROOT, "index.json");
	writeJson(indexPath, {
		generatedAt: new Date().toISOString(),
		repositories: [
			"w3rt-core",
			...chainRepos,
			"gradience-openclaw-plugin",
			"gradience-dashboard",
		],
	});

	const size = statSync(indexPath).size;
	console.log(
		`[repo-federation-scaffold] wrote ${path.relative(ROOT, indexPath)} (${size} bytes)`,
	);
}

main();
