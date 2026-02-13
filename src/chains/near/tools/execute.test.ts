import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	callNearRpc: vi.fn(),
	formatNearAmount: vi.fn((value: string | bigint) =>
		typeof value === "bigint" ? value.toString() : value,
	),
	getNearExplorerTransactionUrl: vi.fn(
		(txHash: string) => `https://nearblocks.io/txns/${txHash}`,
	),
	getNearRpcEndpoint: vi.fn(() => "https://rpc.mainnet.near.org"),
	nearNetworkSchema: vi.fn(),
	parseNearNetwork: vi.fn(() => "mainnet"),
	resolveNearSigner: vi.fn(() => ({
		accountId: "alice.near",
		signer: {
			signBytes: vi.fn(),
		},
	})),
	toYoctoNear: vi.fn((value: string | number) =>
		typeof value === "number" ? BigInt(Math.round(value * 1_000_000)) : 1000n,
	),
}));

const nearApiMocks = vi.hoisted(() => {
	const transfer = vi.fn();
	const callFunction = vi.fn();
	const JsonRpcProvider = vi.fn().mockImplementation(() => ({}));
	const Account = vi.fn().mockImplementation(() => ({
		transfer,
		callFunction,
	}));
	return {
		Account,
		JsonRpcProvider,
		transfer,
		callFunction,
	};
});

const refMocks = vi.hoisted(() => ({
	fetchRefPoolById: vi.fn(),
	findRefPoolForPair: vi.fn(),
	getRefContractId: vi.fn(() => "v2.ref-finance.near"),
	getRefSwapQuote: vi.fn(),
	getRefTokenDecimalsHint: vi.fn(),
	resolveRefTokenIds: vi.fn(),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		callNearRpc: runtimeMocks.callNearRpc,
		formatNearAmount: runtimeMocks.formatNearAmount,
		getNearExplorerTransactionUrl: runtimeMocks.getNearExplorerTransactionUrl,
		getNearRpcEndpoint: runtimeMocks.getNearRpcEndpoint,
		nearNetworkSchema: runtimeMocks.nearNetworkSchema,
		parseNearNetwork: runtimeMocks.parseNearNetwork,
		resolveNearSigner: runtimeMocks.resolveNearSigner,
		toYoctoNear: runtimeMocks.toYoctoNear,
	};
});

vi.mock("near-api-js", () => ({
	Account: nearApiMocks.Account,
	JsonRpcProvider: nearApiMocks.JsonRpcProvider,
}));

vi.mock("../ref.js", () => ({
	fetchRefPoolById: refMocks.fetchRefPoolById,
	findRefPoolForPair: refMocks.findRefPoolForPair,
	getRefContractId: refMocks.getRefContractId,
	getRefSwapQuote: refMocks.getRefSwapQuote,
	getRefTokenDecimalsHint: refMocks.getRefTokenDecimalsHint,
	resolveRefTokenIds: refMocks.resolveRefTokenIds,
}));

import { createNearExecuteTools } from "./execute.js";

type ExecuteTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(name: string): ExecuteTool {
	const tool = createNearExecuteTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ExecuteTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.parseNearNetwork.mockReturnValue("mainnet");
	runtimeMocks.getNearRpcEndpoint.mockReturnValue(
		"https://rpc.mainnet.near.org",
	);
	runtimeMocks.resolveNearSigner.mockReturnValue({
		accountId: "alice.near",
		signer: {
			signBytes: vi.fn(),
		},
	});
	runtimeMocks.toYoctoNear.mockReturnValue(1000n);
	runtimeMocks.callNearRpc.mockResolvedValue({
		block_hash: "5555",
		block_height: 111,
		logs: [],
		result: [...Buffer.from(JSON.stringify({ total: "1" }), "utf8")],
	});
	nearApiMocks.transfer.mockResolvedValue({
		transaction_outcome: {
			id: "near-tx-hash-1",
		},
	});
	nearApiMocks.callFunction.mockResolvedValue({
		transaction_outcome: {
			id: "near-tx-hash-2",
		},
	});
	refMocks.getRefContractId.mockReturnValue("v2.ref-finance.near");
	refMocks.getRefSwapQuote.mockResolvedValue({
		refContractId: "v2.ref-finance.near",
		poolId: 3,
		tokenInId: "usdt.tether-token.near",
		tokenOutId: "usdc.fakes.near",
		amountInRaw: "1000000",
		amountOutRaw: "997000",
		minAmountOutRaw: "992015",
		feeBps: 30,
		source: "bestDirectSimplePool",
	});
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
		tokenAId: "wrap.near",
		tokenBId: "usdc.tether-token.near",
		liquidityScore: "1",
		source: "bestLiquidityPool",
		pool: {
			id: 7,
			token_account_ids: ["wrap.near", "usdc.tether-token.near"],
			amounts: ["1", "1"],
			total_fee: 30,
			pool_kind: "SIMPLE_POOL",
		},
	});
	refMocks.getRefTokenDecimalsHint.mockImplementation(
		({
			tokenIdOrSymbol,
		}: {
			tokenIdOrSymbol: string;
		}) => {
			const normalized = tokenIdOrSymbol.toLowerCase();
			if (normalized.includes("usdc")) return 6;
			if (normalized.includes("near")) return 24;
			return null;
		},
	);
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
			if (normalized === "near" || normalized === "wnear") {
				return candidates.filter((tokenId) => tokenId.includes("wrap."));
			}
			if (normalized === "usdc") {
				return candidates.filter((tokenId) => tokenId.includes("usdc"));
			}
			return candidates.filter((tokenId) => tokenId === normalized);
		},
	);
});

