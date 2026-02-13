import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	callNearRpc: vi.fn(),
	nearNetworkSchema: vi.fn(),
	parseNearNetwork: vi.fn(() => "mainnet"),
	resolveNearAccountId: vi.fn(
		(accountId?: string) => accountId ?? "alice.near",
	),
	toYoctoNear: vi.fn((value: string | number) =>
		typeof value === "number" ? BigInt(Math.round(value * 1_000_000)) : 1000n,
	),
}));

const executeMocks = vi.hoisted(() => ({
	transferNearExecute: vi.fn(),
	transferFtExecute: vi.fn(),
	swapRefExecute: vi.fn(),
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
		nearNetworkSchema: runtimeMocks.nearNetworkSchema,
		parseNearNetwork: runtimeMocks.parseNearNetwork,
		resolveNearAccountId: runtimeMocks.resolveNearAccountId,
		toYoctoNear: runtimeMocks.toYoctoNear,
	};
});

vi.mock("./execute.js", () => ({
	createNearExecuteTools: () => [
		{
			name: "near_transferNear",
			label: "near transfer",
			description: "near transfer",
			parameters: {},
			execute: executeMocks.transferNearExecute,
		},
		{
			name: "near_transferFt",
			label: "ft transfer",
			description: "ft transfer",
			parameters: {},
			execute: executeMocks.transferFtExecute,
		},
		{
			name: "near_swapRef",
			label: "ref swap",
			description: "ref swap",
			parameters: {},
			execute: executeMocks.swapRefExecute,
		},
	],
}));

vi.mock("../ref.js", () => ({
	getRefSwapQuote: refMocks.getRefSwapQuote,
}));

import { createNearWorkflowTools } from "./workflow.js";

type WorkflowTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(): WorkflowTool {
	const tool = createNearWorkflowTools().find(
		(entry) => entry.name === "w3rt_run_near_workflow_v0",
	);
	if (!tool) throw new Error("w3rt_run_near_workflow_v0 not found");
	return tool as unknown as WorkflowTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.parseNearNetwork.mockReturnValue("mainnet");
	runtimeMocks.resolveNearAccountId.mockImplementation(
		(accountId?: string) => accountId ?? "alice.near",
	);
	runtimeMocks.toYoctoNear.mockReturnValue(1000n);
	runtimeMocks.callNearRpc.mockResolvedValue({
		amount: "1000000",
		locked: "0",
		block_hash: "1111",
		block_height: 123,
	});
	executeMocks.transferNearExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			txHash: "near-exec-hash",
		},
	});
	executeMocks.transferFtExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			txHash: "near-exec-ft-hash",
		},
	});
	executeMocks.swapRefExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			txHash: "near-exec-swap-hash",
		},
	});
	refMocks.getRefSwapQuote.mockResolvedValue({
		refContractId: "v2.ref-finance.near",
		poolId: 3,
		tokenInId: "usdt.tether-token.near",
		tokenOutId: "usdc.fakes.near",
		amountInRaw: "1000000",
		amountOutRaw: "998000",
		minAmountOutRaw: "993010",
		feeBps: 30,
		source: "bestDirectSimplePool",
	});
});

