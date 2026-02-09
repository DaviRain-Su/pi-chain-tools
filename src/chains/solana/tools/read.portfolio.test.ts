import { Keypair } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	TOKEN_PROGRAM_ID: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
	TOKEN_2022_PROGRAM_ID: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
	TOOL_PREFIX: "solana_",
	assertJupiterNetworkSupported: vi.fn(),
	assertRaydiumNetworkSupported: vi.fn(),
	callJupiterApi: vi.fn(),
	callRaydiumApi: vi.fn(),
	commitmentSchema: vi.fn(),
	getConnection: vi.fn(),
	getExplorerAddressUrl: vi.fn(),
	getExplorerTransactionUrl: vi.fn(),
	getJupiterApiBaseUrl: vi.fn(),
	getJupiterDexLabels: vi.fn(),
	getJupiterQuote: vi.fn(),
	getRaydiumApiBaseUrl: vi.fn(),
	getRaydiumPriorityFee: vi.fn(),
	getRaydiumPriorityFeeApiBaseUrl: vi.fn(),
	getRaydiumQuote: vi.fn(),
	jupiterSwapModeSchema: vi.fn(),
	normalizeAtPath: vi.fn((value: string) => value),
	parseCommitment: vi.fn(),
	parseFinality: vi.fn(),
	parseJupiterSwapMode: vi.fn(),
	parseNetwork: vi.fn(() => "mainnet-beta"),
	parsePositiveBigInt: vi.fn(),
	parseRaydiumSwapType: vi.fn(),
	parseRaydiumTxVersion: vi.fn(),
	parseTokenAccountInfo: vi.fn((value: unknown) => {
		const info = (value as { parsed?: { info?: unknown } }).parsed?.info as
			| {
					mint?: unknown;
					owner?: unknown;
					tokenAmount?: {
						amount?: unknown;
						decimals?: unknown;
						uiAmount?: unknown;
					};
			  }
			| undefined;
		if (
			!info ||
			typeof info.mint !== "string" ||
			typeof info.owner !== "string" ||
			!info.tokenAmount ||
			typeof info.tokenAmount.amount !== "string" ||
			typeof info.tokenAmount.decimals !== "number"
		) {
			return null;
		}
		return {
			mint: info.mint,
			owner: info.owner,
			tokenAmount: {
				amount: info.tokenAmount.amount,
				decimals: info.tokenAmount.decimals,
				uiAmount:
					typeof info.tokenAmount.uiAmount === "number"
						? info.tokenAmount.uiAmount
						: null,
			},
		};
	}),
	raydiumSwapTypeSchema: vi.fn(),
	raydiumTxVersionSchema: vi.fn(),
	solanaNetworkSchema: vi.fn(),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		TOKEN_PROGRAM_ID: runtimeMocks.TOKEN_PROGRAM_ID,
		TOKEN_2022_PROGRAM_ID: runtimeMocks.TOKEN_2022_PROGRAM_ID,
		TOOL_PREFIX: runtimeMocks.TOOL_PREFIX,
		assertJupiterNetworkSupported: runtimeMocks.assertJupiterNetworkSupported,
		assertRaydiumNetworkSupported: runtimeMocks.assertRaydiumNetworkSupported,
		callJupiterApi: runtimeMocks.callJupiterApi,
		callRaydiumApi: runtimeMocks.callRaydiumApi,
		commitmentSchema: runtimeMocks.commitmentSchema,
		getConnection: runtimeMocks.getConnection,
		getExplorerAddressUrl: runtimeMocks.getExplorerAddressUrl,
		getExplorerTransactionUrl: runtimeMocks.getExplorerTransactionUrl,
		getJupiterApiBaseUrl: runtimeMocks.getJupiterApiBaseUrl,
		getJupiterDexLabels: runtimeMocks.getJupiterDexLabels,
		getJupiterQuote: runtimeMocks.getJupiterQuote,
		getRaydiumApiBaseUrl: runtimeMocks.getRaydiumApiBaseUrl,
		getRaydiumPriorityFee: runtimeMocks.getRaydiumPriorityFee,
		getRaydiumPriorityFeeApiBaseUrl:
			runtimeMocks.getRaydiumPriorityFeeApiBaseUrl,
		getRaydiumQuote: runtimeMocks.getRaydiumQuote,
		jupiterSwapModeSchema: runtimeMocks.jupiterSwapModeSchema,
		normalizeAtPath: runtimeMocks.normalizeAtPath,
		parseCommitment: runtimeMocks.parseCommitment,
		parseFinality: runtimeMocks.parseFinality,
		parseJupiterSwapMode: runtimeMocks.parseJupiterSwapMode,
		parseNetwork: runtimeMocks.parseNetwork,
		parsePositiveBigInt: runtimeMocks.parsePositiveBigInt,
		parseRaydiumSwapType: runtimeMocks.parseRaydiumSwapType,
		parseRaydiumTxVersion: runtimeMocks.parseRaydiumTxVersion,
		parseTokenAccountInfo: runtimeMocks.parseTokenAccountInfo,
		raydiumSwapTypeSchema: runtimeMocks.raydiumSwapTypeSchema,
		raydiumTxVersionSchema: runtimeMocks.raydiumTxVersionSchema,
		solanaNetworkSchema: runtimeMocks.solanaNetworkSchema,
	};
});

