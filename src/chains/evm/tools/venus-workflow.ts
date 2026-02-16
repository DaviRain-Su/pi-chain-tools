/**
 * Venus Protocol workflow — deterministic analysis → simulate → execute.
 *
 * `w3rt_run_evm_venus_workflow_v0`
 *
 * - analysis: read markets + position, recommend action
 * - simulate: build calldata, preview gas estimate
 * - execute: sign + broadcast (with confirmMainnet + confirmToken gates)
 */

import { createHash } from "node:crypto";
import { Wallet } from "@ethersproject/wallet";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { resolveWorkflowRunMode } from "../../shared/workflow-runtime.js";
import { isMainnetLikeEvmNetwork } from "../policy.js";
import {
	EVM_TOOL_PREFIX,
	type EvmNetwork,
	evmHttpJson,
	evmNetworkSchema,
	getEvmChainId,
	getEvmRpcEndpoint,
	parseEvmNetwork,
	parsePositiveIntegerString,
} from "../runtime.js";
import type { EvmCallData } from "./lending-types.js";
import { VENUS_MARKET_REGISTRY, createVenusAdapter } from "./venus-adapter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VenusWorkflowRunMode = "analysis" | "simulate" | "execute";

type VenusIntentType =
	| "evm.venus.supply"
	| "evm.venus.borrow"
	| "evm.venus.repay"
	| "evm.venus.withdraw"
	| "evm.venus.enterMarkets";

type VenusWorkflowIntent = {
	type: VenusIntentType;
	tokenAddress?: string;
	marketAddress?: string;
	marketAddresses?: string[];
	amountRaw?: string;
};

type WorkflowSessionRecord = {
	runId: string;
	network: EvmNetwork;
	intent: VenusWorkflowIntent;
	calldata: EvmCallData[];
	confirmToken: string | null;
};

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

const SESSION_BY_RUN_ID = new Map<string, WorkflowSessionRecord>();
let latestSession: WorkflowSessionRecord | null = null;

function createRunId(input?: string): string {
	if (input?.trim()) return input.trim();
	const nonce = Math.random().toString(36).slice(2, 8);
	return `wf-evm-venus-${Date.now().toString(36)}-${nonce}`;
}

function rememberSession(record: WorkflowSessionRecord): void {
	SESSION_BY_RUN_ID.set(record.runId, record);
	latestSession = record;
}

function readSession(runId?: string): WorkflowSessionRecord | null {
	if (runId?.trim()) {
		return SESSION_BY_RUN_ID.get(runId.trim()) ?? null;
	}
	return latestSession;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateConfirmToken(
	runId: string,
	network: EvmNetwork,
	intent: VenusWorkflowIntent,
): string {
	const payload = JSON.stringify({ runId, network, intent });
	const hash = createHash("sha256").update(payload).digest("hex").slice(0, 16);
	return `EVM-VENUS-${hash.toUpperCase()}`;
}

function parseEvmAddress(value: string, fieldName: string): string {
	const normalized = value.trim();
	if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
		throw new Error(`${fieldName} must be a valid EVM address (0x + 40 hex)`);
	}
	return normalized;
}

function resolveEvmPrivateKey(input?: string): string {
	const key =
		input?.trim() ||
		process.env.EVM_PRIVATE_KEY?.trim() ||
		process.env.POLYMARKET_PRIVATE_KEY?.trim() ||
		"";
	if (!key) {
		throw new Error(
			"No EVM private key provided. Set fromPrivateKey or EVM_PRIVATE_KEY.",
		);
	}
	return key;
}

function toHexQuantity(value: bigint): string {
	if (value === 0n) return "0x0";
	return `0x${value.toString(16)}`;
}

type JsonRpcResponse<T> = {
	result?: T;
	error?: { message?: string };
};

