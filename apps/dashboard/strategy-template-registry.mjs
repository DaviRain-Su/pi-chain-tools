function asObject(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: null;
}

function buildRebalanceSpec(payload) {
	const risk = asObject(payload.risk) || {};
	const template = "rebalance-crosschain-v0";
	const fromChain = String(payload.fromChain || "base");
	const toChain = String(payload.toChain || "bsc");
	const asset = String(payload.asset || "USDC");
	const maxPerRunUsd = Number(
		risk.maxPerRunUsd || payload.maxPerRunUsd || 1000,
	);
	const maxSlippageBps = Number(
		risk.maxSlippageBps || payload.maxSlippageBps || 100,
	);
	const maxDailyRuns = Number(risk.maxDailyRuns || payload.maxDailyRuns || 12);

	return {
		id: String(
			payload.id ||
				`strategy.rebalance.${asset.toLowerCase()}.${fromChain}-${toChain}`,
		),
		name: String(
			payload.name ||
				`Cross-chain ${asset} rebalance (${fromChain}->${toChain})`,
		),
		version: "0.1.0",
		owner: {
			namespace: String(payload.namespace || "community"),
			author: String(payload.author || "pi-chain-tools"),
		},
		goal: {
			kind: "rebalance",
			description: String(
				payload.goalDescription ||
					`Keep ${asset} allocation balanced across ${fromChain}/${toChain}`,
			),
		},
		constraints: {
			risk: { maxPerRunUsd, maxSlippageBps, maxDailyRuns },
			allow: {
				chains: [fromChain, toChain],
				protocols: ["lifi"],
				assets: [asset],
			},
		},
		triggers: [{ type: "cron", cron: String(payload.cron || "*/30 * * * *") }],
		plan: {
			steps: [
				{ id: "s1", action: "quote", component: "cap.lifi.bridge-swap" },
				{
					id: "s2",
					action: "execute",
					component: "cap.lifi.bridge-swap",
					onFailure: "fallback",
				},
				{ id: "s3", action: "status", component: "cap.lifi.bridge-swap" },
			],
		},
		metadata: { template },
	};
}

function buildStableYieldSpec(payload) {
	const risk = asObject(payload.risk) || {};
	const template = "stable-yield-v1";
	const chain = String(payload.chain || "bsc");
	const asset = String(payload.asset || "USDC");
	const riskLevel = String(payload.riskLevel || "low").toLowerCase();
	const riskDefaults = {
		low: { maxPerRunUsd: 100, maxSlippageBps: 60, maxDailyRuns: 8 },
		medium: { maxPerRunUsd: 500, maxSlippageBps: 90, maxDailyRuns: 12 },
		high: { maxPerRunUsd: 1000, maxSlippageBps: 120, maxDailyRuns: 18 },
	};
	const defaults = riskDefaults[riskLevel] || riskDefaults.low;
	const maxPerRunUsd = Number(
		risk.maxPerRunUsd || payload.maxPerRunUsd || defaults.maxPerRunUsd,
	);
	const maxSlippageBps = Number(
		risk.maxSlippageBps || payload.maxSlippageBps || defaults.maxSlippageBps,
	);
	const maxDailyRuns = Number(
		risk.maxDailyRuns || payload.maxDailyRuns || defaults.maxDailyRuns,
	);

	return {
		id: String(
			payload.id || `strategy.stable-yield.${chain}.${asset.toLowerCase()}.v1`,
		),
		name: String(payload.name || `Stable yield v1 (${asset} on ${chain})`),
		version: "0.1.0",
		owner: {
			namespace: String(payload.namespace || "community"),
			author: String(payload.author || "pi-chain-tools"),
		},
		goal: {
			kind: "yield",
			description: String(
				payload.goalDescription ||
					`Auto-balance stablecoin yield on ${chain} with conservative risk gates`,
			),
		},
		constraints: {
			risk: { maxPerRunUsd, maxSlippageBps, maxDailyRuns },
			allow: {
				chains: [chain],
				protocols: ["lifi", "venus"],
				assets: [asset],
			},
		},
		triggers: [{ type: "cron", cron: String(payload.cron || "*/30 * * * *") }],
		plan: {
			steps: [
				{ id: "s1", action: "read", component: "cap.venus.lending" },
				{ id: "s2", action: "withdraw", component: "cap.venus.lending" },
				{ id: "s3", action: "supply", component: "cap.venus.lending" },
			],
		},
		metadata: { template, riskLevel },
	};
}

