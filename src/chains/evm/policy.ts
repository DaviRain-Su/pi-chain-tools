import type { EvmNetwork } from "./runtime.js";

const EVM_TRANSFER_POLICY_SYMBOL = Symbol.for(
	"pi-chain-tools/evm-transfer-policy/state",
);

export type EvmTransferPolicyMode = "open" | "allowlist";
export type EvmTransferPolicyEnforceOn = "mainnet_like" | "all";

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

export function isMainnetLikeEvmNetwork(network: EvmNetwork): boolean {
	return network !== "sepolia";
}

export function getEvmTransferPolicy(): EvmTransferPolicy {
	return copyPolicy(getState());
}

export function setEvmTransferPolicy(
	update: EvmTransferPolicyUpdate,
): EvmTransferPolicy {
	const current = getState();
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
	return copyPolicy(next);
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
