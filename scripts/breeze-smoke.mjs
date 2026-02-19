#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DASHBOARD_BASE_URL = String(
	process.env.DASHBOARD_BASE_URL || "http://127.0.0.1:4173",
)
	.trim()
	.replace(/\/$/, "");
const BREEZE_API_BASE_URL = String(
	process.env.BREEZE_API_BASE_URL || "",
).trim();
const BREEZE_API_KEY = String(process.env.BREEZE_API_KEY || "").trim();
const PI_MCP_PROVIDER = String(process.env.PI_MCP_PROVIDER || "breeze").trim();

const ARTIFACT_DIR = path.join(
	ROOT,
	"apps",
	"dashboard",
	"data",
	"proofs",
	"breeze",
);
const ARTIFACT_LATEST_PATH = path.join(ARTIFACT_DIR, "latest.json");
const today = new Date().toISOString().slice(0, 10);
const MARKDOWN_DIR = path.join(ROOT, "docs", "execution-proofs", today);
const MARKDOWN_PATH = path.join(MARKDOWN_DIR, "proof-breeze-smoke.md");

function nowIso() {
	return new Date().toISOString();
}

async function safeFetchJson(url, init) {
	try {
		const response = await fetch(url, init);
		const payload = await response.json().catch(() => null);
		return {
			ok: response.ok,
			status: response.status,
			payload,
		};
	} catch (error) {
		return {
			ok: false,
			status: 0,
			error: error instanceof Error ? error.message : String(error),
			payload: null,
		};
	}
}

async function run() {
	const startedAt = nowIso();
	const missingEnv = [];
	if (!BREEZE_API_BASE_URL) missingEnv.push("BREEZE_API_BASE_URL");
	if (!BREEZE_API_KEY) missingEnv.push("BREEZE_API_KEY");

	const report = {
		suite: "breeze-smoke",
		startedAt,
		finishedAt: null,
		provider: PI_MCP_PROVIDER || "breeze",
		config: {
			dashboardBaseUrl: DASHBOARD_BASE_URL,
			breezeApiBaseUrl: BREEZE_API_BASE_URL || null,
			breezeApiKeyPresent: Boolean(BREEZE_API_KEY),
		},
		status: "unknown",
		skipped: false,
		reason: null,
		checks: {
			health: null,
			search: null,
			plan: null,
		},
	};

	if (missingEnv.length > 0) {
		report.status = "skipped";
		report.skipped = true;
		report.reason = `missing_env:${missingEnv.join(",")}`;
		report.finishedAt = nowIso();
		await mkdir(ARTIFACT_DIR, { recursive: true });
		await writeFile(
			ARTIFACT_LATEST_PATH,
			`${JSON.stringify(report, null, 2)}\n`,
		);
		console.log(
			JSON.stringify(
				{
					ok: true,
					status: "skipped",
					reason: report.reason,
					artifact: ARTIFACT_LATEST_PATH,
				},
				null,
				2,
			),
		);
		return;
	}

	report.checks.health = await safeFetchJson(
		`${DASHBOARD_BASE_URL}/api/health`,
	);
	report.checks.search = await safeFetchJson(
		`${DASHBOARD_BASE_URL}/api/pi-mcp/run`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				task: "mcp.search",
				providerId: PI_MCP_PROVIDER || "breeze",
				query: "stablecoin yield",
			}),
		},
	);
	report.checks.plan = await safeFetchJson(
		`${DASHBOARD_BASE_URL}/api/pi-mcp/run`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				task: "mcp.plan",
				providerId: PI_MCP_PROVIDER || "breeze",
				params: {
					intent: "stablecoin yield optimization",
					balances: [{ symbol: "USDC", amount: "100" }],
				},
			}),
		},
	);

	const searchOk = Boolean(report.checks.search?.payload?.result?.ok);
	const planOk = Boolean(report.checks.plan?.payload?.result?.ok);
	const healthOk = Boolean(report.checks.health?.ok);
	report.status = healthOk && searchOk && planOk ? "ok" : "degraded";
	report.finishedAt = nowIso();

	await mkdir(ARTIFACT_DIR, { recursive: true });
	await writeFile(ARTIFACT_LATEST_PATH, `${JSON.stringify(report, null, 2)}\n`);

	const md = [
		"# Breeze Smoke Proof",
		"",
		`- Generated at: ${report.finishedAt}`,
		`- Status: ${report.status}`,
		`- Provider: ${report.provider}`,
		`- Dashboard endpoint: ${DASHBOARD_BASE_URL}`,
		"",
		"## Checks",
		"",
		`- health: http=${report.checks.health?.status || 0} ok=${healthOk}`,
		`- search: http=${report.checks.search?.status || 0} ok=${searchOk}`,
		`- plan: http=${report.checks.plan?.status || 0} ok=${planOk}`,
		"",
		"## Notes",
		"",
		"- Smoke runs through dashboard PI-MCP unified adapter route (`/api/pi-mcp/run`).",
		"- Execute path remains blocked; read/plan only.",
	].join("\n");
	await mkdir(MARKDOWN_DIR, { recursive: true });
	await writeFile(MARKDOWN_PATH, `${md}\n`);

	console.log(
		JSON.stringify(
			{
				ok: report.status === "ok",
				status: report.status,
				artifact: ARTIFACT_LATEST_PATH,
				markdown: MARKDOWN_PATH,
			},
			null,
			2,
		),
	);
}

run().catch((error) => {
	console.error(
		"[breeze-smoke] failed",
		error instanceof Error ? error.message : String(error),
	);
	process.exitCode = 1;
});
