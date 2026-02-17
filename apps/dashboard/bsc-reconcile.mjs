export const BSC_POST_ACTION_SUPPLY_ARTIFACT_V1_SCHEMA = {
	$id: "pi-chain-tools/bsc-post-action-supply-artifact.v1",
	type: "object",
	required: ["type", "version", "protocol", "status", "token"],
	properties: {
		type: { const: "bsc_post_action_supply" },
		version: { const: "v1" },
		protocol: { type: "string", enum: ["aave", "lista", "wombat"] },
		runId: { type: "string" },
		status: { type: "string", enum: ["success", "error"] },
		amountRaw: { type: ["string", "null"], pattern: "^\\d+$" },
		token: { type: "string" },
		provider: { type: ["string", "null"] },
		txHash: { type: ["string", "null"], pattern: "^0x[a-fA-F0-9]{64}$" },
		reason: { type: ["string", "null"] },
		retryable: { type: "boolean" },
		occurredAt: { type: "string" },
	},
	additionalProperties: true,
};

export const BSC_POST_ACTION_PROTOCOL_RECONCILE_ADAPTERS = {
	aave: (artifact, baseChecks) => {
		const provider = String(artifact?.provider || "").toLowerCase();
		const providerOk = !provider || provider.includes("aave");
		return {
			adapter: "aave",
			providerOk,
			checks: {
				...baseChecks,
				provider,
				providerOk,
			},
		};
	},
	lista: (artifact, baseChecks) => {
		const provider = String(artifact?.provider || "").toLowerCase();
		const providerOk = !provider || provider.includes("lista");
		return {
			adapter: "lista",
			providerOk,
			checks: {
				...baseChecks,
				provider,
				providerOk,
			},
		};
	},
	wombat: (artifact, baseChecks) => {
		const provider = String(artifact?.provider || "").toLowerCase();
		const providerOk = !provider || provider.includes("wombat");
		return {
			adapter: "wombat",
			providerOk,
			checks: {
				...baseChecks,
				provider,
				providerOk,
			},
		};
	},
};

export function validateBscPostActionArtifactV1(artifact) {
	const errors = [];
	const normalized = {
		type: String(artifact?.type || ""),
		version: String(artifact?.version || ""),
		protocol: String(artifact?.protocol || "").toLowerCase(),
		runId:
			artifact?.runId === undefined || artifact?.runId === null
				? undefined
				: String(artifact.runId),
		status: String(artifact?.status || "").toLowerCase(),
		amountRaw:
			artifact?.amountRaw === undefined || artifact?.amountRaw === null
				? null
				: String(artifact.amountRaw),
		token: String(artifact?.token || "").toLowerCase(),
		provider:
			artifact?.provider === undefined || artifact?.provider === null
				? null
				: String(artifact.provider),
		txHash:
			artifact?.txHash === undefined || artifact?.txHash === null
				? null
				: String(artifact.txHash),
		reason:
			artifact?.reason === undefined || artifact?.reason === null
				? null
				: String(artifact.reason),
		retryable: Boolean(artifact?.retryable),
		occurredAt:
			artifact?.occurredAt === undefined || artifact?.occurredAt === null
				? null
				: String(artifact.occurredAt),
	};

	if (normalized.type !== "bsc_post_action_supply") {
		errors.push("type_invalid");
	}
	if (normalized.version !== "v1") {
		errors.push("version_invalid");
	}
	if (
		!Object.hasOwn(
			BSC_POST_ACTION_PROTOCOL_RECONCILE_ADAPTERS,
			normalized.protocol,
		)
	) {
		errors.push("protocol_invalid");
	}
	if (!["success", "error"].includes(normalized.status)) {
		errors.push("status_invalid");
	}
	if (!normalized.token) {
		errors.push("token_missing");
	}
	if (
		normalized.amountRaw !== null &&
		(!/^\d+$/.test(normalized.amountRaw) || BigInt(normalized.amountRaw) <= 0n)
	) {
		errors.push("amount_raw_invalid");
	}
	if (
		normalized.txHash !== null &&
		!/^0x[a-fA-F0-9]{64}$/.test(normalized.txHash)
	) {
		errors.push("tx_hash_invalid");
	}
	return {
		ok: errors.length === 0,
		errors,
		normalized,
	};
}

export function reconcileBscExecutionArtifact(artifact) {
	const validated = validateBscPostActionArtifactV1(artifact);
	if (!validated.ok) {
		return {
			ok: false,
			route: "unsupported",
			reason: `artifact_invalid:${validated.errors.join(",")}`,
			retryable: false,
			checks: {
				validationErrors: validated.errors,
			},
			checkedAt: new Date().toISOString(),
		};
	}
	const normalized = validated.normalized;
	const status = normalized.status;
	const amountRaw = String(normalized.amountRaw || "");
	const hasValidAmount = /^\d+$/.test(amountRaw) && BigInt(amountRaw) > 0n;
	const hasTxHash = /^0x[a-fA-F0-9]{64}$/.test(String(normalized.txHash || ""));
	const baseChecks = {
		hasValidAmount,
		hasTxHash,
		status,
		protocol: normalized.protocol,
	};
	const adapter =
		BSC_POST_ACTION_PROTOCOL_RECONCILE_ADAPTERS[normalized.protocol];
	const adapted = adapter(normalized, baseChecks);
	const ok =
		status === "success" && hasValidAmount && hasTxHash && adapted.providerOk;
	return {
		ok,
		route: `bsc_post_action_supply_v1:${adapted.adapter}`,
		reason: ok
			? null
			: String(normalized.reason || "post_action_reconcile_failed"),
		retryable: ok ? false : Boolean(normalized.retryable),
		checks: adapted.checks,
		checkedAt: new Date().toISOString(),
	};
}
