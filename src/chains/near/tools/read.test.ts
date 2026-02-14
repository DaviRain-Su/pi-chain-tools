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

const burrowMocks = vi.hoisted(() => ({
	fetchBurrowAccountAllPositions: vi.fn(),
	fetchBurrowAssetsPagedDetailed: vi.fn(),
	fromBurrowInnerAmount: vi.fn((value: string) => value),
	getBurrowContractId: vi.fn(() => "contract.main.burrow.near"),
	parseBurrowExtraDecimals: vi.fn((value: unknown) =>
		Number.isInteger(value) ? (value as number) : 0,
	),
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

vi.mock("../burrow.js", async () => {
	const actual =
		await vi.importActual<typeof import("../burrow.js")>("../burrow.js");
	return {
		...actual,
		fetchBurrowAccountAllPositions: burrowMocks.fetchBurrowAccountAllPositions,
		fetchBurrowAssetsPagedDetailed: burrowMocks.fetchBurrowAssetsPagedDetailed,
		fromBurrowInnerAmount: burrowMocks.fromBurrowInnerAmount,
		getBurrowContractId: burrowMocks.getBurrowContractId,
		parseBurrowExtraDecimals: burrowMocks.parseBurrowExtraDecimals,
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

function encodeJsonResult(value: unknown): number[] {
	return [...Buffer.from(JSON.stringify(value), "utf8")];
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
	Reflect.deleteProperty(process.env, "NEAR_INTENTS_JWT");
	Reflect.deleteProperty(process.env, "NEAR_INTENTS_EXPLORER_JWT");
	Reflect.deleteProperty(process.env, "NEAR_INTENTS_EXPLORER_API_BASE_URL");
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
	burrowMocks.getBurrowContractId.mockReturnValue("contract.main.burrow.near");
	burrowMocks.fetchBurrowAssetsPagedDetailed.mockResolvedValue([]);
	burrowMocks.fetchBurrowAccountAllPositions.mockResolvedValue(null);
	burrowMocks.fromBurrowInnerAmount.mockImplementation(
		(value: string) => value,
	);
	burrowMocks.parseBurrowExtraDecimals.mockImplementation((value: unknown) =>
		Number.isInteger(value) ? (value as number) : 0,
	);
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
		mockFetchJsonOnce(200, [
			{
				assetId: "nep141:wrap.near",
				decimals: 24,
				blockchain: "near",
				symbol: "NEAR",
				price: 5,
				priceUpdatedAt: "2026-01-01T00:00:00.000Z",
				contractAddress: "wrap.near",
			},
			{
				assetId: "nep141:usdc.fakes.near",
				decimals: 6,
				blockchain: "near",
				symbol: "USDC",
				price: 1,
				priceUpdatedAt: "2026-01-01T00:00:00.000Z",
				contractAddress: "usdc.fakes.near",
			},
		]);
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
		expect(result.content[0]?.text).toContain("Estimated USD value (wallet)");
		expect(result.content[0]?.text).toContain("Top wallet assets by USD:");
		expect(result.content[0]?.text).toContain("Valuation prices as of:");
		expect(result.content[0]?.text).toContain("Wallet assets (>0):");
		expect(result.content[0]?.text).toContain("USDC: 1.2345");
		expect(result.content[0]?.text).toContain("Asset details:");
		expect(result.details).toMatchObject({
			accountId: "alice.near",
			network: "mainnet",
			autoDiscoverDefiTokens: false,
			ftContractsQueried: ["usdc.fakes.near", "usdt.tether-token.near"],
			walletNonZeroFtAssets: [
				{
					tokenId: "usdc.fakes.near",
					symbol: "USDC",
					rawAmount: "1234500",
					uiAmount: "1.2345",
				},
			],
			includeValuationUsd: true,
			valuation: {
				enabled: true,
				currency: "USD",
				source: "near_intents_tokens",
				tokenCount: 2,
				walletAssetCount: 2,
				pricedWalletAssetCount: 2,
				priceUpdatedAtLatest: "2026-01-01T00:00:00.000Z",
				priceUpdatedAtOldest: "2026-01-01T00:00:00.000Z",
			},
			defiExposure: {
				refDeposits: [],
				burrowSupplied: [],
				burrowCollateral: [],
				burrowBorrowed: [],
			},
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
		const valuation = (
			result.details as { valuation?: { totalWalletUsd?: number } }
		).valuation;
		expect(valuation?.totalWalletUsd).toBeCloseTo(6.2345, 6);
	});

	it("reuses valuation token feed within cache ttl", async () => {
		mockFetchJsonOnce(200, [
			{
				assetId: "nep141:wrap.near",
				decimals: 24,
				blockchain: "near",
				symbol: "NEAR",
				price: 5,
				priceUpdatedAt: "2026-01-01T00:00:00.000Z",
				contractAddress: "wrap.near",
			},
			{
				assetId: "nep141:usdc.fakes.near",
				decimals: 6,
				blockchain: "near",
				symbol: "USDC",
				price: 1,
				priceUpdatedAt: "2026-01-01T00:00:00.000Z",
				contractAddress: "usdc.fakes.near",
			},
		]);
		runtimeMocks.callNearRpc.mockImplementation(async ({ params }) => {
			if (!params || typeof params !== "object") {
				throw new Error("invalid params");
			}
			if (params.request_type === "view_account") {
				return {
					amount: "1000000000000000000000000",
					block_hash: "4471",
					block_height: 931,
					code_hash: "11111111111111111111111111111111",
					locked: "0",
					storage_paid_at: 0,
					storage_usage: 381,
				};
			}
			if (params.method_name === "ft_balance_of") {
				return {
					block_hash: "4472",
					block_height: 932,
					logs: [],
					result: encodeJsonResult("1000000"),
				};
			}
			if (params.method_name === "ft_metadata") {
				return {
					block_hash: "4473",
					block_height: 933,
					logs: [],
					result: encodeJsonResult({
						decimals: 6,
						symbol: "USDC",
					}),
				};
			}
			throw new Error("unexpected callNearRpc");
		});
		runtimeMocks.formatNearAmount.mockReturnValue("1");
		runtimeMocks.formatTokenAmount.mockImplementation((value: string) => value);

		const tool = getTool("near_getPortfolio");
		const first = await tool.execute("near-read-portfolio-cache-1", {
			accountId: "alice.near",
			network: "mainnet",
			ftContractIds: ["usdc.fakes.near"],
			valuationApiBaseUrl: "https://cache-test.chaindefuser.example",
			valuationCacheTtlMs: 60000,
		});
		const second = await tool.execute("near-read-portfolio-cache-2", {
			accountId: "alice.near",
			network: "mainnet",
			ftContractIds: ["usdc.fakes.near"],
			valuationApiBaseUrl: "https://cache-test.chaindefuser.example",
			valuationCacheTtlMs: 60000,
		});

		expect(restMocks.fetch).toHaveBeenCalledTimes(1);
		const firstValuation = (
			first.details as { valuation?: { cache?: { hit?: boolean } } }
		).valuation;
		const secondValuation = (
			second.details as {
				valuation?: { cache?: { hit?: boolean; ageMs?: number | null } };
			}
		).valuation;
		expect(firstValuation?.cache?.hit).toBe(false);
		expect(secondValuation?.cache?.hit).toBe(true);
		expect(secondValuation?.cache?.ageMs).not.toBeNull();
	});

	it("auto-discovers DeFi tokens from Ref/Burrow into portfolio query", async () => {
		burrowMocks.fetchBurrowAccountAllPositions.mockResolvedValue({
			account_id: "alice.near",
			supplied: [
				{
					token_id: "usdt.tether-token.near",
					balance: "111",
					shares: "100",
				},
			],
			positions: {},
		});
		runtimeMocks.callNearRpc.mockImplementation(async ({ params }) => {
			if (!params || typeof params !== "object") {
				throw new Error("invalid params");
			}
			if (params.request_type === "view_account") {
				return {
					amount: "1000000000000000000000000",
					block_hash: "4451",
					block_height: 911,
					code_hash: "11111111111111111111111111111111",
					locked: "0",
					storage_paid_at: 0,
					storage_usage: 381,
				};
			}
			if (params.method_name === "get_deposits") {
				return {
					block_hash: "4452",
					block_height: 912,
					logs: [],
					result: encodeJsonResult({
						aurora: "500",
					}),
				};
			}
			if (params.method_name === "ft_balance_of") {
				if (params.account_id === "usdc.fakes.near") {
					return {
						block_hash: "4453",
						block_height: 913,
						logs: [],
						result: encodeJsonResult("123"),
					};
				}
				if (params.account_id === "aurora") {
					return {
						block_hash: "4454",
						block_height: 914,
						logs: [],
						result: encodeJsonResult("500"),
					};
				}
				if (params.account_id === "usdt.tether-token.near") {
					return {
						block_hash: "4455",
						block_height: 915,
						logs: [],
						result: encodeJsonResult("111"),
					};
				}
			}
			if (params.method_name === "ft_metadata") {
				if (params.account_id === "usdc.fakes.near") {
					return {
						block_hash: "4456",
						block_height: 916,
						logs: [],
						result: encodeJsonResult({
							decimals: 6,
							symbol: "USDC",
						}),
					};
				}
				if (params.account_id === "aurora") {
					return {
						block_hash: "4457",
						block_height: 917,
						logs: [],
						result: encodeJsonResult({
							decimals: 18,
							symbol: "AURORA",
						}),
					};
				}
				if (params.account_id === "usdt.tether-token.near") {
					return {
						block_hash: "4458",
						block_height: 918,
						logs: [],
						result: encodeJsonResult({
							decimals: 6,
							symbol: "USDT",
						}),
					};
				}
			}
			throw new Error(
				`unexpected method ${String((params as { method_name?: unknown }).method_name)}`,
			);
		});
		runtimeMocks.formatNearAmount.mockReturnValue("1");
		runtimeMocks.formatTokenAmount.mockImplementation((value: string) => value);

		const tool = getTool("near_getPortfolio");
		const result = await tool.execute("near-read-portfolio-2", {
			accountId: "alice.near",
			network: "mainnet",
			ftContractIds: ["usdc.fakes.near"],
			autoDiscoverDefiTokens: true,
		});

		expect(result.content[0]?.text).toContain("Auto-discovered DeFi tokens");
		expect(result.content[0]?.text).toContain("DeFi exposure:");
		expect(result.content[0]?.text).toContain("DeFi tracked tokens:");
		expect(result.content[0]?.text).toContain("Ref deposits 1");
		expect(result.content[0]?.text).toContain("Burrow supplied 1");
		expect(result.content[0]?.text).toContain("- Ref deposits:");
		expect(result.details).toMatchObject({
			accountId: "alice.near",
			autoDiscoverDefiTokens: true,
			baseFtContracts: ["usdc.fakes.near"],
			discoveredFtContracts: ["aurora", "usdt.tether-token.near"],
			discoveredBySource: {
				refDeposits: ["aurora"],
				burrowPositions: ["usdt.tether-token.near"],
			},
			discoveredByRole: {
				refDeposits: ["aurora"],
				burrowSupplied: ["usdt.tether-token.near"],
				burrowCollateral: [],
				burrowBorrowed: [],
			},
			defiExposure: {
				refDeposits: [
					{
						tokenId: "aurora",
						inWallet: true,
					},
				],
				burrowSupplied: [
					{
						tokenId: "usdt.tether-token.near",
						inWallet: true,
					},
				],
			},
			ftContractsQueried: [
				"usdc.fakes.near",
				"aurora",
				"usdt.tether-token.near",
			],
		});
		const walletNonZero = (
			result.details as {
				walletNonZeroFtAssets?: Array<{ tokenId: string }>;
			}
		).walletNonZeroFtAssets;
		expect(walletNonZero).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ tokenId: "aurora" }),
				expect.objectContaining({ tokenId: "usdc.fakes.near" }),
				expect.objectContaining({ tokenId: "usdt.tether-token.near" }),
			]),
		);
	});

	it("keeps discovered DeFi tokens even when wallet balance is zero", async () => {
		burrowMocks.fetchBurrowAccountAllPositions.mockResolvedValue({
			account_id: "alice.near",
			supplied: [
				{
					token_id: "usdt.tether-token.near",
					balance: "500",
					shares: "100",
				},
			],
			positions: {},
		});
		runtimeMocks.callNearRpc.mockImplementation(async ({ params }) => {
			if (!params || typeof params !== "object") {
				throw new Error("invalid params");
			}
			if (params.request_type === "view_account") {
				return {
					amount: "1000000000000000000000000",
					block_hash: "4461",
					block_height: 921,
					code_hash: "11111111111111111111111111111111",
					locked: "0",
					storage_paid_at: 0,
					storage_usage: 381,
				};
			}
			if (params.method_name === "get_deposits") {
				return {
					block_hash: "4462",
					block_height: 922,
					logs: [],
					result: encodeJsonResult({
						aurora: "1",
					}),
				};
			}
			if (params.method_name === "ft_balance_of") {
				if (params.account_id === "usdc.fakes.near") {
					return {
						block_hash: "4463",
						block_height: 923,
						logs: [],
						result: encodeJsonResult("123"),
					};
				}
				if (
					params.account_id === "aurora" ||
					params.account_id === "usdt.tether-token.near"
				) {
					return {
						block_hash: "4464",
						block_height: 924,
						logs: [],
						result: encodeJsonResult("0"),
					};
				}
			}
			if (params.method_name === "ft_metadata") {
				if (params.account_id === "usdc.fakes.near") {
					return {
						block_hash: "4465",
						block_height: 925,
						logs: [],
						result: encodeJsonResult({
							decimals: 6,
							symbol: "USDC",
						}),
					};
				}
				if (params.account_id === "aurora") {
					return {
						block_hash: "4466",
						block_height: 926,
						logs: [],
						result: encodeJsonResult({
							decimals: 18,
							symbol: "AURORA",
						}),
					};
				}
				if (params.account_id === "usdt.tether-token.near") {
					return {
						block_hash: "4467",
						block_height: 927,
						logs: [],
						result: encodeJsonResult({
							decimals: 6,
							symbol: "USDT",
						}),
					};
				}
			}
			throw new Error(
				`unexpected method ${String((params as { method_name?: unknown }).method_name)}`,
			);
		});
		runtimeMocks.formatNearAmount.mockReturnValue("1");
		runtimeMocks.formatTokenAmount.mockImplementation((value: string) => value);

		const tool = getTool("near_getPortfolio");
		const result = await tool.execute("near-read-portfolio-3", {
			accountId: "alice.near",
			network: "mainnet",
			ftContractIds: ["usdc.fakes.near"],
			autoDiscoverDefiTokens: true,
		});

		expect(result.content[0]?.text).toContain("AURORA: 0");
		expect(result.content[0]?.text).toContain("USDT: 0");
		expect(result.content[0]?.text).toContain("DeFi exposure:");
		expect(result.content[0]?.text).toContain("- Burrow supplied:");
		expect(result.content[0]?.text).toContain("[discovered in Ref]");
		expect(result.content[0]?.text).toContain("[discovered in Burrow]");
		expect(result.details).toMatchObject({
			discoveredByRole: {
				refDeposits: ["aurora"],
				burrowSupplied: ["usdt.tether-token.near"],
				burrowCollateral: [],
				burrowBorrowed: [],
			},
			defiExposure: {
				refDeposits: [
					{
						tokenId: "aurora",
						inWallet: false,
					},
				],
				burrowSupplied: [
					{
						tokenId: "usdt.tether-token.near",
						inWallet: false,
					},
				],
			},
			assets: expect.arrayContaining([
				expect.objectContaining({
					contractId: "aurora",
					rawAmount: "0",
					discoveredSources: ["refDeposits"],
				}),
				expect.objectContaining({
					contractId: "usdt.tether-token.near",
					rawAmount: "0",
					discoveredSources: ["burrowPositions"],
				}),
			]),
		});
	});
});

