import { Keypair } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	assertRaydiumNetworkSupported: vi.fn(),
	assertJupiterNetworkSupported: vi.fn(),
	buildJupiterSwapTransaction: vi.fn(),
	buildRaydiumSwapTransactions: vi.fn(),
	callJupiterApi: vi.fn(),
	commitmentSchema: vi.fn(),
	getConnection: vi.fn(),
	getExplorerAddressUrl: vi.fn(),
	getExplorerTransactionUrl: vi.fn(),
	getJupiterApiBaseUrl: vi.fn(() => "https://lite-api.jup.ag"),
	getJupiterQuote: vi.fn(),
	getRaydiumApiBaseUrl: vi.fn(() => "https://raydium.api"),
	getRaydiumPriorityFee: vi.fn(),
	getRaydiumPriorityFeeMicroLamports: vi.fn(() => "1000"),
	getRaydiumQuote: vi.fn(),
	getSplTokenProgramId: vi.fn(),
	jupiterPriorityLevelSchema: vi.fn(),
	jupiterSwapModeSchema: vi.fn(),
	normalizeAtPath: vi.fn((value: string) => value),
	parseFinality: vi.fn(() => "confirmed"),
	parseJupiterPriorityLevel: vi.fn(() => "veryHigh"),
	parseJupiterSwapMode: vi.fn(() => "ExactIn"),
	parseNetwork: vi.fn(() => "devnet"),
	parsePositiveBigInt: vi.fn((value: string) => BigInt(value)),
	parseRaydiumSwapType: vi.fn(() => "BaseIn"),
	parseRaydiumTxVersion: vi.fn(() => "V0"),
	parseSplTokenProgram: vi.fn(() => "token"),
	parseTransactionFromBase64: vi.fn(),
	raydiumSwapTypeSchema: vi.fn(),
	raydiumTxVersionSchema: vi.fn(),
	resolveSecretKey: vi.fn(),
	solanaNetworkSchema: vi.fn(),
	splTokenProgramSchema: vi.fn(),
	stringifyUnknown: vi.fn((value: unknown) => String(value)),
	toLamports: vi.fn((value: number) => Math.round(value * 1_000_000_000)),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		assertRaydiumNetworkSupported: runtimeMocks.assertRaydiumNetworkSupported,
		assertJupiterNetworkSupported: runtimeMocks.assertJupiterNetworkSupported,
		buildJupiterSwapTransaction: runtimeMocks.buildJupiterSwapTransaction,
		buildRaydiumSwapTransactions: runtimeMocks.buildRaydiumSwapTransactions,
		callJupiterApi: runtimeMocks.callJupiterApi,
		commitmentSchema: runtimeMocks.commitmentSchema,
		getConnection: runtimeMocks.getConnection,
		getExplorerAddressUrl: runtimeMocks.getExplorerAddressUrl,
		getExplorerTransactionUrl: runtimeMocks.getExplorerTransactionUrl,
		getJupiterApiBaseUrl: runtimeMocks.getJupiterApiBaseUrl,
		getJupiterQuote: runtimeMocks.getJupiterQuote,
		getRaydiumApiBaseUrl: runtimeMocks.getRaydiumApiBaseUrl,
		getRaydiumPriorityFee: runtimeMocks.getRaydiumPriorityFee,
		getRaydiumPriorityFeeMicroLamports:
			runtimeMocks.getRaydiumPriorityFeeMicroLamports,
		getRaydiumQuote: runtimeMocks.getRaydiumQuote,
		getSplTokenProgramId: runtimeMocks.getSplTokenProgramId,
		jupiterPriorityLevelSchema: runtimeMocks.jupiterPriorityLevelSchema,
		jupiterSwapModeSchema: runtimeMocks.jupiterSwapModeSchema,
		normalizeAtPath: runtimeMocks.normalizeAtPath,
		parseFinality: runtimeMocks.parseFinality,
		parseJupiterPriorityLevel: runtimeMocks.parseJupiterPriorityLevel,
		parseJupiterSwapMode: runtimeMocks.parseJupiterSwapMode,
		parseNetwork: runtimeMocks.parseNetwork,
		parsePositiveBigInt: runtimeMocks.parsePositiveBigInt,
		parseRaydiumSwapType: runtimeMocks.parseRaydiumSwapType,
		parseRaydiumTxVersion: runtimeMocks.parseRaydiumTxVersion,
		parseSplTokenProgram: runtimeMocks.parseSplTokenProgram,
		parseTransactionFromBase64: runtimeMocks.parseTransactionFromBase64,
		raydiumSwapTypeSchema: runtimeMocks.raydiumSwapTypeSchema,
		raydiumTxVersionSchema: runtimeMocks.raydiumTxVersionSchema,
		resolveSecretKey: runtimeMocks.resolveSecretKey,
		solanaNetworkSchema: runtimeMocks.solanaNetworkSchema,
		splTokenProgramSchema: runtimeMocks.splTokenProgramSchema,
		stringifyUnknown: runtimeMocks.stringifyUnknown,
		toLamports: runtimeMocks.toLamports,
	};
});

