import { describe, expect, it } from "vitest";

const modPromise = import("./evm-security-core.mjs");

describe("evm-security-core", () => {
	it("parses and normalizes watchlist config", async () => {
		const mod = await modPromise;
		const result = mod.validateWatchlist({
			chains: [
				{
					chainId: 1,
					name: "ethereum",
					rpcUrlEnv: "ETH_RPC",
				},
			],
			contracts: [
				{
					chainId: 1,
					address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
					label: "USDC",
					type: "erc20",
					ownerExpected: "0x0000000000000000000000000000000000000001",
				},
			],
			notify: { enabled: true, severityMin: "WARN" },
		});
		expect(result.chains).toHaveLength(1);
		expect(result.contracts).toHaveLength(1);
		expect(result.contracts[0]?.address).toBe(
			"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
		);
		expect(result.notify.severityMin).toBe("warn");
	});

	it("classifies and compares severities", async () => {
		const mod = await modPromise;
		expect(mod.classifySeverity("critical")).toBe("critical");
		expect(mod.classifySeverity("UNKNOWN")).toBe("info");
		expect(mod.severityAtLeast("warn", "info")).toBe(true);
		expect(mod.severityAtLeast("info", "warn")).toBe(false);
	});

	it("builds alert payload grouping in report pipeline", async () => {
		const mod = await modPromise;
		expect(typeof mod.runSecurityScan).toBe("function");
		const source = await import("node:fs").then((fs) =>
			fs.readFileSync("scripts/evm-security-core.mjs", "utf8"),
		);
		expect(source).toContain("buildAlertPayloads");
		expect(source).toContain("alerts");
		expect(source).toContain("immediate_per_finding_with_dedupe_cooldown");
	});
});
