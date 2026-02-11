import { createHash } from "node:crypto";
import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";
import { Transaction } from "@mysten/sui/transactions";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	type SuiNetwork,
	getSuiClient,
	parsePositiveBigInt,
	parseSuiNetwork,
	resolveSuiKeypair,
	suiNetworkSchema,
	toMist,
} from "../runtime.js";
import { createSuiExecuteTools } from "./execute.js";

type WorkflowRunMode = "analysis" | "simulate" | "execute";

type TransferSuiIntent = {
	type: "sui.transfer.sui";
	toAddress: string;
	amountSui?: number;
	amountMist?: string;
};

type TransferCoinIntent = {
	type: "sui.transfer.coin";
	toAddress: string;
	coinType: string;
	amountRaw: string;
	maxCoinObjectsToMerge?: number;
};

type SwapCetusIntent = {
	type: "sui.swap.cetus";
	inputCoinType: string;
	outputCoinType: string;
	amountRaw: string;
	byAmountIn: boolean;
	slippageBps: number;
	providers?: string[];
	depth?: number;
	endpoint?: string;
	apiKey?: string;
};

type SuiWorkflowIntent =
	| TransferSuiIntent
	| TransferCoinIntent
	| SwapCetusIntent;

type ParsedIntentHints = {
	intentType?: SuiWorkflowIntent["type"];
	toAddress?: string;
	amountSui?: number;
	amountRaw?: string;
	coinType?: string;
	inputCoinType?: string;
	outputCoinType?: string;
};

type WorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	intentType?: SuiWorkflowIntent["type"];
	intentText?: string;
	network?: string;
	toAddress?: string;
	amountSui?: number;
	amountRaw?: string;
	coinType?: string;
	inputCoinType?: string;
	outputCoinType?: string;
	byAmountIn?: boolean;
	slippageBps?: number;
	providers?: string[];
	depth?: number;
	maxCoinObjectsToMerge?: number;
	endpoint?: string;
	apiKey?: string;
	fromPrivateKey?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	waitForLocalExecution?: boolean;
};

function workflowRunModeSchema() {
	return Type.Optional(
		Type.Union([
			Type.Literal("analysis"),
			Type.Literal("simulate"),
			Type.Literal("execute"),
		]),
	);
}

function parseRunMode(value?: string): WorkflowRunMode {
	if (value === "simulate" || value === "execute") return value;
	return "analysis";
}

function createRunId(input?: string): string {
	if (input?.trim()) return input.trim();
	const nonce = Math.random().toString(36).slice(2, 8);
	return `wf-sui-${Date.now().toString(36)}-${nonce}`;
}

function resolveAggregatorEnv(network: SuiNetwork): Env {
	if (network === "mainnet") return Env.Mainnet;
	if (network === "testnet") return Env.Testnet;
	throw new Error(
		"Sui swap workflow currently supports network=mainnet or testnet.",
	);
}

function parseIntentText(text?: string): ParsedIntentHints {
	if (!text?.trim()) return {};
	const lower = text.toLowerCase();
	const addressMatch = text.match(/0x[a-fA-F0-9]{64}/);
	const coinTypeMatches = [
		...text.matchAll(/0x[a-fA-F0-9]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+/g),
	].map((entry) => entry[0]);
	const suiAmountMatch = text.match(/(\d+(?:\.\d+)?)\s*sui\b/i);
	const integerMatch = text.match(/\b\d+\b/);

	if (/(swap|兑换|换币|交易对)/i.test(lower)) {
		return {
			intentType: "sui.swap.cetus",
			inputCoinType: coinTypeMatches[0],
			outputCoinType: coinTypeMatches[1],
			amountRaw: integerMatch?.[0],
		};
	}

	if (/(transfer|send|转账|发送|转给|转)/i.test(lower)) {
		if (suiAmountMatch) {
			return {
				intentType: "sui.transfer.sui",
				toAddress: addressMatch?.[0],
				amountSui: Number(suiAmountMatch[1]),
			};
		}
		return {
			intentType: "sui.transfer.coin",
			toAddress: addressMatch?.[0],
			coinType: coinTypeMatches[0],
			amountRaw: integerMatch?.[0],
		};
	}

	return {};
}

