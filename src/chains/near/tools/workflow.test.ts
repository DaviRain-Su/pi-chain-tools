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
	supplyBurrowExecute: vi.fn(),
	borrowBurrowExecute: vi.fn(),
	repayBurrowExecute: vi.fn(),
	withdrawBurrowExecute: vi.fn(),
	submitIntentsDepositExecute: vi.fn(),
	broadcastSignedTxExecute: vi.fn(),
	addLiquidityRefExecute: vi.fn(),
	removeLiquidityRefExecute: vi.fn(),
}));

const composeMocks = vi.hoisted(() => ({
	buildTransferNearCompose: vi.fn(),
	buildTransferFtCompose: vi.fn(),
	buildIntentsSwapDepositCompose: vi.fn(),
	buildAddLiquidityRefCompose: vi.fn(),
	buildRemoveLiquidityRefCompose: vi.fn(),
	buildSwapRefCompose: vi.fn(),
	buildRefWithdrawCompose: vi.fn(),
	buildSupplyBurrowCompose: vi.fn(),
	buildBorrowBurrowCompose: vi.fn(),
	buildRepayBurrowCompose: vi.fn(),
	buildWithdrawBurrowCompose: vi.fn(),
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
			name: "near_supplyBurrow",
			label: "burrow supply",
			description: "burrow supply",
			parameters: {},
			execute: executeMocks.supplyBurrowExecute,
		},
		{
			name: "near_borrowBurrow",
			label: "burrow borrow",
			description: "burrow borrow",
			parameters: {},
			execute: executeMocks.borrowBurrowExecute,
		},
		{
			name: "near_repayBurrow",
			label: "burrow repay",
			description: "burrow repay",
			parameters: {},
			execute: executeMocks.repayBurrowExecute,
		},
		{
			name: "near_withdrawBurrow",
			label: "burrow withdraw",
			description: "burrow withdraw",
			parameters: {},
			execute: executeMocks.withdrawBurrowExecute,
		},
		{
			name: "near_submitIntentsDeposit",
			label: "intents submit",
			description: "intents submit",
			parameters: {},
			execute: executeMocks.submitIntentsDepositExecute,
		},
		{
			name: "near_broadcastSignedTransaction",
			label: "broadcast signed tx",
			description: "broadcast signed tx",
			parameters: {},
			execute: executeMocks.broadcastSignedTxExecute,
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
			name: "near_buildIntentsSwapDepositTransaction",
			label: "compose intents deposit",
			description: "compose intents deposit",
			parameters: {},
			execute: composeMocks.buildIntentsSwapDepositCompose,
		},
		{
			name: "near_buildAddLiquidityRefTransaction",
			label: "compose ref add liquidity",
			description: "compose ref add liquidity",
			parameters: {},
			execute: composeMocks.buildAddLiquidityRefCompose,
		},
		{
			name: "near_buildRemoveLiquidityRefTransaction",
			label: "compose ref remove liquidity",
			description: "compose ref remove liquidity",
			parameters: {},
			execute: composeMocks.buildRemoveLiquidityRefCompose,
		},
		{
			name: "near_buildSwapRefTransaction",
			label: "compose ref swap",
			description: "compose ref swap",
			parameters: {},
			execute: composeMocks.buildSwapRefCompose,
		},
		{
			name: "near_buildRefWithdrawTransaction",
			label: "compose ref withdraw",
			description: "compose ref withdraw",
			parameters: {},
			execute: composeMocks.buildRefWithdrawCompose,
		},
		{
			name: "near_buildSupplyBurrowTransaction",
			label: "compose burrow supply",
			description: "compose burrow supply",
			parameters: {},
			execute: composeMocks.buildSupplyBurrowCompose,
		},
		{
			name: "near_buildBorrowBurrowTransaction",
			label: "compose burrow borrow",
			description: "compose burrow borrow",
			parameters: {},
			execute: composeMocks.buildBorrowBurrowCompose,
		},
		{
			name: "near_buildRepayBurrowTransaction",
			label: "compose burrow repay",
			description: "compose burrow repay",
			parameters: {},
			execute: composeMocks.buildRepayBurrowCompose,
		},
		{
			name: "near_buildWithdrawBurrowTransaction",
			label: "compose burrow withdraw",
			description: "compose burrow withdraw",
			parameters: {},
			execute: composeMocks.buildWithdrawBurrowCompose,
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
	executeMocks.supplyBurrowExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			txHash: "near-exec-burrow-supply-hash",
		},
	});
	executeMocks.borrowBurrowExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			txHash: "near-exec-burrow-borrow-hash",
		},
	});
	executeMocks.repayBurrowExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			txHash: "near-exec-burrow-repay-hash",
		},
	});
	executeMocks.withdrawBurrowExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			txHash: "near-exec-burrow-withdraw-hash",
		},
	});
	executeMocks.submitIntentsDepositExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			correlationId: "corr-exec-1",
			status: "PENDING_DEPOSIT",
		},
	});
	executeMocks.broadcastSignedTxExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			txHash: "near-broadcast-hash-1",
			network: "mainnet",
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
	composeMocks.buildIntentsSwapDepositCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-intents-deposit",
		},
	});
	composeMocks.buildAddLiquidityRefCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-ref-add-liquidity",
		},
	});
	composeMocks.buildRemoveLiquidityRefCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-ref-remove-liquidity",
		},
	});
	composeMocks.buildSwapRefCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-swap-ref",
		},
	});
	composeMocks.buildRefWithdrawCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-ref-withdraw",
		},
	});
	composeMocks.buildSupplyBurrowCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-burrow-supply",
		},
	});
	composeMocks.buildBorrowBurrowCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-burrow-borrow",
		},
	});
	composeMocks.buildRepayBurrowCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-burrow-repay",
		},
	});
	composeMocks.buildWithdrawBurrowCompose.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: {
			unsignedPayload: "near-compose-burrow-withdraw",
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

	it("composes ref swap and returns unsigned payload artifact", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-1-compose-swap", {
			runId: "wf-near-01-compose-swap",
			runMode: "compose",
			network: "mainnet",
			intentType: "near.swap.ref",
			tokenInId: "NEAR",
			tokenOutId: "USDC",
			amountInRaw: "10000000000000000000000",
			slippageBps: 100,
		});

		expect(composeMocks.buildSwapRefCompose).toHaveBeenCalledWith(
			"near-wf-compose",
			expect.objectContaining({
				tokenInId: "NEAR",
				tokenOutId: "USDC",
				amountInRaw: "10000000000000000000000",
				slippageBps: 100,
				network: "mainnet",
			}),
		);
		expect(result.details).toMatchObject({
			runMode: "compose",
			intentType: "near.swap.ref",
			approvalRequired: false,
			artifacts: {
				compose: {
					unsignedPayload: "near-compose-swap-ref",
				},
			},
		});
	});

	it("composes intents deposit and returns unsigned payload artifact", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-1-compose-intents", {
			runId: "wf-near-01-compose-intents",
			runMode: "compose",
			network: "mainnet",
			intentType: "near.swap.intents",
			originAsset: "USDC",
			destinationAsset: "NEAR",
			amountRaw: "1000000",
		});

		expect(composeMocks.buildIntentsSwapDepositCompose).toHaveBeenCalledWith(
			"near-wf-compose",
			expect.objectContaining({
				originAsset: "USDC",
				destinationAsset: "NEAR",
				amount: "1000000",
				network: "mainnet",
			}),
		);
		expect(result.details).toMatchObject({
			runMode: "compose",
			intentType: "near.swap.intents",
			approvalRequired: false,
			artifacts: {
				compose: {
					unsignedPayload: "near-compose-intents-deposit",
				},
			},
		});
	});

	it("composes ref add-liquidity and returns unsigned payload artifact", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-1-compose-lp-add", {
			runId: "wf-near-01-compose-lp-add",
			runMode: "compose",
			network: "mainnet",
			intentType: "near.lp.ref.add",
			poolId: 7,
			amountARaw: "1000",
			amountBRaw: "2000",
			tokenAId: "wrap.near",
			tokenBId: "usdc.tether-token.near",
		});

		expect(composeMocks.buildAddLiquidityRefCompose).toHaveBeenCalledWith(
			"near-wf-compose",
			expect.objectContaining({
				poolId: 7,
				amountARaw: "1000",
				amountBRaw: "2000",
				network: "mainnet",
			}),
		);
		expect(result.details).toMatchObject({
			runMode: "compose",
			intentType: "near.lp.ref.add",
			artifacts: {
				compose: {
					unsignedPayload: "near-compose-ref-add-liquidity",
				},
			},
		});
	});

	it("composes ref remove-liquidity and returns unsigned payload artifact", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-1-compose-lp-remove", {
			runId: "wf-near-01-compose-lp-remove",
			runMode: "compose",
			network: "mainnet",
			intentType: "near.lp.ref.remove",
			poolId: 7,
			shares: "1000",
		});

		expect(composeMocks.buildRemoveLiquidityRefCompose).toHaveBeenCalledWith(
			"near-wf-compose",
			expect.objectContaining({
				poolId: 7,
				shares: "1000",
				network: "mainnet",
			}),
		);
		expect(result.details).toMatchObject({
			runMode: "compose",
			intentType: "near.lp.ref.remove",
			artifacts: {
				compose: {
					unsignedPayload: "near-compose-ref-remove-liquidity",
				},
			},
		});
	});

	it("passes autoWithdraw flag when composing ref remove-liquidity", async () => {
		const tool = getTool();
		await tool.execute("near-wf-1-compose-lp-remove-aw", {
			runId: "wf-near-01-compose-lp-remove-aw",
			runMode: "compose",
			network: "mainnet",
			intentType: "near.lp.ref.remove",
			poolId: 7,
			shares: "1000",
			autoWithdraw: true,
		});

		expect(composeMocks.buildRemoveLiquidityRefCompose).toHaveBeenCalledWith(
			"near-wf-compose",
			expect.objectContaining({
				autoWithdraw: true,
			}),
		);
	});

	it("composes burrow supply and returns unsigned payload artifact", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-1-compose-burrow-supply", {
			runId: "wf-near-01-compose-burrow-supply",
			runMode: "compose",
			network: "mainnet",
			intentType: "near.lend.burrow.supply",
			tokenId: "USDC",
			amountRaw: "1000000",
			asCollateral: true,
		});

		expect(composeMocks.buildSupplyBurrowCompose).toHaveBeenCalledWith(
			"near-wf-compose",
			expect.objectContaining({
				tokenId: "USDC",
				amountRaw: "1000000",
				asCollateral: true,
				network: "mainnet",
			}),
		);
		expect(result.details).toMatchObject({
			runMode: "compose",
			intentType: "near.lend.burrow.supply",
			artifacts: {
				compose: {
					unsignedPayload: "near-compose-burrow-supply",
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
					summaryLine: expect.stringContaining("near.transfer.near"),
					summary: {
						schema: "w3rt.workflow.summary.v1",
						phase: "simulate",
						intentType: "near.transfer.near",
					},
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
		expect(analysis.details).toMatchObject({
			artifacts: {
				analysis: {
					summaryLine: expect.stringContaining(
						"near.transfer.near analysis=ready",
					),
					summary: {
						schema: "w3rt.workflow.summary.v1",
						phase: "analysis",
						intentType: "near.transfer.near",
						status: "ready",
					},
				},
			},
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
					summaryLine: expect.stringContaining("near.transfer.near"),
					summary: {
						schema: "w3rt.workflow.summary.v1",
						phase: "execute",
						intentType: "near.transfer.near",
					},
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

	it("parses confirm-mainnet phrase from intentText for follow-up execute", async () => {
		const tool = getTool();
		const simulated = await tool.execute("near-wf-5c-sim", {
			runId: "wf-near-05c",
			runMode: "simulate",
			intentType: "near.transfer.near",
			network: "mainnet",
			toAccountId: "bob.near",
			amountYoctoNear: "1000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		await tool.execute("near-wf-5c-exec", {
			runMode: "execute",
			intentText: `继续执行刚才这笔，确认主网执行，confirmToken ${token}`,
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

	it("accepts loose confirm token text and case-insensitive token", async () => {
		const tool = getTool();
		const simulated = await tool.execute("near-wf-5d-sim", {
			runId: "wf-near-05d",
			runMode: "simulate",
			intentType: "near.transfer.near",
			network: "mainnet",
			toAccountId: "bob.near",
			amountYoctoNear: "1000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		await tool.execute("near-wf-5d-exec", {
			runMode: "execute",
			intentText: `继续执行刚才这笔，确认主网执行，${token.toLowerCase()}`,
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

	it("parses percentage slippage for ref swap intentText", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-8-slippage-percent", {
			runId: "wf-near-08-slippage-percent",
			runMode: "analysis",
			network: "mainnet",
			intentText: "把 0.01 NEAR 换成 USDC，滑点 1%，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.swap.ref",
			intent: {
				type: "near.swap.ref",
				tokenInId: "NEAR",
				tokenOutId: "USDC",
				slippageBps: 100,
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

	it("parses percentage intents slippage from intentText", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-8d-slippage", {
			runId: "wf-near-08d-slippage",
			runMode: "analysis",
			network: "mainnet",
			intentText:
				"通过 intents 把 NEAR 换成 USDC，amountRaw 1000000，intents滑点 0.5%，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			intent: {
				type: "near.swap.intents",
				originAsset: "NEAR",
				destinationAsset: "USDC",
				amount: "1000000",
				slippageTolerance: 50,
			},
		});
	});

	it("parses natural-language intents ANY_INPUT swap intent", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-8d-any-input", {
			runId: "wf-near-08d-any-input",
			runMode: "analysis",
			network: "mainnet",
			intentText:
				"通过 intents any input 把 NEAR 换成 USDC，amountRaw 1000000，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			intent: {
				type: "near.swap.intents",
				originAsset: "NEAR",
				destinationAsset: "USDC",
				amount: "1000000",
				swapType: "ANY_INPUT",
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
		expect(fetchMock).toHaveBeenLastCalledWith(
			"https://1click.chaindefuser.com/v0/status?depositAddress=0xnear-deposit-2&depositMemo=memo-2&correlationId=corr-exec-1",
			expect.objectContaining({
				method: "GET",
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			artifacts: {
				execute: {
					correlationId: "corr-exec-1",
					status: "PENDING_DEPOSIT",
					summaryLine: expect.stringContaining(
						"intents submit=PENDING_DEPOSIT",
					),
					statusTracking: {
						timedOut: false,
						latestStatus: {
							status: "SUCCESS",
						},
					},
				},
			},
		});
		expect(result.content[0]?.text).toContain(
			"Workflow executed: near.swap.intents",
		);
		expect(result.content[0]?.text).toContain("Submit status: PENDING_DEPOSIT");
		expect(result.content[0]?.text).toContain("CorrelationId: corr-exec-1");
		expect(result.content[0]?.text).toContain("Tracked status: SUCCESS");
	});

	it("classifies intents failed status with readable remediation", async () => {
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
				correlationId: "corr-sim-failed-1",
				timestamp: "2026-02-13T00:00:00Z",
				signature: "sig-failed-1",
				quoteRequest: { dry: true },
				quote: {
					depositAddress: "0xnear-deposit-failed-1",
					depositMemo: "memo-failed-1",
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
		const simulated = await tool.execute("near-wf-8f-failed-sim", {
			runId: "wf-near-08f-failed",
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
				correlationId: "corr-sim-failed-1",
				status: "FAILED",
				updatedAt: "2026-02-13T00:00:15Z",
				quoteResponse: {
					correlationId: "corr-sim-failed-1",
					timestamp: "2026-02-13T00:00:00Z",
					signature: "sig-failed-1",
					quoteRequest: { dry: true },
					quote: {
						depositAddress: "0xnear-deposit-failed-1",
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
					refundReason: "slippage exceeded",
				},
			},
		});
		const result = await tool.execute("near-wf-8f-failed-exec", {
			runId: "wf-near-08f-failed",
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
			txHash: "0xfeedbeef-failed-1",
		});

		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			artifacts: {
				execute: {
					summaryLine: expect.stringContaining("outcome=failed:FAILED"),
					intentsOutcome: {
						category: "failed",
						sourceStatus: "FAILED",
						reasonCode: "FAILED",
						reason: "slippage exceeded",
					},
				},
			},
		});
		expect(result.content[0]?.text).toContain("Outcome: failed");
		expect(result.content[0]?.text).toContain("Reason: slippage exceeded");
		expect(result.content[0]?.text).toContain("Next:");
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
					summaryLine: expect.stringContaining(
						"intents submit=PENDING_DEPOSIT",
					),
					statusTracking: null,
				},
			},
		});
	});

	it("parses natural-language hint to disable intents status polling", async () => {
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
				correlationId: "corr-sim-2c",
				timestamp: "2026-02-13T00:00:00Z",
				signature: "sig-2c",
				quoteRequest: { dry: true },
				quote: {
					depositAddress: "0xnear-deposit-2c",
					depositMemo: "memo-2c",
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
		const simulated = await tool.execute("near-wf-8f3-sim", {
			runId: "wf-near-08f3",
			runMode: "simulate",
			intentType: "near.swap.intents",
			network: "mainnet",
			originAsset: "NEAR",
			destinationAsset: "USDC",
			amountRaw: "10000000000000000000000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		const result = await tool.execute("near-wf-8f3-exec", {
			runId: "wf-near-08f3",
			runMode: "execute",
			intentText: `继续执行刚才这笔，不用等待完成，confirmToken ${token}`,
			confirmMainnet: true,
			txHash: "0xfeedbeef3",
		});

		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			artifacts: {
				execute: {
					correlationId: "corr-exec-1",
					summaryLine: expect.stringContaining(
						"intents submit=PENDING_DEPOSIT",
					),
					statusTracking: null,
				},
			},
		});
	});

	it("supports intents execute with signedTxBase64 by auto-broadcasting first", async () => {
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
				correlationId: "corr-sim-3a",
				timestamp: "2026-02-13T00:00:00Z",
				signature: "sig-3a",
				quoteRequest: { dry: true },
				quote: {
					depositAddress: "0xnear-deposit-3a",
					depositMemo: "memo-3a",
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
		const simulated = await tool.execute("near-wf-8ga-sim", {
			runId: "wf-near-08ga",
			runMode: "simulate",
			intentType: "near.swap.intents",
			network: "mainnet",
			originAsset: "NEAR",
			destinationAsset: "USDC",
			amountRaw: "10000000000000000000000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		const signedTxBase64 = Buffer.from(
			"signed-near-transaction",
			"utf8",
		).toString("base64");
		const result = await tool.execute("near-wf-8ga-exec", {
			runId: "wf-near-08ga",
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
			signedTxBase64,
			waitForFinalStatus: false,
		});

		expect(executeMocks.broadcastSignedTxExecute).toHaveBeenCalledWith(
			"near-wf-exec-intents-broadcast",
			expect.objectContaining({
				signedTxBase64,
				network: "mainnet",
				confirmMainnet: true,
			}),
		);
		expect(executeMocks.submitIntentsDepositExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				txHash: "near-broadcast-hash-1",
				depositAddress: "0xnear-deposit-3a",
				depositMemo: "memo-3a",
				confirmMainnet: true,
				network: "mainnet",
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			artifacts: {
				execute: {
					correlationId: "corr-exec-1",
					broadcast: {
						txHash: "near-broadcast-hash-1",
					},
					statusTracking: null,
				},
			},
		});
	});

	it("queries ANY_INPUT withdrawals after intents execute", async () => {
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
				correlationId: "corr-sim-any-1",
				timestamp: "2026-02-13T00:00:00Z",
				signature: "sig-any-1",
				quoteRequest: { dry: true },
				quote: {
					depositAddress: "0xnear-deposit-any-1",
					depositMemo: "memo-any-1",
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
		const simulated = await tool.execute("near-wf-8h-sim", {
			runId: "wf-near-08h",
			runMode: "simulate",
			intentType: "near.swap.intents",
			swapType: "ANY_INPUT",
			network: "mainnet",
			originAsset: "NEAR",
			destinationAsset: "USDC",
			amountRaw: "10000000000000000000000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		mockFetchJsonOnce({
			status: 200,
			body: {
				asset: "near:usdc.tether-token.near",
				recipient: "alice.near",
				withdrawals: [
					{
						status: "WITHDRAWN",
						amountOut: "41871",
						amountOutFormatted: "0.041871",
						withdrawFee: "10",
						withdrawFeeFormatted: "0.000010",
						timestamp: "2026-02-13T00:00:10Z",
						hash: "0xwithdraw-any-1",
					},
				],
				page: 1,
				limit: 50,
				total: 1,
			},
		});
		const result = await tool.execute("near-wf-8h-exec", {
			runId: "wf-near-08h",
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
			txHash: "0xfeedbeef-any-1",
			waitForFinalStatus: false,
		});

		expect(fetchMock).toHaveBeenLastCalledWith(
			"https://1click.chaindefuser.com/v0/any-input/withdrawals?depositAddress=0xnear-deposit-any-1&depositMemo=memo-any-1&limit=50&sortOrder=desc",
			expect.objectContaining({
				method: "GET",
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			artifacts: {
				execute: {
					correlationId: "corr-exec-1",
					statusTracking: null,
					anyInputWithdrawals: {
						status: "success",
						asset: "near:usdc.tether-token.near",
						withdrawals: [
							{
								status: "WITHDRAWN",
								hash: "0xwithdraw-any-1",
							},
						],
					},
				},
			},
		});
	});

	it("keeps intents execute successful when ANY_INPUT withdrawals query fails", async () => {
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
				correlationId: "corr-sim-any-2",
				timestamp: "2026-02-13T00:00:00Z",
				signature: "sig-any-2",
				quoteRequest: { dry: true },
				quote: {
					depositAddress: "0xnear-deposit-any-2",
					depositMemo: "memo-any-2",
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
		const simulated = await tool.execute("near-wf-8i-sim", {
			runId: "wf-near-08i",
			runMode: "simulate",
			intentType: "near.swap.intents",
			swapType: "ANY_INPUT",
			network: "mainnet",
			originAsset: "NEAR",
			destinationAsset: "USDC",
			amountRaw: "10000000000000000000000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		mockFetchJsonOnce({
			status: 404,
			body: {
				message: "ANY_INPUT withdrawals not found yet",
			},
		});
		const result = await tool.execute("near-wf-8i-exec", {
			runId: "wf-near-08i",
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
			txHash: "0xfeedbeef-any-2",
			waitForFinalStatus: false,
		});

		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			artifacts: {
				execute: {
					correlationId: "corr-exec-1",
					anyInputWithdrawals: {
						status: "error",
						error: expect.stringContaining(
							"ANY_INPUT withdrawals not found yet",
						),
					},
				},
			},
		});
	});

	it("polls ANY_INPUT withdrawals when waitForFinalStatus is enabled", async () => {
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
				correlationId: "corr-sim-any-3",
				timestamp: "2026-02-13T00:00:00Z",
				signature: "sig-any-3",
				quoteRequest: { dry: true },
				quote: {
					depositAddress: "0xnear-deposit-any-3",
					depositMemo: "memo-any-3",
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
		const simulated = await tool.execute("near-wf-8j-sim", {
			runId: "wf-near-08j",
			runMode: "simulate",
			intentType: "near.swap.intents",
			swapType: "ANY_INPUT",
			network: "mainnet",
			originAsset: "NEAR",
			destinationAsset: "USDC",
			amountRaw: "10000000000000000000000",
		});
		const token = (simulated.details as { confirmToken: string }).confirmToken;
		mockFetchJsonOnce({
			status: 200,
			body: {
				correlationId: "corr-sim-any-3",
				status: "SUCCESS",
				updatedAt: "2026-02-13T00:00:12Z",
				quoteResponse: {
					correlationId: "corr-sim-any-3",
					timestamp: "2026-02-13T00:00:00Z",
					signature: "sig-any-3",
					quoteRequest: { dry: true },
					quote: {
						depositAddress: "0xnear-deposit-any-3",
						depositMemo: "memo-any-3",
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
				swapDetails: {},
			},
		});
		mockFetchJsonOnce({
			status: 200,
			body: {
				asset: "near:usdc.tether-token.near",
				recipient: "alice.near",
				withdrawals: [
					{
						status: "WITHDRAWN",
						amountOut: "41871",
						amountOutFormatted: "0.041871",
						withdrawFee: "10",
						withdrawFeeFormatted: "0.000010",
						timestamp: "2026-02-13T00:00:12Z",
						hash: "0xwithdraw-any-3",
					},
				],
				page: 1,
				limit: 50,
				total: 1,
			},
		});
		const result = await tool.execute("near-wf-8j-exec", {
			runId: "wf-near-08j",
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
			txHash: "0xfeedbeef-any-3",
			statusPollIntervalMs: 500,
			statusTimeoutMs: 3000,
		});

		expect(result.details).toMatchObject({
			intentType: "near.swap.intents",
			artifacts: {
				execute: {
					correlationId: "corr-exec-1",
					summaryLine: expect.stringContaining("withdrawals=success:1"),
					statusTracking: {
						timedOut: false,
						latestStatus: {
							status: "SUCCESS",
						},
					},
					anyInputWithdrawals: {
						status: "success",
						withdrawals: [
							{
								status: "WITHDRAWN",
								hash: "0xwithdraw-any-3",
							},
						],
						polling: {
							timedOut: false,
							attempts: 1,
						},
					},
				},
			},
		});
		expect(result.content[0]?.text).toContain("Tracked status: SUCCESS");
		expect(result.content[0]?.text).toContain(
			"ANY_INPUT withdrawals: 1 record",
		);
		expect(result.content[0]?.text).toContain(
			"Latest withdrawal: WITHDRAWN hash=0xwithdraw-any-3",
		);
	});

	it("requires txHash or signedTxBase64 for intents execute", async () => {
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
		).rejects.toThrow("requires txHash or signedTxBase64");
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

	it("parses natural-language burrow supply intent", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-burrow-1", {
			runId: "wf-near-burrow-01",
			runMode: "analysis",
			network: "mainnet",
			intentText: "在 Burrow 把 0.01 NEAR 存入并作为抵押，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lend.burrow.supply",
			intent: {
				type: "near.lend.burrow.supply",
				tokenId: "NEAR",
				amountRaw: "1000",
				asCollateral: true,
			},
		});
	});

	it("parses natural-language burrow supply ui amount for stablecoins", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-burrow-1b", {
			runId: "wf-near-burrow-01b",
			runMode: "analysis",
			network: "mainnet",
			intentText: "在 Burrow 存入 1 USDC，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lend.burrow.supply",
			intent: {
				type: "near.lend.burrow.supply",
				tokenId: "USDC",
				amountRaw: "1000000",
				asCollateral: true,
			},
		});
	});

	it("simulates burrow supply and returns market/balance artifacts", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "801",
				block_height: 801,
				logs: [],
				result: encodeJsonResult([
					{
						token_id: "wrap.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
						},
					},
				]),
			})
			.mockResolvedValueOnce({
				block_hash: "802",
				block_height: 802,
				logs: [],
				result: encodeJsonResult("2000"),
			});
		const tool = getTool();
		const result = await tool.execute("near-wf-burrow-2", {
			runId: "wf-near-burrow-02",
			runMode: "simulate",
			intentType: "near.lend.burrow.supply",
			network: "mainnet",
			tokenId: "NEAR",
			amountRaw: "1000",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lend.burrow.supply",
			artifacts: {
				simulate: {
					status: "success",
					tokenId: "wrap.near",
					requiredRaw: "1000",
					availableRaw: "2000",
					canDeposit: true,
				},
			},
		});
	});

	it("executes burrow supply after confirm token validation", async () => {
		const tool = getTool();
		const analysis = await tool.execute("near-wf-burrow-3-analysis", {
			runId: "wf-near-burrow-03",
			runMode: "analysis",
			intentType: "near.lend.burrow.supply",
			network: "mainnet",
			tokenId: "NEAR",
			amountRaw: "1000",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		const result = await tool.execute("near-wf-burrow-3-execute", {
			runId: "wf-near-burrow-03",
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.supplyBurrowExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				tokenId: "NEAR",
				amountRaw: "1000",
				asCollateral: true,
				confirmMainnet: true,
			}),
		);
		expect(result.details).toMatchObject({
			intentType: "near.lend.burrow.supply",
			artifacts: {
				execute: {
					txHash: "near-exec-burrow-supply-hash",
				},
			},
		});
	});

	it("parses natural-language burrow borrow intent", async () => {
		const tool = getTool();
		const result = await tool.execute("near-wf-burrow-4", {
			runId: "wf-near-burrow-04",
			runMode: "analysis",
			network: "mainnet",
			intentText: "在 Burrow 借 token NEAR，amountRaw 1000，并提到钱包，先分析",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lend.burrow.borrow",
			intent: {
				type: "near.lend.burrow.borrow",
				tokenId: "NEAR",
				amountRaw: "1000",
				withdrawToWallet: true,
			},
		});
		const analysisSummaryLine =
			(
				result.details as {
					artifacts?: { analysis?: { summaryLine?: string } };
				}
			).artifacts?.analysis?.summaryLine ?? "";
		expect(analysisSummaryLine).toContain("riskCheck=simulate");
		expect(analysisSummaryLine).toContain(
			"riskPolicy=warning>=60.00% critical>=85.00%",
		);
	});

	it("simulates burrow borrow and reports insufficient collateral", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "814",
				block_height: 814,
				logs: [],
				result: encodeJsonResult([
					{
						token_id: "wrap.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
						},
					},
				]),
			})
			.mockResolvedValueOnce({
				block_hash: "815",
				block_height: 815,
				logs: [],
				result: encodeJsonResult({
					account_id: "alice.near",
					supplied: [],
					positions: {},
				}),
			});
		const tool = getTool();
		const result = await tool.execute("near-wf-burrow-4-sim", {
			runId: "wf-near-burrow-04-sim",
			runMode: "simulate",
			intentType: "near.lend.burrow.borrow",
			network: "mainnet",
			tokenId: "NEAR",
			amountRaw: "1000",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lend.burrow.borrow",
			artifacts: {
				simulate: {
					status: "insufficient_collateral",
					tokenId: "wrap.near",
					collateralAssetCount: 0,
					riskLevel: "high",
					riskBand: "critical",
					summaryLine: expect.stringContaining("risk=critical"),
				},
			},
		});
		expect(result.content[0]?.text).toContain("risk=critical");
		expect(result.content[0]?.text).toContain("riskLevel=high");
		expect(result.content[0]?.text).toContain("collateralAssets=0");
	});

	it("simulates burrow borrow and reports warning risk when existing debt exists", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "816",
				block_height: 816,
				logs: [],
				result: encodeJsonResult([
					{
						token_id: "wrap.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
						},
					},
				]),
			})
			.mockResolvedValueOnce({
				block_hash: "817",
				block_height: 817,
				logs: [],
				result: encodeJsonResult({
					account_id: "alice.near",
					supplied: [],
					positions: {
						REGULAR: {
							collateral: [
								{
									token_id: "wrap.near",
									balance: "900",
									shares: "800",
								},
							],
							borrowed: [
								{
									token_id: "usdc.tether-token.near",
									balance: "10",
									shares: "8",
								},
							],
						},
					},
				}),
			});
		const tool = getTool();
		const result = await tool.execute("near-wf-burrow-4-sim-warning", {
			runId: "wf-near-burrow-04-sim-warning",
			runMode: "simulate",
			intentType: "near.lend.burrow.borrow",
			network: "mainnet",
			tokenId: "NEAR",
			amountRaw: "1000",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lend.burrow.borrow",
			artifacts: {
				simulate: {
					status: "success",
					tokenId: "wrap.near",
					collateralAssetCount: 1,
					borrowedAssetCount: 1,
					riskLevel: "medium",
					riskBand: "warning",
					summaryLine: expect.stringContaining("risk=warning"),
				},
			},
		});
		expect(result.content[0]?.text).toContain("risk=warning");
		expect(result.content[0]?.text).toContain("collateralAssets=1");
		expect(result.content[0]?.text).toContain("borrowedAssets=1");
	});

	it("simulates burrow borrow with health-factor risk engine details", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "818",
				block_height: 818,
				logs: [],
				result: encodeJsonResult([
					{
						token_id: "wrap.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
							volatility_ratio: 8000,
						},
					},
					{
						token_id: "usdc.tether-token.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
							volatility_ratio: 9500,
						},
					},
				]),
			})
			.mockResolvedValueOnce({
				block_hash: "819",
				block_height: 819,
				logs: [],
				result: encodeJsonResult({
					account_id: "alice.near",
					supplied: [],
					positions: {
						REGULAR: {
							collateral: [
								{
									token_id: "wrap.near",
									balance: "150",
									shares: "150",
								},
							],
							borrowed: [
								{
									token_id: "usdc.tether-token.near",
									balance: "10",
									shares: "10",
								},
							],
						},
					},
				}),
			});
		mockFetchJsonOnce({
			status: 200,
			body: [
				{
					assetId: "nep141:wrap.near",
					decimals: 0,
					blockchain: "near",
					symbol: "wNEAR",
					price: 1,
					priceUpdatedAt: "2026-02-14T00:00:00.000Z",
					contractAddress: "wrap.near",
				},
				{
					assetId: "nep141:usdc.tether-token.near",
					decimals: 0,
					blockchain: "near",
					symbol: "USDC",
					price: 1,
					priceUpdatedAt: "2026-02-14T00:00:00.000Z",
					contractAddress: "usdc.tether-token.near",
				},
			],
		});
		const tool = getTool();
		const result = await tool.execute("near-wf-burrow-4-sim-hf", {
			runId: "wf-near-burrow-04-sim-hf",
			runMode: "simulate",
			intentType: "near.lend.burrow.borrow",
			network: "mainnet",
			tokenId: "usdc.tether-token.near",
			amountRaw: "100",
		});

		const simulateArtifact = (
			result.details as {
				artifacts?: { simulate?: Record<string, unknown> };
			}
		).artifacts?.simulate;
		expect(simulateArtifact?.riskEngine).toBe("health_factor");
		expect(simulateArtifact?.riskBand).toBe("warning");
		expect(simulateArtifact?.healthFactor).toBeCloseTo(120 / 110, 4);
		expect(String(simulateArtifact?.summaryLine ?? "")).toContain(
			"riskEngine=health_factor",
		);
		expect(String(simulateArtifact?.summaryLine ?? "")).toContain("hf=1.0909");
		expect(result.content[0]?.text).toContain("riskEngine=health_factor");
		expect(result.content[0]?.text).toContain("hf=1.0909");
	});

	it("simulates burrow repay and reports no-debt status", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "811",
				block_height: 811,
				logs: [],
				result: encodeJsonResult([
					{
						token_id: "wrap.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
						},
					},
				]),
			})
			.mockResolvedValueOnce({
				block_hash: "812",
				block_height: 812,
				logs: [],
				result: encodeJsonResult("5000"),
			})
			.mockResolvedValueOnce({
				block_hash: "813",
				block_height: 813,
				logs: [],
				result: encodeJsonResult({
					account_id: "alice.near",
					supplied: [],
					positions: {},
				}),
			});
		const tool = getTool();
		const result = await tool.execute("near-wf-burrow-5", {
			runId: "wf-near-burrow-05",
			runMode: "simulate",
			intentType: "near.lend.burrow.repay",
			network: "mainnet",
			tokenId: "NEAR",
			amountRaw: "1000",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lend.burrow.repay",
			artifacts: {
				simulate: {
					status: "no_debt",
					tokenId: "wrap.near",
					borrowedRaw: "0",
				},
			},
		});
	});

	it("simulates burrow withdraw and flags risk_check_required", async () => {
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "821",
				block_height: 821,
				logs: [],
				result: encodeJsonResult([
					{
						token_id: "wrap.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
						},
					},
				]),
			})
			.mockResolvedValueOnce({
				block_hash: "822",
				block_height: 822,
				logs: [],
				result: encodeJsonResult({
					account_id: "alice.near",
					supplied: [
						{
							token_id: "wrap.near",
							balance: "1000",
							shares: "900",
						},
					],
					positions: {
						REGULAR: {
							collateral: [
								{
									token_id: "wrap.near",
									balance: "900",
									shares: "800",
								},
							],
							borrowed: [
								{
									token_id: "usdc.tether-token.near",
									balance: "10",
									shares: "8",
								},
							],
						},
					},
				}),
			});
		const tool = getTool();
		const result = await tool.execute("near-wf-burrow-6-sim", {
			runId: "wf-near-burrow-06-sim",
			runMode: "simulate",
			intentType: "near.lend.burrow.withdraw",
			network: "mainnet",
			tokenId: "NEAR",
			amountRaw: "1500",
		});

		expect(result.details).toMatchObject({
			intentType: "near.lend.burrow.withdraw",
			artifacts: {
				simulate: {
					status: "risk_check_required",
					tokenId: "wrap.near",
					amountRaw: "1500",
					suppliedInner: "1000",
					collateralInner: "900",
					borrowedAssetCount: 1,
					riskLevel: "high",
					riskBand: "critical",
					summaryLine: expect.stringContaining("risk=critical"),
				},
			},
		});
		expect(result.content[0]?.text).toContain("risk=critical");
		expect(result.content[0]?.text).toContain("borrowedAssets=1");
	});

	it("executes burrow withdraw after confirm token validation", async () => {
		const tool = getTool();
		const analysis = await tool.execute("near-wf-burrow-6-analysis", {
			runId: "wf-near-burrow-06",
			runMode: "analysis",
			intentType: "near.lend.burrow.withdraw",
			network: "mainnet",
			tokenId: "NEAR",
			amountRaw: "1000",
			recipientId: "bob.near",
		});
		const analysisSummaryLine =
			(
				analysis.details as {
					artifacts?: { analysis?: { summaryLine?: string } };
				}
			).artifacts?.analysis?.summaryLine ?? "";
		expect(analysisSummaryLine).toContain("riskCheck=simulate");
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		await tool.execute("near-wf-burrow-6-execute", {
			runId: "wf-near-burrow-06",
			runMode: "execute",
			network: "mainnet",
			tokenId: "NEAR",
			amountRaw: "1000",
			recipientId: "bob.near",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.withdrawBurrowExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				tokenId: "NEAR",
				amountRaw: "1000",
				recipientId: "bob.near",
				confirmMainnet: true,
			}),
		);
	});

	it("blocks burrow borrow execute on mainnet when risk requires confirmRisk", async () => {
		const tool = getTool();
		const analysis = await tool.execute("near-wf-burrow-risk-gate-analysis", {
			runId: "wf-near-burrow-risk-gate",
			runMode: "analysis",
			intentType: "near.lend.burrow.borrow",
			network: "mainnet",
			tokenId: "usdc.tether-token.near",
			amountRaw: "100",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "830",
				block_height: 830,
				logs: [],
				result: encodeJsonResult([
					{
						token_id: "wrap.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
							volatility_ratio: 7000,
						},
					},
					{
						token_id: "usdc.tether-token.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
							volatility_ratio: 9500,
						},
					},
				]),
			})
			.mockResolvedValueOnce({
				block_hash: "831",
				block_height: 831,
				logs: [],
				result: encodeJsonResult({
					account_id: "alice.near",
					supplied: [],
					positions: {
						REGULAR: {
							collateral: [
								{
									token_id: "wrap.near",
									balance: "100",
									shares: "100",
								},
							],
							borrowed: [],
						},
					},
				}),
			});
		mockFetchJsonOnce({
			status: 200,
			body: [
				{
					assetId: "nep141:wrap.near",
					decimals: 0,
					blockchain: "near",
					symbol: "wNEAR",
					price: 1,
					priceUpdatedAt: "2026-02-14T00:00:00.000Z",
					contractAddress: "wrap.near",
				},
				{
					assetId: "nep141:usdc.tether-token.near",
					decimals: 0,
					blockchain: "near",
					symbol: "USDC",
					price: 1,
					priceUpdatedAt: "2026-02-14T00:00:00.000Z",
					contractAddress: "usdc.tether-token.near",
				},
			],
		});

		await expect(
			tool.execute("near-wf-burrow-risk-gate-exec", {
				runId: "wf-near-burrow-risk-gate",
				runMode: "execute",
				network: "mainnet",
				confirmMainnet: true,
				confirmToken: token,
			}),
		).rejects.toThrow(/Pass confirmRisk=true to proceed/);
		expect(executeMocks.borrowBurrowExecute).not.toHaveBeenCalled();
	});

	it("allows burrow borrow execute with confirmRisk and records riskCheck artifact", async () => {
		const tool = getTool();
		const analysis = await tool.execute("near-wf-burrow-risk-ok-analysis", {
			runId: "wf-near-burrow-risk-ok",
			runMode: "analysis",
			intentType: "near.lend.burrow.borrow",
			network: "mainnet",
			tokenId: "usdc.tether-token.near",
			amountRaw: "100",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "832",
				block_height: 832,
				logs: [],
				result: encodeJsonResult([
					{
						token_id: "wrap.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
							volatility_ratio: 7000,
						},
					},
					{
						token_id: "usdc.tether-token.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
							volatility_ratio: 9500,
						},
					},
				]),
			})
			.mockResolvedValueOnce({
				block_hash: "833",
				block_height: 833,
				logs: [],
				result: encodeJsonResult({
					account_id: "alice.near",
					supplied: [],
					positions: {
						REGULAR: {
							collateral: [
								{
									token_id: "wrap.near",
									balance: "100",
									shares: "100",
								},
							],
							borrowed: [],
						},
					},
				}),
			});
		mockFetchJsonOnce({
			status: 200,
			body: [
				{
					assetId: "nep141:wrap.near",
					decimals: 0,
					blockchain: "near",
					symbol: "wNEAR",
					price: 1,
					priceUpdatedAt: "2026-02-14T00:00:00.000Z",
					contractAddress: "wrap.near",
				},
				{
					assetId: "nep141:usdc.tether-token.near",
					decimals: 0,
					blockchain: "near",
					symbol: "USDC",
					price: 1,
					priceUpdatedAt: "2026-02-14T00:00:00.000Z",
					contractAddress: "usdc.tether-token.near",
				},
			],
		});

		const result = await tool.execute("near-wf-burrow-risk-ok-exec", {
			runId: "wf-near-burrow-risk-ok",
			runMode: "execute",
			network: "mainnet",
			confirmMainnet: true,
			confirmToken: token,
			confirmRisk: true,
		});

		expect(executeMocks.borrowBurrowExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				tokenId: "usdc.tether-token.near",
				amountRaw: "100",
				confirmMainnet: true,
			}),
		);
		const executeArtifact = (
			result.details as {
				artifacts?: {
					execute?: {
						riskCheck?: Record<string, unknown>;
						summaryLine?: string;
					};
				};
			}
		).artifacts?.execute;
		expect(executeArtifact?.riskCheck).toMatchObject({
			riskBand: "critical",
			riskEngine: "health_factor",
			confirmRiskAccepted: true,
		});
		expect(result.content[0]?.text).toContain("risk=critical");
		expect(result.content[0]?.text).toContain("riskEngine=health_factor");
		expect(result.content[0]?.text).toContain("hf=0.7000");
		expect(result.content[0]?.text).toContain("liqDistance=-30.00%");
	});

	it("parses natural-language confirm-risk phrase for burrow execute follow-up", async () => {
		const tool = getTool();
		const analysis = await tool.execute("near-wf-burrow-risk-nl-analysis", {
			runId: "wf-near-burrow-risk-nl",
			runMode: "analysis",
			intentType: "near.lend.burrow.borrow",
			network: "mainnet",
			tokenId: "usdc.tether-token.near",
			amountRaw: "100",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		runtimeMocks.callNearRpc
			.mockResolvedValueOnce({
				block_hash: "834",
				block_height: 834,
				logs: [],
				result: encodeJsonResult([
					{
						token_id: "wrap.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
							volatility_ratio: 7000,
						},
					},
					{
						token_id: "usdc.tether-token.near",
						supplied: { shares: "0", balance: "0" },
						borrowed: { shares: "0", balance: "0" },
						config: {
							extra_decimals: 0,
							can_deposit: true,
							can_use_as_collateral: true,
							can_borrow: true,
							can_withdraw: true,
							volatility_ratio: 9500,
						},
					},
				]),
			})
			.mockResolvedValueOnce({
				block_hash: "835",
				block_height: 835,
				logs: [],
				result: encodeJsonResult({
					account_id: "alice.near",
					supplied: [],
					positions: {
						REGULAR: {
							collateral: [
								{
									token_id: "wrap.near",
									balance: "100",
									shares: "100",
								},
							],
							borrowed: [],
						},
					},
				}),
			});
		mockFetchJsonOnce({
			status: 200,
			body: [
				{
					assetId: "nep141:wrap.near",
					decimals: 0,
					blockchain: "near",
					symbol: "wNEAR",
					price: 1,
					priceUpdatedAt: "2026-02-14T00:00:00.000Z",
					contractAddress: "wrap.near",
				},
				{
					assetId: "nep141:usdc.tether-token.near",
					decimals: 0,
					blockchain: "near",
					symbol: "USDC",
					price: 1,
					priceUpdatedAt: "2026-02-14T00:00:00.000Z",
					contractAddress: "usdc.tether-token.near",
				},
			],
		});

		await tool.execute("near-wf-burrow-risk-nl-exec", {
			runId: "wf-near-burrow-risk-nl",
			runMode: "execute",
			network: "mainnet",
			intentText: `继续执行刚才那笔，确认主网执行，我接受风险继续执行，confirmToken ${token}`,
		});

		expect(executeMocks.borrowBurrowExecute).toHaveBeenCalledWith(
			"near-wf-exec",
			expect.objectContaining({
				tokenId: "usdc.tether-token.near",
				amountRaw: "100",
				confirmMainnet: true,
			}),
		);
	});
});
