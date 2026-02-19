import { afterEach, describe, expect, it } from "vitest";
import { createMcpAdapter } from "../../core/mcp-adapter.js";
import { createBreezeMcpProvider } from "./breeze.js";

describe("breeze mcp provider", () => {
	afterEach(() => {
		Reflect.deleteProperty(process.env, "BREEZE_API_BASE_URL");
		Reflect.deleteProperty(process.env, "BREEZE_API_KEY");
	});

	it("returns not_configured when API base URL is missing", async () => {
		const provider = createBreezeMcpProvider();
		const result = await provider.search?.("stable yield", {
			providerId: "breeze",
		});
		expect(result?.ok).toBe(false);
		expect(result?.error?.code).toBe("not_configured");
	});

	it("returns provider_unavailable when inferred endpoints fail", async () => {
		const provider = createBreezeMcpProvider({
			apiBaseUrl: "https://breeze.invalid",
			fetchImpl: async () =>
				new Response(JSON.stringify({ error: "missing" }), {
					status: 404,
					headers: { "content-type": "application/json" },
				}),
		});
		const result = await provider.search?.("usdc", {
			providerId: "breeze",
			requestId: "req-1",
		});
		expect(result?.ok).toBe(false);
		expect(result?.error?.code).toBe("provider_unavailable");
	});

	it("works via unified adapter providerId=breeze", async () => {
		const provider = createBreezeMcpProvider({
			apiBaseUrl: "https://breeze.example",
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						items: [{ id: "s1", name: "USDC Vault", apy: 8.2, asset: "USDC" }],
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
		});
		const adapter = createMcpAdapter({
			providers: [provider],
			defaultProviderId: "breeze",
		});
		const result = await adapter.search({
			query: "usdc",
			providerId: "breeze",
		});
		expect(result.ok).toBe(true);
		expect(result.provider.id).toBe("breeze");
		expect(result.action).toBe("mcp.search");
	});
});
