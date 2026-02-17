const ALLOWED_CHAINS = new Set(["near", "bsc", "base", "evm", "solana", "sui"]);
const ALLOWED_INTENTS = new Set([
	"rebalance.usdt_to_usdce",
	"rebalance.stable",
	"swap.stable",
]);
const ALLOWED_EXECUTION_MODES = new Set(["plan-only", "execute"]);

const CHAIN_INTENT_PREFIX = {
	near: ["rebalance.", "swap."],
	bsc: ["rebalance.", "swap."],
	base: ["swap."],
	evm: ["swap."],
	solana: ["swap."],
	sui: ["swap."],
};

function asObject(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: null;
}

export function validateStrategyDslV1(input) {
	const dsl = asObject(input);
	if (!dsl) {
		return { ok: false, errors: ["dsl must be a JSON object"] };
	}

	const errors = [];
	const warnings = [];
	const id = String(dsl.id || "").trim();
	const name = String(dsl.name || "").trim();
	const creator = String(dsl.creator || "").trim();
	const version = String(dsl.version || "").trim();
	const targetChain = String(dsl.targetChain || "")
		.trim()
		.toLowerCase();
	const intentType = String(dsl.intentType || "").trim();

	if (!id) errors.push("id is required");
	if (!name) errors.push("name is required");
	if (!creator) errors.push("creator is required");
	if (!version) errors.push("version is required");
	if (!targetChain) errors.push("targetChain is required");
	if (!intentType) errors.push("intentType is required");

	if (targetChain && !ALLOWED_CHAINS.has(targetChain)) {
		errors.push(`targetChain '${targetChain}' is not allowed`);
	}
	if (intentType && !ALLOWED_INTENTS.has(intentType)) {
		warnings.push(
			`intentType '${intentType}' is not in default allowlist; keep semantic review enabled`,
		);
	}

	const pricing = asObject(dsl.pricing);
	if (!pricing) {
		errors.push("pricing object is required");
	}
	const priceUsd = Number(pricing?.priceUsd || 0);
	const pricingCurrency = String(pricing?.currency || "USDC").toUpperCase();
	if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
		errors.push("pricing.priceUsd must be a positive number");
	}
	if (!["USDC", "USDT", "USDT.E", "USDC.E"].includes(pricingCurrency)) {
		warnings.push(`pricing.currency '${pricingCurrency}' is uncommon`);
	}

	const risk = asObject(dsl.risk);
	if (!risk) {
		errors.push("risk object is required");
	}
	const maxAmountUsd = Number(risk?.maxAmountUsd || 0);
	const maxSlippageBps = Number(risk?.maxSlippageBps || 0);
	const dailyRunLimit = Number(risk?.dailyRunLimit || 0);
	if (!Number.isFinite(maxAmountUsd) || maxAmountUsd <= 0) {
		errors.push("risk.maxAmountUsd must be a positive number");
	}
	if (
		!Number.isFinite(maxSlippageBps) ||
		maxSlippageBps < 1 ||
		maxSlippageBps > 500
	) {
		errors.push("risk.maxSlippageBps must be in [1, 500]");
	}
	if (
		!Number.isFinite(dailyRunLimit) ||
		dailyRunLimit < 1 ||
		dailyRunLimit > 100
	) {
		errors.push("risk.dailyRunLimit must be in [1, 100]");
	}

	const execution = asObject(dsl.execution);
	const executionMode = String(execution?.mode || "plan-only").toLowerCase();
	if (!ALLOWED_EXECUTION_MODES.has(executionMode)) {
		errors.push("execution.mode must be 'plan-only' or 'execute'");
	}

	return {
		ok: errors.length === 0,
		errors,
		warnings,
		normalized: {
			id,
			name,
			creator,
			version,
			targetChain,
			intentType,
			pricing: {
				priceUsd,
				currency: pricingCurrency,
			},
			risk: {
				maxAmountUsd,
				maxSlippageBps,
				dailyRunLimit,
			},
			execution: {
				mode: executionMode,
			},
			inputs: asObject(dsl.inputs) || {},
		},
	};
}

