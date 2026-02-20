#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const OUTPUT_JSON_PATH = path.join(
	REPO_ROOT,
	"apps",
	"dashboard",
	"data",
	"readiness",
	"latest.json",
);
const OUTPUT_MD_PATH = path.join(
	REPO_ROOT,
	"docs",
	"mainnet-readiness-matrix.md",
);
const EXECUTION_PROOFS_ROOT = path.join(REPO_ROOT, "docs", "execution-proofs");
const LIVE_TEST_LATEST_PATH = path.join(
	REPO_ROOT,
	"apps",
	"dashboard",
	"data",
	"proofs",
	"live-test",
	"latest.json",
);
const BREEZE_LATEST_PATH = path.join(
	REPO_ROOT,
	"apps",
	"dashboard",
	"data",
	"proofs",
	"breeze",
	"latest.json",
);
const SECURITY_STATE_PATH = path.join(
	REPO_ROOT,
	"apps",
	"dashboard",
	"data",
	"security-state.json",
);
const SECURITY_REPORTS_ROOT = path.join(
	REPO_ROOT,
	"apps",
	"dashboard",
	"data",
	"security-reports",
);

const MODULE_ORDER = [
	"bsc_execute",
	"starknet_execute",
	"near_flows",
	"mcp_providers_dflow_breeze",
	"security_watch_alerts_dashboard",
	"live_test_runner",
];

function nowIso() {
	return new Date().toISOString();
}

async function readJsonSafe(filePath) {
	try {
		return JSON.parse(await readFile(filePath, "utf8"));
	} catch {
		return null;
	}
}

async function findLatestExecutionProof(protocol) {
	try {
		const dayDirs = (await readdir(EXECUTION_PROOFS_ROOT)).sort((a, b) =>
			b.localeCompare(a),
		);
		for (const day of dayDirs) {
			const filename = `proof-${protocol}.md`;
			const filePath = path.join(EXECUTION_PROOFS_ROOT, day, filename);
			if (!existsSync(filePath)) continue;
			const fileStat = await stat(filePath);
			return {
				path: filePath,
				relativePath: path.relative(REPO_ROOT, filePath),
				updatedAt: new Date(fileStat.mtimeMs).toISOString(),
				day,
			};
		}
	} catch {
		// best-effort
	}
	return null;
}

function ageHours(isoTs) {
	if (!isoTs) return Number.POSITIVE_INFINITY;
	const ms = Date.now() - Date.parse(isoTs);
	if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
	return ms / (1000 * 60 * 60);
}

function buildModule({
	key,
	label,
	status,
	evidence,
	blockers,
	lastValidatedAt,
	nextAction,
}) {
	return {
		key,
		label,
		status,
		evidence,
		blockers,
		lastValidatedAt,
		nextAction,
	};
}

