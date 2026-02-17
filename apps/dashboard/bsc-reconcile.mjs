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

export function reconcileBscExecutionArtifact(artifact) {
	const type = String(artifact?.type || "");
	const version = String(artifact?.version || "");
	if (type !== "bsc_post_action_supply" || version !== "v1") {
		return {
			ok: false,
			route: "unsupported",
			reason: "artifact_unsupported",
			retryable: false,
		};
	}
	const protocol = String(artifact?.protocol || "unknown").toLowerCase();
	const status = String(artifact?.status || "error").toLowerCase();
	const amountRaw = String(artifact?.amountRaw || "");
	const hasValidAmount = /^\d+$/.test(amountRaw) && BigInt(amountRaw) > 0n;
	const hasTxHash = /^0x[a-fA-F0-9]{64}$/.test(String(artifact?.txHash || ""));
	const baseChecks = {
		hasValidAmount,
		hasTxHash,
		status,
		protocol,
	};
	const adapter = BSC_POST_ACTION_PROTOCOL_RECONCILE_ADAPTERS[protocol];
	if (!adapter) {
		return {
			ok: false,
			route: `bsc_post_action_supply_v1:${protocol}:unsupported`,
			reason: "protocol_reconcile_adapter_missing",
			retryable: false,
			checks: baseChecks,
			checkedAt: new Date().toISOString(),
		};
	}
	const adapted = adapter(artifact, baseChecks);
	const ok =
		status === "success" && hasValidAmount && hasTxHash && adapted.providerOk;
	return {
		ok,
		route: `bsc_post_action_supply_v1:${adapted.adapter}`,
		reason: ok
			? null
			: String(artifact?.reason || "post_action_reconcile_failed"),
		retryable: ok ? false : Boolean(artifact?.retryable),
		checks: adapted.checks,
		checkedAt: new Date().toISOString(),
	};
}
