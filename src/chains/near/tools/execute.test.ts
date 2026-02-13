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
	getRefContractId: vi.fn(() => "v2.ref-finance.near"),
	getRefSwapQuote: vi.fn(),
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
	getRefContractId: refMocks.getRefContractId,
	getRefSwapQuote: refMocks.getRefSwapQuote,
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
});
