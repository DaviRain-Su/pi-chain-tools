import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock fetch globally for LI.FI API calls
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock signer for execute tests
vi.mock("./signer-resolve.js", () => ({
	resolveEvmSignerForTool: () => ({
		id: "local-key",
		getAddress: vi
			.fn()
			.mockResolvedValue("0xABCDEF1234567890ABCDEF1234567890ABCDEF12"),
		signAndSend: vi.fn().mockResolvedValue({
			txHash: "0xmocktxhash123",
			from: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
		}),
	}),
}));

import { createLifiExecuteTools } from "./lifi-execute.js";
import { createLifiReadTools } from "./lifi-read.js";

type ToolResult = {
	content: { type: string; text: string }[];
	details?: Record<string, unknown>;
};

function findTool(creators: () => unknown[], name: string) {
	const tools = creators() as {
		name: string;
		execute(id: string, params: Record<string, unknown>): Promise<ToolResult>;
	}[];
	const tool = tools.find((t) => t.name.endsWith(name));
	if (!tool) throw new Error(`Tool ${name} not found`);
	return tool;
}

afterEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Quote response fixture
// ---------------------------------------------------------------------------
const MOCK_QUOTE = {
	id: "quote-123",
	type: "lifi",
	tool: "stargate",
	toolDetails: { key: "stargate", name: "Stargate" },
	action: {
		fromChainId: 56,
		toChainId: 8453,
		fromToken: {
			address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
			symbol: "USDC",
			decimals: 18,
		},
		toToken: {
			address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
			symbol: "USDC",
			decimals: 6,
		},
		fromAmount: "1000000000000000000",
		slippage: 0.03,
	},
	estimate: {
		fromAmount: "1000000000000000000",
		toAmount: "990000",
		toAmountMin: "960000",
		approvalAddress: "0xLIFI_ROUTER_ADDRESS_1234567890ABCDEF1234",
		executionDuration: 120,
		feeCosts: [
			{
				name: "Bridge Fee",
				amount: "5000",
				token: { symbol: "USDC", decimals: 6, address: "0x..." },
			},
		],
		gasCosts: [
			{
				type: "SEND",
				estimate: "21000",
				token: { symbol: "BNB", decimals: 18, address: "0x..." },
			},
		],
		tool: "stargate",
	},
	includedSteps: [
		{
			id: "step-1",
			type: "cross",
			tool: "stargate",
			action: {
				fromChainId: 56,
				toChainId: 8453,
				fromToken: { address: "0x...", symbol: "USDC", decimals: 18 },
				toToken: { address: "0x...", symbol: "USDC", decimals: 6 },
				fromAmount: "1000000000000000000",
				slippage: 0.03,
			},
			estimate: {
				fromAmount: "1000000000000000000",
				toAmount: "990000",
				toAmountMin: "960000",
				approvalAddress: "0xRouter",
				executionDuration: 120,
				feeCosts: [],
				gasCosts: [],
				tool: "stargate",
			},
		},
	],
	transactionRequest: {
		to: "0xLIFI_DIAMOND_1234567890ABCDEF1234567890AB",
		data: "0xbridgedata...",
		value: "0x0",
		gasLimit: "0x30000",
		chainId: 56,
		from: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
	},
};

// ---------------------------------------------------------------------------
// lifiGetQuote
// ---------------------------------------------------------------------------
describe("lifiGetQuote", () => {
	it("returns formatted quote on success", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => MOCK_QUOTE,
		});

		const tool = findTool(createLifiReadTools, "lifiGetQuote");
		const result = await tool.execute("q1", {
			fromNetwork: "bsc",
			toNetwork: "base",
			fromToken: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
			toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
			fromAmount: "1000000000000000000",
			fromAddress: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
		});

		expect(result.content[0].text).toContain("LI.FI quote");
		expect(result.content[0].text).toContain("stargate");
		const d = result.details as Record<string, unknown>;
		expect(d.schema).toBe("evm.lifi.quote.v1");
		expect(d.quoteId).toBe("quote-123");
		expect(d.tool).toBe("stargate");
		expect(d.stepsCount).toBe(1);
		expect((d.from as Record<string, unknown>).network).toBe("bsc");
		expect((d.to as Record<string, unknown>).network).toBe("base");
	});

	it("throws on API error", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 400,
			statusText: "Bad Request",
			text: async () => "Invalid token",
		});

		const tool = findTool(createLifiReadTools, "lifiGetQuote");
		await expect(
			tool.execute("q2", {
				fromNetwork: "bsc",
				toNetwork: "base",
				fromToken: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
				toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
				fromAmount: "1000",
				fromAddress: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
			}),
		).rejects.toThrow("LI.FI API error 400");
	});

	it("rejects invalid fromAddress", async () => {
		const tool = findTool(createLifiReadTools, "lifiGetQuote");
		await expect(
			tool.execute("q3", {
				fromNetwork: "bsc",
				toNetwork: "base",
				fromToken: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
				toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
				fromAmount: "1000",
				fromAddress: "bad-address",
			}),
		).rejects.toThrow("valid EVM address");
	});
});

