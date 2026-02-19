#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_PROVIDER = "noop";
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

function readJsonFileSafe(filePath, fallback) {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return fallback;
	}
}

function writeJsonFileSafe(filePath, payload) {
	try {
		writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	} catch {
		// best-effort
	}
}

function normalizeProvider(value) {
	const v = String(value || "")
		.trim()
		.toLowerCase();
	if (v === "telegram") return "telegram";
	return DEFAULT_PROVIDER;
}

function nowIso() {
	return new Date().toISOString();
}

function findingFingerprint(finding) {
	const stable = JSON.stringify({
		severity: finding?.severity || "info",
		chainId: finding?.chainId || null,
		address: finding?.contract?.address || null,
		kind: finding?.kind || null,
		message: finding?.message || null,
		evidence: finding?.evidence || null,
	});
	return createHash("sha256").update(stable).digest("hex");
}

function severityEmoji(severity) {
	if (severity === "critical") return "🚨";
	if (severity === "warn") return "⚠️";
	return "ℹ️";
}

function buildFindingMessage(finding) {
	const sev = String(finding?.severity || "info").toLowerCase();
	const contractLabel =
		finding?.contract?.label || finding?.contract?.address || "contract";
	const chain = finding?.chainName || `chain:${finding?.chainId || "?"}`;
	const link =
		finding?.evidence?.txLink || finding?.evidence?.addressLink || "";
	const lines = [
		`${severityEmoji(sev)} *EVM Security Watch*`,
		`Severity: *${sev.toUpperCase()}*`,
		`Chain: ${chain}`,
		`Contract: ${contractLabel}`,
		`Finding: ${finding?.kind || "unknown"}`,
		`${finding?.message || ""}`,
	];
	if (link) lines.push(`Evidence: ${link}`);
	return lines.filter(Boolean).join("\n");
}

function buildWarnBatchMessage(report, warnings) {
	const summary = report?.summary || {};
	const top = warnings.slice(0, 6).map((row) => {
		const contractLabel =
			row?.contract?.label || row?.contract?.address || "contract";
		return `• ${contractLabel} · ${row?.kind || "warn"}`;
	});
	return [
		"⚠️ *EVM Security Watch warning summary*",
		`scan: ${report?.scannedAt || nowIso()}`,
		`counts: critical=${summary.critical || 0} warn=${summary.warn || 0} info=${summary.info || 0}`,
		...top,
	].join("\n");
}

async function sendTelegramMessage(token, chatId, text) {
	const url = `https://api.telegram.org/bot${token}/sendMessage`;
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
			text,
			parse_mode: "Markdown",
			disable_web_page_preview: true,
		}),
	});
	if (!response.ok) {
		throw new Error(`telegram_http_${response.status}`);
	}
	const payload = await response.json();
	if (!payload?.ok) {
		throw new Error(`telegram_api_${payload?.description || "unknown"}`);
	}
	return payload;
}

function createNotifier() {
	const provider = normalizeProvider(process.env.EVM_SECURITY_NOTIFY_PROVIDER);
	if (provider === "telegram") {
		const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
		const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
		if (!token || !chatId) {
			return {
				provider: "noop",
				reason: "missing_telegram_env",
				send: async () => ({
					ok: false,
					skipped: true,
					reason: "missing_telegram_env",
				}),
			};
		}
		return {
			provider: "telegram",
			reason: "active",
			send: async (text) => {
				await sendTelegramMessage(token, chatId, text);
				return { ok: true };
			},
		};
	}
	return {
		provider: "noop",
		reason: "provider_noop",
		send: async () => ({ ok: true, skipped: true, reason: "provider_noop" }),
	};
}

