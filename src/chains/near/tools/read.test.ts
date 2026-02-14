import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	callNearRpc: vi.fn(),
	formatNearAmount: vi.fn((value: string | bigint) =>
		typeof value === "bigint" ? value.toString() : value,
	),
	formatTokenAmount: vi.fn((value: string) => value),
	getNearRpcEndpoint: vi.fn(() => "https://rpc.mainnet.near.org"),
	nearNetworkSchema: vi.fn(),
	parseNearNetwork: vi.fn(() => "mainnet"),
	resolveNearAccountId: vi.fn(
		(accountId?: string) => accountId ?? "alice.near",
	),
}));

const refMocks = vi.hoisted(() => ({
	fetchRefPoolById: vi.fn(),
	getRefContractId: vi.fn(),
	getRefSwapQuote: vi.fn(),
}));

const restMocks = vi.hoisted(() => ({
	fetch: vi.fn(),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		callNearRpc: runtimeMocks.callNearRpc,
		formatNearAmount: runtimeMocks.formatNearAmount,
		formatTokenAmount: runtimeMocks.formatTokenAmount,
		getNearRpcEndpoint: runtimeMocks.getNearRpcEndpoint,
		nearNetworkSchema: runtimeMocks.nearNetworkSchema,
		parseNearNetwork: runtimeMocks.parseNearNetwork,
		resolveNearAccountId: runtimeMocks.resolveNearAccountId,
	};
});

vi.mock("../ref.js", async () => {
	const actual = await vi.importActual<typeof import("../ref.js")>("../ref.js");
	return {
		...actual,
		fetchRefPoolById: refMocks.fetchRefPoolById,
		getRefContractId: refMocks.getRefContractId,
		getRefSwapQuote: refMocks.getRefSwapQuote,
	};
});

import { createNearReadTools } from "./read.js";

type ReadTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(name: string): ReadTool {
	const tool = createNearReadTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ReadTool;
}

function decodeArgsBase64(argsBase64: string): Record<string, unknown> {
	return JSON.parse(
		Buffer.from(argsBase64, "base64").toString("utf8"),
	) as Record<string, unknown>;
}

function mockFetchJsonOnce(status: number, payload: unknown): void {
	restMocks.fetch.mockResolvedValueOnce({
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : status === 201 ? "Created" : "Error",
		text: async () => JSON.stringify(payload),
	} as Response);
}

beforeEach(() => {
	vi.clearAllMocks();
	restMocks.fetch.mockReset();
	vi.stubGlobal("fetch", restMocks.fetch as unknown as typeof fetch);
	runtimeMocks.parseNearNetwork.mockReturnValue("mainnet");
	runtimeMocks.getNearRpcEndpoint.mockReturnValue(
		"https://rpc.mainnet.near.org",
	);
	runtimeMocks.resolveNearAccountId.mockImplementation(
		(accountId?: string) => accountId ?? "alice.near",
	);
	runtimeMocks.formatNearAmount.mockImplementation((value: string | bigint) =>
		typeof value === "bigint" ? value.toString() : value,
	);
	runtimeMocks.formatTokenAmount.mockImplementation((value: string) => value);
	refMocks.getRefSwapQuote.mockResolvedValue({
		refContractId: "v2.ref-finance.near",
		poolId: 1,
		tokenInId: "usdt.tether-token.near",
		tokenOutId: "usdc.fakes.near",
		amountInRaw: "1000000",
		amountOutRaw: "998000",
		minAmountOutRaw: "993010",
		feeBps: 30,
		source: "bestDirectSimplePool",
	});
	refMocks.getRefContractId.mockImplementation(
		(_network?: string, refContractId?: string) =>
			refContractId ?? "v2.ref-finance.near",
	);
	refMocks.fetchRefPoolById.mockResolvedValue({
		id: 0,
		token_account_ids: ["wrap.near", "usdc.fakes.near"],
		amounts: ["1", "1"],
		total_fee: 30,
		pool_kind: "SIMPLE_POOL",
	});
});

