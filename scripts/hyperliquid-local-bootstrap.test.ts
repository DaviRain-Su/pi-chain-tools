import { describe, expect, it } from "vitest";

import { buildLocalBootstrapReport } from "./hyperliquid-local-bootstrap.mjs";

describe("hyperliquid-local-bootstrap", () => {
	it("is ready in offchain mode without contract/router", () => {
		const report = buildLocalBootstrapReport({
			HYPERLIQUID_AUTONOMOUS_MODE: "false",
			HYPERLIQUID_TESTNET_RPC_URL: "https://rpc.testnet.invalid",
			HYPERLIQUID_TESTNET_PRIVATE_KEY: "0xabc",
			HYPERLIQUID_AUTONOMOUS_TOKEN_IN: "USDC",
			HYPERLIQUID_AUTONOMOUS_TOKEN_OUT: "USDT",
			HYPERLIQUID_AUTONOMOUS_AMOUNT_RAW: "1000000",
		});
		expect(report.mode).toBe("offchain-orchestrator");
		expect(report.ready).toBe(true);
		expect(report.missingRequired).toEqual([]);
	});

	it("reports missing required keys", () => {
		const report = buildLocalBootstrapReport({
			HYPERLIQUID_AUTONOMOUS_MODE: "false",
		});
		expect(report.ready).toBe(false);
		expect(report.missingRequired).toContain("HYPERLIQUID_TESTNET_RPC_URL");
		expect(report.nextCommands[0]).toBe("cp .env.bsc.example .env.bsc.local");
	});
});
