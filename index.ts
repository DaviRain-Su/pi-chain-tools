import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import {
	getEvmChainId,
	getEvmRpcEndpoint,
	parseEvmNetwork,
} from "./src/chains/evm/runtime.js";
import {
	lifiGet,
	planLifiQuoteRoutes,
} from "./src/chains/evm/tools/lifi-planning.js";
import { LIFI_DEFAULT_SLIPPAGE } from "./src/chains/evm/tools/lifi-types.js";
import { createLocalKeySigner } from "./src/chains/evm/tools/signer-local.js";
import { createNearToolset } from "./src/chains/near/toolset.js";
import { registerChainToolsets } from "./src/core/register.js";
import { defineTool } from "./src/core/types.js";
import type { ToolRegistrar } from "./src/core/types.js";

const OPENCLAW_NEAR_REGISTERED = Symbol.for(
	"pi-chain-tools/openclaw-near/registered",
);
const STRATEGY_LIVE_RUN_LEDGER = Symbol.for(
	"pi-chain-tools/strategy-live-run-ledger",
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
const LIVE_EXECUTE_CONFIRM_TOKEN = "I_ACKNOWLEDGE_LIVE_EXECUTION";
const EXECUTE_ALLOWED_TEMPLATES = new Set([
	"rebalance-crosschain-v0",
	"stable-yield-v1",
]);
const EXECUTE_ALLOWED_CHAINS = new Set(["base", "bsc"]);
const EXECUTE_MAX_PER_RUN_USD = 5000;
const LIVE_EXECUTE_MAX_PER_RUN_USD = 100;

function evaluateExecutePolicy(spec: Record<string, unknown>) {
	const metadata = asObject(spec.metadata);
	const template = String(metadata?.template || "");
	if (!EXECUTE_ALLOWED_TEMPLATES.has(template)) {
		return {
			ok: false,
			reason: `execute policy allows only templates: ${Array.from(
				EXECUTE_ALLOWED_TEMPLATES,
			).join(", ")}`,
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

function buildLifiExecuteIntent(spec: Record<string, unknown>) {
	const constraints = asObject(spec.constraints);
	const allow = asObject(constraints?.allow);
	const risk = asObject(constraints?.risk);
	const chains = Array.isArray(allow?.chains)
		? (allow?.chains as unknown[]).map((v) => String(v).toLowerCase())
		: [];
	const assets = Array.isArray(allow?.assets)
		? (allow?.assets as unknown[]).map((v) => String(v).toUpperCase())
		: [];
	const [fromChain = "base", toChain = "bsc"] = chains;
	const asset = assets[0] || "USDC";
	const chainToId: Record<string, number> = { base: 8453, bsc: 56 };
	const amountUsd = Number(risk?.maxPerRunUsd || 0);
	return {
		type: "lifi_execution_intent@v0",
		fromChain,
		toChain,
		fromChainId: chainToId[fromChain] || null,
		toChainId: chainToId[toChain] || null,
		asset,
		amountUsd,
		nextAction:
			"Call LI.FI quote endpoint to resolve route + transactionRequest",
		requiresSigner: true,
	};
}

async function getLifiStatus(params: {
	txHash: string;
	fromNetwork: string;
	toNetwork: string;
	bridge?: string;
}) {
	const fromNetwork = parseEvmNetwork(params.fromNetwork as never);
	const toNetwork = parseEvmNetwork(params.toNetwork as never);
	const queryParams: Record<string, string> = {
		txHash: params.txHash.trim(),
		fromChain: String(getEvmChainId(fromNetwork)),
		toChain: String(getEvmChainId(toNetwork)),
	};
	if (params.bridge) queryParams.bridge = params.bridge;
	return await lifiGet<Record<string, unknown>>("/status", queryParams);
}

async function fetchErc20Decimals(network: string, token: string) {
	const parsedNetwork = parseEvmNetwork(network as never);
	const rpcUrl = getEvmRpcEndpoint(parsedNetwork);
	const response = await fetch(rpcUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "eth_call",
			params: [{ to: token, data: "0x313ce567" }, "latest"],
		}),
	});
	if (!response.ok)
		throw new Error(`decimals call failed: HTTP ${response.status}`);
	const payload = (await response.json()) as {
		result?: string;
		error?: { message?: string };
	};
	if (payload.error) {
		throw new Error(payload.error.message || "decimals call failed");
	}
	const raw = String(payload.result || "0x0");
	return Number.parseInt(raw, 16);
}

function humanAmountToRaw(amountHuman: string, decimals: number): string {
	const normalized = amountHuman.trim();
	if (!/^\d+(\.\d+)?$/.test(normalized)) {
		throw new Error("fromAmountHuman must be a positive decimal string");
	}
	const [intPart, fracPart = ""] = normalized.split(".");
	const fracClamped = fracPart.slice(0, decimals).padEnd(decimals, "0");
	const raw =
		BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(fracClamped || "0");
	if (raw <= 0n) throw new Error("fromAmountHuman must be > 0");
	return raw.toString();
}

async function prepareLifiQuoteFromIntent(
	executeIntent: Record<string, unknown>,
	quoteContext: Record<string, unknown>,
) {
	const fromChain = String(executeIntent.fromChain || "").toLowerCase();
	const toChain = String(executeIntent.toChain || "").toLowerCase();
	const fromNetwork = parseEvmNetwork(fromChain as never);
	const toNetwork = parseEvmNetwork(toChain as never);

	const fromChainId = getEvmChainId(fromNetwork).toString();
	const toChainId = getEvmChainId(toNetwork).toString();
	const fromToken = String(quoteContext.fromToken || "").trim();
	const toToken = String(quoteContext.toToken || "").trim();
	const fromAmountRawInput = String(quoteContext.fromAmount || "").trim();
	const fromAmountHumanInput = String(
		quoteContext.fromAmountHuman || "",
	).trim();
	const fromAddress = String(quoteContext.fromAddress || "").trim();
	const toAddress = String(quoteContext.toAddress || "").trim() || fromAddress;
	const orderRaw = String(quoteContext.order || "RECOMMENDED").toUpperCase();
	const order =
		orderRaw === "CHEAPEST" ||
		orderRaw === "FASTEST" ||
		orderRaw === "SAFEST" ||
		orderRaw === "RECOMMENDED"
			? orderRaw
			: "RECOMMENDED";
	const slippage = Number(quoteContext.slippage ?? LIFI_DEFAULT_SLIPPAGE);

	if (!fromToken || !toToken || !fromAddress) {
		return {
			ok: false,
			errors: [
				"prepareQuote requires quoteContext.fromToken/toToken/fromAddress",
			],
		};
	}

	const fromTokenDecimals = await fetchErc20Decimals(fromChain, fromToken);
	const derivedHumanFromIntent = Number(executeIntent.amountUsd || 0);
	const fromAmountHuman =
		fromAmountHumanInput ||
		(derivedHumanFromIntent > 0 ? String(derivedHumanFromIntent) : "");
	let fromAmount = fromAmountRawInput;
	if (fromAmountHuman) {
		const computedRaw = humanAmountToRaw(fromAmountHuman, fromTokenDecimals);
		if (fromAmount && fromAmount !== computedRaw) {
			return {
				ok: false,
				errors: [
					`precision mismatch: fromAmount(${fromAmount}) != fromAmountHuman(${fromAmountHuman})@decimals(${fromTokenDecimals}) => ${computedRaw}`,
				],
			};
		}
		fromAmount = computedRaw;
	}
	if (!fromAmount) {
		return {
			ok: false,
			errors: [
				"prepareQuote requires amount; provide quoteContext.fromAmount OR set strategy risk.maxPerRunUsd so amountUsd can be derived",
			],
		};
	}

	const baseParams: Record<string, string> = {
		fromChain: fromChainId,
		toChain: toChainId,
		fromToken,
		toToken,
		fromAmount,
		fromAddress,
		toAddress,
		slippage: String(slippage),
		integrator: process.env.LIFI_INTEGRATOR?.trim() || "pi-chain-tools",
	};

	const planned = await planLifiQuoteRoutes({
		baseParams,
		preferredOrder: order,
	});
	return {
		ok: true,
		quotePlan: {
			selectedOrder: planned.selected.order,
			score: planned.selected.score,
			rationale: planned.selected.rationale,
			riskHints: planned.selected.riskHints,
			transactionRequest: planned.selected.quote.transactionRequest,
			estimate: planned.selected.quote.estimate,
			fallback: planned.fallback,
			metrics: planned.metrics,
			precisionCheck: {
				fromToken,
				fromTokenDecimals,
				fromAmountRaw: fromAmount,
				fromAmountHuman: fromAmountHuman || null,
				amountSource: fromAmountHumanInput
					? "quoteContext.fromAmountHuman"
					: derivedHumanFromIntent > 0
						? "executeIntent.amountUsd(auto-derived)"
						: fromAmountRawInput
							? "quoteContext.fromAmount(raw)"
							: "unknown",
			},
		},
	};
}

async function submitEvmSignedTx(params: {
	signedTxHex: string;
	network?: string;
	rpcUrl?: string;
}) {
	const signedTxHex = String(params.signedTxHex || "").trim();
	if (!/^0x[0-9a-fA-F]+$/.test(signedTxHex)) {
		throw new Error("signedTxHex must be a 0x-prefixed hex string");
	}
	const network = parseEvmNetwork(String(params.network || "bsc") as never);
	const rpcUrl = getEvmRpcEndpoint(network, params.rpcUrl);
	const response = await fetch(rpcUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "eth_sendRawTransaction",
			params: [signedTxHex],
		}),
	});
	if (!response.ok) {
		throw new Error(`broadcast rpc failed: HTTP ${response.status}`);
	}
	const payload = (await response.json()) as {
		result?: unknown;
		error?: { message?: string };
	};
	if (payload.error) {
		throw new Error(
			`broadcast rpc error: ${payload.error.message || "unknown"}`,
		);
	}
	const txHash = String(payload.result || "").trim();
	if (!txHash) throw new Error("broadcast rpc returned empty tx hash");
	return { network, rpcUrl, txHash };
}