describe("near_getBalance", () => {
	it("returns native NEAR balance", async () => {
		runtimeMocks.callNearRpc.mockResolvedValue({
			amount: "1000000000000000000000000",
			block_hash: "1111",
			block_height: 123,
			code_hash: "11111111111111111111111111111111",
			locked: "200000000000000000000000",
			storage_paid_at: 0,
			storage_usage: 381,
		});
		runtimeMocks.formatNearAmount.mockImplementation(
			(value: string | bigint) => {
				const normalized = typeof value === "bigint" ? value.toString() : value;
				if (normalized === "1000000000000000000000000") return "1";
				if (normalized === "800000000000000000000000") return "0.8";
				if (normalized === "200000000000000000000000") return "0.2";
				return normalized;
			},
		);

		const tool = getTool("near_getBalance");
		const result = await tool.execute("near-read-1", {
			accountId: "bob.near",
			network: "mainnet",
		});

		expect(runtimeMocks.callNearRpc).toHaveBeenCalledWith({
			method: "query",
			network: "mainnet",
			params: {
				account_id: "bob.near",
				finality: "final",
				request_type: "view_account",
			},
			rpcUrl: undefined,
		});
		expect(result.content[0]?.text).toContain("1 NEAR");
		expect(result.details).toMatchObject({
			accountId: "bob.near",
			network: "mainnet",
			totalYoctoNear: "1000000000000000000000000",
			lockedYoctoNear: "200000000000000000000000",
			availableYoctoNear: "800000000000000000000000",
		});
	});
});

describe("near_getAccount", () => {
	it("returns account state details", async () => {
		runtimeMocks.callNearRpc.mockResolvedValue({
			amount: "1230000000000000000000000",
			block_hash: "2222",
			block_height: 456,
			code_hash: "11111111111111111111111111111111",
			locked: "0",
			storage_paid_at: 0,
			storage_usage: 420,
		});
		runtimeMocks.formatNearAmount.mockImplementation(
			(value: string | bigint) =>
				(typeof value === "bigint" ? value.toString() : value) ===
				"1230000000000000000000000"
					? "1.23"
					: typeof value === "bigint"
						? value.toString()
						: value,
		);

		const tool = getTool("near_getAccount");
		const result = await tool.execute("near-read-2", {
			accountId: "alice.near",
		});

		expect(result.content[0]?.text).toContain("Account: alice.near");
		expect(result.content[0]?.text).toContain("Storage usage: 420");
		expect(result.details).toMatchObject({
			accountId: "alice.near",
			network: "mainnet",
		});
	});
});

describe("near_getFtBalance", () => {
	it("returns FT balance with metadata", async () => {
		const rawBalancePayload = Buffer.from(JSON.stringify("1234500"), "utf8");
		const metadataPayload = Buffer.from(
			JSON.stringify({
				decimals: 6,
				name: "USD Coin",
				symbol: "USDC",
			}),
			"utf8",
		);
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "3333",
				block_height: 789,
				logs: [],
				result: [...rawBalancePayload],
			})
			.mockResolvedValueOnce({
				block_hash: "3334",
				block_height: 790,
				logs: [],
				result: [...metadataPayload],
			});
		runtimeMocks.formatTokenAmount.mockReturnValue("1.2345");

		const tool = getTool("near_getFtBalance");
		const result = await tool.execute("near-read-3", {
			accountId: "alice.near",
			ftContractId: "usdc.fakes.near",
			network: "mainnet",
		});

		expect(runtimeMocks.callNearRpc).toHaveBeenNthCalledWith(1, {
			method: "query",
			network: "mainnet",
			params: {
				account_id: "usdc.fakes.near",
				args_base64: Buffer.from(
					JSON.stringify({ account_id: "alice.near" }),
					"utf8",
				).toString("base64"),
				finality: "final",
				method_name: "ft_balance_of",
				request_type: "call_function",
			},
			rpcUrl: undefined,
		});
		expect(result.content[0]?.text).toContain("USDC");
		expect(result.details).toMatchObject({
			accountId: "alice.near",
			decimals: 6,
			ftContractId: "usdc.fakes.near",
			rawBalance: "1234500",
			symbol: "USDC",
			uiAmount: "1.2345",
		});
	});
});

