import { beforeEach, describe, expect, it, vi } from "vitest";

const cetusMocks = vi.hoisted(() => {
	const createAddLiquidityFixTokenPayload = vi.fn();
	const removeLiquidityTransactionPayload = vi.fn();
	const initCetusSDK = vi.fn().mockImplementation(() => ({
		Position: {
			createAddLiquidityFixTokenPayload,
			removeLiquidityTransactionPayload,
		},
	}));
	return {
		createAddLiquidityFixTokenPayload,
		removeLiquidityTransactionPayload,
		initCetusSDK,
	};
});

const runtimeMocks = vi.hoisted(() => ({
	getSuiClient: vi.fn(),
	getSuiRpcEndpoint: vi.fn(() => "https://fullnode.mainnet.sui.io:443"),
	parsePositiveBigInt: vi.fn((value: string) => BigInt(value)),
	parseSuiNetwork: vi.fn(() => "mainnet"),
	resolveSuiKeypair: vi.fn(() => ({
		toSuiAddress: () =>
			"0x1111111111111111111111111111111111111111111111111111111111111111",
	})),
	suiNetworkSchema: vi.fn(),
	toMist: vi.fn((value: number) => BigInt(Math.round(value * 1_000_000_000))),
}));

const executeMocks = vi.hoisted(() => {
	const transferSuiExecute = vi.fn();
	const transferCoinExecute = vi.fn();
	const swapCetusExecute = vi.fn();
	const cetusAddLiquidityExecute = vi.fn();
	const cetusRemoveLiquidityExecute = vi.fn();
	const stableLayerMintExecute = vi.fn();
	const stableLayerBurnExecute = vi.fn();
	const stableLayerClaimExecute = vi.fn();
	return {
		transferSuiExecute,
		transferCoinExecute,
		swapCetusExecute,
		cetusAddLiquidityExecute,
		cetusRemoveLiquidityExecute,
		stableLayerMintExecute,
		stableLayerBurnExecute,
		stableLayerClaimExecute,
	};
});

const stableLayerMocks = vi.hoisted(() => ({
	STABLE_LAYER_DEFAULT_USDC_COIN_TYPE:
		"0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
	resolveStableLayerNetwork: vi.fn(() => "mainnet"),
	buildStableLayerMintTransaction: vi.fn(),
	buildStableLayerBurnTransaction: vi.fn(),
	buildStableLayerClaimTransaction: vi.fn(),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		getSuiClient: runtimeMocks.getSuiClient,
		getSuiRpcEndpoint: runtimeMocks.getSuiRpcEndpoint,
		parsePositiveBigInt: runtimeMocks.parsePositiveBigInt,
		parseSuiNetwork: runtimeMocks.parseSuiNetwork,
		resolveSuiKeypair: runtimeMocks.resolveSuiKeypair,
		suiNetworkSchema: runtimeMocks.suiNetworkSchema,
		toMist: runtimeMocks.toMist,
	};
});

vi.mock("./execute.js", () => ({
	createSuiExecuteTools: () => [
		{
			name: "sui_transferSui",
			label: "transfer",
			description: "transfer",
			parameters: {},
			execute: executeMocks.transferSuiExecute,
		},
		{
			name: "sui_transferCoin",
			label: "transfer coin",
			description: "transfer coin",
			parameters: {},
			execute: executeMocks.transferCoinExecute,
		},
		{
			name: "sui_swapCetus",
			label: "swap",
			description: "swap",
			parameters: {},
			execute: executeMocks.swapCetusExecute,
		},
		{
			name: "sui_cetusAddLiquidity",
			label: "add liquidity",
			description: "add liquidity",
			parameters: {},
			execute: executeMocks.cetusAddLiquidityExecute,
		},
		{
			name: "sui_cetusRemoveLiquidity",
			label: "remove liquidity",
			description: "remove liquidity",
			parameters: {},
			execute: executeMocks.cetusRemoveLiquidityExecute,
		},
		{
			name: "sui_stableLayerMint",
			label: "stable layer mint",
			description: "stable layer mint",
			parameters: {},
			execute: executeMocks.stableLayerMintExecute,
		},
		{
			name: "sui_stableLayerBurn",
			label: "stable layer burn",
			description: "stable layer burn",
			parameters: {},
			execute: executeMocks.stableLayerBurnExecute,
		},
		{
			name: "sui_stableLayerClaim",
			label: "stable layer claim",
			description: "stable layer claim",
			parameters: {},
			execute: executeMocks.stableLayerClaimExecute,
		},
	],
}));

