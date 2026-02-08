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

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

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

	it("parses transfer intentText and infers intentType", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const destination = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-transfer", {
			runId: "run-intent-transfer",
			runMode: "analysis",
			intentText: `请把 0.000001 SOL 转到 ${destination}`,
		});

		expect(runtimeMocks.toLamports).toHaveBeenCalledWith(0.000001);
		expect(result.details).toMatchObject({
			runId: "run-intent-transfer",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.transfer.sol",
						toAddress: destination,
						amountSol: 0.000001,
					},
				},
			},
		});
	});

	it("uses explicit fields over parsed intentText fields", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const parsedDestination = Keypair.generate().publicKey.toBase58();
		const explicitDestination = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-override", {
			runId: "run-intent-override",
			runMode: "analysis",
			intentText: `transfer 1 SOL to ${parsedDestination}`,
			intentType: "solana.transfer.sol",
			toAddress: explicitDestination,
			amountSol: 0.25,
		});

		expect(runtimeMocks.toLamports).toHaveBeenCalledWith(0.25);
		expect(result.details).toMatchObject({
			runId: "run-intent-override",
			artifacts: {
				analysis: {
					intent: {
						toAddress: explicitDestination,
						amountSol: 0.25,
					},
				},
			},
		});
	});

	it("parses swap intentText and derives amountRaw from SOL amount", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-swap", {
			runId: "run-intent-swap",
			runMode: "analysis",
			intentText: "swap 0.1 SOL to USDC slippageBps=50",
		});

		expect(runtimeMocks.toLamports).toHaveBeenCalledWith(0.1);
		expect(result.details).toMatchObject({
			runId: "run-intent-swap",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.swap.jupiter",
						inputMint: SOL_MINT,
						outputMint: USDC_MINT,
						amountRaw: "100000000",
						slippageBps: 50,
					},
				},
			},
		});
	});

	it("parses USDC ui amount and slippage percent from intentText", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-swap-usdc", {
			runId: "run-intent-swap-usdc",
			runMode: "analysis",
			intentText: "swap 1.25 USDC to SOL slippage 0.5%",
		});

		expect(result.details).toMatchObject({
			runId: "run-intent-swap-usdc",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.swap.jupiter",
						inputMint: USDC_MINT,
						outputMint: SOL_MINT,
						amountRaw: "1250000",
						slippageBps: 50,
					},
				},
			},
		});
	});

	it("supports structured amountUi for known-token swaps", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-amount-ui", {
			runId: "run-amount-ui",
			runMode: "analysis",
			intentType: "solana.swap.jupiter",
			inputMint: "USDT",
			outputMint: "USDC",
			amountUi: "2.5",
		});

		expect(result.details).toMatchObject({
			runId: "run-amount-ui",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.swap.jupiter",
						inputMint: USDT_MINT,
						outputMint: USDC_MINT,
						amountRaw: "2500000",
					},
				},
			},
		});
	});

	it("derives amountRaw from on-chain mint decimals for unknown token mints", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const unknownMint = Keypair.generate().publicKey.toBase58();
		const connection = {
			getParsedAccountInfo: vi.fn().mockResolvedValue({
				value: {
					data: {
						parsed: {
							info: {
								decimals: 8,
							},
						},
					},
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-amount-ui-unknown", {
			runId: "run-amount-ui-unknown",
			runMode: "analysis",
			intentType: "solana.swap.jupiter",
			inputMint: unknownMint,
			outputMint: "USDC",
			amountUi: "1.25",
		});

		expect(connection.getParsedAccountInfo).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			runId: "run-amount-ui-unknown",
			artifacts: {
				analysis: {
					intent: {
						inputMint: unknownMint,
						amountRaw: "125000000",
					},
				},
			},
		});
	});

	it("fails clearly when mint decimals cannot be resolved", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const unknownMint = Keypair.generate().publicKey.toBase58();
		const connection = {
			getParsedAccountInfo: vi.fn().mockResolvedValue({
				value: null,
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-amount-ui-missing-mint", {
				runId: "run-amount-ui-missing-mint",
				runMode: "analysis",
				intentType: "solana.swap.jupiter",
				inputMint: unknownMint,
				outputMint: "USDC",
				amountUi: "1",
			}),
		).rejects.toThrow("mint account not found");
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
