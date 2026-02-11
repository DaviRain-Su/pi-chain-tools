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
	getSuiClient,
	getSuiRpcEndpoint,
	normalizeAtPath,
	parsePositiveBigInt,
	parseSuiNetwork,
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

type BuildTransferSuiParams = {
	fromAddress: string;
	toAddress: string;
	amountMist?: string;
	amountSui?: number;
	network?: string;
};

type BuildTransferCoinParams = {
	fromAddress: string;
	toAddress: string;
	coinType: string;
	amountRaw: string;
	network?: string;
	rpcUrl?: string;
	maxCoinObjectsToMerge?: number;
};

type BuildSwapCetusParams = {
	fromAddress: string;
	inputCoinType: string;
	outputCoinType: string;
	amountRaw: string;
	byAmountIn?: boolean;
	slippageBps?: number;
	providers?: string[];
	depth?: number;
	network?: string;
	endpoint?: string;
	apiKey?: string;
};

type BuildCetusAddLiquidityParams = {
	fromAddress: string;
	poolId: string;
	positionId: string;
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
};

type BuildCetusRemoveLiquidityParams = {
	fromAddress: string;
	poolId: string;
	positionId: string;
	coinTypeA: string;
	coinTypeB: string;
	deltaLiquidity: string;
	minAmountA: string;
	minAmountB: string;
	collectFee?: boolean;
	rewarderCoinTypes?: string[];
	network?: string;
	rpcUrl?: string;
};

type BuildCetusFarmsStakeParams = {
	fromAddress: string;
	poolId: string;
	clmmPositionId: string;
	clmmPoolId: string;
	coinTypeA: string;
	coinTypeB: string;
	network?: string;
	rpcUrl?: string;
};

type BuildCetusFarmsUnstakeParams = {
	fromAddress: string;
	poolId: string;
	positionNftId: string;
	network?: string;
	rpcUrl?: string;
};

type BuildCetusFarmsHarvestParams = {
	fromAddress: string;
	poolId: string;
	positionNftId: string;
	network?: string;
	rpcUrl?: string;
};

type BuildStableLayerMintParams = {
	fromAddress: string;
	stableCoinType: string;
	amountUsdcRaw: string;
	usdcCoinType?: string;
	network?: string;
};

type BuildStableLayerBurnParams = {
	fromAddress: string;
	stableCoinType: string;
	amountStableRaw?: string;
	burnAll?: boolean;
	network?: string;
};

type BuildStableLayerClaimParams = {
	fromAddress: string;
	stableCoinType: string;
	network?: string;
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

function resolveTransferAmount(params: BuildTransferSuiParams): bigint {
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
		"Sui swap compose currently supports network=mainnet or testnet via Cetus aggregator.",
	);
}