import { createSolanaReadTools } from "./read.js";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type PortfolioTool = {
	execute(
		toolCallId: string,
		params: {
			address: string;
			includeZero?: boolean;
			includeToken2022?: boolean;
			network?: "mainnet-beta" | "devnet" | "testnet";
		},
	): Promise<{ details?: unknown }>;
};

type ReadTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ details?: unknown }>;
};

function getPortfolioTool(): PortfolioTool {
	const tool = createSolanaReadTools().find(
		(entry) => entry.name === "solana_getPortfolio",
	);
	if (!tool) throw new Error("solana_getPortfolio not found");
	return tool as unknown as PortfolioTool;
}

function getReadTool(name: string): ReadTool {
	const tool = createSolanaReadTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ReadTool;
}

function makeParsedTokenAccount(
	owner: string,
	mint: string,
	amount: string,
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
							amount,
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
	voter = Keypair.generate().publicKey.toBase58(),
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
								voter,
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

describe("solana_getPortfolio", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		runtimeMocks.getExplorerAddressUrl.mockImplementation(
			(value: string) => `https://explorer/${value}`,
		);
	});

	it("aggregates balances across token and token-2022 programs", async () => {
		const owner = Keypair.generate().publicKey.toBase58();
		const otherMint = Keypair.generate().publicKey.toBase58();
		const connection = {
			getBalance: vi.fn().mockResolvedValue(1_250_000_000),
			getParsedTokenAccountsByOwner: vi
				.fn()
				.mockResolvedValueOnce({
					value: [
						makeParsedTokenAccount(owner, USDC_MINT, "1500000", 6, 1.5),
						makeParsedTokenAccount(owner, USDC_MINT, "500000", 6, 0.5),
						makeParsedTokenAccount(owner, otherMint, "0", 9, 0),
					],
				})
				.mockResolvedValueOnce({
					value: [makeParsedTokenAccount(owner, otherMint, "3000000000", 9, 3)],
				}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getPortfolioTool();
		const result = await tool.execute("portfolio-1", {
			address: owner,
			network: "mainnet-beta",
		});

		expect(connection.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(2);
		expect(result.details).toMatchObject({
			address: owner,
			tokenCount: 2,
			tokenProgramAccountCount: 3,
			token2022AccountCount: 1,
			sol: {
				lamports: 1_250_000_000,
				uiAmount: 1.25,
			},
		});
		const details = result.details as {
			tokens?: Array<{
				mint: string;
				amount: string;
				uiAmount: string;
				symbol: string | null;
			}>;
		};
		const usdc = details.tokens?.find((entry) => entry.mint === USDC_MINT);
		const other = details.tokens?.find((entry) => entry.mint === otherMint);
		expect(usdc).toMatchObject({
			amount: "2000000",
			uiAmount: "2",
			symbol: "USDC",
		});
		expect(other).toMatchObject({
			amount: "3000000000",
			uiAmount: "3",
			symbol: null,
		});
	});

	it("skips token-2022 lookup when includeToken2022=false", async () => {
		const owner = Keypair.generate().publicKey.toBase58();
		const connection = {
			getBalance: vi.fn().mockResolvedValue(5_000_000_000),
			getParsedTokenAccountsByOwner: vi.fn().mockResolvedValue({
				value: [makeParsedTokenAccount(owner, USDC_MINT, "1000000", 6, 1)],
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getPortfolioTool();
		const result = await tool.execute("portfolio-2", {
			address: owner,
			includeToken2022: false,
			network: "mainnet-beta",
		});

		expect(connection.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			tokenProgramAccountCount: 1,
			token2022AccountCount: 0,
			tokenCount: 1,
		});
	});
});

describe("solana_getTokenAccounts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		runtimeMocks.getExplorerAddressUrl.mockImplementation(
			(value: string) => `https://explorer/${value}`,
		);
	});

	it("includes token-2022 accounts by default", async () => {
		const owner = Keypair.generate().publicKey.toBase58();
		const token2022Mint = Keypair.generate().publicKey.toBase58();
		const connection = {
			getParsedTokenAccountsByOwner: vi
				.fn()
				.mockResolvedValueOnce({
					value: [makeParsedTokenAccount(owner, USDC_MINT, "1000000", 6, 1)],
				})
				.mockResolvedValueOnce({
					value: [makeParsedTokenAccount(owner, token2022Mint, "500", 2, 5)],
				}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getReadTool("solana_getTokenAccounts");
		const result = await tool.execute("token-accounts-1", {
			address: owner,
			network: "mainnet-beta",
		});

		expect(connection.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(2);
		expect(result.details).toMatchObject({
			address: owner,
			count: 2,
			tokenProgramAccountCount: 1,
			token2022AccountCount: 1,
			tokenAccountCount: 2,
		});
	});
});

describe("solana_getTokenBalance", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		runtimeMocks.getExplorerAddressUrl.mockImplementation(
			(value: string) => `https://explorer/${value}`,
		);
	});

	it("aggregates token balance across token and token-2022 programs", async () => {
		const owner = Keypair.generate().publicKey.toBase58();
		const connection = {
			getParsedTokenAccountsByOwner: vi
				.fn()
				.mockResolvedValueOnce({
					value: [makeParsedTokenAccount(owner, USDC_MINT, "1000000", 6, 1)],
				})
				.mockResolvedValueOnce({
					value: [makeParsedTokenAccount(owner, USDC_MINT, "2000000", 6, 2)],
				}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getReadTool("solana_getTokenBalance");
		const result = await tool.execute("token-balance-1", {
			address: owner,
			tokenMint: USDC_MINT,
			network: "mainnet-beta",
		});

		expect(connection.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(2);
		expect(result.details).toMatchObject({
			address: owner,
			tokenMint: USDC_MINT,
			amount: "3000000",
			uiAmount: 3,
			tokenAccountCount: 2,
			tokenProgramAccountCount: 1,
			token2022AccountCount: 1,
		});
	});

	it("skips token-2022 for token balance when includeToken2022=false", async () => {
		const owner = Keypair.generate().publicKey.toBase58();
		const connection = {
			getParsedTokenAccountsByOwner: vi.fn().mockResolvedValue({
				value: [makeParsedTokenAccount(owner, USDC_MINT, "1000000", 6, 1)],
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getReadTool("solana_getTokenBalance");
		const result = await tool.execute("token-balance-2", {
			address: owner,
			tokenMint: USDC_MINT,
			includeToken2022: false,
			network: "mainnet-beta",
		});

		expect(connection.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			amount: "1000000",
			tokenAccountCount: 1,
			tokenProgramAccountCount: 1,
			token2022AccountCount: 0,
		});
	});
});

describe("solana_getDefiPositions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		runtimeMocks.getExplorerAddressUrl.mockImplementation(
			(value: string) => `https://explorer/${value}`,
		);
	});

	it("returns protocol-tagged token exposures and stake accounts", async () => {
		const owner = Keypair.generate().publicKey.toBase58();
		const stakeAccountOne = Keypair.generate().publicKey.toBase58();
		const stakeAccountTwo = Keypair.generate().publicKey.toBase58();
		const connection = {
			getBalance: vi.fn().mockResolvedValue(3_000_000_000),
			getParsedTokenAccountsByOwner: vi
				.fn()
				.mockResolvedValueOnce({
					value: [
						makeParsedTokenAccount(owner, USDC_MINT, "2000000", 6, 2),
						makeParsedTokenAccount(
							owner,
							"mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
							"500000000",
							9,
							0.5,
						),
					],
				})
				.mockResolvedValueOnce({ value: [] }),
			getParsedProgramAccounts: vi.fn(),
		};
		connection.getParsedProgramAccounts = vi
			.fn()
			.mockResolvedValueOnce([
				makeParsedStakeAccount(stakeAccountOne, owner, "1000000000"),
			])
			.mockResolvedValueOnce([
				makeParsedStakeAccount(stakeAccountOne, owner, "1000000000"),
				makeParsedStakeAccount(stakeAccountTwo, owner, "250000000"),
			]);
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getReadTool("solana_getDefiPositions");
		const result = await tool.execute("defi-positions-1", {
			address: owner,
			network: "mainnet-beta",
		});

		expect(connection.getParsedProgramAccounts).toHaveBeenCalledTimes(2);
		expect(result.details).toMatchObject({
			address: owner,
			defiTokenPositionCount: 2,
			stakeAccountCount: 2,
			totalDelegatedStakeLamports: "1250000000",
			totalDelegatedStakeUiAmount: "1.25",
			categoryExposureCounts: {
				"liquid-staking": 1,
				stablecoin: 1,
			},
			protocolExposureCounts: {
				marinade: 1,
				stablecoin: 1,
			},
		});
	});

	it("can skip stake account discovery", async () => {
		const owner = Keypair.generate().publicKey.toBase58();
		const connection = {
			getBalance: vi.fn().mockResolvedValue(1_000_000_000),
			getParsedTokenAccountsByOwner: vi
				.fn()
				.mockResolvedValueOnce({
					value: [makeParsedTokenAccount(owner, USDC_MINT, "1000000", 6, 1)],
				})
				.mockResolvedValueOnce({ value: [] }),
			getParsedProgramAccounts: vi.fn(),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getReadTool("solana_getDefiPositions");
		const result = await tool.execute("defi-positions-2", {
			address: owner,
			includeStakeAccounts: false,
			network: "mainnet-beta",
		});

		expect(connection.getParsedProgramAccounts).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			defiTokenPositionCount: 1,
			stakeAccountCount: 0,
			totalDelegatedStakeLamports: "0",
			totalDelegatedStakeUiAmount: "0",
		});
	});
});

