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
	addLiquidityRefExecute: vi.fn(),
	removeLiquidityRefExecute: vi.fn(),
}));

const refMocks = vi.hoisted(() => ({
	fetchRefPoolById: vi.fn(),
	getRefContractId: vi.fn(() => "v2.ref-finance.near"),
	getRefSwapQuote: vi.fn(),
	getRefTokenDecimalsHint: vi.fn(),
	resolveRefTokenIds: vi.fn(),
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
		{
			name: "near_addLiquidityRef",
			label: "ref add liquidity",
			description: "ref add liquidity",
			parameters: {},
			execute: executeMocks.addLiquidityRefExecute,
		},
		{
			name: "near_removeLiquidityRef",
			label: "ref remove liquidity",
			description: "ref remove liquidity",
			parameters: {},
			execute: executeMocks.removeLiquidityRefExecute,
		},
	],
}));

vi.mock("../ref.js", () => ({
	fetchRefPoolById: refMocks.fetchRefPoolById,
	getRefContractId: refMocks.getRefContractId,
	getRefSwapQuote: refMocks.getRefSwapQuote,
	getRefTokenDecimalsHint: refMocks.getRefTokenDecimalsHint,
	resolveRefTokenIds: refMocks.resolveRefTokenIds,
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

function encodeJsonResult(value: unknown): number[] {
	return [...Buffer.from(JSON.stringify(value), "utf8")];
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
	executeMocks.addLiquidityRefExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			txHash: "near-exec-add-liquidity-hash",
		},
	});
	executeMocks.removeLiquidityRefExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			txHash: "near-exec-remove-liquidity-hash",
		},
	});
	refMocks.getRefContractId.mockReturnValue("v2.ref-finance.near");
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
	refMocks.getRefTokenDecimalsHint.mockImplementation(
		({
			tokenIdOrSymbol,
		}: {
			tokenIdOrSymbol: string;
		}) => {
			const normalized = tokenIdOrSymbol.toLowerCase();
			if (normalized === "usdc" || normalized === "usdt") {
				return 6;
			}
			if (
				normalized === "near" ||
				normalized === "wnear" ||
				normalized.includes("wrap.near")
			) {
				return 24;
			}
			return null;
		},
	);
	refMocks.fetchRefPoolById.mockResolvedValue({
		id: 7,
		token_account_ids: ["wrap.near", "usdc.tether-token.near"],
		amounts: ["1", "1"],
		total_fee: 30,
		pool_kind: "SIMPLE_POOL",
	});
	refMocks.resolveRefTokenIds.mockImplementation(
		({
			tokenIdOrSymbol,
			availableTokenIds,
		}: {
			tokenIdOrSymbol: string;
			availableTokenIds?: string[];
		}) => {
			const normalized = tokenIdOrSymbol.toLowerCase();
			const candidates =
				availableTokenIds?.map((tokenId) => tokenId.toLowerCase()) ?? [];
			if (normalized === "near" || normalized === "wnear") {
				return candidates.filter((tokenId) => tokenId.includes("wrap."));
			}
			if (normalized === "usdc") {
				return candidates.filter((tokenId) => tokenId.includes("usdc"));
			}
			return candidates.filter((tokenId) => tokenId === normalized);
		},
	);
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
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "4444",
				block_height: 321,
				logs: [],
				result: [...Buffer.from(JSON.stringify("1200000"), "utf8")],
			})
			.mockResolvedValueOnce({
				block_hash: "4445",
				block_height: 322,
				logs: [],
				result: [...Buffer.from(JSON.stringify({ total: "1" }), "utf8")],
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
					storageRegistration: {
						status: "registered",
					},
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
				autoRegisterOutput: true,
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

	it("parses natural-language near/usdc swap amount", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-8", {
			runId: "wf-near-08",
			runMode: "analysis",
			network: "mainnet",
			intentText: "把 0.01 NEAR 换成 USDC，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.swap.ref",
			intent: {
				type: "near.swap.ref",
				tokenInId: "NEAR",
				tokenOutId: "USDC",
				amountInRaw: "10000000000000000000000",
			},
		});
	});

	it("parses natural-language ref lp add intent", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-9", {
			runId: "wf-near-09",
			runMode: "analysis",
			network: "mainnet",
			intentText:
				"在 Ref 添加 LP，pool 7，tokenA NEAR amountA 0.01，tokenB USDC amountB 1.2，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.add",
			intent: {
				type: "near.lp.ref.add",
				poolId: 7,
				tokenAId: "NEAR",
				tokenBId: "USDC",
				amountARaw: "10000000000000000000000",
				amountBRaw: "1200000",
			},
		});
	});

	it("simulates ref lp add and returns balance/storage artifacts", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "501",
				block_height: 501,
				logs: [],
				result: encodeJsonResult("20000000000000000000000"),
			})
			.mockResolvedValueOnce({
				block_hash: "502",
				block_height: 502,
				logs: [],
				result: encodeJsonResult("5000000"),
			})
			.mockResolvedValueOnce({
				block_hash: "503",
				block_height: 503,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			})
			.mockResolvedValueOnce({
				block_hash: "504",
				block_height: 504,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			})
			.mockResolvedValueOnce({
				block_hash: "505",
				block_height: 505,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			});
		const tool = getTool();
		const result = await tool.execute("near-wf-10", {
			runId: "wf-near-10",
			runMode: "simulate",
			intentType: "near.lp.ref.add",
			network: "mainnet",
			poolId: 7,
			tokenAId: "NEAR",
			tokenBId: "USDC",
			amountARaw: "10000000000000000000000",
			amountBRaw: "1200000",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.add",
			artifacts: {
				simulate: {
					status: "success",
					poolId: 7,
					tokenAId: "wrap.near",
					tokenBId: "usdc.tether-token.near",
				},
			},
		});
	});

	it("executes ref lp add after confirm token validation", async () => {
		const tool = getTool();
		const analysis = await tool.execute("near-wf-11-analysis", {
			runId: "wf-near-11",
			runMode: "analysis",
			intentType: "near.lp.ref.add",
			network: "mainnet",
			poolId: 7,
			amountARaw: "10000000000000000000000",
			amountBRaw: "1200000",
			tokenAId: "NEAR",
			tokenBId: "USDC",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		const result = await tool.execute("near-wf-11-execute", {
			runId: "wf-near-11",
			runMode: "execute",
			network: "mainnet",
			poolId: 7,
			amountARaw: "10000000000000000000000",
			amountBRaw: "1200000",
			tokenAId: "NEAR",
			tokenBId: "USDC",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.addLiquidityRefExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				poolId: 7,
				amountARaw: "10000000000000000000000",
				amountBRaw: "1200000",
				tokenAId: "NEAR",
				tokenBId: "USDC",
				autoRegisterExchange: true,
				autoRegisterTokens: true,
				confirmMainnet: true,
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.add",
			artifacts: {
				execute: {
					txHash: "near-exec-add-liquidity-hash",
				},
			},
		});
	});

	it("executes ref lp remove after confirm token validation", async () => {
		const tool = getTool();
		const analysis = await tool.execute("near-wf-12-analysis", {
			runId: "wf-near-12",
			runMode: "analysis",
			intentType: "near.lp.ref.remove",
			network: "mainnet",
			poolId: 7,
			shares: "100000",
			minAmountARaw: "1",
			minAmountBRaw: "2",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		const result = await tool.execute("near-wf-12-execute", {
			runId: "wf-near-12",
			runMode: "execute",
			network: "mainnet",
			poolId: 7,
			shares: "100000",
			minAmountARaw: "1",
			minAmountBRaw: "2",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.removeLiquidityRefExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				poolId: 7,
				shares: "100000",
				minAmountARaw: "1",
				minAmountBRaw: "2",
				confirmMainnet: true,
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.remove",
			artifacts: {
				execute: {
					txHash: "near-exec-remove-liquidity-hash",
				},
			},
		});
	});
});
