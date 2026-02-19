#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_PROVIDER = "noop";
const DEFAULT_CRITICAL_COOLDOWN_SEC = 15 * 60;
const DEFAULT_WARN_AGG_WINDOW_SEC = 15 * 60;
const DEFAULT_QUIET_HOURS = "";
const MAX_PENDING_AGG_ITEMS = 200;

function readJsonFileSafe(filePath, fallback) {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return fallback;
	}
}

function writeJsonFileSafe(filePath, payload) {
	try {
		const tmpPath = `${filePath}.tmp`;
		writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
		renameSync(tmpPath, filePath);
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

function parseNumberEnv(value, fallback) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return fallback;
	return Math.floor(parsed);
}

function parseDailySummaryAt(value) {
	const raw = String(value || "").trim();
	if (!raw) return null;
	const match = raw.match(/^(\d{1,2}):(\d{2})$/);
	if (!match) return null;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
	return hour * 60 + minute;
}

function parseQuietHours(value) {
	const raw = String(value || "").trim();
	if (!raw) return null;
	const match = raw.match(/^(\d{1,2})-(\d{1,2})$/);
	if (!match) return null;
	const startHour = Number(match[1]);
	const endHour = Number(match[2]);
	if (
		!Number.isInteger(startHour) ||
		!Number.isInteger(endHour) ||
		startHour < 0 ||
		startHour > 23 ||
		endHour < 0 ||
		endHour > 23
	) {
		return null;
	}
	if (startHour === endHour) {
		return { startHour, endHour, fullDay: true };
	}
	return { startHour, endHour, fullDay: false };
}

function isInQuietHours(date, quietWindow) {
	if (!quietWindow) return false;
	if (quietWindow.fullDay) return true;
	const hour = date.getHours();
	const { startHour, endHour } = quietWindow;
	if (startHour < endHour) {
		return hour >= startHour && hour < endHour;
	}
	return hour >= startHour || hour < endHour;
}

function localDateKey(date) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function localMinutes(date) {
	return date.getHours() * 60 + date.getMinutes();
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

function buildFindingMessage(finding, { urgent = false } = {}) {
	const sev = String(finding?.severity || "info").toLowerCase();
	const contractLabel =
		finding?.contract?.label || finding?.contract?.address || "contract";
	const chain = finding?.chainName || `chain:${finding?.chainId || "?"}`;
	const link =
		finding?.evidence?.txLink || finding?.evidence?.addressLink || "";
	const lines = [
		`${severityEmoji(sev)} *EVM Security Watch*${urgent ? " [URGENT]" : ""}`,
		`Severity: *${sev.toUpperCase()}*`,
		`Chain: ${chain}`,
		`Contract: ${contractLabel}`,
		`Finding: ${finding?.kind || "unknown"}`,
		`${finding?.message || ""}`,
	];
	if (link) lines.push(`Evidence: ${link}`);
	return lines.filter(Boolean).join("\n");
}

function buildAggregateSummaryMessage(report, entries, reason = "window") {
	const summary = report?.summary || {};
	const warnCount = entries.filter((item) => item.severity === "warn").length;
	const infoCount = entries.filter((item) => item.severity === "info").length;
	const top = entries.slice(0, 8).map((row) => {
		const contractLabel =
			row?.contract?.label || row?.contract?.address || "contract";
		return `• [${String(row?.severity || "info").toUpperCase()}] ${contractLabel} · ${row?.kind || "finding"}`;
	});
	return [
		`🧾 *EVM Security Watch summary* (${reason})`,
		`scan: ${report?.scannedAt || nowIso()}`,
		`this scan: critical=${summary.critical || 0} warn=${summary.warn || 0} info=${summary.info || 0}`,
		`aggregated: warn=${warnCount} info=${infoCount} total=${entries.length}`,
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

function decideAggregateDispatch({
	now,
	quietWindow,
	dailySummaryAtMinutes,
	aggWindowSec,
	aggregate,
}) {
	const pending = Array.isArray(aggregate?.pending) ? aggregate.pending : [];
	if (pending.length === 0) {
		return {
			shouldSend: false,
			reason: "no_pending",
			quiet: isInQuietHours(now, quietWindow),
		};
	}
	const quiet = isInQuietHours(now, quietWindow);
	const firstQueuedAtMs = Number(aggregate?.firstQueuedAtMs || 0);
	const windowElapsed =
		firstQueuedAtMs > 0 &&
		now.getTime() - firstQueuedAtMs >= aggWindowSec * 1000;

	const today = localDateKey(now);
	const minuteNow = localMinutes(now);
	const canDaily =
		dailySummaryAtMinutes != null &&
		minuteNow >= dailySummaryAtMinutes &&
		aggregate?.lastDailySummaryDate !== today;

	if (canDaily) {
		return { shouldSend: true, reason: "daily_summary", quiet };
	}
	if (!quiet && windowElapsed) {
		return { shouldSend: true, reason: "window", quiet };
	}
	if (quiet) {
		return { shouldSend: false, reason: "quiet_hours_hold", quiet };
	}
	return { shouldSend: false, reason: "window_not_elapsed", quiet };
}

function mergeAggregatePending(aggregate, findings, nowMs) {
	const pending = Array.isArray(aggregate?.pending)
		? [...aggregate.pending]
		: [];
	for (const finding of findings) {
		pending.push({
			severity: String(finding?.severity || "info").toLowerCase(),
			kind: finding?.kind || "unknown",
			contract: finding?.contract || null,
			chainId: finding?.chainId || null,
			chainName: finding?.chainName || null,
			detectedAt: finding?.detectedAt || nowIso(),
			fingerprint: findingFingerprint(finding),
		});
	}
	const trimmed = pending.slice(-MAX_PENDING_AGG_ITEMS);
	const firstQueuedAtMs =
		trimmed.length > 0 ? Number(aggregate?.firstQueuedAtMs || nowMs) : null;
	return {
		pending: trimmed,
		firstQueuedAtMs,
		lastQueuedAtMs: trimmed.length > 0 ? nowMs : null,
		lastFlushAt: aggregate?.lastFlushAt || null,
		lastFlushReason: aggregate?.lastFlushReason || null,
		lastDailySummaryDate: aggregate?.lastDailySummaryDate || null,
	};
}

async function dispatchSecurityAlerts({ report, statePath }) {
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
	const aggregateState =
		notifyState.aggregate && typeof notifyState.aggregate === "object"
			? notifyState.aggregate
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

	const criticalCooldownSec = parseNumberEnv(
		process.env.EVM_SECURITY_NOTIFY_CRITICAL_COOLDOWN_SEC,
		DEFAULT_CRITICAL_COOLDOWN_SEC,
	);
	const aggWindowSec = parseNumberEnv(
		process.env.EVM_SECURITY_NOTIFY_WARN_AGG_WINDOW_SEC,
		DEFAULT_WARN_AGG_WINDOW_SEC,
	);
	const quietWindow = parseQuietHours(
		process.env.EVM_SECURITY_NOTIFY_QUIET_HOURS || DEFAULT_QUIET_HOURS,
	);
	const dailySummaryAtMinutes = parseDailySummaryAt(
		process.env.EVM_SECURITY_NOTIFY_DAILY_SUMMARY_AT,
	);

	const sent = { critical: 0, warn: 0, info: 0, errors: [] };
	const now = new Date();
	const nowMs = now.getTime();
	const quietActive = isInQuietHours(now, quietWindow);

	for (const finding of criticals) {
		const fingerprint = findingFingerprint(finding);
		const lastAt = Number(criticalSentAt[fingerprint] || 0);
		if (lastAt > 0 && nowMs - lastAt < criticalCooldownSec * 1000) continue;
		try {
			await notifier.send(
				buildFindingMessage(finding, { urgent: quietActive }),
			);
			criticalSentAt[fingerprint] = nowMs;
			sent.critical += 1;
		} catch (error) {
			sent.errors.push(
				`critical:${finding?.kind || "unknown"}:${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	let aggregate = mergeAggregatePending(
		aggregateState,
		[...warnings, ...infos],
		nowMs,
	);
	const decision = decideAggregateDispatch({
		now,
		quietWindow,
		dailySummaryAtMinutes,
		aggWindowSec,
		aggregate,
	});
	if (decision.shouldSend) {
		try {
			await notifier.send(
				buildAggregateSummaryMessage(
					report,
					aggregate.pending,
					decision.reason,
				),
			);
			sent.warn = aggregate.pending.filter(
				(item) => item.severity === "warn",
			).length;
			sent.info = aggregate.pending.filter(
				(item) => item.severity === "info",
			).length;
			aggregate = {
				...aggregate,
				pending: [],
				firstQueuedAtMs: null,
				lastFlushAt: nowIso(),
				lastFlushReason: decision.reason,
				lastDailySummaryDate:
					decision.reason === "daily_summary"
						? localDateKey(now)
						: aggregate.lastDailySummaryDate || null,
			};
		} catch (error) {
			sent.errors.push(
				`aggregate:${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	baseState.notify = {
		...notifyState,
		criticalSentAt,
		aggregate,
		lastDispatchAt: nowIso(),
		lastProvider: notifier.provider,
		lastDispatchResult: sent,
		lastDecision: {
			quietActive,
			decision: decision.reason,
			aggWindowSec,
			criticalCooldownSec,
			quietHours: process.env.EVM_SECURITY_NOTIFY_QUIET_HOURS || "",
			dailySummaryAt: process.env.EVM_SECURITY_NOTIFY_DAILY_SUMMARY_AT || "",
		},
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

export {
	createNotifier,
	decideAggregateDispatch,
	dispatchSecurityAlerts,
	findingFingerprint,
	isInQuietHours,
	parseDailySummaryAt,
	parseQuietHours,
};
