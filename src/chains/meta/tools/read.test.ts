import { describe, expect, it, vi } from "vitest";
import { setEvmTransferPolicy } from "../../evm/policy.js";

vi.mock("../../evm/toolset.js", () => ({
	createEvmToolset: () => ({
		chain: "evm",
		groups: [
			{
				name: "read",
				tools: [{ name: "evm_polymarketGetBtc5mMarkets" }],
			},
			{
				name: "execute",
				tools: [{ name: "w3rt_run_evm_polymarket_workflow_v0" }],
			},
		],
	}),
}));

vi.mock("../../near/toolset.js", () => ({
	createNearToolset: () => ({
		chain: "near",
		groups: [
			{ name: "read", tools: [{ name: "near_getBalance" }] },
			{ name: "execute", tools: [{ name: "w3rt_run_near_workflow_v0" }] },
		],
	}),
}));

vi.mock("../../sui/toolset.js", () => ({
	createSuiToolset: () => ({
		chain: "sui",
		groups: [
			{ name: "read", tools: [{ name: "sui_getBalance" }] },
			{ name: "execute", tools: [{ name: "w3rt_run_sui_defi_workflow_v0" }] },
		],
	}),
}));

vi.mock("../../solana/workflow-toolset.js", () => ({
	createSolanaWorkflowToolset: () => ({
		chain: "solana",
		groups: [
			{ name: "read", tools: [{ name: "solana_getBalance" }] },
			{ name: "execute", tools: [{ name: "w3rt_run_workflow_v0" }] },
		],
	}),
}));

import { createMetaReadTools } from "./read.js";

type ReadTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(name: string): ReadTool {
	const tool = createMetaReadTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ReadTool;
}

