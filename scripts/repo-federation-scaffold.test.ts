import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts", "repo-federation-scaffold.mjs");

describe("repo-federation-scaffold", () => {
	it("generates scaffold manifests for federation repos", () => {
		const tmpDir = mkdtempSync(
			path.join(os.tmpdir(), "repo-federation-scaffold-"),
		);
		try {
			const result = spawnSync(process.execPath, [scriptPath], {
				encoding: "utf8",
				env: {
					...process.env,
					FEDERATION_SCAFFOLD_OUTPUT_DIR: tmpDir,
				},
			});
			expect(result.status).toBe(0);
			const indexPath = path.join(tmpDir, "index.json");
			expect(existsSync(indexPath)).toBe(true);
			const index = JSON.parse(readFileSync(indexPath, "utf8"));
			expect(Array.isArray(index.repositories)).toBe(true);
			expect(index.repositories).toContain("w3rt-core");
			expect(index.repositories).toContain("gradience-openclaw-plugin");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
