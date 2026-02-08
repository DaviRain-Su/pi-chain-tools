import { Keypair } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	assertJupiterNetworkSupported: vi.fn(),
	buildJupiterSwapTransaction: vi.fn(),
	commitmentSchema: vi.fn(),
	getConnection: vi.fn(),
	getExplorerAddressUrl: vi.fn(),
	getExplorerTransactionUrl: vi.fn(),
	getJupiterApiBaseUrl: vi.fn(() => "https://lite-api.jup.ag"),
	getJupiterQuote: vi.fn(),
	jupiterPriorityLevelSchema: vi.fn(),
	jupiterSwapModeSchema: vi.fn(),
	normalizeAtPath: vi.fn((value: string) => value),
	parseFinality: vi.fn(() => "confirmed"),
	parseJupiterPriorityLevel: vi.fn(() => "veryHigh"),
	parseJupiterSwapMode: vi.fn(() => "ExactIn"),
	parseNetwork: vi.fn(() => "devnet"),
	parsePositiveBigInt: vi.fn((value: string) => BigInt(value)),
	parseTransactionFromBase64: vi.fn(),
	resolveSecretKey: vi.fn(),
	solanaNetworkSchema: vi.fn(),
	toLamports: vi.fn((value: number) => Math.round(value * 1_000_000_000)),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		assertJupiterNetworkSupported: runtimeMocks.assertJupiterNetworkSupported,
		buildJupiterSwapTransaction: runtimeMocks.buildJupiterSwapTransaction,
		commitmentSchema: runtimeMocks.commitmentSchema,
		getConnection: runtimeMocks.getConnection,
		getExplorerAddressUrl: runtimeMocks.getExplorerAddressUrl,
		getExplorerTransactionUrl: runtimeMocks.getExplorerTransactionUrl,
		getJupiterApiBaseUrl: runtimeMocks.getJupiterApiBaseUrl,
		getJupiterQuote: runtimeMocks.getJupiterQuote,
		jupiterPriorityLevelSchema: runtimeMocks.jupiterPriorityLevelSchema,
		jupiterSwapModeSchema: runtimeMocks.jupiterSwapModeSchema,
		normalizeAtPath: runtimeMocks.normalizeAtPath,
		parseFinality: runtimeMocks.parseFinality,
		parseJupiterPriorityLevel: runtimeMocks.parseJupiterPriorityLevel,
		parseJupiterSwapMode: runtimeMocks.parseJupiterSwapMode,
		parseNetwork: runtimeMocks.parseNetwork,
		parsePositiveBigInt: runtimeMocks.parsePositiveBigInt,
		parseTransactionFromBase64: runtimeMocks.parseTransactionFromBase64,
		resolveSecretKey: runtimeMocks.resolveSecretKey,
		solanaNetworkSchema: runtimeMocks.solanaNetworkSchema,
		toLamports: runtimeMocks.toLamports,
	};
});

import { createSolanaWorkflowTools } from "./workflow.js";

function getWorkflowTool() {
	const tool = createSolanaWorkflowTools().find(
		(entry) => entry.name === "w3rt_run_workflow_v0",
	);
	if (!tool) throw new Error("w3rt_run_workflow_v0 not found");
	return tool;
}

describe("w3rt_run_workflow_v0", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		runtimeMocks.parseFinality.mockReturnValue("confirmed");
		runtimeMocks.getExplorerAddressUrl.mockReturnValue(
			"https://explorer/signer",
		);
		runtimeMocks.getExplorerTransactionUrl.mockReturnValue(
			"https://explorer/tx",
		);
	});

	it("returns analysis artifacts without touching RPC in analysis mode", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const destination = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf1", {
			runId: "run-analysis",
			intentType: "solana.transfer.sol",
			runMode: "analysis",
			toAddress: destination,
			amountSol: 0.01,
		});

		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			runId: "run-analysis",
			status: "analysis",
		});
		expect(
			(
				result.details as {
					artifacts?: { analysis?: { intent?: { type?: string } } };
				}
			).artifacts?.analysis?.intent?.type,
		).toBe("solana.transfer.sol");
	});

	it("enforces mainnet confirm token before execute", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const destination = Keypair.generate().publicKey.toBase58();
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 1,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 123,
				},
			}),
			sendRawTransaction: vi.fn().mockResolvedValue("signature-1"),
			confirmTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const simulated = await tool.execute("wf2", {
			runId: "run-mainnet",
			intentType: "solana.transfer.sol",
			runMode: "simulate",
			toAddress: destination,
			amountSol: 0.02,
		});
		const confirmToken = (
			simulated.details as {
				artifacts?: { approval?: { confirmToken?: string | null } };
			}
		).artifacts?.approval?.confirmToken;
		if (!confirmToken) throw new Error("confirmToken not returned");

		await expect(
			tool.execute("wf3", {
				runId: "run-mainnet",
				intentType: "solana.transfer.sol",
				runMode: "execute",
				toAddress: destination,
				amountSol: 0.02,
			}),
		).rejects.toThrow("confirmMainnet=true");

		await expect(
			tool.execute("wf4", {
				runId: "run-mainnet",
				intentType: "solana.transfer.sol",
				runMode: "execute",
				toAddress: destination,
				amountSol: 0.02,
				confirmMainnet: true,
				confirmToken: "SOL-WRONGTOKEN",
			}),
		).rejects.toThrow("Invalid confirmToken");

		const executed = await tool.execute("wf5", {
			runId: "run-mainnet",
			intentType: "solana.transfer.sol",
			runMode: "execute",
			toAddress: destination,
			amountSol: 0.02,
			confirmMainnet: true,
			confirmToken,
		});
		expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(executed.details).toMatchObject({
			runId: "run-mainnet",
			status: "executed",
		});
	});
});