function buildLendingRiskBalanceSpec(payload) {
	const risk = asObject(payload.risk) || {};
	const template = "lending-risk-balance-v0";
	const asset = String(payload.asset || "USDC");
	const maxPerRunUsd = Number(
		risk.maxPerRunUsd || payload.maxPerRunUsd || 1000,
	);
	const maxSlippageBps = Number(
		risk.maxSlippageBps || payload.maxSlippageBps || 80,
	);
	const maxDailyRuns = Number(risk.maxDailyRuns || payload.maxDailyRuns || 8);

	return {
		id: String(
			payload.id || `strategy.lending.risk-balance.${asset.toLowerCase()}`,
		),
		name: String(payload.name || `Lending risk balance for ${asset}`),
		version: "0.1.0",
		owner: {
			namespace: String(payload.namespace || "community"),
			author: String(payload.author || "pi-chain-tools"),
		},
		goal: {
			kind: "yield",
			description: String(
				payload.goalDescription ||
					`Optimize ${asset} lending yield within risk constraints`,
			),
		},
		constraints: {
			risk: { maxPerRunUsd, maxSlippageBps, maxDailyRuns },
			allow: {
				chains: ["bsc", "base"],
				protocols: ["venus", "morpho"],
				assets: [asset],
			},
		},
		triggers: [{ type: "cron", cron: String(payload.cron || "0 */2 * * *") }],
		plan: {
			steps: [
				{ id: "s1", action: "read", component: "cap.venus.lending" },
				{ id: "s2", action: "read", component: "cap.morpho.lending" },
				{
					id: "s3",
					action: "repay",
					component: "cap.venus.lending",
					onFailure: "retry",
				},
				{ id: "s4", action: "supply", component: "cap.morpho.lending" },
			],
		},
		metadata: { template },
	};
}

const TEMPLATE_REGISTRY = {
	"rebalance-crosschain-v0": {
		compile: buildRebalanceSpec,
		manifest: {
			template: "rebalance-crosschain-v0",
			version: "0.1.0",
			author: "pi-chain-tools",
			license: "MIT",
			pricingModel: "free",
			tags: ["rebalance", "cross-chain", "lifi"],
			capabilities: ["cap.lifi.bridge-swap"],
		},
	},
	"stable-yield-v1": {
		compile: buildStableYieldSpec,
		manifest: {
			template: "stable-yield-v1",
			version: "0.1.0",
			author: "pi-chain-tools",
			license: "MIT",
			pricingModel: "free",
			tags: ["stablecoin", "yield", "bsc", "venus"],
			capabilities: ["cap.venus.lending", "cap.lifi.bridge-swap"],
		},
	},
	"lending-risk-balance-v0": {
		compile: buildLendingRiskBalanceSpec,
		manifest: {
			template: "lending-risk-balance-v0",
			version: "0.1.0",
			author: "pi-chain-tools",
			license: "MIT",
			pricingModel: "free",
			tags: ["lending", "risk", "venus", "morpho"],
			capabilities: ["cap.venus.lending", "cap.morpho.lending"],
		},
	},
};

export function listStrategyTemplates() {
	return Object.keys(TEMPLATE_REGISTRY);
}

export function listStrategyTemplateManifests() {
	return Object.values(TEMPLATE_REGISTRY).map((entry) => entry.manifest);
}

export function getStrategyTemplateManifest(template) {
	return TEMPLATE_REGISTRY[template]?.manifest || null;
}

export function compileFromTemplate(template, payload) {
	const entry = TEMPLATE_REGISTRY[template];
	if (!entry) {
		return {
			ok: false,
			errors: [`unsupported template: ${template}`],
			supportedTemplates: listStrategyTemplates(),
		};
	}
	return { ok: true, spec: entry.compile(payload) };
}
