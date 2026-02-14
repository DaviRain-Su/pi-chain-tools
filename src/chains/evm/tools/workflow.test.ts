import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMocks = vi.hoisted(() => ({
	placeOrderExecute: vi.fn(),
	getOrderStatusExecute: vi.fn(),
	cancelOrderExecute: vi.fn(),
}));

const polymarketMocks = vi.hoisted(() => ({
	resolveBtc5mTradeSelection: vi.fn(),
	getPolymarketOrderBook: vi.fn(),
	evaluateBtc5mTradeGuards: vi.fn((params: Record<string, unknown>) => {
		const orderbook = params.orderbook as {
			bestAsk?: { price: number };
			bestBid?: { price: number };
		};
		const guards = (params.guards ?? {}) as { maxSpreadBps?: number };
		const ask = orderbook.bestAsk?.price;
		const bid = orderbook.bestBid?.price;
		const spreadBps =
			ask != null && bid != null
				? (((ask - bid) / ((ask + bid) / 2)) * 10_000).toFixed(2)
				: null;
		const issues =
			guards.maxSpreadBps != null &&
			spreadBps != null &&
			Number(spreadBps) > guards.maxSpreadBps
				? [
						{
							code: "max_spread_exceeded",
							message: `Spread too wide: ${spreadBps}`,
						},
					]
				: [];
		return {
			passed: issues.length === 0,
			metrics: {
				spreadBps: spreadBps == null ? null : Number(spreadBps),
				depthUsdAtLimit: 0,
				adviceConfidence: null,
			},
			applied: {
				maxSpreadBps: guards.maxSpreadBps ?? null,
				minDepthUsd: null,
				maxStakeUsd: null,
				minConfidence: null,
			},
			issues,
		};
	}),
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
			name: "evm_polymarketGetOrderStatus",
			label: "get order status",
			description: "get order status",
			parameters: {},
			execute: executeMocks.getOrderStatusExecute,
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
	evaluateBtc5mTradeGuards: polymarketMocks.evaluateBtc5mTradeGuards,
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
	executeMocks.getOrderStatusExecute.mockResolvedValue({
		content: [{ type: "text", text: "order status" }],
		details: {
			orderId: "order-1",
			orderState: "partially_filled",
			fillRatio: 0.25,
			tradeSummary: { tradeCount: 1 },
		},
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

	it("infers simulate runMode from natural language when runMode is omitted", async () => {
		const tool = getTool();
		const result = await tool.execute("wf2-auto-sim", {
			runId: "wf-evm-2-auto-sim",
			network: "polygon",
			intentText: "买 BTC 5分钟涨 20 USDC，先模拟",
		});
		expect(result.content[0]?.text).toContain("Workflow simulated");
		expect(result.details).toMatchObject({
			runMode: "simulate",
			intentType: "evm.polymarket.btc5m.trade",
		});
	});

	it("simulates trade with guard-blocked status when spread threshold is too strict", async () => {
		const tool = getTool();
		const result = await tool.execute("wf2-guarded", {
			runId: "wf-evm-2-guarded",
			runMode: "simulate",
			network: "polygon",
			stakeUsd: 30,
			side: "up",
			maxSpreadBps: 100,
		});
		expect(result.content[0]?.text).toContain("status=guard_blocked");
		expect(result.details).toMatchObject({
			artifacts: {
				simulate: {
					status: "guard_blocked",
					guardEvaluation: {
						passed: false,
						issues: [
							{
								code: "max_spread_exceeded",
							},
						],
					},
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
		expect(executeMocks.getOrderStatusExecute).toHaveBeenCalledWith(
			"wf-evm-order-status",
			expect.objectContaining({
				network: "polygon",
				orderId: "order-1",
				includeTrades: true,
			}),
		);
		expect(executed.details).toMatchObject({
			artifacts: {
				execute: {
					status: "submitted",
					orderId: "order-1",
					orderStatus: {
						orderState: "partially_filled",
					},
				},
			},
		});
	});

	it("infers execute runMode + mainnet confirmation from natural language", async () => {
		const tool = getTool();
		const simulated = await tool.execute("wf4-auto-exec-sim", {
			runId: "wf-evm-4-auto-exec",
			runMode: "simulate",
			network: "polygon",
			stakeUsd: 22,
			side: "up",
		});
		const details = simulated.details as { confirmToken: string };
		const executed = await tool.execute("wf4-auto-exec", {
			runId: "wf-evm-4-auto-exec",
			network: "polygon",
			intentText: `继续执行刚才这笔，确认主网执行，confirmToken=${details.confirmToken}`,
		});
		expect(executed.content[0]?.text).toContain("Workflow executed");
		expect(executeMocks.placeOrderExecute).toHaveBeenCalledTimes(1);
	});

	it("simulates trade with stale requote preview", async () => {
		const tool = getTool();
		const result = await tool.execute("wf4-requote-sim", {
			runId: "wf-evm-4-requote",
			runMode: "simulate",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
			requoteStaleOrders: true,
			maxAgeMinutes: 30,
		});
		expect(executeMocks.cancelOrderExecute).toHaveBeenCalledWith(
			"wf-evm-trade-stale-simulate",
			expect.objectContaining({
				network: "polygon",
				tokenId: "token-up-1",
				maxAgeMinutes: 30,
				dryRun: true,
			}),
		);
		expect(result.details).toMatchObject({
			artifacts: {
				simulate: {
					staleRequote: {
						enabled: true,
						status: "ready",
						targetOrders: 1,
					},
				},
			},
		});
	});

	it("simulates trade with follow_mid requote pricing", async () => {
		const tool = getTool();
		const result = await tool.execute("wf4-requote-mid-sim", {
			runId: "wf-evm-4-requote-mid",
			runMode: "simulate",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
			requoteStaleOrders: true,
			requotePriceStrategy: "follow_mid",
			maxAgeMinutes: 30,
		});
		expect(result.details).toMatchObject({
			artifacts: {
				simulate: {
					staleRequote: {
						pricing: {
							strategy: "follow_mid",
							limitPrice: 0.5,
							priceSource: "midpoint",
						},
					},
				},
			},
		});
	});

	it("executes trade with stale requote cancel-before-place", async () => {
		const tool = getTool();
		const analyzed = await tool.execute("wf4-requote-analysis", {
			runId: "wf-evm-4-requote-exec",
			runMode: "analysis",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
			requoteStaleOrders: true,
			maxAgeMinutes: 30,
		});
		const details = analyzed.details as { confirmToken: string };
		const executed = await tool.execute("wf4-requote-exec", {
			runId: "wf-evm-4-requote-exec",
			runMode: "execute",
			network: "polygon",
			confirmMainnet: true,
			confirmToken: details.confirmToken,
		});

		expect(executeMocks.cancelOrderExecute).toHaveBeenCalledWith(
			"wf-evm-trade-stale-execute",
			expect.objectContaining({
				network: "polygon",
				tokenId: "token-up-1",
				maxAgeMinutes: 30,
				dryRun: false,
			}),
		);
		expect(executeMocks.placeOrderExecute).toHaveBeenCalled();
		expect(executed.details).toMatchObject({
			artifacts: {
				execute: {
					staleRequote: {
						enabled: true,
						targetOrders: 1,
					},
				},
			},
		});
	});

	it("executes trade with passive requote strategy and applies limitPrice", async () => {
		const tool = getTool();
		const analyzed = await tool.execute("wf4-requote-passive-analysis", {
			runId: "wf-evm-4-requote-passive",
			runMode: "analysis",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
			requoteStaleOrders: true,
			requotePriceStrategy: "passive",
			maxAgeMinutes: 30,
		});
		const details = analyzed.details as { confirmToken: string };
		await tool.execute("wf4-requote-passive-exec", {
			runId: "wf-evm-4-requote-passive",
			runMode: "execute",
			network: "polygon",
			confirmMainnet: true,
			confirmToken: details.confirmToken,
		});
		expect(executeMocks.placeOrderExecute).toHaveBeenCalledWith(
			"wf-evm-execute",
			expect.objectContaining({
				network: "polygon",
				limitPrice: 0.49,
				dryRun: false,
			}),
		);
	});

	it("retries requote repost with aggressive fallback when primary place fails", async () => {
		executeMocks.placeOrderExecute
			.mockRejectedValueOnce(new Error("primary place failed"))
			.mockResolvedValueOnce({
				content: [{ type: "text", text: "submitted fallback" }],
				details: { orderId: "order-fallback" },
			});
		const tool = getTool();
		const analyzed = await tool.execute("wf4-requote-fallback-analysis", {
			runId: "wf-evm-4-requote-fallback",
			runMode: "analysis",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
			requoteStaleOrders: true,
			requotePriceStrategy: "passive",
			maxAgeMinutes: 30,
		});
		const details = analyzed.details as { confirmToken: string };
		const executed = await tool.execute("wf4-requote-fallback-exec", {
			runId: "wf-evm-4-requote-fallback",
			runMode: "execute",
			network: "polygon",
			confirmMainnet: true,
			confirmToken: details.confirmToken,
		});
		expect(executeMocks.placeOrderExecute).toHaveBeenNthCalledWith(
			1,
			"wf-evm-execute",
			expect.objectContaining({
				limitPrice: 0.49,
			}),
		);
		expect(executeMocks.placeOrderExecute).toHaveBeenNthCalledWith(
			2,
			"wf-evm-execute-fallback",
			expect.objectContaining({
				limitPrice: 0.51,
			}),
		);
		expect(executed.details).toMatchObject({
			artifacts: {
				execute: {
					staleRequote: {
						repost: {
							usedFallback: true,
							fallbackTried: true,
						},
						executedLimitPrice: 0.51,
					},
				},
			},
		});
	});

	it("blocks requote execute when price drift exceeds threshold", async () => {
		polymarketMocks.getPolymarketOrderBook
			.mockResolvedValueOnce({
				tokenId: "token-up-1",
				bestBid: { price: 0.49, size: 100 },
				bestAsk: { price: 0.51, size: 100 },
				midpoint: 0.5,
				bids: [{ price: 0.49, size: 100 }],
				asks: [{ price: 0.51, size: 100 }],
			})
			.mockResolvedValueOnce({
				tokenId: "token-up-1",
				bestBid: { price: 0.49, size: 100 },
				bestAsk: { price: 0.51, size: 100 },
				midpoint: 0.5,
				bids: [{ price: 0.49, size: 100 }],
				asks: [{ price: 0.51, size: 100 }],
			})
			.mockResolvedValueOnce({
				tokenId: "token-up-1",
				bestBid: { price: 0.69, size: 100 },
				bestAsk: { price: 0.71, size: 100 },
				midpoint: 0.7,
				bids: [{ price: 0.69, size: 100 }],
				asks: [{ price: 0.71, size: 100 }],
			});
		const tool = getTool();
		const analyzed = await tool.execute("wf4-volatility-analysis", {
			runId: "wf-evm-4-volatility",
			runMode: "analysis",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
			requoteStaleOrders: true,
			maxAgeMinutes: 30,
			requoteMaxPriceDriftBps: 100,
		});
		const details = analyzed.details as { confirmToken: string };
		await tool.execute("wf4-volatility-exec-1", {
			runId: "wf-evm-4-volatility",
			runMode: "execute",
			network: "polygon",
			confirmMainnet: true,
			confirmToken: details.confirmToken,
		});
		await expect(
			tool.execute("wf4-volatility-exec-2", {
				runId: "wf-evm-4-volatility",
				runMode: "execute",
				network: "polygon",
				confirmMainnet: true,
			}),
		).rejects.toThrow("volatility guard");
		expect(executeMocks.cancelOrderExecute).toHaveBeenCalledTimes(1);
	});

	it("marks simulate as volatility_blocked when requote drift is too large", async () => {
		polymarketMocks.getPolymarketOrderBook
			.mockResolvedValueOnce({
				tokenId: "token-up-1",
				bestBid: { price: 0.49, size: 100 },
				bestAsk: { price: 0.51, size: 100 },
				midpoint: 0.5,
				bids: [{ price: 0.49, size: 100 }],
				asks: [{ price: 0.51, size: 100 }],
			})
			.mockResolvedValueOnce({
				tokenId: "token-up-1",
				bestBid: { price: 0.49, size: 100 },
				bestAsk: { price: 0.51, size: 100 },
				midpoint: 0.5,
				bids: [{ price: 0.49, size: 100 }],
				asks: [{ price: 0.51, size: 100 }],
			})
			.mockResolvedValueOnce({
				tokenId: "token-up-1",
				bestBid: { price: 0.67, size: 100 },
				bestAsk: { price: 0.69, size: 100 },
				midpoint: 0.68,
				bids: [{ price: 0.67, size: 100 }],
				asks: [{ price: 0.69, size: 100 }],
			});
		const tool = getTool();
		const analyzed = await tool.execute("wf4-volatility-sim-analysis", {
			runId: "wf-evm-4-volatility-sim",
			runMode: "analysis",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
			requoteStaleOrders: true,
			maxAgeMinutes: 30,
			requoteMaxPriceDriftBps: 100,
		});
		const details = analyzed.details as { confirmToken: string };
		await tool.execute("wf4-volatility-sim-exec", {
			runId: "wf-evm-4-volatility-sim",
			runMode: "execute",
			network: "polygon",
			confirmMainnet: true,
			confirmToken: details.confirmToken,
		});
		const simulated = await tool.execute("wf4-volatility-sim-simulate", {
			runId: "wf-evm-4-volatility-sim",
			runMode: "simulate",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
			requoteStaleOrders: true,
			maxAgeMinutes: 30,
			requoteMaxPriceDriftBps: 100,
		});
		expect(simulated.details).toMatchObject({
			artifacts: {
				simulate: {
					staleRequote: {
						status: "volatility_blocked",
						volatilityGuard: {
							blocked: true,
						},
					},
				},
			},
		});
	});

	it("fails requote execute directly when fallback mode is none", async () => {
		executeMocks.placeOrderExecute.mockRejectedValueOnce(
			new Error("primary place failed"),
		);
		const tool = getTool();
		const analyzed = await tool.execute("wf4-requote-nofb-analysis", {
			runId: "wf-evm-4-requote-nofb",
			runMode: "analysis",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
			requoteStaleOrders: true,
			requotePriceStrategy: "passive",
			requoteFallbackMode: "none",
			maxAgeMinutes: 30,
		});
		const details = analyzed.details as { confirmToken: string };
		await expect(
			tool.execute("wf4-requote-nofb-exec", {
				runId: "wf-evm-4-requote-nofb",
				runMode: "execute",
				network: "polygon",
				confirmMainnet: true,
				confirmToken: details.confirmToken,
			}),
		).rejects.toThrow("primary place failed");
	});

	it("blocks requote execute when max attempts reached", async () => {
		const tool = getTool();
		const analyzed = await tool.execute("wf4-requote-attempts-analysis", {
			runId: "wf-evm-4-requote-attempts",
			runMode: "analysis",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
			requoteStaleOrders: true,
			maxAgeMinutes: 30,
			requoteMaxAttempts: 1,
		});
		const details = analyzed.details as { confirmToken: string };
		await tool.execute("wf4-requote-attempts-exec-1", {
			runId: "wf-evm-4-requote-attempts",
			runMode: "execute",
			network: "polygon",
			confirmMainnet: true,
			confirmToken: details.confirmToken,
		});
		await expect(
			tool.execute("wf4-requote-attempts-exec-2", {
				runId: "wf-evm-4-requote-attempts",
				runMode: "execute",
				network: "polygon",
				confirmMainnet: true,
			}),
		).rejects.toThrow("max attempts reached");
		expect(executeMocks.placeOrderExecute).toHaveBeenCalledTimes(1);
	});

	it("blocks requote execute when cooldown not elapsed", async () => {
		const tool = getTool();
		const analyzed = await tool.execute("wf4-requote-cooldown-analysis", {
			runId: "wf-evm-4-requote-cooldown",
			runMode: "analysis",
			network: "polygon",
			stakeUsd: 25,
			side: "up",
			requoteStaleOrders: true,
			maxAgeMinutes: 30,
			requoteMinIntervalSeconds: 3600,
		});
		const details = analyzed.details as { confirmToken: string };
		await tool.execute("wf4-requote-cooldown-exec-1", {
			runId: "wf-evm-4-requote-cooldown",
			runMode: "execute",
			network: "polygon",
			confirmMainnet: true,
			confirmToken: details.confirmToken,
		});
		await expect(
			tool.execute("wf4-requote-cooldown-exec-2", {
				runId: "wf-evm-4-requote-cooldown",
				runMode: "execute",
				network: "polygon",
				confirmMainnet: true,
			}),
		).rejects.toThrow("throttled");
		expect(executeMocks.placeOrderExecute).toHaveBeenCalledTimes(1);
	});

	it("blocks execute trade when guard checks fail", async () => {
		const tool = getTool();
		const simulated = await tool.execute("wf4-guard-sim", {
			runId: "wf-evm-4-guard",
			runMode: "simulate",
			network: "polygon",
			stakeUsd: 20,
			side: "up",
			maxSpreadBps: 100,
		});
		const details = simulated.details as { confirmToken: string };
		await expect(
			tool.execute("wf4-guard-exec", {
				runId: "wf-evm-4-guard",
				runMode: "execute",
				network: "polygon",
				confirmMainnet: true,
				confirmToken: details.confirmToken,
			}),
		).rejects.toThrow("guard checks");
		expect(executeMocks.placeOrderExecute).not.toHaveBeenCalled();
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

	it("parses requote natural language as trade intent (not pure cancel)", async () => {
		const tool = getTool();
		const result = await tool.execute("wf5-requote-text-sim", {
			runId: "wf-evm-5-requote-text",
			runMode: "simulate",
			network: "polygon",
			intentText:
				"买 BTC 5分钟涨 20 USDC，如果超过 30 分钟未成交就撤单重挂，先模拟",
		});
		expect(result.details).toMatchObject({
			intentType: "evm.polymarket.btc5m.trade",
			artifacts: {
				simulate: {
					staleRequote: {
						enabled: true,
						status: "ready",
					},
				},
			},
		});
		expect(executeMocks.cancelOrderExecute).toHaveBeenCalledWith(
			"wf-evm-trade-stale-simulate",
			expect.objectContaining({
				maxAgeMinutes: 30,
				dryRun: true,
			}),
		);
	});

	it("parses rich natural language requote controls into trade intent", async () => {
		const tool = getTool();
		const result = await tool.execute("wf5-requote-rich-sim", {
			runId: "wf-evm-5-requote-rich",
			runMode: "simulate",
			network: "polygon",
			intentText:
				"买 BTC 5分钟涨 20 USDC，1小时未成交就自动重挂，用稳健策略，失败后再试一次，每2分钟最多3次，波动不超过0.8%，先模拟",
		});
		expect(result.details).toMatchObject({
			intentType: "evm.polymarket.btc5m.trade",
			intent: {
				requoteStaleOrders: true,
				requotePriceStrategy: "passive",
				requoteFallbackMode: "retry_aggressive",
				maxAgeMinutes: 60,
				requoteMinIntervalSeconds: 120,
				requoteMaxAttempts: 3,
				requoteMaxPriceDriftBps: 80,
			},
			artifacts: {
				simulate: {
					staleRequote: {
						enabled: true,
						status: "ready",
					},
				},
			},
		});
		expect(executeMocks.cancelOrderExecute).toHaveBeenCalledWith(
			"wf-evm-trade-stale-simulate",
			expect.objectContaining({
				maxAgeMinutes: 60,
				dryRun: true,
			}),
		);
	});

	it("parses natural-language guard config and AI toggle into trade intent", async () => {
		const tool = getTool();
		const result = await tool.execute("wf5-guard-rich-sim", {
			runId: "wf-evm-5-guard-rich",
			runMode: "simulate",
			network: "polygon",
			intentText:
				"不用AI，买 BTC 5分钟涨 20 USDC，最高入场价 0.53，点差不超过80bps，最小深度至少100，最大下注25，置信度至少60%，先模拟",
		});
		expect(result.details).toMatchObject({
			intentType: "evm.polymarket.btc5m.trade",
			intent: {
				maxEntryPrice: 0.53,
				maxSpreadBps: 80,
				minDepthUsd: 100,
				maxStakeUsd: 25,
				minConfidence: 0.6,
				useAiAssist: false,
			},
		});
		expect(polymarketMocks.resolveBtc5mTradeSelection).toHaveBeenCalledWith(
			expect.objectContaining({
				useAiAssist: false,
			}),
		);
	});

	it("applies natural language risk profile defaults to trade guards", async () => {
		const tool = getTool();
		const result = await tool.execute("wf5-risk-profile", {
			runId: "wf-evm-5-risk-profile",
			runMode: "simulate",
			network: "polygon",
			intentText: "买 BTC 5分钟涨 20 USDC，先模拟，保守",
		});
		expect(result.details).toMatchObject({
			intentType: "evm.polymarket.btc5m.trade",
			intent: {
				riskProfile: "conservative",
				maxSpreadBps: 40,
				minDepthUsd: 250,
				maxStakeUsd: 200,
				minConfidence: 0.85,
			},
		});
	});

	it("keeps explicit guard values over risk profile defaults", async () => {
		const tool = getTool();
		const result = await tool.execute("wf5-risk-profile-override", {
			runId: "wf-evm-5-risk-override",
			runMode: "simulate",
			network: "polygon",
			intentText: "买 BTC 5分钟涨 20 USDC，激进，点差不超过50bps，先模拟",
		});
		expect(result.details).toMatchObject({
			intentType: "evm.polymarket.btc5m.trade",
			intent: {
				riskProfile: "aggressive",
				maxSpreadBps: 50,
			},
		});
	});

	it("simulates stale-cancel intent from natural language with maxAgeMinutes", async () => {
		const tool = getTool();
		const result = await tool.execute("wf5-stale-sim", {
			runId: "wf-evm-5-stale",
			runMode: "simulate",
			network: "polygon",
			intentText: "取消 BTC 5m 超过 30 分钟未成交挂单，先模拟",
		});
		expect(result.content[0]?.text).toContain("evm.polymarket.btc5m.cancel");
		expect(executeMocks.cancelOrderExecute).toHaveBeenCalledWith(
			"wf-evm-cancel-simulate",
			expect.objectContaining({
				network: "polygon",
				maxAgeMinutes: 30,
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