describe("near_getPortfolio", () => {
	it("returns native + non-zero FT assets", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				amount: "1000000000000000000000000",
				block_hash: "4441",
				block_height: 901,
				code_hash: "11111111111111111111111111111111",
				locked: "100000000000000000000000",
				storage_paid_at: 0,
				storage_usage: 381,
			})
			.mockResolvedValueOnce({
				block_hash: "4442",
				block_height: 902,
				logs: [],
				result: [...Buffer.from(JSON.stringify("1234500"), "utf8")],
			})
			.mockResolvedValueOnce({
				block_hash: "4443",
				block_height: 903,
				logs: [],
				result: [
					...Buffer.from(
						JSON.stringify({
							decimals: 6,
							symbol: "USDC",
						}),
						"utf8",
					),
				],
			})
			.mockResolvedValueOnce({
				block_hash: "4444",
				block_height: 904,
				logs: [],
				result: [...Buffer.from(JSON.stringify("0"), "utf8")],
			});
		runtimeMocks.formatNearAmount.mockImplementation(
			(value: string | bigint) => {
				const normalized = typeof value === "bigint" ? value.toString() : value;
				if (normalized === "1000000000000000000000000") return "1";
				if (normalized === "900000000000000000000000") return "0.9";
				if (normalized === "100000000000000000000000") return "0.1";
				return normalized;
			},
		);
		runtimeMocks.formatTokenAmount.mockReturnValue("1.2345");

		const tool = getTool("near_getPortfolio");
		const result = await tool.execute("near-read-portfolio-1", {
			accountId: "alice.near",
			network: "mainnet",
			ftContractIds: ["usdc.fakes.near", "usdt.tether-token.near"],
		});

		expect(result.content[0]?.text).toContain("Portfolio: 2 assets");
		expect(result.content[0]?.text).toContain("USDC: 1.2345");
		expect(result.details).toMatchObject({
			accountId: "alice.near",
			network: "mainnet",
			ftContractsQueried: ["usdc.fakes.near", "usdt.tether-token.near"],
			assets: [
				{
					kind: "native",
					symbol: "NEAR",
				},
				{
					kind: "ft",
					symbol: "USDC",
					contractId: "usdc.fakes.near",
					rawAmount: "1234500",
					uiAmount: "1.2345",
				},
			],
		});
	});
});

describe("near_getRefDeposits", () => {
	it("returns readable Ref deposit balances", async () => {
		runtimeMocks.callNearRpc.mockImplementation(async ({ params }) => {
			if (
				!params ||
				typeof params !== "object" ||
				typeof params.method_name !== "string"
			) {
				throw new Error("invalid params");
			}
			if (params.method_name === "get_deposits") {
				return {
					block_hash: "5551",
					block_height: 1001,
					logs: [],
					result: [
						...Buffer.from(
							JSON.stringify({
								"wrap.near": "1000000000000000000000000",
								"usdc.fakes.near": "1234500",
							}),
							"utf8",
						),
					],
				};
			}
			if (params.method_name === "ft_metadata") {
				if (params.account_id === "wrap.near") {
					return {
						block_hash: "5552",
						block_height: 1002,
						logs: [],
						result: [
							...Buffer.from(
								JSON.stringify({
									decimals: 24,
									symbol: "wNEAR",
								}),
								"utf8",
							),
						],
					};
				}
				return {
					block_hash: "5553",
					block_height: 1003,
					logs: [],
					result: [
						...Buffer.from(
							JSON.stringify({
								decimals: 6,
								symbol: "USDC",
							}),
							"utf8",
						),
					],
				};
			}
			throw new Error(`unexpected method ${params.method_name}`);
		});
		runtimeMocks.formatTokenAmount.mockImplementation(
			(value: string, decimals?: number) => {
				if (value === "1000000000000000000000000" && decimals === 24)
					return "1";
				if (value === "1234500" && decimals === 6) return "1.2345";
				return value;
			},
		);

		const tool = getTool("near_getRefDeposits");
		const result = await tool.execute("near-read-ref-deposits-1", {
			accountId: "alice.near",
			network: "mainnet",
		});

		expect(refMocks.getRefContractId).toHaveBeenCalledWith(
			"mainnet",
			undefined,
		);
		expect(result.content[0]?.text).toContain("Ref deposits: 2 token(s)");
		expect(result.content[0]?.text).toContain("wNEAR: 1");
		expect(result.content[0]?.text).toContain("USDC: 1.2345");
		expect(result.details).toMatchObject({
			accountId: "alice.near",
			network: "mainnet",
			refContractId: "v2.ref-finance.near",
			assets: [
				{
					tokenId: "wrap.near",
					symbol: "wNEAR",
					rawAmount: "1000000000000000000000000",
					uiAmount: "1",
				},
				{
					tokenId: "usdc.fakes.near",
					symbol: "USDC",
					rawAmount: "1234500",
					uiAmount: "1.2345",
				},
			],
		});
	});
});

