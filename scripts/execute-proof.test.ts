import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts", "execute-proof.mjs");

describe("execute-proof script", () => {
	it("writes proof markdown with tx rows when execute artifacts exist", () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "execute-proof-"));
		const sessionDir = path.join(root, "sessions");
		mkdirSync(sessionDir, { recursive: true });

		writeFileSync(
			path.join(sessionDir, "abc.jsonl"),
			JSON.stringify({
				type: "message",
				timestamp: "2026-02-19T10:00:00.000Z",
				message: {
					role: "toolResult",
					toolName: "exec",
					content: [
						{
							type: "text",
							text: JSON.stringify({
								txHash:
									"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
								summaryLine: "bsc execute success",
								boundaryProof: { confirm: true, policy: true, reconcile: true },
								sdkBinding: {
									scope: "bsc.venus.execute",
									mode: "canonical-client",
								},
								executionReconciliation: { reconcileOk: true },
							}),
						},
					],
				},
			}),
			"utf8",
		);

		const result = spawnSync(
			process.execPath,
			[scriptPath, "--date=2026-02-19"],
			{
				encoding: "utf8",
				env: {
					...process.env,
					EXECUTE_PROOF_ROOT: root,
					EXECUTE_PROOF_SESSION_DIR: sessionDir,
				},
			},
		);
		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.txCount).toBe(1);
		const out = readFileSync(payload.outputPath, "utf8");
		expect(out).toContain(
			"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		);
		expect(out).toContain("boundaryProof(confirm/policy/reconcile)");
	});

	it("writes missing proof inputs when tx artifacts are absent", () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "execute-proof-"));
		const sessionDir = path.join(root, "sessions");
		mkdirSync(sessionDir, { recursive: true });
		writeFileSync(
			path.join(sessionDir, "empty.jsonl"),
			JSON.stringify({
				type: "message",
				timestamp: "2026-02-19T10:00:00.000Z",
				message: {
					role: "toolResult",
					toolName: "exec",
					content: [{ type: "text", text: "ok" }],
				},
			}),
			"utf8",
		);
		const result = spawnSync(
			process.execPath,
			[scriptPath, "--date=2026-02-19", "--protocol=bsc"],
			{
				encoding: "utf8",
				env: {
					...process.env,
					EXECUTE_PROOF_ROOT: root,
					EXECUTE_PROOF_SESSION_DIR: sessionDir,
				},
			},
		);
		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.txCount).toBe(0);
		const out = readFileSync(payload.outputPath, "utf8");
		expect(out).toContain("## Missing proof inputs");
	});
});