function inferIntentType(params: WorkflowParams, parsed: ParsedIntentHints) {
	if (params.intentType) return params.intentType;
	if (parsed.intentType) return parsed.intentType;
	if (params.inputCoinType && params.outputCoinType) return "sui.swap.cetus";
	if (params.coinType) return "sui.transfer.coin";
	if (
		params.toAddress &&
		(params.amountSui != null || params.amountRaw != null)
	) {
		return "sui.transfer.sui";
	}
	throw new Error(
		"Cannot infer intentType. Provide intentType or enough structured fields.",
	);
}

function normalizeIntent(params: WorkflowParams): SuiWorkflowIntent {
	const parsed = parseIntentText(params.intentText);
	const intentType = inferIntentType(params, parsed);

	if (intentType === "sui.transfer.sui") {
		const toAddress = params.toAddress?.trim() || parsed.toAddress;
		const amountMist = params.amountRaw?.trim();
		const amountSui = params.amountSui ?? parsed.amountSui;
		if (!toAddress)
			throw new Error("toAddress is required for sui.transfer.sui");
		if (!amountMist && amountSui == null) {
			throw new Error("amountRaw(amountMist) or amountSui is required");
		}
		return {
			type: "sui.transfer.sui",
			toAddress,
			amountMist: amountMist || undefined,
			amountSui,
		};
	}

	if (intentType === "sui.transfer.coin") {
		const toAddress = params.toAddress?.trim() || parsed.toAddress;
		const coinType = params.coinType?.trim() || parsed.coinType;
		const amountRaw = params.amountRaw?.trim() || parsed.amountRaw;
		if (!toAddress)
			throw new Error("toAddress is required for sui.transfer.coin");
		if (!coinType)
			throw new Error("coinType is required for sui.transfer.coin");
		if (!amountRaw)
			throw new Error("amountRaw is required for sui.transfer.coin");
		return {
			type: "sui.transfer.coin",
			toAddress,
			coinType,
			amountRaw,
			maxCoinObjectsToMerge: params.maxCoinObjectsToMerge,
		};
	}

	const inputCoinType =
		params.inputCoinType?.trim() ||
		parsed.inputCoinType ||
		params.coinType?.trim();
	const outputCoinType = params.outputCoinType?.trim() || parsed.outputCoinType;
	const amountRaw = params.amountRaw?.trim() || parsed.amountRaw;
	if (!inputCoinType)
		throw new Error("inputCoinType is required for sui.swap.cetus");
	if (!outputCoinType)
		throw new Error("outputCoinType is required for sui.swap.cetus");
	if (!amountRaw) throw new Error("amountRaw is required for sui.swap.cetus");
	return {
		type: "sui.swap.cetus",
		inputCoinType,
		outputCoinType,
		amountRaw,
		byAmountIn: params.byAmountIn !== false,
		slippageBps: params.slippageBps ?? 100,
		providers: params.providers?.length ? params.providers : undefined,
		depth: params.depth,
		endpoint: params.endpoint?.trim() || undefined,
		apiKey: params.apiKey?.trim() || undefined,
	};
}

function createConfirmToken(
	runId: string,
	network: string,
	intent: SuiWorkflowIntent,
): string {
	const digest = createHash("sha256")
		.update(JSON.stringify({ runId, network, intent }))
		.digest("hex")
		.slice(0, 16)
		.toUpperCase();
	return `SUI-${digest}`;
}

function getSimulationStatus(simulation: unknown): {
	status: string;
	error: string | null;
} {
	const payload = simulation as {
		effects?: { status?: { status?: string; error?: string } };
		error?: string;
	};
	const status = payload.effects?.status?.status ?? "unknown";
	const error = payload.effects?.status?.error ?? payload.error ?? null;
	return { status, error };
}

