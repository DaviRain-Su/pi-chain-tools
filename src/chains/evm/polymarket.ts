import {
	buildUrlWithQuery,
	evmHttpJson,
	parsePositiveNumber,
	stringifyUnknown,
} from "./runtime.js";

export const POLYMARKET_GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
export const POLYMARKET_CLOB_BASE_URL = "https://clob.polymarket.com";
export const POLYMARKET_WEB_BASE_URL = "https://polymarket.com";

type RawMarket = Record<string, unknown>;

type RawEvent = Record<string, unknown> & {
	markets?: unknown;
};

type RawSearchResponse = {
	events?: unknown;
};

type RawBookLevel = {
	price?: unknown;
	size?: unknown;
};

type RawOrderBookResponse = {
	market?: unknown;
	asset_id?: unknown;
	bids?: unknown;
	asks?: unknown;
};

type RawPriceResponse = {
	price?: unknown;
};

type RawMidpointResponse = {
	mid?: unknown;
};

type RawGeoblockResponse = {
	blocked?: unknown;
	ip?: unknown;
	country?: unknown;
	region?: unknown;
};

export type PolymarketOutcomeLeg = {
	outcome: string;
	tokenId: string | null;
	price: number | null;
};

export type PolymarketMarket = {
	id: string | null;
	slug: string;
	question: string;
	active: boolean;
	closed: boolean;
	acceptingOrders: boolean;
	restricted: boolean;
	endDate: string | null;
	volume24hr: number | null;
	liquidity: number | null;
	tickSize: number | null;
	orderMinSize: number | null;
	negRisk: boolean;
	legs: PolymarketOutcomeLeg[];
};

export type PolymarketEvent = {
	id: string | null;
	title: string;
	slug: string;
	active: boolean;
	closed: boolean;
	endDate: string | null;
	volume24hr: number | null;
	markets: PolymarketMarket[];
};

export type PolymarketBookLevel = {
	price: number;
	size: number;
};

export type PolymarketOrderBook = {
	marketId: string | null;
	tokenId: string;
	bids: PolymarketBookLevel[];
	asks: PolymarketBookLevel[];
	bestBid: PolymarketBookLevel | null;
	bestAsk: PolymarketBookLevel | null;
	midpoint: number | null;
};

export type PolymarketGeoblock = {
	blocked: boolean;
	ip: string | null;
	country: string | null;
	region: string | null;
};

export type PolymarketBtc5mAdvice = {
	recommendedSide: "up" | "down" | "avoid";
	confidence: number;
	marketSlug: string;
	upProbability: number;
	upTokenId: string;
	downTokenId: string;
	reasons: string[];
};

