import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";
import { Transaction } from "@mysten/sui/transactions";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	buildCetusFarmsHarvestTransaction,
	buildCetusFarmsStakeTransaction,
	buildCetusFarmsUnstakeTransaction,
	resolveCetusV2Network,
} from "../cetus-v2.js";
import {
	SUI_COIN_TYPE,
	SUI_TOOL_PREFIX,
	type SuiNetwork,
	formatCoinAmount,
	getSuiClient,
	getSuiExplorerTransactionUrl,
	getSuiRpcEndpoint,
	getSuiSignerLookupPaths,
	normalizeAtPath,
	parsePositiveBigInt,
	parseSuiNetwork,
	resolveSuiKeypair,
	suiNetworkSchema,
	toMist,
} from "../runtime.js";
import {
	STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
	buildStableLayerBurnTransaction,
	buildStableLayerClaimTransaction,
	buildStableLayerMintTransaction,
	resolveStableLayerNetwork,
} from "../stablelayer.js";

type SuiTransferParams = {
	toAddress: string;
	amountMist?: string;
	amountSui?: number;
	fromPrivateKey?: string;
	network?: string;
	rpcUrl?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
};

type SuiTransferCoinParams = {
	toAddress: string;
	coinType: string;
	amountRaw: string;
	fromPrivateKey?: string;
	network?: string;
	rpcUrl?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
	maxCoinObjectsToMerge?: number;
};

type SuiSwapCetusParams = {
	inputCoinType: string;
	outputCoinType: string;
	amountRaw: string;
	fromPrivateKey?: string;
	byAmountIn?: boolean;
	slippageBps?: number;
	providers?: string[];
	depth?: number;
	network?: string;
	endpoint?: string;
	apiKey?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
};

type SuiCetusAddLiquidityParams = {
	poolId: string;
	positionId?: string;
	fromPrivateKey?: string;
	coinTypeA: string;
	coinTypeB: string;
	tickLower: number;
	tickUpper: number;
	amountA: string;
	amountB: string;
	fixAmountA?: boolean;
	slippageBps?: number;
	collectFee?: boolean;
	rewarderCoinTypes?: string[];
	network?: string;
	rpcUrl?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
};

type SuiCetusRemoveLiquidityParams = {
	poolId: string;
	positionId: string;
	fromPrivateKey?: string;
	coinTypeA: string;
	coinTypeB: string;
	deltaLiquidity: string;
	minAmountA: string;
	minAmountB: string;
	collectFee?: boolean;
	rewarderCoinTypes?: string[];
	network?: string;
	rpcUrl?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
};

type SuiCetusFarmsStakeParams = {
	poolId: string;
	clmmPositionId: string;
	clmmPoolId: string;
	coinTypeA: string;
	coinTypeB: string;
	fromPrivateKey?: string;
	network?: string;
	rpcUrl?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
};

type SuiCetusFarmsUnstakeParams = {
	poolId: string;
	positionNftId: string;
	fromPrivateKey?: string;
	network?: string;
	rpcUrl?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
};

type SuiCetusFarmsHarvestParams = {
	poolId: string;
	positionNftId: string;
	fromPrivateKey?: string;
	network?: string;
	rpcUrl?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
};

type SuiStableLayerMintParams = {
	stableCoinType: string;
	amountUsdcRaw: string;
	fromPrivateKey?: string;
	usdcCoinType?: string;
	network?: string;
	rpcUrl?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
};

type SuiStableLayerBurnParams = {
	stableCoinType: string;
	amountStableRaw?: string;
	fromPrivateKey?: string;
	burnAll?: boolean;
	network?: string;
	rpcUrl?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
};

type SuiStableLayerClaimParams = {
	stableCoinType: string;
	fromPrivateKey?: string;
	network?: string;
	rpcUrl?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
};

type CetusClmmSdkLike = {
	Position: {
		createAddLiquidityFixTokenPayload(params: {
			pool_id: string;
			pos_id: string;
			coinTypeA: string;
			coinTypeB: string;
			tick_lower: number;
			tick_upper: number;
			amount_a: string;
			amount_b: string;
			slippage: number;
			fix_amount_a: boolean;
			is_open: boolean;
			collect_fee: boolean;
			rewarder_coin_types: string[];
		}): Promise<unknown>;
		removeLiquidityTransactionPayload(params: {
			pool_id: string;
			pos_id: string;
			coinTypeA: string;
			coinTypeB: string;
			delta_liquidity: string;
			min_amount_a: string;
			min_amount_b: string;
			collect_fee: boolean;
			rewarder_coin_types: string[];
		}): Promise<unknown>;
	};
};

