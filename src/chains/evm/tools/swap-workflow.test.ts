import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMocks = vi.hoisted(() => ({
	pancakeSwapExecute: vi.fn(),
}));

vi.mock("./execute.js", () => ({
	createEvmExecuteTools: () => [
		{
			name: "evm_pancakeV2Swap",
			label: "pancake v2 swap",
			description: "pancake v2 swap",
			parameters: {},
			execute: executeMocks.pancakeSwapExecute,
		},
	],
}));

import { createEvmSwapWorkflowTools } from "./swap-workflow.js";

type WorkflowTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(): WorkflowTool {
	const tool = createEvmSwapWorkflowTools().find(
		(entry) => entry.name === "w3rt_run_evm_swap_workflow_v0",
	);
	if (!tool) throw new Error("w3rt_run_evm_swap_workflow_v0 not found");
	return tool as unknown as WorkflowTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	executeMocks.pancakeSwapExecute.mockResolvedValue({
		content: [{ type: "text", text: "swap preview" }],
		details: {
			dryRun: true,
			network: "bsc",
			pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
			amountOutRaw: "4960",
		},
	});
});

describe("w3rt_run_evm_swap_workflow_v0", () => {
	it("analyzes swap intent and returns confirm token", async () => {
		const tool = getTool();
		const result = await tool.execute("wf1", {
			runId: "wf-evm-swap-1",
			runMode: "analysis",
			network: "bsc",
			tokenInAddress: "0x1111111111111111111111111111111111111111",
			tokenOutAddress: "0x2222222222222222222222222222222222222222",
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dead",
		});
		expect(result.content[0]?.text).toContain("Workflow analyzed");
		expect(result.details).toMatchObject({
			runId: "wf-evm-swap-1",
			intentType: "evm.swap.pancakeV2",
			needsMainnetConfirmation: true,
			confirmToken: expect.stringMatching(/^EVM-/),
		});
	});

	it("simulates swap and delegates dry run to execute tool", async () => {
		const tool = getTool();
		const result = await tool.execute("wf2", {
			runId: "wf-evm-swap-2",
			runMode: "simulate",
			network: "bsc",
			tokenInAddress: "0x1111111111111111111111111111111111111111",
			tokenOutAddress: "0x2222222222222222222222222222222222222222",
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dead",
			slippageBps: 50,
		});
		expect(executeMocks.pancakeSwapExecute).toHaveBeenCalledWith(
			"wf-evm-swap-simulate",
			expect.objectContaining({
				network: "bsc",
				dryRun: true,
				tokenInAddress: "0x1111111111111111111111111111111111111111",
				tokenOutAddress: "0x2222222222222222222222222222222222222222",
				amountInRaw: "10000",
				toAddress: "0x000000000000000000000000000000000000dead",
			}),
		);
		expect(result.details).toMatchObject({
			artifacts: {
				simulate: {
					status: "ready",
					preview: {
						dryRun: true,
						pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
					},
				},
			},
		});
	});

	it("simulates from natural-language text without explicit amount field", async () => {
		const tool = getTool();
		await tool.execute("wf2b", {
			runMode: "simulate",
			network: "bsc",
			intentText:
				"先模拟把 10000 从 0x1111111111111111111111111111111111111111 换到 0x2222222222222222222222222222222222222222，收款到 0x000000000000000000000000000000000000dead",
		});
		expect(executeMocks.pancakeSwapExecute).toHaveBeenCalledWith(
			"wf-evm-swap-simulate",
			expect.objectContaining({
				network: "bsc",
				dryRun: true,
				tokenInAddress: "0x1111111111111111111111111111111111111111",
				tokenOutAddress: "0x2222222222222222222222222222222222222222",
				amountInRaw: "10000",
				toAddress: "0x000000000000000000000000000000000000dead",
			}),
		);
	});

	it("rejects decimal amountInRaw with friendly raw-unit guidance", async () => {
		const tool = getTool();
		await expect(
			tool.execute("wf2c", {
				runMode: "simulate",
				network: "bsc",
				intentText:
					"先模拟 amountInRaw=1.5，从 0x1111111111111111111111111111111111111111 换到 0x2222222222222222222222222222222222222222，收款到 0x000000000000000000000000000000000000dead",
			}),
		).rejects.toThrow(
			"amountInRaw must be an integer raw amount. Decimal values are not accepted by this workflow; convert token amount to raw units yourself.",
		);
	});

	it("rejects decimal amountOutMinRaw with integer guidance", async () => {
		const tool = getTool();
		await expect(
			tool.execute("wf2c2", {
				runMode: "simulate",
				network: "bsc",
				intentText:
					"先模拟 amountInRaw=10000 amountOutMinRaw=0.5 从 0x1111111111111111111111111111111111111111 换到 0x2222222222222222222222222222222222222222，收款到 0x000000000000000000000000000000000000dead",
			}),
		).rejects.toThrow(
			"amountOutMinRaw must be an integer raw amount. Decimal values are not accepted by this workflow; convert token amount to raw units yourself.",
		);
	});

	it("parses alias tokens from natural-language intent text", async () => {
		const tool = getTool();
		await tool.execute("wf2d_alias", {
			runMode: "simulate",
			network: "bsc",
			intentText:
				"先模拟 amountInRaw=10000 fromToken=0x1111111111111111111111111111111111111111 tokenOut=0x2222222222222222222222222222222222222222 recipient=0x000000000000000000000000000000000000dead",
		});
		expect(executeMocks.pancakeSwapExecute).toHaveBeenCalledWith(
			"wf-evm-swap-simulate",
			expect.objectContaining({
				network: "bsc",
				dryRun: true,
				tokenInAddress: "0x1111111111111111111111111111111111111111",
				tokenOutAddress: "0x2222222222222222222222222222222222222222",
				amountInRaw: "10000",
				toAddress: "0x000000000000000000000000000000000000dead",
			}),
		);
	});

	it("accepts slippage and deadline aliases in intent text", async () => {
		const tool = getTool();
		await tool.execute("wf2e_alias", {
			runMode: "simulate",
			network: "bsc",
			intentText:
				"先模拟 amountInRaw=10000 从 0x1111111111111111111111111111111111111111 换到 0x2222222222222222222222222222222222222222，收款到 0x000000000000000000000000000000000000dead，滑点=2.5%，截止=15",
		});
		expect(executeMocks.pancakeSwapExecute).toHaveBeenCalledWith(
			"wf-evm-swap-simulate",
			expect.objectContaining({
				network: "bsc",
				dryRun: true,
				slippageBps: 250,
				deadlineMinutes: 15,
			}),
		);
	});

	it("accepts minOut and receiver aliases in intent text", async () => {
		const tool = getTool();
		await tool.execute("wf2f_alias", {
			runMode: "simulate",
			network: "bsc",
			intentText:
				"先模拟 amountInRaw=10000 tokenIn=0x1111111111111111111111111111111111111111 minOut=1234 tokenOut=0x2222222222222222222222222222222222222222 receiverAddress=0x000000000000000000000000000000000000dead",
		});
		expect(executeMocks.pancakeSwapExecute).toHaveBeenCalledWith(
			"wf-evm-swap-simulate",
			expect.objectContaining({
				network: "bsc",
				dryRun: true,
				tokenInAddress: "0x1111111111111111111111111111111111111111",
				tokenOutAddress: "0x2222222222222222222222222222222222222222",
				amountOutMinRaw: "1234",
				toAddress: "0x000000000000000000000000000000000000dead",
			}),
		);
	});

	it("rejects slippage too low", async () => {
		const tool = getTool();
		await expect(
			tool.execute("wf2g_alias", {
				runMode: "simulate",
				network: "bsc",
				intentText:
					"先模拟 amountInRaw=10000 从 0x1111111111111111111111111111111111111111 换到 0x2222222222222222222222222222222222222222，收款到 0x000000000000000000000000000000000000dead，滑点=0.2",
			}),
		).rejects.toThrow("slippageBps must be within 1 and 9999");
	});

	it("rejects natural-language input missing recipient and explains toAddress hint", async () => {
		const tool = getTool();
		await expect(
			tool.execute("wf2d", {
				runMode: "simulate",
				network: "bsc",
				intentText:
					"先模拟 10000 从 0x1111111111111111111111111111111111111111 换到 0x2222222222222222222222222222222222222222",
			}),
		).rejects.toThrow(
			"toAddress is required for evm.swap.pancakeV2. Include toAddress in params or phrase it like 'toAddress=0x...' / '给/...'.",
		);
	});

	it("accepts chinese quantity key in intent text", async () => {
		const tool = getTool();
		await tool.execute("wf2e", {
			runMode: "simulate",
			network: "bsc",
			intentText:
				"先模拟 数量:10000 给 0x000000000000000000000000000000000000dead，从 0x1111111111111111111111111111111111111111 换到 0x2222222222222222222222222222222222222222",
		});
		expect(executeMocks.pancakeSwapExecute).toHaveBeenCalledWith(
			"wf-evm-swap-simulate",
			expect.objectContaining({
				network: "bsc",
				dryRun: true,
				tokenInAddress: "0x1111111111111111111111111111111111111111",
				tokenOutAddress: "0x2222222222222222222222222222222222222222",
				amountInRaw: "10000",
				toAddress: "0x000000000000000000000000000000000000dead",
			}),
		);
	});

	it("rejects missing multiple fields with aggregate guidance", async () => {
		const tool = getTool();
		await expect(
			tool.execute("wf2f", {
				runMode: "simulate",
				network: "bsc",
				intentText: "先模拟",
			}),
		).rejects.toThrow(
			/Missing required fields for evm\.swap\.pancakeV2: .*tokenInAddress.*fromAddress.*tokenOutAddress.*outputToken.*toAddress.*recipientAddress.*amountInRaw/s,
		);
	});

	it("blocks execute swap without mainnet confirmation", async () => {
		const tool = getTool();
		await expect(
			tool.execute("wf3", {
				runId: "wf-evm-swap-3",
				runMode: "execute",
				network: "bsc",
				tokenInAddress: "0x1111111111111111111111111111111111111111",
				tokenOutAddress: "0x2222222222222222222222222222222222222222",
				amountInRaw: "10000",
				toAddress: "0x000000000000000000000000000000000000dead",
			}),
		).rejects.toThrow("Mainnet execute blocked");
	});

	it("rejects execute when confirmToken is invalid", async () => {
		const tool = getTool();
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap preview" }],
			details: {
				dryRun: true,
				pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
				amountOutRaw: "4960",
			},
		});

		await tool.execute("wf2g", {
			runId: "wf-evm-swap-g",
			runMode: "simulate",
			network: "bsc",
			tokenInAddress: "0x1111111111111111111111111111111111111111",
			tokenOutAddress: "0x2222222222222222222222222222222222222222",
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dead",
		});

		await expect(
			tool.execute("wf2g", {
				runId: "wf-evm-swap-g",
				runMode: "execute",
				network: "bsc",
				confirmMainnet: true,
				confirmToken: "EVM-INVALID",
			}),
		).rejects.toThrow("Invalid confirmToken");
	});

	it("rejects execute with stale runId and reused confirm token", async () => {
		const tool = getTool();
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap preview" }],
			details: {
				dryRun: true,
				pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
				amountOutRaw: "4960",
			},
		});

		const simulated = await tool.execute("wf-stale", {
			runMode: "simulate",
			network: "bsc",
			tokenInAddress: "0x1111111111111111111111111111111111111111",
			tokenOutAddress: "0x2222222222222222222222222222222222222222",
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dead",
		});

		await expect(
			tool.execute("wf-stale-exec", {
				runId: "wf-stale-other",
				runMode: "execute",
				network: "bsc",
				confirmMainnet: true,
				confirmToken: (simulated.details as { confirmToken: string })
					.confirmToken,
				tokenInAddress: "0x1111111111111111111111111111111111111111",
				tokenOutAddress: "0x2222222222222222222222222222222222222222",
				amountInRaw: "10000",
				toAddress: "0x000000000000000000000000000000000000dead",
			}),
		).rejects.toThrow("Invalid confirmToken");
	});

	it("rejects execute when intent changes without fresh confirmation", async () => {
		const tool = getTool();
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap preview" }],
			details: {
				dryRun: true,
				pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
				amountOutRaw: "4960",
			},
		});

		await tool.execute("wf-intent", {
			runMode: "simulate",
			network: "bsc",
			tokenInAddress: "0x1111111111111111111111111111111111111111",
			tokenOutAddress: "0x2222222222222222222222222222222222222222",
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dead",
		});

		await expect(
			tool.execute("wf-intent", {
				runMode: "execute",
				network: "bsc",
				confirmMainnet: true,
				amountInRaw: "20000",
				tokenInAddress: "0x1111111111111111111111111111111111111111",
				tokenOutAddress: "0x2222222222222222222222222222222222222222",
				toAddress: "0x000000000000000000000000000000000000dead",
			}),
		).rejects.toThrow("Invalid confirmToken");
	});

	it("executes swap with confirm token", async () => {
		const tool = getTool();
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap preview" }],
			details: {
				dryRun: true,
				network: "bsc",
				pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
				amountOutRaw: "4960",
			},
		});
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap submitted" }],
			details: {
				dryRun: false,
				txHash: `0x${"2".repeat(64)}`,
			},
		});

		const simulated = await tool.execute("wf4", {
			runId: "wf-evm-swap-4",
			runMode: "simulate",
			network: "bsc",
			tokenInAddress: "0x1111111111111111111111111111111111111111",
			tokenOutAddress: "0x2222222222222222222222222222222222222222",
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dead",
		});
		const details = simulated.details as { confirmToken: string };

		const executed = await tool.execute("wf4-exec", {
			runId: "wf-evm-swap-4",
			runMode: "execute",
			network: "bsc",
			confirmMainnet: true,
			confirmToken: details.confirmToken,
		});

		expect(executeMocks.pancakeSwapExecute).toHaveBeenCalledWith(
			"wf-evm-swap-execute",
			expect.objectContaining({
				network: "bsc",
				dryRun: false,
				confirmMainnet: true,
				tokenInAddress: "0x1111111111111111111111111111111111111111",
				tokenOutAddress: "0x2222222222222222222222222222222222222222",
				amountInRaw: "10000",
				toAddress: "0x000000000000000000000000000000000000dead",
			}),
		);
		expect(executed.details).toMatchObject({
			intentType: "evm.swap.pancakeV2",
			artifacts: {
				execute: {
					status: "submitted",
					txHash: `0x${"2".repeat(64)}`,
				},
			},
		});
	});

	it("accepts confirmToken from intent text in execute phase", async () => {
		const tool = getTool();
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap preview" }],
			details: {
				dryRun: true,
				pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
				amountOutRaw: "4960",
			},
		});
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap submitted" }],
			details: {
				dryRun: false,
				txHash: `0x${"2".repeat(64)}`,
			},
		});

		const simulated = await tool.execute("wf5t", {
			runId: "wf5t",
			runMode: "simulate",
			network: "bsc",
			tokenInAddress: "0x1111111111111111111111111111111111111111",
			tokenOutAddress: "0x2222222222222222222222222222222222222222",
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dead",
		});
		const details = simulated.details as { confirmToken: string };

		await tool.execute("wf5t", {
			runId: "wf5t",
			runMode: "execute",
			network: "bsc",
			confirmMainnet: true,
			intentText: `继续执行，确认主网执行，确认码: ${details.confirmToken}`,
		});

		expect(executeMocks.pancakeSwapExecute).toHaveBeenCalledTimes(2);
		expect(executeMocks.pancakeSwapExecute).toHaveBeenLastCalledWith(
			"wf-evm-swap-execute",
			expect.objectContaining({
				confirmMainnet: true,
				network: "bsc",
			}),
		);
	});

	it("supports follow-up execute intent text continuation", async () => {
		const tool = getTool();
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap preview" }],
			details: {
				dryRun: true,
				network: "bsc",
				pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
				amountOutRaw: "4960",
			},
		});
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap submitted" }],
			details: {
				dryRun: false,
				txHash: `0x${"2".repeat(64)}`,
			},
		});

		await tool.execute("wf5", {
			runId: "wf-evm-swap-5",
			intentText:
				"先模拟 amountInRaw=10000，把 0x1111111111111111111111111111111111111111 换到 0x2222222222222222222222222222222222222222，收款到 0x000000000000000000000000000000000000dead",
			network: "bsc",
		});

		await tool.execute("wf5", {
			runId: "wf-evm-swap-5",
			intentText: "继续执行刚才这笔，确认主网执行",
			confirmMainnet: true,
		});

		expect(executeMocks.pancakeSwapExecute).toHaveBeenCalledTimes(2);
	});

	it("auto-picks latest session for execute continuation without explicit runId", async () => {
		const tool = getTool();
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap preview" }],
			details: {
				dryRun: true,
				network: "bsc",
				pairAddress: "0x1111111111111111111111111111111111111111",
				amountOutRaw: "1111",
			},
		});
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap preview" }],
			details: {
				dryRun: true,
				network: "bsc",
				pairAddress: "0x2222222222222222222222222222222222222222",
				amountOutRaw: "2222",
			},
		});
		executeMocks.pancakeSwapExecute.mockResolvedValueOnce({
			content: [{ type: "text", text: "swap submitted" }],
			details: {
				dryRun: false,
				txHash: `0x${"f".repeat(64)}`,
			},
		});

		await tool.execute("wf-latest-a", {
			runMode: "simulate",
			network: "bsc",
			tokenInAddress: "0x1111111111111111111111111111111111111111",
			tokenOutAddress: "0x2222222222222222222222222222222222222222",
			amountInRaw: "10000",
			toAddress: "0x000000000000000000000000000000000000dead",
		});

		await tool.execute("wf-latest-b", {
			runMode: "simulate",
			network: "bsc",
			tokenInAddress: "0x2222222222222222222222222222222222222222",
			tokenOutAddress: "0x3333333333333333333333333333333333333333",
			amountInRaw: "20000",
			toAddress: "0x000000000000000000000000000000000000beef",
		});

		await tool.execute("wf-latest-exec", {
			runMode: "execute",
			network: "bsc",
			confirmMainnet: true,
		});

		expect(executeMocks.pancakeSwapExecute).toHaveBeenLastCalledWith(
			"wf-evm-swap-execute",
			expect.objectContaining({
				tokenInAddress: "0x2222222222222222222222222222222222222222",
				tokenOutAddress: "0x3333333333333333333333333333333333333333",
				amountInRaw: "20000",
				toAddress: "0x000000000000000000000000000000000000beef",
			}),
		);
	});
});
