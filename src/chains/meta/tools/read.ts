import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import type { ChainToolset } from "../../../core/types.js";
import {
	applyEvmTransferPolicyTemplate,
	getEvmTransferPolicy,
	getEvmTransferPolicyAuditLog,
	setEvmTransferPolicy,
} from "../../evm/policy.js";
import { createEvmToolset } from "../../evm/toolset.js";
import { createNearToolset } from "../../near/toolset.js";
import { createKaspaToolset } from "../../kaspa/toolset.js";
import { createSolanaWorkflowToolset } from "../../solana/workflow-toolset.js";
import { createSuiToolset } from "../../sui/toolset.js";

type SupportedChain = "solana" | "sui" | "near" | "evm" | "kaspa";
type RiskLevel = "low" | "medium" | "high";

type WorkflowCapability = {
	tool: string;
	description: string;
	intentTypes: string[];
	nlExamples: string[];
	execution: {
		executable: boolean;
		requiresSigner: boolean;
		requiresMainnetConfirmation: boolean;
		requiresConfirmToken: boolean;
		defaultRunMode: "analysis" | "simulate" | "execute";
		riskLevel: RiskLevel;
	};
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

type CapabilityQuery = {
	chain: SupportedChain | "all";
	includeExamples: boolean;
	includeToolNames: boolean;
	executableOnly: boolean;
	maxRisk: RiskLevel;
};

const CAPABILITY_SCHEMA = "w3rt.capabilities.v1";
const HANDSHAKE_SCHEMA = "w3rt.capability.handshake.v1";
const SERVER_NAME = "pi-chain-tools";
const SERVER_VERSION = "0.1.0";

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
				execution: {
					executable: true,
					requiresSigner: true,
					requiresMainnetConfirmation: true,
					requiresConfirmToken: true,
					defaultRunMode: "analysis",
					riskLevel: "medium",
				},
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
				nlExamples: [
					"把 0.01 SUI 换成 USDC，先模拟",
					"继续执行刚才这笔，确认主网执行",
				],
				execution: {
					executable: true,
					requiresSigner: true,
					requiresMainnetConfirmation: true,
					requiresConfirmToken: true,
					defaultRunMode: "analysis",
					riskLevel: "medium",
				},
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
				execution: {
					executable: true,
					requiresSigner: true,
					requiresMainnetConfirmation: true,
					requiresConfirmToken: true,
					defaultRunMode: "analysis",
					riskLevel: "medium",
				},
			},
		],
	},
	{
		chain: "kaspa",
		status: "beta",
		highlights: [
			"Kaspa address tag lookup for identity/annotation enrichment",
			"Kaspa address transaction history (including pagination)",
			"Kaspa transaction lookup, output lookup, and acceptance-data lookup",
			"Kaspa transaction submission for merchant/payment and interactive game flows",
		],
		signer: {
			autoSources: [],
			envKeys: [],
		},
		workflows: [
			{
				tool: "kaspa_getTransaction",
			description:
					"Read Kaspa transaction details by id for settlement verification or analytics.",
				intentTypes: ["kaspa.transaction.get"],
				nlExamples: [
					"根据 tx id 查一笔 Kaspa 交易明细",
					"查询某笔 Kaspa 交易的完整链上详情",
				],
				execution: {
					executable: false,
					requiresSigner: false,
					requiresMainnetConfirmation: false,
					requiresConfirmToken: false,
					defaultRunMode: "analysis",
					riskLevel: "low",
				},
			},
			{
				tool: "kaspa_getTransactionOutput",
				description:
					"Read one Kaspa transaction output by output index for real-time proofs and UTXO tracing.",
				intentTypes: ["kaspa.transaction.output"],
				nlExamples: [
					"查这笔交易第 0 个输出",
					"读取 Kaspa tx 的某个 output",
				],
				execution: {
					executable: false,
					requiresSigner: false,
					requiresMainnetConfirmation: false,
					requiresConfirmToken: false,
					defaultRunMode: "analysis",
					riskLevel: "low",
				},
			},
			{
				tool: "kaspa_getTransactionAcceptance",
				description:
					"Read Kaspa transaction acceptance metadata for a given tx id set.",
				intentTypes: ["kaspa.transaction.acceptance"],
				nlExamples: [
					"查一组 tx 的确认状态",
					"查询这笔交易是否已被接受",
				],
				execution: {
					executable: false,
					requiresSigner: false,
					requiresMainnetConfirmation: false,
					requiresConfirmToken: false,
					defaultRunMode: "analysis",
					riskLevel: "low",
				},
			},
			{
				tool: "kaspa_submitTransaction",
				description:
					"Submit a pre-signed Kaspa transaction (raw tx string or full API payload). Mainnet requires confirmMainnet=true.",
				intentTypes: ["kaspa.transaction.submit"],
				nlExamples: [
					"提交一笔已经签名好的 Kaspa 交易",
					"主网执行 Kaspa 提交交易（确认后）",
				],
				execution: {
					executable: true,
					requiresSigner: false,
					requiresMainnetConfirmation: true,
					requiresConfirmToken: false,
					defaultRunMode: "analysis",
					riskLevel: "medium",
				},
			},
			{
				tool: "kaspa_getAddressTag",
				description: "Read Kaspa address tag metadata for enriched analysis and monitoring.",
				intentTypes: ["kaspa.address.tag"],
				nlExamples: [
					"查一下 kaspa 地址的标签信息",
					"读取某个 kaspa 地址的身份标签",
				],
				execution: {
					executable: false,
					requiresSigner: false,
					requiresMainnetConfirmation: false,
					requiresConfirmToken: false,
					defaultRunMode: "analysis",
					riskLevel: "low",
				},
			},
			{
				tool: "kaspa_getAddressTransactions",
				description:
					"Read recent Kaspa transactions and pagination metadata for an address.",
				intentTypes: ["kaspa.address.transactions"],
				nlExamples: [
					"查一下这个 kaspa 地址最近的交易",
					"分页查看某个地址的 Kaspa 交易历史",
				],
				execution: {
					executable: false,
					requiresSigner: false,
					requiresMainnetConfirmation: false,
					requiresConfirmToken: false,
					defaultRunMode: "analysis",
					riskLevel: "low",
				},
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
			"transparent settlement transfers (native/ERC20)",
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
				execution: {
					executable: true,
					requiresSigner: true,
					requiresMainnetConfirmation: true,
					requiresConfirmToken: true,
					defaultRunMode: "analysis",
					riskLevel: "high",
				},
			},
			{
				tool: "w3rt_run_evm_transfer_workflow_v0",
				description:
					"EVM transfer workflow for native/ERC20 transfers with analysis -> simulate -> execute.",
				intentTypes: ["evm.transfer.native", "evm.transfer.erc20"],
				nlExamples: [
					"给 0x... 转 0.001 MATIC，先模拟",
					"把 tokenAddress=0x... 的 1000000 raw 转给 0x...，先分析",
				],
				execution: {
					executable: true,
					requiresSigner: true,
					requiresMainnetConfirmation: true,
					requiresConfirmToken: true,
					defaultRunMode: "analysis",
					riskLevel: "medium",
				},
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

function collectMetaToolsets(): ChainToolset[] {
	return [
		createSolanaWorkflowToolset(),
		createSuiToolset(),
		createNearToolset(),
		createKaspaToolset(),
		createEvmToolset(),
	];
}

function collectToolsetSummaries(): ToolsetSummary[] {
	return collectMetaToolsets().map(toolsetSummaryFrom);
}

function discoverWorkflowTools(toolset: ChainToolset): Set<string> {
	const tools = new Set<string>();
	for (const group of toolset.groups) {
		if (group.name !== "execute") {
			continue;
		}
		for (const tool of group.tools) {
			if (tool.name.startsWith("w3rt_run_")) {
				tools.add(tool.name);
			}
		}
	}
	return tools;
}

function withAutoDiscoveredWorkflowMetadata(
	baseCapabilities: ChainCapability[],
	toolsets: ChainToolset[],
): ChainCapability[] {
	const toolsetByChain = new Map<string, ChainToolset>(
		toolsets.map((entry) => [entry.chain, entry]),
	);
	const FALLBACK_EXECUTION = {
		executable: true,
		requiresSigner: true,
		requiresMainnetConfirmation: true,
		requiresConfirmToken: true,
		defaultRunMode: "analysis" as const,
		riskLevel: "medium" as const,
	};
	return baseCapabilities.map((chain) => {
		const toolset = toolsetByChain.get(chain.chain);
		if (!toolset) {
			return chain;
		}
		const available = discoverWorkflowTools(toolset);
		if (available.size === 0) {
			return chain;
		}
		const baseline = chain.workflows.filter((workflow) =>
			available.has(workflow.tool),
		);
		const existing = new Set(baseline.map((workflow) => workflow.tool));
		const discovered = [...available]
			.filter((name) => !existing.has(name))
			.map((name) => ({
				tool: name,
				description: `Workflow tool discovered at runtime (${name}). Intent list is not statically described yet.`,
				intentTypes: [],
				nlExamples: [],
				execution: FALLBACK_EXECUTION,
			}));
		return {
			...chain,
			workflows: [...baseline, ...discovered],
		};
	});
}

function parseSupportedChain(value?: string): SupportedChain | "all" {
	if (
		value === "solana" ||
		value === "sui" ||
		value === "near" ||
		value === "evm" ||
		value === "kaspa"
	) {
		return value;
	}
	return "all";
}

function parseRiskLevel(value?: string): RiskLevel {
	if (value === "low" || value === "medium" || value === "high") return value;
	return "high";
}

function riskRank(level: RiskLevel): number {
	if (level === "low") return 1;
	if (level === "medium") return 2;
	return 3;
}

function passesRiskFilter(level: RiskLevel, maxRisk: RiskLevel): boolean {
	return riskRank(level) <= riskRank(maxRisk);
}

function parseCapabilityQuery(params: {
	chain?: string;
	includeExamples?: boolean;
	includeToolNames?: boolean;
	executableOnly?: boolean;
	maxRisk?: string;
}): CapabilityQuery {
	return {
		chain: parseSupportedChain(params.chain),
		includeExamples: params.includeExamples !== false,
		includeToolNames: params.includeToolNames !== false,
		executableOnly: params.executableOnly === true,
		maxRisk: parseRiskLevel(params.maxRisk),
	};
}

function filterCapabilities(query: CapabilityQuery): ChainCapability[] {
	const chainScoped =
		query.chain === "all"
			? CHAIN_CAPABILITIES
			: CHAIN_CAPABILITIES.filter((entry) => entry.chain === query.chain);
	const toolsets = collectMetaToolsets();
	const discovered = withAutoDiscoveredWorkflowMetadata(chainScoped, toolsets);
	return discovered
		.map((chain) => ({
			...chain,
			workflows: chain.workflows.filter((workflow) => {
				if (!passesRiskFilter(workflow.execution.riskLevel, query.maxRisk)) {
					return false;
				}
				if (query.executableOnly && !workflow.execution.executable) {
					return false;
				}
				return true;
			}),
		}))
		.filter((chain) => chain.workflows.length > 0);
}

function summarizeCapabilitiesText(params: {
	capabilities: ChainCapability[];
	toolsets: ToolsetSummary[];
	query: CapabilityQuery;
}): string {
	const lines = [
		`ACP capability catalog: chains=${params.capabilities.length} maxRisk=${params.query.maxRisk} executableOnly=${params.query.executableOnly}`,
		"This extension can be exposed to OpenClaw/ACP as tool-based agent capabilities.",
	];
	if (params.capabilities.length === 0) {
		lines.push("No capabilities matched current filters.");
		return lines.join("\n");
	}
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
			lines.push(
				`   execution: risk=${workflow.execution.riskLevel} signer=${workflow.execution.requiresSigner} confirmMainnet=${workflow.execution.requiresMainnetConfirmation} confirmToken=${workflow.execution.requiresConfirmToken}`,
			);
			if (params.query.includeExamples) {
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
			if (params.query.includeToolNames) {
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

function buildCapabilityDetails(query: CapabilityQuery) {
	const capabilities = filterCapabilities(query);
	const toolsets = collectToolsetSummaries()
		.filter((entry) =>
			capabilities.some((chainEntry) => chainEntry.chain === entry.chain),
		)
		.map((toolset) => ({
			chain: toolset.chain,
			groups: toolset.groups.map((group) => ({
				name: group.name,
				toolCount: group.toolCount,
				tools: query.includeToolNames ? group.tools : [],
			})),
		}));

	const publicChains = capabilities.map((entry) => ({
		...entry,
		workflows: entry.workflows.map((workflow) => ({
			...workflow,
			nlExamples: query.includeExamples ? workflow.nlExamples : [],
		})),
	}));

	const digest = {
		chainCount: capabilities.length,
		workflowCount: capabilities.reduce(
			(total, chain) => total + chain.workflows.length,
			0,
		),
		intentCount: capabilities.reduce(
			(total, chain) =>
				total +
				chain.workflows.reduce(
					(workflowTotal, workflow) =>
						workflowTotal + workflow.intentTypes.length,
					0,
				),
			0,
		),
		chains: capabilities.map((entry) => entry.chain),
	};

	return {
		capabilities,
		toolsets,
		publicChains,
		digest,
		query,
	};
}

function capabilityDetailsPayload(
	catalog: ReturnType<typeof buildCapabilityDetails>,
) {
	return {
		schema: CAPABILITY_SCHEMA,
		generatedAt: new Date().toISOString(),
		integration: {
			mode: "acp-tools",
			target: ["pi", "openclaw"],
			exposable: true,
		},
		query: catalog.query,
		digest: catalog.digest,
		chains: catalog.publicChains,
		toolsets: catalog.toolsets,
	};
}

function handshakeText(params: {
	clientName: string | null;
	digest: ReturnType<typeof buildCapabilityDetails>["digest"];
	includesCapabilities: boolean;
}): string {
	const clientText = params.clientName ? ` client=${params.clientName}` : "";
	return `ACP handshake ready:${clientText} server=${SERVER_NAME}@${SERVER_VERSION} chains=${params.digest.chainCount} workflows=${params.digest.workflowCount} intents=${params.digest.intentCount} includeCapabilities=${params.includesCapabilities}`;
}

function summarizeTransferPolicyText(params: {
	mode: string;
	enforceOn: string;
	allowedRecipients: string[];
	version: number;
}): string {
	return `Transfer policy: mode=${params.mode} enforceOn=${params.enforceOn} allowlist=${params.allowedRecipients.length} version=${params.version}`;
}

function summarizeTransferPolicyAuditText(
	records: ReturnType<typeof getEvmTransferPolicyAuditLog>,
): string {
	if (records.length === 0) {
		return "Transfer policy audit: no records.";
	}
	const lines = [
		`Transfer policy audit: ${records.length} record(s), latest first.`,
	];
	for (const [index, record] of records.entries()) {
		lines.push(
			`${index + 1}. action=${record.action} template=${record.template ?? "(none)"} actor=${record.actor ?? "(unknown)"} at=${record.at}`,
		);
		lines.push(
			`   before: mode=${record.before.mode} enforceOn=${record.before.enforceOn} allowlist=${record.before.allowedRecipients.length} version=${record.before.version}`,
		);
		lines.push(
			`   after: mode=${record.after.mode} enforceOn=${record.after.enforceOn} allowlist=${record.after.allowedRecipients.length} version=${record.after.version}`,
		);
	}
	return lines.join("\n");
}

function buildHandshakeBootstrap(params: {
	clientName: string | null;
	query: CapabilityQuery;
	transferPolicy: ReturnType<typeof getEvmTransferPolicy>;
}): {
	schema: "w3rt.bootstrap.v1";
	target: "openclaw";
	recommendedCapabilityFilter: {
		chain: CapabilityQuery["chain"];
		executableOnly: boolean;
		maxRisk: RiskLevel;
	};
	policyStatus: {
		evmTransferMode: string;
		evmTransferEnforceOn: string;
		evmTransferAllowlistCount: number;
		hardeningNeeded: boolean;
	};
	startupSequence: Array<{
		order: number;
		tool: string;
		purpose: string;
		required: boolean;
		params: Record<string, unknown>;
	}>;
	firstPrompts: string[];
	executionNotes: string[];
} {
	const hardeningNeeded =
		params.transferPolicy.mode === "open" ||
		(params.transferPolicy.mode === "allowlist" &&
			params.transferPolicy.allowedRecipients.length === 0);
	const clientName = params.clientName || "openclaw-agent";
	const startupSequence: Array<{
		order: number;
		tool: string;
		purpose: string;
		required: boolean;
		params: Record<string, unknown>;
	}> = [
		{
			order: 1,
			tool: "w3rt_getCapabilities_v0",
			purpose: "Load executable capability catalog for routing.",
			required: true,
			params: {
				chain: params.query.chain,
				executableOnly: true,
				maxRisk: params.query.maxRisk,
				includeExamples: true,
				includeToolNames: false,
			},
		},
		{
			order: 2,
			tool: "w3rt_getPolicy_v0",
			purpose: "Read runtime transfer policy before enabling execute paths.",
			required: true,
			params: {
				scope: "evm.transfer",
			},
		},
	];
	if (hardeningNeeded) {
		startupSequence.push({
			order: 3,
			tool: "w3rt_setPolicy_v0",
			purpose:
				"Harden transfer policy to allowlist mode before production execution.",
			required: false,
			params: {
				scope: "evm.transfer",
				template: "production_safe",
				note: "bootstrap hardening template",
				updatedBy: clientName,
			},
		});
	}
	const orderBase = startupSequence.length + 1;
	startupSequence.push(
		{
			order: orderBase,
			tool: "w3rt_run_evm_polymarket_workflow_v0",
			purpose: "Run first safe analysis/simulate cycle before execute.",
			required: true,
			params: {
				runMode: "analysis",
				network: "polygon",
				intentType: "evm.polymarket.btc5m.trade",
				stakeUsd: 20,
			},
		},
		{
			order: orderBase + 1,
			tool: "w3rt_run_evm_transfer_workflow_v0",
			purpose: "Run transfer analysis flow with confirm token safety gate.",
			required: false,
			params: {
				runMode: "analysis",
				network: "polygon",
				intentType: "evm.transfer.native",
				toAddress: "0x000000000000000000000000000000000000dEaD",
				amountNative: 0.001,
			},
		},
	);
	return {
		schema: "w3rt.bootstrap.v1",
		target: "openclaw",
		recommendedCapabilityFilter: {
			chain: params.query.chain,
			executableOnly: true,
			maxRisk: params.query.maxRisk,
		},
		policyStatus: {
			evmTransferMode: params.transferPolicy.mode,
			evmTransferEnforceOn: params.transferPolicy.enforceOn,
			evmTransferAllowlistCount: params.transferPolicy.allowedRecipients.length,
			hardeningNeeded,
		},
		startupSequence,
		firstPrompts: [
			"帮我分析 BTC 5m 市场，建议买涨还是买跌",
			"把 0.001 MATIC 转到 0x...，先模拟",
			"继续执行刚才这笔，确认主网执行",
		],
		executionNotes: [
			"Execute paths are guarded by confirmMainnet + confirmToken in workflow tools.",
			"For transfers, policy allowlist should be configured before production use.",
		],
	};
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
						Type.Literal("kaspa"),
						Type.Literal("evm"),
					]),
				),
				includeExamples: Type.Optional(Type.Boolean()),
				includeToolNames: Type.Optional(Type.Boolean()),
				executableOnly: Type.Optional(Type.Boolean()),
				maxRisk: Type.Optional(
					Type.Union([
						Type.Literal("low"),
						Type.Literal("medium"),
						Type.Literal("high"),
					]),
				),
			}),
			async execute(_toolCallId, params) {
				const query = parseCapabilityQuery(params);
				const catalog = buildCapabilityDetails(query);
				const details = capabilityDetailsPayload(catalog);
				return {
					content: [
						{
							type: "text",
							text: summarizeCapabilitiesText({
								capabilities: catalog.capabilities,
								toolsets: catalog.toolsets,
								query,
							}),
						},
					],
					details,
				};
			},
		}),
		defineTool({
			name: "w3rt_getCapabilityHandshake_v0",
			label: "w3rt Get Capability Handshake v0",
			description:
				"ACP handshake/negotiation payload with protocol metadata and optional embedded capability catalog.",
			parameters: Type.Object({
				clientName: Type.Optional(Type.String()),
				clientVersion: Type.Optional(Type.String()),
				chain: Type.Optional(
					Type.Union([
						Type.Literal("all"),
						Type.Literal("solana"),
						Type.Literal("sui"),
						Type.Literal("near"),
						Type.Literal("kaspa"),
						Type.Literal("evm"),
					]),
				),
				includeCapabilities: Type.Optional(Type.Boolean()),
				includeExamples: Type.Optional(Type.Boolean()),
				includeToolNames: Type.Optional(Type.Boolean()),
				executableOnly: Type.Optional(Type.Boolean()),
				maxRisk: Type.Optional(
					Type.Union([
						Type.Literal("low"),
						Type.Literal("medium"),
						Type.Literal("high"),
					]),
				),
			}),
			async execute(_toolCallId, params) {
				const query = parseCapabilityQuery(params);
				const includeCapabilities = params.includeCapabilities !== false;
				const catalog = buildCapabilityDetails(query);
				const transferPolicy = getEvmTransferPolicy();
				const capabilities = includeCapabilities
					? capabilityDetailsPayload(catalog)
					: undefined;
				const bootstrap = buildHandshakeBootstrap({
					clientName: params.clientName?.trim() || null,
					query,
					transferPolicy,
				});
				const details = {
					schema: HANDSHAKE_SCHEMA,
					generatedAt: new Date().toISOString(),
					protocol: {
						name: "acp-tools",
						version: "v0",
						discoveryTool: "w3rt_getCapabilities_v0",
						handshakeTool: "w3rt_getCapabilityHandshake_v0",
						summarySchema: "w3rt.workflow.summary.v1",
						capabilitiesSchema: CAPABILITY_SCHEMA,
					},
					server: {
						name: SERVER_NAME,
						version: SERVER_VERSION,
						targets: ["pi", "openclaw"],
					},
					client: {
						name: params.clientName?.trim() || null,
						version: params.clientVersion?.trim() || null,
					},
					query,
					capabilityDigest: catalog.digest,
					policyDigest: {
						evmTransfer: {
							mode: transferPolicy.mode,
							enforceOn: transferPolicy.enforceOn,
							allowlistCount: transferPolicy.allowedRecipients.length,
							version: transferPolicy.version,
						},
					},
					bootstrap,
					capabilities,
				};
				return {
					content: [
						{
							type: "text",
							text: handshakeText({
								clientName: params.clientName?.trim() || null,
								digest: catalog.digest,
								includesCapabilities: includeCapabilities,
							}),
						},
					],
					details,
				};
			},
		}),
		defineTool({
			name: "w3rt_getPolicy_v0",
			label: "w3rt Get Policy v0",
			description:
				"Get runtime execution policy used by workflow/execute tools (currently EVM transfer policy).",
			parameters: Type.Object({
				scope: Type.Optional(Type.Literal("evm.transfer")),
			}),
			async execute(_toolCallId, _params) {
				const transferPolicy = getEvmTransferPolicy();
				return {
					content: [
						{
							type: "text",
							text: summarizeTransferPolicyText(transferPolicy),
						},
					],
					details: {
						schema: "w3rt.policy.v1",
						scope: "evm.transfer",
						policy: transferPolicy,
					},
				};
			},
		}),
		defineTool({
			name: "w3rt_setPolicy_v0",
			label: "w3rt Set Policy v0",
			description:
				"Update runtime execution policy (currently EVM transfer policy).",
			parameters: Type.Object({
				scope: Type.Optional(Type.Literal("evm.transfer")),
				template: Type.Optional(
					Type.Union([
						Type.Literal("production_safe"),
						Type.Literal("open_dev"),
					]),
				),
				mode: Type.Optional(
					Type.Union([Type.Literal("open"), Type.Literal("allowlist")]),
				),
				enforceOn: Type.Optional(
					Type.Union([Type.Literal("mainnet_like"), Type.Literal("all")]),
				),
				allowedRecipients: Type.Optional(
					Type.Array(Type.String({ minLength: 42, maxLength: 42 }), {
						maxItems: 200,
					}),
				),
				clearRecipients: Type.Optional(Type.Boolean()),
				updatedBy: Type.Optional(Type.String()),
				note: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const next = params.template
					? applyEvmTransferPolicyTemplate({
							template: params.template,
							updatedBy: params.updatedBy,
							note: params.note,
						})
					: setEvmTransferPolicy({
							mode: params.mode,
							enforceOn: params.enforceOn,
							allowedRecipients: params.allowedRecipients,
							clearRecipients: params.clearRecipients,
							updatedBy: params.updatedBy,
							note: params.note,
						});
				return {
					content: [
						{
							type: "text",
							text:
								params.template != null
									? `Policy template applied (${params.template}): ${summarizeTransferPolicyText(next)}`
									: `Policy updated: ${summarizeTransferPolicyText(next)}`,
						},
					],
					details: {
						schema: "w3rt.policy.v1",
						scope: "evm.transfer",
						policy: next,
						template: params.template ?? null,
					},
				};
			},
		}),
		defineTool({
			name: "w3rt_getPolicyAudit_v0",
			label: "w3rt Get Policy Audit v0",
			description:
				"Read runtime policy audit log (currently EVM transfer policy updates/templates).",
			parameters: Type.Object({
				scope: Type.Optional(Type.Literal("evm.transfer")),
				limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
			}),
			async execute(_toolCallId, params) {
				const records = getEvmTransferPolicyAuditLog({
					limit: params.limit,
				});
				return {
					content: [
						{
							type: "text",
							text: summarizeTransferPolicyAuditText(records),
						},
					],
					details: {
						schema: "w3rt.policy.audit.v1",
						scope: "evm.transfer",
						records,
					},
				};
			},
		}),
	];
}
