import { createHash } from "node:crypto";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function stableJson(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableJson(item)).join(",")}]`;
	}
	const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
	return `{${entries
		.map(([key, val]) => `${JSON.stringify(key)}:${stableJson(val)}`)
		.join(",")}}`;
}

function sha256Hex(input) {
	return createHash("sha256").update(String(input)).digest("hex");
}

export function deriveDeterministicAgentId(input = {}) {
	const namespace = String(
		input.namespace || "pi-chain-tools:monad-agent:v1",
	).trim();
	const seed = {
		namespace,
		chainId: Number(input.chainId || 0),
		accountId: String(input.accountId || "")
			.trim()
			.toLowerCase(),
		operatorAddress: String(input.operatorAddress || "")
			.trim()
			.toLowerCase(),
		rpcUrl: String(input.rpcUrl || "")
			.trim()
			.toLowerCase(),
		vault: String(input.vault || "")
			.trim()
			.toLowerCase(),
	};
	const digest = sha256Hex(stableJson(seed));
	return `monad-agent-${digest.slice(0, 32)}`;
}

export function buildAgentIdentity(input = {}) {
	const nowIso = String(input.nowIso || new Date().toISOString());
	const namespace = String(input.namespace || "pi-chain-tools:monad-agent:v1");
	const metadata = {
		name: String(input.name || "Pi Monad Agent"),
		ownerAccountId: String(input.accountId || ""),
		operatorAddress: String(input.operatorAddress || ""),
		rpcUrl: String(input.rpcUrl || ""),
		chainId: Number(input.chainId || 0),
		capabilities: Array.isArray(input.capabilities)
			? input.capabilities.map((x) => String(x))
			: ["identity", "delegation"],
		version: String(input.version || "v1.3"),
		updatedAt: nowIso,
	};
	const agentId = deriveDeterministicAgentId({
		namespace,
		chainId: metadata.chainId,
		accountId: metadata.ownerAccountId,
		operatorAddress: metadata.operatorAddress,
		rpcUrl: metadata.rpcUrl,
		vault: String(input.vault || ""),
	});
	return {
		agentId,
		namespace,
		metadata,
	};
}

export function createDelegationIntentPayload(input = {}) {
	const now = Number.isFinite(Number(input.now))
		? Number(input.now)
		: Math.floor(Date.now() / 1000);
	const expiresAt = Number.isFinite(Number(input.expiresAt))
		? Number(input.expiresAt)
		: now + 7 * 24 * 60 * 60;
	const nonce = String(input.nonce || `nonce-${now}`);
	const revocable = input.revocable !== false;
	const scope = Array.isArray(input.scope)
		? input.scope.map((item) => String(item).trim()).filter(Boolean)
		: ["monad:morpho:earn:execute"];
	const scopeHash = `0x${sha256Hex(scope.join("|"))}`;
	const delegatee = String(input.delegatee || "").trim();
	const agentId = String(input.agentId || "").trim();
	const chainId = Number(input.chainId || 0);
	const verifyingContract = String(
		input.verifyingContract || ZERO_ADDRESS,
	).trim();
	const domain = {
		name: "PiMonadAgentDelegation",
		version: "1",
		chainId,
		verifyingContract,
	};
	const types = {
		DelegationIntent: [
			{ name: "agentId", type: "string" },
			{ name: "delegatee", type: "address" },
			{ name: "scopeHash", type: "bytes32" },
			{ name: "nonce", type: "string" },
			{ name: "issuedAt", type: "uint256" },
			{ name: "expiresAt", type: "uint256" },
			{ name: "revocable", type: "bool" },
		],
	};
	const message = {
		agentId,
		delegatee,
		scopeHash,
		nonce,
		issuedAt: now,
		expiresAt,
		revocable,
	};
	const digest = `0x${sha256Hex(stableJson({ domain, types, message }))}`;
	return {
		domain,
		types,
		primaryType: "DelegationIntent",
		message,
		scope,
		digest,
		proof: {
			signatureType: "eip712-style",
			signature: String(input.signature || "").trim() || null,
			signer: String(input.signer || "").trim() || null,
		},
	};
}

export function verifyDelegationIntentPayload(input = {}) {
	const payload = input.payload || {};
	const now = Number.isFinite(Number(input.now))
		? Number(input.now)
		: Math.floor(Date.now() / 1000);
	const expectedDigest = createDelegationIntentPayload({
		agentId: payload?.message?.agentId,
		delegatee: payload?.message?.delegatee,
		scope: payload?.scope,
		nonce: payload?.message?.nonce,
		now: payload?.message?.issuedAt,
		expiresAt: payload?.message?.expiresAt,
		revocable: payload?.message?.revocable,
		chainId: payload?.domain?.chainId,
		verifyingContract: payload?.domain?.verifyingContract,
		signature: payload?.proof?.signature,
		signer: payload?.proof?.signer,
	}).digest;
	const blockers = [];
	if (!payload?.message?.agentId) blockers.push("missing_agent_id");
	if (!payload?.message?.delegatee) blockers.push("missing_delegatee");
	if (!payload?.message?.nonce) blockers.push("missing_nonce");
	if (!payload?.message?.expiresAt) blockers.push("missing_expires_at");
	const expiresAt = Number(payload?.message?.expiresAt || 0);
	if (Number.isFinite(expiresAt) && expiresAt <= now) {
		blockers.push("delegation_expired");
	}
	if (
		String(payload?.digest || "").toLowerCase() !== expectedDigest.toLowerCase()
	) {
		blockers.push("digest_mismatch");
	}
	const hasSignature = Boolean(payload?.proof?.signature);
	if (!hasSignature) blockers.push("missing_signature");
	return {
		ok: blockers.length === 0,
		blockers,
		hints: blockers.map((code) => {
			switch (code) {
				case "missing_signature":
					return "Sign payload.digest off-chain, then submit with proof.signature";
				case "digest_mismatch":
					return "Re-run prepare endpoint and submit the untouched payload";
				case "delegation_expired":
					return "Use a future expiresAt timestamp";
				default:
					return `Fix ${code.replaceAll("_", " ")}`;
			}
		}),
		computedDigest: expectedDigest,
	};
}
