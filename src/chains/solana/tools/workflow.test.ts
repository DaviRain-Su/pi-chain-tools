import {
	Keypair,
	PublicKey,
	StakeProgram,
	TransactionInstruction,
} from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	assertRaydiumNetworkSupported: vi.fn(),
	assertJupiterNetworkSupported: vi.fn(),
	buildKaminoBorrowInstructions: vi.fn(),
	buildKaminoDepositAndBorrowInstructions: vi.fn(),
	buildKaminoDepositInstructions: vi.fn(),
	buildKaminoRepayInstructions: vi.fn(),
	buildKaminoRepayAndWithdrawInstructions: vi.fn(),
	buildKaminoWithdrawInstructions: vi.fn(),
	buildMeteoraAddLiquidityInstructions: vi.fn(),
	buildMeteoraRemoveLiquidityInstructions: vi.fn(),
	buildOrcaClosePositionInstructions: vi.fn(),
	buildOrcaDecreaseLiquidityInstructions: vi.fn(),
	buildOrcaHarvestPositionInstructions: vi.fn(),
	buildOrcaIncreaseLiquidityInstructions: vi.fn(),
	buildOrcaOpenPositionInstructions: vi.fn(),
	buildJupiterSwapTransaction: vi.fn(),
	buildRaydiumSwapTransactions: vi.fn(),
	callJupiterApi: vi.fn(),
	commitmentSchema: vi.fn(),
	getConnection: vi.fn(),
	getExplorerAddressUrl: vi.fn(),
	getExplorerTransactionUrl: vi.fn(),
	getJupiterApiBaseUrl: vi.fn(() => "https://lite-api.jup.ag"),
	getJupiterQuote: vi.fn(),
	getKaminoLendingMarkets: vi.fn(),
	getKaminoLendingPositions: vi.fn(),
	getMeteoraDlmmPositions: vi.fn(),
	getOrcaWhirlpoolPool: vi.fn(),
	getOrcaWhirlpoolPositions: vi.fn(),
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
		buildKaminoBorrowInstructions: runtimeMocks.buildKaminoBorrowInstructions,
		buildKaminoDepositAndBorrowInstructions:
			runtimeMocks.buildKaminoDepositAndBorrowInstructions,
		buildKaminoDepositInstructions: runtimeMocks.buildKaminoDepositInstructions,
		buildKaminoRepayInstructions: runtimeMocks.buildKaminoRepayInstructions,
		buildKaminoRepayAndWithdrawInstructions:
			runtimeMocks.buildKaminoRepayAndWithdrawInstructions,
		buildKaminoWithdrawInstructions:
			runtimeMocks.buildKaminoWithdrawInstructions,
		buildMeteoraAddLiquidityInstructions:
			runtimeMocks.buildMeteoraAddLiquidityInstructions,
		buildMeteoraRemoveLiquidityInstructions:
			runtimeMocks.buildMeteoraRemoveLiquidityInstructions,
		buildOrcaClosePositionInstructions:
			runtimeMocks.buildOrcaClosePositionInstructions,
		buildOrcaDecreaseLiquidityInstructions:
			runtimeMocks.buildOrcaDecreaseLiquidityInstructions,
		buildOrcaHarvestPositionInstructions:
			runtimeMocks.buildOrcaHarvestPositionInstructions,
		buildOrcaIncreaseLiquidityInstructions:
			runtimeMocks.buildOrcaIncreaseLiquidityInstructions,
		buildOrcaOpenPositionInstructions:
			runtimeMocks.buildOrcaOpenPositionInstructions,
		buildJupiterSwapTransaction: runtimeMocks.buildJupiterSwapTransaction,
		buildRaydiumSwapTransactions: runtimeMocks.buildRaydiumSwapTransactions,
		callJupiterApi: runtimeMocks.callJupiterApi,
		commitmentSchema: runtimeMocks.commitmentSchema,
		getConnection: runtimeMocks.getConnection,
		getExplorerAddressUrl: runtimeMocks.getExplorerAddressUrl,
		getExplorerTransactionUrl: runtimeMocks.getExplorerTransactionUrl,
		getJupiterApiBaseUrl: runtimeMocks.getJupiterApiBaseUrl,
		getJupiterQuote: runtimeMocks.getJupiterQuote,
		getKaminoLendingMarkets: runtimeMocks.getKaminoLendingMarkets,
		getKaminoLendingPositions: runtimeMocks.getKaminoLendingPositions,
		getMeteoraDlmmPositions: runtimeMocks.getMeteoraDlmmPositions,
		getOrcaWhirlpoolPool: runtimeMocks.getOrcaWhirlpoolPool,
		getOrcaWhirlpoolPositions: runtimeMocks.getOrcaWhirlpoolPositions,
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

