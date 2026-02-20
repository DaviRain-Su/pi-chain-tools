import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { listAutonomousCycleRuns } from "./autonomous-cycle-runs.mjs";

describe("autonomous-cycle-runs", () => {
	it("skips malformed history json and still returns valid response", async () => {
		const tmpDir = mkdtempSync(
			path.join(os.tmpdir(), "autonomous-cycle-runs-"),
		);
		try {
			const historyDir = path.join(tmpDir, "runs");
			mkdirSync(historyDir, { recursive: true });
			writeFileSync(
				path.join(historyDir, "2026-01-01-good.json"),
				JSON.stringify({
					intent: { runId: "good-1" },
					mode: "dryrun",
					txEvidence: { status: "dryrun" },
					ok: true,
				}),
				"utf8",
			);
			writeFileSync(
				path.join(historyDir, "2026-01-02-bad.json"),
				"{bad-json",
				"utf8",
			);

			const latestPath = path.join(tmpDir, "latest.json");
			writeFileSync(
				latestPath,
				JSON.stringify({ intent: { runId: "latest" } }),
				"utf8",
			);

			const result = await listAutonomousCycleRuns([
				"--history-dir",
				historyDir,
				"--latest",
				latestPath,
				"--limit",
				"5",
			]);

			expect(result.ok).toBe(true);
			expect(Array.isArray(result.runs)).toBe(true);
			expect(result.runs.some((row) => row.runId === "good-1")).toBe(true);
			expect(result.malformedSkippedCount).toBe(1);
			expect(result.errors).toContain("malformed_skipped:1");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
