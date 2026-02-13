import { describe, expect, it } from "vitest";
import nearExtension from "./near-extension.js";

describe("nearExtension", () => {
	it("registers near tools once", () => {
		const names: string[] = [];
		const registrar = {
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		};

		nearExtension(registrar);
		nearExtension(registrar);

		expect(names.sort()).toEqual([
			"near_getAccount",
			"near_getBalance",
			"near_getFtBalance",
			"near_getSwapQuoteRef",
			"near_rpc",
			"near_swapRef",
			"near_transferFt",
			"near_transferNear",
			"w3rt_run_near_workflow_v0",
		]);
	});
});
