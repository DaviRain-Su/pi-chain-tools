import { readFile } from "node:fs/promises";

function asObject(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: null;
}

export function compileStrategySpecV0(input = {}) {
	const payload = asObject(input) || {};
	const template = String(payload.template || "").trim();
	const risk = asObject(payload.risk) || {};

	if (!template) {
		return { ok: false, errors: ["template is required"] };
	}

	if (template === "rebalance-crosschain-v0") {
		const fromChain = String(payload.fromChain || "base");
		const toChain = String(payload.toChain || "bsc");
		const asset = String(payload.asset || "USDC");
		const maxPerRunUsd = Number(
			risk.maxPerRunUsd || payload.maxPerRunUsd || 1000,
		);
		const maxSlippageBps = Number(
			risk.maxSlippageBps || payload.maxSlippageBps || 100,
		);
		const maxDailyRuns = Number(
			risk.maxDailyRuns || payload.maxDailyRuns || 12,
		);

		return {
			ok: true,
			spec: {
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
				triggers: [
					{ type: "cron", cron: String(payload.cron || "*/30 * * * *") },
				],
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
			},
		};
	}

	if (template === "stable-yield-v1") {
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
			ok: true,
			spec: {
				id: String(
					payload.id ||
						`strategy.stable-yield.${chain}.${asset.toLowerCase()}.v1`,
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
				triggers: [
					{ type: "cron", cron: String(payload.cron || "*/30 * * * *") },
				],
				plan: {
					steps: [
						{ id: "s1", action: "read", component: "cap.venus.lending" },
						{ id: "s2", action: "withdraw", component: "cap.venus.lending" },
						{ id: "s3", action: "supply", component: "cap.venus.lending" },
					],
				},
				metadata: { template, riskLevel },
			},
		};
	}

	if (template === "lending-risk-balance-v0") {
		const asset = String(payload.asset || "USDC");
		const maxPerRunUsd = Number(
			risk.maxPerRunUsd || payload.maxPerRunUsd || 1000,
		);
		const maxSlippageBps = Number(
			risk.maxSlippageBps || payload.maxSlippageBps || 80,
		);
		const maxDailyRuns = Number(risk.maxDailyRuns || payload.maxDailyRuns || 8);

		return {
			ok: true,
			spec: {
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
				triggers: [
					{ type: "cron", cron: String(payload.cron || "0 */2 * * *") },
				],
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
			},
		};
	}

	return { ok: false, errors: [`unsupported template: ${template}`] };
}

export function validatePlanAgainstCapabilities(spec, manifests = []) {
	const strategy = asObject(spec);
	if (!strategy) return { ok: false, errors: ["strategy spec is required"] };
	const steps = Array.isArray(strategy.plan?.steps) ? strategy.plan.steps : [];
	if (steps.length === 0)
		return { ok: false, errors: ["strategy plan.steps is required"] };

	const byId = new Map(
		manifests
			.map((entry) => asObject(entry))
			.filter(Boolean)
			.map((entry) => [entry.id, entry]),
	);

	const errors = [];
	for (const step of steps) {
		const componentId = String(step?.component || "");
		const action = String(step?.action || "");
		const manifest = byId.get(componentId);
		if (!manifest) {
			errors.push(
				`step ${step?.id || "?"}: missing capability manifest '${componentId}'`,
			);
			continue;
		}
		const actions = Array.isArray(manifest.actions) ? manifest.actions : [];
		if (!actions.includes(action)) {
			errors.push(
				`step ${step?.id || "?"}: action '${action}' is not supported by '${componentId}'`,
			);
		}
	}

	return { ok: errors.length === 0, errors };
}

export async function loadJsonFile(path) {
	const raw = await readFile(path, "utf8");
	return JSON.parse(raw);
}
