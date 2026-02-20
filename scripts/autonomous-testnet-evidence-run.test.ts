import { describe, expect, it } from "vitest";

import { validatePrerequisites } from "./autonomous-testnet-evidence-run.mjs";

describe("autonomous-testnet-evidence precheck", () => {
	it("passes in offchain-orchestrator mode without contract/router", () => {
		const result = validatePrerequisites({
			HYPERLIQUID_AUTONOMOUS_MODE: "false",
			HYPERLIQUID_TESTNET_RPC_URL: "https://rpc.testnet.invalid",
			HYPERLIQUID_TESTNET_PRIVATE_KEY: "0xabc",
			HYPERLIQUID_AUTONOMOUS_TOKEN_IN: "USDC",
			HYPERLIQUID_AUTONOMOUS_TOKEN_OUT: "USDT",
			HYPERLIQUID_AUTONOMOUS_AMOUNT_RAW: "1000000",
		});
		expect(result.ok).toBe(true);
		expect(result.mode).toBe("offchain-orchestrator");
		expect(result.evidenceType).toBe("offchain_orchestrator_evidence");
		expect(result.missing).toEqual([]);
	});

	it("requires contract/router in onchain-contract-cycle mode", () => {
		const result = validatePrerequisites({
			HYPERLIQUID_AUTONOMOUS_MODE: "true",
			HYPERLIQUID_TESTNET_RPC_URL: "https://rpc.testnet.invalid",
			HYPERLIQUID_TESTNET_PRIVATE_KEY: "0xabc",
			HYPERLIQUID_AUTONOMOUS_TOKEN_IN: "USDC",
			HYPERLIQUID_AUTONOMOUS_TOKEN_OUT: "USDT",
			HYPERLIQUID_AUTONOMOUS_AMOUNT_RAW: "1000000",
		});
		expect(result.ok).toBe(false);
		expect(result.mode).toBe("onchain-contract-cycle");
		expect(result.missing).toContain(
			"HYPERLIQUID_AUTONOMOUS_CONTRACT_ADDRESS or HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS",
		);
	});
});
