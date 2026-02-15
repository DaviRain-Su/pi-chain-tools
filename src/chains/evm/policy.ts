import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { EvmNetwork } from "./runtime.js";

const EVM_TRANSFER_POLICY_SYMBOL = Symbol.for(
	"pi-chain-tools/evm-transfer-policy/state",
);
const EVM_TRANSFER_POLICY_AUDIT_SYMBOL = Symbol.for(
	"pi-chain-tools/evm-transfer-policy/audit",
);
const EVM_TRANSFER_POLICY_PATH_ENV = "EVM_TRANSFER_POLICY_PATH";
const EVM_TRANSFER_POLICY_DIR_ENV = "EVM_TRANSFER_POLICY_DIR";
const EVM_TRANSFER_POLICY_FILENAME = "evm-transfer-policy.json";
const EVM_TRANSFER_POLICY_SCHEMA = "evm.transfer.policy.v1";
const EVM_TRANSFER_POLICY_STORE_SCHEMA = "evm.transfer.policy.store.v1";

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

type StoredPolicyState = {
	schema: "evm.transfer.policy.store.v1";
	policy: EvmTransferPolicy;
	audit?: EvmTransferPolicyAuditRecord[];
};

function nowIso(): string {
	return new Date().toISOString();
}

function createDefaultPolicy(): EvmTransferPolicy {
	return {
		schema: EVM_TRANSFER_POLICY_SCHEMA,
		version: 1,
		updatedAt: nowIso(),
		updatedBy: null,
		note: null,
		mode: "open",
		enforceOn: "mainnet_like",
		allowedRecipients: [],
	};
}

function defaultPolicyStatePath(): string {
	const explicitPath = process.env[EVM_TRANSFER_POLICY_PATH_ENV]?.trim();
	if (explicitPath) return path.resolve(explicitPath);
	const explicitDir = process.env[EVM_TRANSFER_POLICY_DIR_ENV]?.trim();
	if (explicitDir) {
		return path.resolve(explicitDir, EVM_TRANSFER_POLICY_FILENAME);
	}
	const homeDir = os.homedir();
	return path.resolve(
		homeDir,
		".config",
		"pi-chain-tools",
		EVM_TRANSFER_POLICY_FILENAME,
	);
}

function isStoredPolicyRecord(value: unknown): value is StoredPolicyState {
	if (!value || typeof value !== "object") {
		return false;
	}
	const typed = value as {
		schema?: unknown;
		policy?: unknown;
		audit?: unknown;
	};
	if (typed.schema !== EVM_TRANSFER_POLICY_STORE_SCHEMA) {
		return false;
	}
	if (!isEvmTransferPolicy(typed.policy)) {
		return false;
	}
	if (typed.audit !== undefined && !isAuditRecordArray(typed.audit)) {
		return false;
	}
	return true;
}

function isEvmTransferPolicy(value: unknown): value is EvmTransferPolicy {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	if (candidate.schema !== EVM_TRANSFER_POLICY_SCHEMA) return false;
	if (typeof candidate.version !== "number") return false;
	if (!Number.isInteger(candidate.version) || candidate.version <= 0)
		return false;
	if (typeof candidate.updatedAt !== "string" || !candidate.updatedAt.trim())
		return false;
	if (!/^(open|allowlist)$/.test(String(candidate.mode || ""))) return false;
	if (!/^(mainnet_like|all)$/.test(String(candidate.enforceOn || "")))
		return false;
	if (!Array.isArray(candidate.allowedRecipients)) return false;
	for (const entry of candidate.allowedRecipients) {
		if (typeof entry !== "string") return false;
	}
	if (candidate.updatedBy !== null && typeof candidate.updatedBy !== "string")
		return false;
	if (candidate.note !== null && typeof candidate.note !== "string")
		return false;
	return true;
}

function isAuditRecordArray(
	value: unknown,
): value is EvmTransferPolicyAuditRecord[] {
	if (!Array.isArray(value)) return false;
	for (const entry of value) {
		if (!isAuditRecord(entry)) return false;
	}
	return true;
}

