import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { collectAsterdexMatches } from "./guard-no-asterdex.mjs";

describe("guard-no-asterdex", () => {
	it("reports matches when residue exists", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "guard-no-asterdex-"));
		try {
			await writeFile(
				path.join(tmp, "bad.txt"),
				`${["As", "ter", "DEX"].join("")} residue`,
			);
			const matches = await collectAsterdexMatches(tmp);
			expect(matches.length).toBeGreaterThan(0);
			expect(matches[0]?.path).toBe("bad.txt");
		} finally {
			await rm(tmp, { recursive: true, force: true });
		}
	});

	it("ignores .git directory", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "guard-no-asterdex-"));
		try {
			await mkdir(path.join(tmp, ".git"), { recursive: true });
			await writeFile(
				path.join(tmp, ".git", "bad.txt"),
				`${["As", "ter", "DEX"].join("")} residue`,
			);
			const matches = await collectAsterdexMatches(tmp);
			expect(matches).toEqual([]);
		} finally {
			await rm(tmp, { recursive: true, force: true });
		}
	});
});
