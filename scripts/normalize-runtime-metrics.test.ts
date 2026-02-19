import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts", "normalize-runtime-metrics.mjs");

describe("normalize-runtime-metrics", () => {
	it("normalizes key order deterministically and is idempotent", () => {
		const tmpDir = mkdtempSync(
			path.join(os.tmpdir(), "normalize-runtime-metrics-"),
		);
		try {
			const dataDir = path.join(tmpDir, "apps", "dashboard", "data");
			const targetPath = path.join(dataDir, "rebalance-metrics.json");
			rmSync(dataDir, { recursive: true, force: true });
			mkdirSync(dataDir, { recursive: true });
			writeFileSync(
				targetPath,
				JSON.stringify({ z: 1, a: { d: 1, b: 2 }, arr: [{ y: 1, x: 2 }] }),
				"utf8",
			);

			const first = spawnSync(process.execPath, [scriptPath], {
				cwd: tmpDir,
				encoding: "utf8",
				env: { ...process.env, NEAR_DASHBOARD_METRICS_PATH: targetPath },
			});
			expect(first.status).toBe(0);
			expect(first.stdout).toContain("normalized");

			const afterFirst = readFileSync(targetPath, "utf8");
			expect(afterFirst).toContain('"a"');
			expect(afterFirst.indexOf('"a"')).toBeLessThan(afterFirst.indexOf('"z"'));
			expect(afterFirst).toContain('"x"');
			expect(afterFirst.indexOf('"x"')).toBeLessThan(afterFirst.indexOf('"y"'));

			const second = spawnSync(process.execPath, [scriptPath], {
				cwd: tmpDir,
				encoding: "utf8",
				env: { ...process.env, NEAR_DASHBOARD_METRICS_PATH: targetPath },
			});
			expect(second.status).toBe(0);
			expect(second.stdout).toContain("already normalized");
			expect(readFileSync(targetPath, "utf8")).toBe(afterFirst);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
