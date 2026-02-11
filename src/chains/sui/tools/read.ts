import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	SUI_COIN_TYPE,
	SUI_TOOL_PREFIX,
	formatCoinAmount,
	getSuiClient,
	getSuiRpcEndpoint,
	normalizeAtPath,
	parsePositiveBigInt,
	parseSuiNetwork,
	suiNetworkSchema,
} from "../runtime.js";

type SuiBalanceEntry = {
	coinType: string;
	coinObjectCount: number;
	totalBalance: string;
	lockedBalance: Record<string, string>;
	fundsInAddressBalance?: string;
};

function parseNonNegativeBigInt(value: string): bigint {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) {
		throw new Error("balance must be a non-negative integer string");
	}
	return BigInt(normalized);
}

function resolveAggregatorEnv(network: string): Env {
	if (network === "mainnet") return Env.Mainnet;
	if (network === "testnet") return Env.Testnet;
	throw new Error(
		"sui_getSwapQuote currently supports network=mainnet or testnet.",
	);
}

export function createSuiReadTools() {
	return [
		defineTool({
			name: `${SUI_TOOL_PREFIX}getBalance`,
			label: "Sui Get Balance",
			description:
				"Get owner balance for SUI or a specific coin type on Sui (mainnet/testnet/devnet/localnet)",
			parameters: Type.Object({
				owner: Type.String({ description: "Sui wallet/account address" }),
				coinType: Type.Optional(
					Type.String({
						description:
							"Coin type, defaults to 0x2::sui::SUI (e.g. 0x2::sui::SUI)",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override Sui JSON-RPC endpoint URL" }),
				),
			}),
			async execute(_toolCallId, params) {
				const owner = normalizeAtPath(params.owner);
				const network = parseSuiNetwork(params.network);
				const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
				const client = getSuiClient(network, params.rpcUrl);
				const balance = await client.getBalance({
					owner,
					coinType: params.coinType,
				});
				const coinType = balance.coinType || params.coinType || SUI_COIN_TYPE;
				const totalBalance = balance.totalBalance;
				const uiAmount =
					coinType === SUI_COIN_TYPE ? formatCoinAmount(totalBalance, 9) : null;

				const text =
					coinType === SUI_COIN_TYPE
						? `Balance: ${uiAmount} SUI (${totalBalance} MIST)`
						: `Balance: ${totalBalance} (${coinType})`;

				return {
					content: [{ type: "text", text }],
					details: {
						owner,
						coinType,
						totalBalance,
						uiAmount,
						coinObjectCount: balance.coinObjectCount,
						lockedBalance: balance.lockedBalance,
						network,
						rpcUrl,
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}getSwapQuote`,
			label: "Sui Get Swap Quote",
			description:
				"Get Sui swap quote via Cetus aggregator (mainnet/testnet), with route/provider details",
			parameters: Type.Object({
				fromCoinType: Type.String({
					description: "Input coin type, e.g. 0x2::sui::SUI",
				}),
				toCoinType: Type.String({
					description: "Output coin type, e.g. 0x...::usdc::USDC",
				}),
				amountRaw: Type.String({
					description: "Raw integer amount (u64-style string)",
				}),
				byAmountIn: Type.Optional(
					Type.Boolean({
						description:
							"true=fixed input amount (default), false=fixed output amount",
					}),
				),
				providers: Type.Optional(
					Type.Array(
						Type.String({
							description:
								"Optional provider filter (e.g. CETUS, TURBOS, DEEPBOOKV3)",
						}),
						{ minItems: 1, maxItems: 50 },
					),
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
			}),
			async execute(_toolCallId, params) {
				const network = parseSuiNetwork(params.network);
				const env = resolveAggregatorEnv(network);
				const amountRaw = parsePositiveBigInt(params.amountRaw, "amountRaw");
				const byAmountIn = params.byAmountIn !== false;
				const endpoint = params.endpoint?.trim() || undefined;
				const apiKey =
					params.apiKey?.trim() || process.env.CETUS_AGGREGATOR_API_KEY?.trim();
				const quoteClient = new AggregatorClient({
					env,
					endpoint,
					apiKey,
				});

				const route = await quoteClient.findRouters({
					from: params.fromCoinType.trim(),
					target: params.toCoinType.trim(),
					amount: amountRaw.toString(),
					byAmountIn,
					providers: params.providers?.length ? params.providers : undefined,
					depth: params.depth,
				});

				if (!route || route.insufficientLiquidity || route.paths.length === 0) {
					const errorMessage = route?.error
						? `${route.error.code}: ${route.error.msg}`
						: "No route found";
					return {
						content: [
							{
								type: "text",
								text: `No swap quote available (${errorMessage})`,
							},
						],
						details: {
							network,
							env,
							endpoint: endpoint ?? null,
							fromCoinType: params.fromCoinType.trim(),
							toCoinType: params.toCoinType.trim(),
							amountRaw: amountRaw.toString(),
							byAmountIn,
							insufficientLiquidity: route?.insufficientLiquidity ?? true,
							error: route?.error ?? null,
							pathCount: route?.paths.length ?? 0,
						},
					};
				}

				const amountIn = route.amountIn.toString();
				const amountOut = route.amountOut.toString();
				const routes = route.paths.map((path) => ({
					id: path.id,
					provider: path.provider,
					from: path.from,
					to: path.target,
					amountIn: path.amountIn,
					amountOut: path.amountOut,
					feeRate: path.feeRate,
					version: path.version ?? null,
					publishedAt: path.publishedAt ?? null,
				}));

				return {
					content: [
						{
							type: "text",
							text: `Swap quote: in=${amountIn} out=${amountOut} via ${routes.length} path(s)`,
						},
					],
					details: {
						network,
						env,
						endpoint: endpoint ?? null,
						fromCoinType: params.fromCoinType.trim(),
						toCoinType: params.toCoinType.trim(),
						requestAmountRaw: amountRaw.toString(),
						byAmountIn,
						amountIn,
						amountOut,
						insufficientLiquidity: false,
						deviationRatio: route.deviationRatio,
						overlayFee: route.overlayFee ?? null,
						quoteId: route.quoteID ?? null,
						pathCount: routes.length,
						routes,
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}getPortfolio`,
			label: "Sui Get Portfolio",
			description:
				"Get aggregated multi-asset balances for a Sui owner, with optional coin metadata",
			parameters: Type.Object({
				owner: Type.String({ description: "Sui wallet/account address" }),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override Sui JSON-RPC endpoint URL" }),
				),
				limit: Type.Optional(
					Type.Number({
						description:
							"Max number of assets returned after sorting by balance",
						minimum: 1,
						maximum: 200,
					}),
				),
				includeZeroBalances: Type.Optional(
					Type.Boolean({
						description: "Include zero-balance assets (default false)",
					}),
				),
				includeMetadata: Type.Optional(
					Type.Boolean({
						description:
							"Fetch coin metadata (symbol/decimals/name) (default true)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const owner = normalizeAtPath(params.owner);
				const network = parseSuiNetwork(params.network);
				const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
				const client = getSuiClient(network, params.rpcUrl);
				const includeZeroBalances = params.includeZeroBalances === true;
				const includeMetadata = params.includeMetadata !== false;
				const limit =
					typeof params.limit === "number"
						? Math.max(1, Math.min(200, Math.floor(params.limit)))
						: 50;

				const allBalances = await client.getAllBalances({ owner });
				const filteredBalances = allBalances
					.filter((entry) => {
						const amount = parseNonNegativeBigInt(entry.totalBalance);
						return includeZeroBalances || amount > 0n;
					})
					.sort((a, b) => {
						const aAmount = parseNonNegativeBigInt(a.totalBalance);
						const bAmount = parseNonNegativeBigInt(b.totalBalance);
						if (aAmount === bAmount)
							return a.coinType.localeCompare(b.coinType);
						return aAmount > bAmount ? -1 : 1;
					})
					.slice(0, limit);

				const metadataByCoinType = new Map<
					string,
					Awaited<ReturnType<typeof client.getCoinMetadata>>
				>();

				if (includeMetadata) {
					await Promise.all(
						filteredBalances.map(async (entry) => {
							try {
								const metadata = await client.getCoinMetadata({
									coinType: entry.coinType,
								});
								metadataByCoinType.set(entry.coinType, metadata);
							} catch {
								metadataByCoinType.set(entry.coinType, null);
							}
						}),
					);
				}

				const assets = filteredBalances.map((entry) => {
					const metadata = metadataByCoinType.get(entry.coinType) ?? null;
					const decimals =
						entry.coinType === SUI_COIN_TYPE
							? 9
							: typeof metadata?.decimals === "number"
								? metadata.decimals
								: null;
					const uiAmount =
						typeof decimals === "number"
							? formatCoinAmount(entry.totalBalance, decimals)
							: null;
					return {
						coinType: entry.coinType,
						totalBalance: entry.totalBalance,
						uiAmount,
						decimals,
						coinObjectCount: entry.coinObjectCount,
						lockedBalance: entry.lockedBalance,
						fundsInAddressBalance: entry.fundsInAddressBalance ?? null,
						metadata: metadata
							? {
									symbol: metadata.symbol,
									name: metadata.name,
									description: metadata.description,
									iconUrl: metadata.iconUrl,
								}
							: null,
					};
				});

				const suiAsset = assets.find(
					(entry) => entry.coinType === SUI_COIN_TYPE,
				);
				const totalCoinObjectCount = (
					filteredBalances as SuiBalanceEntry[]
				).reduce((sum, entry) => sum + entry.coinObjectCount, 0);
				const summary = suiAsset
					? `Portfolio: ${assets.length} assets (SUI=${suiAsset.uiAmount} / ${suiAsset.totalBalance} MIST)`
					: `Portfolio: ${assets.length} assets`;

				return {
					content: [{ type: "text", text: summary }],
					details: {
						owner,
						network,
						rpcUrl,
						assetCount: assets.length,
						totalCoinObjectCount,
						assets,
						suiBalance: suiAsset ?? null,
					},
				};
			},
		}),
	];
}
