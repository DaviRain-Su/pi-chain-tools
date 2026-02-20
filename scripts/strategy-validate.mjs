#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { validatePlanAgainstCapabilities } from "../apps/dashboard/strategy-compiler.mjs";

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
		"Usage: node scripts/strategy-validate.mjs --spec <path> [options]",
		"",
		"Options:",
		"  --spec <path>           Strategy spec JSON path (required)",
		"  --manifests <dir>       Capability manifests directory (default: docs/schemas/examples)",
		"  --json                  Print JSON result",
		"  --help                  Show this help",
	].join("\n");
}

function asObject(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: null;
}

function validateStructure(spec) {
	const errors = [];
	const s = asObject(spec);
	if (!s) return { ok: false, errors: ["spec must be object"] };

	for (const key of [
		"id",
		"name",
		"version",
		"owner",
		"goal",
		"constraints",
		"triggers",
		"plan",
	]) {
		if (!(key in s)) errors.push(`missing required field: ${key}`);
	}
	if (!Array.isArray(s.plan?.steps) || s.plan.steps.length === 0) {
		errors.push("plan.steps must be a non-empty array");
	}
	return { ok: errors.length === 0, errors };
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
		manifests.push(await loadJson(path.join(dirPath, file)));
	}
	return manifests;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(usage());
		process.exit(0);
	}
	if (!args.spec) {
		console.error("--spec is required");
		console.error(usage());
		process.exit(1);
	}

	const specPath = path.resolve(String(args.spec));
	const manifestsDir = path.resolve(
		String(args.manifests || "docs/schemas/examples"),
	);

	const spec = await loadJson(specPath);
	const manifests = await loadManifests(manifestsDir);
	const structure = validateStructure(spec);
	const compatibility = validatePlanAgainstCapabilities(spec, manifests);

	const ok = structure.ok && compatibility.ok;
	const result = {
		status: ok ? "ok" : "failed",
		structure,
		compatibility,
		manifestsLoaded: manifests.length,
		specId: spec?.id || null,
	};

	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(
			ok
				? `STRATEGY_VALIDATION_OK (${result.specId})`
				: `STRATEGY_VALIDATION_FAILED (${result.specId || "unknown"})`,
		);
		if (!ok) {
			for (const e of [...structure.errors, ...compatibility.errors]) {
				console.error(` - ${e}`);
			}
		}
	}

	if (!ok) process.exit(2);
}

await main();
