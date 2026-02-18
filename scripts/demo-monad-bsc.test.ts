import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts", "demo-monad-bsc.mjs");

describe("demo-monad-bsc script", () => {
	it("prints help", () => {
		const result = spawnSync(process.execPath, [scriptPath, "--help"], {
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Safe default (dry-run, non-destructive)");
		expect(result.stdout).toContain("--execute");
	});

	it("blocks execute without explicit confirmation", () => {
		const result = spawnSync(process.execPath, [scriptPath, "--execute"], {
			encoding: "utf8",
		});
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("Refusing live execution");
	});
});