describe("near_getRefLpPositions", () => {
	it("scans pools and returns non-zero LP shares with remove hints", async () => {
		runtimeMocks.callNearRpc.mockImplementation(async ({ params }) => {
			if (
				!params ||
				typeof params !== "object" ||
				typeof params.method_name !== "string"
			) {
				throw new Error("invalid params");
			}

			if (params.method_name === "get_pools") {
				return {
					block_hash: "6661",
					block_height: 1101,
					logs: [],
					result: [
						...Buffer.from(
							JSON.stringify([
								{
									token_account_ids: ["wrap.near", "usdc.fakes.near"],
									amounts: ["1", "1"],
									total_fee: 30,
									pool_kind: "SIMPLE_POOL",
								},
								{
									token_account_ids: ["wrap.near", "usdt.tether-token.near"],
									amounts: ["1", "1"],
									total_fee: 30,
									pool_kind: "SIMPLE_POOL",
								},
								{
									token_account_ids: ["wrap.near", "aurora"],
									amounts: ["1", "1"],
									total_fee: 30,
									pool_kind: "SIMPLE_POOL",
								},
							]),
							"utf8",
						),
					],
				};
			}

			if (params.method_name === "get_pool_shares") {
				const args = decodeArgsBase64(String(params.args_base64));
				const poolId = Number(args.pool_id);
				const byPoolId: Record<number, string> = {
					0: "0",
					1: "550000",
					2: "100",
				};
				return {
					block_hash: "6662",
					block_height: 1102,
					logs: [],
					result: [
						...Buffer.from(JSON.stringify(byPoolId[poolId] ?? "0"), "utf8"),
					],
				};
			}

			if (params.method_name === "ft_metadata") {
				const byToken: Record<string, { symbol: string; decimals: number }> = {
					"wrap.near": { symbol: "wNEAR", decimals: 24 },
					"usdt.tether-token.near": { symbol: "USDT", decimals: 6 },
					aurora: { symbol: "AURORA", decimals: 18 },
				};
				const entry = byToken[String(params.account_id)];
				return {
					block_hash: "6663",
					block_height: 1103,
					logs: [],
					result: [
						...Buffer.from(
							JSON.stringify(entry ?? { symbol: "UNKNOWN", decimals: 18 }),
							"utf8",
						),
					],
				};
			}

			throw new Error(`unexpected method ${params.method_name}`);
		});

		const tool = getTool("near_getRefLpPositions");
		const result = await tool.execute("near-read-ref-lp-1", {
			accountId: "alice.near",
			network: "mainnet",
			maxPools: 3,
		});

		expect(result.content[0]?.text).toContain("Ref LP positions: 2 pool(s)");
		expect(result.content[0]?.text).toContain(
			"Pool 1 (wNEAR/USDT): shares 550000",
		);
		expect(result.content[0]?.text).toContain(
			"Hint: 在 Ref 移除 LP，pool 1，shares 550000，minA 0，minB 0，先模拟",
		);
		expect(result.details).toMatchObject({
			accountId: "alice.near",
			network: "mainnet",
			refContractId: "v2.ref-finance.near",
			scannedPoolCount: 3,
			positions: [
				{
					poolId: 1,
					pairLabel: "wNEAR/USDT",
					sharesRaw: "550000",
				},
				{
					poolId: 2,
					pairLabel: "wNEAR/AURORA",
					sharesRaw: "100",
				},
			],
		});
	});
});

