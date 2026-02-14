import type { EvmNetwork } from "./runtime.js";

const EVM_TRANSFER_POLICY_SYMBOL = Symbol.for(
	"pi-chain-tools/evm-transfer-policy/state",
);
const EVM_TRANSFER_POLICY_AUDIT_SYMBOL = Symbol.for(
	"pi-chain-tools/evm-transfer-policy/audit",
);

export type EvmTransferPolicyMode = "open" | "allowlist";
export type EvmTransferPolicyEnforceOn = "mainnet_like" | "all";
export type EvmTransferPolicyTemplate = "production_safe" | "open_dev";

export type EvmTransferPolicy = {
	schema: "evm.transfer.policy.v1";
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

function nowIso(): string {
	return new Date().toISOString();
}

function createDefaultPolicy(): EvmTransferPolicy {
	return {
		schema: "evm.transfer.policy.v1",
		version: 1,
		updatedAt: nowIso(),
		updatedBy: null,
		note: null,
		mode: "open",
		enforceOn: "mainnet_like",
		allowedRecipients: [],
	};
}

function parseEvmAddress(value: string, fieldName: string): string {
	const normalized = value.trim().toLowerCase();
	if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
		throw new Error(`${fieldName} must be a valid EVM address`);
	}
	return normalized;
}

function copyPolicy(policy: EvmTransferPolicy): EvmTransferPolicy {
	return {
		...policy,
		allowedRecipients: [...policy.allowedRecipients],
	};
}

function copyAuditRecord(
	record: EvmTransferPolicyAuditRecord,
): EvmTransferPolicyAuditRecord {
	return {
		...record,
		before: copyPolicy(record.before),
		after: copyPolicy(record.after),
	};
}

function getState(): EvmTransferPolicy {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	const existing = globalState[EVM_TRANSFER_POLICY_SYMBOL];
	if (existing && typeof existing === "object") {
		return existing as EvmTransferPolicy;
	}
	const next = createDefaultPolicy();
	globalState[EVM_TRANSFER_POLICY_SYMBOL] = next;
	return next;
}

function getAuditState(): EvmTransferPolicyAuditRecord[] {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	const existing = globalState[EVM_TRANSFER_POLICY_AUDIT_SYMBOL];
	if (Array.isArray(existing)) {
		return existing as EvmTransferPolicyAuditRecord[];
	}
	const next: EvmTransferPolicyAuditRecord[] = [];
	globalState[EVM_TRANSFER_POLICY_AUDIT_SYMBOL] = next;
	return next;
}

function createAuditId(): string {
	const nonce = Math.random().toString(36).slice(2, 10).toUpperCase();
	return `pol-${Date.now().toString(36)}-${nonce}`;
}

function appendAudit(record: EvmTransferPolicyAuditRecord): void {
	const MAX_AUDIT = 200;
	const audit = getAuditState();
	audit.push(record);
	if (audit.length > MAX_AUDIT) {
		audit.splice(0, audit.length - MAX_AUDIT);
	}
}

function applyPolicyUpdate(
	update: EvmTransferPolicyUpdate,
	context: {
		action: EvmTransferPolicyAuditAction;
		template: EvmTransferPolicyTemplate | null;
	},
): EvmTransferPolicy {
	const current = getState();
	const currentCopy = copyPolicy(current);
	const allowedRecipients = update.clearRecipients
		? []
		: update.allowedRecipients
			? update.allowedRecipients.map((entry, index) =>
					parseEvmAddress(entry, `allowedRecipients[${index}]`),
				)
			: current.allowedRecipients;
	const dedupRecipients = [...new Set(allowedRecipients)];
	const next: EvmTransferPolicy = {
		...current,
		mode: update.mode ?? current.mode,
		enforceOn: update.enforceOn ?? current.enforceOn,
		allowedRecipients: dedupRecipients,
		note:
			update.note !== undefined ? update.note?.trim() || null : current.note,
		updatedBy:
			update.updatedBy !== undefined
				? update.updatedBy?.trim() || null
				: current.updatedBy,
		updatedAt: nowIso(),
		version: current.version + 1,
	};
	const globalState = globalThis as Record<PropertyKey, unknown>;
	globalState[EVM_TRANSFER_POLICY_SYMBOL] = next;
	appendAudit({
		schema: "evm.transfer.policy.audit.v1",
		id: createAuditId(),
		at: nowIso(),
		action: context.action,
		template: context.template,
		actor: next.updatedBy,
		note: next.note,
		before: currentCopy,
		after: copyPolicy(next),
	});
	return copyPolicy(next);
}

export function isMainnetLikeEvmNetwork(network: EvmNetwork): boolean {
	return network !== "sepolia";
}

export function getEvmTransferPolicy(): EvmTransferPolicy {
	return copyPolicy(getState());
}

export function setEvmTransferPolicy(
	update: EvmTransferPolicyUpdate,
): EvmTransferPolicy {
	return applyPolicyUpdate(update, {
		action: "set_policy",
		template: null,
	});
}

export function applyEvmTransferPolicyTemplate(params: {
	template: EvmTransferPolicyTemplate;
	updatedBy?: string | null;
	note?: string | null;
}): EvmTransferPolicy {
	if (params.template === "production_safe") {
		return applyPolicyUpdate(
			{
				mode: "allowlist",
				enforceOn: "mainnet_like",
				updatedBy: params.updatedBy,
				note: params.note,
			},
			{ action: "apply_template", template: params.template },
		);
	}
	return applyPolicyUpdate(
		{
			mode: "open",
			enforceOn: "mainnet_like",
			updatedBy: params.updatedBy,
			note: params.note,
		},
		{ action: "apply_template", template: params.template },
	);
}

export function getEvmTransferPolicyAuditLog(params?: {
	limit?: number;
}): EvmTransferPolicyAuditRecord[] {
	const limit = params?.limit ?? 20;
	if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
		throw new Error("limit must be an integer between 1 and 500");
	}
	const audit = getAuditState();
	return audit.slice(-limit).reverse().map(copyAuditRecord);
}

export function evaluateEvmTransferPolicy(
	input: EvmTransferPolicyCheckInput,
): EvmTransferPolicyCheck {
	const policy = getEvmTransferPolicy();
	const toAddress = parseEvmAddress(input.toAddress, "toAddress");
	if (policy.mode === "open") {
		return {
			allowed: true,
			reason: null,
			policy,
		};
	}
	const shouldEnforce =
		policy.enforceOn === "all" || isMainnetLikeEvmNetwork(input.network);
	if (!shouldEnforce) {
		return {
			allowed: true,
			reason: null,
			policy,
		};
	}
	const allowed = policy.allowedRecipients.includes(toAddress);
	if (allowed) {
		return {
			allowed: true,
			reason: null,
			policy,
		};
	}
	const transferTag =
		input.transferType === "erc20" && input.tokenAddress
			? `erc20(${input.tokenAddress})`
			: input.transferType;
	return {
		allowed: false,
		reason: `Recipient ${toAddress} is not in transfer allowlist for ${transferTag}.`,
		policy,
	};
}