describe("w3rt_run_near_workflow_v0", () => {
	it("analyzes near transfer from intentText and returns confirmToken", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-1", {
			runId: "wf-near-01",
			runMode: "analysis",
			network: "mainnet",
			intentText: "把 0.001 NEAR 转到 bob.near",
		});

		expect(result.content[0]?.text).toContain("Workflow analyzed");
		expect(result.details).toMatchObject({
			runId: "wf-near-01",
			intentType: "near.transfer.near",
			intent: {
				type: "near.transfer.near",
				toAccountId: "bob.near",
			},
		});
		expect(
			(result.details as { confirmToken?: string }).confirmToken?.startsWith(
				"NEAR-",
			),
		).toBe(true);
	});

	it("simulates native transfer and returns artifacts", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-2", {
			runId: "wf-near-02",
			runMode: "simulate",
			intentType: "near.transfer.near",
			network: "mainnet",
			toAccountId: "bob.near",
			amountYoctoNear: "1000",
		});

		expect(runtimeMocks.callNearRpc).toHaveBeenCalledWith({
			method: "query",
			network: "mainnet",
			rpcUrl: undefined,
			params: {
				account_id: "alice.near",
				finality: "final",
				request_type: "view_account",
			},
		});
		expect(result.content[0]?.text).toContain("Workflow simulated");
		expect(result.details).toMatchObject({
			intentType: "near.transfer.near",
			artifacts: {
				simulate: {
					status: "success",
				},
			},
		});
	});

	it("blocks mainnet execute when confirmMainnet is missing", async () => {
		const tool = getTool();
		await expect(
			tool.execute("near-wf-3", {
				runId: "wf-near-03",
				runMode: "execute",
				intentType: "near.transfer.near",
				network: "mainnet",
				toAccountId: "bob.near",
				amountYoctoNear: "1000",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(executeMocks.transferNearExecute).not.toHaveBeenCalled();
	});

	it("executes after confirmMainnet and correct confirmToken", async () => {
		const tool = getTool();
		const analysis = await tool.execute("near-wf-4-analysis", {
			runId: "wf-near-04",
			runMode: "analysis",
			intentType: "near.transfer.near",
			network: "mainnet",
			toAccountId: "bob.near",
			amountYoctoNear: "1000",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		const result = await tool.execute("near-wf-4-execute", {
			runId: "wf-near-04",
			runMode: "execute",
			intentType: "near.transfer.near",
			network: "mainnet",
			toAccountId: "bob.near",
			amountYoctoNear: "1000",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.transferNearExecute).toHaveBeenCalledTimes(1);
		expect(result.content[0]?.text).toContain("Workflow executed");
		expect(result.details).toMatchObject({
			intentType: "near.transfer.near",
			artifacts: {
				execute: {
					txHash: "near-exec-hash",
				},
			},
		});
	});

	it("supports natural follow-up execute using latest simulated session", async () => {
		const tool = getTool();
		const simulated = await tool.execute("near-wf-5-sim", {
			runId: "wf-near-05",
			runMode: "simulate",
			intentType: "near.transfer.near",
			network: "mainnet",
			toAccountId: "bob.near",
			amountYoctoNear: "1000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		const executed = await tool.execute("near-wf-5-exec", {
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.transferNearExecute).toHaveBeenCalledTimes(1);
		expect(executed.details).toMatchObject({
			intentType: "near.transfer.near",
			runId: "wf-near-05",
		});
	});

	it("simulates ref swap and returns quote artifact", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			block_hash: "4444",
			block_height: 321,
			logs: [],
			result: [...Buffer.from(JSON.stringify("1200000"), "utf8")],
		});
		const tool = getTool();
		const result = await tool.execute("near-wf-6", {
			runId: "wf-near-06",
			runMode: "simulate",
			intentType: "near.swap.ref",
			network: "mainnet",
			tokenInId: "usdt.tether-token.near",
			tokenOutId: "usdc.fakes.near",
			amountInRaw: "1000000",
		});

		expect(refMocks.getRefSwapQuote).toHaveBeenCalledTimes(1);
		expect(result.content[0]?.text).toContain("Workflow simulated");
		expect(result.details).toMatchObject({
			intentType: "near.swap.ref",
			artifacts: {
				simulate: {
					status: "success",
					quote: {
						poolId: 3,
					},
				},
			},
		});
	});

	it("executes ref swap after confirm token validation", async () => {
		const tool = getTool();
		const analysis = await tool.execute("near-wf-7-analysis", {
			runId: "wf-near-07",
			runMode: "analysis",
			intentType: "near.swap.ref",
			network: "mainnet",
			tokenInId: "usdt.tether-token.near",
			tokenOutId: "usdc.fakes.near",
			amountInRaw: "1000000",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		const result = await tool.execute("near-wf-7-execute", {
			runId: "wf-near-07",
			runMode: "execute",
			network: "mainnet",
			tokenInId: "usdt.tether-token.near",
			tokenOutId: "usdc.fakes.near",
			amountInRaw: "1000000",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.swapRefExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				tokenInId: "usdt.tether-token.near",
				tokenOutId: "usdc.fakes.near",
				amountInRaw: "1000000",
				confirmMainnet: true,
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "near.swap.ref",
			artifacts: {
				execute: {
					txHash: "near-exec-swap-hash",
				},
			},
		});
	});
});
