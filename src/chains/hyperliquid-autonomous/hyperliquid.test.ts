import { describe, expect, it, vi } from "vitest";

import {
	getHyperliquidCapability,
	getHyperliquidReadiness,
	parseHyperliquidConfig,
	prepareHyperliquidExecuteIntent,
	readHyperliquidHealth,
	resolveHyperliquidExecuteBinding,
} from "./hyperliquid.js";

describe("hyperliquid autonomous hyperliquid seam", () => {
	it("keeps seam disabled by default", async () => {
		const readiness = await getHyperliquidReadiness({ env: {} });
		expect(readiness.config.enabled).toBe(false);
		expect(readiness.health.ok).toBe(true);
		expect(readiness.health.message).toContain("feature flag off");
		expect(readiness.capability.executeBinding).toBe("none");
	});

	it("parses typed config with defaults", () => {
		expect(
			parseHyperliquidConfig({
				env: {
					HYPERLIQUID_AUTONOMOUS_ENABLED: "true",
					HYPERLIQUID_AUTONOMOUS_API_BASE_URL: "https://example.invalid/",
					HYPERLIQUID_AUTONOMOUS_TIMEOUT_MS: "5000",
					HYPERLIQUID_AUTONOMOUS_EXECUTE_BINDING_ENABLED: "true",
					HYPERLIQUID_AUTONOMOUS_EXECUTE_BINDING_REQUIRED: "true",
					HYPERLIQUID_AUTONOMOUS_EXECUTE_ACTIVE: "false",
					HYPERLIQUID_AUTONOMOUS_EXECUTE_COMMAND: "node scripts/exec.mjs",
					HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS: "0xrouter",
					HYPERLIQUID_AUTONOMOUS_EXECUTOR_ADDRESS: "0xexecutor",
				},
			}),
		).toEqual({
			enabled: true,
			apiBaseUrl: "https://example.invalid",
			timeoutMs: 5000,
			executeBindingEnabled: true,
			executeBindingRequired: true,
			executeActive: false,
			executeCommand: "node scripts/exec.mjs",
			routerAddress: "0xrouter",
			executorAddress: "0xexecutor",
		});
	});

	it("exposes execute-binding capability marker", () => {
		const capability = getHyperliquidCapability({
			env: {
				HYPERLIQUID_AUTONOMOUS_ENABLED: "true",
				HYPERLIQUID_AUTONOMOUS_EXECUTE_BINDING_ENABLED: "true",
				HYPERLIQUID_AUTONOMOUS_EXECUTE_COMMAND: "node scripts/exec.mjs",
				HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS: "0xrouter",
				HYPERLIQUID_AUTONOMOUS_EXECUTOR_ADDRESS: "0xexecutor",
			},
		});
		expect(capability.canReadHealth).toBe(true);
		expect(capability.canExecute).toBe(false);
		expect(capability.executeBinding).toBe("prepared");
	});

	it("resolves execute binding markers correctly", () => {
		expect(
			resolveHyperliquidExecuteBinding({
				enabled: false,
				executeBindingEnabled: true,
				executeActive: true,
				executeCommand: "x",
				routerAddress: "0x1",
				executorAddress: "0x2",
			}),
		).toBe("none");
		expect(
			resolveHyperliquidExecuteBinding({
				enabled: true,
				executeBindingEnabled: true,
				executeActive: false,
				executeCommand: "x",
				routerAddress: "0x1",
				executorAddress: "0x2",
			}),
		).toBe("prepared");
		expect(
			resolveHyperliquidExecuteBinding({
				enabled: true,
				executeBindingEnabled: true,
				executeActive: true,
				executeCommand: "x",
				routerAddress: "0x1",
				executorAddress: "0x2",
			}),
		).toBe("active");
	});

	it("prepares typed execute intent when binding is ready", () => {
		const prepared = prepareHyperliquidExecuteIntent({
			env: {
				HYPERLIQUID_AUTONOMOUS_ENABLED: "true",
				HYPERLIQUID_AUTONOMOUS_EXECUTE_BINDING_ENABLED: "true",
				HYPERLIQUID_AUTONOMOUS_EXECUTE_COMMAND: "node scripts/exec.mjs",
				HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS: "0xrouter",
				HYPERLIQUID_AUTONOMOUS_EXECUTOR_ADDRESS: "0xexecutor",
			},
			intent: {
				tokenIn: "USDT",
				tokenOut: "USDC",
				amountRaw: "1000000",
			},
		});
		expect(prepared.ok).toBe(true);
		expect(prepared.executeBinding).toBe("prepared");
		expect(prepared.prepared).toMatchObject({
			protocol: "hyperliquid",
			chain: "hyperliquid",
			tokenIn: "USDT",
			tokenOut: "USDC",
			amountRaw: "1000000",
		});
	});

	it("returns binding-missing blockers with remediation when not configured", () => {
		const result = prepareHyperliquidExecuteIntent({
			env: { HYPERLIQUID_AUTONOMOUS_ENABLED: "true" },
			intent: {
				tokenIn: "USDT",
				tokenOut: "USDC",
				amountRaw: "1000000",
			},
		});
		expect(result.ok).toBe(false);
		expect(result.executeBinding).toBe("none");
		expect(result.remediation.join(" ")).toContain(
			"HYPERLIQUID_AUTONOMOUS_EXECUTE_BINDING_ENABLED",
		);
	});

	it("performs health read when enabled", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
		});
		const result = await readHyperliquidHealth({
			config: {
				enabled: true,
				apiBaseUrl: "https://example.invalid",
				timeoutMs: 1000,
				executeBindingEnabled: false,
				executeBindingRequired: false,
				executeActive: false,
				executeCommand: "",
				routerAddress: "",
				executorAddress: "",
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
