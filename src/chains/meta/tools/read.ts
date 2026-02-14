import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import type { ChainToolset } from "../../../core/types.js";
import { createEvmToolset } from "../../evm/toolset.js";
import { createNearToolset } from "../../near/toolset.js";
import { createSolanaWorkflowToolset } from "../../solana/workflow-toolset.js";
import { createSuiToolset } from "../../sui/toolset.js";

type SupportedChain = "solana" | "sui" | "near" | "evm";

type WorkflowCapability = {
	tool: string;
	description: string;
	intentTypes: string[];
	nlExamples: string[];
};

type ChainCapability = {
	chain: SupportedChain;
	status: "stable" | "beta";
	highlights: string[];
	signer: {
		autoSources: string[];
		envKeys: string[];
	};
	workflows: WorkflowCapability[];
};

type ToolGroupSummary = {
	name: string;
	toolCount: number;
	tools: string[];
};

type ToolsetSummary = {
	chain: string;
	groups: ToolGroupSummary[];
};

const CHAIN_CAPABILITIES: ChainCapability[] = [
	{
		chain: "solana",
		status: "stable",
		highlights: [
			"SOL/SPL balance + portfolio + DeFi positions",
			"Jupiter/Orca/Meteora swap routing",
			"SPL transfer + stake delegate/deactivate/withdraw",
		],
		signer: {
			autoSources: [
				"SOLANA_PRIVATE_KEY",
				"SOLANA_KEYPAIR_PATH",
				"local Solana keypair file",
			],
			envKeys: ["SOLANA_PRIVATE_KEY", "SOLANA_KEYPAIR_PATH"],
		},
		workflows: [
			{
				tool: "w3rt_run_workflow_v0",
				description:
					"Unified Solana workflow for transfer/swap/stake with analysis -> simulate -> execute.",
				intentTypes: [
					"solana.transfer.sol",
					"solana.transfer.spl",
					"solana.swap.jupiter",
					"solana.lp.orca.open",
					"solana.lp.orca.close",
					"solana.lp.meteora.add",
					"solana.lp.meteora.remove",
				],
				nlExamples: [
					"把 0.01 SOL 转给 xxx，先模拟",
					"把 0.01 SOL 换成 USDC，先分析",
				],
			},
		],
	},
	{
		chain: "sui",
		status: "stable",
		highlights: [
			"SUI + coinType portfolio reading",
			"Cetus swap/LP/farms workflows",
			"StableLayer mint/burn workflows",
		],
		signer: {
			autoSources: [
				"SUI_PRIVATE_KEY",
				"SUI_KEYSTORE_PATH + SUI_CLIENT_CONFIG_PATH",
				"local Sui CLI keystore + active address",
			],
			envKeys: [
				"SUI_PRIVATE_KEY",
				"SUI_KEYSTORE_PATH",
				"SUI_CLIENT_CONFIG_PATH",
			],
		},
		workflows: [
			{
				tool: "w3rt_run_sui_defi_workflow_v0",
				description:
					"Unified Sui DeFi workflow router for swap/LP/farms/stable-layer intents.",
				intentTypes: [
					"sui.swap.cetus",
					"sui.lp.cetus.add",
					"sui.lp.cetus.remove",
					"sui.farms.cetus.stake",
					"sui.stablelayer.mint",
				],
				nlExamples: ["把 0.01 SUI 换成 USDC，先模拟", "取消刚才这笔，先分析"],
			},
		],
	},
	{
		chain: "near",
		status: "stable",
		highlights: [
			"NEAR/FT portfolio + USD valuation",
			"Ref swap + LP add/remove",
			"Burrow supply/borrow/repay/withdraw",
		],
		signer: {
			autoSources: [
				"privateKey parameter",
				"NEAR_PRIVATE_KEY",
				"~/.near-credentials/<network>/<account>.json",
			],
			envKeys: [
				"NEAR_PRIVATE_KEY",
				"NEAR_ACCOUNT_ID",
				"NEAR_WALLET_ACCOUNT_ID",
			],
		},
		workflows: [
			{
				tool: "w3rt_run_near_workflow_v0",
				description:
					"Unified NEAR workflow with transfers, Ref, Intents, and Burrow lending intents.",
				intentTypes: [
					"near.transfer.near",
					"near.swap.ref",
					"near.lp.ref.add",
					"near.lp.ref.remove",
					"near.swap.intents",
					"near.lend.burrow.supply",
				],
				nlExamples: [
					"把 0.01 NEAR 换成 USDC，先模拟",
					"继续执行刚才这笔，确认主网执行",
				],
			},
		],
	},
	{
		chain: "evm",
		status: "beta",
		highlights: [
			"Polymarket BTC 5m market discovery",
			"AI-assisted side recommendation",
			"order place/list/cancel lifecycle",
		],
		signer: {
			autoSources: [
				"fromPrivateKey parameter",
				"POLYMARKET_PRIVATE_KEY + POLYMARKET_FUNDER",
			],
			envKeys: [
				"POLYMARKET_PRIVATE_KEY",
				"POLYMARKET_FUNDER",
				"POLYMARKET_API_KEY",
				"POLYMARKET_API_SECRET",
				"POLYMARKET_API_PASSPHRASE",
			],
		},
		workflows: [
			{
				tool: "w3rt_run_evm_polymarket_workflow_v0",
				description:
					"Polymarket BTC 5m workflow for trade/cancel with analysis -> simulate -> execute.",
				intentTypes: [
					"evm.polymarket.btc5m.trade",
					"evm.polymarket.btc5m.cancel",
				],
				nlExamples: [
					"买 BTC 5分钟涨 20 USDC，先模拟",
					"取消我 BTC 5m 所有挂单，先模拟",
				],
			},
		],
	},
];

