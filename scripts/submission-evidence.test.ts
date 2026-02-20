import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts", "submission-evidence.mjs");

describe("submission-evidence script", () => {
	it("generates deterministic markdown sections", () => {
		const tmpDir = mkdtempSync(path.join(os.tmpdir(), "submission-evidence-"));
		const outputPath = path.join(tmpDir, "submission-evidence.md");
		try {
			const result = spawnSync(process.execPath, [scriptPath], {
				encoding: "utf8",
				env: {
					...process.env,
					SUBMISSION_EVIDENCE_OUTPUT_PATH: outputPath,
				},
			});
			expect(result.status).toBe(0);
			expect(existsSync(outputPath)).toBe(true);
			const content = readFileSync(outputPath, "utf8");
			expect(content).toContain("# Submission Evidence Artifact");
			expect(content).toContain("## 1) Latest Commit");
			expect(content).toContain("## 2) Quality Snapshot (best-effort)");
			expect(content).toContain("## 4) Dashboard Runtime (local)");
			expect(content).toContain("## 5) Onchain Tx Proof Template");
			expect(content).toContain("## 6) Auto-linked Execution Proof Docs");
			expect(content).toContain("npm run check");
			expect(content).toContain("npm run test");
			expect(content).toContain("npm run security:check");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
