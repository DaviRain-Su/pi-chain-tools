#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const OUT_FILE = "docs/sdk-upgrade-readiness.md";

async function readJson(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return null;
	}
}

function hasAny(obj, keys = []) {
	const src = obj && typeof obj === "object" ? obj : {};
	return keys.some((key) => typeof src[key] === "function");
}

async function checkPackage(pkg, expectedExecuteFns = []) {
	try {
		const mod = await import(pkg);
		const keys = Object.keys(mod || {});
		return {
			package: pkg,
			installed: true,
			exportCount: keys.length,
			hasExecuteSurface: hasAny(mod, expectedExecuteFns),
			executeCandidates: expectedExecuteFns.filter(
				(name) => typeof mod?.[name] === "function",
			),
			sampleExports: keys.slice(0, 15),
		};
	} catch (error) {
		return {
			package: pkg,
			installed: false,
			error: error instanceof Error ? error.message : String(error),
			hasExecuteSurface: false,
			executeCandidates: [],
			sampleExports: [],
		};
	}
}

function toStatusRow(check) {
	const status = check.installed
		? check.hasExecuteSurface
			? "ready-to-promote"
			: "blocked-no-execute-surface"
		: "blocked-not-installed";
	const action = check.installed
		? check.hasExecuteSurface
			? "Run sdk-coverage promote workflow and replace canonical execute path"
			: "Keep canonical fallback; watch upstream releases for signer/submit APIs"
		: "Install/resolve package first";
	return { ...check, status, action };
}

async function main() {
	const pkg = await readJson("package.json");
	const checks = await Promise.all([
		checkPackage("@venusprotocol/chains", [
			"createClient",
			"submit",
			"execute",
		]),
		checkPackage("@wombat-exchange/configx", [
			"createClient",
			"submit",
			"execute",
		]),
		checkPackage("@morpho-org/blue-sdk", ["submit", "execute", "buildTx"]),
		checkPackage("ethers", ["Wallet"]),
	]);

	const listaCandidates = [];
	for (const candidate of [
		"@lista-dao/sdk",
		"@lista-dao/contracts",
		"@lista-dao/lista-sdk",
	]) {
		// eslint-disable-next-line no-await-in-loop
		listaCandidates.push(
			await checkPackage(candidate, ["submit", "execute", "buildTx"]),
		);
	}
	const listaInstalled = listaCandidates.some((row) => row.installed);
	checks.push({
		package: "lista-candidates",
		installed: listaInstalled,
		hasExecuteSurface: listaCandidates.some((row) => row.hasExecuteSurface),
		executeCandidates: listaCandidates.flatMap((row) => row.executeCandidates),
		sampleExports: [],
		details: listaCandidates,
	});

	const rows = checks.map(toStatusRow);
	const now = new Date().toISOString();
	const markdown = [
		"# SDK Upgrade Readiness",
		"",
		`Generated at: ${now}`,
		"",
		"| Package | Installed | Execute Surface | Status | Next Action |",
		"|---|---:|---:|---|---|",
		...rows.map(
			(row) =>
				`| ${row.package} | ${row.installed ? "yes" : "no"} | ${row.hasExecuteSurface ? "yes" : "no"} | ${row.status} | ${row.action} |`,
		),
		"",
		"## Details",
		"",
		"```json",
		JSON.stringify(
			{
				now,
				dependencies: pkg?.dependencies ? Object.keys(pkg.dependencies) : [],
				checks,
			},
			null,
			2,
		),
		"```",
		"",
		"## Workflow",
		"",
		"1. Run `node scripts/sdk-upgrade-readiness.mjs` after dependency updates.",
		"2. If target protocol status is `ready-to-promote`, run sdk coverage promotion runbook and remove canonical fallback markers.",
		"3. Keep this report committed for release/audit traceability.",
	].join("\n");

	await writeFile(OUT_FILE, markdown, "utf8");
	console.log(`wrote ${OUT_FILE}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
