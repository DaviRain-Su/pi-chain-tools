#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const statePath =
	process.env.EVM_SECURITY_WATCH_STATE ||
	path.join(repoRoot, "apps/dashboard/data/security-state.json");
const reportsRoot =
	process.env.EVM_SECURITY_WATCH_REPORTS_ROOT ||
	path.join(repoRoot, "apps/dashboard/data/security-reports");
const ciSignaturesPath =
	process.env.CI_SIGNATURES_JSONL_PATH ||
	path.join(repoRoot, "apps/dashboard/data/ci-signatures.jsonl");

function readJsonSafe(filePath) {
	try {
		if (!existsSync(filePath)) return null;
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
}

function readJsonlSafe(filePath) {
	try {
		if (!existsSync(filePath)) return [];
		return readFileSync(filePath, "utf8")
			.split("\n")
			.map((x) => x.trim())
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line);
				} catch {
					return null;
				}
			})
			.filter(Boolean);
	} catch {
		return [];
	}
}

function readLatestSecurityReport() {
	try {
		if (!existsSync(reportsRoot)) return null;
		const dirs = readdirSync(reportsRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort((a, b) => b.localeCompare(a));
		for (const day of dirs) {
			const candidate = path.join(reportsRoot, day, "latest.json");
			const parsed = readJsonSafe(candidate);
			if (parsed) return { path: candidate, report: parsed };
		}
		return null;
	} catch {
		return null;
	}
}

function parseTs(ts) {
	if (!ts) return null;
	const ms = Date.parse(String(ts));
	return Number.isFinite(ms) ? ms : null;
}

const latestSecurity = readLatestSecurityReport();
const securityState = readJsonSafe(statePath);
const signatures = readJsonlSafe(ciSignaturesPath);

const securitySummary = latestSecurity?.report?.summary || {
	critical: 0,
	warn: 0,
	info: 0,
	total: 0,
};
const scannedAt = latestSecurity?.report?.scannedAt || null;
const scannedAtMs = parseTs(scannedAt);
const securityAgeMs = scannedAtMs ? Date.now() - scannedAtMs : null;
const securityHealth = !latestSecurity
	? "missing"
	: securityAgeMs !== null && securityAgeMs > 30 * 60 * 1000
		? "stale"
		: Number(securitySummary.critical || 0) > 0
			? "critical"
			: Number(securitySummary.warn || 0) > 0
				? "warn"
				: "ok";

const checkRows = signatures
	.filter((row) => String(row?.command || "") === "check")
	.sort((a, b) =>
		String(b?.timestamp || "").localeCompare(String(a?.timestamp || "")),
	);
const lastCheck = checkRows[0] || null;
const lastSuccess =
	checkRows.find((row) => Number(row?.exitCode) === 0) || null;
const lastCheckTs = parseTs(lastCheck?.timestamp);
const lastCheckAgeMs = lastCheckTs === null ? null : Date.now() - lastCheckTs;
const checkFreshness =
	lastCheckAgeMs === null
		? "unknown"
		: lastCheckAgeMs > 6 * 60 * 60 * 1000
			? "stale"
			: "fresh";

const posture = {
	ok: true,
	generatedAt: new Date().toISOString(),
	securityWatch: {
		health: securityHealth,
		scannedAt,
		stateUpdatedAt: securityState?.updatedAt || null,
		summary: securitySummary,
		reportPath: latestSecurity?.path || null,
		statePath,
	},
	checkStatus: {
		freshness: checkFreshness,
		lastCheck: lastCheck
			? {
					timestamp: lastCheck.timestamp || null,
					exitCode: Number(lastCheck.exitCode),
					checkFailureKind: lastCheck.checkFailureKind || null,
				}
			: null,
		lastSuccessfulCheck: lastSuccess
			? {
					timestamp: lastSuccess.timestamp || null,
					exitCode: Number(lastSuccess.exitCode),
				}
			: null,
		signaturesPath: ciSignaturesPath,
	},
	degraded: {
		security: securityHealth === "missing" || securityHealth === "stale",
		checks: checkFreshness !== "fresh",
	},
};

console.log(JSON.stringify(posture, null, 2));