describe("near_getSwapQuoteRef", () => {
	it("returns Ref quote details", async () => {
		const tool = getTool("near_getSwapQuoteRef");
		const result = await tool.execute("near-read-4", {
			tokenInId: "usdt.tether-token.near",
			tokenOutId: "usdc.fakes.near",
			amountInRaw: "1000000",
			poolId: "12",
			slippageBps: 100,
			network: "mainnet",
		});

		expect(refMocks.getRefSwapQuote).toHaveBeenCalledWith({
			network: "mainnet",
			rpcUrl: undefined,
			refContractId: undefined,
			tokenInId: "usdt.tether-token.near",
			tokenOutId: "usdc.fakes.near",
			amountInRaw: "1000000",
			poolId: 12,
			slippageBps: 100,
		});
		expect(result.content[0]?.text).toContain("Ref quote:");
		expect(result.content[0]?.text).toContain("Pool: 1");
		expect(result.details).toMatchObject({
			network: "mainnet",
			rpcEndpoint: "https://rpc.mainnet.near.org",
			quote: {
				poolId: 1,
				amountOutRaw: "998000",
			},
		});
	});
});

describe("near_getIntentsTokens", () => {
	it("returns filtered intents tokens with readable summary", async () => {
		mockFetchJsonOnce(200, [
			{
				assetId: "nep141:wrap.near",
				decimals: 24,
				blockchain: "near",
				symbol: "wNEAR",
				price: 1.01,
				priceUpdatedAt: "2026-02-13T18:09:00.000Z",
				contractAddress: "wrap.near",
			},
			{
				assetId: "nep141:usdc-near",
				decimals: 6,
				blockchain: "near",
				symbol: "USDC",
				price: 1,
				priceUpdatedAt: "2026-02-13T18:09:00.000Z",
				contractAddress: "usdc.near",
			},
			{
				assetId: "nep141:usdc-eth",
				decimals: 6,
				blockchain: "eth",
				symbol: "USDC",
				price: 1,
				priceUpdatedAt: "2026-02-13T18:09:00.000Z",
				contractAddress: "0xa0b8",
			},
		]);
		const tool = getTool("near_getIntentsTokens");
		const result = await tool.execute("near-read-intents-tokens-1", {
			blockchain: "near",
			symbol: "USDC",
			limit: 5,
		});

		expect(restMocks.fetch).toHaveBeenCalledWith(
			"https://1click.chaindefuser.com/v0/tokens",
			expect.objectContaining({
				method: "GET",
			}),
		);
		expect(result.content[0]?.text).toContain(
			"Intents tokens: 1 shown / 1 matched",
		);
		expect(result.content[0]?.text).toContain("USDC [near]");
		expect(result.details).toMatchObject({
			apiBaseUrl: "https://1click.chaindefuser.com",
			total: 3,
			matched: 1,
			shown: 1,
		});
	});
});