describe("near_getLendingMarketsBurrow", () => {
	it("returns readable Burrow lending markets", async () => {
		burrowMocks.fetchBurrowAssetsPagedDetailed.mockResolvedValue([
			{
				token_id: "wrap.near",
				supplied: { shares: "1000", balance: "1000" },
				borrowed: { shares: "200", balance: "200" },
				config: {
					extra_decimals: 0,
					can_deposit: true,
					can_withdraw: true,
					can_borrow: true,
					can_use_as_collateral: true,
				},
				supply_apr: "0.0123",
				borrow_apr: "0.0456",
			},
			{
				token_id: "usdc.tether-token.near",
				supplied: { shares: "5000", balance: "5000" },
				borrowed: { shares: "0", balance: "0" },
				config: {
					extra_decimals: 0,
					can_deposit: true,
					can_withdraw: true,
					can_borrow: false,
					can_use_as_collateral: true,
				},
				supply_apr: "0.0042",
				borrow_apr: "0.0",
			},
		]);
		runtimeMocks.callNearRpc.mockImplementation(
			(args: {
				params: { method_name?: string; account_id?: string };
			}) => {
				if (args.params.method_name === "ft_metadata") {
					if (args.params.account_id === "wrap.near") {
						return Promise.resolve({
							block_hash: "meta-1",
							block_height: 1,
							logs: [],
							result: encodeJsonResult({
								symbol: "WNEAR",
								decimals: 24,
							}),
						});
					}
					if (args.params.account_id === "usdc.tether-token.near") {
						return Promise.resolve({
							block_hash: "meta-2",
							block_height: 2,
							logs: [],
							result: encodeJsonResult({
								symbol: "USDC",
								decimals: 6,
							}),
						});
					}
				}
				throw new Error("unexpected callNearRpc in market test");
			},
		);
		burrowMocks.fromBurrowInnerAmount.mockImplementation(
			(value: string) => value,
		);

		const tool = getTool("near_getLendingMarketsBurrow");
		const result = await tool.execute("near-read-burrow-markets-1", {
			network: "mainnet",
		});

		expect(burrowMocks.fetchBurrowAssetsPagedDetailed).toHaveBeenCalledWith({
			network: "mainnet",
			rpcUrl: undefined,
			burrowContractId: "contract.main.burrow.near",
			fromIndex: 0,
			limit: 30,
		});
		expect(result.content[0]?.text).toContain(
			"Burrow lending markets: 2 shown",
		);
		expect(result.content[0]?.text).toContain("WNEAR");
		expect(result.content[0]?.text).toContain("USDC");
		expect(result.details).toMatchObject({
			network: "mainnet",
			burrowContractId: "contract.main.burrow.near",
			fetchedCount: 2,
		});
	});
});