describe("meta capability tools", () => {
	it("reads and updates transfer policy", async () => {
		setEvmTransferPolicy({
			mode: "open",
			enforceOn: "mainnet_like",
			clearRecipients: true,
			updatedBy: "meta.read.test.setup",
		});
		const setTool = getTool("w3rt_setPolicy_v0");
		const setResult = await setTool.execute("meta-policy-set", {
			scope: "evm.transfer",
			mode: "allowlist",
			enforceOn: "all",
			allowedRecipients: ["0x000000000000000000000000000000000000beef"],
			updatedBy: "meta.read.test",
			note: "lock transfer target",
		});
		expect(setResult.content[0]?.text).toContain("Policy updated");
		expect(setResult.details).toMatchObject({
			schema: "w3rt.policy.v1",
			scope: "evm.transfer",
			policy: {
				mode: "allowlist",
				enforceOn: "all",
				allowedRecipients: ["0x000000000000000000000000000000000000beef"],
			},
		});

		const getToolInstance = getTool("w3rt_getPolicy_v0");
		const getResult = await getToolInstance.execute("meta-policy-get", {});
		expect(getResult.content[0]?.text).toContain("mode=allowlist");
		expect(getResult.details).toMatchObject({
			schema: "w3rt.policy.v1",
			scope: "evm.transfer",
			policy: {
				mode: "allowlist",
				enforceOn: "all",
			},
		});
	});

	it("returns all chains by default", async () => {
		const tool = getTool("w3rt_getCapabilities_v0");
		const result = await tool.execute("meta-1", {});
		expect(result.content[0]?.text).toContain("ACP capability catalog");
		expect(result.details).toMatchObject({
			schema: "w3rt.capabilities.v1",
			query: {
				chain: "all",
				includeExamples: true,
				includeToolNames: true,
				executableOnly: false,
				maxRisk: "high",
			},
			digest: {
				chainCount: 4,
			},
			chains: expect.arrayContaining([
				expect.objectContaining({ chain: "solana" }),
				expect.objectContaining({ chain: "sui" }),
				expect.objectContaining({ chain: "near" }),
				expect.objectContaining({ chain: "evm" }),
			]),
		});
	});

	it("filters by maxRisk and hides examples/tool names", async () => {
		const tool = getTool("w3rt_getCapabilities_v0");
		const result = await tool.execute("meta-2", {
			maxRisk: "medium",
			includeExamples: false,
			includeToolNames: false,
		});
		const details = result.details as {
			query: {
				maxRisk: string;
				includeExamples: boolean;
				includeToolNames: boolean;
			};
			chains: Array<{
				chain: string;
				workflows: Array<{ tool: string; nlExamples: string[] }>;
			}>;
			toolsets: Array<{
				chain: string;
				groups: Array<{ tools: string[] }>;
			}>;
		};
		expect(result.content[0]?.text).toContain("maxRisk=medium");
		expect(details).toMatchObject({
			query: {
				maxRisk: "medium",
				includeExamples: false,
				includeToolNames: false,
			},
		});
		expect(details).toMatchObject({
			chains: expect.arrayContaining([
				expect.objectContaining({ chain: "solana" }),
				expect.objectContaining({ chain: "evm" }),
			]),
			toolsets: expect.arrayContaining([
				expect.objectContaining({ chain: "solana" }),
			]),
		});
		for (const chain of details.chains) {
			for (const workflow of chain.workflows) {
				expect(workflow.nlExamples).toEqual([]);
			}
		}
		const evm = details.chains.find((chain) => chain.chain === "evm");
		expect(
			evm?.workflows.some(
				(workflow) => workflow.tool === "w3rt_run_evm_transfer_workflow_v0",
			),
		).toBe(true);
		expect(
			evm?.workflows.some(
				(workflow) => workflow.tool === "w3rt_run_evm_polymarket_workflow_v0",
			),
		).toBe(false);
		for (const toolset of details.toolsets) {
			for (const group of toolset.groups) {
				expect(group.tools).toEqual([]);
			}
		}
	});

	it("returns ACP handshake with embedded capabilities by default", async () => {
		setEvmTransferPolicy({
			mode: "open",
			enforceOn: "mainnet_like",
			clearRecipients: true,
			updatedBy: "meta.read.test.handshake",
		});
		const tool = getTool("w3rt_getCapabilityHandshake_v0");
		const result = await tool.execute("meta-3", {
			clientName: "openclaw-agent",
			clientVersion: "0.1.0",
		});
		expect(result.content[0]?.text).toContain("ACP handshake ready");
		expect(result.details).toMatchObject({
			schema: "w3rt.capability.handshake.v1",
			protocol: {
				name: "acp-tools",
				handshakeTool: "w3rt_getCapabilityHandshake_v0",
				discoveryTool: "w3rt_getCapabilities_v0",
			},
			client: {
				name: "openclaw-agent",
				version: "0.1.0",
			},
			capabilityDigest: {
				chainCount: 4,
			},
			policyDigest: {
				evmTransfer: expect.objectContaining({
					mode: expect.any(String),
					enforceOn: expect.any(String),
					allowlistCount: expect.any(Number),
				}),
			},
			bootstrap: {
				schema: "w3rt.bootstrap.v1",
				target: "openclaw",
				policyStatus: expect.objectContaining({
					hardeningNeeded: true,
				}),
				startupSequence: expect.arrayContaining([
					expect.objectContaining({
						tool: "w3rt_getCapabilities_v0",
					}),
					expect.objectContaining({
						tool: "w3rt_getPolicy_v0",
					}),
					expect.objectContaining({
						tool: "w3rt_setPolicy_v0",
					}),
				]),
			},
			capabilities: expect.objectContaining({
				schema: "w3rt.capabilities.v1",
			}),
		});
	});

	it("returns handshake without embedded capabilities when disabled", async () => {
		setEvmTransferPolicy({
			mode: "allowlist",
			enforceOn: "mainnet_like",
			allowedRecipients: ["0x000000000000000000000000000000000000beef"],
			updatedBy: "meta.read.test.handshake.noembed",
		});
		const tool = getTool("w3rt_getCapabilityHandshake_v0");
		const result = await tool.execute("meta-4", {
			includeCapabilities: false,
			chain: "evm",
			executableOnly: true,
		});
		expect(result.details).toMatchObject({
			schema: "w3rt.capability.handshake.v1",
			query: {
				chain: "evm",
				executableOnly: true,
			},
			bootstrap: {
				policyStatus: expect.objectContaining({
					hardeningNeeded: false,
				}),
			},
			capabilities: undefined,
		});
	});
});
