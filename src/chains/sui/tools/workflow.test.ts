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
	const cetusFarmsStakeExecute = vi.fn();
	const cetusFarmsUnstakeExecute = vi.fn();
	const cetusFarmsHarvestExecute = vi.fn();
	const stableLayerMintExecute = vi.fn();
	const stableLayerBurnExecute = vi.fn();
	const stableLayerClaimExecute = vi.fn();
	return {
		transferSuiExecute,
		transferCoinExecute,
		swapCetusExecute,
		cetusAddLiquidityExecute,
		cetusRemoveLiquidityExecute,
		cetusFarmsStakeExecute,
		cetusFarmsUnstakeExecute,
		cetusFarmsHarvestExecute,
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

const cetusV2Mocks = vi.hoisted(() => ({
	resolveCetusV2Network: vi.fn(() => "mainnet"),
	buildCetusFarmsStakeTransaction: vi.fn(),
	buildCetusFarmsUnstakeTransaction: vi.fn(),
	buildCetusFarmsHarvestTransaction: vi.fn(),
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
			name: "sui_cetusFarmsStake",
			label: "cetus farms stake",
			description: "cetus farms stake",
			parameters: {},
			execute: executeMocks.cetusFarmsStakeExecute,
		},
		{
			name: "sui_cetusFarmsUnstake",
			label: "cetus farms unstake",
			description: "cetus farms unstake",
			parameters: {},
			execute: executeMocks.cetusFarmsUnstakeExecute,
		},
		{
			name: "sui_cetusFarmsHarvest",
			label: "cetus farms harvest",
			description: "cetus farms harvest",
			parameters: {},
			execute: executeMocks.cetusFarmsHarvestExecute,
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

vi.mock("../cetus-v2.js", () => ({
	resolveCetusV2Network: cetusV2Mocks.resolveCetusV2Network,
	buildCetusFarmsStakeTransaction: cetusV2Mocks.buildCetusFarmsStakeTransaction,
	buildCetusFarmsUnstakeTransaction:
		cetusV2Mocks.buildCetusFarmsUnstakeTransaction,
	buildCetusFarmsHarvestTransaction:
		cetusV2Mocks.buildCetusFarmsHarvestTransaction,
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
	executeMocks.cetusFarmsStakeExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: { digest: "0xexec-cetus-farms-stake" },
	});
	executeMocks.cetusFarmsUnstakeExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: { digest: "0xexec-cetus-farms-unstake" },
	});
	executeMocks.cetusFarmsHarvestExecute.mockResolvedValue({
		content: [{ type: "text", text: "ok" }],
		details: { digest: "0xexec-cetus-farms-harvest" },
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
	cetusV2Mocks.resolveCetusV2Network.mockReturnValue("mainnet");
	cetusV2Mocks.buildCetusFarmsStakeTransaction.mockResolvedValue({
		setSender: vi.fn(),
	});
	cetusV2Mocks.buildCetusFarmsUnstakeTransaction.mockResolvedValue({
		setSender: vi.fn(),
	});
	cetusV2Mocks.buildCetusFarmsHarvestTransaction.mockResolvedValue({
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
			artifacts: {
				analysis: {
					summaryLine: expect.stringContaining(
						"sui.transfer.sui analysis=ready",
					),
				},
			},
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
					summaryLine: expect.stringContaining(
						"sui.transfer.sui simulate=success",
					),
				},
			},
		});
	});

	it("parses swap intentText with symbol pair and ui amount", async () => {
		const tool = getTool();
		const result = await tool.execute("wf2b", {
			runId: "wf-sui-02b",
			runMode: "analysis",
			network: "mainnet",
			intentText: "在 Sui 主网把 1.25 SUI 换成 USDC",
		});

		expect(result.details).toMatchObject({
			intentType: "sui.swap.cetus",
			intent: {
				type: "sui.swap.cetus",
				inputCoinType: "0x2::sui::SUI",
				outputCoinType: stableLayerMocks.STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
				amountRaw: "1250000000",
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
		expect(execute.content[0]?.text).toContain("sui.transfer.sui executed");
		expect(execute.details).toMatchObject({
			intentType: "sui.transfer.sui",
			artifacts: {
				execute: {
					digest: "0xexec",
					summaryLine: expect.stringContaining("sui.transfer.sui executed"),
				},
			},
		});
	});

	it("supports natural follow-up execute using latest simulated session", async () => {
		const tool = getTool();
		const destination =
			"0x2222222222222222222222222222222222222222222222222222222222222222";
		const simulated = await tool.execute("wf-followup-sim", {
			runMode: "simulate",
			network: "mainnet",
			intentType: "sui.transfer.sui",
			toAddress: destination,
			amountSui: 0.000001,
		});
		expect(simulated.content[0]?.text).toContain("unsignedPayload");

		const executed = await tool.execute("wf-followup-exec", {
			runMode: "execute",
			confirmMainnet: true,
		});

		expect(executeMocks.transferSuiExecute).toHaveBeenCalledTimes(1);
		expect(executed.details).toMatchObject({
			intentType: "sui.transfer.sui",
			artifacts: {
				execute: {
					digest: "0xexec",
				},
			},
		});
		expect(executed.details).toMatchObject({
			runId: (simulated.details as { runId: string }).runId,
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

	it("parses LP add intentText with short addresses and a/b shorthand", async () => {
		const tool = getTool();
		const result = await tool.execute("wf5b", {
			runId: "wf-sui-05b",
			runMode: "analysis",
			network: "mainnet",
			intentText:
				"provide liquidity pool: 0xabc position: 0xdef 0x2::sui::SUI 0x2::usdc::USDC tick: -5 to 5 a: 10 b: 20",
		});

		expect(result.details).toMatchObject({
			intentType: "sui.lp.cetus.add",
			intent: {
				type: "sui.lp.cetus.add",
				poolId: "0xabc",
				positionId: "0xdef",
				coinTypeA: "0x2::sui::SUI",
				coinTypeB: "0x2::usdc::USDC",
				tickLower: -5,
				tickUpper: 5,
				amountA: "10",
				amountB: "20",
			},
		});
	});

	it("parses LP add intentText with symbol pair", async () => {
		const tool = getTool();
		const result = await tool.execute("wf5c", {
			runId: "wf-sui-05c",
			runMode: "analysis",
			network: "mainnet",
			intentText:
				"添加流动性 pool: 0xabc position: 0xdef SUI/USDC tick: -5 to 5 amountA: 10 amountB: 20",
		});

		expect(result.details).toMatchObject({
			intentType: "sui.lp.cetus.add",
			intent: {
				type: "sui.lp.cetus.add",
				poolId: "0xabc",
				positionId: "0xdef",
				coinTypeA: "0x2::sui::SUI",
				coinTypeB: stableLayerMocks.STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
				tickLower: -5,
				tickUpper: 5,
				amountA: "10",
				amountB: "20",
			},
		});
	});

	it("resolves symbol input/output coin types from structured params", async () => {
		const tool = getTool();
		const result = await tool.execute("wf5d", {
			runId: "wf-sui-05d",
			runMode: "analysis",
			intentType: "sui.swap.cetus",
			network: "mainnet",
			inputCoinType: "SUI",
			outputCoinType: "USDC",
			amountRaw: "1000000",
		});

		expect(result.details).toMatchObject({
			intentType: "sui.swap.cetus",
			intent: {
				type: "sui.swap.cetus",
				inputCoinType: "0x2::sui::SUI",
				outputCoinType: stableLayerMocks.STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
				amountRaw: "1000000",
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
					summaryLine: expect.stringContaining(
						"sui.stablelayer.mint simulate=success",
					),
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
					summaryLine: expect.stringContaining("sui.stablelayer.burn executed"),
				},
			},
		});
	});
});

describe("w3rt_run_sui_cetus_farms_workflow_v0", () => {
	it("analyzes farms stake intentText and returns confirmToken", async () => {
		const tool = getTool("w3rt_run_sui_cetus_farms_workflow_v0");
		const poolId =
			"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const clmmPositionId =
			"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
		const clmmPoolId =
			"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
		const result = await tool.execute("cetus-farms-wf-1", {
			runId: "wf-sui-cetus-farms-01",
			runMode: "analysis",
			network: "mainnet",
			intentText: `stake farm pool: ${poolId} position: ${clmmPositionId} clmmPoolId: ${clmmPoolId} 0x2::sui::SUI 0x2::usdc::USDC`,
		});

		expect(result.content[0]?.text).toContain("Workflow analyzed");
		expect(result.details).toMatchObject({
			runId: "wf-sui-cetus-farms-01",
			intentType: "sui.cetus.farms.stake",
			intent: {
				type: "sui.cetus.farms.stake",
				poolId,
				clmmPositionId,
				clmmPoolId,
				coinTypeA: "0x2::sui::SUI",
				coinTypeB: "0x2::usdc::USDC",
			},
		});
		expect(
			(result.details as { confirmToken?: string }).confirmToken?.startsWith(
				"SUI-",
			),
		).toBe(true);
	});

	it("parses farms stake intentText with symbol pair", async () => {
		const tool = getTool("w3rt_run_sui_cetus_farms_workflow_v0");
		const poolId =
			"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const clmmPositionId =
			"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
		const clmmPoolId =
			"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
		const result = await tool.execute("cetus-farms-wf-1b", {
			runId: "wf-sui-cetus-farms-01b",
			runMode: "analysis",
			network: "mainnet",
			intentText: `stake farm pool: ${poolId} position: ${clmmPositionId} clmmPoolId: ${clmmPoolId} SUI/USDC`,
		});

		expect(result.details).toMatchObject({
			intentType: "sui.cetus.farms.stake",
			intent: {
				type: "sui.cetus.farms.stake",
				poolId,
				clmmPositionId,
				clmmPoolId,
				coinTypeA: "0x2::sui::SUI",
				coinTypeB: stableLayerMocks.STABLE_LAYER_DEFAULT_USDC_COIN_TYPE,
			},
		});
	});

	it("simulates farms unstake and returns artifacts", async () => {
		const tool = getTool("w3rt_run_sui_cetus_farms_workflow_v0");
		const poolId =
			"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
		const positionNftId =
			"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
		const result = await tool.execute("cetus-farms-wf-2", {
			runId: "wf-sui-cetus-farms-02",
			runMode: "simulate",
			intentType: "sui.cetus.farms.unstake",
			network: "mainnet",
			poolId,
			positionNftId,
		});

		expect(cetusV2Mocks.buildCetusFarmsUnstakeTransaction).toHaveBeenCalledWith(
			{
				network: "mainnet",
				rpcUrl: undefined,
				sender:
					"0x1111111111111111111111111111111111111111111111111111111111111111",
				poolId,
				positionNftId,
			},
		);
		expect(result.details).toMatchObject({
			intentType: "sui.cetus.farms.unstake",
			artifacts: {
				simulate: {
					status: "success",
					poolId,
					positionNftId,
					summaryLine: expect.stringContaining(
						"sui.cetus.farms.unstake simulate=success",
					),
				},
			},
		});
	});

	it("executes farms harvest after mainnet confirmation", async () => {
		const tool = getTool("w3rt_run_sui_cetus_farms_workflow_v0");
		const baseParams = {
			runId: "wf-sui-cetus-farms-03",
			intentType: "sui.cetus.farms.harvest" as const,
			network: "mainnet",
			poolId:
				"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
			positionNftId:
				"0x9999999999999999999999999999999999999999999999999999999999999999",
		};
		const analysis = await tool.execute("cetus-farms-wf-3-analysis", {
			...baseParams,
			runMode: "analysis",
		});
		const token = (analysis.details as { confirmToken: string }).confirmToken;
		const execute = await tool.execute("cetus-farms-wf-3-execute", {
			...baseParams,
			runMode: "execute",
			confirmMainnet: true,
			confirmToken: token,
		});

		expect(executeMocks.cetusFarmsHarvestExecute).toHaveBeenCalledTimes(1);
		expect(execute.details).toMatchObject({
			intentType: "sui.cetus.farms.harvest",
			artifacts: {
				execute: {
					digest: "0xexec-cetus-farms-harvest",
					summaryLine: expect.stringContaining(
						"sui.cetus.farms.harvest executed",
					),
				},
			},
		});
	});

	it("parses farms harvest intentText with short addresses", async () => {
		const tool = getTool("w3rt_run_sui_cetus_farms_workflow_v0");
		const result = await tool.execute("cetus-farms-wf-4", {
			runId: "wf-sui-cetus-farms-04",
			runMode: "analysis",
			network: "mainnet",
			intentText: "claim reward farm pool: 0xabc nft: 0xdef",
		});

		expect(result.details).toMatchObject({
			intentType: "sui.cetus.farms.harvest",
			intent: {
				type: "sui.cetus.farms.harvest",
				poolId: "0xabc",
				positionNftId: "0xdef",
			},
		});
	});
});

describe("w3rt_run_sui_defi_workflow_v0", () => {
	it("routes stablelayer intent to stablelayer workflow", async () => {
		const tool = getTool("w3rt_run_sui_defi_workflow_v0");
		const result = await tool.execute("sui-defi-wf-1", {
			runId: "wf-sui-defi-01",
			runMode: "analysis",
			intentType: "sui.stablelayer.claim",
			network: "mainnet",
			stableCoinType:
				"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa::btc_usdc::BtcUSDC",
		});

		expect(result.details).toMatchObject({
			intentType: "sui.stablelayer.claim",
			routedWorkflow: "w3rt_run_sui_stablelayer_workflow_v0",
		});
	});

	it("routes farms intent text to cetus farms workflow", async () => {
		const tool = getTool("w3rt_run_sui_defi_workflow_v0");
		const result = await tool.execute("sui-defi-wf-2", {
			runId: "wf-sui-defi-02",
			runMode: "analysis",
			intentText:
				"claim farm rewards pool: 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa nft: 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			network: "mainnet",
			poolId:
				"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			positionNftId:
				"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		});

		expect(result.details).toMatchObject({
			intentType: "sui.cetus.farms.harvest",
			routedWorkflow: "w3rt_run_sui_cetus_farms_workflow_v0",
		});
	});

	it("routes generic transfer intent to core sui workflow", async () => {
		const tool = getTool("w3rt_run_sui_defi_workflow_v0");
		const destination =
			"0x2222222222222222222222222222222222222222222222222222222222222222";
		const result = await tool.execute("sui-defi-wf-3", {
			runId: "wf-sui-defi-03",
			runMode: "analysis",
			intentType: "sui.transfer.sui",
			network: "mainnet",
			toAddress: destination,
			amountSui: 0.000001,
		});

		expect(result.details).toMatchObject({
			intentType: "sui.transfer.sui",
			routedWorkflow: "w3rt_run_sui_workflow_v0",
		});
	});
});