async function dispatchSecurityAlerts({
	report,
	statePath,
	cooldownMs = DEFAULT_COOLDOWN_MS,
}) {
	const notifier = createNotifier();
	const baseState = readJsonFileSafe(statePath, { contracts: {}, notify: {} });
	const notifyState =
		baseState.notify && typeof baseState.notify === "object"
			? baseState.notify
			: {};
	const criticalSentAt =
		notifyState.criticalSentAt && typeof notifyState.criticalSentAt === "object"
			? notifyState.criticalSentAt
			: {};
	const warnings = Array.isArray(report?.alerts?.warn?.findings)
		? report.alerts.warn.findings
		: Array.isArray(report?.findings)
			? report.findings.filter(
					(f) => String(f?.severity || "").toLowerCase() === "warn",
				)
			: [];
	const criticals = Array.isArray(report?.alerts?.critical?.findings)
		? report.alerts.critical.findings
		: Array.isArray(report?.findings)
			? report.findings.filter(
					(f) => String(f?.severity || "").toLowerCase() === "critical",
				)
			: [];
	const infosEnabled =
		String(process.env.EVM_SECURITY_NOTIFY_INFO || "false").toLowerCase() ===
		"true";
	const infos = infosEnabled
		? Array.isArray(report?.alerts?.info?.findings)
			? report.alerts.info.findings
			: Array.isArray(report?.findings)
				? report.findings.filter(
						(f) => String(f?.severity || "").toLowerCase() === "info",
					)
				: []
		: [];

	const sent = { critical: 0, warn: 0, info: 0, errors: [] };
	const nowMs = Date.now();

	for (const finding of criticals) {
		const fingerprint = findingFingerprint(finding);
		const lastAt = Number(criticalSentAt[fingerprint] || 0);
		if (lastAt > 0 && nowMs - lastAt < cooldownMs) continue;
		try {
			await notifier.send(buildFindingMessage(finding));
			criticalSentAt[fingerprint] = nowMs;
			sent.critical += 1;
		} catch (error) {
			sent.errors.push(
				`critical:${finding?.kind || "unknown"}:${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	if (warnings.length > 0) {
		try {
			await notifier.send(buildWarnBatchMessage(report, warnings));
			sent.warn = 1;
		} catch (error) {
			sent.errors.push(
				`warn_batch:${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	if (infos.length > 0) {
		for (const finding of infos.slice(0, 10)) {
			try {
				await notifier.send(buildFindingMessage(finding));
				sent.info += 1;
			} catch (error) {
				sent.errors.push(
					`info:${finding?.kind || "unknown"}:${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	baseState.notify = {
		...notifyState,
		criticalSentAt,
		lastDispatchAt: nowIso(),
		lastProvider: notifier.provider,
		lastDispatchResult: sent,
	};
	writeJsonFileSafe(statePath, baseState);

	return {
		ok: sent.errors.length === 0,
		provider: notifier.provider,
		reason: notifier.reason,
		sent,
	};
}

async function runCli() {
	const statePath =
		process.env.EVM_SECURITY_WATCH_STATE ||
		"apps/dashboard/data/security-state.json";
	const reportPath =
		process.env.EVM_SECURITY_REPORT_PATH ||
		"apps/dashboard/data/security-reports/latest.json";
	const fakeReport = {
		scannedAt: nowIso(),
		summary: { critical: 1, warn: 1, info: 0, total: 2 },
		findings: [
			{
				severity: "critical",
				chainId: 1,
				chainName: "ethereum",
				contract: {
					label: "ExampleVault",
					address: "0x0000000000000000000000000000000000000001",
				},
				kind: "code_hash_drift",
				message: "Example critical finding",
				evidence: {},
			},
			{
				severity: "warn",
				chainId: 56,
				chainName: "bsc",
				contract: {
					label: "ExampleToken",
					address: "0x0000000000000000000000000000000000000002",
				},
				kind: "pause_flag_changed",
				message: "Example warning finding",
				evidence: {},
			},
		],
	};
	const report = readJsonFileSafe(reportPath, fakeReport);
	const result = await dispatchSecurityAlerts({ report, statePath });
	console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runCli().catch((error) => {
		console.error(
			"[evm-security-notify] failed",
			error instanceof Error ? error.message : String(error),
		);
		process.exitCode = 1;
	});
}

export { createNotifier, dispatchSecurityAlerts, findingFingerprint };
