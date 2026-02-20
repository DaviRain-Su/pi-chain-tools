import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runLiveTestRunner } from "./live-test-runner.mjs";

describe("live-test-runner", () => {
	it("blocks execute when --confirm-live true is not provided", async () => {
		const report = await runLiveTestRunner([
			"--mode",
			"execute",
			"--target-chain",
			"bsc",
		]);
		expect(report.phases.execute?.blocked).toBe(true);
		expect(report.phases.execute?.reason).toContain("--confirm-live true");
	});

	it("aborts execute when panic-stop file exists", async () => {
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "live-test-runner-"));
		const panicFile = path.join(tempDir, "PANIC_STOP");
		writeFileSync(panicFile, "halt\n", "utf8");

		const report = await runLiveTestRunner([
			"--mode",
			"execute",
			"--confirm-live",
			"true",
			"--panic-stop",
			panicFile,
			"--target-chain",
			"bsc",
		]);

		expect(report.phases.execute?.aborted).toBe(true);
		expect(report.phases.execute?.reason).toContain("panic-stop");
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("writes report shape with rollback guidance", async () => {
		const report = await runLiveTestRunner([
			"--mode",
			"preflight",
			"--target-chain",
			"bsc",
		]);
		expect(report).toMatchObject({
			suite: "live-test-runner",
			version: 1,
			args: {
				mode: "preflight",
				targetChain: "bsc",
			},
			rollbackGuidance: {
				notes: expect.any(Array),
				nextCommands: expect.any(Array),
				emergencyStop: expect.any(String),
			},
			phases: {
				preflight: expect.any(Object),
			},
		});
	});
});