function resolveRequestType(waitForLocalExecution?: boolean) {
	return waitForLocalExecution === false
		? "WaitForEffectsCert"
		: "WaitForLocalExecution";
}

function parseSlippageDecimal(slippageBps?: number): number {
	const bps = slippageBps ?? 100;
	if (!Number.isFinite(bps) || bps <= 0 || bps > 10_000) {
		throw new Error("slippageBps must be between 1 and 10000");
	}
	return bps / 10_000;
}

async function resolveCoinObjectIdsForAmount(
	client: ReturnType<typeof getSuiClient>,
	owner: string,
	coinType: string,
	amountRaw: bigint,
	maxCoinObjects: number,
): Promise<{
	selectedCoinObjectIds: string[];
	selectedBalanceRaw: bigint;
}> {
	let cursor: string | undefined;
	const selectedCoinObjectIds: string[] = [];
	let selectedBalanceRaw = 0n;

	while (
		selectedBalanceRaw < amountRaw &&
		selectedCoinObjectIds.length < maxCoinObjects
	) {
		const page = await client.getCoins({
			owner,
			coinType,
			cursor,
			limit: Math.min(100, maxCoinObjects - selectedCoinObjectIds.length),
		});

		if (!page.data.length) break;

		for (const coin of page.data) {
			const normalized = coin.balance.trim();
			if (!/^\d+$/.test(normalized)) continue;
			const balance = BigInt(normalized);
			if (balance <= 0n) continue;
			selectedCoinObjectIds.push(coin.coinObjectId);
			selectedBalanceRaw += balance;
			if (
				selectedBalanceRaw >= amountRaw ||
				selectedCoinObjectIds.length >= maxCoinObjects
			) {
				break;
			}
		}

		if (selectedBalanceRaw >= amountRaw) break;
		if (!page.hasNextPage || !page.nextCursor) break;
		cursor = page.nextCursor;
	}

	return {
		selectedCoinObjectIds,
		selectedBalanceRaw,
	};
}

async function buildSimulation(
	intent: SuiWorkflowIntent,
	network: SuiNetwork,
	signerAddress: string,
): Promise<{
	tx: Transaction;
	artifacts: Record<string, unknown>;
}> {
	const client = getSuiClient(network);

	if (intent.type === "sui.transfer.sui") {
		const amountMistRaw = intent.amountMist
			? parsePositiveBigInt(intent.amountMist, "amountMist").toString()
			: toMist(intent.amountSui ?? 0).toString();
		const tx = new Transaction();
		const [coin] = tx.splitCoins(tx.gas, [amountMistRaw]);
		tx.transferObjects([coin], intent.toAddress);
		return {
			tx,
			artifacts: {
				amountMist: amountMistRaw,
				toAddress: intent.toAddress,
			},
		};
	}

	if (intent.type === "sui.transfer.coin") {
		const amountRaw = parsePositiveBigInt(intent.amountRaw, "amountRaw");
		const maxCoinObjects = intent.maxCoinObjectsToMerge ?? 20;
		const { selectedCoinObjectIds, selectedBalanceRaw } =
			await resolveCoinObjectIdsForAmount(
				client,
				signerAddress,
				intent.coinType,
				amountRaw,
				maxCoinObjects,
			);
		if (!selectedCoinObjectIds.length || selectedBalanceRaw < amountRaw) {
			throw new Error(
				"Unable to build coin transfer simulation: insufficient coin objects",
			);
		}
		const primary = selectedCoinObjectIds[0];
		if (!primary) {
			throw new Error(
				"Unable to build coin transfer simulation: missing primary coin",
			);
		}
		const tx = new Transaction();
		if (selectedCoinObjectIds.length > 1) {
			tx.mergeCoins(primary, selectedCoinObjectIds.slice(1));
		}
		const [splitCoin] = tx.splitCoins(primary, [amountRaw.toString()]);
		tx.transferObjects([splitCoin], intent.toAddress);
		return {
			tx,
			artifacts: {
				coinType: intent.coinType,
				amountRaw: amountRaw.toString(),
				selectedCoinObjectIds,
				selectedBalanceRaw: selectedBalanceRaw.toString(),
			},
		};
	}

	const env = resolveAggregatorEnv(network);
	const routeClient = new AggregatorClient({
		env,
		endpoint: intent.endpoint,
		apiKey: intent.apiKey || process.env.CETUS_AGGREGATOR_API_KEY?.trim(),
		signer: signerAddress,
	});
	const route = await routeClient.findRouters({
		from: intent.inputCoinType,
		target: intent.outputCoinType,
		amount: parsePositiveBigInt(intent.amountRaw, "amountRaw").toString(),
		byAmountIn: intent.byAmountIn,
		providers: intent.providers,
		depth: intent.depth,
	});
	if (!route || route.insufficientLiquidity || route.paths.length === 0) {
		const errorMessage = route?.error
			? `${route.error.code}: ${route.error.msg}`
			: "No route found";
		throw new Error(`Unable to build swap simulation (${errorMessage})`);
	}
	const tx = new Transaction();
	await routeClient.fastRouterSwap({
		router: route,
		txb: tx as unknown as Parameters<
			AggregatorClient["fastRouterSwap"]
		>[0]["txb"],
		slippage: parseSlippageDecimal(intent.slippageBps),
	});
	return {
		tx,
		artifacts: {
			quoteId: route.quoteID ?? null,
			routeAmountIn: route.amountIn.toString(),
			routeAmountOut: route.amountOut.toString(),
			pathCount: route.paths.length,
			providersUsed: Array.from(
				new Set(route.paths.map((path) => path.provider)),
			),
		},
	};
}

