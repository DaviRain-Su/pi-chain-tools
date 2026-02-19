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
			cooldownMs: 60_000,
		});
		expect(result.provider).toBe("noop");
		expect(result.sent.critical).toBe(1);
		const updated = JSON.parse(readFileSync(statePath, "utf8"));
		expect(updated.notify.criticalSentAt).toBeTruthy();
		expect(Object.keys(updated.notify.criticalSentAt).length).toBe(1);
	});
});