async function autoSignAndBroadcastFromQuote(params: {
	quotePlan: Record<string, unknown>;
	networkHint?: string;
}) {
	const txReq = asObject(params.quotePlan.transactionRequest);
	if (!txReq) throw new Error("quotePlan.transactionRequest is required");
	const to = String(txReq.to || "").trim();
	const data = String(txReq.data || "0x").trim();
	const valueRaw = String(txReq.value || "0").trim();
	if (!to) throw new Error("transactionRequest.to is required for autoSign");
	const signer = createLocalKeySigner();
	const network = parseEvmNetwork((params.networkHint || "bsc") as never);
	const sent = await signer.signAndSend({
		network,
		to,
		data,
		value: valueRaw,
	});
	return { network, txHash: sent.txHash, from: sent.from, to };
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
	const executeIntent =
		mode === "execute" && executePolicy?.ok
			? buildLifiExecuteIntent(spec)
			: null;

	return {
		ok: true,
		result: {
			status:
				mode === "execute" ? (executePolicy?.ok ? "ready" : "blocked") : "ok",
			mode,
			strategyId: spec.id || null,
			policy: executePolicy,
			executeIntent,
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
	if (!(globalState[STRATEGY_LIVE_RUN_LEDGER] instanceof Map)) {
		globalState[STRATEGY_LIVE_RUN_LEDGER] = new Map<
			string,
			Record<string, unknown>
		>();
	}
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
				"Run strategy in v0 plan/dry-run mode and return execution trace evidence. execute mode is gated by explicit confirmation and can optionally prepare LI.FI quote/txRequest.",
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
				prepareQuote: Type.Optional(Type.Boolean()),
				live: Type.Optional(Type.Boolean()),
				liveConfirmToken: Type.Optional(Type.String()),
				signedTxHex: Type.Optional(Type.String()),
				broadcastNetwork: Type.Optional(Type.String()),
				broadcastRpcUrl: Type.Optional(Type.String()),
				autoSign: Type.Optional(Type.Boolean()),
				trackAfterBroadcast: Type.Optional(Type.Boolean()),
				runId: Type.Optional(Type.String()),
				evidenceOutPath: Type.Optional(Type.String()),
				quoteContext: Type.Optional(
					Type.Object({}, { additionalProperties: true }),
				),
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

				const runId = String(params.runId || "").trim();
				const ledger = globalState[STRATEGY_LIVE_RUN_LEDGER] as Map<
					string,
					Record<string, unknown>
				>;
				if (mode === "execute" && params.live === true && runId) {
					const existing = ledger.get(runId);
					if (existing) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											status: "blocked",
											reason: `duplicate runId blocked (${runId})`,
											runId,
											previous: existing,
										},
										null,
										2,
									),
								},
							],
						};
					}
				}

				if (mode === "execute" && params.live === true) {
					const maxPerRunUsd = Number(
						asObject(asObject(params.spec)?.constraints)?.risk?.maxPerRunUsd ||
							0,
					);
					if (maxPerRunUsd > LIVE_EXECUTE_MAX_PER_RUN_USD) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											status: "blocked",
											reason: `live execution cap exceeded (${maxPerRunUsd} > ${LIVE_EXECUTE_MAX_PER_RUN_USD})`,
										},
										null,
										2,
									),
								},
							],
						};
					}
					if (params.liveConfirmToken !== LIVE_EXECUTE_CONFIRM_TOKEN) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											status: "blocked",
											reason:
												"live execution requires explicit liveConfirmToken",
											requiredToken: LIVE_EXECUTE_CONFIRM_TOKEN,
										},
										null,
										2,
									),
								},
							],
						};
					}
				}

				if (
					mode === "execute" &&
					params.prepareQuote === true &&
					simulated.result?.status === "ready"
				) {
					const quoteResult = await prepareLifiQuoteFromIntent(
						asObject(simulated.result.executeIntent) || {},
						asObject(params.quoteContext) || {},
					);
					if (!quoteResult.ok) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											...simulated.result,
											quotePrepareStatus: "failed",
											quotePrepareErrors: quoteResult.errors,
										},
										null,
										2,
									),
								},
							],
						};
					}
					let broadcastStatus =
						params.live === true ? "awaiting-signed-tx" : "skipped";
					let broadcast: Record<string, unknown> | null = null;
					if (params.live === true) {
						try {
							if (params.autoSign === true) {
								broadcast = await autoSignAndBroadcastFromQuote({
									quotePlan: quoteResult.quotePlan,
									networkHint: String(params.broadcastNetwork || "bsc"),
								});
								broadcastStatus = "submitted";
							} else if (params.signedTxHex) {
								broadcast = await submitEvmSignedTx({
									signedTxHex: params.signedTxHex,
									network:
										params.broadcastNetwork ||
										String(
											asObject(simulated.result?.executeIntent)?.fromChain ||
												"bsc",
										),
									rpcUrl: params.broadcastRpcUrl,
								});
								broadcastStatus = "submitted";
							}
						} catch (error) {
							broadcastStatus = "failed";
							broadcast = {
								error: error instanceof Error ? error.message : String(error),
							};
						}
					}
					let tracking: Record<string, unknown> | null = null;
					if (
						params.trackAfterBroadcast === true &&
						broadcastStatus === "submitted" &&
						broadcast?.txHash
					) {
						const executeIntent =
							asObject(simulated.result?.executeIntent) || asObject({});
						tracking = await getLifiStatus({
							txHash: String(broadcast.txHash),
							fromNetwork: String(executeIntent.fromChain || "bsc"),
							toNetwork: String(executeIntent.toChain || "base"),
						});
					}
					const finalResult = {
						...simulated.result,
						quotePrepareStatus: "ok",
						quotePlan: quoteResult.quotePlan,
						liveRequested: params.live === true,
						broadcastStatus,
						broadcast,
						tracking,
						runId: runId || null,
					};
					if (
						runId &&
						(broadcastStatus === "submitted" || broadcastStatus === "failed")
					) {
						ledger.set(runId, {
							broadcastStatus,
							broadcast: broadcast || undefined,
							ts: new Date().toISOString(),
						});
					}
					if (params.evidenceOutPath) {
						await writeFile(
							params.evidenceOutPath,
							`${JSON.stringify(finalResult, null, 2)}\n`,
							"utf8",
						);
					}
					return {
						content: [
							{ type: "text", text: JSON.stringify(finalResult, null, 2) },
						],
					};
				}

				let baseResult: Record<string, unknown> = simulated.result as Record<
					string,
					unknown
				>;
				if (mode === "execute" && params.live === true) {
					let broadcastStatus = "awaiting-signed-tx";
					let broadcast: Record<string, unknown> | null = null;
					if (params.signedTxHex) {
						try {
							const executeIntent =
								asObject(simulated.result?.executeIntent) || {};
							broadcast = await submitEvmSignedTx({
								signedTxHex: params.signedTxHex,
								network:
									params.broadcastNetwork ||
									String(executeIntent.fromChain || "bsc"),
								rpcUrl: params.broadcastRpcUrl,
							});
							broadcastStatus = "submitted";
						} catch (error) {
							broadcastStatus = "failed";
							broadcast = {
								error: error instanceof Error ? error.message : String(error),
							};
						}
					}
					let tracking: Record<string, unknown> | null = null;
					if (
						params.trackAfterBroadcast === true &&
						broadcastStatus === "submitted" &&
						broadcast?.txHash
					) {
						const executeIntent =
							asObject(simulated.result?.executeIntent) || asObject({});
						tracking = await getLifiStatus({
							txHash: String(broadcast.txHash),
							fromNetwork: String(executeIntent.fromChain || "bsc"),
							toNetwork: String(executeIntent.toChain || "base"),
						});
					}
					baseResult = {
						...baseResult,
						liveRequested: true,
						broadcastStatus,
						broadcast,
						tracking,
						runId: runId || null,
					};
					if (
						runId &&
						(broadcastStatus === "submitted" || broadcastStatus === "failed")
					) {
						ledger.set(runId, {
							broadcastStatus,
							broadcast: broadcast || undefined,
							ts: new Date().toISOString(),
						});
					}
				}
				if (params.evidenceOutPath) {
					await writeFile(
						params.evidenceOutPath,
						`${JSON.stringify(baseResult, null, 2)}\n`,
						"utf8",
					);
				}
				return {
					content: [
						{ type: "text", text: JSON.stringify(baseResult, null, 2) },
					],
				};
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pct_strategy_track",
			label: "PCT Strategy Track",
			description:
				"Track LI.FI bridge execution status by txHash for execute-ready strategy runs.",
			parameters: Type.Object({
				txHash: Type.String(),
				fromNetwork: Type.String(),
				toNetwork: Type.String(),
				bridge: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const status = await getLifiStatus({
					txHash: params.txHash,
					fromNetwork: params.fromNetwork,
					toNetwork: params.toNetwork,
					bridge: params.bridge,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
				};
			},
		}),
	);
}
