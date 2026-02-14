import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	withdrawRefTokenExecute: vi.fn(),
	submitIntentsDepositExecute: vi.fn(),
	addLiquidityRefExecute: vi.fn(),
	removeLiquidityRefExecute: vi.fn(),
}));

const composeMocks = vi.hoisted(() => ({
	buildTransferNearCompose: vi.fn(),
	buildTransferFtCompose: vi.fn(),
	buildRefWithdrawCompose: vi.fn(),
}));

const fetchMock = vi.hoisted(() => vi.fn());

const refMocks = vi.hoisted(() => ({
	fetchRefPoolById: vi.fn(),
	findRefPoolForPair: vi.fn(),
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
			name: "near_withdrawRefToken",
			label: "ref withdraw",
			description: "ref withdraw",
			parameters: {},
			execute: executeMocks.withdrawRefTokenExecute,
		},
		{
			name: "near_submitIntentsDeposit",
			label: "intents submit",
			description: "intents submit",
			parameters: {},
			execute: executeMocks.submitIntentsDepositExecute,
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

vi.mock("./compose.js", () => ({
	createNearComposeTools: () => [
		{
			name: "near_buildTransferNearTransaction",
			label: "compose near transfer",
			description: "compose near transfer",
			parameters: {},
			execute: composeMocks.buildTransferNearCompose,
		},
		{
			name: "near_buildTransferFtTransaction",
			label: "compose ft transfer",
			description: "compose ft transfer",
			parameters: {},
			execute: composeMocks.buildTransferFtCompose,
		},
		{
			name: "near_buildRefWithdrawTransaction",
			label: "compose ref withdraw",
			description: "compose ref withdraw",
			parameters: {},
			execute: composeMocks.buildRefWithdrawCompose,
		},
	],
}));

vi.mock("../ref.js", () => ({
	fetchRefPoolById: refMocks.fetchRefPoolById,
	findRefPoolForPair: refMocks.findRefPoolForPair,
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

function mockFetchJsonOnce(params: {
	status: number;
	body: unknown;
	statusText?: string;
}) {
	fetchMock.mockResolvedValueOnce({
		ok: params.status >= 200 && params.status < 300,
		status: params.status,
		statusText:
			params.statusText ??
			(params.status >= 200 && params.status < 300 ? "OK" : "Bad Request"),
		text: vi.fn().mockResolvedValue(JSON.stringify(params.body)),
	} as unknown as Response);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
	Reflect.deleteProperty(process.env, "NEAR_SWAP_MAX_SLIPPAGE_BPS");
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
	executeMocks.withdrawRefTokenExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			txHash: "near-exec-withdraw-hash",
		},
	});
	executeMocks.submitIntentsDepositExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			correlationId: "corr-exec-1",
			status: "PENDING_DEPOSIT",
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
	composeMocks.buildTransferNearCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-transfer-near",
		},
	});
	composeMocks.buildTransferFtCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-transfer-ft",
		},
	});
	composeMocks.buildRefWithdrawCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-ref-withdraw",
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
	refMocks.findRefPoolForPair.mockResolvedValue({
		refContractId: "v2.ref-finance.near",
		poolId: 7,
		poolKind: "SIMPLE_POOL",
		tokenAId: "wrap.near",
		tokenBId: "usdc.tether-token.near",
		liquidityScore: "1",
		source: "bestLiquidityPool",
		candidates: [
			{
				poolId: 7,
				poolKind: "SIMPLE_POOL",
				tokenAId: "wrap.near",
				tokenBId: "usdc.tether-token.near",
				liquidityScore: "1",
			},
			{
				poolId: 8,
				poolKind: "SIMPLE_POOL",
				tokenAId: "wrap.near",
				tokenBId: "usdc.tether-token.near",
				liquidityScore: "0",
			},
		],
		pool: {
			id: 7,
			token_account_ids: ["wrap.near", "usdc.tether-token.near"],
			amounts: ["1", "1"],
			total_fee: 30,
			pool_kind: "SIMPLE_POOL",
		},
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

afterEach(() => {
	vi.unstubAllGlobals();
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

	it("composes near transfer and returns unsigned payload artifact", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-1-compose", {
			runId: "wf-near-01-compose",
			runMode: "compose",
			network: "mainnet",
			intentType: "near.transfer.near",
			toAccountId: "bob.near",
			amountYoctoNear: "1000",
			publicKey: "ed25519:11111111111111111111111111111111",
		});

		expect(composeMocks.buildTransferNearCompose).toHaveBeenCalledWith(
			"near-wf-compose",
			expect.objectContaining({
				toAccountId: "bob.near",
				amountYoctoNear: "1000",
				network: "mainnet",
				publicKey: "ed25519:11111111111111111111111111111111",
			}),
		);
		expect(result.content[0]?.text).toContain("Workflow composed");
		expect(result.details).toMatchObject({
			runMode: "compose",
			intentType: "near.transfer.near",
			approvalRequired: false,
			artifacts: {
				compose: {
					unsignedPayload: "near-compose-transfer-near",
				},
			},
		});
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

	it("supports follow-up execute by intentText without re-sending structured params", async () => {
		const tool = getTool();
		const simulated = await tool.execute("near-wf-5b-sim", {
			runId: "wf-near-05b",
			runMode: "simulate",
			intentType: "near.transfer.near",
			network: "mainnet",
			toAccountId: "bob.near",
			amountYoctoNear: "1000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		await tool.execute("near-wf-5b-exec", {
			runMode: "execute",
			intentText: "继续执行刚才那笔",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.transferNearExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				toAccountId: "bob.near",
				amountYoctoNear: "1000",
				confirmMainnet: true,
			}),
		);
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

	it("blocks analysis when swap slippage exceeds configured safety limit", async () => {
		process.env.NEAR_SWAP_MAX_SLIPPAGE_BPS = "100";
		const tool = getTool();
		await expect(
			tool.execute("near-wf-8b", {
				runId: "wf-near-08b",
				runMode: "analysis",
				network: "mainnet",
				intentType: "near.swap.ref",
				tokenInId: "usdt.tether-token.near",
				tokenOutId: "usdc.fakes.near",
				amountInRaw: "1000000",
				slippageBps: 150,
			}),
		).rejects.toThrow("configured safety limit");
	});

	it("blocks simulate when minAmountOutRaw is below safe quote minimum", async () => {
		const tool = getTool();
		await expect(
			tool.execute("near-wf-8c", {
				runId: "wf-near-08c",
				runMode: "simulate",
				network: "mainnet",
				intentType: "near.swap.ref",
				tokenInId: "usdt.tether-token.near",
				tokenOutId: "usdc.fakes.near",
				amountInRaw: "1000000",
				minAmountOutRaw: "990000",
			}),
		).rejects.toThrow("below safe minimum");
	});

	it("parses natural-language intents swap intent", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-8d", {
			runId: "wf-near-08d",
			runMode: "analysis",
			network: "mainnet",
			intentText: "通过 intents 把 NEAR 换成 USDC，amountRaw 1000000，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			intent: {
				type: "near.swap.intents",
				originAsset: "NEAR",
				destinationAsset: "USDC",
				amount: "1000000",
			},
		});
	});

	it("parses natural-language ref withdraw intent", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-8d2", {
			runId: "wf-near-8d2",
			runMode: "analysis",
			network: "mainnet",
			intentText: "在 Ref 把 USDC 全部提回钱包，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.ref.withdraw",
			intent: {
				type: "near.ref.withdraw",
				tokenId: "USDC",
				withdrawAll: true,
			},
		});
	});

	it("simulates ref withdraw and returns deposit/storage artifacts", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "4446",
				block_height: 323,
				logs: [],
				result: encodeJsonResult({
					"usdc.tether-token.near": "1200000",
					"wrap.near": "10000000000000000000000",
				}),
			})
			.mockResolvedValueOnce({
				block_hash: "4447",
				block_height: 324,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			});
		const tool = getTool();
		const result = await tool.execute("near-wf-8d3", {
			runId: "wf-near-8d3",
			runMode: "simulate",
			intentType: "near.ref.withdraw",
			network: "mainnet",
			tokenId: "USDC",
			amountRaw: "1000000",
		});

		expect(result.details).toMatchObject({
			intentType: "near.ref.withdraw",
			artifacts: {
				simulate: {
					status: "success",
					tokenId: "usdc.tether-token.near",
					depositBeforeRaw: "1200000",
					requiredRaw: "1000000",
					storageRegistration: {
						status: "registered",
					},
				},
			},
		});
	});

	it("executes ref withdraw after confirm token validation", async () => {
		const tool = getTool();
		const analysis = await tool.execute("near-wf-8d4-analysis", {
			runId: "wf-near-8d4",
			runMode: "analysis",
			intentType: "near.ref.withdraw",
			network: "mainnet",
			tokenId: "usdc.tether-token.near",
			amountRaw: "1000000",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		const result = await tool.execute("near-wf-8d4-execute", {
			runId: "wf-near-8d4",
			runMode: "execute",
			intentType: "near.ref.withdraw",
			network: "mainnet",
			tokenId: "usdc.tether-token.near",
			amountRaw: "1000000",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.withdrawRefTokenExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				tokenId: "usdc.tether-token.near",
				amountRaw: "1000000",
				confirmMainnet: true,
				network: "mainnet",
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "near.ref.withdraw",
			artifacts: {
				execute: {
					txHash: "near-exec-withdraw-hash",
				},
			},
		});
	});

	it("simulates intents swap and returns quote/deposit artifact", async () => {
		mockFetchJsonOnce({
			status: 200,
			body: [
				{
					assetId: "near:wrap.near",
					decimals: 24,
					blockchain: "near",
					symbol: "NEAR",
					price: 4.2,
					priceUpdatedAt: "2026-02-13T00:00:00Z",
				},
				{
					assetId: "near:usdc.tether-token.near",
					decimals: 6,
					blockchain: "near",
					symbol: "USDC",
					price: 1,
					priceUpdatedAt: "2026-02-13T00:00:00Z",
				},
			],
		});
		mockFetchJsonOnce({
			status: 201,
			body: {
				correlationId: "corr-sim-1",
				timestamp: "2026-02-13T00:00:00Z",
				signature: "sig-1",
				quoteRequest: {
					dry: true,
				},
				quote: {
					depositAddress: "0xnear-deposit-1",
					depositMemo: "memo-1",
					amountIn: "10000000000000000000000",
					amountInFormatted: "0.01",
					amountInUsd: "0.042",
					minAmountIn: "10000000000000000000000",
					amountOut: "41871",
					amountOutFormatted: "0.041871",
					amountOutUsd: "0.041871",
					minAmountOut: "40000",
					timeEstimate: 22,
				},
			},
		});
		const tool = getTool();
		const result = await tool.execute("near-wf-8e", {
			runId: "wf-near-08e",
			runMode: "simulate",
			intentType: "near.swap.intents",
			network: "mainnet",
			originAsset: "NEAR",
			destinationAsset: "USDC",
			amountRaw: "10000000000000000000000",
		});

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"https://1click.chaindefuser.com/v0/tokens",
			expect.objectContaining({
				method: "GET",
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"https://1click.chaindefuser.com/v0/quote",
			expect.objectContaining({
				method: "POST",
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			intent: {
				type: "near.swap.intents",
				originAsset: "near:wrap.near",
				destinationAsset: "near:usdc.tether-token.near",
				depositAddress: "0xnear-deposit-1",
				depositMemo: "memo-1",
			},
			artifacts: {
				simulate: {
					status: "success",
					originAssetId: "near:wrap.near",
					destinationAssetId: "near:usdc.tether-token.near",
					quoteResponse: {
						correlationId: "corr-sim-1",
					},
				},
			},
		});
	});

	it("executes intents swap submit with txHash after confirm token validation", async () => {
		mockFetchJsonOnce({
			status: 200,
			body: [
				{
					assetId: "near:wrap.near",
					decimals: 24,
					blockchain: "near",
					symbol: "NEAR",
					price: 4.2,
					priceUpdatedAt: "2026-02-13T00:00:00Z",
				},
				{
					assetId: "near:usdc.tether-token.near",
					decimals: 6,
					blockchain: "near",
					symbol: "USDC",
					price: 1,
					priceUpdatedAt: "2026-02-13T00:00:00Z",
				},
			],
		});
		mockFetchJsonOnce({
			status: 201,
			body: {
				correlationId: "corr-sim-2",
				timestamp: "2026-02-13T00:00:00Z",
				signature: "sig-2",
				quoteRequest: { dry: true },
				quote: {
					depositAddress: "0xnear-deposit-2",
					depositMemo: "memo-2",
					amountIn: "10000000000000000000000",
					amountInFormatted: "0.01",
					amountInUsd: "0.042",
					minAmountIn: "10000000000000000000000",
					amountOut: "41871",
					amountOutFormatted: "0.041871",
					amountOutUsd: "0.041871",
					minAmountOut: "40000",
					timeEstimate: 22,
				},
			},
		});
		const tool = getTool();
		const simulated = await tool.execute("near-wf-8f-sim", {
			runId: "wf-near-08f",
			runMode: "simulate",
			intentType: "near.swap.intents",
			network: "mainnet",
			originAsset: "NEAR",
			destinationAsset: "USDC",
			amountRaw: "10000000000000000000000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		mockFetchJsonOnce({
			status: 200,
			body: {
				correlationId: "corr-sim-2",
				status: "SUCCESS",
				updatedAt: "2026-02-13T00:00:05Z",
				quoteResponse: {
					correlationId: "corr-sim-2",
					timestamp: "2026-02-13T00:00:00Z",
					signature: "sig-2",
					quoteRequest: { dry: true },
					quote: {
						depositAddress: "0xnear-deposit-2",
						amountIn: "10000000000000000000000",
						amountInFormatted: "0.01",
						amountInUsd: "0.042",
						minAmountIn: "10000000000000000000000",
						amountOut: "41871",
						amountOutFormatted: "0.041871",
						amountOutUsd: "0.041871",
						minAmountOut: "40000",
						timeEstimate: 22,
					},
				},
				swapDetails: {
					amountIn: "10000000000000000000000",
					amountOut: "41871",
				},
			},
		});
		const result = await tool.execute("near-wf-8f-exec", {
			runId: "wf-near-08f",
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
			txHash: "0xfeedbeef",
		});

		expect(executeMocks.submitIntentsDepositExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				txHash: "0xfeedbeef",
				depositAddress: "0xnear-deposit-2",
				depositMemo: "memo-2",
				confirmMainnet: true,
				network: "mainnet",
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			artifacts: {
				execute: {
					correlationId: "corr-exec-1",
					status: "PENDING_DEPOSIT",
					statusTracking: {
						timedOut: false,
						latestStatus: {
							status: "SUCCESS",
						},
					},
				},
			},
		});
	});

	it("supports intents execute without status polling when disabled", async () => {
		mockFetchJsonOnce({
			status: 200,
			body: [
				{
					assetId: "near:wrap.near",
					decimals: 24,
					blockchain: "near",
					symbol: "NEAR",
					price: 4.2,
					priceUpdatedAt: "2026-02-13T00:00:00Z",
				},
				{
					assetId: "near:usdc.tether-token.near",
					decimals: 6,
					blockchain: "near",
					symbol: "USDC",
					price: 1,
					priceUpdatedAt: "2026-02-13T00:00:00Z",
				},
			],
		});
		mockFetchJsonOnce({
			status: 201,
			body: {
				correlationId: "corr-sim-2b",
				timestamp: "2026-02-13T00:00:00Z",
				signature: "sig-2b",
				quoteRequest: { dry: true },
				quote: {
					depositAddress: "0xnear-deposit-2b",
					depositMemo: "memo-2b",
					amountIn: "10000000000000000000000",
					amountInFormatted: "0.01",
					amountInUsd: "0.042",
					minAmountIn: "10000000000000000000000",
					amountOut: "41871",
					amountOutFormatted: "0.041871",
					amountOutUsd: "0.041871",
					minAmountOut: "40000",
					timeEstimate: 22,
				},
			},
		});
		const tool = getTool();
		const simulated = await tool.execute("near-wf-8f2-sim", {
			runId: "wf-near-08f2",
			runMode: "simulate",
			intentType: "near.swap.intents",
			network: "mainnet",
			originAsset: "NEAR",
			destinationAsset: "USDC",
			amountRaw: "10000000000000000000000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		const result = await tool.execute("near-wf-8f2-exec", {
			runId: "wf-near-08f2",
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
			txHash: "0xfeedbeef2",
			waitForFinalStatus: false,
		});

		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			artifacts: {
				execute: {
					correlationId: "corr-exec-1",
					statusTracking: null,
				},
			},
		});
	});

	it("requires txHash for intents execute", async () => {
		mockFetchJsonOnce({
			status: 200,
			body: [
				{
					assetId: "near:wrap.near",
					decimals: 24,
					blockchain: "near",
					symbol: "NEAR",
					price: 4.2,
					priceUpdatedAt: "2026-02-13T00:00:00Z",
				},
				{
					assetId: "near:usdc.tether-token.near",
					decimals: 6,
					blockchain: "near",
					symbol: "USDC",
					price: 1,
					priceUpdatedAt: "2026-02-13T00:00:00Z",
				},
			],
		});
		mockFetchJsonOnce({
			status: 201,
			body: {
				correlationId: "corr-sim-3",
				timestamp: "2026-02-13T00:00:00Z",
				signature: "sig-3",
				quoteRequest: { dry: true },
				quote: {
					depositAddress: "0xnear-deposit-3",
					amountIn: "10000000000000000000000",
					amountInFormatted: "0.01",
					amountInUsd: "0.042",
					minAmountIn: "10000000000000000000000",
					amountOut: "41871",
					amountOutFormatted: "0.041871",
					amountOutUsd: "0.041871",
					minAmountOut: "40000",
					timeEstimate: 22,
				},
			},
		});
		const tool = getTool();
		const simulated = await tool.execute("near-wf-8g-sim", {
			runId: "wf-near-08g",
			runMode: "simulate",
			intentType: "near.swap.intents",
			network: "mainnet",
			originAsset: "NEAR",
			destinationAsset: "USDC",
			amountRaw: "10000000000000000000000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		await expect(
			tool.execute("near-wf-8g-exec", {
				runId: "wf-near-08g",
				runMode: "execute",
				confirmMainnet: true,
				confirmToken: token,
			}),
		).rejects.toThrow("requires txHash");
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

	it("parses natural-language ref lp add intent without explicit poolId", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-9b", {
			runId: "wf-near-09b",
			runMode: "analysis",
			network: "mainnet",
			intentText:
				"在 Ref 添加 LP，NEAR/USDC，amountA 0.01，amountB 1.2，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.add",
			intent: {
				type: "near.lp.ref.add",
				tokenAId: "NEAR",
				tokenBId: "USDC",
				amountARaw: "10000000000000000000000",
				amountBRaw: "1200000",
			},
		});
	});

	it("parses natural-language ref lp add intent with token amounts", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-9c", {
			runId: "wf-near-09c",
			runMode: "analysis",
			network: "mainnet",
			intentText:
				"在 Ref 添加 LP，NEAR/USDC，投入 0.01 NEAR 和 1.2 USDC，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.add",
			intent: {
				type: "near.lp.ref.add",
				tokenAId: "NEAR",
				tokenBId: "USDC",
				amountARaw: "10000000000000000000000",
				amountBRaw: "1200000",
			},
		});
	});

	it("infers lp token pair from token amounts when pair text is omitted", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-9d", {
			runId: "wf-near-09d",
			runMode: "analysis",
			network: "mainnet",
			intentText: "在 Ref 添加 LP，投入 0.02 NEAR 和 2 USDC，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.add",
			intent: {
				type: "near.lp.ref.add",
				tokenAId: "NEAR",
				tokenBId: "USDC",
				amountARaw: "20000000000000000000000",
				amountBRaw: "2000000",
			},
		});
	});

	it("returns clear error when lp add only provides one side amount", async () => {
		const tool = getTool();
		await expect(
			tool.execute("near-wf-9e", {
				runId: "wf-near-09e",
				runMode: "analysis",
				network: "mainnet",
				intentText: "在 Ref 添加 LP，USDC/NEAR，把 1 NEAR 加到 LP，先分析",
			}),
		).rejects.toThrow("Missing amountARaw");
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
					poolSelectionSource: "explicitPool",
					tokenAId: "wrap.near",
					tokenBId: "usdc.tether-token.near",
				},
			},
		});
	});

	it("simulates ref lp add without poolId and reuses resolved pool on execute", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "601",
				block_height: 601,
				logs: [],
				result: encodeJsonResult("20000000000000000000000"),
			})
			.mockResolvedValueOnce({
				block_hash: "602",
				block_height: 602,
				logs: [],
				result: encodeJsonResult("5000000"),
			})
			.mockResolvedValueOnce({
				block_hash: "603",
				block_height: 603,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			})
			.mockResolvedValueOnce({
				block_hash: "604",
				block_height: 604,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			})
			.mockResolvedValueOnce({
				block_hash: "605",
				block_height: 605,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			});
		const tool = getTool();
		const simulated = await tool.execute("near-wf-10b-sim", {
			runId: "wf-near-10b",
			runMode: "simulate",
			intentType: "near.lp.ref.add",
			network: "mainnet",
			tokenAId: "NEAR",
			tokenBId: "USDC",
			amountARaw: "10000000000000000000000",
			amountBRaw: "1200000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;

		expect(refMocks.findRefPoolForPair).toHaveBeenCalledWith({
			network: "mainnet",
			rpcUrl: undefined,
			refContractId: "v2.ref-finance.near",
			tokenAId: "NEAR",
			tokenBId: "USDC",
		});
		expect(simulated.details).toMatchObject({
			intentType: "near.lp.ref.add",
			intent: {
				type: "near.lp.ref.add",
				poolId: 7,
			},
			artifacts: {
				simulate: {
					poolId: 7,
					poolSelectionSource: "bestLiquidityPool",
					poolCandidates: [
						{
							poolId: 7,
						},
						{
							poolId: 8,
						},
					],
				},
			},
		});
		expect(simulated.content[0]?.text).toContain("alternatives=8");

		await tool.execute("near-wf-10b-exec", {
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.addLiquidityRefExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				poolId: 7,
				tokenAId: "NEAR",
				tokenBId: "USDC",
				confirmMainnet: true,
			}),
		);
	});

	it("supports ref lp add follow-up execute by candidate index intentText", async () => {
		runtimeMocks.parseNearNetwork.mockImplementation((value?: string) =>
			value === "testnet" ? "testnet" : "mainnet",
		);
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "611",
				block_height: 611,
				logs: [],
				result: encodeJsonResult("20000000000000000000000"),
			})
			.mockResolvedValueOnce({
				block_hash: "612",
				block_height: 612,
				logs: [],
				result: encodeJsonResult("5000000"),
			})
			.mockResolvedValueOnce({
				block_hash: "613",
				block_height: 613,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			})
			.mockResolvedValueOnce({
				block_hash: "614",
				block_height: 614,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			})
			.mockResolvedValueOnce({
				block_hash: "615",
				block_height: 615,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			});
		const tool = getTool();
		await tool.execute("near-wf-10c-sim", {
			runId: "wf-near-10c",
			runMode: "simulate",
			intentType: "near.lp.ref.add",
			network: "testnet",
			tokenAId: "NEAR",
			tokenBId: "USDC",
			amountARaw: "10000000000000000000000",
			amountBRaw: "1200000",
		});

		const result = await tool.execute("near-wf-10c-exec", {
			runId: "wf-near-10c",
			runMode: "execute",
			intentText: "继续执行，用第2个池子",
		});

		expect(executeMocks.addLiquidityRefExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				network: "testnet",
				poolId: 8,
				tokenAId: "NEAR",
				tokenBId: "USDC",
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.add",
			intent: {
				type: "near.lp.ref.add",
				poolId: 8,
			},
		});
	});

	it("returns clear error when poolCandidateIndex is out of range", async () => {
		runtimeMocks.parseNearNetwork.mockImplementation((value?: string) =>
			value === "testnet" ? "testnet" : "mainnet",
		);
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "621",
				block_height: 621,
				logs: [],
				result: encodeJsonResult("20000000000000000000000"),
			})
			.mockResolvedValueOnce({
				block_hash: "622",
				block_height: 622,
				logs: [],
				result: encodeJsonResult("5000000"),
			})
			.mockResolvedValueOnce({
				block_hash: "623",
				block_height: 623,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			})
			.mockResolvedValueOnce({
				block_hash: "624",
				block_height: 624,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			})
			.mockResolvedValueOnce({
				block_hash: "625",
				block_height: 625,
				logs: [],
				result: encodeJsonResult({ total: "1" }),
			});
		const tool = getTool();
		await tool.execute("near-wf-10d-sim", {
			runId: "wf-near-10d",
			runMode: "simulate",
			intentType: "near.lp.ref.add",
			network: "testnet",
			tokenAId: "NEAR",
			tokenBId: "USDC",
			amountARaw: "10000000000000000000000",
			amountBRaw: "1200000",
		});

		await expect(
			tool.execute("near-wf-10d-exec", {
				runId: "wf-near-10d",
				runMode: "execute",
				poolCandidateIndex: 3,
			}),
		).rejects.toThrow("out of range");
		expect(executeMocks.addLiquidityRefExecute).not.toHaveBeenCalled();
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

	it("parses natural-language ref lp remove intent without explicit poolId", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-11c", {
			runId: "wf-near-11c",
			runMode: "analysis",
			network: "mainnet",
			intentText:
				"在 Ref 移除 LP，NEAR/USDC，shares 100000，minA 1，minB 2，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.remove",
			intent: {
				type: "near.lp.ref.remove",
				tokenAId: "NEAR",
				tokenBId: "USDC",
				shares: "100000",
				minAmountARaw: "1",
				minAmountBRaw: "2",
			},
		});
	});

	it("parses natural-language ref lp remove with auto-withdraw hint", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-11ca", {
			runId: "wf-near-11ca",
			runMode: "analysis",
			network: "mainnet",
			intentText: "在 Ref 移除 LP，NEAR/USDC，shares 100000，提回钱包，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.remove",
			intent: {
				type: "near.lp.ref.remove",
				autoWithdraw: true,
			},
		});
	});

	it("parses natural-language ref lp remove percentage intent", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-11e", {
			runId: "wf-near-11e",
			runMode: "analysis",
			network: "mainnet",
			intentText: "在 Ref 移除 LP，NEAR/USDC，50%，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.remove",
			intent: {
				type: "near.lp.ref.remove",
				tokenAId: "NEAR",
				tokenBId: "USDC",
				shareBps: 5000,
			},
		});
	});

	it("parses natural-language ref lp remove all intent", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-11f", {
			runId: "wf-near-11f",
			runMode: "analysis",
			network: "mainnet",
			intentText: "在 Ref 移除 LP，NEAR/USDC，全部撤出，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.remove",
			intent: {
				type: "near.lp.ref.remove",
				tokenAId: "NEAR",
				tokenBId: "USDC",
				shareBps: 10000,
			},
		});
	});

	it("simulates ref lp remove without poolId and reuses resolved pool on execute", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			block_hash: "701",
			block_height: 701,
			logs: [],
			result: encodeJsonResult("500000"),
		});
		const tool = getTool();
		const simulated = await tool.execute("near-wf-11d-sim", {
			runId: "wf-near-11d",
			runMode: "simulate",
			intentType: "near.lp.ref.remove",
			network: "mainnet",
			tokenAId: "NEAR",
			tokenBId: "USDC",
			shares: "100000",
			minAmountARaw: "1",
			minAmountBRaw: "2",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;

		expect(refMocks.findRefPoolForPair).toHaveBeenCalledWith({
			network: "mainnet",
			rpcUrl: undefined,
			refContractId: "v2.ref-finance.near",
			tokenAId: "NEAR",
			tokenBId: "USDC",
		});
		expect(simulated.details).toMatchObject({
			intentType: "near.lp.ref.remove",
			intent: {
				type: "near.lp.ref.remove",
				poolId: 7,
			},
			artifacts: {
				simulate: {
					poolId: 7,
					poolSelectionSource: "bestLiquidityPool",
					poolCandidates: [
						{
							poolId: 7,
						},
						{
							poolId: 8,
						},
					],
				},
			},
		});
		expect(simulated.content[0]?.text).toContain("alternatives=8");

		await tool.execute("near-wf-11d-exec", {
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.removeLiquidityRefExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				poolId: 7,
				tokenAId: "NEAR",
				tokenBId: "USDC",
				shares: "100000",
				confirmMainnet: true,
			}),
		);
	});

	it("simulates ref lp remove by sharePercent", async () => {
		runtimeMocks.callNearRpc.mockResolvedValueOnce({
			block_hash: "702",
			block_height: 702,
			logs: [],
			result: encodeJsonResult("500000"),
		});
		const tool = getTool();
		const result = await tool.execute("near-wf-11f", {
			runId: "wf-near-11f",
			runMode: "simulate",
			intentType: "near.lp.ref.remove",
			network: "mainnet",
			poolId: 7,
			sharePercent: 50,
		});

		expect(result.details).toMatchObject({
			intentType: "near.lp.ref.remove",
			intent: {
				type: "near.lp.ref.remove",
				poolId: 7,
				shareBps: 5000,
			},
			artifacts: {
				simulate: {
					availableShares: "500000",
					requiredShares: "250000",
					shareBpsUsed: 5000,
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

	it("passes autoWithdraw params to remove execute tool", async () => {
		const tool = getTool();
		const analysis = await tool.execute("near-wf-12b-analysis", {
			runId: "wf-near-12b",
			runMode: "analysis",
			intentType: "near.lp.ref.remove",
			network: "mainnet",
			poolId: 7,
			shares: "100000",
			autoWithdraw: true,
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		await tool.execute("near-wf-12b-execute", {
			runId: "wf-near-12b",
			runMode: "execute",
			network: "mainnet",
			poolId: 7,
			shares: "100000",
			autoWithdraw: true,
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.removeLiquidityRefExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				autoWithdraw: true,
				autoRegisterReceiver: true,
			}),
		);
	});
});