function toNumberOrNull(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number.parseFloat(value.trim());
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function toBoolean(value: unknown): boolean {
	return value === true;
}

function toStringOrNull(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function toStringOrEmpty(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function parseJsonStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((entry) => toStringOrNull(entry))
			.filter((entry): entry is string => Boolean(entry));
	}
	if (typeof value !== "string") return [];
	const trimmed = value.trim();
	if (!trimmed) return [];
	try {
		const parsed = JSON.parse(trimmed);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((entry) => toStringOrNull(entry))
			.filter((entry): entry is string => Boolean(entry));
	} catch {
		return [];
	}
}

function normalizePolymarketMarket(raw: RawMarket): PolymarketMarket | null {
	const slug = toStringOrNull(raw.slug);
	if (!slug) return null;
	const outcomes = parseJsonStringArray(raw.outcomes);
	const outcomePrices = parseJsonStringArray(raw.outcomePrices);
	const tokenIds = parseJsonStringArray(raw.clobTokenIds);
	const legs = outcomes.map((outcome, index) => ({
		outcome,
		tokenId: tokenIds[index] ?? null,
		price: toNumberOrNull(outcomePrices[index] ?? null),
	}));
	return {
		id: toStringOrNull(raw.id),
		slug,
		question:
			toStringOrNull(raw.question) ||
			toStringOrNull(raw.description) ||
			"(unknown question)",
		active: toBoolean(raw.active),
		closed: toBoolean(raw.closed),
		acceptingOrders: toBoolean(raw.acceptingOrders),
		restricted: toBoolean(raw.restricted),
		endDate: toStringOrNull(raw.endDate),
		volume24hr: toNumberOrNull(raw.volume24hr),
		liquidity: toNumberOrNull(raw.liquidityClob ?? raw.liquidity),
		tickSize: toNumberOrNull(raw.orderPriceMinTickSize),
		orderMinSize: toNumberOrNull(raw.orderMinSize),
		negRisk: toBoolean(raw.negRisk),
		legs,
	};
}

function normalizePolymarketEvent(raw: RawEvent): PolymarketEvent | null {
	const slug = toStringOrNull(raw.slug);
	if (!slug) return null;
	const marketsRaw = Array.isArray(raw.markets) ? raw.markets : [];
	const markets = marketsRaw
		.map((entry) => normalizePolymarketMarket(entry as RawMarket))
		.filter((entry): entry is PolymarketMarket => Boolean(entry));
	return {
		id: toStringOrNull(raw.id),
		title: toStringOrEmpty(raw.title),
		slug,
		active: toBoolean(raw.active),
		closed: toBoolean(raw.closed),
		endDate: toStringOrNull(raw.endDate),
		volume24hr: toNumberOrNull(raw.volume24hr),
		markets,
	};
}

function parseBookLevels(value: unknown): PolymarketBookLevel[] {
	if (!Array.isArray(value)) return [];
	const levels: PolymarketBookLevel[] = [];
	for (const entry of value) {
		const raw = entry as RawBookLevel;
		const price = toNumberOrNull(raw.price);
		const size = toNumberOrNull(raw.size);
		if (price == null || size == null || size <= 0) continue;
		levels.push({ price, size });
	}
	return levels;
}

function round4(value: number): number {
	return Number(value.toFixed(4));
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function getPolymarketGammaBaseUrl(): string {
	return (
		process.env.POLYMARKET_GAMMA_BASE_URL?.trim() || POLYMARKET_GAMMA_BASE_URL
	);
}

export function getPolymarketClobBaseUrl(): string {
	return (
		process.env.POLYMARKET_CLOB_BASE_URL?.trim() || POLYMARKET_CLOB_BASE_URL
	);
}

export async function searchPolymarketEvents(params: {
	query: string;
	page?: number;
	limitPerType?: number;
	eventsStatus?: "active" | "closed" | "all";
	keepClosedMarkets?: boolean;
}): Promise<PolymarketEvent[]> {
	const url = buildUrlWithQuery(
		`${getPolymarketGammaBaseUrl()}/public-search`,
		{
			q: params.query,
			page: params.page ?? 1,
			limit_per_type: params.limitPerType ?? 50,
			events_status: params.eventsStatus ?? "active",
			keep_closed_markets: params.keepClosedMarkets ? 1 : 0,
		},
	);
	const payload = await evmHttpJson<RawSearchResponse>({ url, method: "GET" });
	const eventsRaw = Array.isArray(payload.events) ? payload.events : [];
	return eventsRaw
		.map((entry) => normalizePolymarketEvent(entry as RawEvent))
		.filter((entry): entry is PolymarketEvent => Boolean(entry));
}

export async function getPolymarketMarketBySlug(
	slug: string,
): Promise<PolymarketMarket> {
	const normalizedSlug = slug.trim();
	if (!normalizedSlug) {
		throw new Error("market slug is required");
	}
	const url = buildUrlWithQuery(`${getPolymarketGammaBaseUrl()}/markets`, {
		slug: normalizedSlug,
	});
	const payload = await evmHttpJson<unknown>({ url, method: "GET" });
	if (!Array.isArray(payload) || payload.length === 0) {
		throw new Error(`Polymarket market not found by slug=${normalizedSlug}`);
	}
	const market = normalizePolymarketMarket(payload[0] as RawMarket);
	if (!market) {
		throw new Error(`Invalid market payload for slug=${normalizedSlug}`);
	}
	return market;
}

function isLikelyBtc5mTitle(title: string): boolean {
	const normalized = title.toLowerCase();
	const mentionsBtc =
		normalized.includes("bitcoin") || normalized.includes("btc");
	const mentionsFiveMinute =
		normalized.includes("5m") ||
		normalized.includes("5 m") ||
		normalized.includes("5-min") ||
		normalized.includes("5 minute") ||
		normalized.includes("5分钟");
	const mentionsDirection =
		normalized.includes("up or down") ||
		normalized.includes("up/down") ||
		normalized.includes("涨跌");
	return mentionsBtc && mentionsFiveMinute && mentionsDirection;
}

export async function getPolymarketBtc5mMarkets(params?: {
	limit?: number;
}): Promise<PolymarketMarket[]> {
	const events = await searchPolymarketEvents({
		query: "bitcoin",
		limitPerType: 120,
		eventsStatus: "active",
		keepClosedMarkets: false,
	});
	const markets: PolymarketMarket[] = [];
	for (const event of events) {
		const eventTitle = event.title || "";
		for (const market of event.markets) {
			if (!market.active || market.closed) continue;
			if (!market.acceptingOrders) continue;
			const title = `${eventTitle} ${market.question}`;
			if (!isLikelyBtc5mTitle(title)) continue;
			markets.push(market);
		}
	}
	markets.sort((a, b) => {
		const av = a.volume24hr ?? 0;
		const bv = b.volume24hr ?? 0;
		if (av === bv) return a.slug.localeCompare(b.slug);
		return bv - av;
	});
	const limit = params?.limit ?? 10;
	return markets.slice(0, Math.max(1, Math.min(50, Math.floor(limit))));
}

export async function getPolymarketOrderBook(
	tokenId: string,
): Promise<PolymarketOrderBook> {
	const normalizedTokenId = tokenId.trim();
	if (!normalizedTokenId) throw new Error("tokenId is required");
	const baseUrl = getPolymarketClobBaseUrl();
	const [bookPayload, midpointPayload] = await Promise.all([
		evmHttpJson<RawOrderBookResponse>({
			url: buildUrlWithQuery(`${baseUrl}/book`, {
				token_id: normalizedTokenId,
			}),
			method: "GET",
		}),
		evmHttpJson<RawMidpointResponse>({
			url: buildUrlWithQuery(`${baseUrl}/midpoint`, {
				token_id: normalizedTokenId,
			}),
			method: "GET",
		}).catch(() => ({ mid: null })),
	]);

	const bids = parseBookLevels(bookPayload.bids);
	const asks = parseBookLevels(bookPayload.asks);
	const bestBid = bids.length > 0 ? bids[0] : null;
	const bestAsk = asks.length > 0 ? asks[0] : null;
	const midpoint = toNumberOrNull(midpointPayload.mid);
	return {
		marketId: toStringOrNull(bookPayload.market),
		tokenId: toStringOrNull(bookPayload.asset_id) ?? normalizedTokenId,
		bids,
		asks,
		bestBid,
		bestAsk,
		midpoint,
	};
}

export async function getPolymarketTokenPrice(params: {
	tokenId: string;
	side: "buy" | "sell";
}): Promise<number | null> {
	const payload = await evmHttpJson<RawPriceResponse>({
		url: buildUrlWithQuery(`${getPolymarketClobBaseUrl()}/price`, {
			token_id: params.tokenId,
			side: params.side,
		}),
		method: "GET",
	});
	return toNumberOrNull(payload.price);
}

export async function getPolymarketGeoblockStatus(): Promise<PolymarketGeoblock> {
	const payload = await evmHttpJson<RawGeoblockResponse>({
		url: `${POLYMARKET_WEB_BASE_URL}/api/geoblock`,
		method: "GET",
	});
	return {
		blocked: payload.blocked === true,
		ip: toStringOrNull(payload.ip),
		country: toStringOrNull(payload.country),
		region: toStringOrNull(payload.region),
	};
}

function resolveOutcomeToken(
	market: PolymarketMarket,
	candidateWords: string[],
): { tokenId: string; leg: PolymarketOutcomeLeg } | null {
	for (const word of candidateWords) {
		const leg = market.legs.find(
			(entry) => entry.outcome.toLowerCase() === word.toLowerCase(),
		);
		if (leg?.tokenId) {
			return { tokenId: leg.tokenId, leg };
		}
	}
	return null;
}

export async function getPolymarketBtc5mAdvice(params: {
	marketSlug?: string;
}): Promise<PolymarketBtc5mAdvice> {
	const market = params.marketSlug?.trim()
		? await getPolymarketMarketBySlug(params.marketSlug)
		: (await getPolymarketBtc5mMarkets({ limit: 1 }))[0];
	if (!market) {
		throw new Error("No active BTC 5m market found");
	}
	const up = resolveOutcomeToken(market, ["Up", "Yes"]);
	const down = resolveOutcomeToken(market, ["Down", "No"]);
	if (!up || !down) {
		throw new Error(
			`Cannot resolve Up/Down token ids for market=${market.slug}. legs=${JSON.stringify(market.legs)}`,
		);
	}

	const [upBook, downBook] = await Promise.all([
		getPolymarketOrderBook(up.tokenId),
		getPolymarketOrderBook(down.tokenId),
	]);
	const upMid =
		upBook.midpoint ??
		up.leg.price ??
		(upBook.bestBid && upBook.bestAsk
			? (upBook.bestBid.price + upBook.bestAsk.price) / 2
			: null);
	if (upMid == null) {
		throw new Error(
			`Cannot derive Up midpoint for market=${market.slug}, token=${up.tokenId}`,
		);
	}
	const spread =
		upBook.bestBid && upBook.bestAsk
			? Math.max(0, upBook.bestAsk.price - upBook.bestBid.price)
			: 1;
	const edge = Math.abs(upMid - 0.5) * 2;
	const liquidity = market.volume24hr ?? 0;
	const liquidityFactor = clamp(Math.log10(liquidity + 10) / 8, 0, 0.25);
	const spreadPenalty = clamp(spread * 1.5, 0, 0.35);
	let confidence = clamp(edge + liquidityFactor - spreadPenalty, 0.05, 0.95);

	let recommendedSide: "up" | "down" | "avoid" = "avoid";
	if (upMid >= 0.56) {
		recommendedSide = "up";
	} else if (upMid <= 0.44) {
		recommendedSide = "down";
	}
	if (recommendedSide === "avoid") {
		confidence = Math.min(confidence, 0.49);
	}

	const reasons = [
		`upProbability=${round4(upMid)}`,
		`spread=${round4(spread)}`,
		`volume24h=${round4(liquidity)}`,
	];
	if (recommendedSide === "avoid") {
		reasons.push("Signal is weak (close to 0.5) or spread is too wide.");
	} else {
		reasons.push(
			`Signal bias=${recommendedSide.toUpperCase()} with confidence=${round4(confidence)}`,
		);
	}

	return {
		recommendedSide,
		confidence: round4(confidence),
		marketSlug: market.slug,
		upProbability: round4(upMid),
		upTokenId: up.tokenId,
		downTokenId: down.tokenId,
		reasons,
	};
}

export async function resolveBtc5mTradeSelection(params: {
	marketSlug?: string;
	side?: "up" | "down";
	useAiAssist?: boolean;
}): Promise<{
	market: PolymarketMarket;
	side: "up" | "down";
	tokenId: string;
	advice: PolymarketBtc5mAdvice | null;
}> {
	const market = params.marketSlug?.trim()
		? await getPolymarketMarketBySlug(params.marketSlug)
		: (await getPolymarketBtc5mMarkets({ limit: 1 }))[0];
	if (!market) throw new Error("No active BTC 5m market found");

	const advice =
		params.useAiAssist === false
			? null
			: await getPolymarketBtc5mAdvice({ marketSlug: market.slug }).catch(
					() => null,
				);
	const selectedSide = params.side ?? advice?.recommendedSide ?? "avoid";
	if (selectedSide === "avoid") {
		throw new Error(
			"No confident trade side inferred. Provide side=up/down or increase signal threshold.",
		);
	}
	const sideWords = selectedSide === "up" ? ["Up", "Yes"] : ["Down", "No"];
	const selection = resolveOutcomeToken(market, sideWords);
	if (!selection?.tokenId) {
		throw new Error(
			`Unable to resolve ${selectedSide} token id for market=${market.slug}`,
		);
	}
	return {
		market,
		side: selectedSide,
		tokenId: selection.tokenId,
		advice,
	};
}

export function parseUsdStake(value: string | number): number {
	return parsePositiveNumber(value, "stakeUsd");
}

export function safeErrorText(error: unknown): string {
	return stringifyUnknown(error);
}
