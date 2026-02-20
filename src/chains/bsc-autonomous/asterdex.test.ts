import { describe, expect, it, vi } from "vitest";

import {
	getAsterDexCapability,
	getAsterDexReadiness,
	parseAsterDexConfig,
	readAsterDexHealth,
} from "./asterdex.js";

describe("bsc autonomous asterdex seam", () => {
	it("keeps seam disabled by default", async () => {
		const readiness = await getAsterDexReadiness({ env: {} });
		expect(readiness.config.enabled).toBe(false);
		expect(readiness.health.ok).toBe(true);
		expect(readiness.health.message).toContain("feature flag off");
	});

	it("parses typed config with defaults", () => {
		expect(
			parseAsterDexConfig({
				env: {
					BSC_AUTONOMOUS_ASTERDEX_ENABLED: "true",
					BSC_AUTONOMOUS_ASTERDEX_API_BASE_URL: "https://example.invalid/",
					BSC_AUTONOMOUS_ASTERDEX_TIMEOUT_MS: "5000",
				},
			}),
		).toEqual({
			enabled: true,
			apiBaseUrl: "https://example.invalid",
			timeoutMs: 5000,
		});
	});

	it("exposes read-only capability with execution TODO marker", () => {
		const capability = getAsterDexCapability();
		expect(capability.canReadHealth).toBe(true);
		expect(capability.canExecute).toBe(false);
		expect(capability.executionTodo).toContain("TODO(onchain-binding)");
	});

	it("performs health read when enabled", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
		});
		const result = await readAsterDexHealth({
			config: {
				enabled: true,
				apiBaseUrl: "https://example.invalid",
				timeoutMs: 1000,
			},
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://example.invalid/health",
			expect.objectContaining({ method: "GET" }),
		);
		expect(result.ok).toBe(true);
		expect(result.statusCode).toBe(200);
	});
});
