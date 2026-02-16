/**
 * Privy Policy Configuration — recommended server-side wallet policies.
 * Also exports an MCP read tool `evm_privyPolicyRecommendation` for operator auditing.
 *
 * These are NOT enforced in code (that's the whole point — they're enforced
 * in Privy's MPC enclave, unforgeable by the Agent). This module provides:
 *
 * 1. Recommended policy templates as JSON for Privy dashboard/API
 * 2. An MCP tool for operators/OpenClaw to inspect recommended policy
 *
 * Dual-layer security model:
 * - Layer 1 (code): dryRun/confirmMainnet gates, LTV bounds — bypassable by bugs
 * - Layer 2 (Privy enclave): contract allowlist, spend limits — NOT bypassable
 *
 * How to apply:
 * - Privy Dashboard → Wallet → Policies → Create Policy
 * - Or via Privy API: POST /api/v1/wallets/{walletId}/policies
 * - Attach recommended policy JSON from this module
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { EVM_TOOL_PREFIX } from "../runtime.js";

// ---------------------------------------------------------------------------
// Venus contract addresses (BSC mainnet)
// ---------------------------------------------------------------------------

const VENUS_CONTRACTS = {
	comptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384",
	vBNB: "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
	vUSDC: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
	vUSDT: "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
	vBTCB: "0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B",
	vETH: "0xf508fCD89b8bd15579dc79A6827cB4686A3592c8",
} as const;

const BSC_TOKEN_CONTRACTS = {
	USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
	USDT: "0x55d398326f99059fF775485246999027B3197955",
	WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
	BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
} as const;

/** LI.FI Diamond contract (multi-chain router). */
const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE" as const;

// ---------------------------------------------------------------------------
// Policy template types
// ---------------------------------------------------------------------------

export type PrivyPolicyRule = {
	type: "contract_allowlist" | "spend_limit" | "chain_restriction";
	description: string;
	config: Record<string, unknown>;
};

export type PrivyPolicyTemplate = {
	name: string;
	description: string;
	chainId: number;
	caip2: string;
	rules: PrivyPolicyRule[];
};

// ---------------------------------------------------------------------------
// Recommended policy templates
// ---------------------------------------------------------------------------

/**
 * Venus-only BSC policy: Agent wallet can ONLY interact with
 * Venus Protocol contracts + ERC-20 token contracts for approvals.
 * No arbitrary contract calls, no token transfers to unknown addresses.
 */
export function getVenusBscPolicy(): PrivyPolicyTemplate {
	const allowedContracts = [
		...Object.values(VENUS_CONTRACTS),
		...Object.values(BSC_TOKEN_CONTRACTS),
	];

	return {
		name: "venus-bsc-agent",
		description:
			"BorrowBot Venus-only BSC policy. Restricts wallet to Venus Protocol + BSC token contracts only.",
		chainId: 56,
		caip2: "eip155:56",
		rules: [
			{
				type: "contract_allowlist",
				description:
					"Only allow calls to Venus markets, Comptroller, and BSC tokens",
				config: {
					allowedAddresses: allowedContracts,
				},
			},
			{
				type: "chain_restriction",
				description: "Only allow transactions on BSC mainnet",
				config: {
					allowedChains: ["eip155:56"],
				},
			},
		],
	};
}

/**
 * Venus + LI.FI BSC policy: Same as Venus-only but also allows
 * LI.FI Diamond contract for cross-chain bridge operations.
 */
export function getVenusLifiBscPolicy(): PrivyPolicyTemplate {
	const allowedContracts = [
		...Object.values(VENUS_CONTRACTS),
		...Object.values(BSC_TOKEN_CONTRACTS),
		LIFI_DIAMOND,
	];

	return {
		name: "venus-lifi-bsc-agent",
		description:
			"BorrowBot Venus + LI.FI BSC policy. Venus lending + cross-chain bridge.",
		chainId: 56,
		caip2: "eip155:56",
		rules: [
			{
				type: "contract_allowlist",
				description:
					"Only allow calls to Venus markets, Comptroller, BSC tokens, and LI.FI Diamond",
				config: {
					allowedAddresses: allowedContracts,
				},
			},
			{
				type: "spend_limit",
				description:
					"Daily spend limit per token (recommended: configure based on position size)",
				config: {
					dailyLimitUsd: 10_000,
					perTransactionLimitUsd: 5_000,
				},
			},
		],
	};
}

