import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMocks = vi.hoisted(() => ({
	placeOrderExecute: vi.fn(),
	cancelOrderExecute: vi.fn(),
}));

const polymarketMocks = vi.hoisted(() => ({
	resolveBtc5mTradeSelection: vi.fn(),
	getPolymarketOrderBook: vi.fn(),
}));

vi.mock("./execute.js", () => ({
	createEvmExecuteTools: () => [
		{
			name: "evm_polymarketPlaceOrder",
			label: "place order",
			description: "place order",
			parameters: {},
			execute: executeMocks.placeOrderExecute,
		},
		{
			name: "evm_polymarketCancelOrder",
			label: "cancel order",
			description: "cancel order",
			parameters: {},
			execute: executeMocks.cancelOrderExecute,
		},
	],
}));

vi.mock("../polymarket.js", () => ({
	resolveBtc5mTradeSelection: polymarketMocks.resolveBtc5mTradeSelection,
	getPolymarketOrderBook: polymarketMocks.getPolymarketOrderBook,
}));

import { createEvmWorkflowTools } from "./workflow.js";

type WorkflowTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(): WorkflowTool {
	const tool = createEvmWorkflowTools().find(
		(entry) => entry.name === "w3rt_run_evm_polymarket_workflow_v0",
	);
	if (!tool) throw new Error("w3rt_run_evm_polymarket_workflow_v0 not found");
	return tool as unknown as WorkflowTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	polymarketMocks.resolveBtc5mTradeSelection.mockResolvedValue({
		market: {
			slug: "btc-updown-5m-test",
			negRisk: false,
		},
		side: "up",
		tokenId: "token-up-1",
		advice: {
			recommendedSide: "up",
			confidence: 0.7,
		},
	});
	polymarketMocks.getPolymarketOrderBook.mockResolvedValue({
		tokenId: "token-up-1",
		bestBid: { price: 0.49, size: 100 },
		bestAsk: { price: 0.51, size: 100 },
		midpoint: 0.5,
		bids: [{ price: 0.49, size: 100 }],
		asks: [{ price: 0.51, size: 100 }],
	});
	executeMocks.placeOrderExecute.mockResolvedValue({
		content: [{ type: "text", text: "submitted" }],
		details: { orderId: "order-1" },
	});
	executeMocks.cancelOrderExecute.mockResolvedValue({
		content: [{ type: "text", text: "cancel submitted" }],
		details: { targetOrderIds: ["order-1"] },
	});
});

describe("w3rt_run_evm_polymarket_workflow_v0", () => {
	it("analyzes trade intent and returns confirm token", async () => {
		const tool = getTool();
		const result = await tool.execute("wf1", {
			runId: "wf-evm-1",
			runMode: "analysis",
			network: "polygon",
			intentText: "买 BTC 5分钟涨 20 USDC，先分析",
			stakeUsd: 20,
		});
		expect(result.content[0]?.text).toContain("Workflow analyzed");
		expect(result.details).toMatchObject({
			runId: "wf-evm-1",
			intentType: "evm.polymarket.btc5m.trade",
			needsMainnetConfirmation: true,
			confirmToken: expect.stringMatching(/^EVM-/),
		});
	});

	it("simulates trade and returns estimated shares", async () => {
		const tool = getTool();
		const result = await tool.execute("wf2", {
			runId: "wf-evm-2",
			runMode: "simulate",
			network: "polygon",
			stakeUsd: 30,
			side: "up",
		});
		expect(result.content[0]?.text).toContain("status=ready");
		expect(result.details).toMatchObject({
			artifacts: {
				simulate: {
					status: "ready",
					entryPrice: 0.51,
				},
			},
		});
	});

	it("blocks execute trade without mainnet confirmation", async () => {
		const tool = getTool();
		await expect(
			tool.execute("wf3", {
				runId: "wf-evm-3",
				runMode: "execute",
				network: "polygon",
				stakeUsd: 15,
				side: "up",
			}),
		).rejects.toThrow("Mainnet execute blocked");
	});

	it("executes trade with confirm token and calls place order", async () => {
		const tool = getTool();
		const simulated = await tool.execute("wf4-sim", {
			runId: "wf-evm-4",
			runMode: "simulate",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
		});
		const details = simulated.details as { confirmToken: string };
		const executed = await tool.execute("wf4-exec", {
			runId: "wf-evm-4",
			runMode: "execute",
			network: "polygon",
			confirmMainnet: true,
			confirmToken: details.confirmToken,
		});

		expect(executeMocks.placeOrderExecute).toHaveBeenCalledTimes(1);
		expect(executeMocks.placeOrderExecute).toHaveBeenCalledWith(
			"wf-evm-execute",
			expect.objectContaining({
				network: "polygon",
				stakeUsd: 25,
				dryRun: false,
			}),
		);
		expect(executed.details).toMatchObject({
			artifacts: {
				execute: {
					status: "submitted",
				},
			},
		});
	});

	it("simulates cancel intent from natural language", async () => {
		const tool = getTool();
		const result = await tool.execute("wf5-sim", {
			runId: "wf-evm-5",
			runMode: "simulate",
			network: "polygon",
			intentText: "取消 BTC 5m 所有挂单，先模拟",
		});
		expect(result.content[0]?.text).toContain("evm.polymarket.btc5m.cancel");
		expect(executeMocks.cancelOrderExecute).toHaveBeenCalledWith(
			"wf-evm-cancel-simulate",
			expect.objectContaining({
				network: "polygon",
				cancelAll: true,
				dryRun: true,
			}),
		);
	});

	it("executes cancel with confirm token and calls cancel tool", async () => {
		const tool = getTool();
		const simulated = await tool.execute("wf6-sim", {
			runId: "wf-evm-6",
			runMode: "simulate",
			network: "polygon",
			intentText: "取消所有 BTC 5m 挂单",
		});
		const details = simulated.details as { confirmToken: string };
		const executed = await tool.execute("wf6-exec", {
			runId: "wf-evm-6",
			runMode: "execute",
			network: "polygon",
			confirmMainnet: true,
			confirmToken: details.confirmToken,
		});

		expect(executeMocks.cancelOrderExecute).toHaveBeenCalledWith(
			"wf-evm-cancel-execute",
			expect.objectContaining({
				network: "polygon",
				cancelAll: true,
				dryRun: false,
			}),
		);
		expect(executed.details).toMatchObject({
			intentType: "evm.polymarket.btc5m.cancel",
			artifacts: {
				execute: {
					status: "submitted",
					targetOrders: 1,
				},
			},
		});
	});
});