async function buildMatrix() {
	const generatedAt = nowIso();
	const [proofBsc, proofStarknet, liveTest, breezeLatest, securityState] =
		await Promise.all([
			findLatestExecutionProof("bsc"),
			findLatestExecutionProof("starknet"),
			readJsonSafe(LIVE_TEST_LATEST_PATH),
			readJsonSafe(BREEZE_LATEST_PATH),
			readJsonSafe(SECURITY_STATE_PATH),
		]);

	const securityLatest = await readLatestSecurityReport();
	const modules = [];

	{
		const blockers = [];
		const evidence = [];
		let status = "red";
		let lastValidatedAt = null;
		if (proofBsc) {
			evidence.push(`execution proof found: ${proofBsc.relativePath}`);
			lastValidatedAt = proofBsc.updatedAt;
			const h = ageHours(proofBsc.updatedAt);
			if (h <= 24 * 7) {
				status = "green";
			} else {
				status = "yellow";
				blockers.push("BSC proof is older than 7 days");
			}
		} else {
			blockers.push(
				"no BSC execution proof found in docs/execution-proofs/*/proof-bsc.md",
			);
		}
		const livePreflight = liveTest?.phases?.preflight;
		if (livePreflight?.envChecks) {
			const missing = Object.entries(livePreflight.envChecks)
				.filter(([, ok]) => !ok)
				.map(([k]) => k)
				.filter((k) => k === "BSC_EXECUTE_ENABLED" || k === "BSC_RPC_URL");
			if (missing.length > 0) {
				status = status === "green" ? "yellow" : status;
				blockers.push(`preflight missing env: ${missing.join(",")}`);
			}
		}
		modules.push(
			buildModule({
				key: "bsc_execute",
				label: "BSC execute",
				status,
				evidence,
				blockers,
				lastValidatedAt,
				nextAction:
					status === "green"
						? "Run readiness refresh after any execute/config change"
						: "Run npm run execute:proof:bsc and refresh matrix",
			}),
		);
	}

	{
		const blockers = [];
		const evidence = [];
		let status = "red";
		let lastValidatedAt = null;
		if (proofStarknet) {
			evidence.push(`execution proof found: ${proofStarknet.relativePath}`);
			lastValidatedAt = proofStarknet.updatedAt;
			const h = ageHours(proofStarknet.updatedAt);
			if (h <= 24 * 7) {
				status = "green";
			} else {
				status = "yellow";
				blockers.push("Starknet proof is older than 7 days");
			}
		} else {
			blockers.push(
				"no Starknet execution proof found in docs/execution-proofs/*/proof-starknet.md",
			);
		}
		modules.push(
			buildModule({
				key: "starknet_execute",
				label: "Starknet execute",
				status,
				evidence,
				blockers,
				lastValidatedAt,
				nextAction:
					status === "green"
						? "Keep proof cadence <= 7 days"
						: "Run npm run execute:proof:starknet and refresh matrix",
			}),
		);
	}

	{
		const blockers = [];
		const evidence = [];
		let status = "yellow";
		let lastValidatedAt = null;
		if (liveTest?.phases?.preflight?.dashboard?.health?.ok === true) {
			evidence.push(
				"dashboard /api/health reachable in latest live-test preflight",
			);
			lastValidatedAt = liveTest?.finishedAt || null;
		}
		if (existsSync(path.join(REPO_ROOT, "docs", "openclaw-near-setup.md"))) {
			evidence.push("near setup runbook present: docs/openclaw-near-setup.md");
		}
		if (!lastValidatedAt) {
			status = "red";
			blockers.push("no recent NEAR flow validation artifact found");
		} else {
			blockers.push(
				"latest evidence is preflight/readiness only; no recent mutate proof attached",
			);
		}
		modules.push(
			buildModule({
				key: "near_flows",
				label: "NEAR flows",
				status,
				evidence,
				blockers,
				lastValidatedAt,
				nextAction:
					"Run targeted NEAR flow (dryrun/execute-safe) and save proof artifact for green",
			}),
		);
	}

	{
		const blockers = [];
		const evidence = [];
		let status = "yellow";
		let lastValidatedAt = null;
		const hasDflowProvider = existsSync(
			path.join(REPO_ROOT, "src", "mcp", "providers", "dflow.ts"),
		);
		const hasBreezeProvider = existsSync(
			path.join(REPO_ROOT, "src", "mcp", "providers", "breeze.ts"),
		);
		if (hasDflowProvider)
			evidence.push(
				"dflow provider module present: src/mcp/providers/dflow.ts",
			);
		if (hasBreezeProvider)
			evidence.push(
				"breeze provider module present: src/mcp/providers/breeze.ts",
			);
		if (!hasDflowProvider || !hasBreezeProvider) {
			status = "red";
			blockers.push("missing MCP provider implementation file(s)");
		}
		if (breezeLatest) {
			lastValidatedAt =
				breezeLatest.finishedAt || breezeLatest.startedAt || null;
			evidence.push(
				`breeze smoke artifact status=${breezeLatest.status || "unknown"}`,
			);
			if (breezeLatest.status === "ok") {
				if (status !== "red") status = "yellow";
				blockers.push("no dflow smoke/runtime proof artifact found");
			} else if (breezeLatest.status === "skipped") {
				status = "yellow";
				blockers.push(
					`breeze smoke skipped: ${breezeLatest.reason || "unknown"}`,
				);
			} else {
				status = "red";
				blockers.push("breeze smoke check degraded/failed");
			}
		} else {
			status = status === "red" ? "red" : "yellow";
			blockers.push(
				"missing breeze smoke artifact (apps/dashboard/data/proofs/breeze/latest.json)",
			);
		}
		modules.push(
			buildModule({
				key: "mcp_providers_dflow_breeze",
				label: "MCP providers (DFlow/Breeze)",
				status,
				evidence,
				blockers,
				lastValidatedAt,
				nextAction:
					"Run npm run breeze:smoke and add equivalent DFlow smoke proof",
			}),
		);
	}

	{
		const blockers = [];
		const evidence = [];
		let status = "red";
		let lastValidatedAt = null;
		if (securityLatest?.report) {
			const summary = securityLatest.report.summary || {};
			lastValidatedAt =
				securityLatest.report.scannedAt || securityState?.updatedAt || null;
			evidence.push(
				`security report: critical=${summary.critical || 0}, warn=${summary.warn || 0}, info=${summary.info || 0}`,
			);
			const stale = ageHours(lastValidatedAt) > 24;
			if (stale) {
				status = "yellow";
				blockers.push("security report older than 24h");
			} else if (Number(summary.critical || 0) > 0) {
				status = "yellow";
				blockers.push("security critical findings present");
			} else {
				status = "green";
			}
		} else {
			blockers.push("no security watch report found");
		}
		if (
			existsSync(path.join(REPO_ROOT, "docs", "evm-security-watch-cron.md"))
		) {
			evidence.push(
				"security runbook present: docs/evm-security-watch-cron.md",
			);
		}
		modules.push(
			buildModule({
				key: "security_watch_alerts_dashboard",
				label: "Security watch/alerts/dashboard",
				status,
				evidence,
				blockers,
				lastValidatedAt,
				nextAction:
					status === "green"
						? "Keep scanner cadence and monitor findings"
						: "Run npm run security:scan:once and verify dashboard security endpoints",
			}),
		);
	}

	{
		const blockers = [];
		const evidence = [];
		let status = "red";
		let lastValidatedAt = null;
		if (liveTest) {
			lastValidatedAt = liveTest.finishedAt || null;
			evidence.push(
				`live-test artifact mode=${liveTest?.args?.mode || "unknown"} ok=${Boolean(liveTest.ok)}`,
			);
			const preflightOk = liveTest?.phases?.preflight?.ok === true;
			const dryrunOk = liveTest?.phases?.dryrun?.ok === true;
			if (preflightOk && dryrunOk) {
				status = "green";
			} else if (preflightOk) {
				status = "yellow";
				blockers.push(
					"live-test dryrun/execute evidence missing in latest artifact",
				);
			} else {
				status = "red";
				blockers.push("live-test preflight not passing");
			}
		} else {
			blockers.push(
				"missing live-test artifact (apps/dashboard/data/proofs/live-test/latest.json)",
			);
		}
		modules.push(
			buildModule({
				key: "live_test_runner",
				label: "Live test runner",
				status,
				evidence,
				blockers,
				lastValidatedAt,
				nextAction:
					status === "green"
						? "Keep periodic preflight + dryrun cadence"
						: "Run npm run live:test:preflight then npm run live:test:dryrun",
			}),
		);
	}

	const sortedModules = MODULE_ORDER.map((key) =>
		modules.find((row) => row.key === key),
	).filter(Boolean);
	const allBlockers = sortedModules.flatMap((row) =>
		(row.blockers || []).map((message) => `${row.label}: ${message}`),
	);
	const overallStatus = deriveOverallStatus(
		sortedModules.map((row) => row.status),
	);

	return {
		version: 1,
		generatedAt,
		overall: {
			status: overallStatus,
			topBlockers: allBlockers.slice(0, 5),
		},
		modules: sortedModules,
	};
}

