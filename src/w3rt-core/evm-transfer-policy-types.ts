import type { EvmNetwork } from "../chains/evm/runtime.js";

export const EVM_TRANSFER_POLICY_SCHEMA = "evm.transfer.policy.v1" as const;
export const EVM_TRANSFER_POLICY_STORE_SCHEMA =
	"evm.transfer.policy.store.v1" as const;

export type EvmTransferPolicyMode = "open" | "allowlist";
export type EvmTransferPolicyEnforceOn = "mainnet_like" | "all";
export type EvmTransferPolicyTemplate = "production_safe" | "open_dev";

export type EvmTransferPolicy = {
	schema: typeof EVM_TRANSFER_POLICY_SCHEMA;
	version: number;
	updatedAt: string;
	updatedBy: string | null;
	note: string | null;
	mode: EvmTransferPolicyMode;
	enforceOn: EvmTransferPolicyEnforceOn;
	allowedRecipients: string[];
};

export type EvmTransferPolicyUpdate = {
	mode?: EvmTransferPolicyMode;
	enforceOn?: EvmTransferPolicyEnforceOn;
	allowedRecipients?: string[];
	clearRecipients?: boolean;
	updatedBy?: string | null;
	note?: string | null;
};

export type EvmTransferPolicyCheckInput = {
	network: EvmNetwork;
	toAddress: string;
	transferType: "native" | "erc20";
	tokenAddress?: string;
};

export type EvmTransferPolicyCheck = {
	allowed: boolean;
	reason: string | null;
	policy: EvmTransferPolicy;
};

export type EvmTransferPolicyAuditAction = "set_policy" | "apply_template";

export type EvmTransferPolicyAuditRecord = {
	schema: "evm.transfer.policy.audit.v1";
	id: string;
	at: string;
	action: EvmTransferPolicyAuditAction;
	template: EvmTransferPolicyTemplate | null;
	actor: string | null;
	note: string | null;
	before: EvmTransferPolicy;
	after: EvmTransferPolicy;
};
