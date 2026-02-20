import { readFile } from "node:fs/promises";
import {
	compileFromTemplate,
	listStrategyTemplates,
} from "./strategy-template-registry.mjs";

function asObject(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: null;
}

export function compileStrategySpecV0(input = {}) {
	const payload = asObject(input) || {};
	const template = String(payload.template || "").trim();

	if (!template) {
		return { ok: false, errors: ["template is required"] };
	}

	return compileFromTemplate(template, payload);
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

export { listStrategyTemplates };
