import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	callNearRpc: vi.fn(),
	getNearRpcEndpoint: vi.fn(() => "https://rpc.mainnet.near.org"),
	nearNetworkSchema: vi.fn(),
	parseNearNetwork: vi.fn(() => "mainnet"),
	resolveNearAccountId: vi.fn(
		(accountId?: string) => accountId ?? "alice.near",
	),
	toYoctoNear: vi.fn(() => 1000n),
}));

const refMocks = vi.hoisted(() => ({
	fetchRefPoolById: vi.fn(),
	findRefPoolForPair: vi.fn(),
	getRefContractId: vi.fn(() => "v2.ref-finance.near"),
	getRefTokenDecimalsHint: vi.fn(),
	getRefSwapQuote: vi.fn(),
	resolveRefTokenIds: vi.fn(),
}));

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		callNearRpc: runtimeMocks.callNearRpc,
		getNearRpcEndpoint: runtimeMocks.getNearRpcEndpoint,
		nearNetworkSchema: runtimeMocks.nearNetworkSchema,
		parseNearNetwork: runtimeMocks.parseNearNetwork,
		resolveNearAccountId: runtimeMocks.resolveNearAccountId,
		toYoctoNear: runtimeMocks.toYoctoNear,
	};
});

vi.mock("../ref.js", async () => {
	const actual = await vi.importActual<typeof import("../ref.js")>("../ref.js");
	return {
		...actual,
		fetchRefPoolById: refMocks.fetchRefPoolById,
		findRefPoolForPair: refMocks.findRefPoolForPair,
		getRefContractId: refMocks.getRefContractId,
		getRefTokenDecimalsHint: refMocks.getRefTokenDecimalsHint,
		getRefSwapQuote: refMocks.getRefSwapQuote,
		resolveRefTokenIds: refMocks.resolveRefTokenIds,
	};
});

import { createNearComposeTools } from "./compose.js";

type ComposeTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

const TEST_PUBLIC_KEY = "ed25519:11111111111111111111111111111111";
const TEST_BLOCK_HASH = "11111111111111111111111111111111";

function getTool(name: string): ComposeTool {
	const tool = createNearComposeTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ComposeTool;
}

function encodeJsonResult(value: unknown): number[] {
	return [...Buffer.from(JSON.stringify(value), "utf8")];
}