// ---------------------------------------------------------------------------
// lifiGetStatus
// ---------------------------------------------------------------------------
describe("lifiGetStatus", () => {
	it("returns status on success", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				status: "DONE",
				substatus: "COMPLETED",
				substatusMessage: "Transfer complete",
				tool: "stargate",
				sending: {
					txHash: "0xsend123",
					amount: "1000000",
					token: { symbol: "USDC", address: "0x..." },
					chainId: 56,
				},
				receiving: {
					txHash: "0xrecv456",
					amount: "990000",
					token: { symbol: "USDC", address: "0x..." },
					chainId: 8453,
				},
			}),
		});

		const tool = findTool(createLifiReadTools, "lifiGetStatus");
		const result = await tool.execute("s1", {
			txHash: "0xsend123",
			fromNetwork: "bsc",
			toNetwork: "base",
		});

		expect(result.content[0].text).toContain("DONE");
		const d = result.details as Record<string, unknown>;
		expect(d.schema).toBe("evm.lifi.status.v1");
		expect(d.status).toBe("DONE");
		expect((d.sending as Record<string, unknown>).txHash).toBe("0xsend123");
		expect((d.receiving as Record<string, unknown>).txHash).toBe("0xrecv456");
	});

	it("returns PENDING status", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				status: "PENDING",
				substatus: "WAIT_DESTINATION_TRANSACTION",
				substatusMessage: "Waiting for destination chain confirmation",
			}),
		});

		const tool = findTool(createLifiReadTools, "lifiGetStatus");
		const result = await tool.execute("s2", {
			txHash: "0xpending",
			fromNetwork: "bsc",
			toNetwork: "base",
		});

		const d = result.details as Record<string, unknown>;
		expect(d.status).toBe("PENDING");
	});
});

// ---------------------------------------------------------------------------
// lifiExecuteBridge
// ---------------------------------------------------------------------------
describe("lifiExecuteBridge", () => {
	it("returns preview in dryRun mode (default)", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => MOCK_QUOTE,
		});

		const tool = findTool(createLifiExecuteTools, "lifiExecuteBridge");
		const result = await tool.execute("e1", {
			fromNetwork: "bsc",
			toNetwork: "base",
			fromToken: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
			toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
			fromAmount: "1000000000000000000",
		});

		const d = result.details as Record<string, unknown>;
		expect(d.dryRun).toBe(true);
		expect(d.schema).toBe("evm.lifi.bridge.preview.v1");
		expect(d.tool).toBe("stargate");
		expect(d.needsApproval).toBe(true);
		expect(d.stepsCount).toBe(2); // approve + bridge
	});

	it("blocks mainnet execute without confirmMainnet", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => MOCK_QUOTE,
		});

		const tool = findTool(createLifiExecuteTools, "lifiExecuteBridge");
		await expect(
			tool.execute("e2", {
				fromNetwork: "bsc",
				toNetwork: "base",
				fromToken: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
				toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
				fromAmount: "1000000000000000000",
				dryRun: false,
			}),
		).rejects.toThrow("confirmMainnet");
	});

	it("preview shows no approval for native token bridge", async () => {
		const nativeQuote = {
			...MOCK_QUOTE,
			action: {
				...MOCK_QUOTE.action,
				fromToken: {
					address: "0x0000000000000000000000000000000000000000",
					symbol: "BNB",
					decimals: 18,
				},
			},
			estimate: {
				...MOCK_QUOTE.estimate,
				approvalAddress: "0xLIFI_ROUTER_ADDRESS_1234567890ABCDEF1234",
			},
		};

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => nativeQuote,
		});

		const tool = findTool(createLifiExecuteTools, "lifiExecuteBridge");
		const result = await tool.execute("e3", {
			fromNetwork: "bsc",
			toNetwork: "base",
			fromToken: "0x0000000000000000000000000000000000000000",
			toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
			fromAmount: "1000000000000000000",
		});

		const d = result.details as Record<string, unknown>;
		expect(d.needsApproval).toBe(false);
		expect(d.stepsCount).toBe(1); // bridge only, no approve
	});
});
