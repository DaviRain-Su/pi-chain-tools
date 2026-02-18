#!/usr/bin/env node
import { execSync } from "node:child_process";
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, "docs", "submission-evidence.md");
const DASHBOARD_LOG_PATH = path.join(
	ROOT,
	"apps",
	"dashboard",
	"data",
	"dashboard-session.log",
);
const CI_SIGNATURES_PATH = path.join(
	ROOT,
	"apps",
	"dashboard",
	"data",
	"ci-signatures.jsonl",
);
const SESSION_DIR = path.join(
	process.env.HOME || "/home/davirain",
	".openclaw",
	"agents",
	"main",
	"sessions",
);

const QUALITY_COMMANDS = ["check", "test", "security:check"];

function safeRead(filePath) {
	try {
		return readFileSync(filePath, "utf8");
	} catch {
		return "";
	}
}

function safeExec(command) {
	try {
		return execSync(command, { cwd: ROOT, encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

function getLatestCommit() {
	const hash = safeExec("git rev-parse HEAD") || "unknown";
	const isoDate =
		safeExec("git log -1 --format=%cI") ||
		safeExec("git log -1 --format=%cd --date=iso-strict") ||
		"unknown";
	const subject = safeExec("git log -1 --format=%s") || "unknown";
	return { hash, isoDate, subject };
}

function listLatestSessionFiles(limit = 30) {
	try {
		const files = readdirSync(SESSION_DIR)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => {
				const filePath = path.join(SESSION_DIR, name);
				return {
					filePath,
					name,
					mtimeMs: statSync(filePath).mtimeMs,
				};
			})
			.sort((a, b) => b.mtimeMs - a.mtimeMs)
			.slice(0, limit);
		return files;
	} catch {
		return [];
	}
}

function parseExecResultsFromSession(filePath) {
	const raw = safeRead(filePath);
	if (!raw) return [];
	const lines = raw.split("\n").filter(Boolean);
	const commandByCallId = new Map();
	const records = [];

	for (const line of lines) {
		let row;
		try {
			row = JSON.parse(line);
		} catch {
			continue;
		}

		if (row?.type !== "message") continue;
		const msg = row.message || {};
		if (!msg) continue;

		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const item of msg.content) {
				if (item?.type !== "toolCall") continue;
				if (item?.name !== "exec") continue;
				const callId = String(item.id || "");
				const command = String(item.arguments?.command || "");
				if (callId && command) commandByCallId.set(callId, command);
			}
			continue;
		}

		if (msg.role === "toolResult" && msg.toolName === "exec") {
			const callId = String(msg.toolCallId || "");
			const command = commandByCallId.get(callId) || "";
			const exitCode =
				typeof msg.details?.exitCode === "number" ? msg.details.exitCode : null;
			records.push({
				callId,
				command,
				exitCode,
				timestamp: row.timestamp || "",
				filePath,
			});
		}
	}
	return records;
}

function classifyCommand(command) {
	for (const name of QUALITY_COMMANDS) {
		if (command.includes(`npm run ${name}`) || command === "npm test") {
			if (name === "test" && command === "npm test") return "test";
			return name;
		}
	}
	return null;
}

function collectQualitySnapshot() {
	const files = listLatestSessionFiles();
	const all = files.flatMap((item) =>
		parseExecResultsFromSession(item.filePath),
	);
	const snapshot = {};
	for (const name of QUALITY_COMMANDS) {
		snapshot[name] = {
			status: "unknown",
			exitCode: null,
			timestamp: null,
			sourceSessionId: null,
		};
	}

	for (const row of all.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))) {
		const kind = classifyCommand(row.command);
		if (!kind) continue;
		if (snapshot[kind].timestamp) continue;
		snapshot[kind] = {
			status:
				typeof row.exitCode === "number"
					? row.exitCode === 0
						? "pass"
						: "fail"
					: "unknown",
			exitCode: row.exitCode,
			timestamp: row.timestamp || null,
			sourceSessionId: path.basename(row.filePath, ".jsonl"),
		};
	}

	if (snapshot.check.status === "unknown") {
		const lines = safeRead(CI_SIGNATURES_PATH).split("\n").filter(Boolean);
		for (let i = lines.length - 1; i >= 0; i -= 1) {
			try {
				const row = JSON.parse(lines[i]);
				if (!row || row.command !== "check") continue;
				snapshot.check = {
					status:
						row.ok === true ? "pass" : row.ok === false ? "fail" : "unknown",
					exitCode:
						typeof row.exitCode === "number"
							? row.exitCode
							: snapshot.check.exitCode,
					timestamp: row.timestamp || snapshot.check.timestamp,
					sourceSessionId:
						String(row.sessionId || "").trim() ||
						snapshot.check.sourceSessionId,
				};
				break;
			} catch {
				// ignore malformed row
			}
		}
	}

	return snapshot;
}

