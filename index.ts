import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import { createNearToolset } from "./src/chains/near/toolset.js";
import { registerChainToolsets } from "./src/core/register.js";
import { defineTool } from "./src/core/types.js";
import type { ToolRegistrar } from "./src/core/types.js";

const OPENCLAW_NEAR_REGISTERED = Symbol.for(
	"pi-chain-tools/openclaw-near/registered",
);

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultManifestDir = path.join(repoRoot, "docs", "schemas", "examples");

type StrategyCompilerModule = {
	compileStrategySpecV0: (input: Record<string, unknown>) => {
		ok: boolean;
		spec?: Record<string, unknown>;
		errors?: string[];
	};
	validatePlanAgainstCapabilities: (
		spec: Record<string, unknown>,
		manifests: Record<string, unknown>[],
	) => { ok: boolean; errors: string[] };
};

async function loadStrategyCompiler(): Promise<StrategyCompilerModule> {
	return (await import(
		"./apps/dashboard/strategy-compiler.mjs"
	)) as StrategyCompilerModule;
}

async function loadJson(filePath: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadCapabilityManifests(
	manifestDir = defaultManifestDir,
): Promise<Record<string, unknown>[]> {
	const names = await readdir(manifestDir);
	const files = names.filter(
		(name) => name.startsWith("capability-") && name.endsWith(".json"),
	);
	const manifests = [];
	for (const file of files) {
		manifests.push(await loadJson(path.join(manifestDir, file)));
	}
	return manifests;
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function validateStrategyStructure(specInput: unknown): {
	ok: boolean;
	errors: string[];
} {
	const spec = asObject(specInput);
	if (!spec) return { ok: false, errors: ["spec must be object"] };
	const errors: string[] = [];
	for (const key of [
		"id",
		"name",
		"version",
		"owner",
		"goal",
		"constraints",
		"triggers",
		"plan",
	]) {
		if (!(key in spec)) errors.push(`missing required field: ${key}`);
	}
	const plan = asObject(spec.plan);
	const steps = plan?.steps;
	if (!Array.isArray(steps) || steps.length === 0) {
		errors.push("plan.steps must be a non-empty array");
	}
	return { ok: errors.length === 0, errors };
}

const EXECUTE_CONFIRM_TOKEN = "I_ACKNOWLEDGE_EXECUTION";
const EXECUTE_ALLOWED_TEMPLATE = "rebalance-crosschain-v0";
const EXECUTE_ALLOWED_CHAINS = new Set(["base", "bsc"]);
const EXECUTE_MAX_PER_RUN_USD = 5000;

function evaluateExecutePolicy(spec: Record<string, unknown>) {
	const metadata = asObject(spec.metadata);
	const template = String(metadata?.template || "");
	if (template !== EXECUTE_ALLOWED_TEMPLATE) {
		return {
			ok: false,
			reason: `execute policy allows only template '${EXECUTE_ALLOWED_TEMPLATE}'`,
		};
	}

	const constraints = asObject(spec.constraints);
	const allow = asObject(constraints?.allow);
	const risk = asObject(constraints?.risk);

	const chains = Array.isArray(allow?.chains)
		? (allow?.chains as unknown[]).map((v) => String(v).toLowerCase())
		: [];
	if (
		chains.length === 0 ||
		chains.some((c) => !EXECUTE_ALLOWED_CHAINS.has(c))
	) {
		return { ok: false, reason: "execute policy allows only base/bsc chains" };
	}

	const protocols = Array.isArray(allow?.protocols)
		? (allow?.protocols as unknown[]).map((v) => String(v).toLowerCase())
		: [];
	if (!protocols.includes("lifi")) {
		return { ok: false, reason: "execute policy requires lifi protocol" };
	}

	const maxPerRunUsd = Number(risk?.maxPerRunUsd || 0);
	if (!Number.isFinite(maxPerRunUsd) || maxPerRunUsd <= 0) {
		return {
			ok: false,
			reason: "execute policy requires valid risk.maxPerRunUsd",
		};
	}
	if (maxPerRunUsd > EXECUTE_MAX_PER_RUN_USD) {
		return {
			ok: false,
			reason: `execute policy maxPerRunUsd exceeded (${maxPerRunUsd} > ${EXECUTE_MAX_PER_RUN_USD})`,
		};
	}

	return { ok: true, reason: "policy-passed" };
}

function simulateStrategyRun(
	specInput: unknown,
	mode: "dry-run" | "plan" | "execute",
) {
	const spec = asObject(specInput);
	if (!spec) {
		return { ok: false, errors: ["spec must be object"] };
	}
	const plan = asObject(spec.plan);
	const steps = Array.isArray(plan?.steps)
		? (plan?.steps as Record<string, unknown>[])
		: [];
	if (steps.length === 0) {
		return { ok: false, errors: ["strategy plan.steps is required"] };
	}

	const executePolicy = mode === "execute" ? evaluateExecutePolicy(spec) : null;
	const executeStepStatus =
		mode !== "execute"
			? null
			: executePolicy?.ok
				? "EXECUTE_READY_NOOP"
				: "EXECUTION_BLOCKED_BY_POLICY";

	const trace = steps.map((step, index) => ({
		index,
		id: String(step.id || `step-${index}`),
		action: String(step.action || "unknown"),
		component: String(step.component || "unknown"),
		status:
			mode === "plan"
				? "PLANNED"
				: mode === "execute"
					? executeStepStatus
					: "SIMULATED_OK",
		ts: new Date().toISOString(),
	}));
	return {
		ok: true,
		result: {
			status:
				mode === "execute" ? (executePolicy?.ok ? "ready" : "blocked") : "ok",
			mode,
			strategyId: spec.id || null,
			policy: executePolicy,
			steps: trace,
			evidence: {
				type: "strategy_execution_trace@v0",
				generatedAt: new Date().toISOString(),
			},
		},
	};
}

export default function openclawNearExtension(pi: ToolRegistrar): void {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	if (globalState[OPENCLAW_NEAR_REGISTERED] === true) return;
	globalState[OPENCLAW_NEAR_REGISTERED] = true;
	registerChainToolsets(pi, [createNearToolset()]);

	pi.registerTool(
		defineTool({
			name: "pct_strategy_compile",
			label: "PCT Strategy Compile",
			description:
				"Compile template + params into strategy-spec.v0 and check capability compatibility.",
			parameters: Type.Object({
				template: Type.String(),
				payload: Type.Optional(Type.Object({}, { additionalProperties: true })),
				manifestsDir: Type.Optional(Type.String()),
				writeToPath: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const compiler = await loadStrategyCompiler();
				const payload = {
					...(asObject(params.payload) || {}),
					template: params.template,
				};
				const compiled = compiler.compileStrategySpecV0(payload);
				if (!compiled.ok || !compiled.spec) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										status: "compile_failed",
										errors: compiled.errors || ["unknown compile error"],
									},
									null,
									2,
								),
							},
						],
					};
				}
				const manifests = await loadCapabilityManifests(params.manifestsDir);
				const compatibility = compiler.validatePlanAgainstCapabilities(
					compiled.spec,
					manifests,
				);
				if (!compatibility.ok) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										status: "compatibility_failed",
										errors: compatibility.errors,
										strategy: compiled.spec,
									},
									null,
									2,
								),
							},
						],
					};
				}
				if (params.writeToPath) {
					await writeFile(
						params.writeToPath,
						`${JSON.stringify(compiled.spec, null, 2)}\n`,
						"utf8",
					);
				}
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									status: "ok",
									manifestsLoaded: manifests.length,
									strategy: compiled.spec,
								},
								null,
								2,
							),
						},
					],
				};
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pct_strategy_validate",
			label: "PCT Strategy Validate",
			description:
				"Validate strategy-spec.v0 structure and capability compatibility.",
			parameters: Type.Object({
				spec: Type.Object({}, { additionalProperties: true }),
				manifestsDir: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const compiler = await loadStrategyCompiler();
				const manifests = await loadCapabilityManifests(params.manifestsDir);
				const structure = validateStrategyStructure(params.spec);
				const compatibility = compiler.validatePlanAgainstCapabilities(
					params.spec,
					manifests,
				);
				const status = structure.ok && compatibility.ok ? "ok" : "failed";
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									status,
									structure,
									compatibility,
									manifestsLoaded: manifests.length,
									specId: asObject(params.spec)?.id || null,
								},
								null,
								2,
							),
						},
					],
				};
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pct_strategy_run",
			label: "PCT Strategy Run",
			description:
				"Run strategy in v0 plan/dry-run mode and return execution trace evidence. execute mode is gated by explicit confirmation and currently policy-blocked.",
			parameters: Type.Object({
				spec: Type.Object({}, { additionalProperties: true }),
				mode: Type.Optional(
					Type.Union([
						Type.Literal("dry-run"),
						Type.Literal("plan"),
						Type.Literal("execute"),
					]),
				),
				confirmExecuteToken: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const mode = (params.mode || "dry-run") as
					| "dry-run"
					| "plan"
					| "execute";

				if (
					mode === "execute" &&
					params.confirmExecuteToken !== EXECUTE_CONFIRM_TOKEN
				) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										status: "blocked",
										reason:
											"execute mode requires explicit confirmExecuteToken",
										requiredToken: EXECUTE_CONFIRM_TOKEN,
									},
									null,
									2,
								),
							},
						],
					};
				}

				const simulated = simulateStrategyRun(params.spec, mode);
				if (!simulated.ok) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{ status: "failed", errors: simulated.errors },
									null,
									2,
								),
							},
						],
					};
				}
				return {
					content: [
						{ type: "text", text: JSON.stringify(simulated.result, null, 2) },
					],
				};
			},
		}),
	);
}
