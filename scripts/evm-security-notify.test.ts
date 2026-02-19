import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const modPromise = import("./evm-security-notify.mjs");

function makeReport() {
	return {
		scannedAt: new Date().toISOString(),
		summary: { critical: 1, warn: 1, info: 0, total: 2 },
		alerts: {
			critical: {
				findings: [
					{
						severity: "critical",
						chainId: 1,
						chainName: "ethereum",
						contract: {
							label: "Vault",
							address: "0x0000000000000000000000000000000000000001",
						},
						kind: "owner_drift",
						message: "owner changed",
						evidence: {},
					},
				],
			},
			warn: {
				findings: [
					{
						severity: "warn",
						chainId: 56,
						chainName: "bsc",
						contract: {
							label: "Token",
							address: "0x0000000000000000000000000000000000000002",
						},
						kind: "pause_flag_changed",
						message: "paused true",
						evidence: {},
					},
				],
			},
			info: { findings: [] },
		},
	};
}

afterEach(() => {
	process.env.EVM_SECURITY_NOTIFY_PROVIDER = undefined;
	process.env.TELEGRAM_BOT_TOKEN = undefined;
	process.env.TELEGRAM_CHAT_ID = undefined;
	process.env.EVM_SECURITY_NOTIFY_QUIET_HOURS = undefined;
	process.env.EVM_SECURITY_NOTIFY_WARN_AGG_WINDOW_SEC = undefined;
	process.env.EVM_SECURITY_NOTIFY_CRITICAL_COOLDOWN_SEC = undefined;
	process.env.EVM_SECURITY_NOTIFY_DAILY_SUMMARY_AT = undefined;
	vi.restoreAllMocks();
});

describe("evm-security-notify", () => {
	it("falls back to noop by default", async () => {
		const mod = await modPromise;
		const notifier = mod.createNotifier();
		expect(notifier.provider).toBe("noop");
	});

	it("persists critical dedupe timestamps after dispatch", async () => {
		const mod = await modPromise;
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "sec-notify-"));
		const statePath = path.join(tempDir, "security-state.json");
		writeFileSync(
			statePath,
			JSON.stringify({ contracts: {}, notify: {} }),
			"utf8",
		);
		const report = makeReport();
		const result = await mod.dispatchSecurityAlerts({
			report,
			statePath,
		});
		expect(result.provider).toBe("noop");
		expect(result.sent.critical).toBe(1);
		const updated = JSON.parse(readFileSync(statePath, "utf8"));
		expect(updated.notify.criticalSentAt).toBeTruthy();
		expect(Object.keys(updated.notify.criticalSentAt).length).toBe(1);
	});

	it("parses quiet hours and checks local-hour inclusion", async () => {
		const mod = await modPromise;
		const quiet = mod.parseQuietHours("23-08");
		expect(quiet).toEqual({ startHour: 23, endHour: 8, fullDay: false });
		expect(mod.isInQuietHours(new Date("2026-02-20T23:30:00"), quiet)).toBe(
			true,
		);
		expect(mod.isInQuietHours(new Date("2026-02-20T07:59:00"), quiet)).toBe(
			true,
		);
		expect(mod.isInQuietHours(new Date("2026-02-20T08:01:00"), quiet)).toBe(
			false,
		);
	});

	it("holds aggregated warn/info during quiet hours", async () => {
		const mod = await modPromise;
		const decision = mod.decideAggregateDispatch({
			now: new Date("2026-02-20T23:30:00"),
			quietWindow: mod.parseQuietHours("23-08"),
			dailySummaryAtMinutes: null,
			aggWindowSec: 60,
			aggregate: {
				pending: [{ severity: "warn", kind: "pause_flag_changed" }],
				firstQueuedAtMs: new Date("2026-02-20T22:00:00").getTime(),
			},
		});
		expect(decision.shouldSend).toBe(false);
		expect(decision.reason).toBe("quiet_hours_hold");
	});

	it("flushes aggregated warn/info after window outside quiet hours", async () => {
		const mod = await modPromise;
		const decision = mod.decideAggregateDispatch({
			now: new Date("2026-02-20T14:30:00"),
			quietWindow: mod.parseQuietHours("23-08"),
			dailySummaryAtMinutes: null,
			aggWindowSec: 60,
			aggregate: {
				pending: [{ severity: "warn", kind: "pause_flag_changed" }],
				firstQueuedAtMs: new Date("2026-02-20T14:00:00").getTime(),
			},
		});
		expect(decision.shouldSend).toBe(true);
		expect(decision.reason).toBe("window");
	});
});