describe("near_getIntentsQuote", () => {
	it("resolves symbol pair and returns dry quote details", async () => {
		mockFetchJsonOnce(200, [
			{
				assetId: "nep141:wrap.near",
				decimals: 24,
				blockchain: "near",
				symbol: "wNEAR",
				price: 1.01,
				priceUpdatedAt: "2026-02-13T18:09:00.000Z",
				contractAddress: "wrap.near",
			},
			{
				assetId: "nep141:usdc-near",
				decimals: 6,
				blockchain: "near",
				symbol: "USDC",
				price: 1,
				priceUpdatedAt: "2026-02-13T18:09:00.000Z",
				contractAddress: "usdc.near",
			},
			{
				assetId: "nep141:usdc-eth",
				decimals: 6,
				blockchain: "eth",
				symbol: "USDC",
				price: 1,
				priceUpdatedAt: "2026-02-13T18:09:00.000Z",
				contractAddress: "0xa0b8",
			},
		]);
		mockFetchJsonOnce(201, {
			correlationId: "corr-1",
			timestamp: "2026-02-13T18:10:42.627Z",
			signature: "ed25519:xxx",
			quoteRequest: {
				dry: true,
				swapType: "EXACT_INPUT",
				slippageTolerance: 100,
				originAsset: "nep141:wrap.near",
				depositType: "ORIGIN_CHAIN",
				destinationAsset: "nep141:usdc-near",
				amount: "10000000000000000000000",
				refundTo: "alice.near",
				refundType: "ORIGIN_CHAIN",
				recipient: "alice.near",
				recipientType: "DESTINATION_CHAIN",
				deadline: "2026-02-14T18:30:00.000Z",
			},
			quote: {
				amountIn: "10000000000000000000000",
				amountInFormatted: "0.01",
				amountInUsd: "0.0101",
				minAmountIn: "10000000000000000000000",
				amountOut: "8833",
				amountOutFormatted: "0.008833",
				amountOutUsd: "0.0088",
				minAmountOut: "8744",
				timeEstimate: 20,
			},
		});
		const tool = getTool("near_getIntentsQuote");
		const result = await tool.execute("near-read-intents-quote-1", {
			originAsset: "wNEAR",
			destinationAsset: "USDC",
			amount: "10000000000000000000000",
			accountId: "alice.near",
			network: "mainnet",
		});

		expect(restMocks.fetch).toHaveBeenCalledTimes(2);
		const quoteCall = restMocks.fetch.mock.calls[1];
		expect(quoteCall?.[0]).toBe("https://1click.chaindefuser.com/v0/quote");
		const request = JSON.parse(
			String((quoteCall?.[1] as RequestInit | undefined)?.body ?? "{}"),
		) as Record<string, unknown>;
		expect(request).toMatchObject({
			dry: true,
			swapType: "EXACT_INPUT",
			slippageTolerance: 100,
			originAsset: "nep141:wrap.near",
			destinationAsset: "nep141:usdc-near",
			amount: "10000000000000000000000",
			recipient: "alice.near",
			refundTo: "alice.near",
		});
		expect(result.content[0]?.text).toContain("Intents quote (dry)");
		expect(result.content[0]?.text).toContain("CorrelationId: corr-1");
		expect(result.details).toMatchObject({
			originAssetId: "nep141:wrap.near",
			destinationAssetId: "nep141:usdc-near",
			originSymbol: "wNEAR",
			destinationSymbol: "USDC",
		});
	});
});

describe("near_getIntentsStatus", () => {
	it("returns status summary for deposit address", async () => {
		mockFetchJsonOnce(200, {
			correlationId: "corr-status-1",
			status: "SUCCESS",
			updatedAt: "2026-02-13T18:20:00.000Z",
			quoteResponse: {
				correlationId: "corr-status-1",
				timestamp: "2026-02-13T18:10:42.627Z",
				signature: "ed25519:xxx",
				quoteRequest: {
					dry: false,
					swapType: "EXACT_INPUT",
					slippageTolerance: 100,
					originAsset: "nep141:wrap.near",
					depositType: "ORIGIN_CHAIN",
					destinationAsset: "nep141:usdc-near",
					amount: "10000000000000000000000",
					refundTo: "alice.near",
					refundType: "ORIGIN_CHAIN",
					recipient: "alice.near",
					recipientType: "DESTINATION_CHAIN",
					deadline: "2026-02-14T18:30:00.000Z",
				},
				quote: {
					amountIn: "10000000000000000000000",
					amountInFormatted: "0.01",
					amountInUsd: "0.0101",
					minAmountIn: "10000000000000000000000",
					amountOut: "8833",
					amountOutFormatted: "0.008833",
					amountOutUsd: "0.0088",
					minAmountOut: "8744",
					timeEstimate: 20,
				},
			},
			swapDetails: {
				amountIn: "10000000000000000000000",
				amountInFormatted: "0.01",
				amountOut: "8833",
				amountOutFormatted: "0.008833",
			},
		});
		const tool = getTool("near_getIntentsStatus");
		const result = await tool.execute("near-read-intents-status-1", {
			depositAddress: "0xabc123",
			depositMemo: "memo-7",
		});

		expect(restMocks.fetch).toHaveBeenCalledWith(
			"https://1click.chaindefuser.com/v0/status?depositAddress=0xabc123&depositMemo=memo-7",
			expect.objectContaining({
				method: "GET",
			}),
		);
		expect(result.content[0]?.text).toContain("Intents status: SUCCESS");
		expect(result.content[0]?.text).toContain("Settled: 0.01 -> 0.008833");
		expect(result.details).toMatchObject({
			depositAddress: "0xabc123",
			depositMemo: "memo-7",
			status: {
				status: "SUCCESS",
			},
		});
	});

	it("returns readable API error for missing deposit address", async () => {
		mockFetchJsonOnce(404, {
			message: "Deposit address test not found",
		});
		const tool = getTool("near_getIntentsStatus");
		await expect(
			tool.execute("near-read-intents-status-2", {
				depositAddress: "test",
			}),
		).rejects.toThrow("Deposit address test not found");
	});
});

