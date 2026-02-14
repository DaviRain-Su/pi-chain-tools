import { Wallet } from "@ethersproject/wallet";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	getPolymarketClobBaseUrl,
	getPolymarketGeoblockStatus,
	getPolymarketMarketBySlug,
	getPolymarketOrderBook,
	parseUsdStake,
	resolveBtc5mTradeSelection,
} from "../polymarket.js";
import {
	EVM_TOOL_PREFIX,
	evmNetworkSchema,
	parseEvmNetwork,
} from "../runtime.js";

type ClobApiKeyCreds = {
	key: string;
	secret: string;
	passphrase: string;
};

type ClobOpenOrder = {
	id: string;
	status: string;
	market: string;
	asset_id: string;
	side: string;
	original_size: string;
	size_matched: string;
	price: string;
	outcome: string;
	created_at: number;
	order_type: string;
};

type ClobOrderFilter = {
	id?: string;
	market?: string;
	asset_id?: string;
};

type ClobClientLike = {
	createOrDeriveApiKey?: () => Promise<ClobApiKeyCreds>;
	createAndPostOrder?: (
		order: {
			tokenID: string;
			price: number;
			side: unknown;
			size: number;
		},
		marketInfo: { tickSize: string; negRisk: boolean },
		orderType: unknown,
	) => Promise<unknown>;
	getOpenOrders?: (
		params?: ClobOrderFilter,
		onlyFirstPage?: boolean,
		nextCursor?: string,
	) => Promise<ClobOpenOrder[]>;
	cancelOrder?: (payload: { orderID: string }) => Promise<unknown>;
	cancelOrders?: (orderIds: string[]) => Promise<unknown>;
	cancelAll?: () => Promise<unknown>;
	cancelMarketOrders?: (payload: {
		market?: string;
		asset_id?: string;
	}) => Promise<unknown>;
};

type ClobClientModule = {
	ClobClient: new (...args: unknown[]) => ClobClientLike;
	Side: Record<string, unknown>;
	OrderType: Record<string, unknown>;
};

type ClobClientAuthParams = {
	fromPrivateKey?: string;
	funder?: string;
	apiKey?: string;
	apiSecret?: string;
	apiPassphrase?: string;
	signatureType?: number;
};

function parseSignatureType(value: number | undefined): number {
	if (value === 0 || value === 1 || value === 2) return value;
	const envValue = process.env.POLYMARKET_SIGNATURE_TYPE?.trim();
	if (envValue) {
		const parsed = Number.parseInt(envValue, 10);
		if (parsed === 0 || parsed === 1 || parsed === 2) return parsed;
	}
	return 1;
}

function resolvePrivateKey(input?: string): string {
	const key = input?.trim() || process.env.POLYMARKET_PRIVATE_KEY?.trim() || "";
	if (!key) {
		throw new Error(
			"No Polymarket private key provided. Set fromPrivateKey or POLYMARKET_PRIVATE_KEY.",
		);
	}
	return key;
}

function resolveFunderAddress(input?: string): string {
	const funder = input?.trim() || process.env.POLYMARKET_FUNDER?.trim() || "";
	if (!funder) {
		throw new Error(
			"Missing Polymarket funder/profile address. Set funder or POLYMARKET_FUNDER.",
		);
	}
	return funder;
}

function resolveApiCreds(input: {
	apiKey?: string;
	apiSecret?: string;
	apiPassphrase?: string;
}): ClobApiKeyCreds | null {
	const key = input.apiKey?.trim() || process.env.POLYMARKET_API_KEY?.trim();
	const secret =
		input.apiSecret?.trim() || process.env.POLYMARKET_API_SECRET?.trim();
	const passphrase =
		input.apiPassphrase?.trim() ||
		process.env.POLYMARKET_API_PASSPHRASE?.trim();
	if (!key || !secret || !passphrase) return null;
	return { key, secret, passphrase };
}