function resolveExecutionTool(
	name: "sui_transferSui" | "sui_transferCoin" | "sui_swapCetus",
) {
	const tool = createSuiExecuteTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`Execution tool not found: ${name}`);
	return tool as unknown as {
		execute(
			toolCallId: string,
			params: Record<string, unknown>,
		): Promise<{ details?: unknown }>;
	};
}

async function executeIntent(
	intent: SuiWorkflowIntent,
	params: WorkflowParams,
	network: SuiNetwork,
) {
	if (intent.type === "sui.transfer.sui") {
		const tool = resolveExecutionTool("sui_transferSui");
		return tool.execute("wf-execute", {
			toAddress: intent.toAddress,
			amountMist: intent.amountMist,
			amountSui: intent.amountSui,
			network,
			fromPrivateKey: params.fromPrivateKey,
			waitForLocalExecution: params.waitForLocalExecution,
			confirmMainnet: params.confirmMainnet,
		});
	}
	if (intent.type === "sui.transfer.coin") {
		const tool = resolveExecutionTool("sui_transferCoin");
		return tool.execute("wf-execute", {
			toAddress: intent.toAddress,
			coinType: intent.coinType,
			amountRaw: intent.amountRaw,
			maxCoinObjectsToMerge: intent.maxCoinObjectsToMerge,
			network,
			fromPrivateKey: params.fromPrivateKey,
			waitForLocalExecution: params.waitForLocalExecution,
			confirmMainnet: params.confirmMainnet,
		});
	}
	const tool = resolveExecutionTool("sui_swapCetus");
	return tool.execute("wf-execute", {
		inputCoinType: intent.inputCoinType,
		outputCoinType: intent.outputCoinType,
		amountRaw: intent.amountRaw,
		byAmountIn: intent.byAmountIn,
		slippageBps: intent.slippageBps,
		providers: intent.providers,
		depth: intent.depth,
		endpoint: intent.endpoint,
		apiKey: intent.apiKey,
		network,
		fromPrivateKey: params.fromPrivateKey,
		waitForLocalExecution: params.waitForLocalExecution,
		confirmMainnet: params.confirmMainnet,
	});
}