function mockFetchJsonOnce(params: {
	status: number;
	body: unknown;
	statusText?: string;
}) {
	fetchMock.mockResolvedValueOnce({
		ok: params.status >= 200 && params.status < 300,
		status: params.status,
		statusText:
			params.statusText ??
			(params.status >= 200 && params.status < 300 ? "OK" : "Bad Request"),
		text: vi.fn().mockResolvedValue(JSON.stringify(params.body)),
	} as unknown as Response);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
	runtimeMocks.parseNearNetwork.mockReturnValue("mainnet");
	runtimeMocks.resolveNearAccountId.mockImplementation(
		(accountId?: string) => accountId ?? "alice.near",
	);
	runtimeMocks.toYoctoNear.mockReturnValue(1000n);
	runtimeMocks.getNearRpcEndpoint.mockReturnValue(
		"https://rpc.mainnet.near.org",
	);
	refMocks.getRefContractId.mockReturnValue("v2.ref-finance.near");
	refMocks.getRefTokenDecimalsHint.mockImplementation(
		({
			tokenIdOrSymbol,
		}: {
			tokenIdOrSymbol: string;
		}) => {
			const normalized = tokenIdOrSymbol.toLowerCase();
			if (
				normalized === "near" ||
				normalized === "wnear" ||
				normalized.includes("wrap.")
			) {
				return 24;
			}
			if (
				normalized === "usdc" ||
				normalized === "usdt" ||
				normalized.includes("usdc") ||
				normalized.includes("usdt")
			) {
				return 6;
			}
			return null;
		},
	);
	refMocks.getRefSwapQuote.mockResolvedValue({
		refContractId: "v2.ref-finance.near",
		poolId: 7,
		tokenInId: "wrap.near",
		tokenOutId: "usdc.tether-token.near",
		amountInRaw: "10000000000000000000000",
		amountOutRaw: "1000000",
		minAmountOutRaw: "995000",
		feeBps: 30,
		source: "bestDirectSimplePool",
		actions: [
			{
				poolId: 7,
				tokenInId: "wrap.near",
				tokenOutId: "usdc.tether-token.near",
				amountInRaw: "10000000000000000000000",
			},
		],
	});
	refMocks.resolveRefTokenIds.mockImplementation(
		({
			tokenIdOrSymbol,
			availableTokenIds,
		}: {
			tokenIdOrSymbol: string;
			availableTokenIds?: string[];
		}) => {
			const normalized = tokenIdOrSymbol.toLowerCase();
			const candidates =
				availableTokenIds?.map((tokenId) => tokenId.toLowerCase()) ?? [];
			if (normalized === "usdc") {
				const inPool = candidates.filter((tokenId) => tokenId.includes("usdc"));
				if (inPool.length > 0) return inPool;
				return ["usdc.tether-token.near"];
			}
			if (normalized.includes(".")) {
				return [normalized];
			}
			return candidates.filter((tokenId) => tokenId === normalized);
		},
	);
	refMocks.fetchRefPoolById.mockResolvedValue({
		id: 7,
		token_account_ids: ["wrap.near", "usdc.tether-token.near"],
		amounts: ["1", "1"],
		total_fee: 30,
		pool_kind: "SIMPLE_POOL",
	});
	refMocks.findRefPoolForPair.mockResolvedValue({
		refContractId: "v2.ref-finance.near",
		poolId: 7,
		poolKind: "SIMPLE_POOL",
		tokenAId: "wrap.near",
		tokenBId: "usdc.tether-token.near",
		liquidityScore: "1",
		source: "bestLiquidityPool",
		candidates: [
			{
				poolId: 7,
				poolKind: "SIMPLE_POOL",
				tokenAId: "wrap.near",
				tokenBId: "usdc.tether-token.near",
				liquidityScore: "1",
			},
		],
		pool: {
			id: 7,
			token_account_ids: ["wrap.near", "usdc.tether-token.near"],
			amounts: ["1", "1"],
			total_fee: 30,
			pool_kind: "SIMPLE_POOL",
		},
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("near compose tools", () => {
	it("builds unsigned native transfer transaction", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			keys: [
				{
					public_key: TEST_PUBLIC_KEY,
					access_key: {
						nonce: 7,
						permission: "FullAccess",
					},
				},
			],
			block_hash: TEST_BLOCK_HASH,
			block_height: 123,
		});
		const tool = getTool("near_buildTransferNearTransaction");
		const result = await tool.execute("near-compose-1", {
			network: "mainnet",
			fromAccountId: "alice.near",
			toAccountId: "bob.near",
			amountYoctoNear: "1000",
		});

		expect(runtimeMocks.callNearRpc).toHaveBeenCalledWith({
			method: "query",
			network: "mainnet",
			rpcUrl: undefined,
			params: {
				request_type: "view_access_key_list",
				finality: "final",
				account_id: "alice.near",
			},
		});
		expect(result.content[0]?.text).toContain("Unsigned NEAR transfer built");
		expect(result.details).toMatchObject({
			network: "mainnet",
			signerAccountId: "alice.near",
			signerPublicKey: TEST_PUBLIC_KEY,
			transactionCount: 1,
			transaction: {
				receiverId: "bob.near",
				nonce: "8",
			},
		});
		const payload = (
			result.details as {
				transaction: { unsignedPayload: string };
			}
		).transaction.unsignedPayload;
		expect(Buffer.from(payload, "base64").length).toBeGreaterThan(0);
	});

	it("builds unsigned FT transfer with explicit publicKey", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			nonce: "41",
			permission: "FullAccess",
			block_hash: TEST_BLOCK_HASH,
			block_height: 124,
		});
		const tool = getTool("near_buildTransferFtTransaction");
		const result = await tool.execute("near-compose-2", {
			network: "mainnet",
			fromAccountId: "alice.near",
			publicKey: TEST_PUBLIC_KEY,
			ftContractId: "usdc.tether-token.near",
			toAccountId: "bob.near",
			amountRaw: "123456",
		});

		expect(runtimeMocks.callNearRpc).toHaveBeenCalledWith({
			method: "query",
			network: "mainnet",
			rpcUrl: undefined,
			params: {
				request_type: "view_access_key",
				finality: "final",
				account_id: "alice.near",
				public_key: TEST_PUBLIC_KEY,
			},
		});
		expect(result.details).toMatchObject({
			transactionCount: 1,
			transaction: {
				receiverId: "usdc.tether-token.near",
				nonce: "42",
				actionSummaries: [
					{
						type: "FunctionCall",
						methodName: "ft_transfer",
						args: {
							receiver_id: "bob.near",
							amount: "123456",
						},
						gas: "30000000000000",
						depositYoctoNear: "1",
					},
				],
			},
		});
	});

	it("builds unsigned intents deposit transaction via ft_transfer", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			keys: [
				{
					public_key: TEST_PUBLIC_KEY,
					access_key: {
						nonce: 15,
						permission: "FullAccess",
					},
				},
			],
			block_hash: TEST_BLOCK_HASH,
			block_height: 128,
		});
		mockFetchJsonOnce({
			status: 200,
			body: [
				{
					assetId: "near:usdc",
					decimals: 6,
					blockchain: "near",
					symbol: "USDC",
					price: 1,
					priceUpdatedAt: "2026-01-01T00:00:00Z",
					contractAddress: "usdc.tether-token.near",
				},
				{
					assetId: "near:near",
					decimals: 24,
					blockchain: "near",
					symbol: "NEAR",
					price: 5,
					priceUpdatedAt: "2026-01-01T00:00:00Z",
				},
			],
		});
		mockFetchJsonOnce({
			status: 200,
			body: {
				correlationId: "corr-1",
				timestamp: "2026-01-01T00:00:00Z",
				signature: "sig",
				quoteRequest: {
					dry: true,
				},
				quote: {
					depositAddress: "intents-deposit.near",
					depositMemo: "memo-123",
					amountIn: "1000000",
					amountInFormatted: "1",
					amountInUsd: "1",
					minAmountIn: "1000000",
					amountOut: "1000000",
					amountOutFormatted: "1",
					amountOutUsd: "1",
					minAmountOut: "990000",
					timeEstimate: 30,
				},
			},
		});
		const tool = getTool("near_buildIntentsSwapDepositTransaction");
		const result = await tool.execute("near-compose-intents-1", {
			network: "mainnet",
			fromAccountId: "alice.near",
			originAsset: "USDC",
			destinationAsset: "NEAR",
			amount: "1000000",
		});

		expect(result.details).toMatchObject({
			routeType: "ft_transfer",
			originAssetId: "near:usdc",
			destinationAssetId: "near:near",
			depositAddress: "intents-deposit.near",
			depositMemo: "memo-123",
			transactionCount: 1,
			transaction: {
				label: "intents_deposit_ft",
				receiverId: "usdc.tether-token.near",
				nonce: "16",
				actionSummaries: [
					{
						type: "FunctionCall",
						methodName: "ft_transfer",
						args: {
							receiver_id: "intents-deposit.near",
							amount: "1000000",
							memo: "memo-123",
						},
					},
				],
			},
		});
	});

	it("builds unsigned ref withdraw transaction from deposited token", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				keys: [
					{
						public_key: TEST_PUBLIC_KEY,
						access_key: {
							nonce: 9,
							permission: "FullAccess",
						},
					},
				],
				block_hash: TEST_BLOCK_HASH,
				block_height: 125,
			})
			.mockResolvedValueOnce({
				result: encodeJsonResult({
					"usdc.tether-token.near": "1200000",
				}),
				logs: [],
				block_hash: "2222",
				block_height: 333,
			})
			.mockResolvedValueOnce({
				result: encodeJsonResult({
					total: "1",
				}),
				logs: [],
				block_hash: "2223",
				block_height: 334,
			});
		const tool = getTool("near_buildRefWithdrawTransaction");
		const result = await tool.execute("near-compose-3", {
			network: "mainnet",
			fromAccountId: "alice.near",
			tokenId: "USDC",
			withdrawAll: true,
		});

		expect(result.details).toMatchObject({
			refContractId: "v2.ref-finance.near",
			tokenId: "usdc.tether-token.near",
			depositBeforeRaw: "1200000",
			amountRaw: "1200000",
			transactionCount: 1,
			storageRegistration: {
				status: "registered",
			},
			transaction: {
				label: "ref_withdraw",
				receiverId: "v2.ref-finance.near",
				nonce: "10",
				actionSummaries: [
					{
						type: "FunctionCall",
						methodName: "withdraw",
						args: {
							token_id: "usdc.tether-token.near",
							amount: "1200000",
						},
					},
				],
			},
		});
	});

	it("builds unsigned ref add-liquidity transaction set", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			keys: [
				{
					public_key: TEST_PUBLIC_KEY,
					access_key: {
						nonce: 20,
						permission: "FullAccess",
					},
				},
			],
			block_hash: TEST_BLOCK_HASH,
			block_height: 129,
		});
		const tool = getTool("near_buildAddLiquidityRefTransaction");
		const result = await tool.execute("near-compose-lp-add-1", {
			network: "mainnet",
			fromAccountId: "alice.near",
			poolId: 7,
			amountARaw: "1000",
			amountBRaw: "2000",
			tokenAId: "wrap.near",
			tokenBId: "usdc.tether-token.near",
			autoRegisterExchange: false,
			autoRegisterTokens: false,
		});

		expect(refMocks.fetchRefPoolById).toHaveBeenCalledWith({
			network: "mainnet",
			rpcUrl: undefined,
			refContractId: "v2.ref-finance.near",
			poolId: 7,
		});
		expect(result.details).toMatchObject({
			poolId: 7,
			poolSelectionSource: "explicitPool",
			amountsRaw: ["1000", "2000"],
			transactionCount: 3,
			transactions: [
				{
					label: "token_deposit",
					receiverId: "wrap.near",
					nonce: "21",
				},
				{
					label: "token_deposit",
					receiverId: "usdc.tether-token.near",
					nonce: "22",
				},
				{
					label: "ref_add_liquidity",
					receiverId: "v2.ref-finance.near",
					nonce: "23",
				},
			],
		});
	});

	it("builds unsigned ref remove-liquidity transaction from shareBps", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				keys: [
					{
						public_key: TEST_PUBLIC_KEY,
						access_key: {
							nonce: 30,
							permission: "FullAccess",
						},
					},
				],
				block_hash: TEST_BLOCK_HASH,
				block_height: 130,
			})
			.mockResolvedValueOnce({
				result: encodeJsonResult("10000"),
				logs: [],
				block_hash: "2230",
				block_height: 340,
			});
		const tool = getTool("near_buildRemoveLiquidityRefTransaction");
		const result = await tool.execute("near-compose-lp-remove-1", {
			network: "mainnet",
			fromAccountId: "alice.near",
			poolId: 7,
			shareBps: 5000,
		});

		expect(result.details).toMatchObject({
			poolId: 7,
			shares: "5000",
			shareBpsUsed: 5000,
			availableShares: "10000",
			transactionCount: 1,
			transaction: {
				label: "ref_remove_liquidity",
				receiverId: "v2.ref-finance.near",
				nonce: "31",
			},
		});
	});

	it("builds unsigned ref swap transaction with storage_deposit pre-transaction", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				keys: [
					{
						public_key: TEST_PUBLIC_KEY,
						access_key: {
							nonce: 11,
							permission: "FullAccess",
						},
					},
				],
				block_hash: TEST_BLOCK_HASH,
				block_height: 127,
			})
			.mockResolvedValueOnce({
				result: encodeJsonResult(null),
				logs: [],
				block_hash: "2227",
				block_height: 338,
			})
			.mockResolvedValueOnce({
				result: encodeJsonResult({
					min: "1250000000000000000000",
				}),
				logs: [],
				block_hash: "2228",
				block_height: 339,
			});
		const tool = getTool("near_buildSwapRefTransaction");
		const result = await tool.execute("near-compose-5", {
			network: "mainnet",
			fromAccountId: "alice.near",
			tokenInId: "NEAR",
			tokenOutId: "USDC",
			amountInRaw: "10000000000000000000000",
		});

		expect(refMocks.getRefSwapQuote).toHaveBeenCalledWith({
			network: "mainnet",
			rpcUrl: undefined,
			refContractId: "v2.ref-finance.near",
			tokenInId: "NEAR",
			tokenOutId: "USDC",
			amountInRaw: "10000000000000000000000",
			poolId: undefined,
			slippageBps: 50,
		});
		expect(result.details).toMatchObject({
			refContractId: "v2.ref-finance.near",
			tokenInId: "wrap.near",
			tokenOutId: "usdc.tether-token.near",
			minAmountOutRaw: "995000",
			transactionCount: 2,
			storageRegistration: {
				status: "needs_registration",
				estimatedDepositYoctoNear: "1250000000000000000000",
			},
			transactions: [
				{
					label: "storage_deposit",
					receiverId: "usdc.tether-token.near",
					nonce: "12",
				},
				{
					label: "ref_swap",
					receiverId: "wrap.near",
					nonce: "13",
					actionSummaries: [
						{
							type: "FunctionCall",
							methodName: "ft_transfer_call",
							args: {
								receiver_id: "v2.ref-finance.near",
								amount: "10000000000000000000000",
							},
							gas: "180000000000000",
							depositYoctoNear: "1",
						},
					],
				},
			],
		});
	});

	it("includes storage_deposit pre-transaction when receiver storage is missing", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				keys: [
					{
						public_key: TEST_PUBLIC_KEY,
						access_key: {
							nonce: 5,
							permission: "FullAccess",
						},
					},
				],
				block_hash: TEST_BLOCK_HASH,
				block_height: 126,
			})
			.mockResolvedValueOnce({
				result: encodeJsonResult({
					"usdc.tether-token.near": "500000",
				}),
				logs: [],
				block_hash: "2224",
				block_height: 335,
			})
			.mockResolvedValueOnce({
				result: encodeJsonResult(null),
				logs: [],
				block_hash: "2225",
				block_height: 336,
			})
			.mockResolvedValueOnce({
				result: encodeJsonResult({
					min: "1250000000000000000000",
				}),
				logs: [],
				block_hash: "2226",
				block_height: 337,
			});
		const tool = getTool("near_buildRefWithdrawTransaction");
		const result = await tool.execute("near-compose-4", {
			network: "mainnet",
			fromAccountId: "alice.near",
			tokenId: "USDC",
			amountRaw: "100000",
		});

		expect(result.details).toMatchObject({
			transactionCount: 2,
			storageRegistration: {
				status: "needs_registration",
				estimatedDepositYoctoNear: "1250000000000000000000",
			},
			transactions: [
				{
					label: "storage_deposit",
					receiverId: "usdc.tether-token.near",
					nonce: "6",
				},
				{
					label: "ref_withdraw",
					receiverId: "v2.ref-finance.near",
					nonce: "7",
				},
			],
		});
	});
});