async function callEvmRpc<T>(
	rpcUrl: string,
	method: string,
	params: unknown[],
): Promise<T> {
	const payload = await evmHttpJson<JsonRpcResponse<T>>({
		url: rpcUrl,
		method: "POST",
		body: {
			jsonrpc: "2.0",
			id: `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
			method,
			params,
		},
	});
	if (payload.error) {
		const msg =
			typeof payload.error === "object" && payload.error.message
				? payload.error.message
				: JSON.stringify(payload.error);
		throw new Error(`RPC ${method} failed: ${msg}`);
	}
	if (payload.result == null) {
		throw new Error(`RPC ${method} returned empty result`);
	}
	return payload.result;
}

function parseHexQuantity(hex: string, label: string): bigint {
	const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
	if (!cleaned) throw new Error(`${label}: empty hex value`);
	return BigInt(`0x${cleaned}`);
}

/** Resolve known Venus token symbol to underlying address. */
function resolveVenusTokenSymbol(input?: string): string | undefined {
	if (!input?.trim()) return undefined;
	const upper = input.trim().toUpperCase();
	for (const entry of Object.values(VENUS_MARKET_REGISTRY)) {
		if (entry.symbol.toUpperCase() === upper) return entry.underlying;
	}
	return undefined;
}

/** Resolve known Venus token symbol to vToken address. */
function resolveVenusMarketSymbol(input?: string): string | undefined {
	if (!input?.trim()) return undefined;
	const upper = input.trim().toUpperCase();
	// Try direct key match first (vUSDC, vBNB, etc.)
	const withPrefix = upper.startsWith("V") ? upper : `V${upper}`;
	for (const [key, entry] of Object.entries(VENUS_MARKET_REGISTRY)) {
		if (key.toUpperCase() === withPrefix || key.toUpperCase() === upper) {
			return entry.vToken;
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Intent parsing
// ---------------------------------------------------------------------------

function parseIntent(params: Record<string, unknown>): VenusWorkflowIntent {
	const intentType = params.intentType as VenusIntentType | undefined;
	if (!intentType) {
		throw new Error(
			"intentType is required (evm.venus.supply | evm.venus.borrow | evm.venus.repay | evm.venus.withdraw | evm.venus.enterMarkets)",
		);
	}

	const tokenAddressRaw = params.tokenAddress as string | undefined;
	const tokenSymbol = params.tokenSymbol as string | undefined;
	const marketAddressRaw = params.marketAddress as string | undefined;
	const marketAddressesRaw = params.marketAddresses as string[] | undefined;
	const amountRaw = params.amountRaw as string | undefined;

	// Resolve symbol → address for convenience
	const tokenAddress =
		tokenAddressRaw?.trim() || resolveVenusTokenSymbol(tokenSymbol);
	const marketAddress =
		marketAddressRaw?.trim() || resolveVenusMarketSymbol(tokenSymbol);

	switch (intentType) {
		case "evm.venus.supply":
		case "evm.venus.repay":
		case "evm.venus.withdraw":
			if (!tokenAddress) {
				throw new Error(
					`${intentType} requires tokenAddress or tokenSymbol (BNB/USDC/USDT/BTCB/ETH)`,
				);
			}
			if (!amountRaw) {
				throw new Error(`${intentType} requires amountRaw`);
			}
			return { type: intentType, tokenAddress, amountRaw };

		case "evm.venus.borrow":
			if (!marketAddress) {
				throw new Error(
					`${intentType} requires marketAddress or tokenSymbol (BNB/USDC/USDT/BTCB/ETH)`,
				);
			}
			if (!amountRaw) {
				throw new Error(`${intentType} requires amountRaw`);
			}
			return { type: intentType, marketAddress, amountRaw };

		case "evm.venus.enterMarkets":
			if (!marketAddressesRaw || marketAddressesRaw.length === 0) {
				throw new Error(`${intentType} requires marketAddresses (array)`);
			}
			return {
				type: intentType,
				marketAddresses: marketAddressesRaw.map((a, i) =>
					parseEvmAddress(a, `marketAddresses[${i}]`),
				),
			};

		default:
			throw new Error(`Unknown Venus intent type: ${intentType}`);
	}
}

// ---------------------------------------------------------------------------
// Build calldata from intent
// ---------------------------------------------------------------------------

function requireField<T>(value: T | undefined | null, name: string): T {
	if (value == null) {
		throw new Error(`Missing required intent field: ${name}`);
	}
	return value;
}

async function buildCalldata(
	network: EvmNetwork,
	intent: VenusWorkflowIntent,
): Promise<EvmCallData[]> {
	const adapter = createVenusAdapter();
	const placeholder = "0x0000000000000000000000000000000000000000";

	switch (intent.type) {
		case "evm.venus.supply":
			return adapter.buildSupplyCalldata({
				network,
				account: placeholder,
				tokenAddress: requireField(intent.tokenAddress, "tokenAddress"),
				amountRaw: requireField(intent.amountRaw, "amountRaw"),
			});

		case "evm.venus.borrow": {
			const cd = await adapter.buildBorrowCalldata({
				network,
				account: placeholder,
				marketAddress: requireField(intent.marketAddress, "marketAddress"),
				amountRaw: requireField(intent.amountRaw, "amountRaw"),
			});
			return [cd];
		}

		case "evm.venus.repay":
			return adapter.buildRepayCalldata({
				network,
				account: placeholder,
				tokenAddress: requireField(intent.tokenAddress, "tokenAddress"),
				amountRaw: requireField(intent.amountRaw, "amountRaw"),
			});

		case "evm.venus.withdraw": {
			const cd = await adapter.buildWithdrawCalldata({
				network,
				account: placeholder,
				tokenAddress: requireField(intent.tokenAddress, "tokenAddress"),
				amountRaw: requireField(intent.amountRaw, "amountRaw"),
			});
			return [cd];
		}

		case "evm.venus.enterMarkets": {
			const cd = await adapter.buildEnterMarketCalldata({
				network,
				account: placeholder,
				marketAddresses: requireField(
					intent.marketAddresses,
					"marketAddresses",
				),
			});
			return [cd];
		}

		default:
			throw new Error(`Cannot build calldata for intent: ${intent.type}`);
	}
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function createVenusWorkflowTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}venusWorkflow`,
			label: "Venus Protocol Workflow",
			description:
				"Deterministic Venus Protocol workflow: analysis → simulate → execute. Supports supply, borrow, repay, withdraw, enterMarkets on BSC.",
			parameters: Type.Object({
				runId: Type.Optional(Type.String()),
				runMode: Type.Optional(
					Type.Union([
						Type.Literal("analysis"),
						Type.Literal("simulate"),
						Type.Literal("execute"),
					]),
				),
				network: evmNetworkSchema(),
				intentType: Type.Optional(
					Type.Union([
						Type.Literal("evm.venus.supply"),
						Type.Literal("evm.venus.borrow"),
						Type.Literal("evm.venus.repay"),
						Type.Literal("evm.venus.withdraw"),
						Type.Literal("evm.venus.enterMarkets"),
					]),
				),
				intentText: Type.Optional(Type.String()),
				tokenAddress: Type.Optional(Type.String()),
				tokenSymbol: Type.Optional(
					Type.String({
						description: "Token symbol shorthand: BNB/USDC/USDT/BTCB/ETH",
					}),
				),
				marketAddress: Type.Optional(Type.String()),
				marketAddresses: Type.Optional(Type.Array(Type.String())),
				amountRaw: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
				fromPrivateKey: Type.Optional(Type.String()),
				account: Type.Optional(
					Type.String({
						description: "Account address for analysis (position read)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const runMode = resolveWorkflowRunMode(
					params.runMode,
					params.intentText,
				) as VenusWorkflowRunMode;

				// =============================================================
				// ANALYSIS
				// =============================================================
				if (runMode === "analysis") {
					const runId = createRunId(params.runId);
					const adapter = createVenusAdapter();

					// Read markets
					const markets = await adapter.getMarkets(network);

					// Optionally read position
					let position = null;
					if (params.account?.trim()) {
						position = await adapter.getAccountPosition(
							network,
							params.account.trim(),
						);
					}

					const intent = params.intentType ? parseIntent(params) : undefined;

					return {
						content: [
							{
								type: "text",
								text: `Venus analysis (${network}): ${markets.length} markets.${position ? ` Position LTV=${(position.currentLTV * 100).toFixed(2)}%` : ""} runId=${runId}`,
							},
						],
						details: {
							schema: "evm.venus.workflow.analysis.v1",
							runMode: "analysis",
							runId,
							network,
							protocol: "venus",
							marketsCount: markets.length,
							markets: markets.map((m) => ({
								underlyingSymbol: m.underlyingSymbol,
								marketAddress: m.marketAddress,
								supplyAPY: `${m.supplyAPY.toFixed(2)}%`,
								borrowAPY: `${m.borrowAPY.toFixed(2)}%`,
								collateralFactor: `${(m.collateralFactor * 100).toFixed(0)}%`,
								isListed: m.isListed,
							})),
							position: position
								? {
										account: position.account,
										supplies: position.supplies.length,
										borrows: position.borrows.length,
										currentLTV: `${(position.currentLTV * 100).toFixed(2)}%`,
										healthFactor:
											position.healthFactor === Number.POSITIVE_INFINITY
												? "∞"
												: position.healthFactor.toFixed(4),
									}
								: null,
							intent: intent ?? null,
							nextStep:
								"Run with runMode=simulate to preview transaction calldata.",
						},
					};
				}

				// =============================================================
				// SIMULATE
				// =============================================================
				if (runMode === "simulate") {
					const runId = createRunId(params.runId);
					const intent = parseIntent(params);
					const calldata = await buildCalldata(network, intent);
					const mainnetLike = isMainnetLikeEvmNetwork(network);
					const confirmToken = mainnetLike
						? generateConfirmToken(runId, network, intent)
						: null;

					rememberSession({
						runId,
						network,
						intent,
						calldata,
						confirmToken,
					});

					return {
						content: [
							{
								type: "text",
								text: `Venus simulate (${network}): ${calldata.length} step(s). runId=${runId}${confirmToken ? ` confirmToken=${confirmToken}` : ""}`,
							},
						],
						details: {
							schema: "evm.venus.workflow.simulate.v1",
							runMode: "simulate",
							runId,
							network,
							protocol: "venus",
							intent,
							stepsCount: calldata.length,
							steps: calldata.map((c) => ({
								to: c.to,
								data: c.data,
								value: c.value,
								description: c.description,
							})),
							mainnetLike,
							confirmToken,
							approvalRequired: mainnetLike,
							nextStep: mainnetLike
								? `Run with runMode=execute, confirmMainnet=true, confirmToken="${confirmToken}", runId="${runId}"`
								: `Run with runMode=execute, runId="${runId}"`,
						},
					};
				}

				// =============================================================
				// EXECUTE
				// =============================================================
				if (runMode === "execute") {
					const session = readSession(params.runId);
					if (!session) {
						throw new Error(
							"No simulate session found. Run simulate first to preview calldata.",
						);
					}

					const mainnetLike = isMainnetLikeEvmNetwork(session.network);
					if (mainnetLike) {
						if (params.confirmMainnet !== true) {
							throw new Error(
								"BSC mainnet execution requires confirmMainnet=true.",
							);
						}
						if (
							session.confirmToken &&
							params.confirmToken !== session.confirmToken
						) {
							throw new Error(
								`Invalid confirmToken. Expected: ${session.confirmToken}`,
							);
						}
					}

					const privateKey = resolveEvmPrivateKey(params.fromPrivateKey);
					const signer = new Wallet(privateKey);
					const rpcUrl = getEvmRpcEndpoint(session.network);
					const chainId = getEvmChainId(session.network);
					const fromAddress = signer.address;

					const txHashes: string[] = [];
					const descriptions: string[] = [];
					let nonce = await (async () => {
						const hex = await callEvmRpc<string>(
							rpcUrl,
							"eth_getTransactionCount",
							[fromAddress, "pending"],
						);
						return parseHexQuantity(hex, "nonce");
					})();

					for (const cd of session.calldata) {
						const gasPriceHex = await callEvmRpc<string>(
							rpcUrl,
							"eth_gasPrice",
							[],
						);
						const gasPrice = parseHexQuantity(gasPriceHex, "gasPrice");

						const gasLimitHex = await callEvmRpc<string>(
							rpcUrl,
							"eth_estimateGas",
							[
								{
									from: fromAddress,
									to: cd.to,
									data: cd.data,
									value: cd.value ?? "0x0",
								},
							],
						);
						const gasLimit = parseHexQuantity(gasLimitHex, "gasLimit");

						const signedTx = await signer.signTransaction({
							to: cd.to,
							nonce: Number(nonce),
							chainId,
							value: cd.value ?? "0x0",
							gasPrice: toHexQuantity(gasPrice),
							gasLimit: toHexQuantity(gasLimit),
							data: cd.data,
						});

						const txHash = await callEvmRpc<string>(
							rpcUrl,
							"eth_sendRawTransaction",
							[signedTx],
						);

						txHashes.push(txHash);
						descriptions.push(cd.description);
						nonce += 1n;
					}

					return {
						content: [
							{
								type: "text",
								text: `Venus execute (${session.network}): ${txHashes.length} tx(s) submitted. ${txHashes.join(", ")}`,
							},
						],
						details: {
							schema: "evm.venus.workflow.execute.v1",
							runMode: "execute",
							runId: session.runId,
							network: session.network,
							protocol: "venus",
							intent: session.intent,
							fromAddress,
							txHashes,
							descriptions,
							stepsCount: txHashes.length,
						},
					};
				}

				throw new Error(`Unknown runMode: ${runMode}`);
			},
		}),
	];
}
