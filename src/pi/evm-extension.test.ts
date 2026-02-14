import { describe, expect, it } from "vitest";
import evmExtension from "./evm-extension.js";

describe("evmExtension", () => {
	it("registers evm polymarket tool surface once", () => {
		const names: string[] = [];
		const registrar = {
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		};

		evmExtension(registrar);
		evmExtension(registrar);

		expect(names).toContain("evm_getTransferTokenMap");
		expect(names).toContain("evm_polymarketGetBtc5mMarkets");
		expect(names).toContain("evm_polymarketGetBtc5mAdvice");
		expect(names).toContain("evm_polymarketBuildBtc5mOrder");
		expect(names).toContain("evm_polymarketPlaceOrder");
		expect(names).toContain("evm_transferNative");
		expect(names).toContain("evm_transferErc20");
		expect(names).toContain("w3rt_run_evm_polymarket_workflow_v0");
		expect(names).toContain("w3rt_run_evm_transfer_workflow_v0");
		expect(new Set(names).size).toBe(names.length);
	});
});
