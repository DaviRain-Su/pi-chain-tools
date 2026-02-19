import { describe, expect, it } from "vitest";
import type { McpProvider } from "./provider.js";
import {
	DEFAULT_MCP_PROVIDER_ID,
	createMcpProviderRegistry,
} from "./registry.js";

const dflowProvider: McpProvider = {
	id: "dflow",
	label: "DFlow",
	capabilities: ["search"],
};

const demoProvider: McpProvider = {
	id: "demo",
	label: "Demo",
	capabilities: ["search", "quote", "plan"],
};

const breezeProvider: McpProvider = {
	id: "breeze",
	label: "Breeze",
	capabilities: ["search", "plan"],
};

describe("mcp provider registry", () => {
	it("resolves explicit provider by id", () => {
		const registry = createMcpProviderRegistry({
			providers: [dflowProvider, breezeProvider, demoProvider],
			defaultProviderId: DEFAULT_MCP_PROVIDER_ID,
		});

		expect(registry.resolve("demo")?.id).toBe("demo");
		expect(registry.resolve("DFLOW")?.id).toBe("dflow");
		expect(registry.resolve("breeze")?.id).toBe("breeze");
	});

	it("falls back to configured default when providerId is omitted", () => {
		const registry = createMcpProviderRegistry({
			providers: [dflowProvider, demoProvider],
			defaultProviderId: "demo",
		});

		expect(registry.getDefaultProviderId()).toBe("demo");
		expect(registry.resolve()?.id).toBe("demo");
	});
});
