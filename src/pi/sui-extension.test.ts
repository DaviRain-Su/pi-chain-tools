import { describe, expect, it } from "vitest";
import suiExtension from "./sui-extension.js";

describe("suiExtension", () => {
	it("registers minimal Sui tool surface", () => {
		const names: string[] = [];
		const registrar = {
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		};

		suiExtension(registrar);
		expect(names.sort()).toEqual(["sui_getBalance", "sui_transferSui"]);
	});
});
