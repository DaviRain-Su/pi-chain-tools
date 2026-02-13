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
	getRefSwapQuote: vi.fn(),
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

vi.mock("../ref.js", () => ({
	getRefSwapQuote: refMocks.getRefSwapQuote,
}));

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

beforeEach(() => {
	vi.clearAllMocks();
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