function deriveOverallStatus(statuses) {
	if (statuses.includes("red")) return "red";
	if (statuses.includes("yellow")) return "yellow";
	return "green";
}

async function readLatestSecurityReport() {
	try {
		const dayDirs = (await readdir(SECURITY_REPORTS_ROOT)).sort((a, b) =>
			b.localeCompare(a),
		);
		for (const day of dayDirs) {
			const candidate = path.join(SECURITY_REPORTS_ROOT, day, "latest.json");
			const report = await readJsonSafe(candidate);
			if (report) {
				return {
					report,
					path: candidate,
				};
			}
		}
	} catch {
		// best-effort
	}
	return { report: null, path: null };
}

function moduleEmoji(status) {
	if (status === "green") return "🟢";
	if (status === "yellow") return "🟡";
	return "🔴";
}

function toMarkdown(matrix) {
	const lines = [
		"# Mainnet Readiness Matrix",
		"",
		`- Generated at: ${matrix.generatedAt}`,
		`- Overall status: ${moduleEmoji(matrix.overall.status)} ${matrix.overall.status.toUpperCase()}`,
		"",
		"## Summary",
		"",
		"| Module | Status | Last validated | Top blocker | Next action |",
		"| --- | --- | --- | --- | --- |",
	];
	for (const row of matrix.modules) {
		lines.push(
			`| ${row.label} | ${moduleEmoji(row.status)} ${row.status.toUpperCase()} | ${row.lastValidatedAt || "-"} | ${(row.blockers || ["-"])[0] || "-"} | ${row.nextAction || "-"} |`,
		);
	}
	lines.push("", "## Evidence details", "");
	for (const row of matrix.modules) {
		lines.push(`### ${row.label}`, "");
		lines.push(`- Status: ${row.status}`);
		lines.push(`- Last validated: ${row.lastValidatedAt || "-"}`);
		lines.push(`- Next action: ${row.nextAction || "-"}`);
		lines.push("- Evidence:");
		if (row.evidence?.length) {
			for (const item of row.evidence) lines.push(`  - ${item}`);
		} else {
			lines.push("  - (none)");
		}
		lines.push("- Blockers:");
		if (row.blockers?.length) {
			for (const item of row.blockers) lines.push(`  - ${item}`);
		} else {
			lines.push("  - (none)");
		}
		lines.push("");
	}
	return `${lines.join("\n")}\n`;
}

function printSummary(matrix) {
	console.log(`Readiness overall: ${matrix.overall.status.toUpperCase()}`);
	for (const row of matrix.modules) {
		const blocker = (row.blockers || [])[0] || "none";
		console.log(`- ${row.label}: ${row.status} | blocker: ${blocker}`);
	}
}

export async function runReadinessMatrix(args = process.argv.slice(2)) {
	const show = args.includes("--show");
	const matrix = await buildMatrix();
	await mkdir(path.dirname(OUTPUT_JSON_PATH), { recursive: true });
	await writeFile(OUTPUT_JSON_PATH, `${JSON.stringify(matrix, null, 2)}\n`);
	await writeFile(OUTPUT_MD_PATH, toMarkdown(matrix));
	if (show) printSummary(matrix);
	return {
		ok: true,
		overallStatus: matrix.overall.status,
		jsonPath: OUTPUT_JSON_PATH,
		markdownPath: OUTPUT_MD_PATH,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runReadinessMatrix()
		.then((result) => {
			console.log(JSON.stringify(result, null, 2));
		})
		.catch((error) => {
			console.error(
				"[readiness-matrix] failed",
				error instanceof Error ? error.message : String(error),
			);
			process.exitCode = 1;
		});
}