/**
 * Multi-chain agent policy: allows Venus (BSC) + LI.FI (any supported chain).
 */
export function getMultiChainAgentPolicy(): PrivyPolicyTemplate[] {
	return [
		getVenusLifiBscPolicy(),
		{
			name: "lifi-multichain-agent",
			description:
				"LI.FI Diamond allowlist for cross-chain bridges (any EVM chain).",
			chainId: 0, // applies to all chains
			caip2: "eip155:*",
			rules: [
				{
					type: "contract_allowlist",
					description: "LI.FI Diamond only",
					config: {
						allowedAddresses: [LIFI_DIAMOND],
					},
				},
			],
		},
	];
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable summary of the recommended Privy policy.
 * Intended for operator review, NOT for enforcement.
 */
export function getPrivyPolicySummary(): {
	templates: PrivyPolicyTemplate[];
	setupInstructions: string[];
	securityNotes: string[];
} {
	return {
		templates: [getVenusBscPolicy(), getVenusLifiBscPolicy()],
		setupInstructions: [
			"1. Go to Privy Dashboard → Wallet → Policies",
			"2. Create a new policy using the JSON from getVenusBscPolicy() or getVenusLifiBscPolicy()",
			"3. Attach the policy to your Agent wallet (PRIVY_WALLET_ID)",
			"4. Verify by attempting a test transaction to a non-allowlisted contract (should fail)",
			"5. For API-based setup: POST /api/v1/wallets/{walletId}/policies with the template JSON",
		],
		securityNotes: [
			"Privy policies are enforced in MPC enclave — NOT bypassable by Agent code",
			"Even if Agent code has a bug that skips dryRun/confirmMainnet checks, Privy will reject unauthorized contracts",
			"Daily spend limits protect against runaway loops (e.g., Agent borrowing in a loop)",
			"Chain restriction prevents Agent from accidentally operating on wrong network",
			"Code-level gates (dryRun, confirmMainnet, LTV bounds) remain as defense-in-depth Layer 1",
		],
	};
}

// ---------------------------------------------------------------------------
// MCP tool
// ---------------------------------------------------------------------------

export function createPrivyPolicyTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}privyPolicyRecommendation`,
			label: "Privy Policy Recommendation",
			description:
				"Get recommended Privy wallet policy templates for BorrowBot. " +
				"Returns contract allowlists, spend limits, and setup instructions. " +
				"Apply these policies in Privy Dashboard to enforce key-level security.",
			parameters: Type.Object({
				template: Type.Optional(
					Type.String({
						description:
							'Policy template: "venus" (Venus-only BSC), "venus-lifi" (Venus + LI.FI), "multi-chain" (all chains). Default: "venus-lifi".',
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const templateName = params.template?.trim() ?? "venus-lifi";

				let templates: PrivyPolicyTemplate[];
				switch (templateName) {
					case "venus":
						templates = [getVenusBscPolicy()];
						break;
					case "multi-chain":
					case "multichain":
						templates = getMultiChainAgentPolicy();
						break;
					default:
						templates = [getVenusLifiBscPolicy()];
						break;
				}

				const summary = getPrivyPolicySummary();

				return {
					content: [
						{
							type: "text",
							text: `Privy policy recommendation (${templateName}): ${templates.length} template(s). Apply in Privy Dashboard → Wallet → Policies.`,
						},
					],
					details: {
						schema: "evm.privy.policy.recommendation.v1",
						templateName,
						templates,
						setupInstructions: summary.setupInstructions,
						securityNotes: summary.securityNotes,
					},
				};
			},
		}),
	];
}
