import { describe, expect, it } from "vitest";
import type { McpProvider } from "../mcp/provider.js";
import { createMcpAdapter } from "./mcp-adapter.js";

const mockProvider: McpProvider = {
	id: "mock",
	label: "Mock MCP",
	capabilities: ["search"],
	async search(query) {
		return {
			ok: true,
			data: {
				items: [{ title: `result for ${query}` }],
			},
		};
	},
};

describe("unified mcp adapter", () => {
	it("returns normalized shape for mcp.search", async () => {
		const adapter = createMcpAdapter({
			providers: [mockProvider],
			defaultProviderId: "mock",
		});

		const result = await adapter.search({ query: "solana swaps" });
		expect(result.action).toBe("mcp.search");
		expect(result.ok).toBe(true);
		expect(result.provider.id).toBe("mock");
		expect(result.safety.mode).toBe("read_plan_only");
		expect(result.data).toEqual({
			items: [{ title: "result for solana swaps" }],
		});
	});

	it("returns not_supported for unsupported mcp.quote", async () => {
		const adapter = createMcpAdapter({
			providers: [mockProvider],
			defaultProviderId: "mock",
		});

		const result = await adapter.quote({
			params: { market: "SOL/USDC" },
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("not_supported");
		expect(result.provider.id).toBe("mock");
	});
});