describe("near_transferNear", () => {
	it("transfers native NEAR with resolved signer", async () => {
		const tool = getTool("near_transferNear");
		const result = await tool.execute("near-exec-1", {
			toAccountId: "bob.near",
			amountNear: "0.001",
			confirmMainnet: true,
		});

		expect(runtimeMocks.toYoctoNear).toHaveBeenCalledWith("0.001");
		expect(nearApiMocks.transfer).toHaveBeenCalledWith({
			receiverId: "bob.near",
			amount: 1000n,
		});
		expect(result.details).toMatchObject({
			fromAccountId: "alice.near",
			toAccountId: "bob.near",
			network: "mainnet",
			txHash: "near-tx-hash-1",
		});
	});

	it("blocks mainnet execution without explicit confirmation", async () => {
		const tool = getTool("near_transferNear");
		await expect(
			tool.execute("near-exec-2", {
				toAccountId: "bob.near",
				amountYoctoNear: "1000",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(nearApiMocks.transfer).not.toHaveBeenCalled();
	});
});

describe("near_transferFt", () => {
	it("calls ft_transfer with default gas and deposit", async () => {
		const tool = getTool("near_transferFt");
		const result = await tool.execute("near-exec-3", {
			ftContractId: "usdt.tether-token.near",
			toAccountId: "bob.near",
			amountRaw: "1000000",
			confirmMainnet: true,
		});

		expect(nearApiMocks.callFunction).toHaveBeenCalledWith({
			contractId: "usdt.tether-token.near",
			methodName: "ft_transfer",
			args: {
				receiver_id: "bob.near",
				amount: "1000000",
			},
			deposit: 1n,
			gas: 30_000_000_000_000n,
		});
		expect(result.details).toMatchObject({
			ftContractId: "usdt.tether-token.near",
			amountRaw: "1000000",
			txHash: "near-tx-hash-2",
		});
	});
});

describe("near_swapRef", () => {
	it("calls ft_transfer_call with Ref swap message", async () => {
		const tool = getTool("near_swapRef");
		const result = await tool.execute("near-exec-4", {
			tokenInId: "usdt.tether-token.near",
			tokenOutId: "usdc.fakes.near",
			amountInRaw: "1000000",
			slippageBps: 100,
			confirmMainnet: true,
		});

		expect(refMocks.getRefSwapQuote).toHaveBeenCalledWith({
			network: "mainnet",
			rpcUrl: undefined,
			refContractId: "v2.ref-finance.near",
			tokenInId: "usdt.tether-token.near",
			tokenOutId: "usdc.fakes.near",
			amountInRaw: "1000000",
			poolId: undefined,
			slippageBps: 100,
		});
		expect(runtimeMocks.callNearRpc).toHaveBeenCalledWith({
			method: "query",
			network: "mainnet",
			rpcUrl: undefined,
			params: {
				request_type: "call_function",
				account_id: "usdc.fakes.near",
				method_name: "storage_balance_of",
				args_base64: Buffer.from(
					JSON.stringify({ account_id: "alice.near" }),
					"utf8",
				).toString("base64"),
				finality: "final",
			},
		});
		expect(nearApiMocks.callFunction).toHaveBeenCalledWith({
			contractId: "usdt.tether-token.near",
			methodName: "ft_transfer_call",
			args: {
				receiver_id: "v2.ref-finance.near",
				amount: "1000000",
				msg: JSON.stringify({
					force: 0,
					actions: [
						{
							pool_id: 3,
							token_in: "usdt.tether-token.near",
							amount_in: "1000000",
							token_out: "usdc.fakes.near",
							min_amount_out: "992015",
						},
					],
				}),
			},
			deposit: 1n,
			gas: 180_000_000_000_000n,
		});
		expect(result.details).toMatchObject({
			poolId: 3,
			tokenInId: "usdt.tether-token.near",
			tokenOutId: "usdc.fakes.near",
			storageRegistration: {
				status: "already_registered",
			},
			txHash: "near-tx-hash-2",
		});
	});

	it("auto-registers output token storage when account is not registered", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "6666",
				block_height: 112,
				logs: [],
				result: [...Buffer.from(JSON.stringify(null), "utf8")],
			})
			.mockResolvedValueOnce({
				block_hash: "6667",
				block_height: 113,
				logs: [],
				result: [
					...Buffer.from(
						JSON.stringify({ min: "1250000000000000000000" }),
						"utf8",
					),
				],
			});
		nearApiMocks.callFunction
			.mockResolvedValueOnce({
				transaction_outcome: {
					id: "near-storage-tx-hash",
				},
			})
			.mockResolvedValueOnce({
				transaction_outcome: {
					id: "near-swap-tx-hash",
				},
			});

		const tool = getTool("near_swapRef");
		const result = await tool.execute("near-exec-4b", {
			tokenInId: "usdt.tether-token.near",
			tokenOutId: "usdc.fakes.near",
			amountInRaw: "1000000",
			confirmMainnet: true,
		});

		expect(nearApiMocks.callFunction).toHaveBeenNthCalledWith(1, {
			contractId: "usdc.fakes.near",
			methodName: "storage_deposit",
			args: {
				account_id: "alice.near",
				registration_only: true,
			},
			deposit: 1_250_000_000_000_000_000_000n,
			gas: 30_000_000_000_000n,
		});
		expect(nearApiMocks.callFunction).toHaveBeenNthCalledWith(2, {
			contractId: "usdt.tether-token.near",
			methodName: "ft_transfer_call",
			args: {
				receiver_id: "v2.ref-finance.near",
				amount: "1000000",
				msg: JSON.stringify({
					force: 0,
					actions: [
						{
							pool_id: 3,
							token_in: "usdt.tether-token.near",
							amount_in: "1000000",
							token_out: "usdc.fakes.near",
							min_amount_out: "992015",
						},
					],
				}),
			},
			deposit: 1n,
			gas: 180_000_000_000_000n,
		});
		expect(result.details).toMatchObject({
			storageRegistration: {
				status: "registered_now",
				depositYoctoNear: "1250000000000000000000",
				txHash: "near-storage-tx-hash",
			},
			txHash: "near-swap-tx-hash",
		});
	});

	it("blocks mainnet swap without explicit confirmation", async () => {
		const tool = getTool("near_swapRef");
		await expect(
			tool.execute("near-exec-5", {
				tokenInId: "usdt.tether-token.near",
				tokenOutId: "usdc.fakes.near",
				amountInRaw: "1000000",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(nearApiMocks.callFunction).not.toHaveBeenCalled();
	});

	it("builds multi-hop swap actions when quote contains route actions", async () => {
		refMocks.getRefSwapQuote.mockResolvedValueOnce({
			refContractId: "v2.ref-finance.near",
			poolId: 11,
			tokenInId: "wrap.near",
			tokenOutId: "usdc.tether-token.near",
			amountInRaw: "10000000000000000000000",
			amountOutRaw: "2050000",
			minAmountOutRaw: "2039750",
			feeBps: 60,
			source: "bestTwoHopPoolRoute",
			actions: [
				{
					poolId: 11,
					tokenInId: "wrap.near",
					tokenOutId: "usdt.tether-token.near",
					amountInRaw: "10000000000000000000000",
				},
				{
					poolId: 12,
					tokenInId: "usdt.tether-token.near",
					tokenOutId: "usdc.tether-token.near",
					amountInRaw: "2100000",
				},
			],
		});
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			block_hash: "7777",
			block_height: 120,
			logs: [],
			result: [...Buffer.from(JSON.stringify({ total: "1" }), "utf8")],
		});
		const tool = getTool("near_swapRef");
		const result = await tool.execute("near-exec-6", {
			tokenInId: "NEAR",
			tokenOutId: "USDC",
			amountInRaw: "10000000000000000000000",
			confirmMainnet: true,
		});

		expect(nearApiMocks.callFunction).toHaveBeenCalledWith({
			contractId: "wrap.near",
			methodName: "ft_transfer_call",
			args: {
				receiver_id: "v2.ref-finance.near",
				amount: "10000000000000000000000",
				msg: JSON.stringify({
					force: 0,
					actions: [
						{
							pool_id: 11,
							token_in: "wrap.near",
							amount_in: "10000000000000000000000",
							token_out: "usdt.tether-token.near",
							min_amount_out: "0",
						},
						{
							pool_id: 12,
							token_in: "usdt.tether-token.near",
							token_out: "usdc.tether-token.near",
							min_amount_out: "2039750",
						},
					],
				}),
			},
			deposit: 1n,
			gas: 180_000_000_000_000n,
		});
		expect(result.details).toMatchObject({
			tokenInId: "wrap.near",
			tokenOutId: "usdc.tether-token.near",
			poolId: 11,
			source: "bestTwoHopPoolRoute",
		});
	});
});

describe("near_addLiquidityRef", () => {
	it("deposits tokens then calls add_liquidity", async () => {
		nearApiMocks.callFunction
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-register-tx-hash" },
			})
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-deposit-a-hash" },
			})
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-deposit-b-hash" },
			})
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-add-liquidity-hash" },
			});
		const tool = getTool("near_addLiquidityRef");
		const result = await tool.execute("near-exec-7", {
			poolId: 7,
			amountARaw: "10000000000000000000000",
			amountBRaw: "2500000",
			confirmMainnet: true,
		});

		expect(refMocks.fetchRefPoolById).toHaveBeenCalledWith({
			network: "mainnet",
			rpcUrl: undefined,
			refContractId: "v2.ref-finance.near",
			poolId: 7,
		});
		expect(nearApiMocks.callFunction).toHaveBeenNthCalledWith(1, {
			contractId: "v2.ref-finance.near",
			methodName: "register_tokens",
			args: {
				token_ids: ["wrap.near", "usdc.tether-token.near"],
			},
			deposit: 0n,
			gas: 40_000_000_000_000n,
		});
		expect(nearApiMocks.callFunction).toHaveBeenNthCalledWith(2, {
			contractId: "wrap.near",
			methodName: "ft_transfer_call",
			args: {
				receiver_id: "v2.ref-finance.near",
				amount: "10000000000000000000000",
				msg: "",
			},
			deposit: 1n,
			gas: 70_000_000_000_000n,
		});
		expect(nearApiMocks.callFunction).toHaveBeenNthCalledWith(3, {
			contractId: "usdc.tether-token.near",
			methodName: "ft_transfer_call",
			args: {
				receiver_id: "v2.ref-finance.near",
				amount: "2500000",
				msg: "",
			},
			deposit: 1n,
			gas: 70_000_000_000_000n,
		});
		expect(nearApiMocks.callFunction).toHaveBeenNthCalledWith(4, {
			contractId: "v2.ref-finance.near",
			methodName: "add_liquidity",
			args: {
				pool_id: 7,
				amounts: ["10000000000000000000000", "2500000"],
			},
			deposit: 1n,
			gas: 180_000_000_000_000n,
		});
		expect(result.details).toMatchObject({
			poolId: 7,
			tokenAId: "wrap.near",
			tokenBId: "usdc.tether-token.near",
			txHash: "near-add-liquidity-hash",
		});
	});

	it("maps symbol amounts into pool token order", async () => {
		refMocks.fetchRefPoolById.mockResolvedValueOnce({
			id: 9,
			token_account_ids: ["usdc.tether-token.near", "wrap.near"],
			amounts: ["1", "1"],
			total_fee: 30,
			pool_kind: "SIMPLE_POOL",
		});
		nearApiMocks.callFunction
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-register-tx-hash-2" },
			})
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-deposit-usdc-hash" },
			})
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-deposit-near-hash" },
			})
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-add-liquidity-hash-2" },
			});

		const tool = getTool("near_addLiquidityRef");
		await tool.execute("near-exec-8", {
			poolId: 9,
			tokenAId: "NEAR",
			tokenBId: "USDC",
			amountA: "0.01",
			amountB: "1.23",
			confirmMainnet: true,
		});

		expect(refMocks.resolveRefTokenIds).toHaveBeenNthCalledWith(1, {
			network: "mainnet",
			tokenIdOrSymbol: "NEAR",
			availableTokenIds: ["usdc.tether-token.near", "wrap.near"],
		});
		expect(refMocks.resolveRefTokenIds).toHaveBeenNthCalledWith(2, {
			network: "mainnet",
			tokenIdOrSymbol: "USDC",
			availableTokenIds: ["usdc.tether-token.near", "wrap.near"],
		});
		expect(nearApiMocks.callFunction).toHaveBeenLastCalledWith({
			contractId: "v2.ref-finance.near",
			methodName: "add_liquidity",
			args: {
				pool_id: 9,
				amounts: ["1230000", "10000000000000000000000"],
			},
			deposit: 1n,
			gas: 180_000_000_000_000n,
		});
	});

	it("auto-selects pool by pair when poolId is omitted", async () => {
		nearApiMocks.callFunction
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-register-tx-hash-3" },
			})
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-deposit-near-hash-3" },
			})
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-deposit-usdc-hash-3" },
			})
			.mockResolvedValueOnce({
				transaction_outcome: { id: "near-add-liquidity-hash-3" },
			});
		const tool = getTool("near_addLiquidityRef");
		const result = await tool.execute("near-exec-8b", {
			tokenAId: "NEAR",
			tokenBId: "USDC",
			amountA: "0.01",
			amountB: "1.23",
			confirmMainnet: true,
		});

		expect(refMocks.findRefPoolForPair).toHaveBeenCalledWith({
			network: "mainnet",
			rpcUrl: undefined,
			refContractId: "v2.ref-finance.near",
			tokenAId: "NEAR",
			tokenBId: "USDC",
		});
		expect(result.details).toMatchObject({
			poolId: 7,
			poolSelectionSource: "bestLiquidityPool",
			inferredPair: {
				tokenAId: "wrap.near",
				tokenBId: "usdc.tether-token.near",
			},
			txHash: "near-add-liquidity-hash-3",
		});
	});
});

describe("near_removeLiquidityRef", () => {
	it("calls remove_liquidity with min amounts", async () => {
		nearApiMocks.callFunction.mockResolvedValueOnce({
			transaction_outcome: { id: "near-remove-liquidity-hash" },
		});
		const tool = getTool("near_removeLiquidityRef");
		const result = await tool.execute("near-exec-9", {
			poolId: 7,
			shares: "100000",
			minAmountARaw: "1",
			minAmountBRaw: "2",
			confirmMainnet: true,
		});

		expect(nearApiMocks.callFunction).toHaveBeenCalledWith({
			contractId: "v2.ref-finance.near",
			methodName: "remove_liquidity",
			args: {
				pool_id: 7,
				shares: "100000",
				min_amounts: ["1", "2"],
			},
			deposit: 1n,
			gas: 180_000_000_000_000n,
		});
		expect(result.details).toMatchObject({
			poolId: 7,
			shares: "100000",
			minAmountsRaw: ["1", "2"],
			txHash: "near-remove-liquidity-hash",
		});
	});
});