export function createSuiWorkflowTools() {
	return [
		defineTool({
			name: "w3rt_run_sui_workflow_v0",
			label: "W3RT Sui Workflow v0",
			description:
				"Deterministic Sui workflow entrypoint: analysis -> simulate -> execute",
			parameters: Type.Object({
				runId: Type.Optional(Type.String()),
				runMode: workflowRunModeSchema(),
				intentType: Type.Optional(
					Type.Union([
						Type.Literal("sui.transfer.sui"),
						Type.Literal("sui.transfer.coin"),
						Type.Literal("sui.swap.cetus"),
					]),
				),
				intentText: Type.Optional(Type.String()),
				network: suiNetworkSchema(),
				toAddress: Type.Optional(Type.String()),
				amountSui: Type.Optional(Type.Number()),
				amountRaw: Type.Optional(Type.String()),
				coinType: Type.Optional(Type.String()),
				inputCoinType: Type.Optional(Type.String()),
				outputCoinType: Type.Optional(Type.String()),
				byAmountIn: Type.Optional(Type.Boolean()),
				slippageBps: Type.Optional(
					Type.Number({ minimum: 1, maximum: 10_000 }),
				),
				providers: Type.Optional(
					Type.Array(Type.String(), { minItems: 1, maxItems: 50 }),
				),
				depth: Type.Optional(Type.Number({ minimum: 1, maximum: 8 })),
				maxCoinObjectsToMerge: Type.Optional(
					Type.Number({ minimum: 1, maximum: 100 }),
				),
				endpoint: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				fromPrivateKey: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as WorkflowParams;
				const runId = createRunId(params.runId);
				const runMode = parseRunMode(params.runMode);
				const network = parseSuiNetwork(params.network);
				const intent = normalizeIntent(params);
				const needsMainnetConfirmation = network === "mainnet";
				const confirmToken = createConfirmToken(runId, network, intent);
				const plan = ["analysis", "simulate", "execute"];

				if (runMode === "analysis") {
					return {
						content: [
							{
								type: "text",
								text: `Workflow analyzed: ${intent.type}`,
							},
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation,
							confirmToken,
							artifacts: {
								analysis: {
									intent,
									plan,
								},
							},
						},
					};
				}

				if (runMode === "simulate") {
					const signer = resolveSuiKeypair(params.fromPrivateKey);
					const sender = signer.toSuiAddress();
					const { tx, artifacts } = await buildSimulation(
						intent,
						network,
						sender,
					);
					tx.setSender(sender);
					const client = getSuiClient(network);
					const simulation = await client.devInspectTransactionBlock({
						sender,
						transactionBlock: tx,
					});
					const { status, error } = getSimulationStatus(simulation);
					if (status !== "success") {
						throw new Error(
							`Simulation failed: ${error ?? "unknown error"} (intent=${intent.type})`,
						);
					}
					return {
						content: [
							{
								type: "text",
								text: `Workflow simulated: ${intent.type} status=${status}`,
							},
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation,
							confirmToken,
							artifacts: {
								simulate: {
									status,
									error,
									...artifacts,
								},
							},
						},
					};
				}

				if (needsMainnetConfirmation) {
					if (params.confirmMainnet !== true) {
						throw new Error(
							"Mainnet workflow execute is blocked. Set confirmMainnet=true.",
						);
					}
					if (!params.confirmToken || params.confirmToken !== confirmToken) {
						throw new Error(
							"Invalid confirmToken for mainnet execute. Run simulate first and pass returned confirmToken.",
						);
					}
				}

				const executeResult = await executeIntent(intent, params, network);
				return {
					content: [
						{
							type: "text",
							text: `Workflow executed: ${intent.type}`,
						},
					],
					details: {
						runId,
						runMode,
						network,
						intentType: intent.type,
						intent,
						needsMainnetConfirmation,
						confirmToken,
						requestType: resolveRequestType(params.waitForLocalExecution),
						artifacts: {
							execute: executeResult.details ?? null,
						},
					},
				};
			},
		}),
	];
}