vi.mock("@cetusprotocol/cetus-sui-clmm-sdk", () => ({
	initCetusSDK: cetusMocks.initCetusSDK,
}));

vi.mock("@cetusprotocol/aggregator-sdk", () => ({
	AggregatorClient: vi.fn().mockImplementation(() => ({
		findRouters: vi.fn(),
		fastRouterSwap: vi.fn(),
	})),
	Env: {
		Mainnet: "Mainnet",
		Testnet: "Testnet",
	},
}));

vi.mock("../stablelayer.js", () => ({
	STABLE_LAYER_DEFAULT_USDC_COIN_TYPE:
		stableLayerMocks.STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
	resolveStableLayerNetwork: stableLayerMocks.resolveStableLayerNetwork,
	buildStableLayerMintTransaction:
		stableLayerMocks.buildStableLayerMintTransaction,
	buildStableLayerBurnTransaction:
		stableLayerMocks.buildStableLayerBurnTransaction,
	buildStableLayerClaimTransaction:
		stableLayerMocks.buildStableLayerClaimTransaction,
}));

import { createSuiWorkflowTools } from "./workflow.js";

type WorkflowTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(name = "w3rt_run_sui_workflow_v0"): WorkflowTool {
	const tool = createSuiWorkflowTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as WorkflowTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.parseSuiNetwork.mockReturnValue("mainnet");
	runtimeMocks.getSuiClient.mockReturnValue({
		devInspectTransactionBlock: vi.fn().mockResolvedValue({
			effects: {
				status: {
					status: "success",
				},
			},
		}),
	});
	executeMocks.transferSuiExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: { digest: "0xexec" },
	});
	executeMocks.transferCoinExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: { digest: "0xexec-coin" },
	});
	executeMocks.swapCetusExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: { digest: "0xexec-swap" },
	});
	executeMocks.cetusAddLiquidityExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: { digest: "0xexec-add-liquidity" },
	});
	executeMocks.cetusRemoveLiquidityExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: { digest: "0xexec-remove-liquidity" },
	});
	executeMocks.stableLayerMintExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: { digest: "0xexec-stable-mint" },
	});
	executeMocks.stableLayerBurnExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: { digest: "0xexec-stable-burn" },
	});
	executeMocks.stableLayerClaimExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: { digest: "0xexec-stable-claim" },
	});
	cetusMocks.createAddLiquidityFixTokenPayload.mockResolvedValue({
		setSender: vi.fn(),
	});
	cetusMocks.removeLiquidityTransactionPayload.mockResolvedValue({
		setSender: vi.fn(),
	});
	stableLayerMocks.resolveStableLayerNetwork.mockReturnValue("mainnet");
	stableLayerMocks.buildStableLayerMintTransaction.mockResolvedValue({
		setSender: vi.fn(),
	});
	stableLayerMocks.buildStableLayerBurnTransaction.mockResolvedValue({
		setSender: vi.fn(),
	});
	stableLayerMocks.buildStableLayerClaimTransaction.mockResolvedValue({
		setSender: vi.fn(),
	});
});

