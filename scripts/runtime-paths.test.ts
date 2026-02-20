import { chdir, cwd } from "node:process";
import { describe, expect, it } from "vitest";

import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

describe("runtime-paths", () => {
	it("resolves repo root from module url regardless of current working directory", () => {
		const previous = cwd();
		try {
			chdir("/");
			const root = resolveRepoRootFromMetaUrl(import.meta.url);
			expect(root).toBeTruthy();
			expect(root?.endsWith("/pi-chain-tools")).toBe(true);
		} finally {
			chdir(previous);
		}
	});
});
