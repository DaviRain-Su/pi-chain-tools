#!/usr/bin/env node
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

const ROOT = process.env.EXECUTE_PROOF_ROOT || process.cwd();
const HOME = process.env.HOME || "/home/davirain";
const SESSION_DIR =
	process.env.EXECUTE_PROOF_SESSION_DIR ||
	path.join(HOME, ".openclaw", "agents", "main", "sessions");
const OUTPUT_BASE_DIR = path.join(ROOT, "docs", "execution-proofs");

function safeRead(filePath) {
	try {
		return readFileSync(filePath, "utf8");
	} catch {
		return "";
	}
}

function parseArgs(argv) {
	const args = {
		protocol: "all",
		date: new Date().toISOString().slice(0, 10),
		maxSessions: 50,
	};
	for (let i = 2; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === "--help") args.help = true;
		else if (token.startsWith("--protocol="))
			args.protocol = token.split("=")[1] || "all";
		else if (token === "--protocol")
			args.protocol = String(argv[i + 1] || "all");
		else if (token.startsWith("--date="))
			args.date = token.split("=")[1] || args.date;
		else if (token === "--date") args.date = String(argv[i + 1] || args.date);
		else if (token.startsWith("--max-sessions="))
			args.maxSessions = Number.parseInt(token.split("=")[1] || "50", 10);
	}
	return args;
}

function listLatestSessionFiles(limit = 50) {
	try {
		return readdirSync(SESSION_DIR)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => {
				const filePath = path.join(SESSION_DIR, name);
				return { filePath, name, mtimeMs: statSync(filePath).mtimeMs };
			})
			.sort((a, b) => b.mtimeMs - a.mtimeMs)
			.slice(0, limit);
	} catch {
		return [];
	}
}

function tryParseJson(text) {
	if (!text) return null;
	const trimmed = text.trim();
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

function collectTxHashes(value, found = new Set()) {
	if (value === null || value === undefined) return found;
	if (typeof value === "string") return found;
	if (Array.isArray(value)) {
		for (const item of value) collectTxHashes(item, found);
		return found;
	}
	if (typeof value === "object") {
		for (const [k, v] of Object.entries(value)) {
			if (/(tx|hash|digest)/i.test(k) && typeof v === "string") {
				const hit = v.match(/(0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]{43,64})/);
				if (hit) found.add(hit[1]);
			}
			collectTxHashes(v, found);
		}
	}
	return found;
}

function inferProtocol(text = "") {
	const s = text.toLowerCase();
	if (s.includes("morpho") || s.includes("monad")) return "morpho";
	if (
		s.includes("bsc") ||
		s.includes("venus") ||
		s.includes("lista") ||
		s.includes("wombat")
	)
		return "bsc";
	if (s.includes("lifi") || s.includes("debridge") || s.includes("crosschain"))
		return "lifi";
	if (s.includes("near")) return "near";
	if (s.includes("sol") || s.includes("raydium") || s.includes("jupiter"))
		return "solana";
	if (s.includes("sui") || s.includes("cetus")) return "sui";
	return "unknown";
}

function findExplorerLink(protocol, txHash) {
	if (!txHash) return "-";
	if (txHash.startsWith("0x")) {
		if (protocol === "morpho")
			return `https://testnet.monadexplorer.com/tx/${txHash}`;
		if (protocol === "bsc") return `https://bscscan.com/tx/${txHash}`;
		return `https://etherscan.io/tx/${txHash}`;
	}
	return `https://nearblocks.io/txns/${txHash}`;
}

function parseSessionProofRows(filePath) {
	const raw = safeRead(filePath);
	if (!raw) return [];
	const lines = raw.split("\n").filter(Boolean);
	const rows = [];
	for (const line of lines) {
		let row;
		try {
			row = JSON.parse(line);
		} catch {
			continue;
		}
		if (row?.type !== "message") continue;
		const msg = row.message || {};
		if (msg.role !== "toolResult") continue;
		const toolName = String(msg.toolName || "");
		const blob = JSON.stringify(msg);
		const parsedText =
			Array.isArray(msg.content) && msg.content.length > 0
				? msg.content.map((c) => c?.text || "").join("\n")
				: "";
		const parsedJson = tryParseJson(parsedText);
		const hashes = [...collectTxHashes(parsedJson || msg)];
		if (hashes.length === 0) continue;
		const classifyBlob = `${toolName}\n${blob}`;
		if (
			!/(execute|workflow|swap|borrow|supply|withdraw|transfer|submit|bridge|rebalance)/i.test(
				classifyBlob,
			)
		)
			continue;
		const protocol = inferProtocol(classifyBlob);
		const boundaryProof =
			parsedJson?.boundaryProof || msg.details?.boundaryProof || null;
		const sdkBinding =
			parsedJson?.sdkBinding || msg.details?.sdkBinding || null;
		const fallback = parsedJson?.fallback || msg.details?.fallback || null;
		const reconcile =
			parsedJson?.executionReconciliation ||
			parsedJson?.postActionReconciliation ||
			msg.details?.executionReconciliation ||
			msg.details?.postActionReconciliation ||
			null;
		for (const txHash of hashes) {
			rows.push({
				txHash,
				protocol,
				toolName,
				timestamp: row.timestamp || "",
				sourceSessionId: path.basename(filePath, ".jsonl"),
				sdkBinding,
				boundaryProof,
				fallback,
				reconcile,
				intentSummary:
					parsedJson?.summaryLine ||
					parsedJson?.summary ||
					parsedJson?.intentType ||
					`${toolName} execute`,
			});
		}
	}
	return rows;
}

