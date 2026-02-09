import { describe, expect, it } from "vitest";
import solanaWorkflowExtension from "./solana-workflow-extension.js";

describe("solanaWorkflowExtension", () => {
	it("registers workflow-first tool surface once", () => {
		const names: string[] = [];
		const registrar = {
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		};

		solanaWorkflowExtension(registrar);
		solanaWorkflowExtension(registrar);
		expect(names.sort()).toEqual([
			"solana_confirmTransaction",
			"solana_getBalance",
			"solana_getDefiPositions",
			"solana_getMeteoraQuote",
			"solana_getOrcaQuote",
			"solana_getPortfolio",
			"solana_getTokenAccounts",
			"solana_getTokenBalance",
			"solana_meteoraSwap",
			"solana_orcaSwap",
			"w3rt_run_workflow_v0",
		]);
	});
});
