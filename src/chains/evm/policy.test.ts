import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const POLICY_PATH_ENV = "EVM_TRANSFER_POLICY_PATH";
const POLICY_STATE_SYMBOL = Symbol.for(
	"pi-chain-tools/evm-transfer-policy/state",
);
const POLICY_AUDIT_SYMBOL = Symbol.for(
	"pi-chain-tools/evm-transfer-policy/audit",
);

function createTempPolicyPath(): string {
	const tempDir = mkdtempSync(
		path.join(os.tmpdir(), "pi-chain-tools-evm-policy-"),
	);
	return path.join(tempDir, "evm-transfer-policy.json");
}

function clearInMemoryPolicyState(): void {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	delete globalState[POLICY_STATE_SYMBOL];
	delete globalState[POLICY_AUDIT_SYMBOL];
}

async function loadPolicyModule() {
	await vi.resetModules();
	return await import("./policy.js");
}

describe("evm transfer policy persistence", () => {
	beforeEach(() => {
		process.env[POLICY_PATH_ENV] = undefined;
		clearInMemoryPolicyState();
	});

	it("writes and reloads policy from disk", async () => {
		const policyPath = createTempPolicyPath();
		process.env[POLICY_PATH_ENV] = policyPath;

		const firstLoad = await loadPolicyModule();
		await firstLoad.setEvmTransferPolicy({
			mode: "allowlist",
			enforceOn: "all",
			allowedRecipients: [
				"0x000000000000000000000000000000000000beef",
				"0x000000000000000000000000000000000000bEEF",
			],
			updatedBy: "policy.test",
			note: "persist check",
		});

		const saved = JSON.parse(readFileSync(policyPath, "utf8").trim());
		expect(saved.schema).toBe("evm.transfer.policy.store.v1");
		expect(saved.policy.mode).toBe("allowlist");
		expect(saved.policy.allowedRecipients).toEqual([
			"0x000000000000000000000000000000000000beef",
		]);
		expect(saved.policy.version).toBeGreaterThan(1);

		const secondLoad = await loadPolicyModule();
		const reloaded = secondLoad.getEvmTransferPolicy();
		expect(reloaded.mode).toBe("allowlist");
		expect(reloaded.enforceOn).toBe("all");
		expect(reloaded.allowedRecipients).toEqual([
			"0x000000000000000000000000000000000000beef",
		]);
		expect(reloaded.updatedBy).toBe("policy.test");
	});

	it("loads legacy policy payloads without store wrapper", async () => {
		const policyPath = createTempPolicyPath();
		process.env[POLICY_PATH_ENV] = policyPath;

		const legacyPolicy = {
			schema: "evm.transfer.policy.v1",
			version: 7,
			updatedAt: "2026-01-01T00:00:00.000Z",
			updatedBy: "legacy",
			note: null,
			mode: "allowlist",
			enforceOn: "all",
			allowedRecipients: [
				"0x000000000000000000000000000000000000cafe",
				"0x000000000000000000000000000000000000Cafe",
			],
		};
		writeFileSync(policyPath, JSON.stringify(legacyPolicy), "utf8");

		const loaded = await loadPolicyModule();
		const reloaded = loaded.getEvmTransferPolicy();
		expect(reloaded.version).toBe(7);
		expect(reloaded.mode).toBe("allowlist");
		expect(reloaded.allowedRecipients).toEqual([
			"0x000000000000000000000000000000000000cafe",
		]);

		await loaded.setEvmTransferPolicy({ note: "migrated" });
		const reloadedAfterWrite = JSON.parse(
			readFileSync(policyPath, "utf8").trim(),
		);
		expect(reloadedAfterWrite.schema).toBe("evm.transfer.policy.store.v1");
		expect(reloadedAfterWrite.policy.allowedRecipients).toEqual([
			"0x000000000000000000000000000000000000cafe",
		]);
		expect(reloadedAfterWrite.policy.note).toBe("migrated");
	});

	it("keeps policy and audit operations in sync", async () => {
		const policyPath = createTempPolicyPath();
		process.env[POLICY_PATH_ENV] = policyPath;
		const firstLoad = await loadPolicyModule();

		const result = await firstLoad.setEvmTransferPolicy({
			mode: "allowlist",
			allowedRecipients: ["0x000000000000000000000000000000000000dEaD"],
			note: "audit-sync",
		});
		expect(result.allowedRecipients).toEqual([
			"0x000000000000000000000000000000000000dead",
		]);

		const log = firstLoad.getEvmTransferPolicyAuditLog({ limit: 5 });
		expect(log).toHaveLength(1);
		expect(log[0]?.action).toBe("set_policy");

		clearInMemoryPolicyState();

		const secondLoad = await loadPolicyModule();
		const reloadedLog = secondLoad.getEvmTransferPolicyAuditLog({ limit: 5 });
		expect(reloadedLog).toHaveLength(1);
		expect(reloadedLog[0]?.action).toBe("set_policy");
		expect(reloadedLog[0]?.template).toBeNull();
		expect(reloadedLog[0]?.after.version).toBe(result.version);
		expect(reloadedLog[0]?.after.allowedRecipients).toEqual([
			"0x000000000000000000000000000000000000dead",
		]);
	});

	it("falls back to default policy when persisted file is malformed", async () => {
		const policyPath = createTempPolicyPath();
		process.env[POLICY_PATH_ENV] = policyPath;
		writeFileSync(policyPath, "not-json", "utf8");

		const loaded = await loadPolicyModule();
		const policy = loaded.getEvmTransferPolicy();
		expect(policy.mode).toBe("open");
		expect(policy.version).toBe(1);
		expect(policy.allowedRecipients).toEqual([]);
	});
});
