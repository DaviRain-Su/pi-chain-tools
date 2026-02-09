import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	assertJupiterNetworkSupported: vi.fn(),
	assertRaydiumNetworkSupported: vi.fn(),
	buildJupiterSwapInstructions: vi.fn(),
	buildJupiterSwapTransaction: vi.fn(),
	buildRaydiumSwapTransactions: vi.fn(),
	getConnection: vi.fn(),
	getExplorerAddressUrl: vi.fn(),
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
	parseJupiterPriorityLevel: vi.fn(() => "veryHigh"),
	parseJupiterSwapMode: vi.fn(() => "ExactIn"),
	parseNetwork: vi.fn(() => "devnet"),
	parsePositiveBigInt: vi.fn((value: string) => BigInt(value)),
	parseRaydiumSwapType: vi.fn(() => "BaseIn"),
	parseRaydiumTxVersion: vi.fn(() => "V0"),
	parseSplTokenProgram: vi.fn(() => "token"),
	raydiumSwapTypeSchema: vi.fn(),
	raydiumTxVersionSchema: vi.fn(),
	solanaNetworkSchema: vi.fn(),
	splTokenProgramSchema: vi.fn(),
	toLamports: vi.fn((value: number) => Math.round(value * 1_000_000_000)),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		assertJupiterNetworkSupported: runtimeMocks.assertJupiterNetworkSupported,
		assertRaydiumNetworkSupported: runtimeMocks.assertRaydiumNetworkSupported,
		buildJupiterSwapInstructions: runtimeMocks.buildJupiterSwapInstructions,
		buildJupiterSwapTransaction: runtimeMocks.buildJupiterSwapTransaction,
		buildRaydiumSwapTransactions: runtimeMocks.buildRaydiumSwapTransactions,
		getConnection: runtimeMocks.getConnection,
		getExplorerAddressUrl: runtimeMocks.getExplorerAddressUrl,
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
		parseJupiterPriorityLevel: runtimeMocks.parseJupiterPriorityLevel,
		parseJupiterSwapMode: runtimeMocks.parseJupiterSwapMode,
		parseNetwork: runtimeMocks.parseNetwork,
		parsePositiveBigInt: runtimeMocks.parsePositiveBigInt,
		parseRaydiumSwapType: runtimeMocks.parseRaydiumSwapType,
		parseRaydiumTxVersion: runtimeMocks.parseRaydiumTxVersion,
		parseSplTokenProgram: runtimeMocks.parseSplTokenProgram,
		raydiumSwapTypeSchema: runtimeMocks.raydiumSwapTypeSchema,
		raydiumTxVersionSchema: runtimeMocks.raydiumTxVersionSchema,
		solanaNetworkSchema: runtimeMocks.solanaNetworkSchema,
		splTokenProgramSchema: runtimeMocks.splTokenProgramSchema,
		toLamports: runtimeMocks.toLamports,
	};
});

import { createSolanaComposeTools } from "./compose.js";

type ComposeTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ details?: unknown }>;
};

function getTool(name: string): ComposeTool {
	const tool = createSolanaComposeTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ComposeTool;
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.parseNetwork.mockReturnValue("devnet");
	runtimeMocks.parseJupiterSwapMode.mockReturnValue("ExactIn");
	runtimeMocks.parseJupiterPriorityLevel.mockReturnValue("veryHigh");
	runtimeMocks.parseRaydiumTxVersion.mockReturnValue("V0");
	runtimeMocks.parseRaydiumSwapType.mockReturnValue("BaseIn");
	runtimeMocks.parseSplTokenProgram.mockReturnValue("token");
	runtimeMocks.getSplTokenProgramId.mockReturnValue(
		new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
	);
	runtimeMocks.getExplorerAddressUrl.mockImplementation(
		(value: string) => `https://explorer/${value}`,
	);
});

