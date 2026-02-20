import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
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
			expect(
				second.stdout.includes("already normalized") ||
					second.stdout.includes("fast-skip unchanged"),
			).toBe(true);
			expect(readFileSync(targetPath, "utf8")).toBe(afterFirst);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("fast-skips unchanged target when cache matches stat metadata", () => {
		const tmpDir = mkdtempSync(
			path.join(os.tmpdir(), "normalize-runtime-metrics-cache-hit-"),
		);
		try {
			const dataDir = path.join(tmpDir, "apps", "dashboard", "data");
			const targetPath = path.join(dataDir, "rebalance-metrics.json");
			const cachePath = path.join(
				dataDir,
				".normalize-runtime-metrics-cache.json",
			);
			mkdirSync(dataDir, { recursive: true });
			writeFileSync(
				targetPath,
				`${JSON.stringify({ a: 1 }, null, "\t")}\n`,
				"utf8",
			);
			const targetStat = statSync(targetPath);
			writeFileSync(
				cachePath,
				`${JSON.stringify({ targetPath, size: targetStat.size, mtimeMs: targetStat.mtimeMs }, null, 2)}\n`,
				"utf8",
			);

			const run = spawnSync(process.execPath, [scriptPath], {
				cwd: tmpDir,
				encoding: "utf8",
				env: {
					...process.env,
					NEAR_DASHBOARD_METRICS_PATH: targetPath,
					NEAR_DASHBOARD_NORMALIZE_CACHE_PATH: cachePath,
				},
			});
			expect(run.status).toBe(0);
			expect(run.stdout).toContain("fast-skip unchanged");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("stays stable across repeated runs when target file is missing/rotating", () => {
		const tmpDir = mkdtempSync(
			path.join(os.tmpdir(), "normalize-runtime-metrics-missing-"),
		);
		try {
			const missingPath = path.join(
				tmpDir,
				"apps",
				"dashboard",
				"data",
				"rebalance-metrics.json",
			);
			const first = spawnSync(process.execPath, [scriptPath], {
				cwd: tmpDir,
				encoding: "utf8",
				env: { ...process.env, NEAR_DASHBOARD_METRICS_PATH: missingPath },
			});
			const second = spawnSync(process.execPath, [scriptPath], {
				cwd: tmpDir,
				encoding: "utf8",
				env: { ...process.env, NEAR_DASHBOARD_METRICS_PATH: missingPath },
			});
			expect(first.status).toBe(0);
			expect(second.status).toBe(0);
			expect(first.stdout).toContain("skipped: target missing");
			expect(second.stdout).toContain("skipped: target missing");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