function getDashboardRuntimeStatus() {
	const raw = safeRead(DASHBOARD_LOG_PATH);
	const lines = raw.split("\n").filter(Boolean);
	const lastListenLine = [...lines]
		.reverse()
		.find((line) => line.includes("NEAR dashboard listening on"));
	const hasShutdown = lines.some((line) =>
		line.includes("[dashboard] received SIGTERM"),
	);
	const status =
		lastListenLine && !hasShutdown ? "listening" : "stopped_or_unknown";

	const latestSession = listLatestSessionFiles(1)[0];
	return {
		status,
		lastListenLine: lastListenLine || null,
		openclawSessionId: latestSession
			? path.basename(latestSession.name, ".jsonl")
			: null,
	};
}

function toRow(label, result) {
	const exitCode = result.exitCode === null ? "-" : String(result.exitCode);
	const timestamp = result.timestamp || "-";
	const source = result.sourceSessionId || "-";
	return `| ${label} | ${result.status} | ${exitCode} | ${timestamp} | ${source} |`;
}

function renderEvidence() {
	const commit = getLatestCommit();
	const quality = collectQualitySnapshot();
	const dashboard = getDashboardRuntimeStatus();

	return [
		"# Submission Evidence Artifact",
		"",
		"## 1) Latest Commit",
		"",
		`- Hash: \`${commit.hash}\``,
		`- Commit Date (ISO): ${commit.isoDate}`,
		`- Subject: ${commit.subject}`,
		"",
		"## 2) Quality Snapshot (best-effort)",
		"",
		"| Command | Status | Exit Code | Timestamp | Source Session |",
		"| --- | --- | --- | --- | --- |",
		toRow("npm run check", quality.check),
		toRow("npm run test", quality.test),
		toRow("npm run security:check", quality["security:check"]),
		"",
		"## 3) Key Endpoints / Session References (fill before submit)",
		"",
		"- Demo base URL: `<http://127.0.0.1:4173>`",
		"- ACP status endpoint: `<http://127.0.0.1:4173/api/acp/status>`",
		"- Jobs summary endpoint: `<http://127.0.0.1:4173/api/acp/jobs/summary>`",
		"- OpenClaw session reference: `<session-id-or-link>`",
		"- Video demo link: `<paste-demo-link>`",
		"",
		"## 4) Dashboard Runtime (local)",
		"",
		`- Dashboard status: ${dashboard.status}`,
		`- Dashboard listen line: ${dashboard.lastListenLine || "(not found)"}`,
		`- Latest OpenClaw session id: ${dashboard.openclawSessionId || "(not found)"}`,
		"",
		"## 5) Onchain Tx Proof Template",
		"",
		"- Tx #1: `<hash>`",
		"  - Explorer: `<url>`",
		"  - Intent: `<what this tx proves>`",
		"  - Reconciliation: `<artifact/reconcile summary>`",
		"- Tx #2: `<hash>`",
		"  - Explorer: `<url>`",
		"  - Intent: `<what this tx proves>`",
		"  - Reconciliation: `<artifact/reconcile summary>`",
		"- Tx #3 (optional): `<hash>`",
		"  - Explorer: `<url>`",
		"  - Intent: `<what this tx proves>`",
		"  - Reconciliation: `<artifact/reconcile summary>`",
		"",
		"---",
		"Generated by `npm run submission:evidence` (deterministic, non-destructive).",
		"",
	].join("\n");
}

const output = renderEvidence();
mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, output, "utf8");
console.log(`submission evidence written: ${path.relative(ROOT, OUTPUT_PATH)}`);