describe("near_getIntentsAnyInputWithdrawals", () => {
	it("returns ANY_INPUT withdrawal list with readable summary", async () => {
		mockFetchJsonOnce(200, {
			asset: "nep141:usdc-near",
			recipient: "alice.near",
			affiliateRecipient: "partner.near",
			withdrawals: [
				{
					status: "WITHDRAWN",
					amountOut: "43210",
					amountOutFormatted: "0.043210",
					amountOutUsd: "0.0432",
					withdrawFee: "10",
					withdrawFeeFormatted: "0.000010",
					withdrawFeeUsd: "0.00001",
					timestamp: "2026-02-14T12:00:00.000Z",
					hash: "0xhash1",
				},
			],
			page: 1,
			limit: 50,
			total: 1,
		});
		const tool = getTool("near_getIntentsAnyInputWithdrawals");
		const result = await tool.execute("near-read-intents-withdrawals-1", {
			depositAddress: "0xdeposit",
			depositMemo: "memo-1",
			timestampFrom: "2026-02-14T00:00:00.000Z",
			page: 1,
			limit: 100,
			sortOrder: "desc",
		});

		expect(restMocks.fetch).toHaveBeenCalledWith(
			"https://1click.chaindefuser.com/v0/any-input/withdrawals?depositAddress=0xdeposit&depositMemo=memo-1&timestampFrom=2026-02-14T00%3A00%3A00.000Z&page=1&limit=50&sortOrder=desc",
			expect.objectContaining({
				method: "GET",
			}),
		);
		expect(result.content[0]?.text).toContain(
			"ANY_INPUT withdrawals: 1 record(s)",
		);
		expect(result.content[0]?.text).toContain("Asset: nep141:usdc-near");
		expect(result.content[0]?.text).toContain("WITHDRAWN");
		expect(result.details).toMatchObject({
			depositAddress: "0xdeposit",
			depositMemo: "memo-1",
			filters: {
				page: 1,
				limit: 50,
				sortOrder: "desc",
			},
			withdrawals: [
				{
					status: "WITHDRAWN",
					hash: "0xhash1",
				},
			],
			total: 1,
		});
	});

	it("supports withdrawals payload as object and surfaces API errors", async () => {
		mockFetchJsonOnce(200, {
			asset: "nep141:usdc-near",
			withdrawals: {
				status: "PENDING_WITHDRAWAL",
				amountOut: "100",
				hash: "0xsingle",
				timestamp: "2026-02-14T13:00:00.000Z",
			},
		});
		const tool = getTool("near_getIntentsAnyInputWithdrawals");
		const singleResult = await tool.execute("near-read-intents-withdrawals-2", {
			depositAddress: "0xdeposit2",
		});
		expect(singleResult.content[0]?.text).toContain(
			"ANY_INPUT withdrawals: 1 record(s)",
		);
		expect(singleResult.details).toMatchObject({
			withdrawals: [
				{
					status: "PENDING_WITHDRAWAL",
					hash: "0xsingle",
				},
			],
		});

		mockFetchJsonOnce(404, {
			message: "ANY_INPUT withdrawals not found",
		});
		await expect(
			tool.execute("near-read-intents-withdrawals-3", {
				depositAddress: "0xmissing",
			}),
		).rejects.toThrow("ANY_INPUT withdrawals not found");
	});
});