describe("w3rt_run_sui_workflow_v0", () => {
	it("analyzes intentText and returns confirmToken", async () => {
		const tool = getTool();
		const destination =
			"0x2222222222222222222222222222222222222222222222222222222222222222";
		const result = await tool.execute("wf1", {
			runId: "wf-sui-01",
			runMode: "analysis",
			network: "mainnet",
			intentText: `请转 0.000001 SUI 到 ${destination}`,
		});

		expect(result.content[0]?.text).toContain("Workflow analyzed");
		expect(result.details).toMatchObject({
			runId: "wf-sui-01",
			intentType: "sui.transfer.sui",
			intent: {
				type: "sui.transfer.sui",
				toAddress: destination,
			},
		});
		expect(
			(result.details as { confirmToken?: string }).confirmToken?.startsWith(
				"SUI-",
			),
		).toBe(true);
	});

	it("simulates transaction and returns artifacts", async () => {
		const tool = getTool();
		const destination =
			"0x2222222222222222222222222222222222222222222222222222222222222222";
		const result = await tool.execute("wf2", {
			runId: "wf-sui-02",
			runMode: "simulate",
			intentType: "sui.transfer.sui",
			network: "mainnet",
			toAddress: destination,
			amountSui: 0.000001,
		});

		const client = runtimeMocks.getSuiClient.mock.results[0]?.value as {
			devInspectTransactionBlock: ReturnType<typeof vi.fn>;
		};
		expect(client.devInspectTransactionBlock).toHaveBeenCalledTimes(1);
		expect(result.content[0]?.text).toContain("Workflow simulated");
		expect(result.details).toMatchObject({
			intentType: "sui.transfer.sui",
			artifacts: {
				simulate: {
					status: "success",
				},
			},
		});
	});

	it("blocks mainnet execute when confirmMainnet is missing", async () => {
		const tool = getTool();
		const destination =
			"0x2222222222222222222222222222222222222222222222222222222222222222";
		await expect(
			tool.execute("wf3", {
				runId: "wf-sui-03",
				runMode: "execute",
				intentType: "sui.transfer.sui",
				network: "mainnet",
				toAddress: destination,
				amountSui: 0.000001,
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(executeMocks.transferSuiExecute).not.toHaveBeenCalled();
	});

	it("executes after confirmMainnet + correct confirmToken", async () => {
		const tool = getTool();
		const destination =
			"0x2222222222222222222222222222222222222222222222222222222222222222";
		const analysis = await tool.execute("wf4-analysis", {
			runId: "wf-sui-04",
			runMode: "analysis",
			intentType: "sui.transfer.sui",
			network: "mainnet",
			toAddress: destination,
			amountSui: 0.000001,
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;

		const execute = await tool.execute("wf4-execute", {
			runId: "wf-sui-04",
			runMode: "execute",
			intentType: "sui.transfer.sui",
			network: "mainnet",
			toAddress: destination,
			amountSui: 0.000001,
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.transferSuiExecute).toHaveBeenCalledTimes(1);
		expect(execute.content[0]?.text).toContain("Workflow executed");
		expect(execute.details).toMatchObject({
			intentType: "sui.transfer.sui",
			artifacts: {
				execute: {
					digest: "0xexec",
				},
			},
		});
	});

	it("analyzes LP add intentText with minimal structured fields", async () => {
		const tool = getTool();
		const poolId =
			"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const positionId =
			"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
		const result = await tool.execute("wf5", {
			runId: "wf-sui-05",
			runMode: "analysis",
			network: "mainnet",
			intentText: `add liquidity pool: ${poolId} position: ${positionId} 0x2::sui::SUI 0x2::usdc::USDC tick: -100 to 100 amountA: 1000 amountB: 2000`,
		});

		expect(result.details).toMatchObject({
			intentType: "sui.lp.cetus.add",
			intent: {
				type: "sui.lp.cetus.add",
				poolId,
				positionId,
				coinTypeA: "0x2::sui::SUI",
				coinTypeB: "0x2::usdc::USDC",
				tickLower: -100,
				tickUpper: 100,
				amountA: "1000",
				amountB: "2000",
			},
		});
	});

	it("simulates LP add and returns simulation artifacts", async () => {
		const tool = getTool();
		const poolId =
			"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
		const positionId =
			"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
		const result = await tool.execute("wf6", {
			runId: "wf-sui-06",
			runMode: "simulate",
			intentType: "sui.lp.cetus.add",
			network: "mainnet",
			poolId,
			positionId,
			coinTypeA: "0x2::sui::SUI",
			coinTypeB: "0x2::usdc::USDC",
			tickLower: -120,
			tickUpper: 120,
			amountA: "1500",
			amountB: "2500",
		});

		expect(cetusMocks.initCetusSDK).toHaveBeenCalledWith({
			network: "mainnet",
			fullNodeUrl: "https://fullnode.mainnet.sui.io:443",
			wallet:
				"0x1111111111111111111111111111111111111111111111111111111111111111",
		});
		expect(cetusMocks.createAddLiquidityFixTokenPayload).toHaveBeenCalledTimes(
			1,
		);
		expect(result.details).toMatchObject({
			intentType: "sui.lp.cetus.add",
			artifacts: {
				simulate: {
					status: "success",
					poolId,
					positionId,
					amountA: "1500",
					amountB: "2500",
				},
			},
		});
	});

	it("executes LP remove after mainnet confirmation", async () => {
		const tool = getTool();
		const poolId =
			"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
		const positionId =
			"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
		const baseParams = {
			runId: "wf-sui-07",
			intentType: "sui.lp.cetus.remove" as const,
			network: "mainnet",
			poolId,
			positionId,
			coinTypeA: "0x2::sui::SUI",
			coinTypeB: "0x2::usdc::USDC",
			deltaLiquidity: "999",
			minAmountA: "10",
			minAmountB: "20",
		};
		const analysis = await tool.execute("wf7-analysis", {
			...baseParams,
			runMode: "analysis",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;

		const execute = await tool.execute("wf7-execute", {
			...baseParams,
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.cetusRemoveLiquidityExecute).toHaveBeenCalledTimes(1);
		expect(execute.details).toMatchObject({
			intentType: "sui.lp.cetus.remove",
			artifacts: {
				execute: {
					digest: "0xexec-remove-liquidity",
				},
			},
		});
	});
});

describe("w3rt_run_sui_stablelayer_workflow_v0", () => {
	it("analyzes stable layer mint intentText and returns confirmToken", async () => {
		const tool = getTool("w3rt_run_sui_stablelayer_workflow_v0");
		const result = await tool.execute("stable-wf-1", {
			runId: "wf-sui-stable-01",
			runMode: "analysis",
			network: "mainnet",
			intentText:
				"mint stable coin 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa::btc_usdc::BtcUSDC amount 1000000",
		});

		expect(result.content[0]?.text).toContain("Workflow analyzed");
		expect(result.details).toMatchObject({
			runId: "wf-sui-stable-01",
			intentType: "sui.stablelayer.mint",
			intent: {
				type: "sui.stablelayer.mint",
				amountUsdcRaw: "1000000",
			},
		});
	});

	it("simulates stable layer mint and returns artifacts", async () => {
		const tool = getTool("w3rt_run_sui_stablelayer_workflow_v0");
		const result = await tool.execute("stable-wf-2", {
			runId: "wf-sui-stable-02",
			runMode: "simulate",
			intentType: "sui.stablelayer.mint",
			network: "mainnet",
			stableCoinType:
				"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa::btc_usdc::BtcUSDC",
			amountUsdcRaw: "1000000",
		});

		expect(stableLayerMocks.buildStableLayerMintTransaction).toHaveBeenCalled();
		expect(result.details).toMatchObject({
			intentType: "sui.stablelayer.mint",
			artifacts: {
				simulate: {
					status: "success",
					amountUsdcRaw: "1000000",
				},
			},
		});
	});

	it("executes stable layer burn after mainnet confirmation", async () => {
		const tool = getTool("w3rt_run_sui_stablelayer_workflow_v0");
		const baseParams = {
			runId: "wf-sui-stable-03",
			intentType: "sui.stablelayer.burn" as const,
			network: "mainnet",
			stableCoinType:
				"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa::btc_usdc::BtcUSDC",
			amountStableRaw: "500000",
		};
		const analysis = await tool.execute("stable-wf-3-analysis", {
			...baseParams,
			runMode: "analysis",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;

		const execute = await tool.execute("stable-wf-3-execute", {
			...baseParams,
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.stableLayerBurnExecute).toHaveBeenCalledTimes(1);
		expect(execute.details).toMatchObject({
			intentType: "sui.stablelayer.burn",
			artifacts: {
				execute: {
					digest: "0xexec-stable-burn",
				},
			},
		});
	});
});