type InitCetusSDKFn = (config: {
	network: "mainnet" | "testnet";
	fullNodeUrl: string;
	wallet: string;
}) => CetusClmmSdkLike;

let cachedInitCetusSDK: InitCetusSDKFn | null = null;

async function getInitCetusSDK(): Promise<InitCetusSDKFn> {
	if (cachedInitCetusSDK) return cachedInitCetusSDK;
	const moduleValue = await import("@cetusprotocol/cetus-sui-clmm-sdk");
	const candidate = (moduleValue as { initCetusSDK?: unknown }).initCetusSDK;
	if (typeof candidate !== "function") {
		throw new Error(
			"Failed to load @cetusprotocol/cetus-sui-clmm-sdk: initCetusSDK not found.",
		);
	}
	cachedInitCetusSDK = candidate as InitCetusSDKFn;
	return cachedInitCetusSDK;
}

function resolveTransferAmount(params: SuiTransferParams): bigint {
	if (params.amountMist != null) {
		return parsePositiveBigInt(params.amountMist, "amountMist");
	}
	if (params.amountSui != null) {
		return toMist(params.amountSui);
	}
	throw new Error("Provide amountMist or amountSui");
}

function resolveAggregatorEnv(network: string): Env {
	if (network === "mainnet") return Env.Mainnet;
	if (network === "testnet") return Env.Testnet;
	throw new Error(
		"Sui swap currently supports network=mainnet or testnet via Cetus aggregator.",
	);
}

function resolveCetusNetwork(network: SuiNetwork): "mainnet" | "testnet" {
	if (network === "mainnet" || network === "testnet") return network;
	throw new Error(
		"Cetus CLMM currently supports network=mainnet or testnet for LP operations.",
	);
}

type SuiSignerSource = "fromPrivateKey" | "SUI_PRIVATE_KEY" | "localKeystore";

function stringifyError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatSignerHintMessage(): string {
	const paths = getSuiSignerLookupPaths();
	return `Checked keystore=${paths.keystorePath}; activeAddress=${
		paths.activeAddress ?? "<not configured>"
	}; clientConfig=${paths.clientConfigPath}.`;
}

function resolveSuiExecutionSigner(fromPrivateKey?: string): {
	signer: Awaited<ReturnType<typeof resolveSuiKeypair>>;
	signerSource: SuiSignerSource;
} {
	const explicitPrivateKey = fromPrivateKey?.trim();
	if (explicitPrivateKey) {
		try {
			return {
				signer: resolveSuiKeypair(explicitPrivateKey),
				signerSource: "fromPrivateKey",
			};
		} catch (error) {
			throw new Error(
				`fromPrivateKey is invalid or unsupported for execute: ${stringifyError(
					error,
				)}. Provide a valid suiprivkey (ED25519) or use SUI_PRIVATE_KEY/local keystore.`,
			);
		}
	}

	const envPrivateKey = process.env.SUI_PRIVATE_KEY?.trim();
	if (envPrivateKey) {
		try {
			return {
				signer: resolveSuiKeypair(envPrivateKey),
				signerSource: "SUI_PRIVATE_KEY",
			};
		} catch (error) {
			throw new Error(
				`SUI_PRIVATE_KEY is configured but invalid for execute: ${stringifyError(
					error,
				)}. Set a valid ED25519 suiprivkey in SUI_PRIVATE_KEY or omit it to use local keystore.`,
			);
		}
	}

	try {
		return {
			signer: resolveSuiKeypair(),
			signerSource: "localKeystore",
		};
	} catch (error) {
		throw new Error(
			`No local signer available for execute: ${stringifyError(
				error,
			)}. ${formatSignerHintMessage()} Provide fromPrivateKey (suiprivkey) or place a valid ED25519 key in ${"local keystore"}.`,
		);
	}
}

function resolveRequestType(
	waitForLocalExecution?: boolean,
): "WaitForLocalExecution" | "WaitForEffectsCert" {
	return waitForLocalExecution === false
		? "WaitForEffectsCert"
		: "WaitForLocalExecution";
}

