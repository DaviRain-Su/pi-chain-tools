import { describe, expect, it } from "vitest";
import solanaWorkflowExtension from "./solana-workflow-extension.js";

describe("solanaWorkflowExtension", () => {
	it("registers workflow-first tool surface", () => {
		const names: string[] = [];
		const registrar = {
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		};

		solanaWorkflowExtension(registrar);
		expect(names.sort()).toEqual([
			"solana_confirmTransaction",
			"w3rt_run_workflow_v0",
		]);
	});
});
