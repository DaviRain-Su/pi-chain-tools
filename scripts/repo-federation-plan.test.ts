import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts", "repo-federation-plan.mjs");

describe("repo-federation-plan", () => {
	it("generates migration plan json with chain domains", () => {
		const tmpDir = mkdtempSync(path.join(os.tmpdir(), "repo-federation-plan-"));
		const outputPath = path.join(tmpDir, "repo-federation-plan.json");
		try {
			const result = spawnSync(process.execPath, [scriptPath], {
				encoding: "utf8",
				env: {
					...process.env,
					FEDERATION_PLAN_OUTPUT_PATH: outputPath,
				},
			});
			expect(result.status).toBe(0);
			expect(existsSync(outputPath)).toBe(true);
			const content = JSON.parse(readFileSync(outputPath, "utf8"));
			expect(content.strategy).toBe("multi-mono-federation");
			expect(Array.isArray(content.phases)).toBe(true);
			expect(content.phases.length).toBeGreaterThanOrEqual(4);
			expect(Array.isArray(content.domains?.chains)).toBe(true);
			expect(content.domains.chains.length).toBeGreaterThan(0);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