function makeParsedStakeAccount(
	stakeAccount: string,
	withdrawer: string,
	stakeLamports: string,
) {
	return {
		pubkey: { toBase58: () => stakeAccount },
		account: {
			lamports: 2_000_000_000,
			data: {
				parsed: {
					type: "delegated",
					info: {
						meta: {
							authorized: {
								staker: withdrawer,
								withdrawer,
							},
						},
						stake: {
							delegation: {
								stake: stakeLamports,
								voter: Keypair.generate().publicKey.toBase58(),
								activationEpoch: "1",
								deactivationEpoch: "18446744073709551615",
							},
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
		runtimeMocks.getOrcaWhirlpoolPositions.mockResolvedValue({
			protocol: "orca-whirlpool",
			address: "",
			network: "devnet",
			positionCount: 0,
			bundleCount: 0,
			poolCount: 0,
			whirlpoolAddresses: [],
			positions: [],
			queryErrors: [],
		});
		runtimeMocks.getOrcaWhirlpoolPool.mockResolvedValue({
			protocol: "orca-whirlpool",
			poolAddress: "",
			network: "devnet",
			tokenMintA: USDC_MINT,
			tokenMintB: SOL_MINT,
			tickSpacing: null,
			feeRate: null,
			currentTickIndex: null,
			rewardMints: [],
			queryErrors: [],
		});
		runtimeMocks.getMeteoraDlmmPositions.mockResolvedValue({
			protocol: "meteora-dlmm",
			address: "",
			network: "devnet",
			positionCount: 0,
			poolCount: 0,
			poolAddresses: [],
			pools: [],
			queryErrors: [],
		});
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
		runtimeMocks.getOrcaWhirlpoolPositions.mockResolvedValue({
			protocol: "orca-whirlpool",
			address,
			network: "mainnet-beta",
			positionCount: 1,
			bundleCount: 0,
			poolCount: 1,
			whirlpoolAddresses: [Keypair.generate().publicKey.toBase58()],
			positions: [],
			queryErrors: [],
		});
		runtimeMocks.getMeteoraDlmmPositions.mockResolvedValue({
			protocol: "meteora-dlmm",
			address,
			network: "mainnet-beta",
			positionCount: 2,
			poolCount: 1,
			poolAddresses: [Keypair.generate().publicKey.toBase58()],
			pools: [],
			queryErrors: [],
		});
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

	it("parses defi positions intentText and defaults to read.defiPositions", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-defi-analysis", {
			runId: "run-read-defi-analysis",
			runMode: "analysis",
			intentText: "query current wallet defi positions",
		});

		expect(result.details).toMatchObject({
			runId: "run-read-defi-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.read.defiPositions",
						address: signer.publicKey.toBase58(),
					},
				},
			},
		});
	});

	it("executes read defi positions workflow with stake discovery", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const address = Keypair.generate().publicKey.toBase58();
		const stakeAccountOne = Keypair.generate().publicKey.toBase58();
		const stakeAccountTwo = Keypair.generate().publicKey.toBase58();
		const connection = {
			getBalance: vi.fn().mockResolvedValue(3_000_000_000),
			getParsedTokenAccountsByOwner: vi
				.fn()
				.mockResolvedValueOnce({
					value: [
						makeParsedTokenAccount(address, USDC_MINT, "1000000", 6, 1),
						makeParsedTokenAccount(
							address,
							"mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
							"500000000",
							9,
							0.5,
						),
					],
				})
				.mockResolvedValueOnce({
					value: [],
				}),
			getParsedProgramAccounts: vi
				.fn()
				.mockResolvedValueOnce([
					makeParsedStakeAccount(stakeAccountOne, address, "1000000000"),
				])
				.mockResolvedValueOnce([
					makeParsedStakeAccount(stakeAccountOne, address, "1000000000"),
					makeParsedStakeAccount(stakeAccountTwo, address, "250000000"),
				]),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-defi-exec", {
			runId: "run-read-defi-exec",
			runMode: "execute",
			intentType: "solana.read.defiPositions",
			address,
			network: "mainnet-beta",
		});

		expect(connection.getParsedProgramAccounts).toHaveBeenCalledTimes(2);
		expect(runtimeMocks.getOrcaWhirlpoolPositions).toHaveBeenCalledWith({
			address,
			network: "mainnet-beta",
		});
		expect(runtimeMocks.getMeteoraDlmmPositions).toHaveBeenCalledWith({
			address,
			network: "mainnet-beta",
		});
		expect(result.details).toMatchObject({
			runId: "run-read-defi-exec",
			status: "executed",
			artifacts: {
				execute: {
					read: true,
					result: {
						intentType: "solana.read.defiPositions",
						address,
						defiTokenPositionCount: 2,
						liquidityPositionCount: 0,
						stakeAccountCount: 2,
						totalDelegatedStakeLamports: "1250000000",
					},
				},
			},
		});
	});

	it("parses lending positions intentText and defaults to kamino protocol", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-lending-analysis", {
			runId: "run-read-lending-analysis",
			runMode: "analysis",
			intentText: "query current wallet lending positions on kamino",
		});

		expect(result.details).toMatchObject({
			runId: "run-read-lending-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.read.lendingPositions",
						address: signer.publicKey.toBase58(),
						protocol: "kamino",
						limitMarkets: 20,
					},
				},
			},
		});
	});

	it("simulates read lending positions workflow without mainnet approval gate", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const address = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getKaminoLendingPositions.mockResolvedValue({
			protocol: "kamino",
			address,
			network: "mainnet-beta",
			programId: null,
			marketCount: 5,
			marketCountQueried: 5,
			marketQueryLimit: 20,
			marketCountWithPositions: 1,
			obligationCount: 1,
			depositPositionCount: 2,
			borrowPositionCount: 1,
			totalDepositValueUsd: 321.12,
			totalBorrowValueUsd: 21.12,
			netValueUsd: 300,
			marketAddressesQueried: ["7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"],
			marketAddressesWithPositions: [
				"7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
			],
			obligations: [],
			queryErrors: [],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-lending-sim", {
			runId: "run-read-lending-sim",
			runMode: "simulate",
			intentType: "solana.read.lendingPositions",
			address,
			network: "mainnet-beta",
		});

		expect(runtimeMocks.getKaminoLendingPositions).toHaveBeenCalledWith({
			address,
			network: "mainnet-beta",
			programId: undefined,
			limitMarkets: 20,
		});
		expect(result.details).toMatchObject({
			runId: "run-read-lending-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.read.lendingPositions",
						address,
						protocol: "kamino",
						limitMarkets: 20,
					},
				},
				approval: {
					required: false,
				},
				simulate: {
					ok: true,
					context: {
						intentType: "solana.read.lendingPositions",
						address,
						obligationCount: 1,
						depositPositionCount: 2,
						borrowPositionCount: 1,
						totalDepositValueUsd: 321.12,
						totalBorrowValueUsd: 21.12,
						netValueUsd: 300,
					},
				},
			},
		});
	});

	it("parses lending markets intentText and defaults to kamino protocol", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-lending-markets-analysis", {
			runId: "run-read-lending-markets-analysis",
			runMode: "analysis",
			intentText: "list kamino lending markets",
		});

		expect(result.details).toMatchObject({
			runId: "run-read-lending-markets-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.read.lendingMarkets",
						protocol: "kamino",
						limitMarkets: 20,
					},
				},
			},
		});
	});

	it("simulates read lending markets workflow without mainnet approval gate", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		runtimeMocks.getKaminoLendingMarkets.mockResolvedValue({
			protocol: "kamino",
			programId: null,
			marketCount: 4,
			marketCountQueried: 2,
			marketQueryLimit: 2,
			markets: [
				{
					marketAddress: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
					name: "Main Market",
					description: "Primary market on mainnet",
					lookupTableAddress: "FGMSBiyVE8TvZcdQnZETAAKw28tkQJ2ccZy6pyp95URb",
					isPrimary: true,
					isCurated: false,
				},
				{
					marketAddress: "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek",
					name: "JLP Market",
					description: "Isolated JLP pool",
					lookupTableAddress: "GprZNyWk67655JhX6Rq9KoebQ6WkQYRhATWzkx2P2LNc",
					isPrimary: false,
					isCurated: false,
				},
			],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-lending-markets-sim", {
			runId: "run-read-lending-markets-sim",
			runMode: "simulate",
			intentType: "solana.read.lendingMarkets",
			limitMarkets: 2,
			network: "mainnet-beta",
		});

		expect(runtimeMocks.getKaminoLendingMarkets).toHaveBeenCalledWith({
			programId: undefined,
			limitMarkets: 2,
		});
		expect(result.details).toMatchObject({
			runId: "run-read-lending-markets-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.read.lendingMarkets",
						protocol: "kamino",
						limitMarkets: 2,
					},
				},
				approval: {
					required: false,
				},
				simulate: {
					ok: true,
					context: {
						intentType: "solana.read.lendingMarkets",
						protocol: "kamino",
						marketCount: 4,
						marketCountQueried: 2,
						marketQueryLimit: 2,
					},
				},
			},
		});
	});

	it("parses Orca positions intentText and defaults to read.orcaPositions", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-orca-analysis", {
			runId: "run-read-orca-analysis",
			runMode: "analysis",
			intentText: "query current wallet orca whirlpool positions",
		});

		expect(result.details).toMatchObject({
			runId: "run-read-orca-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.read.orcaPositions",
						address: signer.publicKey.toBase58(),
					},
				},
			},
		});
	});

	it("executes read Orca positions workflow without mainnet approval gate", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const address = Keypair.generate().publicKey.toBase58();
		const whirlpoolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getOrcaWhirlpoolPositions.mockResolvedValue({
			protocol: "orca-whirlpool",
			address,
			network: "mainnet-beta",
			positionCount: 1,
			bundleCount: 0,
			poolCount: 1,
			whirlpoolAddresses: [whirlpoolAddress],
			positions: [
				{
					positionAddress,
					positionMint,
					positionBundleAddress: null,
					isBundledPosition: false,
					bundlePositionCount: null,
					tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
					whirlpoolAddress,
					tokenMintA: SOL_MINT,
					tokenMintB: USDC_MINT,
					tickSpacing: 64,
					feeRate: 3000,
					currentTickIndex: 1234,
					liquidity: "100",
					tickLowerIndex: 1200,
					tickUpperIndex: 1264,
					feeOwedA: "0",
					feeOwedB: "10",
					rewards: [],
				},
			],
			queryErrors: [],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-orca-exec", {
			runId: "run-read-orca-exec",
			runMode: "execute",
			intentType: "solana.read.orcaPositions",
			address,
			network: "mainnet-beta",
		});

		expect(runtimeMocks.getOrcaWhirlpoolPositions).toHaveBeenCalledWith({
			address,
			network: "mainnet-beta",
		});
		expect(result.details).toMatchObject({
			runId: "run-read-orca-exec",
			status: "executed",
			artifacts: {
				approval: {
					required: false,
					approved: true,
				},
				execute: {
					read: true,
					result: {
						intentType: "solana.read.orcaPositions",
						address,
						positionCount: 1,
						poolCount: 1,
					},
				},
			},
		});
	});

	it("parses Meteora positions intentText and defaults to read.meteoraPositions", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-meteora-analysis", {
			runId: "run-read-meteora-analysis",
			runMode: "analysis",
			intentText: "query current wallet meteora dlmm lp positions",
		});

		expect(result.details).toMatchObject({
			runId: "run-read-meteora-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.read.meteoraPositions",
						address: signer.publicKey.toBase58(),
					},
				},
			},
		});
	});

	it("simulates read Meteora positions workflow without mainnet approval gate", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const address = Keypair.generate().publicKey.toBase58();
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getMeteoraDlmmPositions.mockResolvedValue({
			protocol: "meteora-dlmm",
			address,
			network: "mainnet-beta",
			positionCount: 1,
			poolCount: 1,
			poolAddresses: [poolAddress],
			pools: [
				{
					poolAddress,
					tokenXMint: SOL_MINT,
					tokenYMint: USDC_MINT,
					activeBinId: 123,
					binStep: 25,
					positionCount: 1,
					positions: [
						{
							positionAddress,
							poolAddress,
							ownerAddress: address,
							lowerBinId: 120,
							upperBinId: 130,
							totalXAmountRaw: "1000",
							totalYAmountRaw: "2000",
							feeXAmountRaw: "1",
							feeYAmountRaw: "2",
							rewardOneAmountRaw: "0",
							rewardTwoAmountRaw: "0",
						},
					],
				},
			],
			queryErrors: [],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-read-meteora-sim", {
			runId: "run-read-meteora-sim",
			runMode: "simulate",
			intentType: "solana.read.meteoraPositions",
			address,
			network: "mainnet-beta",
		});

		expect(runtimeMocks.getMeteoraDlmmPositions).toHaveBeenCalledWith({
			address,
			network: "mainnet-beta",
		});
		expect(result.details).toMatchObject({
			runId: "run-read-meteora-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.read.meteoraPositions",
						address,
					},
				},
				approval: {
					required: false,
				},
				simulate: {
					ok: true,
					context: {
						intentType: "solana.read.meteoraPositions",
						address,
						positionCount: 1,
						poolCount: 1,
					},
				},
			},
		});
	});

	it("parses kamino deposit intentText and derives amountRaw from amountUi", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-kamino-analysis", {
			runId: "run-kamino-analysis",
			runMode: "analysis",
			intentText: "kamino deposit 1.25 USDC",
			marketAddress,
		});

		expect(result.details).toMatchObject({
			runId: "run-kamino-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lend.kamino.deposit",
						ownerAddress: signer.publicKey.toBase58(),
						reserveMint: USDC_MINT,
						amountRaw: "1250000",
						marketAddress,
					},
				},
			},
		});
	});

	it("enforces mainnet confirm token for kamino deposit execute", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const reserveAddress = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([5]),
		});
		runtimeMocks.buildKaminoDepositInstructions.mockResolvedValue({
			network: "mainnet-beta",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId: Keypair.generate().publicKey.toBase58(),
			reserveMint: USDC_MINT,
			reserveAddress,
			reserveSymbol: "USDC",
			amountRaw: "1000",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			obligationAddress,
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["deposit"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 1,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 88,
				},
			}),
			sendRawTransaction: vi.fn().mockResolvedValue("kamino-deposit-sig"),
			confirmTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const simulated = await tool.execute("wf-kamino-sim", {
			runId: "run-kamino",
			intentType: "solana.lend.kamino.deposit",
			runMode: "simulate",
			marketAddress,
			reserveMint: USDC_MINT,
			amountRaw: "1000",
			network: "mainnet-beta",
		});
		const confirmToken = (
			simulated.details as {
				artifacts?: { approval?: { confirmToken?: string | null } };
			}
		).artifacts?.approval?.confirmToken;
		if (!confirmToken) throw new Error("confirmToken not returned");

		await expect(
			tool.execute("wf-kamino-exec-missing-confirm", {
				runId: "run-kamino",
				intentType: "solana.lend.kamino.deposit",
				runMode: "execute",
				marketAddress,
				reserveMint: USDC_MINT,
				amountRaw: "1000",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");

		await expect(
			tool.execute("wf-kamino-exec-invalid-token", {
				runId: "run-kamino",
				intentType: "solana.lend.kamino.deposit",
				runMode: "execute",
				marketAddress,
				reserveMint: USDC_MINT,
				amountRaw: "1000",
				network: "mainnet-beta",
				confirmMainnet: true,
				confirmToken: "SOL-WRONGTOKEN",
			}),
		).rejects.toThrow("provided=SOL-WRONGTOKEN");

		const executed = await tool.execute("wf-kamino-exec", {
			runId: "run-kamino",
			intentType: "solana.lend.kamino.deposit",
			runMode: "execute",
			marketAddress,
			reserveMint: USDC_MINT,
			amountRaw: "1000",
			network: "mainnet-beta",
			confirmMainnet: true,
			confirmToken,
		});

		expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(executed.details).toMatchObject({
			runId: "run-kamino",
			status: "executed",
			artifacts: {
				execute: {
					signature: "kamino-deposit-sig",
					guardChecks: {
						approvalRequired: true,
						confirmMainnetProvided: true,
						confirmTokenMatched: true,
						simulationOk: true,
					},
				},
			},
		});
	});

	it("parses kamino deposit+borrow intentText and derives per-leg amountRaw", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-kamino-deposit-borrow-analysis", {
			runId: "run-kamino-deposit-borrow-analysis",
			runMode: "analysis",
			intentText: "kamino deposit 1.25 USDC and borrow 0.01 SOL",
			marketAddress,
		});

		expect(result.details).toMatchObject({
			runId: "run-kamino-deposit-borrow-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lend.kamino.depositAndBorrow",
						ownerAddress: signer.publicKey.toBase58(),
						marketAddress,
						depositReserveMint: USDC_MINT,
						depositAmountRaw: "1250000",
						borrowReserveMint: SOL_MINT,
						borrowAmountRaw: "10000000",
					},
				},
			},
		});
	});

	it("enforces mainnet confirm token for kamino deposit+borrow execute", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const depositReserveAddress = Keypair.generate().publicKey.toBase58();
		const borrowReserveAddress = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([25]),
		});
		runtimeMocks.buildKaminoDepositAndBorrowInstructions.mockResolvedValue({
			network: "mainnet-beta",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId: Keypair.generate().publicKey.toBase58(),
			depositReserveMint: USDC_MINT,
			depositReserveAddress,
			depositReserveSymbol: "USDC",
			depositAmountRaw: "1000",
			borrowReserveMint: SOL_MINT,
			borrowReserveAddress,
			borrowReserveSymbol: "SOL",
			borrowAmountRaw: "10",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			obligationAddress,
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["depositAndBorrow"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const connection = {
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
			sendRawTransaction: vi
				.fn()
				.mockResolvedValue("kamino-deposit-borrow-sig"),
			confirmTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const simulated = await tool.execute("wf-kamino-deposit-borrow-sim", {
			runId: "run-kamino-deposit-borrow",
			intentType: "solana.lend.kamino.depositAndBorrow",
			runMode: "simulate",
			marketAddress,
			depositReserveMint: USDC_MINT,
			depositAmountRaw: "1000",
			borrowReserveMint: SOL_MINT,
			borrowAmountRaw: "10",
			network: "mainnet-beta",
		});
		const confirmToken = (
			simulated.details as {
				artifacts?: { approval?: { confirmToken?: string | null } };
			}
		).artifacts?.approval?.confirmToken;
		if (!confirmToken) throw new Error("confirmToken not returned");

		await expect(
			tool.execute("wf-kamino-deposit-borrow-exec-missing-confirm", {
				runId: "run-kamino-deposit-borrow",
				intentType: "solana.lend.kamino.depositAndBorrow",
				runMode: "execute",
				marketAddress,
				depositReserveMint: USDC_MINT,
				depositAmountRaw: "1000",
				borrowReserveMint: SOL_MINT,
				borrowAmountRaw: "10",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");

		const executed = await tool.execute("wf-kamino-deposit-borrow-exec", {
			runId: "run-kamino-deposit-borrow",
			intentType: "solana.lend.kamino.depositAndBorrow",
			runMode: "execute",
			marketAddress,
			depositReserveMint: USDC_MINT,
			depositAmountRaw: "1000",
			borrowReserveMint: SOL_MINT,
			borrowAmountRaw: "10",
			network: "mainnet-beta",
			confirmMainnet: true,
			confirmToken,
		});

		expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(executed.details).toMatchObject({
			runId: "run-kamino-deposit-borrow",
			status: "executed",
			artifacts: {
				execute: {
					signature: "kamino-deposit-borrow-sig",
					guardChecks: {
						approvalRequired: true,
						confirmMainnetProvided: true,
						confirmTokenMatched: true,
						simulationOk: true,
					},
				},
			},
		});
	});

	it("parses kamino borrow intentText and derives amountRaw from amountUi", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-kamino-borrow-analysis", {
			runId: "run-kamino-borrow-analysis",
			runMode: "analysis",
			intentText: "kamino borrow 1.25 USDC",
			marketAddress,
		});

		expect(result.details).toMatchObject({
			runId: "run-kamino-borrow-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lend.kamino.borrow",
						ownerAddress: signer.publicKey.toBase58(),
						reserveMint: USDC_MINT,
						amountRaw: "1250000",
						marketAddress,
					},
				},
			},
		});
	});

	it("enforces mainnet confirm token for kamino borrow execute", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const reserveAddress = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([15]),
		});
		runtimeMocks.buildKaminoBorrowInstructions.mockResolvedValue({
			network: "mainnet-beta",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId: Keypair.generate().publicKey.toBase58(),
			reserveMint: USDC_MINT,
			reserveAddress,
			reserveSymbol: "USDC",
			amountRaw: "1000",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			obligationAddress,
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["borrow"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 1,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 90,
				},
			}),
			sendRawTransaction: vi.fn().mockResolvedValue("kamino-borrow-sig"),
			confirmTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const simulated = await tool.execute("wf-kamino-borrow-sim", {
			runId: "run-kamino-borrow",
			intentType: "solana.lend.kamino.borrow",
			runMode: "simulate",
			marketAddress,
			reserveMint: USDC_MINT,
			amountRaw: "1000",
			network: "mainnet-beta",
		});
		const confirmToken = (
			simulated.details as {
				artifacts?: { approval?: { confirmToken?: string | null } };
			}
		).artifacts?.approval?.confirmToken;
		if (!confirmToken) throw new Error("confirmToken not returned");

		await expect(
			tool.execute("wf-kamino-borrow-exec-missing-confirm", {
				runId: "run-kamino-borrow",
				intentType: "solana.lend.kamino.borrow",
				runMode: "execute",
				marketAddress,
				reserveMint: USDC_MINT,
				amountRaw: "1000",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");

		await expect(
			tool.execute("wf-kamino-borrow-exec-invalid-token", {
				runId: "run-kamino-borrow",
				intentType: "solana.lend.kamino.borrow",
				runMode: "execute",
				marketAddress,
				reserveMint: USDC_MINT,
				amountRaw: "1000",
				network: "mainnet-beta",
				confirmMainnet: true,
				confirmToken: "SOL-WRONGTOKEN",
			}),
		).rejects.toThrow("provided=SOL-WRONGTOKEN");

		const executed = await tool.execute("wf-kamino-borrow-exec", {
			runId: "run-kamino-borrow",
			intentType: "solana.lend.kamino.borrow",
			runMode: "execute",
			marketAddress,
			reserveMint: USDC_MINT,
			amountRaw: "1000",
			network: "mainnet-beta",
			confirmMainnet: true,
			confirmToken,
		});

		expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(executed.details).toMatchObject({
			runId: "run-kamino-borrow",
			status: "executed",
			artifacts: {
				execute: {
					signature: "kamino-borrow-sig",
					guardChecks: {
						approvalRequired: true,
						confirmMainnetProvided: true,
						confirmTokenMatched: true,
						simulationOk: true,
					},
				},
			},
		});
	});

	it("parses kamino repay intentText and derives amountRaw from amountUi", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-kamino-repay-analysis", {
			runId: "run-kamino-repay-analysis",
			runMode: "analysis",
			intentText: "kamino repay 1.25 USDC currentSlot=555",
			marketAddress,
		});

		expect(result.details).toMatchObject({
			runId: "run-kamino-repay-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lend.kamino.repay",
						ownerAddress: signer.publicKey.toBase58(),
						reserveMint: USDC_MINT,
						amountRaw: "1250000",
						currentSlot: "555",
						marketAddress,
					},
				},
			},
		});
	});

	it("enforces mainnet confirm token for kamino repay execute", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const reserveAddress = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([16]),
		});
		runtimeMocks.buildKaminoRepayInstructions.mockResolvedValue({
			network: "mainnet-beta",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId: Keypair.generate().publicKey.toBase58(),
			reserveMint: USDC_MINT,
			reserveAddress,
			reserveSymbol: "USDC",
			amountRaw: "1000",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			currentSlot: "999",
			obligationAddress,
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["repay"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 1,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 91,
				},
			}),
			sendRawTransaction: vi.fn().mockResolvedValue("kamino-repay-sig"),
			confirmTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const simulated = await tool.execute("wf-kamino-repay-sim", {
			runId: "run-kamino-repay",
			intentType: "solana.lend.kamino.repay",
			runMode: "simulate",
			marketAddress,
			reserveMint: USDC_MINT,
			amountRaw: "1000",
			currentSlot: "999",
			network: "mainnet-beta",
		});
		const confirmToken = (
			simulated.details as {
				artifacts?: { approval?: { confirmToken?: string | null } };
			}
		).artifacts?.approval?.confirmToken;
		if (!confirmToken) throw new Error("confirmToken not returned");

		await expect(
			tool.execute("wf-kamino-repay-exec-missing-confirm", {
				runId: "run-kamino-repay",
				intentType: "solana.lend.kamino.repay",
				runMode: "execute",
				marketAddress,
				reserveMint: USDC_MINT,
				amountRaw: "1000",
				currentSlot: "999",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");

		await expect(
			tool.execute("wf-kamino-repay-exec-invalid-token", {
				runId: "run-kamino-repay",
				intentType: "solana.lend.kamino.repay",
				runMode: "execute",
				marketAddress,
				reserveMint: USDC_MINT,
				amountRaw: "1000",
				currentSlot: "999",
				network: "mainnet-beta",
				confirmMainnet: true,
				confirmToken: "SOL-WRONGTOKEN",
			}),
		).rejects.toThrow("provided=SOL-WRONGTOKEN");

		const executed = await tool.execute("wf-kamino-repay-exec", {
			runId: "run-kamino-repay",
			intentType: "solana.lend.kamino.repay",
			runMode: "execute",
			marketAddress,
			reserveMint: USDC_MINT,
			amountRaw: "1000",
			currentSlot: "999",
			network: "mainnet-beta",
			confirmMainnet: true,
			confirmToken,
		});

		expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(executed.details).toMatchObject({
			runId: "run-kamino-repay",
			status: "executed",
			artifacts: {
				execute: {
					signature: "kamino-repay-sig",
					guardChecks: {
						approvalRequired: true,
						confirmMainnetProvided: true,
						confirmTokenMatched: true,
						simulationOk: true,
					},
				},
			},
		});
	});

	it("parses kamino repay+withdraw intentText and derives per-leg amountRaw", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-kamino-repay-withdraw-analysis", {
			runId: "run-kamino-repay-withdraw-analysis",
			runMode: "analysis",
			intentText:
				"kamino repay 1.25 USDC and withdraw 0.01 SOL currentSlot=555",
			marketAddress,
		});

		expect(result.details).toMatchObject({
			runId: "run-kamino-repay-withdraw-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lend.kamino.repayAndWithdraw",
						ownerAddress: signer.publicKey.toBase58(),
						marketAddress,
						repayReserveMint: USDC_MINT,
						repayAmountRaw: "1250000",
						withdrawReserveMint: SOL_MINT,
						withdrawAmountRaw: "10000000",
						currentSlot: "555",
					},
				},
			},
		});
	});

	it("enforces mainnet confirm token for kamino repay+withdraw execute", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const repayReserveAddress = Keypair.generate().publicKey.toBase58();
		const withdrawReserveAddress = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([26]),
		});
		runtimeMocks.buildKaminoRepayAndWithdrawInstructions.mockResolvedValue({
			network: "mainnet-beta",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId: Keypair.generate().publicKey.toBase58(),
			repayReserveMint: USDC_MINT,
			repayReserveAddress,
			repayReserveSymbol: "USDC",
			repayAmountRaw: "1000",
			withdrawReserveMint: SOL_MINT,
			withdrawReserveAddress,
			withdrawReserveSymbol: "SOL",
			withdrawAmountRaw: "10",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			currentSlot: "999",
			obligationAddress,
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["repayAndWithdraw"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 1,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 100,
				},
			}),
			sendRawTransaction: vi
				.fn()
				.mockResolvedValue("kamino-repay-withdraw-sig"),
			confirmTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const simulated = await tool.execute("wf-kamino-repay-withdraw-sim", {
			runId: "run-kamino-repay-withdraw",
			intentType: "solana.lend.kamino.repayAndWithdraw",
			runMode: "simulate",
			marketAddress,
			repayReserveMint: USDC_MINT,
			repayAmountRaw: "1000",
			withdrawReserveMint: SOL_MINT,
			withdrawAmountRaw: "10",
			currentSlot: "999",
			network: "mainnet-beta",
		});
		const confirmToken = (
			simulated.details as {
				artifacts?: { approval?: { confirmToken?: string | null } };
			}
		).artifacts?.approval?.confirmToken;
		if (!confirmToken) throw new Error("confirmToken not returned");

		await expect(
			tool.execute("wf-kamino-repay-withdraw-exec-missing-confirm", {
				runId: "run-kamino-repay-withdraw",
				intentType: "solana.lend.kamino.repayAndWithdraw",
				runMode: "execute",
				marketAddress,
				repayReserveMint: USDC_MINT,
				repayAmountRaw: "1000",
				withdrawReserveMint: SOL_MINT,
				withdrawAmountRaw: "10",
				currentSlot: "999",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");

		const executed = await tool.execute("wf-kamino-repay-withdraw-exec", {
			runId: "run-kamino-repay-withdraw",
			intentType: "solana.lend.kamino.repayAndWithdraw",
			runMode: "execute",
			marketAddress,
			repayReserveMint: USDC_MINT,
			repayAmountRaw: "1000",
			withdrawReserveMint: SOL_MINT,
			withdrawAmountRaw: "10",
			currentSlot: "999",
			network: "mainnet-beta",
			confirmMainnet: true,
			confirmToken,
		});

		expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(executed.details).toMatchObject({
			runId: "run-kamino-repay-withdraw",
			status: "executed",
			artifacts: {
				execute: {
					signature: "kamino-repay-withdraw-sig",
					guardChecks: {
						approvalRequired: true,
						confirmMainnetProvided: true,
						confirmTokenMatched: true,
						simulationOk: true,
					},
				},
			},
		});
	});

	it("parses kamino withdraw intentText and derives amountRaw from amountUi", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-kamino-withdraw-analysis", {
			runId: "run-kamino-withdraw-analysis",
			runMode: "analysis",
			intentText: "kamino withdraw 1.25 USDC",
			marketAddress,
		});

		expect(result.details).toMatchObject({
			runId: "run-kamino-withdraw-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lend.kamino.withdraw",
						ownerAddress: signer.publicKey.toBase58(),
						reserveMint: USDC_MINT,
						amountRaw: "1250000",
						marketAddress,
					},
				},
			},
		});
	});

	it("enforces mainnet confirm token for kamino withdraw execute", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const reserveAddress = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([6]),
		});
		runtimeMocks.buildKaminoWithdrawInstructions.mockResolvedValue({
			network: "mainnet-beta",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId: Keypair.generate().publicKey.toBase58(),
			reserveMint: USDC_MINT,
			reserveAddress,
			reserveSymbol: "USDC",
			amountRaw: "1000",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			obligationAddress,
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["withdraw"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 1,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 89,
				},
			}),
			sendRawTransaction: vi.fn().mockResolvedValue("kamino-withdraw-sig"),
			confirmTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const simulated = await tool.execute("wf-kamino-withdraw-sim", {
			runId: "run-kamino-withdraw",
			intentType: "solana.lend.kamino.withdraw",
			runMode: "simulate",
			marketAddress,
			reserveMint: USDC_MINT,
			amountRaw: "1000",
			network: "mainnet-beta",
		});
		const confirmToken = (
			simulated.details as {
				artifacts?: { approval?: { confirmToken?: string | null } };
			}
		).artifacts?.approval?.confirmToken;
		if (!confirmToken) throw new Error("confirmToken not returned");

		await expect(
			tool.execute("wf-kamino-withdraw-exec-missing-confirm", {
				runId: "run-kamino-withdraw",
				intentType: "solana.lend.kamino.withdraw",
				runMode: "execute",
				marketAddress,
				reserveMint: USDC_MINT,
				amountRaw: "1000",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");

		await expect(
			tool.execute("wf-kamino-withdraw-exec-invalid-token", {
				runId: "run-kamino-withdraw",
				intentType: "solana.lend.kamino.withdraw",
				runMode: "execute",
				marketAddress,
				reserveMint: USDC_MINT,
				amountRaw: "1000",
				network: "mainnet-beta",
				confirmMainnet: true,
				confirmToken: "SOL-WRONGTOKEN",
			}),
		).rejects.toThrow("provided=SOL-WRONGTOKEN");

		const executed = await tool.execute("wf-kamino-withdraw-exec", {
			runId: "run-kamino-withdraw",
			intentType: "solana.lend.kamino.withdraw",
			runMode: "execute",
			marketAddress,
			reserveMint: USDC_MINT,
			amountRaw: "1000",
			network: "mainnet-beta",
			confirmMainnet: true,
			confirmToken,
		});

		expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(executed.details).toMatchObject({
			runId: "run-kamino-withdraw",
			status: "executed",
			artifacts: {
				execute: {
					signature: "kamino-withdraw-sig",
					guardChecks: {
						approvalRequired: true,
						confirmMainnetProvided: true,
						confirmTokenMatched: true,
						simulationOk: true,
					},
				},
			},
		});
	});

	it("parses stake delegate intentText and infers stake intent fields", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const stakeAccountAddress = Keypair.generate().publicKey.toBase58();
		const voteAccountAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-stake-delegate", {
			runId: "run-intent-stake-delegate",
			runMode: "analysis",
			intentText: `delegate stake stakeAccountAddress=${stakeAccountAddress} voteAccountAddress=${voteAccountAddress}`,
		});

		expect(result.details).toMatchObject({
			runId: "run-intent-stake-delegate",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.stake.delegate",
						stakeAuthorityAddress: signer.publicKey.toBase58(),
						stakeAccountAddress,
						voteAccountAddress,
					},
				},
			},
		});
	});

	it("parses stake authorize withdrawer intentText", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const stakeAccountAddress = Keypair.generate().publicKey.toBase58();
		const newAuthorityAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-stake-authorize", {
			runId: "run-intent-stake-authorize",
			runMode: "analysis",
			intentText: `authorize withdrawer stakeAccountAddress=${stakeAccountAddress} newAuthorityAddress=${newAuthorityAddress}`,
		});

		expect(result.details).toMatchObject({
			runId: "run-intent-stake-authorize",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.stake.authorizeWithdrawer",
						stakeAuthorityAddress: signer.publicKey.toBase58(),
						stakeAccountAddress,
						newAuthorityAddress,
					},
				},
			},
		});
	});

	it("parses stake create-and-delegate intentText", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const voteAccountAddress = Keypair.generate().publicKey.toBase58();
		const runId = "run-stake-create";
		const expectedStakeSeed = "w3rt-run-stake-create";
		const expectedStakeAccount = (
			await PublicKey.createWithSeed(
				signer.publicKey,
				expectedStakeSeed,
				StakeProgram.programId,
			)
		).toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-stake-create", {
			runId,
			runMode: "analysis",
			intentText: `stake 0.000001 SOL to ${voteAccountAddress}`,
		});

		expect(runtimeMocks.toLamports).toHaveBeenCalledWith(0.000001);
		expect(result.details).toMatchObject({
			runId,
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.stake.createAndDelegate",
						stakeAuthorityAddress: signer.publicKey.toBase58(),
						withdrawAuthorityAddress: signer.publicKey.toBase58(),
						voteAccountAddress,
						stakeSeed: expectedStakeSeed,
						stakeAccountAddress: expectedStakeAccount,
						amountSol: 0.000001,
						lamports: 1000,
					},
				},
			},
		});
	});

	it("simulates stake create-and-delegate workflow intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const voteAccountAddress = Keypair.generate().publicKey.toBase58();
		const runId = "run-stake-create-sim";
		const expectedStakeSeed = "w3rt-run-stake-create-sim";
		const expectedStakeAccount = (
			await PublicKey.createWithSeed(
				signer.publicKey,
				expectedStakeSeed,
				StakeProgram.programId,
			)
		).toBase58();
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 1,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 78,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-stake-create-sim", {
			runId,
			intentType: "solana.stake.createAndDelegate",
			runMode: "simulate",
			voteAccountAddress,
			amountSol: 0.000001,
		});

		expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			runId,
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.stake.createAndDelegate",
						stakeAuthorityAddress: signer.publicKey.toBase58(),
						withdrawAuthorityAddress: signer.publicKey.toBase58(),
						stakeSeed: expectedStakeSeed,
						stakeAccountAddress: expectedStakeAccount,
						voteAccountAddress,
						amountSol: 0.000001,
						lamports: 1000,
					},
				},
				simulate: {
					ok: true,
					context: {
						action: "createAndDelegate",
						stakeAuthorityAddress: signer.publicKey.toBase58(),
						withdrawAuthorityAddress: signer.publicKey.toBase58(),
						stakeSeed: expectedStakeSeed,
						stakeAccountAddress: expectedStakeAccount,
						voteAccountAddress,
						amountSol: 0.000001,
						lamports: 1000,
					},
				},
			},
		});
	});

	it("simulates stake authorize workflow intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const stakeAccountAddress = Keypair.generate().publicKey.toBase58();
		const newAuthorityAddress = Keypair.generate().publicKey.toBase58();
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 1,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 70,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-stake-authorize-sim", {
			runId: "run-stake-authorize-sim",
			intentType: "solana.stake.authorizeWithdrawer",
			runMode: "simulate",
			stakeAccountAddress,
			newAuthorityAddress,
		});

		expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			runId: "run-stake-authorize-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.stake.authorizeWithdrawer",
						stakeAuthorityAddress: signer.publicKey.toBase58(),
						stakeAccountAddress,
						newAuthorityAddress,
					},
				},
				simulate: {
					ok: true,
					context: {
						action: "authorize",
						authorizationType: "withdrawer",
						stakeAuthorityAddress: signer.publicKey.toBase58(),
						stakeAccountAddress,
						newAuthorityAddress,
					},
				},
			},
		});
	});

	it("simulates stake delegate workflow intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const stakeAccountAddress = Keypair.generate().publicKey.toBase58();
		const voteAccountAddress = Keypair.generate().publicKey.toBase58();
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 1,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 77,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-stake-delegate-sim", {
			runId: "run-stake-delegate-sim",
			intentType: "solana.stake.delegate",
			runMode: "simulate",
			stakeAccountAddress,
			voteAccountAddress,
		});

		expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			runId: "run-stake-delegate-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.stake.delegate",
						stakeAuthorityAddress: signer.publicKey.toBase58(),
						stakeAccountAddress,
						voteAccountAddress,
					},
				},
				simulate: {
					ok: true,
					context: {
						action: "delegate",
						stakeAuthorityAddress: signer.publicKey.toBase58(),
						stakeAccountAddress,
						voteAccountAddress,
					},
				},
			},
		});
	});

	it("enforces mainnet confirm token for stake withdraw execute", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const stakeAccountAddress = Keypair.generate().publicKey.toBase58();
		const toAddress = Keypair.generate().publicKey.toBase58();
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 1,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 66,
				},
			}),
			sendRawTransaction: vi.fn().mockResolvedValue("stake-withdraw-sig"),
			confirmTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const simulated = await tool.execute("wf-stake-withdraw-sim", {
			runId: "run-stake-withdraw",
			intentType: "solana.stake.withdraw",
			runMode: "simulate",
			stakeAccountAddress,
			toAddress,
			amountSol: 0.000001,
		});
		expect(runtimeMocks.toLamports).toHaveBeenCalledWith(0.000001);
		const confirmToken = (
			simulated.details as {
				artifacts?: { approval?: { confirmToken?: string | null } };
			}
		).artifacts?.approval?.confirmToken;
		if (!confirmToken) throw new Error("confirmToken not returned");

		await expect(
			tool.execute("wf-stake-withdraw-exec-missing-confirm", {
				runId: "run-stake-withdraw",
				intentType: "solana.stake.withdraw",
				runMode: "execute",
				stakeAccountAddress,
				toAddress,
				amountSol: 0.000001,
			}),
		).rejects.toThrow("confirmMainnet=true");

		await expect(
			tool.execute("wf-stake-withdraw-exec-invalid-token", {
				runId: "run-stake-withdraw",
				intentType: "solana.stake.withdraw",
				runMode: "execute",
				stakeAccountAddress,
				toAddress,
				amountSol: 0.000001,
				confirmMainnet: true,
				confirmToken: "SOL-WRONGTOKEN",
			}),
		).rejects.toThrow("provided=SOL-WRONGTOKEN");

		const executed = await tool.execute("wf-stake-withdraw-exec", {
			runId: "run-stake-withdraw",
			intentType: "solana.stake.withdraw",
			runMode: "execute",
			stakeAccountAddress,
			toAddress,
			amountSol: 0.000001,
			confirmMainnet: true,
			confirmToken,
		});
		expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(executed.details).toMatchObject({
			runId: "run-stake-withdraw",
			status: "executed",
			artifacts: {
				execute: {
					signature: "stake-withdraw-sig",
					guardChecks: {
						approvalRequired: true,
						confirmMainnetProvided: true,
						confirmTokenMatched: true,
						simulationOk: true,
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

	it("parses swap intentText with exclude-orca hint without forcing orca intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-swap-exclude-orca", {
			runId: "run-intent-swap-exclude-orca",
			runMode: "analysis",
			intentText: "swap 0.1 SOL to USDC exclude orca",
		});

		expect(result.details).toMatchObject({
			runId: "run-intent-swap-exclude-orca",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.swap.jupiter",
						excludeDexes: ["Orca V2", "Orca Whirlpool"],
					},
				},
			},
		});
	});

	it("simulates Jupiter swap with exclude-orca hint and passes excludeDexes", async () => {
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
					unitsConsumed: 88,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-swap-exclude-orca-sim", {
			runId: "run-intent-swap-exclude-orca-sim",
			runMode: "simulate",
			intentText: "swap 0.1 SOL to USDC exclude orca",
		});

		expect(runtimeMocks.getJupiterQuote).toHaveBeenCalledWith(
			expect.objectContaining({
				excludeDexes: ["Orca V2", "Orca Whirlpool"],
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-intent-swap-exclude-orca-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.swap.jupiter",
						excludeDexes: ["Orca V2", "Orca Whirlpool"],
					},
				},
				simulate: {
					ok: true,
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

	it("falls back to Jupiter routing when Orca route is unavailable and fallback is enabled", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		runtimeMocks.getJupiterQuote
			.mockResolvedValueOnce({
				outAmount: "0",
				routePlan: [],
			})
			.mockResolvedValueOnce({
				outAmount: "77",
				routePlan: [{ route: "jupiter" }],
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
					unitsConsumed: 101,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-intent-swap-orca-fallback", {
			runId: "run-intent-swap-orca-fallback",
			runMode: "simulate",
			intentType: "solana.swap.orca",
			inputMint: SOL_MINT,
			outputMint: USDC_MINT,
			amountRaw: "1000000",
			fallbackToJupiterOnNoRoute: true,
		});

		expect(runtimeMocks.getJupiterQuote).toHaveBeenCalledTimes(2);
		expect(runtimeMocks.getJupiterQuote.mock.calls[0]?.[0]).toMatchObject({
			dexes: ["Orca V2", "Orca Whirlpool"],
		});
		expect(runtimeMocks.getJupiterQuote.mock.calls[1]?.[0]).toMatchObject({
			dexes: undefined,
		});
		expect(result.details).toMatchObject({
			runId: "run-intent-swap-orca-fallback",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.swap.orca",
						fallbackToJupiterOnNoRoute: true,
					},
				},
				simulate: {
					ok: true,
					context: {
						fallbackApplied: true,
						routeSource: "jupiter-fallback",
						outAmount: "77",
						routeCount: 1,
					},
				},
			},
		});
	});

	it("fails clearly when Orca-scoped route is unavailable", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "0",
			routePlan: [],
		});
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-intent-swap-orca-no-route", {
				runId: "run-intent-swap-orca-no-route",
				runMode: "simulate",
				intentType: "solana.swap.orca",
				inputMint: SOL_MINT,
				outputMint: USDC_MINT,
				amountRaw: "1000000",
			}),
		).rejects.toThrow("No Orca route found");
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

	it("analyzes Orca increase-liquidity workflow intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-lp-analysis", {
			runId: "run-orca-lp-analysis",
			intentType: "solana.lp.orca.increase",
			runMode: "analysis",
			positionMint,
			liquidityAmountRaw: "123",
		});

		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			runId: "run-orca-lp-analysis",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.increase",
						positionMint,
						liquidityAmountRaw: "123",
					},
				},
			},
		});
	});

	it("simulates Orca decrease-liquidity workflow intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.buildOrcaDecreaseLiquidityInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			positionMint,
			quoteParamKind: "tokenA",
			quoteParamAmountRaw: "55",
			slippageBps: 75,
			instructionCount: 1,
			quote: { tokenMinA: "1", tokenMinB: "1" },
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([5]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 77,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 222,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-lp-sim", {
			runId: "run-orca-lp-sim",
			intentType: "solana.lp.orca.decrease",
			runMode: "simulate",
			positionMint,
			tokenAAmountRaw: "55",
		});

		expect(
			runtimeMocks.buildOrcaDecreaseLiquidityInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				positionMint,
				tokenAAmountRaw: "55",
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-orca-lp-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.decrease",
						positionMint,
						tokenAAmountRaw: "55",
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});

	it("parses Orca decrease intentText with percentage shorthand", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-decrease-intent", {
			runId: "run-orca-decrease-intent",
			runMode: "analysis",
			intentText: `orca decrease liquidity ${positionMint} 50%`,
		});

		expect(result.details).toMatchObject({
			runId: "run-orca-decrease-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.decrease",
						positionMint,
						liquidityBps: 5000,
					},
				},
			},
		});
	});

	it("resolves Orca decrease liquidityBps into liquidityAmountRaw", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getOrcaWhirlpoolPositions.mockResolvedValue({
			protocol: "orca-whirlpool",
			address: signer.publicKey.toBase58(),
			network: "devnet",
			positionCount: 1,
			bundleCount: 0,
			poolCount: 1,
			whirlpoolAddresses: [Keypair.generate().publicKey.toBase58()],
			positions: [
				{
					positionMint,
					liquidity: "2000",
				},
			],
			queryErrors: [],
		});
		runtimeMocks.buildOrcaDecreaseLiquidityInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			positionMint,
			quoteParamKind: "liquidity",
			quoteParamAmountRaw: "500",
			slippageBps: 75,
			instructionCount: 1,
			quote: { tokenMinA: "1", tokenMinB: "1" },
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([12]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 78,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 223,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-lp-sim-bps", {
			runId: "run-orca-lp-sim-bps",
			intentType: "solana.lp.orca.decrease",
			runMode: "simulate",
			positionMint,
			liquidityBps: 2500,
		});

		expect(runtimeMocks.getOrcaWhirlpoolPositions).toHaveBeenCalledWith({
			address: signer.publicKey.toBase58(),
			network: "devnet",
		});
		expect(
			runtimeMocks.buildOrcaDecreaseLiquidityInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				positionMint,
				liquidityAmountRaw: "500",
				tokenAAmountRaw: undefined,
				tokenBAmountRaw: undefined,
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-orca-lp-sim-bps",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.decrease",
						positionMint,
						liquidityBps: 2500,
					},
				},
				simulate: {
					ok: true,
					context: {
						resolvedLiquidityAmountRaw: "500",
						requestedLiquidityBps: 2500,
					},
				},
			},
		});
	});

	it("rejects Orca decrease when liquidityBps is combined with raw amount fields", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-orca-decrease-conflict", {
				runId: "run-orca-decrease-conflict",
				intentType: "solana.lp.orca.decrease",
				runMode: "analysis",
				positionMint,
				liquidityAmountRaw: "10",
				liquidityBps: 5000,
			}),
		).rejects.toThrow(
			"Provide either liquidityBps or one of liquidityAmountRaw/tokenAAmountRaw/tokenBAmountRaw/tokenAAmountUi/tokenBAmountUi",
		);
	});

	it("parses Orca open intentText with shorthand LP fields", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-open-intent", {
			runId: "run-orca-open-intent",
			runMode: "analysis",
			intentText: `open orca position pool ${poolAddress} full range tokenA 100 slippage 0.5%`,
		});

		expect(result.details).toMatchObject({
			runId: "run-orca-open-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.open",
						poolAddress,
						tokenAAmountRaw: "100",
						fullRange: true,
						slippageBps: 50,
					},
				},
			},
		});
	});

	it("parses Orca open intentText with UI token amounts and symbols", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-open-ui-intent", {
			runId: "run-orca-open-ui-intent",
			runMode: "analysis",
			intentText: `open orca position pool ${poolAddress} tokenA 1.25 USDC full range`,
		});

		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			runId: "run-orca-open-ui-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.open",
						poolAddress,
						tokenAAmountRaw: "1250000",
						fullRange: true,
					},
				},
			},
		});
	});

	it("parses Orca open intentText with generic amount token shorthand", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getOrcaWhirlpoolPool.mockResolvedValueOnce({
			protocol: "orca-whirlpool",
			poolAddress,
			network: "devnet",
			tokenMintA: USDC_MINT,
			tokenMintB: SOL_MINT,
			tickSpacing: null,
			feeRate: null,
			currentTickIndex: null,
			rewardMints: [],
			queryErrors: [],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-open-generic-intent", {
			runId: "run-orca-open-generic-intent",
			runMode: "analysis",
			intentText: `open orca position pool ${poolAddress} amount 1.25 USDC`,
		});

		expect(runtimeMocks.getOrcaWhirlpoolPool).toHaveBeenCalledWith({
			poolAddress,
			network: "devnet",
		});
		expect(result.details).toMatchObject({
			runId: "run-orca-open-generic-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.open",
						poolAddress,
						tokenAAmountRaw: "1250000",
						fullRange: true,
					},
				},
			},
		});
	});

	it("defaults Orca open structured generic amountUi to fullRange when range is omitted", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getOrcaWhirlpoolPool.mockResolvedValueOnce({
			protocol: "orca-whirlpool",
			poolAddress,
			network: "devnet",
			tokenMintA: USDC_MINT,
			tokenMintB: SOL_MINT,
			tickSpacing: null,
			feeRate: null,
			currentTickIndex: null,
			rewardMints: [],
			queryErrors: [],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-open-generic-default-range", {
			runId: "run-orca-open-generic-default-range",
			intentType: "solana.lp.orca.open",
			runMode: "analysis",
			poolAddress,
			amountUi: "1",
			tokenMint: "USDC",
		});

		expect(runtimeMocks.getOrcaWhirlpoolPool).toHaveBeenCalledWith({
			poolAddress,
			network: "devnet",
		});
		expect(result.details).toMatchObject({
			runId: "run-orca-open-generic-default-range",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.open",
						poolAddress,
						tokenAAmountRaw: "1000000",
						fullRange: true,
					},
				},
			},
		});
	});

	it("requires explicit range prices when Orca open fullRange is false", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-orca-open-no-range-explicit-false", {
				runId: "run-orca-open-no-range-explicit-false",
				intentType: "solana.lp.orca.open",
				runMode: "analysis",
				poolAddress,
				tokenAAmountRaw: "1000",
				fullRange: false,
			}),
		).rejects.toThrow("lowerPrice must be a positive number");
	});

	it("rejects Orca open when raw and UI amount are both provided for tokenA", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-orca-open-ui-conflict", {
				runId: "run-orca-open-ui-conflict",
				intentType: "solana.lp.orca.open",
				runMode: "analysis",
				poolAddress,
				tokenAAmountRaw: "1000",
				tokenAAmountUi: "1",
				tokenAMint: "USDC",
			}),
		).rejects.toThrow(
			"Provide either tokenAAmountRaw or tokenAAmountUi for Orca LP intents, not both",
		);
	});

	it("rejects Orca open generic amountUi when tokenMint is missing", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-orca-open-generic-missing-mint", {
				runId: "run-orca-open-generic-missing-mint",
				intentType: "solana.lp.orca.open",
				runMode: "analysis",
				poolAddress,
				amountUi: "1",
				fullRange: true,
			}),
		).rejects.toThrow(
			"tokenMint is required when amountUi or amountRaw is provided for intentType=solana.lp.orca.open",
		);
	});

	it("rejects Orca open when generic and side-specific amount fields are mixed", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-orca-open-generic-conflict", {
				runId: "run-orca-open-generic-conflict",
				intentType: "solana.lp.orca.open",
				runMode: "analysis",
				poolAddress,
				amountUi: "1",
				tokenMint: "USDC",
				tokenAAmountRaw: "1000",
				fullRange: true,
			}),
		).rejects.toThrow(
			"Provide either amountUi/tokenMint (or amountRaw/tokenMint) or side-specific Orca amount fields, not both",
		);
	});

	it("simulates Orca open-position workflow intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.buildOrcaOpenPositionInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			poolAddress,
			positionMint,
			quoteParamKind: "tokenA",
			quoteParamAmountRaw: "100",
			fullRange: true,
			initializationCostLamports: "0",
			slippageBps: 50,
			instructionCount: 1,
			quote: { liquidityAmount: "123" },
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([8]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 88,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 333,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-open-sim", {
			runId: "run-orca-open-sim",
			intentType: "solana.lp.orca.open",
			runMode: "simulate",
			poolAddress,
			tokenAAmountRaw: "100",
			fullRange: true,
			slippageBps: 50,
		});

		expect(runtimeMocks.buildOrcaOpenPositionInstructions).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				poolAddress,
				tokenAAmountRaw: "100",
				fullRange: true,
				slippageBps: 50,
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-orca-open-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.open",
						poolAddress,
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});

	it("resolves Orca open generic amountUi/tokenMint via pool token mints", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getOrcaWhirlpoolPool.mockResolvedValueOnce({
			protocol: "orca-whirlpool",
			poolAddress,
			network: "devnet",
			tokenMintA: USDC_MINT,
			tokenMintB: SOL_MINT,
			tickSpacing: null,
			feeRate: null,
			currentTickIndex: null,
			rewardMints: [],
			queryErrors: [],
		});
		runtimeMocks.buildOrcaOpenPositionInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			poolAddress,
			positionMint,
			quoteParamKind: "tokenB",
			quoteParamAmountRaw: "10000000",
			fullRange: true,
			initializationCostLamports: "0",
			slippageBps: 50,
			instructionCount: 1,
			quote: { liquidityAmount: "123" },
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([18]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 89,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 334,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-open-generic-ui-sim", {
			runId: "run-orca-open-generic-ui-sim",
			intentType: "solana.lp.orca.open",
			runMode: "simulate",
			poolAddress,
			amountUi: "0.01",
			tokenMint: "SOL",
			fullRange: true,
			slippageBps: 50,
		});

		expect(runtimeMocks.getOrcaWhirlpoolPool).toHaveBeenCalledWith({
			poolAddress,
			network: "devnet",
		});
		expect(runtimeMocks.buildOrcaOpenPositionInstructions).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				poolAddress,
				tokenBAmountRaw: "10000000",
				fullRange: true,
				slippageBps: 50,
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-orca-open-generic-ui-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.open",
						poolAddress,
						tokenBAmountRaw: "10000000",
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});

	it("resolves Orca increase UI amounts via position token mints", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getOrcaWhirlpoolPositions.mockResolvedValue({
			protocol: "orca-whirlpool",
			address: signer.publicKey.toBase58(),
			network: "devnet",
			positionCount: 1,
			bundleCount: 0,
			poolCount: 1,
			whirlpoolAddresses: [Keypair.generate().publicKey.toBase58()],
			positions: [
				{
					positionMint,
					tokenMintA: USDC_MINT,
					tokenMintB: SOL_MINT,
				},
			],
			queryErrors: [],
		});
		runtimeMocks.buildOrcaIncreaseLiquidityInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			positionMint,
			quoteParamKind: "tokenA",
			quoteParamAmountRaw: "1500000",
			slippageBps: 75,
			instructionCount: 1,
			quote: { tokenEstA: "1", tokenEstB: "1" },
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([15]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 94,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 338,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-increase-ui-sim", {
			runId: "run-orca-increase-ui-sim",
			intentType: "solana.lp.orca.increase",
			runMode: "simulate",
			positionMint,
			tokenAAmountUi: "1.5",
		});

		expect(runtimeMocks.getOrcaWhirlpoolPositions).toHaveBeenCalledWith({
			address: signer.publicKey.toBase58(),
			network: "devnet",
		});
		expect(
			runtimeMocks.buildOrcaIncreaseLiquidityInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				positionMint,
				tokenAAmountRaw: "1500000",
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-orca-increase-ui-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.increase",
						positionMint,
						tokenAAmountRaw: "1500000",
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});

	it("parses Orca increase intentText with generic amount/token fields", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getOrcaWhirlpoolPositions.mockResolvedValue({
			protocol: "orca-whirlpool",
			address: signer.publicKey.toBase58(),
			network: "devnet",
			positionCount: 1,
			bundleCount: 0,
			poolCount: 1,
			whirlpoolAddresses: [Keypair.generate().publicKey.toBase58()],
			positions: [
				{
					positionMint,
					tokenMintA: USDC_MINT,
					tokenMintB: SOL_MINT,
				},
			],
			queryErrors: [],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-increase-generic-intent", {
			runId: "run-orca-increase-generic-intent",
			runMode: "analysis",
			intentText: "orca increase liquidity amount 1.5 USDC",
		});

		expect(runtimeMocks.getOrcaWhirlpoolPositions).toHaveBeenCalledWith({
			address: signer.publicKey.toBase58(),
			network: "devnet",
		});
		expect(result.details).toMatchObject({
			runId: "run-orca-increase-generic-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.increase",
						positionMint,
						tokenAAmountRaw: "1500000",
					},
				},
			},
		});
	});

	it("rejects Orca increase generic amountUi when tokenMint is missing", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-orca-increase-generic-missing-mint", {
				runId: "run-orca-increase-generic-missing-mint",
				intentType: "solana.lp.orca.increase",
				runMode: "analysis",
				positionMint,
				amountUi: "1.5",
			}),
		).rejects.toThrow(
			"tokenMint is required when amountUi is provided for intentType=solana.lp.orca.increase",
		);
	});

	it("resolves Orca decrease UI amounts via position token mints", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getOrcaWhirlpoolPositions.mockResolvedValue({
			protocol: "orca-whirlpool",
			address: signer.publicKey.toBase58(),
			network: "devnet",
			positionCount: 1,
			bundleCount: 0,
			poolCount: 1,
			whirlpoolAddresses: [Keypair.generate().publicKey.toBase58()],
			positions: [
				{
					positionMint,
					tokenMintA: USDC_MINT,
					tokenMintB: SOL_MINT,
				},
			],
			queryErrors: [],
		});
		runtimeMocks.buildOrcaDecreaseLiquidityInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			positionMint,
			quoteParamKind: "tokenB",
			quoteParamAmountRaw: "10000000",
			slippageBps: 75,
			instructionCount: 1,
			quote: { tokenMinA: "1", tokenMinB: "1" },
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([16]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 95,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 339,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-decrease-ui-sim", {
			runId: "run-orca-decrease-ui-sim",
			intentType: "solana.lp.orca.decrease",
			runMode: "simulate",
			positionMint,
			tokenBAmountUi: "0.01",
		});

		expect(runtimeMocks.getOrcaWhirlpoolPositions).toHaveBeenCalledWith({
			address: signer.publicKey.toBase58(),
			network: "devnet",
		});
		expect(
			runtimeMocks.buildOrcaDecreaseLiquidityInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				positionMint,
				tokenBAmountRaw: "10000000",
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-orca-decrease-ui-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.decrease",
						positionMint,
						tokenBAmountRaw: "10000000",
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});

	it("parses Orca decrease intentText with generic amount/token fields", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getOrcaWhirlpoolPositions.mockResolvedValue({
			protocol: "orca-whirlpool",
			address: signer.publicKey.toBase58(),
			network: "devnet",
			positionCount: 1,
			bundleCount: 0,
			poolCount: 1,
			whirlpoolAddresses: [Keypair.generate().publicKey.toBase58()],
			positions: [
				{
					positionMint,
					tokenMintA: USDC_MINT,
					tokenMintB: SOL_MINT,
				},
			],
			queryErrors: [],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-decrease-generic-intent", {
			runId: "run-orca-decrease-generic-intent",
			runMode: "analysis",
			intentText: `orca decrease liquidity position ${positionMint} amount 0.01 SOL`,
		});

		expect(runtimeMocks.getOrcaWhirlpoolPositions).toHaveBeenCalledWith({
			address: signer.publicKey.toBase58(),
			network: "devnet",
		});
		expect(result.details).toMatchObject({
			runId: "run-orca-decrease-generic-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.decrease",
						positionMint,
						tokenBAmountRaw: "10000000",
					},
				},
			},
		});
	});

	it("rejects Orca decrease when liquidityBps is combined with UI amount fields", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-orca-decrease-ui-bps-conflict", {
				runId: "run-orca-decrease-ui-bps-conflict",
				intentType: "solana.lp.orca.decrease",
				runMode: "analysis",
				positionMint,
				tokenAAmountUi: "1",
				liquidityBps: 5000,
			}),
		).rejects.toThrow(
			"Provide either liquidityBps or one of liquidityAmountRaw/tokenAAmountRaw/tokenBAmountRaw/tokenAAmountUi/tokenBAmountUi",
		);
	});

	it("simulates Orca close-position workflow intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.buildOrcaClosePositionInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			positionMint,
			slippageBps: 75,
			instructionCount: 1,
			quote: { tokenMinA: "1", tokenMinB: "1" },
			feesQuote: { tokenA: "1", tokenB: "1" },
			rewardsQuote: [],
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([9]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 89,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 334,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-close-sim", {
			runId: "run-orca-close-sim",
			intentType: "solana.lp.orca.close",
			runMode: "simulate",
			positionMint,
			slippageBps: 75,
		});

		expect(
			runtimeMocks.buildOrcaClosePositionInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				positionMint,
				slippageBps: 75,
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-orca-close-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.close",
						positionMint,
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});

	it("parses Orca harvest intentText with position shorthand", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-harvest-intent", {
			runId: "run-orca-harvest-intent",
			runMode: "analysis",
			intentText: `orca harvest fees rewards position ${positionMint}`,
		});

		expect(result.details).toMatchObject({
			runId: "run-orca-harvest-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.harvest",
						positionMint,
					},
				},
			},
		});
	});

	it("infers Orca harvest position when owner has a single position", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getOrcaWhirlpoolPositions.mockResolvedValue({
			protocol: "orca-whirlpool",
			address: signer.publicKey.toBase58(),
			network: "devnet",
			positionCount: 1,
			bundleCount: 0,
			poolCount: 1,
			whirlpoolAddresses: [Keypair.generate().publicKey.toBase58()],
			positions: [
				{
					positionAddress: Keypair.generate().publicKey.toBase58(),
					positionMint,
					positionBundleAddress: null,
					isBundledPosition: false,
					bundlePositionCount: null,
					tokenProgram: "token",
					whirlpoolAddress: Keypair.generate().publicKey.toBase58(),
					tokenMintA: SOL_MINT,
					tokenMintB: USDC_MINT,
					tickSpacing: 64,
					feeRate: 3000,
					currentTickIndex: 0,
					liquidity: "1000",
					tickLowerIndex: -128,
					tickUpperIndex: 128,
					feeOwedA: "0",
					feeOwedB: "0",
					rewards: [],
				},
			],
			queryErrors: [],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-harvest-infer-position", {
			runId: "run-orca-harvest-infer-position",
			runMode: "analysis",
			intentText: "orca harvest fees rewards",
		});

		expect(runtimeMocks.getOrcaWhirlpoolPositions).toHaveBeenCalledWith({
			address: signer.publicKey.toBase58(),
			network: "devnet",
		});
		expect(result.details).toMatchObject({
			runId: "run-orca-harvest-infer-position",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.harvest",
						positionMint,
					},
				},
			},
		});
	});

	it("simulates Orca harvest-position workflow intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.buildOrcaHarvestPositionInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			positionMint,
			instructionCount: 1,
			feesQuote: { feeOwedA: "2", feeOwedB: "3" },
			rewardsQuote: { rewards: [{ index: 0, amount: "4" }] },
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([12]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 90,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 335,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-orca-harvest-sim", {
			runId: "run-orca-harvest-sim",
			intentType: "solana.lp.orca.harvest",
			runMode: "simulate",
			positionMint,
		});

		expect(
			runtimeMocks.buildOrcaHarvestPositionInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				positionMint,
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-orca-harvest-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.orca.harvest",
						positionMint,
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});

	it("parses Meteora add intentText with shorthand LP fields", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-meteora-add-intent", {
			runId: "run-meteora-add-intent",
			runMode: "analysis",
			intentText: `meteora add liquidity ${poolAddress} ${positionAddress} x=1000 y=2000 strategy curve bins -10 to 20 slippage 1%`,
		});

		expect(result.details).toMatchObject({
			runId: "run-meteora-add-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.meteora.add",
						poolAddress,
						positionAddress,
						totalXAmountRaw: "1000",
						totalYAmountRaw: "2000",
						minBinId: -10,
						maxBinId: 20,
						strategyType: "Curve",
						slippageBps: 100,
					},
				},
			},
		});
	});

	it("parses Meteora add intentText with UI token amounts", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-meteora-add-ui-intent", {
			runId: "run-meteora-add-ui-intent",
			runMode: "analysis",
			intentText: `meteora add liquidity ${poolAddress} ${positionAddress} x 1.25 USDC y 0.01 SOL strategy curve bins -10 to 20`,
		});

		expect(result.details).toMatchObject({
			runId: "run-meteora-add-ui-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.meteora.add",
						poolAddress,
						positionAddress,
						totalXAmountRaw: "1250000",
						totalYAmountRaw: "10000000",
						minBinId: -10,
						maxBinId: 20,
						strategyType: "Curve",
					},
				},
			},
		});
	});

	it("infers Meteora add pool/position from single owner position", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getMeteoraDlmmPositions.mockResolvedValue({
			protocol: "meteora-dlmm",
			address: signer.publicKey.toBase58(),
			network: "devnet",
			positionCount: 1,
			poolCount: 1,
			poolAddresses: [poolAddress],
			pools: [
				{
					poolAddress,
					tokenXMint: USDC_MINT,
					tokenYMint: SOL_MINT,
					activeBinId: 0,
					binStep: 1,
					positionCount: 1,
					positions: [
						{
							positionAddress,
							poolAddress,
							ownerAddress: signer.publicKey.toBase58(),
							lowerBinId: -10,
							upperBinId: 20,
							totalXAmountRaw: "0",
							totalYAmountRaw: "0",
							feeXAmountRaw: "0",
							feeYAmountRaw: "0",
							rewardOneAmountRaw: "0",
							rewardTwoAmountRaw: "0",
						},
					],
				},
			],
			queryErrors: [],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-meteora-add-infer-position", {
			runId: "run-meteora-add-infer-position",
			runMode: "analysis",
			intentText: "meteora add liquidity x 1.5 USDC y 0.01 SOL",
		});

		expect(runtimeMocks.getMeteoraDlmmPositions).toHaveBeenCalledWith({
			address: signer.publicKey.toBase58(),
			network: "devnet",
		});
		expect(result.details).toMatchObject({
			runId: "run-meteora-add-infer-position",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.meteora.add",
						poolAddress,
						positionAddress,
						totalXAmountRaw: "1500000",
						totalYAmountRaw: "10000000",
					},
				},
			},
		});
	});

	it("parses Meteora add intentText with generic amount token shorthand", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getMeteoraDlmmPositions.mockResolvedValue({
			protocol: "meteora-dlmm",
			address: signer.publicKey.toBase58(),
			network: "devnet",
			positionCount: 1,
			poolCount: 1,
			poolAddresses: [poolAddress],
			pools: [
				{
					poolAddress,
					tokenXMint: USDC_MINT,
					tokenYMint: SOL_MINT,
					activeBinId: 0,
					binStep: 1,
					positionCount: 1,
					positions: [
						{
							positionAddress,
							poolAddress,
							ownerAddress: signer.publicKey.toBase58(),
							lowerBinId: -10,
							upperBinId: 20,
							totalXAmountRaw: "0",
							totalYAmountRaw: "0",
							feeXAmountRaw: "0",
							feeYAmountRaw: "0",
							rewardOneAmountRaw: "0",
							rewardTwoAmountRaw: "0",
						},
					],
				},
			],
			queryErrors: [],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-meteora-add-generic-intent", {
			runId: "run-meteora-add-generic-intent",
			runMode: "analysis",
			intentText: "meteora add liquidity amount 1.5 USDC",
		});

		expect(runtimeMocks.getMeteoraDlmmPositions).toHaveBeenCalledWith({
			address: signer.publicKey.toBase58(),
			network: "devnet",
		});
		expect(result.details).toMatchObject({
			runId: "run-meteora-add-generic-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.meteora.add",
						poolAddress,
						positionAddress,
						totalXAmountRaw: "1500000",
						totalYAmountRaw: "0",
					},
				},
			},
		});
	});

	it("simulates Meteora add-liquidity workflow intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		runtimeMocks.buildMeteoraAddLiquidityInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			poolAddress,
			positionAddress,
			totalXAmountRaw: "1000",
			totalYAmountRaw: "0",
			minBinId: -10,
			maxBinId: 20,
			strategyType: "Curve",
			singleSidedX: true,
			slippageBps: 100,
			activeBinId: 0,
			instructionCount: 1,
			transactionCount: 1,
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([10]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 90,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 335,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-meteora-add-sim", {
			runId: "run-meteora-add-sim",
			intentType: "solana.lp.meteora.add",
			runMode: "simulate",
			poolAddress,
			positionAddress,
			totalXAmountRaw: "1000",
			totalYAmountRaw: "0",
			minBinId: -10,
			maxBinId: 20,
			strategyType: "Curve",
			singleSidedX: true,
			slippageBps: 100,
		});

		expect(
			runtimeMocks.buildMeteoraAddLiquidityInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				poolAddress,
				positionAddress,
				totalXAmountRaw: "1000",
				totalYAmountRaw: "0",
				strategyType: "Curve",
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-meteora-add-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.meteora.add",
						poolAddress,
						positionAddress,
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});

	it("resolves Meteora add UI amounts via pool token mints", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getMeteoraDlmmPositions.mockResolvedValue({
			protocol: "meteora-dlmm",
			address: signer.publicKey.toBase58(),
			network: "devnet",
			positionCount: 1,
			poolCount: 1,
			poolAddresses: [poolAddress],
			pools: [
				{
					poolAddress,
					tokenXMint: USDC_MINT,
					tokenYMint: SOL_MINT,
					activeBinId: 0,
					binStep: 1,
					positionCount: 1,
					positions: [
						{
							positionAddress,
							poolAddress,
							ownerAddress: signer.publicKey.toBase58(),
							lowerBinId: -10,
							upperBinId: 20,
							totalXAmountRaw: "0",
							totalYAmountRaw: "0",
							feeXAmountRaw: "0",
							feeYAmountRaw: "0",
							rewardOneAmountRaw: "0",
							rewardTwoAmountRaw: "0",
						},
					],
				},
			],
			queryErrors: [],
		});
		runtimeMocks.buildMeteoraAddLiquidityInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			poolAddress,
			positionAddress,
			totalXAmountRaw: "1500000",
			totalYAmountRaw: "0",
			minBinId: -10,
			maxBinId: 20,
			strategyType: "Spot",
			singleSidedX: false,
			slippageBps: 100,
			activeBinId: 0,
			instructionCount: 1,
			transactionCount: 1,
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([13]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 92,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 337,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-meteora-add-ui-sim", {
			runId: "run-meteora-add-ui-sim",
			intentType: "solana.lp.meteora.add",
			runMode: "simulate",
			poolAddress,
			positionAddress,
			totalXAmountUi: "1.5",
		});

		expect(runtimeMocks.getMeteoraDlmmPositions).toHaveBeenCalledWith({
			address: signer.publicKey.toBase58(),
			network: "devnet",
		});
		expect(
			runtimeMocks.buildMeteoraAddLiquidityInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				poolAddress,
				positionAddress,
				totalXAmountRaw: "1500000",
				totalYAmountRaw: "0",
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-meteora-add-ui-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.meteora.add",
						poolAddress,
						positionAddress,
						totalXAmountRaw: "1500000",
						totalYAmountRaw: "0",
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});

	it("resolves Meteora add generic amountUi/tokenMint via pool token mints", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getMeteoraDlmmPositions.mockResolvedValue({
			protocol: "meteora-dlmm",
			address: signer.publicKey.toBase58(),
			network: "devnet",
			positionCount: 1,
			poolCount: 1,
			poolAddresses: [poolAddress],
			pools: [
				{
					poolAddress,
					tokenXMint: USDC_MINT,
					tokenYMint: SOL_MINT,
					activeBinId: 0,
					binStep: 1,
					positionCount: 1,
					positions: [
						{
							positionAddress,
							poolAddress,
							ownerAddress: signer.publicKey.toBase58(),
							lowerBinId: -10,
							upperBinId: 20,
							totalXAmountRaw: "0",
							totalYAmountRaw: "0",
							feeXAmountRaw: "0",
							feeYAmountRaw: "0",
							rewardOneAmountRaw: "0",
							rewardTwoAmountRaw: "0",
						},
					],
				},
			],
			queryErrors: [],
		});
		runtimeMocks.buildMeteoraAddLiquidityInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			poolAddress,
			positionAddress,
			totalXAmountRaw: "0",
			totalYAmountRaw: "10000000",
			minBinId: -10,
			maxBinId: 20,
			strategyType: "Spot",
			singleSidedX: false,
			slippageBps: 100,
			activeBinId: 0,
			instructionCount: 1,
			transactionCount: 1,
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([17]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 93,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 338,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-meteora-add-generic-ui-sim", {
			runId: "run-meteora-add-generic-ui-sim",
			intentType: "solana.lp.meteora.add",
			runMode: "simulate",
			poolAddress,
			positionAddress,
			amountUi: "0.01",
			tokenMint: "SOL",
		});

		expect(runtimeMocks.getMeteoraDlmmPositions).toHaveBeenCalledWith({
			address: signer.publicKey.toBase58(),
			network: "devnet",
		});
		expect(
			runtimeMocks.buildMeteoraAddLiquidityInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				poolAddress,
				positionAddress,
				totalXAmountRaw: "0",
				totalYAmountRaw: "10000000",
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-meteora-add-generic-ui-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.meteora.add",
						poolAddress,
						positionAddress,
						totalXAmountRaw: "0",
						totalYAmountRaw: "10000000",
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});

	it("rejects Meteora add when raw and UI amount are both provided for the same side", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-meteora-add-conflict", {
				runId: "run-meteora-add-conflict",
				intentType: "solana.lp.meteora.add",
				runMode: "analysis",
				poolAddress,
				positionAddress,
				totalXAmountRaw: "1000",
				totalXAmountUi: "1.0",
				totalYAmountRaw: "0",
			}),
		).rejects.toThrow(
			"Provide either totalXAmountRaw or totalXAmountUi, not both",
		);
	});

	it("rejects Meteora add generic amountUi when tokenMint is missing", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-meteora-add-generic-missing-mint", {
				runId: "run-meteora-add-generic-missing-mint",
				intentType: "solana.lp.meteora.add",
				runMode: "analysis",
				poolAddress,
				positionAddress,
				amountUi: "1",
			}),
		).rejects.toThrow(
			"tokenMint is required when amountUi or amountRaw is provided for intentType=solana.lp.meteora.add",
		);
	});

	it("rejects Meteora add when generic and side-specific amount fields are mixed", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		await expect(
			tool.execute("wf-meteora-add-generic-conflict", {
				runId: "run-meteora-add-generic-conflict",
				intentType: "solana.lp.meteora.add",
				runMode: "analysis",
				poolAddress,
				positionAddress,
				tokenMint: "USDC",
				amountUi: "1",
				totalXAmountRaw: "1000000",
				totalYAmountRaw: "0",
			}),
		).rejects.toThrow(
			"Provide either amountUi/tokenMint (or amountRaw/tokenMint) or side-specific totalX/totalY amount fields, not both",
		);
	});

	it("parses Meteora remove intentText with shorthand LP fields", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-meteora-remove-intent", {
			runId: "run-meteora-remove-intent",
			runMode: "analysis",
			intentText: `meteora remove liquidity ${poolAddress} ${positionAddress} bins -5 to 7 75% claim and close skip unwrap sol`,
		});

		expect(result.details).toMatchObject({
			runId: "run-meteora-remove-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.meteora.remove",
						poolAddress,
						positionAddress,
						fromBinId: -5,
						toBinId: 7,
						bps: 7500,
						shouldClaimAndClose: true,
						skipUnwrapSol: true,
					},
				},
			},
		});
	});

	it("parses Meteora remove intentText with half-position shorthand", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-meteora-remove-half-intent", {
			runId: "run-meteora-remove-half-intent",
			runMode: "analysis",
			intentText: `meteora remove liquidity ${poolAddress} ${positionAddress} half`,
		});

		expect(result.details).toMatchObject({
			runId: "run-meteora-remove-half-intent",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.meteora.remove",
						poolAddress,
						positionAddress,
						bps: 5000,
					},
				},
			},
		});
	});

	it("infers Meteora remove pool/position from single owner position", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getMeteoraDlmmPositions.mockResolvedValue({
			protocol: "meteora-dlmm",
			address: signer.publicKey.toBase58(),
			network: "devnet",
			positionCount: 1,
			poolCount: 1,
			poolAddresses: [poolAddress],
			pools: [
				{
					poolAddress,
					tokenXMint: USDC_MINT,
					tokenYMint: SOL_MINT,
					activeBinId: 0,
					binStep: 1,
					positionCount: 1,
					positions: [
						{
							positionAddress,
							poolAddress,
							ownerAddress: signer.publicKey.toBase58(),
							lowerBinId: -5,
							upperBinId: 7,
							totalXAmountRaw: "0",
							totalYAmountRaw: "0",
							feeXAmountRaw: "0",
							feeYAmountRaw: "0",
							rewardOneAmountRaw: "0",
							rewardTwoAmountRaw: "0",
						},
					],
				},
			],
			queryErrors: [],
		});
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-meteora-remove-infer-position", {
			runId: "run-meteora-remove-infer-position",
			runMode: "analysis",
			intentText: "meteora remove liquidity half",
		});

		expect(runtimeMocks.getMeteoraDlmmPositions).toHaveBeenCalledWith({
			address: signer.publicKey.toBase58(),
			network: "devnet",
		});
		expect(result.details).toMatchObject({
			runId: "run-meteora-remove-infer-position",
			status: "analysis",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.meteora.remove",
						poolAddress,
						positionAddress,
						bps: 5000,
					},
				},
			},
		});
	});

	it("simulates Meteora remove-liquidity workflow intent", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		runtimeMocks.buildMeteoraRemoveLiquidityInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			poolAddress,
			positionAddress,
			fromBinId: -5,
			toBinId: 7,
			bps: 7500,
			shouldClaimAndClose: true,
			skipUnwrapSol: true,
			positionLowerBinId: -8,
			positionUpperBinId: 8,
			activeBinId: 0,
			instructionCount: 1,
			transactionCount: 1,
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([11]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 91,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 336,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		const tool = getWorkflowTool();

		const result = await tool.execute("wf-meteora-remove-sim", {
			runId: "run-meteora-remove-sim",
			intentType: "solana.lp.meteora.remove",
			runMode: "simulate",
			poolAddress,
			positionAddress,
			fromBinId: -5,
			toBinId: 7,
			bps: 7500,
			shouldClaimAndClose: true,
			skipUnwrapSol: true,
		});

		expect(
			runtimeMocks.buildMeteoraRemoveLiquidityInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				poolAddress,
				positionAddress,
				fromBinId: -5,
				toBinId: 7,
				bps: 7500,
				shouldClaimAndClose: true,
				skipUnwrapSol: true,
			}),
		);
		expect(result.details).toMatchObject({
			runId: "run-meteora-remove-sim",
			status: "simulated",
			artifacts: {
				analysis: {
					intent: {
						type: "solana.lp.meteora.remove",
						poolAddress,
						positionAddress,
					},
				},
				simulate: {
					ok: true,
				},
			},
		});
	});
});