function toolsetSummaryFrom(toolset: ChainToolset): ToolsetSummary {
	return {
		chain: toolset.chain,
		groups: toolset.groups.map((group) => ({
			name: group.name,
			toolCount: group.tools.length,
			tools: group.tools.map((tool) => tool.name),
		})),
	};
}

function collectToolsetSummaries(): ToolsetSummary[] {
	return [
		toolsetSummaryFrom(createSolanaWorkflowToolset()),
		toolsetSummaryFrom(createSuiToolset()),
		toolsetSummaryFrom(createNearToolset()),
		toolsetSummaryFrom(createEvmToolset()),
	];
}

function parseSupportedChain(value?: string): SupportedChain | "all" {
	if (
		value === "solana" ||
		value === "sui" ||
		value === "near" ||
		value === "evm"
	) {
		return value;
	}
	return "all";
}

function summarizeCapabilitiesText(params: {
	capabilities: ChainCapability[];
	toolsets: ToolsetSummary[];
	includeExamples: boolean;
	includeToolNames: boolean;
}): string {
	const lines = [
		`ACP capability catalog: chains=${params.capabilities.length}`,
		"This extension can be exposed to OpenClaw/ACP as tool-based agent capabilities.",
	];
	for (const [index, chain] of params.capabilities.entries()) {
		const workflowCount = chain.workflows.length;
		lines.push(
			`${index + 1}. ${chain.chain} (${chain.status}) workflows=${workflowCount}`,
		);
		lines.push(`   highlights: ${chain.highlights.join("; ")}`);
		lines.push(`   signer: ${chain.signer.autoSources.join(" | ")}`);
		for (const workflow of chain.workflows) {
			lines.push(`   workflow: ${workflow.tool} (${workflow.description})`);
			lines.push(`   intents: ${workflow.intentTypes.join(", ")}`);
			if (params.includeExamples) {
				lines.push(`   examples: ${workflow.nlExamples.join(" / ")}`);
			}
		}
		const summary = params.toolsets.find(
			(entry) => entry.chain === chain.chain,
		);
		if (summary) {
			const toolCount = summary.groups.reduce(
				(total, group) => total + group.toolCount,
				0,
			);
			lines.push(`   tools: ${toolCount} total`);
			if (params.includeToolNames) {
				for (const group of summary.groups) {
					lines.push(
						`   ${group.name}: ${group.tools.length ? group.tools.join(", ") : "(none)"}`,
					);
				}
			}
		}
	}
	lines.push(
		"Mainnet execute remains guarded by confirmMainnet=true + confirmToken in workflow tools.",
	);
	return lines.join("\n");
}

export function createMetaReadTools() {
	return [
		defineTool({
			name: "w3rt_getCapabilities_v0",
			label: "w3rt Get Capabilities v0",
			description:
				"Return ACP/OpenClaw-facing capability catalog: supported chains, workflows, signer requirements, and NL examples.",
			parameters: Type.Object({
				chain: Type.Optional(
					Type.Union([
						Type.Literal("all"),
						Type.Literal("solana"),
						Type.Literal("sui"),
						Type.Literal("near"),
						Type.Literal("evm"),
					]),
				),
				includeExamples: Type.Optional(Type.Boolean()),
				includeToolNames: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const chain = parseSupportedChain(params.chain);
				const includeExamples = params.includeExamples !== false;
				const includeToolNames = params.includeToolNames !== false;
				const capabilities =
					chain === "all"
						? CHAIN_CAPABILITIES
						: CHAIN_CAPABILITIES.filter((entry) => entry.chain === chain);
				const toolsets = collectToolsetSummaries().filter((entry) =>
					capabilities.some((chainEntry) => chainEntry.chain === entry.chain),
				);
				const details = {
					schema: "w3rt.capabilities.v1",
					generatedAt: new Date().toISOString(),
					integration: {
						mode: "acp-tools",
						target: ["pi", "openclaw"],
						exposable: true,
					},
					query: {
						chain,
						includeExamples,
						includeToolNames,
					},
					chains: capabilities.map((entry) => ({
						...entry,
						workflows: entry.workflows.map((workflow) => ({
							...workflow,
							nlExamples: includeExamples ? workflow.nlExamples : [],
						})),
					})),
					toolsets: toolsets.map((toolset) => ({
						chain: toolset.chain,
						groups: toolset.groups.map((group) => ({
							name: group.name,
							toolCount: group.toolCount,
							tools: includeToolNames ? group.tools : [],
						})),
					})),
				};
				return {
					content: [
						{
							type: "text",
							text: summarizeCapabilitiesText({
								capabilities,
								toolsets,
								includeExamples,
								includeToolNames,
							}),
						},
					],
					details,
				};
			},
		}),
	];
}
