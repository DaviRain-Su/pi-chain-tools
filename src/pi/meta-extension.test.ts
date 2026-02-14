import { describe, expect, it } from "vitest";
import metaExtension from "./meta-extension.js";

describe("metaExtension", () => {
	it("registers meta tools once", () => {
		const names: string[] = [];
		const registrar = {
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		};

		metaExtension(registrar);
		metaExtension(registrar);

		expect(names).toContain("w3rt_getCapabilities_v0");
		expect(new Set(names).size).toBe(names.length);
	});
});