import { createSolanaWorkflowTools } from "./workflow.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const RAY_MINT = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";

function makeParsedTokenAccount(
	owner: string,
	mint: string,
	amountRaw: string,
	decimals: number,
	uiAmount: number | null,
) {
	return {
		pubkey: Keypair.generate().publicKey,
		account: {
			data: {
				parsed: {
					info: {
						mint,
						owner,
						tokenAmount: {
							amount: amountRaw,
							decimals,
							uiAmount,
						},
					},
				},
			},
		},
	};
}

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
		runtimeMocks.callJupiterApi.mockRejectedValue(new Error("unmocked"));
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		runtimeMocks.parseFinality.mockReturnValue("confirmed");
		runtimeMocks.getSplTokenProgramId.mockReturnValue(
			Keypair.generate().publicKey,
		);
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

	it("parses read balance intentText and defaults address to signer", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-balance-intent", {
			runId: "run-read-balance-intent",
			runMode: "analysis",
			intentText: "查询当前钱包 balance",
		});

		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			runId: "run-read-balance-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.read.balance",
						address: signer.publicKey.toBase58(),
					},
				},
			},
		});
	});

	it("simulates read token balance workflow without mainnet approval gate", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const address = Keypair.generate().publicKey.toBase58();
		const connection = {
			getParsedTokenAccountsByOwner: vi
				.fn()
				.mockResolvedValueOnce({
					value: [makeParsedTokenAccount(address, USDC_MINT, "1000000", 6, 1)],
				})
				.mockResolvedValueOnce({
					value: [makeParsedTokenAccount(address, USDC_MINT, "2000000", 6, 2)],
				}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-token-sim", {
			runId: "run-read-token-sim",
			runMode: "simulate",
			intentText: `查询 ${address} 的 USDC 余额`,
			network: "mainnet-beta",
		});

		expect(connection.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(2);
		expect(result.details).toMatchObject({
			runId: "run-read-token-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.read.tokenBalance",
						address,
						tokenMint: USDC_MINT,
					},
				},
				approval: {
					required: false,
				},
				simulate: {
					ok: true,
					context: {
						intentType: "solana.read.tokenBalance",
						address,
						tokenMint: USDC_MINT,
						amount: "3000000",
						uiAmount: "3",
					},
				},
			},
		});
	});

	it("executes read portfolio workflow on mainnet without confirmToken", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const address = Keypair.generate().publicKey.toBase58();
		const bonkMint = "6dhTynDkYsVM7cbF7TKfC9DWB636TcEM935fq7JzL2ES";
		const connection = {
			getBalance: vi.fn().mockResolvedValue(2_000_000_000),
			getParsedTokenAccountsByOwner: vi
				.fn()
				.mockResolvedValueOnce({
					value: [
						makeParsedTokenAccount(address, bonkMint, "1000", 9, 0.000001),
					],
				})
				.mockResolvedValueOnce({
					value: [],
				}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-portfolio-exec", {
			runId: "run-read-portfolio-exec",
			runMode: "execute",
			intentType: "solana.read.portfolio",
			address,
			network: "mainnet-beta",
		});

		expect(connection.getBalance).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			runId: "run-read-portfolio-exec",
			status: "executed",
			artifacts: {
				approval: {
					required: false,
					approved: true,
				},
				execute: {
					read: true,
					result: {
						intentType: "solana.read.portfolio",
						address,
						tokenCount: 1,
					},
				},
			},
		});
	});

	it("parses SPL transfer intentText and derives amountRaw from token ui amount", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const destination = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-transfer-spl", {
			runId: "run-intent-transfer-spl",
			runMode: "analysis",
			intentText: `transfer 1.25 USDC to ${destination}`,
		});

		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			runId: "run-intent-transfer-spl",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.transfer.spl",
						toAddress: destination,
						tokenMint: USDC_MINT,
						amountRaw: "1250000",
					},
				},
			},
		});
	});

	it("supports structured SPL transfer amountUi for known token symbols", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const destination = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-amount-ui-transfer-spl", {
			runId: "run-amount-ui-transfer-spl",
			runMode: "analysis",
			intentType: "solana.transfer.spl",
			toAddress: destination,
			tokenMint: "USDT",
			amountUi: "2.5",
		});

		expect(result.details).toMatchObject({
			runId: "run-amount-ui-transfer-spl",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.transfer.spl",
						toAddress: destination,
						tokenMint: USDT_MINT,
						amountRaw: "2500000",
					},
				},
			},
		});
	});

	it("derives SPL transfer amountRaw from on-chain mint decimals for unknown token mints", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const destination = Keypair.generate().publicKey.toBase58();
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

		const result = await tool.execute("wf-amount-ui-transfer-unknown", {
			runId: "run-amount-ui-transfer-unknown",
			runMode: "analysis",
			intentType: "solana.transfer.spl",
			toAddress: destination,
			tokenMint: unknownMint,
			amountUi: "1.25",
		});

		expect(connection.getParsedAccountInfo).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			runId: "run-amount-ui-transfer-unknown",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.transfer.spl",
						tokenMint: unknownMint,
						amountRaw: "125000000",
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

	it("parses Orca swap intentText and applies Orca dex defaults", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-swap-orca", {
			runId: "run-intent-swap-orca",
			runMode: "analysis",
			intentText: "swap on orca 0.1 SOL to USDC",
		});

		expect(runtimeMocks.toLamports).toHaveBeenCalledWith(0.1);
		expect(result.details).toMatchObject({
			runId: "run-intent-swap-orca",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.swap.orca",
						inputMint: SOL_MINT,
						outputMint: USDC_MINT,
						amountRaw: "100000000",
						dexes: ["Orca V2", "Orca Whirlpool"],
					},
				},
			},
		});
	});

	it("simulates Meteora swap intent using Jupiter with dex filter", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "42",
			routePlan: [{ route: "mock" }],
		});
		runtimeMocks.buildJupiterSwapTransaction.mockResolvedValue({
			swapTransaction: Buffer.from("swap-tx").toString("base64"),
		});
		runtimeMocks.parseTransactionFromBase64.mockReturnValue({
			partialSign: vi.fn(),
			serialize: vi.fn(() => Buffer.from("signed")),
		});
		const connection = {
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 123,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-swap-meteora-sim", {
			runId: "run-intent-swap-meteora-sim",
			runMode: "simulate",
			intentType: "solana.swap.meteora",
			inputMint: SOL_MINT,
			outputMint: USDC_MINT,
			amountRaw: "1000000",
		});

		expect(runtimeMocks.getJupiterQuote).toHaveBeenCalledWith(
			expect.objectContaining({
				dexes: ["Meteora DLMM"],
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-intent-swap-meteora-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.swap.meteora",
						dexes: ["Meteora DLMM"],
					},
				},
				simulate: {
					ok: true,
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

	it("supports structured amountUi with expanded local token aliases", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-amount-ui-ray", {
			runId: "run-amount-ui-ray",
			runMode: "analysis",
			intentType: "solana.swap.jupiter",
			inputMint: "RAY",
			outputMint: "USDC",
			amountUi: "1.2",
		});

		expect(runtimeMocks.callJupiterApi).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			runId: "run-amount-ui-ray",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.swap.jupiter",
						inputMint: RAY_MINT,
						outputMint: USDC_MINT,
						amountRaw: "1200000",
					},
				},
			},
		});
	});

	it("resolves unknown symbols through Jupiter token search", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const remoteMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.callJupiterApi.mockResolvedValue([
			{
				symbol: "JITOSOL",
				address: remoteMint,
				decimals: 9,
				chainId: 101,
			},
		]);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-remote-symbol", {
			runId: "run-intent-remote-symbol",
			runMode: "analysis",
			intentText: "swap 1 JITOSOL to USDC",
		});

		expect(runtimeMocks.callJupiterApi).toHaveBeenCalledTimes(1);
		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			runId: "run-intent-remote-symbol",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.swap.jupiter",
						inputMint: remoteMint,
						outputMint: USDC_MINT,
						amountRaw: "1000000000",
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

	it("simulates SPL transfer workflow intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const destination = Keypair.generate().publicKey.toBase58();
		const tokenMint = Keypair.generate().publicKey.toBase58();
		const connection = {
			getAccountInfo: vi.fn().mockResolvedValue({ owner: signer.publicKey }),
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 1,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 99,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-transfer-spl-simulate", {
			runId: "run-transfer-spl",
			intentType: "solana.transfer.spl",
			runMode: "simulate",
			toAddress: destination,
			tokenMint,
			amountRaw: "1000",
		});

		expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			runId: "run-transfer-spl",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.transfer.spl",
						toAddress: destination,
						tokenMint,
						amountRaw: "1000",
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});

	it("enforces mainnet confirm token for Raydium workflow execute", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const inputMint = Keypair.generate().publicKey.toBase58();
		const outputMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getRaydiumQuote.mockResolvedValue({
			data: { outputAmount: "1" },
		});
		runtimeMocks.buildRaydiumSwapTransactions.mockResolvedValue({
			data: [{ transaction: "tx-one" }, { transaction: "tx-two" }],
		});
		runtimeMocks.parseTransactionFromBase64.mockImplementation(() => ({
			partialSign: vi.fn(),
			serialize: vi.fn(() => Buffer.from("signed")),
		}));
		const connection = {
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 120,
				},
			}),
			sendRawTransaction: vi
				.fn()
				.mockResolvedValueOnce("sig-one")
				.mockResolvedValueOnce("sig-two"),
			confirmTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const simulated = await tool.execute("wf-ray-sim", {
			runId: "run-ray",
			intentType: "solana.swap.raydium",
			runMode: "simulate",
			inputMint,
			outputMint,
			amountRaw: "1000",
			slippageBps: 50,
			computeUnitPriceMicroLamports: "5000",
		});
		const confirmToken = (
			simulated.details as {
				artifacts?: { approval?: { confirmToken?: string | null } };
			}
		).artifacts?.approval?.confirmToken;
		if (!confirmToken) throw new Error("confirmToken not returned");

		await expect(
			tool.execute("wf-ray-exec-missing-confirm", {
				runId: "run-ray",
				intentType: "solana.swap.raydium",
				runMode: "execute",
				inputMint,
				outputMint,
				amountRaw: "1000",
				slippageBps: 50,
				computeUnitPriceMicroLamports: "5000",
			}),
		).rejects.toThrow("confirmMainnet=true");

		const executed = await tool.execute("wf-ray-exec", {
			runId: "run-ray",
			intentType: "solana.swap.raydium",
			runMode: "execute",
			inputMint,
			outputMint,
			amountRaw: "1000",
			slippageBps: 50,
			computeUnitPriceMicroLamports: "5000",
			confirmMainnet: true,
			confirmToken,
		});
		expect(connection.sendRawTransaction).toHaveBeenCalledTimes(2);
		expect(executed.details).toMatchObject({
			runId: "run-ray",
			status: "executed",
		});
		expect(
			(
				executed.details as {
					artifacts?: {
						execute?: {
							signatures?: string[];
						};
					};
				}
			).artifacts?.execute?.signatures,
		).toEqual(["sig-one", "sig-two"]);
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
		).rejects.toThrow("runId=run-mainnet");

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
		).rejects.toThrow("provided=SOL-WRONGTOKEN");

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
