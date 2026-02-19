import type { McpProvider } from "../provider.js";

export function createMockMcpProvider(): McpProvider {
	return {
		id: "mock",
		label: "Mock MCP (read-only)",
		capabilities: ["search", "plan"],
		async search(query, context) {
			if (!String(query || "").trim()) {
				return {
					ok: false,
					error: {
						code: "invalid_query",
						message: "query must be a non-empty string",
					},
				};
			}
			return {
				ok: true,
				data: {
					provider: "mock",
					query,
					requestId: context.requestId || null,
					items: [
						{
							title: `mock result for ${query}`,
							note: "read-only provider stub",
						},
					],
				},
			};
		},
		async plan(params, context) {
			return {
				ok: true,
				data: {
					provider: "mock",
					requestId: context.requestId || null,
					intent: params.intent || null,
					mode: "plan-only",
				},
			};
		},
	};
}
