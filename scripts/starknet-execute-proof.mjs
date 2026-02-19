#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.env.EXECUTE_PROOF_ROOT || process.cwd();
const METRICS_PATH = path.join(
	ROOT,
	"apps",
	"dashboard",
	"data",
	"rebalance-metrics.json",
);

function parseArgs(argv) {
	const args = {
		date: new Date().toISOString().slice(0, 10),
		tx: [],
	};
	for (let i = 2; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === "--help") args.help = true;
		else if (token.startsWith("--date="))
			args.date = token.split("=")[1] || args.date;
		else if (token === "--date") args.date = String(argv[++i] || args.date);
		else if (token.startsWith("--tx=")) args.tx.push(token.split("=")[1] || "");
		else if (token === "--tx") args.tx.push(String(argv[++i] || ""));
	}
	args.tx = args.tx.filter(Boolean);
	return args;
}

function safeReadJson(filePath) {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
}

function parseNetworkHint(text) {
	const s = String(text || "").toLowerCase();
	if (s.includes("sepolia")) return "sepolia";
	if (s.includes("mainnet")) return "mainnet";
	return "unknown";
}

function extractTxHashes(text) {
	const matches = String(text || "").match(/0x[a-fA-F0-9]{1,64}/g) || [];
	return [...new Set(matches)];
}

function collectMetricsEntries() {
	const data = safeReadJson(METRICS_PATH);
	const list = Array.isArray(data?.rebalanceMetrics?.recent)
		? data.rebalanceMetrics.recent
		: [];
	return list.filter((item) => {
		const blob =
			`${String(item?.status || "")} ${String(item?.note || "")}`.toLowerCase();
		return blob.includes("starknet");
	});
}

function buildRows(extraTx = []) {
	const rows = [];
	const byTx = new Map();
	for (const tx of extraTx) {
		byTx.set(tx.toLowerCase(), {
			txHash: tx,
			network: "unknown",
			timestamp: new Date().toISOString(),
			source: "cli",
			guardrails: "confirm/maxAmount/dryRun",
		});
	}

	for (const item of collectMetricsEntries()) {
		const note = String(item?.note || "");
		const status = String(item?.status || "");
		const network = parseNetworkHint(`${status} ${note}`);
		const hashes = extractTxHashes(`${status} ${note}`);
		for (const txHash of hashes) {
			const key = txHash.toLowerCase();
			if (byTx.has(key)) continue;
			byTx.set(key, {
				txHash,
				network,
				timestamp: item?.timestamp || "",
				source: "rebalance-metrics.json",
				guardrails: "confirm/maxAmount/dryRun",
			});
		}
	}

	for (const row of byTx.values()) rows.push(row);
	return rows;
}

function toStarkscan(network, txHash) {
	if (network === "sepolia") return `https://sepolia.starkscan.co/tx/${txHash}`;
	if (network === "mainnet") return `https://starkscan.co/tx/${txHash}`;
	return `https://starkscan.co/tx/${txHash}`;
}

function renderMarkdown({ date, rows }) {
	const lines = [
		"# Starknet Execution Proof",
		"",
		`- Timestamp: ${new Date().toISOString()}`,
		`- Date Bucket: ${date}`,
		`- Input source: \`${path.relative(ROOT, METRICS_PATH)}\` + optional --tx flags`,
		"- Guardrails summary: confirm=true required for execute, policy cap via maxAmountUsd, dryRun defaults to true",
		"",
		"## Transactions",
		"",
	];
	if (rows.length === 0) {
		lines.push("No Starknet transactions found in metrics scan.");
		lines.push("Provide one or more tx hashes using `--tx <hash>`.");
		return lines.join("\n");
	}
	for (const [idx, row] of rows.entries()) {
		lines.push(`### ${idx + 1}. ${row.txHash}`);
		lines.push(`- network hint: ${row.network}`);
		lines.push(`- verification: ${toStarkscan(row.network, row.txHash)}`);
		lines.push(`- source: ${row.source}`);
		lines.push(`- timestamp: ${row.timestamp || "-"}`);
		lines.push(`- guardrails: ${row.guardrails}`);
		lines.push("");
	}
	return lines.join("\n");
}

function writeProof(date, markdown) {
	const outDir = path.join(ROOT, "docs", "execution-proofs", date);
	mkdirSync(outDir, { recursive: true });
	const outputPath = path.join(outDir, "proof-starknet.md");
	writeFileSync(outputPath, markdown, "utf8");
	return outputPath;
}

function main() {
	const args = parseArgs(process.argv);
	if (args.help) {
		console.log(
			"starknet-execute-proof\n\nUsage:\n  npm run execute:proof:starknet\n  npm run execute:proof:starknet -- --tx 0xabc... --tx 0xdef...\n\nOptions:\n  --date YYYY-MM-DD\n  --tx <hash> (repeatable)\n",
		);
		return;
	}
	const rows = buildRows(args.tx);
	const markdown = renderMarkdown({ date: args.date, rows });
	const outputPath = writeProof(args.date, markdown);
	console.log(
		JSON.stringify(
			{
				ok: true,
				proofDate: args.date,
				outputPath,
				txCount: rows.length,
			},
			null,
			2,
		),
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}

export { buildRows, renderMarkdown };
