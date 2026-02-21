import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const piExtensions = [
	"src/pi/default-extension.ts",
	"src/pi/evm-extension.ts",
	"src/pi/kaspa-extension.ts",
	"src/pi/meta-extension.ts",
	"src/pi/near-extension.ts",
	"src/pi/solana-extension.ts",
	"src/pi/solana-workflow-extension.ts",
	"src/pi/sui-extension.ts",
];

describe("w3rt-core pi extension imports", () => {
	it("uses w3rt-core index instead of legacy core/types path", () => {
		for (const rel of piExtensions) {
			const source = readFileSync(path.resolve(rel), "utf8");
			expect(source).toContain("../w3rt-core/index.js");
			expect(source).not.toContain("../core/types.js");
		}
	});
});