async function getClobClientModule(): Promise<ClobClientModule> {
	const moduleValue = await import("@polymarket/clob-client");
	const ClobClient = (moduleValue as { ClobClient?: unknown }).ClobClient;
	const Side = (moduleValue as { Side?: unknown }).Side;
	const OrderType = (moduleValue as { OrderType?: unknown }).OrderType;
	if (
		typeof ClobClient !== "function" ||
		!Side ||
		typeof Side !== "object" ||
		!OrderType ||
		typeof OrderType !== "object"
	) {
		throw new Error(
			"Failed to load @polymarket/clob-client exports (ClobClient/Side/OrderType).",
		);
	}
	return {
		ClobClient: ClobClient as new (...args: unknown[]) => ClobClientLike,
		Side: Side as Record<string, unknown>,
		OrderType: OrderType as Record<string, unknown>,
	};
}

async function createAuthedClobClient(params: ClobClientAuthParams): Promise<{
	client: ClobClientLike;
	signatureType: number;
	Side: Record<string, unknown>;
	OrderType: Record<string, unknown>;
}> {
	const privateKey = resolvePrivateKey(params.fromPrivateKey);
	const funder = resolveFunderAddress(params.funder);
	const apiCreds = resolveApiCreds(params);
	const signatureType = parseSignatureType(params.signatureType);
	const { ClobClient, OrderType, Side } = await getClobClientModule();
	const signer = new Wallet(privateKey);
	const host = getPolymarketClobBaseUrl();
	const chainId = 137;
	const bootClient = new ClobClient(host, chainId, signer);
	const creds = apiCreds ?? (await bootClient.createOrDeriveApiKey?.());
	if (!creds) {
		throw new Error("Unable to derive Polymarket API credentials.");
	}
	const client = new ClobClient(
		host,
		chainId,
		signer,
		creds,
		signatureType,
		funder,
	);
	return {
		client,
		signatureType,
		Side,
		OrderType,
	};
}

