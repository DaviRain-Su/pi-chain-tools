import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
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

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
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
