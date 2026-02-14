import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMocks = vi.hoisted(() => ({
	transferNativeExecute: vi.fn(),
	transferErc20Execute: vi.fn(),
}));

vi.mock("./execute.js", () => ({
	createEvmExecuteTools: () => [
		{
			name: "evm_transferNative",
			label: "transfer native",
			description: "transfer native",
			parameters: {},
			execute: executeMocks.transferNativeExecute,
		},
		{
			name: "evm_transferErc20",
			label: "transfer erc20",
			description: "transfer erc20",
			parameters: {},
			execute: executeMocks.transferErc20Execute,
		},
	],
}));

import { createEvmTransferWorkflowTools } from "./transfer-workflow.js";

type WorkflowTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(): WorkflowTool {
	const tool = createEvmTransferWorkflowTools().find(
		(entry) => entry.name === "w3rt_run_evm_transfer_workflow_v0",
	);
	if (!tool) throw new Error("w3rt_run_evm_transfer_workflow_v0 not found");
	return tool as unknown as WorkflowTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	executeMocks.transferNativeExecute.mockResolvedValue({
		content: [{ type: "text", text: "native ok" }],
		details: { txHash: `0x${"1".repeat(64)}` },
	});
	executeMocks.transferErc20Execute.mockResolvedValue({
		content: [{ type: "text", text: "erc20 ok" }],
		details: { txHash: `0x${"2".repeat(64)}` },
	});
});

describe("w3rt_run_evm_transfer_workflow_v0", () => {
	it("analyzes native transfer and returns confirm token", async () => {
		const tool = getTool();
		const result = await tool.execute("wf1", {
			runId: "wf-evm-transfer-1",
			runMode: "analysis",
			network: "polygon",
			intentText:
				"给 0x000000000000000000000000000000000000dEaD 转 0.001 MATIC，先分析",
		});
		expect(result.content[0]?.text).toContain("Workflow analyzed");
		expect(result.details).toMatchObject({
			runId: "wf-evm-transfer-1",
			intentType: "evm.transfer.native",
			needsMainnetConfirmation: true,
			confirmToken: expect.stringMatching(/^EVM-/),
		});
	});

	it("simulates native transfer via execute tool dryRun", async () => {
		const tool = getTool();
		const result = await tool.execute("wf2", {
			runId: "wf-evm-transfer-2",
			runMode: "simulate",
			network: "polygon",
			toAddress: "0x000000000000000000000000000000000000dEaD",
			amountNative: 0.01,
		});
		expect(result.content[0]?.text).toContain("Workflow simulated");
		expect(executeMocks.transferNativeExecute).toHaveBeenCalledWith(
			"wf-evm-transfer-simulate",
			expect.objectContaining({
				network: "polygon",
				dryRun: true,
				toAddress: "0x000000000000000000000000000000000000dEaD",
				amountNative: 0.01,
			}),
		);
	});

	it("blocks execute without mainnet confirmation", async () => {
		const tool = getTool();
		await expect(
			tool.execute("wf3", {
				runId: "wf-evm-transfer-3",
				runMode: "execute",
				network: "polygon",
				toAddress: "0x000000000000000000000000000000000000dEaD",
				amountNative: 0.001,
			}),
		).rejects.toThrow("Mainnet execute blocked");
	});

	it("executes native transfer with confirm token", async () => {
		const tool = getTool();
		const simulated = await tool.execute("wf4-sim", {
			runId: "wf-evm-transfer-4",
			runMode: "simulate",
			network: "polygon",
			toAddress: "0x000000000000000000000000000000000000dEaD",
			amountNative: 0.001,
		});
		const details = simulated.details as { confirmToken: string };
		const executed = await tool.execute("wf4-exec", {
			runId: "wf-evm-transfer-4",
			runMode: "execute",
			network: "polygon",
			confirmMainnet: true,
			confirmToken: details.confirmToken,
		});

		expect(executeMocks.transferNativeExecute).toHaveBeenCalledWith(
			"wf-evm-transfer-execute",
			expect.objectContaining({
				network: "polygon",
				dryRun: false,
				confirmMainnet: true,
			}),
		);
		expect(executed.details).toMatchObject({
			intentType: "evm.transfer.native",
			artifacts: {
				execute: {
					status: "submitted",
					txHash: `0x${"1".repeat(64)}`,
				},
			},
		});
	});

	it("simulates erc20 transfer intent", async () => {
		const tool = getTool();
		const result = await tool.execute("wf5", {
			runMode: "simulate",
			network: "polygon",
			intentType: "evm.transfer.erc20",
			tokenAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
			toAddress: "0x000000000000000000000000000000000000dEaD",
			amountRaw: "1000000",
		});
		expect(executeMocks.transferErc20Execute).toHaveBeenCalledWith(
			"wf-evm-transfer-simulate",
			expect.objectContaining({
				dryRun: true,
				tokenAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
				amountRaw: "1000000",
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "evm.transfer.erc20",
		});
	});

	it("parses symbol-based erc20 transfer from intentText", async () => {
		const tool = getTool();
		const result = await tool.execute("wf6", {
			runMode: "simulate",
			network: "polygon",
			intentText:
				"把 1.25 USDC 转给 0x000000000000000000000000000000000000dEaD，先模拟",
		});
		expect(executeMocks.transferErc20Execute).toHaveBeenCalledWith(
			"wf-evm-transfer-simulate",
			expect.objectContaining({
				dryRun: true,
				tokenAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
				amountRaw: "1250000",
				toAddress: "0x000000000000000000000000000000000000dEaD",
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "evm.transfer.erc20",
			intent: {
				tokenSymbol: "USDC",
				amountRaw: "1250000",
			},
		});
	});

	it("resolves symbol-based erc20 transfer on base network", async () => {
		const tool = getTool();
		await tool.execute("wf7", {
			runMode: "simulate",
			network: "base",
			intentText:
				"把 2.5 USDC 转给 0x000000000000000000000000000000000000dEaD，先模拟",
		});
		expect(executeMocks.transferErc20Execute).toHaveBeenCalledWith(
			"wf-evm-transfer-simulate",
			expect.objectContaining({
				network: "base",
				dryRun: true,
				tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
				amountRaw: "2500000",
			}),
		);
	});

	it("fails when symbol has no configured address on selected network", async () => {
		const tool = getTool();
		await expect(
			tool.execute("wf8", {
				runMode: "simulate",
				network: "base",
				intentText:
					"把 1 USDT 转给 0x000000000000000000000000000000000000dEaD，先模拟",
			}),
		).rejects.toThrow(
			"No known USDT address configured for network=base. Provide tokenAddress explicitly.",
		);
	});
});
