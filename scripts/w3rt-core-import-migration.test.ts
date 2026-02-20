import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowFiles = [
	"src/chains/evm/tools/workflow.ts",
	"src/chains/evm/tools/transfer-workflow.ts",
	"src/chains/evm/tools/venus-workflow.ts",
	"src/chains/evm/tools/swap-workflow.ts",
	"src/chains/near/tools/workflow.ts",
	"src/chains/solana/tools/workflow.ts",
	"src/chains/sui/tools/workflow.ts",
	"src/chains/kaspa/tools/workflow.ts",
];

describe("w3rt-core import migration", () => {
	it("routes workflow run-mode imports through w3rt-core boundary", () => {
		for (const rel of workflowFiles) {
			const source = readFileSync(path.resolve(rel), "utf8");
			expect(source).toContain("w3rt-core/index.js");
			expect(source).not.toContain("shared/workflow-runtime.js");
		}
	});
});
