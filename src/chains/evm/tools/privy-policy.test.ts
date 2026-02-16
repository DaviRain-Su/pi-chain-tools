import { describe, expect, it } from "vitest";
import {
	createPrivyPolicyTools,
	getMultiChainAgentPolicy,
	getPrivyPolicySummary,
	getVenusBscPolicy,
	getVenusLifiBscPolicy,
} from "./privy-policy.js";

describe("privy-policy templates", () => {
	it("Venus BSC policy includes all Venus contracts", () => {
		const policy = getVenusBscPolicy();
		expect(policy.name).toBe("venus-bsc-agent");
		expect(policy.chainId).toBe(56);
		expect(policy.caip2).toBe("eip155:56");

		const allowlistRule = policy.rules.find(
			(r) => r.type === "contract_allowlist",
		);
		expect(allowlistRule).toBeDefined();
		const addresses =
			(allowlistRule?.config.allowedAddresses as string[]) ?? [];

		// Should include Venus Comptroller
		expect(
			addresses.some(
				(a) =>
					a.toLowerCase() ===
					"0xfD36E2c2a6789Db23113685031d7F16329158384".toLowerCase(),
			),
		).toBe(true);

		// Should include vUSDC
		expect(
			addresses.some(
				(a) =>
					a.toLowerCase() ===
					"0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8".toLowerCase(),
			),
		).toBe(true);

		// Should include BSC USDC token
		expect(
			addresses.some(
				(a) =>
					a.toLowerCase() ===
					"0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d".toLowerCase(),
			),
		).toBe(true);

		// Should have chain restriction
		const chainRule = policy.rules.find((r) => r.type === "chain_restriction");
		expect(chainRule).toBeDefined();
	});

	it("Venus + LI.FI policy includes LI.FI Diamond", () => {
		const policy = getVenusLifiBscPolicy();
		expect(policy.name).toBe("venus-lifi-bsc-agent");

		const allowlistRule = policy.rules.find(
			(r) => r.type === "contract_allowlist",
		);
		const addresses =
			(allowlistRule?.config.allowedAddresses as string[]) ?? [];

		// Should include LI.FI Diamond
		expect(
			addresses.some(
				(a) =>
					a.toLowerCase() ===
					"0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE".toLowerCase(),
			),
		).toBe(true);

		// Should have spend limit
		const spendRule = policy.rules.find((r) => r.type === "spend_limit");
		expect(spendRule).toBeDefined();
		expect(spendRule?.config.dailyLimitUsd).toBe(10_000);
	});

	it("multi-chain policy returns array with BSC + global", () => {
		const policies = getMultiChainAgentPolicy();
		expect(policies.length).toBe(2);
		expect(policies[0].chainId).toBe(56);
		expect(policies[1].caip2).toBe("eip155:*");
	});

	it("policy summary includes setup instructions", () => {
		const summary = getPrivyPolicySummary();
		expect(summary.templates.length).toBe(2);
		expect(summary.setupInstructions.length).toBeGreaterThan(0);
		expect(summary.securityNotes.length).toBeGreaterThan(0);

		// Instructions should mention Privy Dashboard
		const hasPrivy = summary.setupInstructions.some((s) =>
			s.includes("Privy Dashboard"),
		);
		expect(hasPrivy).toBe(true);
	});

	it("no duplicate addresses in allowlist", () => {
		const policy = getVenusLifiBscPolicy();
		const allowlistRule = policy.rules.find(
			(r) => r.type === "contract_allowlist",
		);
		const addresses =
			(allowlistRule?.config.allowedAddresses as string[]) ?? [];
		const unique = new Set(addresses.map((a) => a.toLowerCase()));
		expect(unique.size).toBe(addresses.length);
	});
});

describe("privy policy MCP tool", () => {
	it("returns venus-lifi policy by default", async () => {
		const tools = createPrivyPolicyTools();
		expect(tools).toHaveLength(1);

		const tool = tools[0] as unknown as {
			name: string;
			execute: (
				id: string,
				params: Record<string, unknown>,
			) => Promise<{
				content: { type: string; text: string }[];
				details: Record<string, unknown>;
			}>;
		};

		expect(tool.name).toContain("privyPolicyRecommendation");

		const result = await tool.execute("t1", {});
		expect(result.content[0].text).toContain("venus-lifi");
		expect(result.details.schema).toBe("evm.privy.policy.recommendation.v1");

		const templates = result.details.templates as unknown[];
		expect(templates.length).toBe(1);
	});

	it("returns venus-only policy when requested", async () => {
		const tools = createPrivyPolicyTools();
		const tool = tools[0] as unknown as {
			execute: (
				id: string,
				params: Record<string, unknown>,
			) => Promise<{
				details: Record<string, unknown>;
			}>;
		};

		const result = await tool.execute("t2", { template: "venus" });
		const templates = result.details.templates as { name: string }[];
		expect(templates[0].name).toBe("venus-bsc-agent");
	});

	it("returns multi-chain policies", async () => {
		const tools = createPrivyPolicyTools();
		const tool = tools[0] as unknown as {
			execute: (
				id: string,
				params: Record<string, unknown>,
			) => Promise<{
				details: Record<string, unknown>;
			}>;
		};

		const result = await tool.execute("t3", { template: "multi-chain" });
		const templates = result.details.templates as unknown[];
		expect(templates.length).toBe(2);
	});
});