function assertMainnetExecutionConfirmed(
	network: string,
	confirmMainnet?: boolean,
): void {
	if (network === "mainnet" && confirmMainnet !== true) {
		throw new Error(
			"Mainnet execution is blocked. Set confirmMainnet=true to continue.",
		);
	}
}

function parseMaxCoinObjects(value: number | undefined): number {
	if (value == null) return 20;
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new Error("maxCoinObjectsToMerge must be an integer");
	}
	if (value < 1 || value > 100) {
		throw new Error("maxCoinObjectsToMerge must be between 1 and 100");
	}
	return value;
}

function parseSlippageDecimal(slippageBps?: number): number {
	const bps = slippageBps ?? 100;
	if (!Number.isFinite(bps) || bps <= 0) {
		throw new Error("slippageBps must be a positive number");
	}
	if (bps > 10_000) {
		throw new Error("slippageBps must be <= 10000");
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

		if (!page.data.length) {
			break;
		}

		for (const coin of page.data) {
			const normalizedBalance = coin.balance.trim();
			if (!/^\d+$/.test(normalizedBalance)) continue;
			const balance = BigInt(normalizedBalance);
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

export function createSuiExecuteTools() {
	return [
		defineTool({
			name: `${SUI_TOOL_PREFIX}transferSui`,
			label: "Sui Transfer SUI",
			description:
				"Sign and execute a native SUI transfer. Uses amountMist or amountSui.",
			parameters: Type.Object({
				toAddress: Type.String({ description: "Recipient Sui address" }),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Optional ED25519 private key for signing (suiprivkey...).",
					}),
				),
				amountMist: Type.Optional(
					Type.String({
						description: "Amount in MIST (u64 integer string), e.g. 1000000",
					}),
				),
				amountSui: Type.Optional(
					Type.Number({
						description: "Amount in SUI (up to 9 decimal places), e.g. 0.001",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override Sui JSON-RPC endpoint URL" }),
				),
				waitForLocalExecution: Type.Optional(
					Type.Boolean({
						description:
							"true: WaitForLocalExecution (default), false: WaitForEffectsCert",
					}),
				),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description:
							"Required as true when network=mainnet to prevent accidental broadcast",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);

				const { signer, signerSource } = resolveSuiExecutionSigner(
					params.fromPrivateKey,
				);
				const fromAddress = signer.toSuiAddress();
				const toAddress = normalizeAtPath(params.toAddress);
				const amountMist = resolveTransferAmount(params);
				const amountMistRaw = amountMist.toString();
				const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
				const client = getSuiClient(network, params.rpcUrl);
				const tx = new Transaction();

				const [coin] = tx.splitCoins(tx.gas, [amountMistRaw]);
				tx.transferObjects([coin], toAddress);

				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Sui transfer failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Transfer submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						signerSource,
						toAddress,
						amountMist: amountMistRaw,
						amountSui: formatCoinAmount(amountMistRaw, 9),
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						network,
						rpcUrl,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}transferCoin`,
			label: "Sui Transfer Coin",
			description:
				"Sign and execute a non-SUI coin transfer by merging coin objects as needed",
			parameters: Type.Object({
				toAddress: Type.String({ description: "Recipient Sui address" }),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Optional ED25519 private key for signing (suiprivkey...).",
					}),
				),
				coinType: Type.String({
					description:
						"Coin type to transfer (non-SUI), e.g. 0x...::coin::COIN",
				}),
				amountRaw: Type.String({
					description: "Raw integer amount to transfer",
				}),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override Sui JSON-RPC endpoint URL" }),
				),
				waitForLocalExecution: Type.Optional(
					Type.Boolean({
						description:
							"true: WaitForLocalExecution (default), false: WaitForEffectsCert",
					}),
				),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description:
							"Required as true when network=mainnet to prevent accidental broadcast",
					}),
				),
				maxCoinObjectsToMerge: Type.Optional(
					Type.Number({
						description:
							"Maximum coin objects to use when collecting transfer amount (1-100, default 20)",
						minimum: 1,
						maximum: 100,
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);

				const coinType = params.coinType.trim();
				if (coinType === SUI_COIN_TYPE) {
					throw new Error(
						"coinType=0x2::sui::SUI is not supported in sui_transferCoin. Use sui_transferSui.",
					);
				}

				const { signer, signerSource } = resolveSuiExecutionSigner(
					params.fromPrivateKey,
				);
				const fromAddress = signer.toSuiAddress();
				const toAddress = normalizeAtPath(params.toAddress);
				const amountRawBigInt = parsePositiveBigInt(
					params.amountRaw,
					"amountRaw",
				);
				const amountRaw = amountRawBigInt.toString();
				const maxCoinObjects = parseMaxCoinObjects(
					params.maxCoinObjectsToMerge,
				);
				const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
				const client = getSuiClient(network, params.rpcUrl);

				const { selectedCoinObjectIds, selectedBalanceRaw } =
					await resolveCoinObjectIdsForAmount(
						client,
						fromAddress,
						coinType,
						amountRawBigInt,
						maxCoinObjects,
					);

				if (!selectedCoinObjectIds.length) {
					throw new Error(
						`No coin objects found for coinType=${coinType} at owner=${fromAddress}`,
					);
				}
				if (selectedBalanceRaw < amountRawBigInt) {
					throw new Error(
						`Insufficient balance for ${coinType}. Need ${amountRaw}, found ${selectedBalanceRaw.toString()} using up to ${maxCoinObjects} coin objects.`,
					);
				}

				const tx = new Transaction();
				const primaryCoinId = selectedCoinObjectIds[0];
				if (!primaryCoinId) {
					throw new Error("No primary coin object selected");
				}
				if (selectedCoinObjectIds.length > 1) {
					tx.mergeCoins(primaryCoinId, selectedCoinObjectIds.slice(1));
				}
				const [splitCoin] = tx.splitCoins(primaryCoinId, [amountRaw]);
				tx.transferObjects([splitCoin], toAddress);

				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Sui coin transfer failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Coin transfer submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						signerSource,
						toAddress,
						coinType,
						amountRaw,
						selectedCoinObjectIds,
						selectedCoinObjectCount: selectedCoinObjectIds.length,
						selectedBalanceRaw: selectedBalanceRaw.toString(),
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						network,
						rpcUrl,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}swapCetus`,
			label: "Sui Swap (Cetus Aggregator)",
			description:
				"Find best route via Cetus aggregator and execute Sui swap (mainnet/testnet)",
			parameters: Type.Object({
				inputCoinType: Type.String({
					description: "Input coin type (e.g. 0x2::sui::SUI)",
				}),
				outputCoinType: Type.String({
					description: "Output coin type",
				}),
				amountRaw: Type.String({
					description: "Raw integer amount for quote/swap",
				}),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Optional ED25519 private key for signing (suiprivkey...).",
					}),
				),
				byAmountIn: Type.Optional(
					Type.Boolean({
						description:
							"true=fixed input amount (default), false=fixed output amount",
					}),
				),
				slippageBps: Type.Optional(
					Type.Number({
						description: "Slippage tolerance in bps (default 100 = 1%)",
						minimum: 1,
						maximum: 10_000,
					}),
				),
				providers: Type.Optional(
					Type.Array(Type.String(), {
						minItems: 1,
						maxItems: 50,
					}),
				),
				depth: Type.Optional(
					Type.Number({
						description: "Optional route search depth",
						minimum: 1,
						maximum: 8,
					}),
				),
				network: suiNetworkSchema(),
				endpoint: Type.Optional(
					Type.String({
						description:
							"Optional Cetus aggregator endpoint override (defaults to SDK endpoint)",
					}),
				),
				apiKey: Type.Optional(
					Type.String({
						description:
							"Optional API key (falls back to CETUS_AGGREGATOR_API_KEY env)",
					}),
				),
				waitForLocalExecution: Type.Optional(
					Type.Boolean({
						description:
							"true: WaitForLocalExecution (default), false: WaitForEffectsCert",
					}),
				),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description:
							"Required as true when network=mainnet to prevent accidental broadcast",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const env = resolveAggregatorEnv(network);
				const { signer, signerSource } = resolveSuiExecutionSigner(
					params.fromPrivateKey,
				);
				const fromAddress = signer.toSuiAddress();
				const amountRaw = parsePositiveBigInt(params.amountRaw, "amountRaw");
				const byAmountIn = params.byAmountIn !== false;
				const slippage = parseSlippageDecimal(params.slippageBps);
				const endpoint = params.endpoint?.trim() || undefined;
				const apiKey =
					params.apiKey?.trim() || process.env.CETUS_AGGREGATOR_API_KEY?.trim();
				const swapClient = new AggregatorClient({
					env,
					endpoint,
					apiKey,
					signer: fromAddress,
				});

				const route = await swapClient.findRouters({
					from: params.inputCoinType.trim(),
					target: params.outputCoinType.trim(),
					amount: amountRaw.toString(),
					byAmountIn,
					providers: params.providers?.length ? params.providers : undefined,
					depth: params.depth,
				});
				if (!route || route.insufficientLiquidity || route.paths.length === 0) {
					const errorMessage = route?.error
						? `${route.error.code}: ${route.error.msg}`
						: "No route found";
					throw new Error(`No swap route available (${errorMessage})`);
				}

				const tx = new Transaction();
				await swapClient.fastRouterSwap({
					router: route,
					txb: tx as unknown as Parameters<
						AggregatorClient["fastRouterSwap"]
					>[0]["txb"],
					slippage,
				});

				const rpcUrl = getSuiRpcEndpoint(network, undefined);
				const client = getSuiClient(network, undefined);
				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Sui swap failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Swap submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						signerSource,
						inputCoinType: params.inputCoinType.trim(),
						outputCoinType: params.outputCoinType.trim(),
						requestAmountRaw: amountRaw.toString(),
						byAmountIn,
						slippageBps: params.slippageBps ?? 100,
						routeAmountIn: route.amountIn.toString(),
						routeAmountOut: route.amountOut.toString(),
						quoteId: route.quoteID ?? null,
						pathCount: route.paths.length,
						providersUsed: Array.from(
							new Set(route.paths.map((p) => p.provider)),
						),
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						network,
						env,
						endpoint: endpoint ?? null,
						rpcUrl,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}cetusAddLiquidity`,
			label: "Sui Cetus Add Liquidity",
			description:
				"Add liquidity to an existing Cetus CLMM position using official Cetus SDK",
			parameters: Type.Object({
				poolId: Type.String({ description: "Cetus pool object id" }),
				positionId: Type.Optional(
					Type.String({ description: "Cetus position object id" }),
				),
				coinTypeA: Type.String({ description: "Pool coinTypeA" }),
				coinTypeB: Type.String({ description: "Pool coinTypeB" }),
				tickLower: Type.Number({ description: "Position lower tick index" }),
				tickUpper: Type.Number({ description: "Position upper tick index" }),
				amountA: Type.String({
					description: "Input amount for coin A (integer string)",
				}),
				amountB: Type.String({
					description: "Input amount for coin B (integer string)",
				}),
				fixAmountA: Type.Optional(
					Type.Boolean({
						description: "true=fixed amountA (default), false=fixed amountB",
					}),
				),
				slippageBps: Type.Optional(
					Type.Number({
						description: "Slippage in bps (default 100 = 1%)",
						minimum: 1,
						maximum: 10_000,
					}),
				),
				collectFee: Type.Optional(
					Type.Boolean({
						description: "Collect pending fees while adding liquidity",
					}),
				),
				rewarderCoinTypes: Type.Optional(
					Type.Array(Type.String(), { minItems: 0, maxItems: 16 }),
				),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Optional ED25519 private key for signing (suiprivkey...).",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const cetusNetwork = resolveCetusNetwork(network);
				const { signer, signerSource } = resolveSuiExecutionSigner(
					params.fromPrivateKey,
				);
				const fromAddress = signer.toSuiAddress();
				const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
				const initCetusSDK = await getInitCetusSDK();
				const positionId = params.positionId?.trim() ?? "";
				const isOpenPosition = !positionId;
				const sdk = initCetusSDK({
					network: cetusNetwork,
					fullNodeUrl: rpcUrl,
					wallet: fromAddress,
				});
				const tx = (await sdk.Position.createAddLiquidityFixTokenPayload({
					pool_id: params.poolId.trim(),
					pos_id: positionId,
					coinTypeA: params.coinTypeA.trim(),
					coinTypeB: params.coinTypeB.trim(),
					tick_lower: params.tickLower,
					tick_upper: params.tickUpper,
					amount_a: params.amountA.trim(),
					amount_b: params.amountB.trim(),
					slippage: parseSlippageDecimal(params.slippageBps),
					fix_amount_a: params.fixAmountA !== false,
					is_open: isOpenPosition,
					collect_fee: params.collectFee === true,
					rewarder_coin_types: params.rewarderCoinTypes ?? [],
				})) as Transaction;
				const client = getSuiClient(network, params.rpcUrl);
				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Cetus add liquidity failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Cetus add liquidity submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						signerSource,
						network,
						rpcUrl,
						cetusNetwork,
						poolId: params.poolId.trim(),
						positionId,
						coinTypeA: params.coinTypeA.trim(),
						coinTypeB: params.coinTypeB.trim(),
						tickLower: params.tickLower,
						tickUpper: params.tickUpper,
						amountA: params.amountA.trim(),
						amountB: params.amountB.trim(),
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}cetusRemoveLiquidity`,
			label: "Sui Cetus Remove Liquidity",
			description:
				"Remove liquidity from an existing Cetus CLMM position using official Cetus SDK",
			parameters: Type.Object({
				poolId: Type.String({ description: "Cetus pool object id" }),
				positionId: Type.String({ description: "Cetus position object id" }),
				coinTypeA: Type.String({ description: "Pool coinTypeA" }),
				coinTypeB: Type.String({ description: "Pool coinTypeB" }),
				deltaLiquidity: Type.String({
					description: "Liquidity delta to remove (integer string)",
				}),
				minAmountA: Type.String({
					description: "Min receive amount for coin A (integer string)",
				}),
				minAmountB: Type.String({
					description: "Min receive amount for coin B (integer string)",
				}),
				collectFee: Type.Optional(
					Type.Boolean({
						description: "Collect pending fees during remove",
					}),
				),
				rewarderCoinTypes: Type.Optional(
					Type.Array(Type.String(), { minItems: 0, maxItems: 16 }),
				),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Optional ED25519 private key for signing (suiprivkey...).",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const cetusNetwork = resolveCetusNetwork(network);
				const { signer, signerSource } = resolveSuiExecutionSigner(
					params.fromPrivateKey,
				);
				const fromAddress = signer.toSuiAddress();
				const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
				const initCetusSDK = await getInitCetusSDK();
				const sdk = initCetusSDK({
					network: cetusNetwork,
					fullNodeUrl: rpcUrl,
					wallet: fromAddress,
				});
				const tx = (await sdk.Position.removeLiquidityTransactionPayload({
					pool_id: params.poolId.trim(),
					pos_id: params.positionId.trim(),
					coinTypeA: params.coinTypeA.trim(),
					coinTypeB: params.coinTypeB.trim(),
					delta_liquidity: params.deltaLiquidity.trim(),
					min_amount_a: params.minAmountA.trim(),
					min_amount_b: params.minAmountB.trim(),
					collect_fee: params.collectFee !== false,
					rewarder_coin_types: params.rewarderCoinTypes ?? [],
				})) as Transaction;
				const client = getSuiClient(network, params.rpcUrl);
				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Cetus remove liquidity failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Cetus remove liquidity submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						signerSource,
						network,
						rpcUrl,
						cetusNetwork,
						poolId: params.poolId.trim(),
						positionId: params.positionId.trim(),
						coinTypeA: params.coinTypeA.trim(),
						coinTypeB: params.coinTypeB.trim(),
						deltaLiquidity: params.deltaLiquidity.trim(),
						minAmountA: params.minAmountA.trim(),
						minAmountB: params.minAmountB.trim(),
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}cetusFarmsStake`,
			label: "Sui Cetus Farms Stake",
			description:
				"Stake a Cetus CLMM position into Cetus v2 farms and submit on-chain transaction.",
			parameters: Type.Object({
				poolId: Type.String({ description: "Cetus farms pool id" }),
				clmmPositionId: Type.String({
					description: "Cetus CLMM position id to stake",
				}),
				clmmPoolId: Type.String({ description: "Related Cetus CLMM pool id" }),
				coinTypeA: Type.String({ description: "CLMM coinTypeA" }),
				coinTypeB: Type.String({ description: "CLMM coinTypeB" }),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Optional ED25519 private key for signing (suiprivkey...).",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiCetusFarmsStakeParams;
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const cetusNetwork = resolveCetusV2Network(network);
				const { signer, signerSource } = resolveSuiExecutionSigner(
					params.fromPrivateKey,
				);
				const fromAddress = signer.toSuiAddress();
				const tx = await buildCetusFarmsStakeTransaction({
					network: cetusNetwork,
					rpcUrl: params.rpcUrl?.trim(),
					sender: fromAddress,
					poolId: params.poolId,
					clmmPositionId: params.clmmPositionId,
					clmmPoolId: params.clmmPoolId,
					coinTypeA: params.coinTypeA,
					coinTypeB: params.coinTypeB,
				});
				const client = getSuiClient(network, params.rpcUrl);
				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Cetus farms stake failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Cetus farms stake submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						signerSource,
						network,
						cetusNetwork,
						rpcUrl: params.rpcUrl?.trim() ?? null,
						poolId: params.poolId.trim(),
						clmmPositionId: params.clmmPositionId.trim(),
						clmmPoolId: params.clmmPoolId.trim(),
						coinTypeA: params.coinTypeA.trim(),
						coinTypeB: params.coinTypeB.trim(),
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}cetusFarmsUnstake`,
			label: "Sui Cetus Farms Unstake",
			description:
				"Unstake a Cetus farms position NFT and submit on-chain transaction.",
			parameters: Type.Object({
				poolId: Type.String({ description: "Cetus farms pool id" }),
				positionNftId: Type.String({
					description: "Farms position NFT id returned by stake",
				}),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Optional ED25519 private key for signing (suiprivkey...).",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiCetusFarmsUnstakeParams;
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const cetusNetwork = resolveCetusV2Network(network);
				const { signer, signerSource } = resolveSuiExecutionSigner(
					params.fromPrivateKey,
				);
				const fromAddress = signer.toSuiAddress();
				const tx = await buildCetusFarmsUnstakeTransaction({
					network: cetusNetwork,
					rpcUrl: params.rpcUrl?.trim(),
					sender: fromAddress,
					poolId: params.poolId,
					positionNftId: params.positionNftId,
				});
				const client = getSuiClient(network, params.rpcUrl);
				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Cetus farms unstake failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Cetus farms unstake submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						signerSource,
						network,
						cetusNetwork,
						rpcUrl: params.rpcUrl?.trim() ?? null,
						poolId: params.poolId.trim(),
						positionNftId: params.positionNftId.trim(),
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}cetusFarmsHarvest`,
			label: "Sui Cetus Farms Harvest",
			description:
				"Harvest rewards from a Cetus farms position NFT and submit on-chain transaction.",
			parameters: Type.Object({
				poolId: Type.String({ description: "Cetus farms pool id" }),
				positionNftId: Type.String({
					description: "Farms position NFT id used for reward harvest",
				}),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Optional ED25519 private key for signing (suiprivkey...).",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiCetusFarmsHarvestParams;
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const cetusNetwork = resolveCetusV2Network(network);
				const { signer, signerSource } = resolveSuiExecutionSigner(
					params.fromPrivateKey,
				);
				const fromAddress = signer.toSuiAddress();
				const tx = await buildCetusFarmsHarvestTransaction({
					network: cetusNetwork,
					rpcUrl: params.rpcUrl?.trim(),
					sender: fromAddress,
					poolId: params.poolId,
					positionNftId: params.positionNftId,
				});
				const client = getSuiClient(network, params.rpcUrl);
				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Cetus farms harvest failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Cetus farms harvest submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						signerSource,
						network,
						cetusNetwork,
						rpcUrl: params.rpcUrl?.trim() ?? null,
						poolId: params.poolId.trim(),
						positionNftId: params.positionNftId.trim(),
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}stableLayerMint`,
			label: "Sui Stable Layer Mint",
			description:
				"Mint Stable Layer stable coin from USDC using stable-layer-sdk and submit on-chain transaction.",
			parameters: Type.Object({
				stableCoinType: Type.String({
					description: "Stable Layer coin type, e.g. 0x...::btc_usdc::BtcUSDC",
				}),
				amountUsdcRaw: Type.String({
					description: "USDC raw integer amount used for mint",
				}),
				usdcCoinType: Type.Optional(
					Type.String({
						description: `USDC coin type override (default ${STABLE_LAYER_DEFAULT_USDC_COIN_TYPE})`,
					}),
				),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Optional ED25519 private key for signing (suiprivkey...).",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiStableLayerMintParams;
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const stableLayerNetwork = resolveStableLayerNetwork(network);
				const amountUsdcRaw = parsePositiveBigInt(
					params.amountUsdcRaw,
					"amountUsdcRaw",
				);
				const { signer, signerSource } = resolveSuiExecutionSigner(
					params.fromPrivateKey,
				);
				const fromAddress = signer.toSuiAddress();
				const tx = await buildStableLayerMintTransaction({
					network: stableLayerNetwork,
					sender: fromAddress,
					stableCoinType: params.stableCoinType.trim(),
					amountUsdcRaw,
					usdcCoinType: params.usdcCoinType?.trim(),
					autoTransfer: true,
				});
				const client = getSuiClient(network, params.rpcUrl);
				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Stable Layer mint failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Stable Layer mint submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						signerSource,
						network,
						stableLayerNetwork,
						stableCoinType: params.stableCoinType.trim(),
						amountUsdcRaw: amountUsdcRaw.toString(),
						usdcCoinType:
							params.usdcCoinType?.trim() ||
							STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}stableLayerBurn`,
			label: "Sui Stable Layer Burn",
			description:
				"Burn Stable Layer stable coin to redeem USDC using stable-layer-sdk and submit on-chain transaction.",
			parameters: Type.Object({
				stableCoinType: Type.String({
					description: "Stable Layer coin type, e.g. 0x...::btc_usdc::BtcUSDC",
				}),
				amountStableRaw: Type.Optional(
					Type.String({
						description:
							"Stable coin raw integer amount to burn (required unless burnAll=true)",
					}),
				),
				burnAll: Type.Optional(
					Type.Boolean({
						description:
							"When true, burn all wallet balance for stableCoinType and ignore amountStableRaw",
					}),
				),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Optional ED25519 private key for signing (suiprivkey...).",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiStableLayerBurnParams;
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const stableLayerNetwork = resolveStableLayerNetwork(network);
				const burnAll = params.burnAll === true;
				const amountStableRaw = params.amountStableRaw?.trim()
					? parsePositiveBigInt(params.amountStableRaw, "amountStableRaw")
					: undefined;
				if (!burnAll && amountStableRaw == null) {
					throw new Error("amountStableRaw is required unless burnAll=true.");
				}
				const { signer, signerSource } = resolveSuiExecutionSigner(
					params.fromPrivateKey,
				);
				const fromAddress = signer.toSuiAddress();
				const tx = await buildStableLayerBurnTransaction({
					network: stableLayerNetwork,
					sender: fromAddress,
					stableCoinType: params.stableCoinType.trim(),
					amountStableRaw,
					burnAll,
					autoTransfer: true,
				});
				const client = getSuiClient(network, params.rpcUrl);
				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Stable Layer burn failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Stable Layer burn submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						signerSource,
						network,
						stableLayerNetwork,
						stableCoinType: params.stableCoinType.trim(),
						burnAll,
						amountStableRaw: amountStableRaw?.toString() ?? null,
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}stableLayerClaim`,
			label: "Sui Stable Layer Claim",
			description:
				"Claim Stable Layer rewards using stable-layer-sdk and submit on-chain transaction.",
			parameters: Type.Object({
				stableCoinType: Type.String({
					description: "Stable Layer coin type, e.g. 0x...::btc_usdc::BtcUSDC",
				}),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Optional ED25519 private key for signing (suiprivkey...).",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				waitForLocalExecution: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as SuiStableLayerClaimParams;
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);
				const stableLayerNetwork = resolveStableLayerNetwork(network);
				const { signer, signerSource } = resolveSuiExecutionSigner(
					params.fromPrivateKey,
				);
				const fromAddress = signer.toSuiAddress();
				const tx = await buildStableLayerClaimTransaction({
					network: stableLayerNetwork,
					sender: fromAddress,
					stableCoinType: params.stableCoinType.trim(),
					autoTransfer: true,
				});
				const client = getSuiClient(network, params.rpcUrl);
				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Stable Layer claim failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Stable Layer claim submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						signerSource,
						network,
						stableLayerNetwork,
						stableCoinType: params.stableCoinType.trim(),
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
	];
}