function shortId(value: string): string {
	if (value.length <= 18) return value;
	return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function normalizeOrderId(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error("orderId cannot be empty");
	return normalized;
}

function collectOrderIds(input: {
	orderId?: string;
	orderIds?: string[];
}): string[] {
	const output: string[] = [];
	if (input.orderId?.trim()) output.push(normalizeOrderId(input.orderId));
	for (const entry of input.orderIds ?? []) {
		output.push(normalizeOrderId(entry));
	}
	const dedup = new Set(output);
	return [...dedup];
}

function parseNumberText(value: string): number | null {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function calculateRemainingSize(order: ClobOpenOrder): number | null {
	const original = parseNumberText(order.original_size);
	const matched = parseNumberText(order.size_matched);
	if (original == null || matched == null) return null;
	return Math.max(0, original - matched);
}

export function createEvmExecuteTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketPlaceOrder`,
			label: "EVM Polymarket Place Order",
			description:
				"Place BTC 5m Polymarket order via CLOB client. Defaults to dryRun=true for safety.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				marketSlug: Type.Optional(Type.String()),
				tokenId: Type.Optional(Type.String()),
				side: Type.Optional(
					Type.Union([Type.Literal("up"), Type.Literal("down")]),
				),
				orderSide: Type.Optional(
					Type.Union([Type.Literal("buy"), Type.Literal("sell")]),
				),
				stakeUsd: Type.Number({ minimum: 0.01 }),
				limitPrice: Type.Optional(
					Type.Number({ minimum: 0.001, maximum: 0.999 }),
				),
				maxEntryPrice: Type.Optional(
					Type.Number({ minimum: 0.001, maximum: 0.999 }),
				),
				dryRun: Type.Optional(Type.Boolean()),
				useAiAssist: Type.Optional(Type.Boolean()),
				fromPrivateKey: Type.Optional(Type.String()),
				funder: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				apiSecret: Type.Optional(Type.String()),
				apiPassphrase: Type.Optional(Type.String()),
				signatureType: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
				orderType: Type.Optional(
					Type.Union([
						Type.Literal("GTC"),
						Type.Literal("FOK"),
						Type.Literal("GTD"),
					]),
				),
				tickSize: Type.Optional(Type.Number({ minimum: 0.0001, maximum: 1 })),
				negRisk: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				const orderSide = params.orderSide === "sell" ? "sell" : "buy";
				const explicitTokenId = params.tokenId?.trim();
				const marketSlug = params.marketSlug?.trim();
				const trade = explicitTokenId
					? null
					: await resolveBtc5mTradeSelection({
							marketSlug,
							side: params.side,
							useAiAssist: params.useAiAssist,
						});
				const tokenId = explicitTokenId || trade?.tokenId;
				if (!tokenId) {
					throw new Error(
						"Cannot resolve tokenId. Provide tokenId or (marketSlug + side) for BTC 5m.",
					);
				}

				const market =
					trade?.market ||
					(marketSlug ? await getPolymarketMarketBySlug(marketSlug) : null);
				const orderbook = await getPolymarketOrderBook(tokenId);
				const fallbackPrice =
					orderSide === "buy"
						? (orderbook.bestAsk?.price ?? null)
						: (orderbook.bestBid?.price ?? null);
				const limitPrice = params.limitPrice ?? fallbackPrice;
				if (limitPrice == null) {
					throw new Error(
						`No market price available for token=${tokenId}. Provide limitPrice explicitly.`,
					);
				}
				if (
					orderSide === "buy" &&
					params.maxEntryPrice != null &&
					limitPrice > params.maxEntryPrice
				) {
					throw new Error(
						`limitPrice ${limitPrice} exceeds maxEntryPrice ${params.maxEntryPrice}`,
					);
				}
				const stakeUsd = parseUsdStake(params.stakeUsd);
				const size = stakeUsd / limitPrice;
				if (!Number.isFinite(size) || size <= 0) {
					throw new Error(`Invalid order size from stakeUsd=${stakeUsd}`);
				}
				const tickSize = params.tickSize ?? market?.tickSize ?? 0.001;
				const negRisk = params.negRisk ?? market?.negRisk ?? false;
				const geoblock = await getPolymarketGeoblockStatus();

				const orderPreview = {
					network,
					marketSlug: market?.slug ?? marketSlug ?? null,
					tokenId,
					orderSide,
					side: trade?.side ?? params.side ?? null,
					stakeUsd,
					limitPrice,
					size,
					tickSize,
					negRisk,
					geoblock,
				};

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Polymarket order preview (${network}): ${orderSide} token=${tokenId} price=${limitPrice} size=${size.toFixed(4)} stakeUsd=${stakeUsd}`,
							},
						],
						details: {
							dryRun: true,
							orderPreview,
							advice: trade?.advice ?? null,
						},
					};
				}

				if (geoblock.blocked) {
					throw new Error(
						`Polymarket geoblock blocked for country=${geoblock.country ?? "unknown"}. Execute is not allowed in this region.`,
					);
				}

				const { client, signatureType, Side, OrderType } =
					await createAuthedClobClient({
						fromPrivateKey: params.fromPrivateKey,
						funder: params.funder,
						apiKey: params.apiKey,
						apiSecret: params.apiSecret,
						apiPassphrase: params.apiPassphrase,
						signatureType: params.signatureType,
					});
				const sideValue =
					orderSide === "sell" ? (Side.SELL ?? "SELL") : (Side.BUY ?? "BUY");
				const orderTypeInput = (params.orderType ?? "GTC").toUpperCase();
				const orderTypeValue =
					OrderType[orderTypeInput] ?? OrderType.GTC ?? "GTC";
				const response = await client.createAndPostOrder?.(
					{
						tokenID: tokenId,
						price: limitPrice,
						side: sideValue,
						size,
					},
					{
						tickSize: String(tickSize),
						negRisk,
					},
					orderTypeValue,
				);
				return {
					content: [
						{
							type: "text",
							text: `Polymarket order submitted (${network}): ${orderSide} token=${tokenId} size=${size.toFixed(4)} price=${limitPrice}`,
						},
					],
					details: {
						dryRun: false,
						orderPreview,
						signatureType,
						response: response ?? null,
						advice: trade?.advice ?? null,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketGetOpenOrders`,
			label: "EVM Polymarket Open Orders",
			description:
				"List your open Polymarket orders. Requires signer credentials.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				marketSlug: Type.Optional(Type.String()),
				tokenId: Type.Optional(Type.String()),
				side: Type.Optional(
					Type.Union([Type.Literal("up"), Type.Literal("down")]),
				),
				useAiAssist: Type.Optional(Type.Boolean()),
				limit: Type.Optional(
					Type.Number({ minimum: 1, maximum: 100, default: 20 }),
				),
				fromPrivateKey: Type.Optional(Type.String()),
				funder: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				apiSecret: Type.Optional(Type.String()),
				apiPassphrase: Type.Optional(Type.String()),
				signatureType: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const explicitTokenId = params.tokenId?.trim();
				const trade = explicitTokenId
					? null
					: params.marketSlug?.trim() ||
							params.side ||
							params.useAiAssist != null
						? await resolveBtc5mTradeSelection({
								marketSlug: params.marketSlug?.trim(),
								side: params.side,
								useAiAssist: params.useAiAssist,
							})
						: null;
				const tokenId = explicitTokenId || trade?.tokenId;
				const { client } = await createAuthedClobClient({
					fromPrivateKey: params.fromPrivateKey,
					funder: params.funder,
					apiKey: params.apiKey,
					apiSecret: params.apiSecret,
					apiPassphrase: params.apiPassphrase,
					signatureType: params.signatureType,
				});
				const orders =
					(await client.getOpenOrders?.(
						tokenId ? { asset_id: tokenId } : undefined,
						true,
					)) ?? [];
				const sorted = [...orders].sort((a, b) => b.created_at - a.created_at);
				const limit = params.limit ?? 20;
				const preview = sorted.slice(0, limit);
				const lines = [
					`Polymarket open orders (${network}): ${orders.length} order(s)`,
				];
				if (tokenId) {
					lines.push(`token=${tokenId}`);
				}
				for (const [index, order] of preview.entries()) {
					const remaining = calculateRemainingSize(order);
					const remainingText =
						remaining == null ? "n/a" : remaining.toFixed(4);
					lines.push(
						`${index + 1}. id=${shortId(order.id)} ${order.side}/${order.outcome} price=${order.price} remaining=${remainingText} status=${order.status}`,
					);
				}
				if (orders.length > preview.length) {
					lines.push(`... and ${orders.length - preview.length} more order(s)`);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						network,
						tokenId: tokenId ?? null,
						orderCount: orders.length,
						orders: preview,
					},
				};
			},
		}),
		defineTool({
			name: `${EVM_TOOL_PREFIX}polymarketCancelOrder`,
			label: "EVM Polymarket Cancel Order",
			description:
				"Cancel Polymarket orders by orderId(s), token scope, or cancel-all. Defaults to dryRun=true.",
			parameters: Type.Object({
				network: evmNetworkSchema(),
				orderId: Type.Optional(Type.String()),
				orderIds: Type.Optional(
					Type.Array(Type.String({ minLength: 1 }), {
						minItems: 1,
						maxItems: 50,
					}),
				),
				cancelAll: Type.Optional(Type.Boolean()),
				marketSlug: Type.Optional(Type.String()),
				tokenId: Type.Optional(Type.String()),
				side: Type.Optional(
					Type.Union([Type.Literal("up"), Type.Literal("down")]),
				),
				useAiAssist: Type.Optional(Type.Boolean()),
				dryRun: Type.Optional(Type.Boolean()),
				fromPrivateKey: Type.Optional(Type.String()),
				funder: Type.Optional(Type.String()),
				apiKey: Type.Optional(Type.String()),
				apiSecret: Type.Optional(Type.String()),
				apiPassphrase: Type.Optional(Type.String()),
				signatureType: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
			}),
			async execute(_toolCallId, params) {
				const network = parseEvmNetwork(params.network);
				const dryRun = params.dryRun !== false;
				const orderIds = collectOrderIds({
					orderId: params.orderId,
					orderIds: params.orderIds,
				});
				const explicitTokenId = params.tokenId?.trim();
				const trade = explicitTokenId
					? null
					: params.marketSlug?.trim() ||
							params.side ||
							params.useAiAssist != null
						? await resolveBtc5mTradeSelection({
								marketSlug: params.marketSlug?.trim(),
								side: params.side,
								useAiAssist: params.useAiAssist,
							})
						: null;
				const tokenId = explicitTokenId || trade?.tokenId;
				const cancelAll = params.cancelAll === true;
				if (!cancelAll && orderIds.length === 0 && !tokenId) {
					throw new Error(
						"Provide cancelAll=true, orderId/orderIds, or token scope (tokenId / marketSlug + side).",
					);
				}
				const { client, signatureType } = await createAuthedClobClient({
					fromPrivateKey: params.fromPrivateKey,
					funder: params.funder,
					apiKey: params.apiKey,
					apiSecret: params.apiSecret,
					apiPassphrase: params.apiPassphrase,
					signatureType: params.signatureType,
				});
				const scopedOrders =
					(await client.getOpenOrders?.(
						tokenId ? { asset_id: tokenId } : undefined,
						true,
					)) ?? [];
				const targetOrderIds = cancelAll
					? scopedOrders.map((entry) => entry.id)
					: orderIds.length > 0
						? orderIds
						: scopedOrders.map((entry) => entry.id);
				if (dryRun) {
					const lines = [
						`Polymarket cancel preview (${network}): targetOrders=${targetOrderIds.length}`,
					];
					if (cancelAll) lines.push("scope=all");
					if (tokenId) lines.push(`token=${tokenId}`);
					if (orderIds.length > 0) {
						lines.push(
							`explicitOrderIds=${orderIds.map((entry) => shortId(entry)).join(", ")}`,
						);
					}
					if (targetOrderIds.length > 0) {
						lines.push(
							`target=${targetOrderIds
								.slice(0, 8)
								.map((entry) => shortId(entry))
								.join(", ")}`,
						);
						if (targetOrderIds.length > 8) {
							lines.push(`... and ${targetOrderIds.length - 8} more`);
						}
					}
					return {
						content: [{ type: "text", text: lines.join("\n") }],
						details: {
							dryRun: true,
							network,
							cancelAll,
							tokenId: tokenId ?? null,
							targetOrderIds,
							orderCount: scopedOrders.length,
						},
					};
				}

				let response: unknown;
				if (cancelAll) {
					if (!client.cancelAll) {
						throw new Error(
							"cancelAll is not supported by current CLOB client.",
						);
					}
					response = await client.cancelAll();
				} else if (orderIds.length === 1) {
					if (!client.cancelOrder) {
						throw new Error(
							"cancelOrder is not supported by current CLOB client.",
						);
					}
					response = await client.cancelOrder({ orderID: orderIds[0] });
				} else if (orderIds.length > 1) {
					if (!client.cancelOrders) {
						throw new Error(
							"cancelOrders is not supported by current CLOB client.",
						);
					}
					response = await client.cancelOrders(orderIds);
				} else if (tokenId && client.cancelMarketOrders) {
					response = await client.cancelMarketOrders({ asset_id: tokenId });
				} else if (targetOrderIds.length > 0 && client.cancelOrders) {
					response = await client.cancelOrders(targetOrderIds);
				} else {
					response = { success: true, canceled: 0 };
				}
				return {
					content: [
						{
							type: "text",
							text: `Polymarket cancel submitted (${network}): targetOrders=${targetOrderIds.length} scope=${cancelAll ? "all" : tokenId ? "token" : "ids"}`,
						},
					],
					details: {
						dryRun: false,
						network,
						cancelAll,
						tokenId: tokenId ?? null,
						targetOrderIds,
						signatureType,
						response: response ?? null,
					},
				};
			},
		}),
	];
}