describe("protocol-scoped Jupiter quote tools", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		runtimeMocks.parseJupiterSwapMode.mockReturnValue("ExactIn");
		runtimeMocks.parsePositiveBigInt.mockImplementation((value: string) =>
			BigInt(value),
		);
	});

	it("uses Orca default dex filters for solana_getOrcaQuote", async () => {
		const inputMint = Keypair.generate().publicKey.toBase58();
		const outputMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "999",
			routePlan: [{ route: "orca" }],
		});

		const tool = getReadTool("solana_getOrcaQuote");
		const result = await tool.execute("orca-quote-1", {
			inputMint,
			outputMint,
			amountRaw: "1000000",
			network: "mainnet-beta",
		});

		expect(runtimeMocks.assertJupiterNetworkSupported).toHaveBeenCalledWith(
			"mainnet-beta",
		);
		expect(runtimeMocks.getJupiterQuote).toHaveBeenCalledWith(
			expect.objectContaining({
				dexes: ["Orca V2", "Orca Whirlpool"],
			}),
		);
		expect(result.details).toMatchObject({
			protocol: "orca",
			inputMint,
			outputMint,
			amountRaw: "1000000",
			outAmount: "999",
			routeCount: 1,
		});
	});

	it("supports dex overrides for solana_getMeteoraQuote", async () => {
		const inputMint = Keypair.generate().publicKey.toBase58();
		const outputMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "888",
			routePlan: [{ route: "meteora" }],
		});

		const tool = getReadTool("solana_getMeteoraQuote");
		const result = await tool.execute("meteora-quote-1", {
			inputMint,
			outputMint,
			amountRaw: "2000000",
			dexes: ["Meteora DLMM", "Meteora DAMM v2"],
			network: "mainnet-beta",
		});

		expect(runtimeMocks.getJupiterQuote).toHaveBeenCalledWith(
			expect.objectContaining({
				dexes: ["Meteora DLMM", "Meteora DAMM v2"],
			}),
		);
		expect(result.details).toMatchObject({
			protocol: "meteora",
			inputMint,
			outputMint,
			amountRaw: "2000000",
			outAmount: "888",
			routeCount: 1,
		});
	});
});
