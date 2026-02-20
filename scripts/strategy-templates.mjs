#!/usr/bin/env node
import process from "node:process";
import {
	getStrategyTemplateManifest,
	listStrategyTemplateManifests,
	listStrategyTemplates,
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
		"Usage: node scripts/strategy-templates.mjs [--template <name>] [--riskTier <low|medium|high>] [--strategyType <yield|rebalance>] [--status <active|paused|deprecated>] [--json]",
		"",
		"Examples:",
		"  npm run strategy:templates",
		"  npm run strategy:templates -- --json",
		"  npm run strategy:templates -- --template stable-yield-v1 --json",
		"  npm run strategy:templates -- --riskTier low --strategyType yield --json",
	].join("\n");
}

function matchesFilter(manifest, args) {
	if (args.riskTier && String(manifest.riskTier) !== String(args.riskTier))
		return false;
	if (
		args.strategyType &&
		String(manifest.strategyType) !== String(args.strategyType)
	)
		return false;
	if (args.status && String(manifest.status) !== String(args.status))
		return false;
	return true;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
	console.log(usage());
	process.exit(0);
}

if (args.template) {
	const manifest = getStrategyTemplateManifest(String(args.template));
	if (!manifest) {
		console.error(
			JSON.stringify(
				{
					status: "not_found",
					template: args.template,
					supportedTemplates: listStrategyTemplates(),
				},
				null,
				2,
			),
		);
		process.exit(2);
	}
	if (args.json) {
		console.log(JSON.stringify({ status: "ok", manifest }, null, 2));
	} else {
		console.log(JSON.stringify(manifest, null, 2));
	}
	process.exit(0);
}

const manifests = listStrategyTemplateManifests().filter((m) =>
	matchesFilter(m, args),
);
if (args.json) {
	console.log(JSON.stringify({ status: "ok", templates: manifests }, null, 2));
	process.exit(0);
}

for (const m of manifests) {
	console.log(`- ${m.template}@${m.version} [${m.pricingModel}]`);
}