describe("compose tools", () => {
	it("builds legacy SOL transfer with fee and lamports info", async () => {
		const fromAddress = Keypair.generate().publicKey.toBase58();
		const toAddress = Keypair.generate().publicKey.toBase58();
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 11,
			}),
			getFeeForMessage: vi.fn().mockResolvedValue({ value: 5000 }),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);
		runtimeMocks.toLamports.mockReturnValue(12345);

		const tool = getTool("solana_buildSolTransferTransaction");
		const result = await tool.execute("compose-sol", {
			fromAddress,
			toAddress,
			amountSol: 0.000012345,
			network: "devnet",
		});

		expect(runtimeMocks.toLamports).toHaveBeenCalledWith(0.000012345);
		expect(result.details).toMatchObject({
			fromAddress,
			toAddress,
			lamports: 12345,
			feeLamports: 5000,
			network: "devnet",
		});
	});

	it("fails SPL compose when destination token account is missing and auto-create is disabled", async () => {
		const fromAddress = Keypair.generate().publicKey.toBase58();
		const toAddress = Keypair.generate().publicKey.toBase58();
		const tokenMint = Keypair.generate().publicKey.toBase58();
		const connection = {
			getAccountInfo: vi
				.fn()
				.mockResolvedValueOnce({ owner: new PublicKey(fromAddress) })
				.mockResolvedValueOnce(null),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_buildSplTokenTransferTransaction");
		await expect(
			tool.execute("compose-spl-fail", {
				fromAddress,
				toAddress,
				tokenMint,
				amountRaw: "1000",
				createDestinationAtaIfMissing: false,
				network: "devnet",
			}),
		).rejects.toThrow("Destination token account not found");
	});

	it("builds v0 SPL transfer and includes ATA create flag", async () => {
		const fromAddress = Keypair.generate().publicKey.toBase58();
		const toAddress = Keypair.generate().publicKey.toBase58();
		const tokenMint = Keypair.generate().publicKey.toBase58();
		const connection = {
			getAccountInfo: vi
				.fn()
				.mockResolvedValueOnce({ owner: new PublicKey(fromAddress) })
				.mockResolvedValueOnce(null),
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 12,
			}),
			getFeeForMessage: vi.fn().mockResolvedValue({ value: 7000 }),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_buildSplTokenTransferV0Transaction");
		const result = await tool.execute("compose-spl-v0", {
			fromAddress,
			toAddress,
			tokenMint,
			amountRaw: "1000",
			network: "devnet",
		});

		expect(connection.getAccountInfo).toHaveBeenCalledTimes(2);
		expect(result.details).toMatchObject({
			version: "v0",
			tokenMint,
			amountRaw: "1000",
			destinationAtaCreateIncluded: true,
			feeLamports: 7000,
		});
	});

	it("builds Raydium swap transactions and resolves compute fee from auto-fee endpoint", async () => {
		const userPublicKey = Keypair.generate().publicKey.toBase58();
		const inputMint = Keypair.generate().publicKey.toBase58();
		const outputMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		runtimeMocks.getRaydiumQuote.mockResolvedValue({
			data: { outputAmount: "2" },
		});
		runtimeMocks.getRaydiumPriorityFee.mockResolvedValue({
			data: { default: { vh: "7000" } },
		});
		runtimeMocks.getRaydiumPriorityFeeMicroLamports.mockReturnValue("7000");
		runtimeMocks.buildRaydiumSwapTransactions.mockResolvedValue({
			data: [
				{ transaction: Buffer.from("ray-tx-1").toString("base64") },
				{ transaction: Buffer.from("ray-tx-2").toString("base64") },
			],
		});

		const tool = getTool("solana_buildRaydiumSwapTransaction");
		const result = await tool.execute("compose-ray-ok", {
			userPublicKey,
			inputMint,
			outputMint,
			amountRaw: "1000",
			slippageBps: 50,
			network: "mainnet-beta",
		});

		expect(runtimeMocks.getRaydiumPriorityFee).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			userPublicKey,
			txCount: 2,
			computeUnitPriceMicroLamports: "7000",
			network: "mainnet-beta",
		});
	});

	it("fails Raydium compose when auto-fee endpoint cannot provide compute unit price", async () => {
		const tool = getTool("solana_buildRaydiumSwapTransaction");
		runtimeMocks.getRaydiumQuote.mockResolvedValue({
			data: { outputAmount: "2" },
		});
		runtimeMocks.getRaydiumPriorityFee.mockResolvedValue({
			data: { default: {} },
		});
		runtimeMocks.getRaydiumPriorityFeeMicroLamports.mockReturnValue(
			undefined as unknown as string,
		);

		await expect(
			tool.execute("compose-ray-fail", {
				userPublicKey: Keypair.generate().publicKey.toBase58(),
				inputMint: Keypair.generate().publicKey.toBase58(),
				outputMint: Keypair.generate().publicKey.toBase58(),
				amountRaw: "1000",
				slippageBps: 50,
				network: "mainnet-beta",
			}),
		).rejects.toThrow(
			"Unable to resolve Raydium computeUnitPriceMicroLamports",
		);
	});

	it("builds Orca-scoped swap transaction with default dex filters", async () => {
		const userPublicKey = Keypair.generate().publicKey.toBase58();
		const inputMint = Keypair.generate().publicKey.toBase58();
		const outputMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "123",
			routePlan: [{ route: "orca" }],
		});
		runtimeMocks.buildJupiterSwapTransaction.mockResolvedValue({
			swapTransaction: Buffer.from("orca-swap").toString("base64"),
		});

		const tool = getTool("solana_buildOrcaSwapTransaction");
		const result = await tool.execute("compose-orca", {
			userPublicKey,
			inputMint,
			outputMint,
			amountRaw: "1000000",
			network: "mainnet-beta",
		});

		expect(runtimeMocks.getJupiterQuote).toHaveBeenCalledWith(
			expect.objectContaining({
				dexes: ["Orca V2", "Orca Whirlpool"],
			}),
		);
		expect(result.details).toMatchObject({
			protocol: "orca",
			dexes: ["Orca V2", "Orca Whirlpool"],
			userPublicKey,
			inputMint,
			outputMint,
		});
	});

	it("builds Meteora-scoped swap transaction with dex override", async () => {
		const userPublicKey = Keypair.generate().publicKey.toBase58();
		const inputMint = Keypair.generate().publicKey.toBase58();
		const outputMint = Keypair.generate().publicKey.toBase58();
		const dexes = ["Meteora DLMM", "Meteora DAMM v2"];
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "456",
			routePlan: [{ route: "meteora" }],
		});
		runtimeMocks.buildJupiterSwapTransaction.mockResolvedValue({
			swapTransaction: Buffer.from("meteora-swap").toString("base64"),
		});

		const tool = getTool("solana_buildMeteoraSwapTransaction");
		const result = await tool.execute("compose-meteora", {
			userPublicKey,
			inputMint,
			outputMint,
			amountRaw: "2000000",
			dexes,
			network: "mainnet-beta",
		});

		expect(runtimeMocks.getJupiterQuote).toHaveBeenCalledWith(
			expect.objectContaining({
				dexes,
			}),
		);
		expect(result.details).toMatchObject({
			protocol: "meteora",
			dexes,
			userPublicKey,
			inputMint,
			outputMint,
		});
	});

	it("fails clearly when Orca route is unavailable", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "0",
			routePlan: [],
		});

		const tool = getTool("solana_buildOrcaSwapTransaction");
		await expect(
			tool.execute("compose-orca-no-route", {
				userPublicKey: Keypair.generate().publicKey.toBase58(),
				inputMint: Keypair.generate().publicKey.toBase58(),
				outputMint: Keypair.generate().publicKey.toBase58(),
				amountRaw: "1000000",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("No Orca route found");
	});
});