export function validateStrategySemanticV1(normalizedDsl, policy = {}) {
	const errors = [];
	const warnings = [];
	const dsl = asObject(normalizedDsl);
	if (!dsl) {
		return { ok: false, errors: ["normalized dsl is required"], warnings };
	}

	const constraints = asObject(policy.constraints) || {};
	const monetization = asObject(policy.monetization) || {};
	const maxDailyRebalanceRuns = Number(constraints.maxDailyRebalanceRuns || 10);
	const minRebalanceUsd = Number(constraints.minRebalanceUsd || 0);
	const settlementToken = String(
		monetization.settlementToken || "USDC",
	).toUpperCase();
	const platformTakeRate = Number(monetization.platformTakeRate || 0.15);

	if (Number.isFinite(minRebalanceUsd) && minRebalanceUsd > 0) {
		if (Number(dsl.risk?.maxAmountUsd || 0) < minRebalanceUsd) {
			errors.push(
				`risk.maxAmountUsd (${dsl.risk?.maxAmountUsd}) must be >= policy minRebalanceUsd (${minRebalanceUsd})`,
			);
		}
	}

	if (
		Number.isFinite(maxDailyRebalanceRuns) &&
		maxDailyRebalanceRuns > 0 &&
		Number(dsl.risk?.dailyRunLimit || 0) > maxDailyRebalanceRuns
	) {
		errors.push(
			`risk.dailyRunLimit (${dsl.risk?.dailyRunLimit}) exceeds policy maxDailyRebalanceRuns (${maxDailyRebalanceRuns})`,
		);
	}

	const prefixes = CHAIN_INTENT_PREFIX[dsl.targetChain] || [];
	if (prefixes.length > 0) {
		const allowedByPrefix = prefixes.some((prefix) =>
			String(dsl.intentType || "").startsWith(prefix),
		);
		if (!allowedByPrefix) {
			errors.push(
				`intentType '${dsl.intentType}' is not compatible with targetChain '${dsl.targetChain}'`,
			);
		}
	}

	if (
		dsl.execution?.mode === "execute" &&
		Number(dsl.risk?.maxSlippageBps || 0) > 200
	) {
		warnings.push(
			"execution.mode=execute with maxSlippageBps > 200 is high risk; recommend <= 200",
		);
	}

	if (settlementToken && dsl.pricing?.currency !== settlementToken) {
		warnings.push(
			`pricing.currency (${dsl.pricing?.currency}) differs from policy settlementToken (${settlementToken})`,
		);
	}

	if (
		!Number.isFinite(platformTakeRate) ||
		platformTakeRate < 0 ||
		platformTakeRate > 0.9
	) {
		warnings.push(
			"policy.monetization.platformTakeRate is out of expected range [0,0.9]",
		);
	}

	return { ok: errors.length === 0, errors, warnings };
}

export function buildStrategyDslFromLegacy(payload) {
	return {
		id: String(payload.id || "").trim(),
		name: String(payload.name || "").trim(),
		creator: String(payload.creator || "").trim(),
		version: String(payload.version || "1.0.0").trim(),
		targetChain: String(payload.targetChain || "near").toLowerCase(),
		intentType: String(payload.intentType || "rebalance.usdt_to_usdce"),
		pricing: {
			priceUsd: Number(payload.priceUsd || 0),
			currency: String(payload.currency || "USDC").toUpperCase(),
		},
		risk: {
			maxAmountUsd: Number(payload.maxAmountUsd || 1000),
			maxSlippageBps: Number(payload.maxSlippageBps || 100),
			dailyRunLimit: Number(payload.dailyRunLimit || 5),
		},
		execution: {
			mode: String(payload.executionMode || "plan-only").toLowerCase(),
		},
		inputs: asObject(payload.inputs) || {},
	};
}
