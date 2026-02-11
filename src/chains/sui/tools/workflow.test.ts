import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	getSuiClient: vi.fn(),
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
	return {
		transferSuiExecute,
		transferCoinExecute,
		swapCetusExecute,
	};
});

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		getSuiClient: runtimeMocks.getSuiClient,
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
	],
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

import { createSuiWorkflowTools } from "./workflow.js";

type WorkflowTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(): WorkflowTool {
	const tool = createSuiWorkflowTools().find(
		(entry) => entry.name === "w3rt_run_sui_workflow_v0",
	);
	if (!tool) throw new Error("w3rt_run_sui_workflow_v0 not found");
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
});