function renderProof({ date, protocol, rows }) {
	const titleProtocol = protocol === "all" ? "all" : protocol;
	const lines = [
		"# Execution Proof",
		"",
		`- Date: ${date}`,
		`- Protocol scope: ${titleProtocol}`,
		`- Generated at: ${new Date().toISOString()}`,
		"",
		"## Records",
		"",
	];
	if (rows.length === 0) {
		lines.push("## Missing proof inputs");
		lines.push("");
		lines.push("No executed tx hash was found in recent session artifacts.");
		lines.push("Checked sources:");
		lines.push(`- Session dir: \`${SESSION_DIR}\``);
		lines.push("- Recent toolResult rows with tx/hash markers");
		lines.push("");
		lines.push(
			"Provide at least one execute artifact containing txHash to generate full proof details.",
		);
		return lines.join("\n");
	}
	for (const [idx, row] of rows.entries()) {
		lines.push(`### ${idx + 1}) ${row.protocol.toUpperCase()} · ${row.txHash}`);
		lines.push("");
		lines.push(`- tx hash: \`${row.txHash}\``);
		lines.push(`- explorer: ${findExplorerLink(row.protocol, row.txHash)}`);
		lines.push(`- intent summary: ${String(row.intentSummary || "-")}`);
		lines.push(
			`- sdkBinding: ${row.sdkBinding ? `\`${JSON.stringify(row.sdkBinding)}\`` : "-"}`,
		);
		lines.push(
			`- boundaryProof(confirm/policy/reconcile): ${row.boundaryProof ? `\`${JSON.stringify(row.boundaryProof)}\`` : "-"}`,
		);
		lines.push(
			`- fallback reason: ${row.fallback?.reason || row.fallback?.used === true ? `\`${JSON.stringify(row.fallback)}\`` : "-"}`,
		);
		lines.push(
			`- reconciliation summary: ${row.reconcile ? `\`${JSON.stringify(row.reconcile)}\`` : "-"}`,
		);
		lines.push(`- source session id: ${row.sourceSessionId}`);
		lines.push(`- source tool: ${row.toolName}`);
		lines.push(`- source timestamp: ${row.timestamp || "-"}`);
		lines.push("");
	}
	return lines.join("\n");
}

function writeProof({ date, protocol, markdown }) {
	const dayDir = path.join(OUTPUT_BASE_DIR, date);
	mkdirSync(dayDir, { recursive: true });
	const name = protocol === "all" ? "proof-latest.md" : `proof-${protocol}.md`;
	const outputPath = path.join(dayDir, name);
	writeFileSync(outputPath, markdown, "utf8");
	return outputPath;
}

function buildProof({ protocol = "all", date, maxSessions = 50 }) {
	const files = listLatestSessionFiles(maxSessions);
	const parsed = files.flatMap((f) => parseSessionProofRows(f.filePath));
	const sorted = parsed.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
	const dedup = [];
	const seen = new Set();
	for (const row of sorted) {
		const key = `${row.protocol}:${row.txHash}`;
		if (seen.has(key)) continue;
		seen.add(key);
		dedup.push(row);
	}
	const filtered =
		protocol === "all" ? dedup : dedup.filter((r) => r.protocol === protocol);
	const markdown = renderProof({ date, protocol, rows: filtered.slice(0, 20) });
	const outputPath = writeProof({ date, protocol, markdown });
	return {
		outputPath,
		proofDate: date,
		protocol,
		txCount: filtered.length,
		sessionDir: SESSION_DIR,
	};
}

function main() {
	const args = parseArgs(process.argv);
	if (args.help) {
		console.log(
			"execute-proof\n\nUsage:\n  npm run execute:proof\n  npm run execute:proof -- --protocol=bsc\n\nOptions:\n  --protocol <all|morpho|bsc|lifi|near|solana|sui>\n  --date YYYY-MM-DD\n  --max-sessions <n>\n",
		);
		return;
	}
	const result = buildProof(args);
	console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}

export {
	buildProof,
	parseSessionProofRows,
	renderProof,
	listLatestSessionFiles,
};