describe("near_getLendingPositionsBurrow", () => {
	it("returns Burrow supplied/collateral/borrowed snapshot", async () => {
		burrowMocks.fetchBurrowAssetsPagedDetailed.mockResolvedValue([
			{
				token_id: "wrap.near",
				supplied: { shares: "0", balance: "0" },
				borrowed: { shares: "0", balance: "0" },
				config: { extra_decimals: 0 },
			},
			{
				token_id: "usdc.tether-token.near",
				supplied: { shares: "0", balance: "0" },
				borrowed: { shares: "0", balance: "0" },
				config: { extra_decimals: 0 },
			},
		]);
		burrowMocks.fetchBurrowAccountAllPositions.mockResolvedValue({
			account_id: "alice.near",
			supplied: [
				{
					token_id: "wrap.near",
					balance: "1000",
					shares: "900",
					apr: "0.01",
				},
			],
			positions: {
				REGULAR: {
					collateral: [
						{
							token_id: "wrap.near",
							balance: "800",
							shares: "700",
							apr: "0.01",
						},
					],
					borrowed: [
						{
							token_id: "usdc.tether-token.near",
							balance: "120",
							shares: "100",
							apr: "0.05",
						},
					],
				},
			},
			is_locked: false,
		});
		runtimeMocks.callNearRpc.mockImplementation(
			(args: {
				params: { method_name?: string; account_id?: string };
			}) => {
				if (args.params.method_name === "ft_metadata") {
					if (args.params.account_id === "wrap.near") {
						return Promise.resolve({
							block_hash: "meta-1",
							block_height: 1,
							logs: [],
							result: encodeJsonResult({
								symbol: "WNEAR",
								decimals: 24,
							}),
						});
					}
					if (args.params.account_id === "usdc.tether-token.near") {
						return Promise.resolve({
							block_hash: "meta-2",
							block_height: 2,
							logs: [],
							result: encodeJsonResult({
								symbol: "USDC",
								decimals: 6,
							}),
						});
					}
				}
				throw new Error("unexpected callNearRpc in positions test");
			},
		);
		burrowMocks.fromBurrowInnerAmount.mockImplementation(
			(value: string) => value,
		);

		const tool = getTool("near_getLendingPositionsBurrow");
		const result = await tool.execute("near-read-burrow-positions-1", {
			accountId: "alice.near",
			network: "mainnet",
		});

		expect(burrowMocks.fetchBurrowAccountAllPositions).toHaveBeenCalledWith({
			accountId: "alice.near",
			burrowContractId: "contract.main.burrow.near",
			network: "mainnet",
			rpcUrl: undefined,
		});
		expect(result.content[0]?.text).toContain(
			"Burrow positions: account alice.near",
		);
		expect(result.content[0]?.text).toContain("Risk: medium");
		expect(result.content[0]?.text).toContain("Position REGULAR");
		expect(result.content[0]?.text).toContain("borrowed USDC");
		expect(result.details).toMatchObject({
			accountId: "alice.near",
			registered: true,
			riskSummary: {
				level: "medium",
				suppliedAssetCount: 1,
				collateralAssetCount: 1,
				borrowedAssetCount: 1,
				hasBorrowedExposure: true,
				hasCollateralExposure: true,
			},
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

describe("near_getIntentsExplorerTransactions", () => {
	it("returns paginated explorer transactions with readable summary", async () => {
		process.env.NEAR_INTENTS_EXPLORER_JWT = "jwt-test-token";
		mockFetchJsonOnce(200, {
			data: [
				{
					originAsset: "nep141:wrap.near",
					destinationAsset: "nep141:usdc.near",
					depositAddress: "deposit-address-1",
					depositAddressAndMemo: "deposit-address-1_123",
					recipient: "alice.near",
					status: "SUCCESS",
					createdAt: "2026-02-14T12:00:00.000Z",
					createdAtTimestamp: 1771060800,
					intentHashes: "intent-hash-1",
					referral: "ref-1",
					amountIn: "10000000000000000000000",
					amountInFormatted: "0.01",
					amountInUsd: "0.03",
					amountOut: "10000",
					amountOutFormatted: "0.01",
					amountOutUsd: "0.01",
					refundTo: "alice.near",
					senders: ["alice.near"],
					nearTxHashes: ["near-hash-1"],
					originChainTxHashes: ["origin-hash-1"],
					destinationChainTxHashes: ["destination-hash-1"],
				},
				{
					originAsset: "nep141:usdt.tether-token.near",
					destinationAsset: "nep141:wrap.near",
					depositAddress: "deposit-address-2",
					recipient: "bob.near",
					status: "PROCESSING",
					createdAt: "2026-02-14T12:05:00.000Z",
					createdAtTimestamp: 1771061100,
					amountInFormatted: "1",
					amountOutFormatted: "0.98",
					refundReason: "NO_LIQUIDITY",
					senders: ["0xabc"],
					nearTxHashes: [],
					originChainTxHashes: [],
					destinationChainTxHashes: [],
				},
			],
			page: 2,
			perPage: 2,
			total: 5,
			totalPages: 3,
			nextPage: 3,
			prevPage: 1,
		});
		const tool = getTool("near_getIntentsExplorerTransactions");
		const result = await tool.execute("near-read-intents-explorer-1", {
			page: 2,
			perPage: 2,
			search: "alice",
			fromChainId: "near",
			toChainId: "eth",
			statuses: ["SUCCESS", "PROCESSING"],
			minUsdPrice: 1,
			maxUsdPrice: 10,
		});

		const [url, init] = restMocks.fetch.mock.calls[0] ?? [];
		expect(String(url)).toContain(
			"https://explorer.near-intents.org/api/v0/transactions-pages",
		);
		expect(String(url)).toContain("page=2");
		expect(String(url)).toContain("perPage=2");
		expect(String(url)).toContain("fromChainId=near");
		expect(String(url)).toContain("toChainId=eth");
		expect(String(url)).toContain("search=alice");
		expect(String(url)).toContain("statuses=SUCCESS%2CPROCESSING");
		expect(String(url)).toContain("minUsdPrice=1");
		expect(String(url)).toContain("maxUsdPrice=10");
		expect(init).toMatchObject({
			method: "GET",
			headers: expect.objectContaining({
				Authorization: "Bearer jwt-test-token",
			}),
		});
		expect(result.content[0]?.text).toContain(
			"Intents explorer txs: 2 item(s)",
		);
		expect(result.content[0]?.text).toContain(
			"Status summary: PROCESSING=1 | SUCCESS=1",
		);
		expect(result.content[0]?.text).toContain("USD in/out: $0.03 / $0.01");
		expect(result.content[0]?.text).toContain("Top routes:");
		expect(result.content[0]?.text).toContain("[SUCCESS]");
		expect(result.content[0]?.text).toContain("[PROCESSING]");
		expect(result.details).toMatchObject({
			total: 5,
			totalPages: 3,
			nextPage: 3,
			prevPage: 1,
			summary: {
				statusCounts: {
					SUCCESS: 1,
					PROCESSING: 1,
				},
				totalAmountInUsd: 0.03,
				totalAmountOutUsd: 0.01,
				topRoutes: expect.arrayContaining([
					{
						route: expect.stringContaining("[nep141]"),
						count: 1,
					},
				]),
			},
			transactions: [
				{
					status: "SUCCESS",
				},
				{
					status: "PROCESSING",
					refundReason: "NO_LIQUIDITY",
				},
			],
		});
	});

	it("supports cursor mode and exposes next cursors", async () => {
		process.env.NEAR_INTENTS_EXPLORER_JWT = "jwt-test-token";
		mockFetchJsonOnce(200, [
			{
				originAsset: "nep141:wrap.near",
				destinationAsset: "nep141:usdc.near",
				depositAddress: "deposit-1",
				depositAddressAndMemo: "deposit-1_1",
				recipient: "alice.near",
				status: "SUCCESS",
				createdAt: "2026-02-14T12:00:00.000Z",
				createdAtTimestamp: 1771060800,
				amountInFormatted: "0.01",
				amountOutFormatted: "0.01",
				senders: ["alice.near"],
				nearTxHashes: [],
				originChainTxHashes: [],
				destinationChainTxHashes: [],
			},
			{
				originAsset: "nep141:wrap.near",
				destinationAsset: "nep141:usdc.near",
				depositAddress: "deposit-2",
				depositAddressAndMemo: "deposit-2_2",
				recipient: "bob.near",
				status: "PROCESSING",
				createdAt: "2026-02-14T11:59:00.000Z",
				createdAtTimestamp: 1771060740,
				amountInFormatted: "0.02",
				amountOutFormatted: "0.0195",
				senders: ["bob.near"],
				nearTxHashes: [],
				originChainTxHashes: [],
				destinationChainTxHashes: [],
			},
		]);
		const tool = getTool("near_getIntentsExplorerTransactions");
		const result = await tool.execute("near-read-intents-explorer-cursor-1", {
			mode: "cursor",
			numberOfTransactions: 2,
			direction: "next",
			lastDepositAddressAndMemo: "deposit-0_0",
		});

		const [url] = restMocks.fetch.mock.calls[0] ?? [];
		expect(String(url)).toContain(
			"https://explorer.near-intents.org/api/v0/transactions?",
		);
		expect(String(url)).toContain("numberOfTransactions=2");
		expect(String(url)).toContain("lastDepositAddressAndMemo=deposit-0_0");
		expect(String(url)).toContain("direction=next");
		expect(result.content[0]?.text).toContain(
			"mode=cursor direction=next limit=2",
		);
		expect(result.content[0]?.text).toContain(
			"Status summary: PROCESSING=1 | SUCCESS=1",
		);
		expect(result.content[0]?.text).toContain("Top routes:");
		expect(result.content[0]?.text).toContain("Cursor(older): deposit-2_2");
		expect(result.content[0]?.text).toContain("Cursor(newer): deposit-1_1");
		expect(result.details).toMatchObject({
			filters: {
				mode: "cursor",
				numberOfTransactions: 2,
				direction: "next",
				lastDepositAddressAndMemo: "deposit-0_0",
			},
			cursor: {
				older: "deposit-2_2",
				newer: "deposit-1_1",
			},
			summary: {
				statusCounts: {
					SUCCESS: 1,
					PROCESSING: 1,
				},
				topRoutes: [
					{
						route: expect.stringContaining("wrap.near [nep141]"),
						count: 2,
					},
				],
			},
			transactions: [
				{
					status: "SUCCESS",
				},
				{
					status: "PROCESSING",
				},
			],
		});
	});

	it("requires jwt for explorer API", async () => {
		const tool = getTool("near_getIntentsExplorerTransactions");
		await expect(
			tool.execute("near-read-intents-explorer-2", {}),
		).rejects.toThrow("requires jwt");
		expect(restMocks.fetch).not.toHaveBeenCalled();
	});

	it("supports abnormal quickView preset", async () => {
		process.env.NEAR_INTENTS_EXPLORER_JWT = "jwt-test-token";
		mockFetchJsonOnce(200, {
			data: [
				{
					originAsset: "nep141:wrap.near",
					destinationAsset: "nep141:usdc.near",
					depositAddress: "deposit-address-3",
					recipient: "carol.near",
					status: "FAILED",
					createdAt: "2026-02-14T12:10:00.000Z",
					createdAtTimestamp: 1771061400,
					amountInFormatted: "0.1",
					amountOutFormatted: "0.0",
					senders: ["carol.near"],
					nearTxHashes: [],
					originChainTxHashes: [],
					destinationChainTxHashes: [],
				},
			],
			page: 1,
			perPage: 20,
			total: 1,
			totalPages: 1,
			nextPage: null,
			prevPage: null,
		});
		const tool = getTool("near_getIntentsExplorerTransactions");
		const result = await tool.execute("near-read-intents-explorer-quick-1", {
			quickView: "abnormal",
		});

		const [url] = restMocks.fetch.mock.calls[0] ?? [];
		expect(String(url)).toContain(
			"statuses=FAILED%2CREFUNDED%2CINCOMPLETE_DEPOSIT",
		);
		expect(result.content[0]?.text).toContain(
			"Quick view: abnormal (FAILED | REFUNDED | INCOMPLETE_DEPOSIT)",
		);
		expect(result.details).toMatchObject({
			filters: {
				quickView: "abnormal",
				statuses: "FAILED,REFUNDED,INCOMPLETE_DEPOSIT",
			},
			summary: {
				statusCounts: {
					FAILED: 1,
				},
			},
		});
	});

	it("surfaces explorer API errors", async () => {
		process.env.NEAR_INTENTS_EXPLORER_JWT = "jwt-test-token";
		mockFetchJsonOnce(429, {
			message: "Rate limit exceeded",
		});
		const tool = getTool("near_getIntentsExplorerTransactions");
		await expect(
			tool.execute("near-read-intents-explorer-3", {
				perPage: 5,
			}),
		).rejects.toThrow("Rate limit exceeded");
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

	it("supports querying status by correlationId", async () => {
		mockFetchJsonOnce(200, {
			correlationId: "corr-status-2",
			status: "PROCESSING",
			updatedAt: "2026-02-13T18:30:00.000Z",
			quoteResponse: {
				correlationId: "corr-status-2",
				timestamp: "2026-02-13T18:10:42.627Z",
				signature: "ed25519:yyy",
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
			swapDetails: {},
		});
		const tool = getTool("near_getIntentsStatus");
		const result = await tool.execute("near-read-intents-status-corr-1", {
			correlationId: "corr-status-2",
		});

		expect(restMocks.fetch).toHaveBeenCalledWith(
			"https://1click.chaindefuser.com/v0/status?correlationId=corr-status-2",
			expect.objectContaining({
				method: "GET",
			}),
		);
		expect(result.content[0]?.text).toContain(
			"Correlation query: corr-status-2",
		);
		expect(result.details).toMatchObject({
			query: {
				depositAddress: null,
				depositMemo: null,
				correlationId: "corr-status-2",
			},
			status: {
				status: "PROCESSING",
			},
		});
	});

	it("requires depositAddress or correlationId", async () => {
		const tool = getTool("near_getIntentsStatus");
		await expect(
			tool.execute("near-read-intents-status-missing", {}),
		).rejects.toThrow("requires depositAddress or correlationId");
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
