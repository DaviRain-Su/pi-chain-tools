#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
	compileStrategySpecV0,
	validatePlanAgainstCapabilities,
} from "../apps/dashboard/strategy-compiler.mjs";

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
		"Usage: node scripts/strategy-compile.mjs [options]",
		"",
		"Options:",
		"  --template <name>        Template name (rebalance-crosschain-v0 | lending-risk-balance-v0 | stable-yield-v1)",
		"  --input <path>           JSON file with compile input payload",
		"  --out <path>             Write compiled strategy spec to file",
		"  --manifests <dir>        Capability manifests directory (default: docs/schemas/examples)",
		"  --json                   Print full result payload",
		"  --help                   Show this help",
		"",
		"Examples:",
		"  npm run strategy:compile -- --template rebalance-crosschain-v0 --json",
		"  npm run strategy:compile -- --input ./payload.json --out ./out/strategy.json",
		"",
	].join("\n");
}

async function loadJson(filePath) {
	const raw = await readFile(filePath, "utf8");
	return JSON.parse(raw);
}

async function loadManifests(dirPath) {
	const names = await readdir(dirPath);
	const files = names.filter(
		(name) => name.startsWith("capability-") && name.endsWith(".json"),
	);
	const manifests = [];
	for (const file of files) {
		const fullPath = path.join(dirPath, file);
		const payload = await loadJson(fullPath);
		manifests.push(payload);
	}
	return manifests;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(usage());
		process.exit(0);
	}

	let payload = {};
	if (args.input) {
		payload = await loadJson(path.resolve(String(args.input)));
	}
	if (args.template) {
		payload.template = String(args.template);
	}

	const compileResult = compileStrategySpecV0(payload);
	if (!compileResult.ok) {
		console.error(
			JSON.stringify(
				{ status: "compile_failed", errors: compileResult.errors },
				null,
				2,
			),
		);
		process.exit(1);
	}

	const manifestsDir = path.resolve(
		String(args.manifests || "docs/schemas/examples"),
	);
	const manifests = await loadManifests(manifestsDir);
	const compatibility = validatePlanAgainstCapabilities(
		compileResult.spec,
		manifests,
	);
	if (!compatibility.ok) {
		console.error(
			JSON.stringify(
				{
					status: "compatibility_failed",
					errors: compatibility.errors,
					strategy: compileResult.spec,
				},
				null,
				2,
			),
		);
		process.exit(2);
	}

	if (args.out) {
		const outputPath = path.resolve(String(args.out));
		await writeFile(
			outputPath,
			`${JSON.stringify(compileResult.spec, null, 2)}\n`,
			"utf8",
		);
	}

	if (args.json) {
		console.log(
			JSON.stringify(
				{
					status: "ok",
					manifestsLoaded: manifests.length,
					strategy: compileResult.spec,
				},
				null,
				2,
			),
		);
		return;
	}

	console.log(JSON.stringify(compileResult.spec, null, 2));
}

await main();