function isAuditRecord(value: unknown): value is EvmTransferPolicyAuditRecord {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	if (candidate.schema !== "evm.transfer.policy.audit.v1") return false;
	if (typeof candidate.id !== "string" || !candidate.id) return false;
	if (typeof candidate.at !== "string" || !candidate.at) return false;
	if (!/^(set_policy|apply_template)$/.test(String(candidate.action || "")))
		return false;
	if (
		candidate.template !== null &&
		!/^(production_safe|open_dev)$/.test(String(candidate.template || ""))
	) {
		return false;
	}
	if (candidate.actor !== null && typeof candidate.actor !== "string")
		return false;
	if (candidate.note !== null && typeof candidate.note !== "string")
		return false;
	if (!isEvmTransferPolicy(candidate.before)) return false;
	if (!isEvmTransferPolicy(candidate.after)) return false;
	return true;
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

function sanitizePolicy(policy: EvmTransferPolicy): EvmTransferPolicy {
	const mode = policy.mode === "allowlist" ? "allowlist" : "open";
	const enforceOn =
		policy.enforceOn === "all" || policy.enforceOn === "mainnet_like"
			? policy.enforceOn
			: createDefaultPolicy().enforceOn;
	const allowedRecipients = [...new Set(policy.allowedRecipients)]
		.map((entry) => entry?.trim?.())
		.filter((entry): entry is string => Boolean(entry))
		.map((entry, index) => {
			try {
				return parseEvmAddress(entry, `allowedRecipients[${index}]`);
			} catch {
				return null;
			}
		})
		.filter((entry): entry is string => Boolean(entry));
	return {
		schema: EVM_TRANSFER_POLICY_SCHEMA,
		version: policy.version > 0 ? policy.version : 1,
		updatedAt: policy.updatedAt || nowIso(),
		updatedBy:
			policy.updatedBy === null || typeof policy.updatedBy === "string"
				? policy.updatedBy
				: null,
		note:
			policy.note === null || typeof policy.note === "string"
				? policy.note
				: null,
		mode,
		enforceOn,
		allowedRecipients,
	};
}

function readStoredState(): StoredPolicyState | null {
	const statePath = defaultPolicyStatePath();
	try {
		const raw = readFileSync(statePath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (isStoredPolicyRecord(parsed)) {
			return {
				schema: parsed.schema,
				policy: sanitizePolicy(parsed.policy),
				audit: isAuditRecordArray(parsed.audit)
					? parsed.audit.map(copyAuditRecord)
					: undefined,
			};
		}
		if (isEvmTransferPolicy(parsed)) {
			return {
				schema: EVM_TRANSFER_POLICY_STORE_SCHEMA,
				policy: sanitizePolicy(parsed),
			};
		}
		return null;
	} catch {
		return null;
	}
}

function writeStoredState(
	policy: EvmTransferPolicy,
	audit: EvmTransferPolicyAuditRecord[],
): void {
	const statePath = defaultPolicyStatePath();
	const payload: StoredPolicyState = {
		schema: EVM_TRANSFER_POLICY_STORE_SCHEMA,
		policy: copyPolicy(policy),
		audit,
	};
	try {
		mkdirSync(path.dirname(statePath), { recursive: true });
		writeFileSync(statePath, JSON.stringify(payload, null, 2), "utf8");
	} catch {
		// keep in-memory state as source of truth if persistence fails.
	}
}

function getState(): EvmTransferPolicy {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	const existing = globalState[EVM_TRANSFER_POLICY_SYMBOL];
	if (existing && typeof existing === "object") {
		return existing as EvmTransferPolicy;
	}

	const stored = readStoredState();
	const policy = stored?.policy
		? sanitizePolicy(stored.policy)
		: createDefaultPolicy();
	globalState[EVM_TRANSFER_POLICY_SYMBOL] = policy;

	const existingAudit = globalState[EVM_TRANSFER_POLICY_AUDIT_SYMBOL];
	if (!Array.isArray(existingAudit)) {
		globalState[EVM_TRANSFER_POLICY_AUDIT_SYMBOL] = stored?.audit
			? [...stored.audit.map(copyAuditRecord)]
			: [];
	}
	return policy;
}

function getAuditState(): EvmTransferPolicyAuditRecord[] {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	const existing = globalState[EVM_TRANSFER_POLICY_AUDIT_SYMBOL];
	if (Array.isArray(existing)) {
		return existing as EvmTransferPolicyAuditRecord[];
	}
	const loadedAudit = readStoredState()?.audit;
	const next: EvmTransferPolicyAuditRecord[] = loadedAudit
		? loadedAudit.map(copyAuditRecord)
		: [];
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
	const policy = getState();
	writeStoredState(policy, audit);
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