function resolveCetusNetwork(network: SuiNetwork): "mainnet" | "testnet" {
	if (network === "mainnet" || network === "testnet") return network;
	throw new Error(
		"Cetus CLMM compose currently supports network=mainnet or testnet.",
	);
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

function serializeTransactionPayload(transaction: unknown): string {
	if (!transaction || typeof transaction !== "object") {
		throw new Error("Transaction payload is empty");
	}
	const payload = transaction as { serialize?: unknown };
	if (typeof payload.serialize !== "function") {
		throw new Error("Transaction payload does not support serialize()");
	}
	return payload.serialize();
}

function maybeSetSender(transaction: unknown, sender: string): void {
	if (!transaction || typeof transaction !== "object") return;
	const payload = transaction as { setSender?: unknown };
	if (typeof payload.setSender === "function") {
		payload.setSender(sender);
	}
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

export function createSuiComposeTools() {
	return [
		defineTool({
			name: `${SUI_TOOL_PREFIX}buildTransferSuiTransaction`,
			label: "Sui Build Transfer SUI Transaction",
			description:
				"Build unsigned SUI transfer transaction payload (no broadcast).",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender Sui address (transaction sender)",
				}),
				toAddress: Type.String({
					description: "Recipient Sui address",
				}),
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
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as BuildTransferSuiParams;
				const network = parseSuiNetwork(params.network);
				const fromAddress = normalizeAtPath(params.fromAddress);
				const toAddress = normalizeAtPath(params.toAddress);
				const amountMist = resolveTransferAmount(params).toString();

				const tx = new Transaction();
				const [coin] = tx.splitCoins(tx.gas, [amountMist]);
				tx.transferObjects([coin], toAddress);
				tx.setSender(fromAddress);

				return {
					content: [
						{
							type: "text",
							text: `Built SUI transfer transaction: from=${fromAddress} to=${toAddress} amountMist=${amountMist}`,
						},
					],
					details: {
						network,
						fromAddress,
						toAddress,
						amountMist,
						serializedTransaction: tx.serialize(),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}buildTransferCoinTransaction`,
			label: "Sui Build Transfer Coin Transaction",
			description:
				"Build unsigned non-SUI coin transfer transaction payload with auto-merge coin selection (no broadcast).",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender Sui address (transaction sender)",
				}),
				toAddress: Type.String({
					description: "Recipient Sui address",
				}),
				coinType: Type.String({
					description: "Coin type, e.g. 0x2::usdc::USDC",
				}),
				amountRaw: Type.String({
					description: "Raw integer amount",
				}),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
				maxCoinObjectsToMerge: Type.Optional(
					Type.Number({ minimum: 1, maximum: 100 }),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as BuildTransferCoinParams;
				const network = parseSuiNetwork(params.network);
				const fromAddress = normalizeAtPath(params.fromAddress);
				const toAddress = normalizeAtPath(params.toAddress);
				const coinType = params.coinType.trim();
				if (coinType.toLowerCase() === SUI_COIN_TYPE.toLowerCase()) {
					throw new Error(
						"Use sui_buildTransferSuiTransaction for native SUI transfers.",
					);
				}

				const amountRaw = parsePositiveBigInt(params.amountRaw, "amountRaw");
				const maxCoinObjects = parseMaxCoinObjects(
					params.maxCoinObjectsToMerge,
				);
				const client = getSuiClient(network, params.rpcUrl);
				const { selectedCoinObjectIds, selectedBalanceRaw } =
					await resolveCoinObjectIdsForAmount(
						client,
						fromAddress,
						coinType,
						amountRaw,
						maxCoinObjects,
					);

				if (!selectedCoinObjectIds.length || selectedBalanceRaw < amountRaw) {
					throw new Error(
						`Insufficient ${coinType} balance in selected coin objects (${selectedBalanceRaw.toString()} < ${amountRaw.toString()})`,
					);
				}

				const primaryCoin = selectedCoinObjectIds[0];
				if (!primaryCoin) {
					throw new Error("Failed to pick primary coin object.");
				}

				const tx = new Transaction();
				if (selectedCoinObjectIds.length > 1) {
					tx.mergeCoins(primaryCoin, selectedCoinObjectIds.slice(1));
				}
				const [splitCoin] = tx.splitCoins(primaryCoin, [amountRaw.toString()]);
				tx.transferObjects([splitCoin], toAddress);
				tx.setSender(fromAddress);

				return {
					content: [
						{
							type: "text",
							text: `Built coin transfer transaction: coinType=${coinType} amountRaw=${amountRaw.toString()}`,
						},
					],
					details: {
						network,
						fromAddress,
						toAddress,
						coinType,
						amountRaw: amountRaw.toString(),
						selectedCoinObjectIds,
						selectedBalanceRaw: selectedBalanceRaw.toString(),
						serializedTransaction: tx.serialize(),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}buildSwapCetusTransaction`,
			label: "Sui Build Cetus Swap Transaction",
			description:
				"Build unsigned Sui swap transaction via Cetus aggregator route (no broadcast).",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender Sui address (transaction sender)",
				}),
				inputCoinType: Type.String({
					description: "Input coin type, e.g. 0x2::sui::SUI",
				}),
				outputCoinType: Type.String({
					description: "Output coin type, e.g. 0x...::usdc::USDC",
				}),
				amountRaw: Type.String({
					description: "Raw integer amount",
				}),
				byAmountIn: Type.Optional(
					Type.Boolean({
						description:
							"true=fixed input amount (default), false=fixed output amount",
					}),
				),
				slippageBps: Type.Optional(
					Type.Number({
						description: "Slippage in bps (default 100 = 1%)",
						minimum: 1,
						maximum: 10_000,
					}),
				),
				providers: Type.Optional(
					Type.Array(Type.String(), { minItems: 1, maxItems: 50 }),
				),
				depth: Type.Optional(Type.Number({ minimum: 1, maximum: 8 })),
				network: suiNetworkSchema(),
				endpoint: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as BuildSwapCetusParams;
				const network = parseSuiNetwork(params.network);
				const env = resolveAggregatorEnv(network);
				const fromAddress = normalizeAtPath(params.fromAddress);
				const amountRaw = parsePositiveBigInt(params.amountRaw, "amountRaw");
				const byAmountIn = params.byAmountIn !== false;
				const endpoint = params.endpoint?.trim() || undefined;
				const apiKey =
					params.apiKey?.trim() || process.env.CETUS_AGGREGATOR_API_KEY?.trim();
				const quoteClient = new AggregatorClient({
					env,
					endpoint,
					apiKey,
					signer: fromAddress,
				});
				const route = await quoteClient.findRouters({
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
					throw new Error(`Unable to build swap transaction (${errorMessage})`);
				}

				const tx = new Transaction();
				tx.setSender(fromAddress);
				await quoteClient.fastRouterSwap({
					router: route,
					txb: tx as unknown as Parameters<
						AggregatorClient["fastRouterSwap"]
					>[0]["txb"],
					slippage: parseSlippageDecimal(params.slippageBps),
				});

				return {
					content: [
						{
							type: "text",
							text: `Built Cetus swap transaction: in=${route.amountIn.toString()} out=${route.amountOut.toString()} paths=${route.paths.length}`,
						},
					],
					details: {
						network,
						fromAddress,
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
							new Set(route.paths.map((entry) => entry.provider)),
						),
						endpoint: endpoint ?? null,
						serializedTransaction: tx.serialize(),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}buildCetusAddLiquidityTransaction`,
			label: "Sui Build Cetus Add Liquidity Transaction",
			description:
				"Build unsigned Cetus add-liquidity transaction payload using official Cetus SDK (no broadcast).",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender Sui address (transaction sender)",
				}),
				poolId: Type.String({ description: "Cetus pool object id" }),
				positionId: Type.String({ description: "Cetus position object id" }),
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
				collectFee: Type.Optional(Type.Boolean()),
				rewarderCoinTypes: Type.Optional(
					Type.Array(Type.String(), { minItems: 0, maxItems: 16 }),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as BuildCetusAddLiquidityParams;
				const network = parseSuiNetwork(params.network);
				const cetusNetwork = resolveCetusNetwork(network);
				const fromAddress = normalizeAtPath(params.fromAddress);
				const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
				const initCetusSDK = await getInitCetusSDK();
				const sdk = initCetusSDK({
					network: cetusNetwork,
					fullNodeUrl: rpcUrl,
					wallet: fromAddress,
				});
				const tx = await sdk.Position.createAddLiquidityFixTokenPayload({
					pool_id: params.poolId.trim(),
					pos_id: params.positionId.trim(),
					coinTypeA: params.coinTypeA.trim(),
					coinTypeB: params.coinTypeB.trim(),
					tick_lower: params.tickLower,
					tick_upper: params.tickUpper,
					amount_a: params.amountA.trim(),
					amount_b: params.amountB.trim(),
					slippage: parseSlippageDecimal(params.slippageBps),
					fix_amount_a: params.fixAmountA !== false,
					is_open: false,
					collect_fee: params.collectFee === true,
					rewarder_coin_types: params.rewarderCoinTypes ?? [],
				});
				maybeSetSender(tx, fromAddress);

				return {
					content: [
						{
							type: "text",
							text: `Built Cetus add-liquidity transaction: pool=${params.poolId.trim()} position=${params.positionId.trim()}`,
						},
					],
					details: {
						network,
						cetusNetwork,
						rpcUrl,
						fromAddress,
						poolId: params.poolId.trim(),
						positionId: params.positionId.trim(),
						coinTypeA: params.coinTypeA.trim(),
						coinTypeB: params.coinTypeB.trim(),
						tickLower: params.tickLower,
						tickUpper: params.tickUpper,
						amountA: params.amountA.trim(),
						amountB: params.amountB.trim(),
						serializedTransaction: serializeTransactionPayload(tx),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}buildCetusRemoveLiquidityTransaction`,
			label: "Sui Build Cetus Remove Liquidity Transaction",
			description:
				"Build unsigned Cetus remove-liquidity transaction payload using official Cetus SDK (no broadcast).",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender Sui address (transaction sender)",
				}),
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
				collectFee: Type.Optional(Type.Boolean()),
				rewarderCoinTypes: Type.Optional(
					Type.Array(Type.String(), { minItems: 0, maxItems: 16 }),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as BuildCetusRemoveLiquidityParams;
				const network = parseSuiNetwork(params.network);
				const cetusNetwork = resolveCetusNetwork(network);
				const fromAddress = normalizeAtPath(params.fromAddress);
				const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
				const initCetusSDK = await getInitCetusSDK();
				const sdk = initCetusSDK({
					network: cetusNetwork,
					fullNodeUrl: rpcUrl,
					wallet: fromAddress,
				});
				const tx = await sdk.Position.removeLiquidityTransactionPayload({
					pool_id: params.poolId.trim(),
					pos_id: params.positionId.trim(),
					coinTypeA: params.coinTypeA.trim(),
					coinTypeB: params.coinTypeB.trim(),
					delta_liquidity: params.deltaLiquidity.trim(),
					min_amount_a: params.minAmountA.trim(),
					min_amount_b: params.minAmountB.trim(),
					collect_fee: params.collectFee !== false,
					rewarder_coin_types: params.rewarderCoinTypes ?? [],
				});
				maybeSetSender(tx, fromAddress);

				return {
					content: [
						{
							type: "text",
							text: `Built Cetus remove-liquidity transaction: pool=${params.poolId.trim()} position=${params.positionId.trim()}`,
						},
					],
					details: {
						network,
						cetusNetwork,
						rpcUrl,
						fromAddress,
						poolId: params.poolId.trim(),
						positionId: params.positionId.trim(),
						coinTypeA: params.coinTypeA.trim(),
						coinTypeB: params.coinTypeB.trim(),
						deltaLiquidity: params.deltaLiquidity.trim(),
						minAmountA: params.minAmountA.trim(),
						minAmountB: params.minAmountB.trim(),
						serializedTransaction: serializeTransactionPayload(tx),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}buildCetusFarmsStakeTransaction`,
			label: "Sui Build Cetus Farms Stake Transaction",
			description:
				"Build unsigned Cetus v2 farms stake transaction payload (mainnet/testnet, no broadcast).",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender Sui address (transaction sender)",
				}),
				poolId: Type.String({ description: "Cetus farms pool id" }),
				clmmPositionId: Type.String({
					description: "Cetus CLMM position id to stake",
				}),
				clmmPoolId: Type.String({ description: "Related Cetus CLMM pool id" }),
				coinTypeA: Type.String({ description: "CLMM coinTypeA" }),
				coinTypeB: Type.String({ description: "CLMM coinTypeB" }),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Optional fullnode URL override" }),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as BuildCetusFarmsStakeParams;
				const network = parseSuiNetwork(params.network);
				const cetusNetwork = resolveCetusV2Network(network);
				const fromAddress = normalizeAtPath(params.fromAddress);
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
				maybeSetSender(tx, fromAddress);
				return {
					content: [
						{
							type: "text",
							text: `Built Cetus farms stake transaction: pool=${params.poolId.trim()} clmmPosition=${params.clmmPositionId.trim()}`,
						},
					],
					details: {
						network,
						cetusNetwork,
						rpcUrl: params.rpcUrl?.trim() ?? null,
						fromAddress,
						poolId: params.poolId.trim(),
						clmmPositionId: params.clmmPositionId.trim(),
						clmmPoolId: params.clmmPoolId.trim(),
						coinTypeA: params.coinTypeA.trim(),
						coinTypeB: params.coinTypeB.trim(),
						serializedTransaction: serializeTransactionPayload(tx),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}buildCetusFarmsUnstakeTransaction`,
			label: "Sui Build Cetus Farms Unstake Transaction",
			description:
				"Build unsigned Cetus v2 farms unstake transaction payload (mainnet/testnet, no broadcast).",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender Sui address (transaction sender)",
				}),
				poolId: Type.String({ description: "Cetus farms pool id" }),
				positionNftId: Type.String({
					description: "Farms position NFT id returned after stake",
				}),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Optional fullnode URL override" }),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as BuildCetusFarmsUnstakeParams;
				const network = parseSuiNetwork(params.network);
				const cetusNetwork = resolveCetusV2Network(network);
				const fromAddress = normalizeAtPath(params.fromAddress);
				const tx = await buildCetusFarmsUnstakeTransaction({
					network: cetusNetwork,
					rpcUrl: params.rpcUrl?.trim(),
					sender: fromAddress,
					poolId: params.poolId,
					positionNftId: params.positionNftId,
				});
				maybeSetSender(tx, fromAddress);
				return {
					content: [
						{
							type: "text",
							text: `Built Cetus farms unstake transaction: pool=${params.poolId.trim()} positionNft=${params.positionNftId.trim()}`,
						},
					],
					details: {
						network,
						cetusNetwork,
						rpcUrl: params.rpcUrl?.trim() ?? null,
						fromAddress,
						poolId: params.poolId.trim(),
						positionNftId: params.positionNftId.trim(),
						serializedTransaction: serializeTransactionPayload(tx),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}buildCetusFarmsHarvestTransaction`,
			label: "Sui Build Cetus Farms Harvest Transaction",
			description:
				"Build unsigned Cetus v2 farms harvest transaction payload (mainnet/testnet, no broadcast).",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender Sui address (transaction sender)",
				}),
				poolId: Type.String({ description: "Cetus farms pool id" }),
				positionNftId: Type.String({
					description: "Farms position NFT id used for reward harvest",
				}),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Optional fullnode URL override" }),
				),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as BuildCetusFarmsHarvestParams;
				const network = parseSuiNetwork(params.network);
				const cetusNetwork = resolveCetusV2Network(network);
				const fromAddress = normalizeAtPath(params.fromAddress);
				const tx = await buildCetusFarmsHarvestTransaction({
					network: cetusNetwork,
					rpcUrl: params.rpcUrl?.trim(),
					sender: fromAddress,
					poolId: params.poolId,
					positionNftId: params.positionNftId,
				});
				maybeSetSender(tx, fromAddress);
				return {
					content: [
						{
							type: "text",
							text: `Built Cetus farms harvest transaction: pool=${params.poolId.trim()} positionNft=${params.positionNftId.trim()}`,
						},
					],
					details: {
						network,
						cetusNetwork,
						rpcUrl: params.rpcUrl?.trim() ?? null,
						fromAddress,
						poolId: params.poolId.trim(),
						positionNftId: params.positionNftId.trim(),
						serializedTransaction: serializeTransactionPayload(tx),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}buildStableLayerMintTransaction`,
			label: "Sui Build Stable Layer Mint Transaction",
			description:
				"Build unsigned Stable Layer mint transaction (USDC -> stable coin) using stable-layer-sdk (no broadcast).",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender Sui address (transaction sender)",
				}),
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
				network: suiNetworkSchema(),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as BuildStableLayerMintParams;
				const network = parseSuiNetwork(params.network);
				const stableLayerNetwork = resolveStableLayerNetwork(network);
				const fromAddress = normalizeAtPath(params.fromAddress);
				const amountUsdcRaw = parsePositiveBigInt(
					params.amountUsdcRaw,
					"amountUsdcRaw",
				);
				const tx = await buildStableLayerMintTransaction({
					network: stableLayerNetwork,
					sender: fromAddress,
					stableCoinType: params.stableCoinType.trim(),
					amountUsdcRaw,
					usdcCoinType: params.usdcCoinType?.trim(),
					autoTransfer: true,
				});
				maybeSetSender(tx, fromAddress);

				return {
					content: [
						{
							type: "text",
							text: `Built Stable Layer mint transaction: stableCoinType=${params.stableCoinType.trim()} amountUsdcRaw=${amountUsdcRaw.toString()}`,
						},
					],
					details: {
						network,
						stableLayerNetwork,
						fromAddress,
						stableCoinType: params.stableCoinType.trim(),
						amountUsdcRaw: amountUsdcRaw.toString(),
						usdcCoinType:
							params.usdcCoinType?.trim() ||
							STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
						serializedTransaction: serializeTransactionPayload(tx),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}buildStableLayerBurnTransaction`,
			label: "Sui Build Stable Layer Burn Transaction",
			description:
				"Build unsigned Stable Layer burn transaction (stable coin -> USDC) using stable-layer-sdk (no broadcast).",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender Sui address (transaction sender)",
				}),
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
				network: suiNetworkSchema(),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as BuildStableLayerBurnParams;
				const network = parseSuiNetwork(params.network);
				const stableLayerNetwork = resolveStableLayerNetwork(network);
				const fromAddress = normalizeAtPath(params.fromAddress);
				const burnAll = params.burnAll === true;
				const amountStableRaw = params.amountStableRaw?.trim()
					? parsePositiveBigInt(params.amountStableRaw, "amountStableRaw")
					: undefined;
				if (!burnAll && amountStableRaw == null) {
					throw new Error("amountStableRaw is required unless burnAll=true.");
				}
				const tx = await buildStableLayerBurnTransaction({
					network: stableLayerNetwork,
					sender: fromAddress,
					stableCoinType: params.stableCoinType.trim(),
					amountStableRaw,
					burnAll,
					autoTransfer: true,
				});
				maybeSetSender(tx, fromAddress);

				return {
					content: [
						{
							type: "text",
							text: `Built Stable Layer burn transaction: stableCoinType=${params.stableCoinType.trim()} burnAll=${burnAll}${amountStableRaw ? ` amountStableRaw=${amountStableRaw.toString()}` : ""}`,
						},
					],
					details: {
						network,
						stableLayerNetwork,
						fromAddress,
						stableCoinType: params.stableCoinType.trim(),
						burnAll,
						amountStableRaw: amountStableRaw?.toString() ?? null,
						serializedTransaction: serializeTransactionPayload(tx),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}buildStableLayerClaimTransaction`,
			label: "Sui Build Stable Layer Claim Transaction",
			description:
				"Build unsigned Stable Layer claim rewards transaction using stable-layer-sdk (no broadcast).",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender Sui address (transaction sender)",
				}),
				stableCoinType: Type.String({
					description: "Stable Layer coin type, e.g. 0x...::btc_usdc::BtcUSDC",
				}),
				network: suiNetworkSchema(),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as BuildStableLayerClaimParams;
				const network = parseSuiNetwork(params.network);
				const stableLayerNetwork = resolveStableLayerNetwork(network);
				const fromAddress = normalizeAtPath(params.fromAddress);
				const tx = await buildStableLayerClaimTransaction({
					network: stableLayerNetwork,
					sender: fromAddress,
					stableCoinType: params.stableCoinType.trim(),
					autoTransfer: true,
				});
				maybeSetSender(tx, fromAddress);

				return {
					content: [
						{
							type: "text",
							text: `Built Stable Layer claim transaction: stableCoinType=${params.stableCoinType.trim()}`,
						},
					],
					details: {
						network,
						stableLayerNetwork,
						fromAddress,
						stableCoinType: params.stableCoinType.trim(),
						serializedTransaction: serializeTransactionPayload(tx),
					},
				};
			},
		}),
	];
}
