import { describe, expect, it } from "vitest";
import defaultExtension from "./default-extension.js";

describe("defaultExtension", () => {
	it("registers bundled Solana workflow + Sui tools once", () => {
		const names: string[] = [];
		const registrar = {
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		};

		defaultExtension(registrar);
		defaultExtension(registrar);

		expect(names).toContain("solana_getBalance");
		expect(names).toContain("w3rt_run_workflow_v0");
		expect(names).toContain("sui_getBalance");
		expect(names).toContain("w3rt_run_sui_defi_workflow_v0");
		expect(new Set(names).size).toBe(names.length);
	});
});
