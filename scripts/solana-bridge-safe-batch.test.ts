import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts", "solana-bridge-safe-batch.mjs");
const heartbeatPath = path.resolve("scripts", "solana-bridge-heartbeat.mjs");

function runScript(inputPayload: unknown, mode?: "safe" | "research") {
	const dir = mkdtempSync(path.join(tmpdir(), "solana-bridge-batch-"));
	const inputPath = path.join(dir, "tasks.json");
	writeFileSync(inputPath, JSON.stringify(inputPayload, null, 2));
	const args = [scriptPath, "--input", inputPath];
	if (mode) args.push("--mode", mode);
	const result = spawnSync(process.execPath, args, { encoding: "utf8" });
	rmSync(dir, { recursive: true, force: true });
	return result;
}

describe("solana bridge safe batch wrapper", () => {
	it("filters mutating and execute intents in safe mode", () => {
		const result = runScript({
			tasks: [
				{
					taskId: "read:solana_getPortfolio",
					kind: "read",
					metadata: { operationKind: "read" },
				},
				{
					taskId: "plan:solana_buildSolTransferTransaction",
					kind: "task_discovery",
					metadata: { operationKind: "plan" },
				},
			],
		});
		expect(result.status).toBe(0);
		const payload = JSON.parse(String(result.stdout));
		expect(payload.mode).toBe("safe");
		expect(payload.totalTasks).toBe(2);
		expect(payload.accepted).toBe(1);
		expect(payload.rejected).toBe(1);
		expect(payload.results[1].reason).toContain("confirm/policy/reconcile");
	});

	it("research mode remains non-executing", () => {
		const result = runScript(
			[
				{
					taskId: "execute:solana_transferSol",
					kind: "task_discovery",
					metadata: { operationKind: "execute" },
				},
			],
			"research",
		);
		expect(result.status).toBe(0);
		const payload = JSON.parse(String(result.stdout));
		expect(payload.mode).toBe("research");
		expect(payload.accepted).toBe(0);
		expect(payload.rejected).toBe(1);
	});

	it("heartbeat wrapper enforces safe mode", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "solana-bridge-heartbeat-"));
		const inputPath = path.join(dir, "tasks.json");
		writeFileSync(
			inputPath,
			JSON.stringify({
				tasks: [
					{
						taskId: "read:solana_getBalance",
						kind: "read",
						metadata: { operationKind: "read" },
					},
				],
			}),
		);
		const result = spawnSync(
			process.execPath,
			[heartbeatPath, "--input", inputPath],
			{ encoding: "utf8" },
		);
		rmSync(dir, { recursive: true, force: true });
		expect(result.status).toBe(0);
		const payload = JSON.parse(String(result.stdout));
		expect(payload.mode).toBe("safe");
		expect(payload.accepted).toBe(1);
	});
});
