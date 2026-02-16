import { afterEach, describe, expect, it, vi } from "vitest";
import {
	MORPHO_API_URL,
	MORPHO_DEPLOYMENTS,
	MORPHO_PROTOCOL_ID,
	buildMorphoSupplyCollateralCalldata,
	buildMorphoWithdrawCollateralCalldata,
	chainIdForNetwork,
	createMorphoAdapter,
	encodeMarketParams,
	getMorphoAddress,
	morphoPadAddress,
	morphoPadUint256,
} from "./morpho-adapter.js";

// Save original fetch
const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
	global.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

// Mock fetch helper
function mockFetchJson(responseData: unknown) {
	const fetchMock = vi.fn().mockResolvedValue(
		new Response(JSON.stringify(responseData), {
			status: 200,
			headers: { "content-type": "application/json" },
		}),
	);
	global.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

describe("morpho-adapter constants", () => {
	it("has monad deployment", () => {
		expect(MORPHO_DEPLOYMENTS.monad).toBe(
			"0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
		);
	});

	it("protocolId is morpho-blue", () => {
		expect(MORPHO_PROTOCOL_ID).toBe("morpho-blue");
	});

	it("API URL is correct", () => {
		expect(MORPHO_API_URL).toBe("https://blue-api.morpho.org/graphql");
	});
});

describe("morpho ABI helpers", () => {
	it("padAddress pads correctly", () => {
		const result = morphoPadAddress(
			"0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
		);
		expect(result).toBe(
			"000000000000000000000000754704bc059f8c67012fed69bc8a327a5aafb603",
		);
		expect(result.length).toBe(64);
	});

	it("padUint256 pads string amount", () => {
		const result = morphoPadUint256("1000000");
		expect(result.length).toBe(64);
		expect(result).toBe(BigInt("1000000").toString(16).padStart(64, "0"));
	});

	it("padUint256 pads bigint", () => {
		const result = morphoPadUint256(1000000n);
		expect(result.length).toBe(64);
	});

	it("encodeMarketParams encodes 5 fields to 320 hex chars", () => {
		const result = encodeMarketParams({
			loanToken: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
			collateralToken: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
			oracle: "0x0000000000000000000000000000000000000001",
			irm: "0x0000000000000000000000000000000000000002",
			lltv: "770000000000000000",
		});
		expect(result.length).toBe(64 * 5); // 5 x 32 bytes
	});
});

describe("getMorphoAddress", () => {
	it("returns monad address", () => {
		expect(getMorphoAddress("monad")).toBe(
			"0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
		);
	});

	it("throws for unsupported network", () => {
		expect(() => getMorphoAddress("bsc")).toThrow(
			"Morpho Blue is not configured for network=bsc",
		);
	});
});

describe("chainIdForNetwork", () => {
	it("monad is 143", () => {
		expect(chainIdForNetwork("monad")).toBe(143);
	});
	it("ethereum is 1", () => {
		expect(chainIdForNetwork("ethereum")).toBe(1);
	});
	it("unknown returns 0", () => {
		expect(chainIdForNetwork("bsc")).toBe(0);
	});
});

describe("createMorphoAdapter getMarkets", () => {
	it("returns markets from API", async () => {
		const apiResponse = {
			data: {
				markets: {
					items: [
						{
							uniqueKey: "0xabc123",
							morphoBlue: {
								address: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
							},
							state: {
								supplyApy: 0.0328,
								borrowApy: 0.041,
								supplyAssetsUsd: 13339460,
								borrowAssetsUsd: 10723674,
							},
							loanAsset: {
								address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
								symbol: "USDC",
								decimals: 6,
							},
							collateralAsset: {
								address: "0x4809010926aec940b550D34a46A52739f996D75D",
								symbol: "wsrUSD",
								decimals: 18,
							},
							lltv: "860000000000000000",
							oracleAddress: "0x0000000000000000000000000000000001",
							irmAddress: "0x0000000000000000000000000000000002",
						},
					],
				},
			},
		};

		mockFetchJson(apiResponse);

		const adapter = createMorphoAdapter();
		const markets = await adapter.getMarkets("monad");

		expect(markets.length).toBe(1);
		expect(markets[0].protocol).toBe("morpho-blue");
		expect(markets[0].network).toBe("monad");
		expect(markets[0].underlyingSymbol).toBe("USDC/wsrUSD");
		expect(markets[0].supplyAPY).toBeCloseTo(3.28, 1);
		expect(markets[0].borrowAPY).toBeCloseTo(4.1, 1);
		expect(markets[0].collateralFactor).toBeCloseTo(0.86, 2);
		expect(markets[0].marketAddress).toBe("0xabc123");
		// Verify extra contains MarketParams
		const extra = markets[0].extra as Record<string, unknown>;
		expect(extra.oracle).toBe("0x0000000000000000000000000000000001");
		expect(extra.irm).toBe("0x0000000000000000000000000000000002");
	});

	it("filters UNKNOWN symbols", async () => {
		const apiResponse = {
			data: {
				markets: {
					items: [
						{
							uniqueKey: "0xfe1d",
							morphoBlue: { address: "0xD5D960" },
							state: {
								supplyApy: 0,
								borrowApy: 0,
								supplyAssetsUsd: 0,
								borrowAssetsUsd: 0,
							},
							loanAsset: {
								address: "0x0000",
								symbol: "UNKNOWN",
								decimals: 18,
							},
							collateralAsset: null,
							lltv: "980000000000000000",
							oracleAddress: "",
							irmAddress: "",
						},
					],
				},
			},
		};

		mockFetchJson(apiResponse);

		const adapter = createMorphoAdapter();
		const markets = await adapter.getMarkets("monad");
		expect(markets.length).toBe(0);
	});

	it("throws for unsupported network", async () => {
		const adapter = createMorphoAdapter();
		await expect(adapter.getMarkets("bsc")).rejects.toThrow(
			"Morpho Blue is not configured",
		);
	});
});

describe("createMorphoAdapter getAccountPosition", () => {
	it("returns position from API", async () => {
		const apiResponse = {
			data: {
				marketPositions: {
					items: [
						{
							market: {
								uniqueKey: "0xabc123",
								loanAsset: {
									address: "0x754704",
									symbol: "USDC",
									decimals: 6,
								},
								collateralAsset: {
									address: "0x4809",
									symbol: "wsrUSD",
									decimals: 18,
								},
								lltv: "860000000000000000",
							},
							state: {
								supplyAssets: "5000000",
								borrowAssets: "2000000",
								collateral: "100000000000000000",
								supplyAssetsUsd: 5000,
								borrowAssetsUsd: 2000,
								collateralUsd: 100,
							},
						},
					],
				},
			},
		};

		mockFetchJson(apiResponse);

		const adapter = createMorphoAdapter();
		const pos = await adapter.getAccountPosition(
			"monad",
			"0x1234567890abcdef1234567890abcdef12345678",
		);

		expect(pos.protocol).toBe("morpho-blue");
		expect(pos.supplies.length).toBe(1);
		expect(pos.borrows.length).toBe(1);
		expect(pos.supplies[0].underlyingSymbol).toBe("USDC");
		expect(Number(pos.totalCollateralValueUsd)).toBeGreaterThan(0);
		expect(Number(pos.totalBorrowValueUsd)).toBeGreaterThan(0);
		expect(pos.currentLTV).toBeGreaterThan(0);
		expect(pos.currentLTV).toBeLessThan(1);
	});

	it("returns empty position when no positions", async () => {
		mockFetchJson({
			data: { marketPositions: { items: [] } },
		});

		const adapter = createMorphoAdapter();
		const pos = await adapter.getAccountPosition(
			"monad",
			"0x1234567890abcdef1234567890abcdef12345678",
		);

		expect(pos.supplies.length).toBe(0);
		expect(pos.borrows.length).toBe(0);
		expect(pos.currentLTV).toBe(0);
		expect(pos.healthFactor).toBe(Number.POSITIVE_INFINITY);
	});
});

// Mock API responses for market resolution
const MOCK_MARKET_RESOLVE_RESPONSE = {
	data: {
		markets: {
			items: [
				{
					uniqueKey: "0xabc123",
					loanAsset: {
						address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
					},
					collateralAsset: {
						address: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
					},
					oracleAddress: "0x0000000000000000000000000000000000000099",
					irmAddress: "0x0000000000000000000000000000000000000088",
					lltv: "770000000000000000",
				},
			],
		},
	},
};

const MOCK_MARKET_BY_KEY_RESPONSE = {
	data: {
		market: {
			uniqueKey: "0xabc123",
			loanAsset: {
				address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
			},
			collateralAsset: {
				address: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
			},
			oracleAddress: "0x0000000000000000000000000000000000000099",
			irmAddress: "0x0000000000000000000000000000000000000088",
			lltv: "770000000000000000",
		},
	},
};

describe("createMorphoAdapter calldata builders (with real MarketParams)", () => {
	it("buildSupplyCalldata encodes real oracle/irm", async () => {
		mockFetchJson(MOCK_MARKET_RESOLVE_RESPONSE);

		const adapter = createMorphoAdapter();
		const calls = await adapter.buildSupplyCalldata({
			network: "monad",
			tokenAddress: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
			amountRaw: "1000000",
			account: "0x1234567890abcdef1234567890abcdef12345678",
		});

		expect(calls.length).toBe(2);
		expect(calls[0].data).toContain("095ea7b3"); // approve selector
		expect(calls[1].to).toBe("0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee");
		// Real oracle/irm addresses in calldata (not zero)
		expect(calls[1].data).toContain("0000000000000000000000000000000000000099");
		expect(calls[1].data).toContain("0000000000000000000000000000000000000088");
	});

	it("buildBorrowCalldata encodes real MarketParams", async () => {
		mockFetchJson(MOCK_MARKET_BY_KEY_RESPONSE);

		const adapter = createMorphoAdapter();
		const call = await adapter.buildBorrowCalldata({
			network: "monad",
			marketAddress: "0xabc123",
			amountRaw: "500000",
			account: "0x1234567890abcdef1234567890abcdef12345678",
		});

		expect(call.to).toBe("0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee");
		expect(call.data).toContain("0000000000000000000000000000000000000099");
	});

	it("buildRepayCalldata encodes real MarketParams", async () => {
		mockFetchJson(MOCK_MARKET_RESOLVE_RESPONSE);

		const adapter = createMorphoAdapter();
		const calls = await adapter.buildRepayCalldata({
			network: "monad",
			tokenAddress: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
			amountRaw: "500000",
			account: "0x1234567890abcdef1234567890abcdef12345678",
		});

		expect(calls.length).toBe(2);
		expect(calls[1].data).toContain("0000000000000000000000000000000000000099");
	});

	it("buildWithdrawCalldata encodes real MarketParams", async () => {
		mockFetchJson(MOCK_MARKET_RESOLVE_RESPONSE);

		const adapter = createMorphoAdapter();
		const call = await adapter.buildWithdrawCalldata({
			network: "monad",
			tokenAddress: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
			amountRaw: "500000",
			account: "0x1234567890abcdef1234567890abcdef12345678",
		});

		expect(call.to).toBe("0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee");
	});

	it("buildEnterMarketCalldata throws", async () => {
		const adapter = createMorphoAdapter();
		await expect(
			adapter.buildEnterMarketCalldata({
				network: "monad",
				marketAddresses: ["0xabc"],
				account: "0x123",
			}),
		).rejects.toThrow("does not have enterMarkets");
	});
});

describe("Morpho-specific operations", () => {
	it("buildMorphoSupplyCollateralCalldata returns approve + supplyCollateral", async () => {
		mockFetchJson(MOCK_MARKET_BY_KEY_RESPONSE);

		const calls = await buildMorphoSupplyCollateralCalldata({
			network: "monad",
			account: "0x1234567890abcdef1234567890abcdef12345678",
			marketId: "0xabc123",
			collateralTokenAddress: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
			amountRaw: "1000000000000000000",
		});

		expect(calls.length).toBe(2);
		expect(calls[0].description).toContain("Approve");
		expect(calls[0].to).toBe("0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A");
		expect(calls[1].description).toContain("collateral");
		expect(calls[1].to).toBe("0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee");
	});

	it("buildMorphoWithdrawCollateralCalldata returns withdrawCollateral", async () => {
		mockFetchJson(MOCK_MARKET_BY_KEY_RESPONSE);

		const call = await buildMorphoWithdrawCollateralCalldata({
			network: "monad",
			account: "0x1234567890abcdef1234567890abcdef12345678",
			marketId: "0xabc123",
			amountRaw: "1000000000000000000",
		});

		expect(call.to).toBe("0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee");
		expect(call.description).toContain("collateral");
	});
});
