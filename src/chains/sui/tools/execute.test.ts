import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	formatCoinAmount: vi.fn((value: string) => value),
	getSuiClient: vi.fn(),
	getSuiExplorerTransactionUrl: vi.fn(
		() => "https://suivision.xyz/txblock/0x1",
	),
	getSuiRpcEndpoint: vi.fn(() => "https://fullnode.devnet.sui.io:443"),
	normalizeAtPath: vi.fn((value: string) => value),
	parsePositiveBigInt: vi.fn((value: string) => BigInt(value)),
	parseSuiNetwork: vi.fn(() => "devnet"),
	resolveSuiKeypair: vi.fn(() => ({
		toSuiAddress: () =>
			"0x1111111111111111111111111111111111111111111111111111111111111111",
	})),
	suiNetworkSchema: vi.fn(),
	toMist: vi.fn((value: number) => BigInt(Math.round(value * 1_000_000_000))),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		formatCoinAmount: runtimeMocks.formatCoinAmount,
		getSuiClient: runtimeMocks.getSuiClient,
		getSuiExplorerTransactionUrl: runtimeMocks.getSuiExplorerTransactionUrl,
		getSuiRpcEndpoint: runtimeMocks.getSuiRpcEndpoint,
		normalizeAtPath: runtimeMocks.normalizeAtPath,
		parsePositiveBigInt: runtimeMocks.parsePositiveBigInt,
		parseSuiNetwork: runtimeMocks.parseSuiNetwork,
		resolveSuiKeypair: runtimeMocks.resolveSuiKeypair,
		suiNetworkSchema: runtimeMocks.suiNetworkSchema,
		toMist: runtimeMocks.toMist,
	};
});

import { createSuiExecuteTools } from "./execute.js";

type ExecuteTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(name: string): ExecuteTool {
	const tool = createSuiExecuteTools().find((item) => item.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ExecuteTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.parseSuiNetwork.mockReturnValue("devnet");
	runtimeMocks.getSuiRpcEndpoint.mockReturnValue(
		"https://fullnode.devnet.sui.io:443",
	);
	runtimeMocks.getSuiExplorerTransactionUrl.mockReturnValue(
		"https://suivision.xyz/txblock/0x1",
	);
	runtimeMocks.parsePositiveBigInt.mockImplementation((value: string) =>
		BigInt(value),
	);
	runtimeMocks.formatCoinAmount.mockImplementation((value: string) => value);
});

describe("sui_transferSui", () => {
	const toAddress =
		"0x2222222222222222222222222222222222222222222222222222222222222222";

	it("blocks mainnet execution without confirmMainnet", async () => {
		runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
		const tool = getTool("sui_transferSui");

		await expect(
			tool.execute("t1", {
				toAddress,
				amountMist: "1000",
				network: "mainnet",
			}),
		).rejects.toThrow("confirmMainnet=true");

		expect(runtimeMocks.getSuiClient).not.toHaveBeenCalled();
	});

	it("signs and sends transfer using amountMist", async () => {
		const signAndExecuteTransaction = vi.fn().mockResolvedValue({
			digest: "0xabc",
			confirmedLocalExecution: true,
			effects: {
				status: {
					status: "success",
				},
			},
		});
		runtimeMocks.getSuiClient.mockReturnValue({ signAndExecuteTransaction });
		runtimeMocks.formatCoinAmount.mockReturnValue("0.000001");

		const tool = getTool("sui_transferSui");
		const result = await tool.execute("t2", {
			toAddress,
			amountMist: "1000",
			network: "devnet",
		});

		expect(runtimeMocks.parsePositiveBigInt).toHaveBeenCalledWith(
			"1000",
			"amountMist",
		);
		expect(signAndExecuteTransaction).toHaveBeenCalledTimes(1);
		expect(signAndExecuteTransaction.mock.calls[0]?.[0]).toMatchObject({
			requestType: "WaitForLocalExecution",
		});
		expect(result.details).toMatchObject({
			digest: "0xabc",
			status: "success",
			fromAddress:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			toAddress:
				"0x2222222222222222222222222222222222222222222222222222222222222222",
			amountMist: "1000",
			amountSui: "0.000001",
			network: "devnet",
		});
	});

	it("throws when chain execution status is failure", async () => {
		const signAndExecuteTransaction = vi.fn().mockResolvedValue({
			digest: "0xfail",
			effects: {
				status: {
					status: "failure",
					error: "insufficient gas",
				},
			},
		});
		runtimeMocks.getSuiClient.mockReturnValue({ signAndExecuteTransaction });

		const tool = getTool("sui_transferSui");
		await expect(
			tool.execute("t3", {
				toAddress,
				amountMist: "1000",
			}),
		).rejects.toThrow("insufficient gas");
	});
});

describe("sui_transferCoin", () => {
	const toAddress =
		"0x3333333333333333333333333333333333333333333333333333333333333333";
	const coinType = "0x2::usdc::USDC";
	const coinObjectIdA =
		"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
	const coinObjectIdB =
		"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

	it("rejects SUI coin type for this tool", async () => {
		const tool = getTool("sui_transferCoin");
		await expect(
			tool.execute("c1", {
				toAddress,
				coinType: "0x2::sui::SUI",
				amountRaw: "1000",
			}),
		).rejects.toThrow("Use sui_transferSui");
	});

	it("collects and merges coin objects before sending", async () => {
		const getCoins = vi.fn().mockResolvedValue({
			data: [
				{
					coinObjectId: coinObjectIdA,
					balance: "400",
				},
				{
					coinObjectId: coinObjectIdB,
					balance: "700",
				},
			],
			hasNextPage: false,
			nextCursor: null,
		});
		const signAndExecuteTransaction = vi.fn().mockResolvedValue({
			digest: "0xcoin-ok",
			confirmedLocalExecution: true,
			effects: {
				status: {
					status: "success",
				},
			},
		});
		runtimeMocks.getSuiClient.mockReturnValue({
			getCoins,
			signAndExecuteTransaction,
		});

		const tool = getTool("sui_transferCoin");
		const result = await tool.execute("c2", {
			toAddress,
			coinType,
			amountRaw: "1000",
		});

		expect(getCoins).toHaveBeenCalledWith({
			owner:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			coinType,
			cursor: undefined,
			limit: 20,
		});
		expect(signAndExecuteTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			digest: "0xcoin-ok",
			status: "success",
			coinType,
			amountRaw: "1000",
			selectedCoinObjectIds: [coinObjectIdA, coinObjectIdB],
			selectedCoinObjectCount: 2,
			selectedBalanceRaw: "1100",
		});
	});

	it("throws when selected coin objects are insufficient", async () => {
		const getCoins = vi.fn().mockResolvedValue({
			data: [
				{
					coinObjectId: coinObjectIdA,
					balance: "100",
				},
			],
			hasNextPage: false,
			nextCursor: null,
		});
		runtimeMocks.getSuiClient.mockReturnValue({
			getCoins,
			signAndExecuteTransaction: vi.fn(),
		});

		const tool = getTool("sui_transferCoin");
		await expect(
			tool.execute("c3", {
				toAddress,
				coinType,
				amountRaw: "1000",
				maxCoinObjectsToMerge: 1,
			}),
		).rejects.toThrow("Insufficient balance");
	});
});
