import {
	Keypair,
	PublicKey,
	StakeProgram,
	TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	assertJupiterNetworkSupported: vi.fn(),
	assertRaydiumNetworkSupported: vi.fn(),
	buildKaminoBorrowInstructions: vi.fn(),
	buildKaminoDepositAndBorrowInstructions: vi.fn(),
	buildKaminoDepositInstructions: vi.fn(),
	buildKaminoRepayAndWithdrawInstructions: vi.fn(),
	buildKaminoRepayInstructions: vi.fn(),
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
	getJupiterApiBaseUrl: vi.fn(() => "https://lite-api.jup.ag"),
	getJupiterQuote: vi.fn(),
	getRaydiumApiBaseUrl: vi.fn(() => "https://raydium.api"),
	getRaydiumPriorityFee: vi.fn(),
	getRaydiumPriorityFeeMicroLamports: vi.fn(() => "1000"),
	getRaydiumQuote: vi.fn(),
	jupiterPriorityLevelSchema: vi.fn(),
	jupiterSwapModeSchema: vi.fn(),
	parseJupiterPriorityLevel: vi.fn(() => "veryHigh"),
	parseJupiterSwapMode: vi.fn(() => "ExactIn"),
	parseRaydiumSwapType: vi.fn(() => "BaseIn"),
	parseRaydiumTxVersion: vi.fn(() => "V0"),
	raydiumSwapTypeSchema: vi.fn(),
	raydiumTxVersionSchema: vi.fn(),
	getConnection: vi.fn(),
	getExplorerAddressUrl: vi.fn(),
	getExplorerTransactionUrl: vi.fn(),
	normalizeAtPath: vi.fn((value: string) => value),
	parseFinality: vi.fn(() => "confirmed"),
	parseNetwork: vi.fn(() => "devnet"),
	parseTransactionFromBase64: vi.fn(),
	parseSplTokenProgram: vi.fn(() => "token"),
	resolveSecretKey: vi.fn(),
	splTokenProgramSchema: vi.fn(),
	solanaNetworkSchema: vi.fn(),
	commitmentSchema: vi.fn(),
	stringifyUnknown: vi.fn((value: unknown) => String(value)),
	toLamports: vi.fn((value: number) => Math.round(value * 1_000_000_000)),
	getSplTokenProgramId: vi.fn(),
	parsePositiveBigInt: vi.fn((value: string) => BigInt(value)),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
		assertJupiterNetworkSupported: runtimeMocks.assertJupiterNetworkSupported,
		assertRaydiumNetworkSupported: runtimeMocks.assertRaydiumNetworkSupported,
		buildKaminoBorrowInstructions: runtimeMocks.buildKaminoBorrowInstructions,
		buildKaminoDepositAndBorrowInstructions:
			runtimeMocks.buildKaminoDepositAndBorrowInstructions,
		buildKaminoDepositInstructions: runtimeMocks.buildKaminoDepositInstructions,
		buildKaminoRepayAndWithdrawInstructions:
			runtimeMocks.buildKaminoRepayAndWithdrawInstructions,
		buildKaminoRepayInstructions: runtimeMocks.buildKaminoRepayInstructions,
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
		getJupiterApiBaseUrl: runtimeMocks.getJupiterApiBaseUrl,
		getJupiterQuote: runtimeMocks.getJupiterQuote,
		getRaydiumApiBaseUrl: runtimeMocks.getRaydiumApiBaseUrl,
		getRaydiumPriorityFee: runtimeMocks.getRaydiumPriorityFee,
		getRaydiumPriorityFeeMicroLamports:
			runtimeMocks.getRaydiumPriorityFeeMicroLamports,
		getRaydiumQuote: runtimeMocks.getRaydiumQuote,
		jupiterPriorityLevelSchema: runtimeMocks.jupiterPriorityLevelSchema,
		jupiterSwapModeSchema: runtimeMocks.jupiterSwapModeSchema,
		parseJupiterPriorityLevel: runtimeMocks.parseJupiterPriorityLevel,
		parseJupiterSwapMode: runtimeMocks.parseJupiterSwapMode,
		parseRaydiumSwapType: runtimeMocks.parseRaydiumSwapType,
		parseRaydiumTxVersion: runtimeMocks.parseRaydiumTxVersion,
		raydiumSwapTypeSchema: runtimeMocks.raydiumSwapTypeSchema,
		raydiumTxVersionSchema: runtimeMocks.raydiumTxVersionSchema,
		getConnection: runtimeMocks.getConnection,
		getExplorerAddressUrl: runtimeMocks.getExplorerAddressUrl,
		getExplorerTransactionUrl: runtimeMocks.getExplorerTransactionUrl,
		normalizeAtPath: runtimeMocks.normalizeAtPath,
		parseFinality: runtimeMocks.parseFinality,
		parseNetwork: runtimeMocks.parseNetwork,
		parseTransactionFromBase64: runtimeMocks.parseTransactionFromBase64,
		parseSplTokenProgram: runtimeMocks.parseSplTokenProgram,
		resolveSecretKey: runtimeMocks.resolveSecretKey,
		splTokenProgramSchema: runtimeMocks.splTokenProgramSchema,
		solanaNetworkSchema: runtimeMocks.solanaNetworkSchema,
		commitmentSchema: runtimeMocks.commitmentSchema,
		stringifyUnknown: runtimeMocks.stringifyUnknown,
		toLamports: runtimeMocks.toLamports,
		getSplTokenProgramId: runtimeMocks.getSplTokenProgramId,
		parsePositiveBigInt: runtimeMocks.parsePositiveBigInt,
	};
});

import { createSolanaExecuteTools } from "./execute.js";

type ExecuteTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ details?: unknown }>;
};

function getTool(name: string): ExecuteTool {
	const tool = createSolanaExecuteTools().find((item) => item.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ExecuteTool;
}

function createLegacyTx(serialized: string) {
	const partialSign = vi.fn();
	const serialize = vi.fn(() => Buffer.from(serialized));
	return {
		tx: {
			partialSign,
			serialize,
		},
		partialSign,
		serialize,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.getExplorerAddressUrl.mockReturnValue(
		"https://explorer.solana.com/address/mock?cluster=devnet",
	);
	runtimeMocks.getExplorerTransactionUrl.mockReturnValue(
		"https://explorer.solana.com/tx/mock?cluster=devnet",
	);
	runtimeMocks.parseNetwork.mockReturnValue("devnet");
	runtimeMocks.parseFinality.mockReturnValue("confirmed");
	runtimeMocks.parseJupiterSwapMode.mockReturnValue("ExactIn");
	runtimeMocks.parseJupiterPriorityLevel.mockReturnValue("veryHigh");
	runtimeMocks.parseRaydiumTxVersion.mockReturnValue("V0");
	runtimeMocks.parseRaydiumSwapType.mockReturnValue("BaseIn");
	runtimeMocks.parseSplTokenProgram.mockReturnValue("token");
	runtimeMocks.getSplTokenProgramId.mockReturnValue(
		new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
	);
});

describe("solana_signAndSendTransaction", () => {
	it("blocks mainnet send unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_signAndSendTransaction");

		await expect(
			tool.execute("t1", {
				txBase64: Buffer.from("tx").toString("base64"),
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
	});

	it("signs and sends a legacy transaction via partialSign path", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);

		const legacy = createLegacyTx("legacy-signed");
		runtimeMocks.parseTransactionFromBase64.mockReturnValue(legacy.tx);

		const sendRawTransaction = vi.fn().mockResolvedValue("legacy-signature");
		const confirmTransaction = vi
			.fn()
			.mockResolvedValue({ value: { err: null } });
		runtimeMocks.getConnection.mockReturnValue({
			sendRawTransaction,
			confirmTransaction,
		});

		const tool = getTool("solana_signAndSendTransaction");
		const result = await tool.execute("t2", {
			txBase64: Buffer.from("tx").toString("base64"),
			network: "devnet",
		});

		expect(legacy.partialSign).toHaveBeenCalledTimes(1);
		expect(sendRawTransaction).toHaveBeenCalledWith(
			Buffer.from("legacy-signed"),
			{
				skipPreflight: false,
				maxRetries: undefined,
			},
		);
		expect(confirmTransaction).toHaveBeenCalledWith(
			"legacy-signature",
			"confirmed",
		);
		expect(result.details).toMatchObject({
			signature: "legacy-signature",
			version: "legacy",
			network: "devnet",
			confirmed: true,
		});
	});

	it("signs and sends a v0 transaction via VersionedTransaction path", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);

		const v0 = new VersionedTransaction(
			new TransactionMessage({
				payerKey: signer.publicKey,
				recentBlockhash: "11111111111111111111111111111111",
				instructions: [],
			}).compileToV0Message(),
		);
		const signSpy = vi.spyOn(v0, "sign");
		vi.spyOn(v0, "serialize").mockReturnValue(Buffer.from("v0-signed"));
		runtimeMocks.parseTransactionFromBase64.mockReturnValue(v0);

		const sendRawTransaction = vi.fn().mockResolvedValue("v0-signature");
		const confirmTransaction = vi
			.fn()
			.mockResolvedValue({ value: { err: null } });
		runtimeMocks.getConnection.mockReturnValue({
			sendRawTransaction,
			confirmTransaction,
		});

		const tool = getTool("solana_signAndSendTransaction");
		const result = await tool.execute("t3", {
			txBase64: Buffer.from("tx").toString("base64"),
			network: "devnet",
		});

		expect(signSpy).toHaveBeenCalledTimes(1);
		expect(sendRawTransaction).toHaveBeenCalledWith(Buffer.from("v0-signed"), {
			skipPreflight: false,
			maxRetries: undefined,
		});
		expect(result.details).toMatchObject({
			signature: "v0-signature",
			version: "v0",
			network: "devnet",
			confirmed: true,
		});
	});

	it("simulates a signed v0 transaction without broadcasting", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);

		const v0 = new VersionedTransaction(
			new TransactionMessage({
				payerKey: signer.publicKey,
				recentBlockhash: "11111111111111111111111111111111",
				instructions: [],
			}).compileToV0Message(),
		);
		runtimeMocks.parseTransactionFromBase64.mockReturnValue(v0);

		const sendRawTransaction = vi.fn();
		const simulateTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
				logs: ["ok"],
				unitsConsumed: 88,
			},
		});
		runtimeMocks.getConnection.mockReturnValue({
			sendRawTransaction,
			simulateTransaction,
		});

		const tool = getTool("solana_signAndSendTransaction");
		const result = await tool.execute("t4", {
			txBase64: Buffer.from("tx").toString("base64"),
			network: "devnet",
			simulate: true,
		});

		expect(sendRawTransaction).not.toHaveBeenCalled();
		expect(simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			ok: true,
			version: "v0",
			network: "devnet",
		});
	});

	it("skips confirmation when confirm=false", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);

		const legacy = createLegacyTx("legacy-unconfirmed");
		runtimeMocks.parseTransactionFromBase64.mockReturnValue(legacy.tx);

		const sendRawTransaction = vi.fn().mockResolvedValue("legacy-signature");
		const confirmTransaction = vi.fn();
		runtimeMocks.getConnection.mockReturnValue({
			sendRawTransaction,
			confirmTransaction,
		});

		const tool = getTool("solana_signAndSendTransaction");
		const result = await tool.execute("t5", {
			txBase64: Buffer.from("tx").toString("base64"),
			network: "devnet",
			confirm: false,
		});

		expect(confirmTransaction).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			signature: "legacy-signature",
			confirmed: false,
		});
	});

	it("throws on confirmation error", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);

		const legacy = createLegacyTx("legacy-error");
		runtimeMocks.parseTransactionFromBase64.mockReturnValue(legacy.tx);

		const sendRawTransaction = vi.fn().mockResolvedValue("legacy-signature");
		const confirmTransaction = vi.fn().mockResolvedValue({
			value: {
				err: { InstructionError: [0, "Custom"] },
			},
		});
		runtimeMocks.getConnection.mockReturnValue({
			sendRawTransaction,
			confirmTransaction,
		});

		const tool = getTool("solana_signAndSendTransaction");
		await expect(
			tool.execute("t6", {
				txBase64: Buffer.from("tx").toString("base64"),
				network: "devnet",
			}),
		).rejects.toThrow("Transaction confirmed with error:");
	});
});

describe("solana_kaminoDeposit", () => {
	it("blocks mainnet Kamino deposit unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_kaminoDeposit");

		await expect(
			tool.execute("kamino-mainnet-block", {
				reserveMint: Keypair.generate().publicKey.toBase58(),
				amountRaw: "1000",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(runtimeMocks.buildKaminoDepositInstructions).not.toHaveBeenCalled();
	});

	it("simulates Kamino deposit without broadcasting", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const reserveMint = Keypair.generate().publicKey.toBase58();
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const programId = Keypair.generate().publicKey.toBase58();
		const reserveAddress = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([7]),
		});
		runtimeMocks.buildKaminoDepositInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId,
			reserveMint,
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
		const sendRawTransaction = vi.fn();
		const simulateTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
				logs: ["ok"],
				unitsConsumed: 123,
			},
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 9,
			}),
			sendRawTransaction,
			simulateTransaction,
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_kaminoDeposit");
		const result = await tool.execute("kamino-sim", {
			fromSecretKey: "mock",
			reserveMint,
			amountRaw: "1000",
			network: "devnet",
			simulate: true,
		});

		expect(sendRawTransaction).not.toHaveBeenCalled();
		expect(simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			reserveMint,
			obligationAddress,
		});
	});

	it("sends Kamino deposit transaction and confirms by default", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const reserveMint = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([9]),
		});
		runtimeMocks.buildKaminoDepositInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress: Keypair.generate().publicKey.toBase58(),
			programId: Keypair.generate().publicKey.toBase58(),
			reserveMint,
			reserveAddress: Keypair.generate().publicKey.toBase58(),
			reserveSymbol: "USDC",
			amountRaw: "1000",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			obligationAddress: Keypair.generate().publicKey.toBase58(),
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["deposit"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const sendRawTransaction = vi.fn().mockResolvedValue("kamino-sig");
		const confirmTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
			},
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 10,
			}),
			sendRawTransaction,
			confirmTransaction,
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_kaminoDeposit");
		const result = await tool.execute("kamino-exec", {
			fromSecretKey: "mock",
			reserveMint,
			amountRaw: "1000",
			network: "devnet",
		});

		expect(sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(confirmTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: false,
			signature: "kamino-sig",
			confirmed: true,
		});
	});
});

describe("solana_kaminoWithdraw", () => {
	it("blocks mainnet Kamino withdraw unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_kaminoWithdraw");

		await expect(
			tool.execute("kamino-withdraw-mainnet-block", {
				reserveMint: Keypair.generate().publicKey.toBase58(),
				amountRaw: "1000",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(runtimeMocks.buildKaminoWithdrawInstructions).not.toHaveBeenCalled();
	});

	it("simulates Kamino withdraw without broadcasting", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const reserveMint = Keypair.generate().publicKey.toBase58();
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const programId = Keypair.generate().publicKey.toBase58();
		const reserveAddress = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([8]),
		});
		runtimeMocks.buildKaminoWithdrawInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId,
			reserveMint,
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
		const sendRawTransaction = vi.fn();
		const simulateTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
				logs: ["ok"],
				unitsConsumed: 124,
			},
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 9,
			}),
			sendRawTransaction,
			simulateTransaction,
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_kaminoWithdraw");
		const result = await tool.execute("kamino-withdraw-sim", {
			fromSecretKey: "mock",
			reserveMint,
			amountRaw: "1000",
			network: "devnet",
			simulate: true,
		});

		expect(sendRawTransaction).not.toHaveBeenCalled();
		expect(simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			reserveMint,
			obligationAddress,
		});
	});

	it("sends Kamino withdraw transaction and confirms by default", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const reserveMint = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([10]),
		});
		runtimeMocks.buildKaminoWithdrawInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress: Keypair.generate().publicKey.toBase58(),
			programId: Keypair.generate().publicKey.toBase58(),
			reserveMint,
			reserveAddress: Keypair.generate().publicKey.toBase58(),
			reserveSymbol: "USDC",
			amountRaw: "1000",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			obligationAddress: Keypair.generate().publicKey.toBase58(),
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["withdraw"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const sendRawTransaction = vi.fn().mockResolvedValue("kamino-withdraw-sig");
		const confirmTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
			},
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 10,
			}),
			sendRawTransaction,
			confirmTransaction,
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_kaminoWithdraw");
		const result = await tool.execute("kamino-withdraw-exec", {
			fromSecretKey: "mock",
			reserveMint,
			amountRaw: "1000",
			network: "devnet",
		});

		expect(sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(confirmTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: false,
			signature: "kamino-withdraw-sig",
			confirmed: true,
		});
	});
});

describe("solana_kaminoBorrow", () => {
	it("blocks mainnet Kamino borrow unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_kaminoBorrow");

		await expect(
			tool.execute("kamino-borrow-mainnet-block", {
				reserveMint: Keypair.generate().publicKey.toBase58(),
				amountRaw: "1000",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(runtimeMocks.buildKaminoBorrowInstructions).not.toHaveBeenCalled();
	});

	it("simulates Kamino borrow without broadcasting", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const reserveMint = Keypair.generate().publicKey.toBase58();
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const programId = Keypair.generate().publicKey.toBase58();
		const reserveAddress = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([21]),
		});
		runtimeMocks.buildKaminoBorrowInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId,
			reserveMint,
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
		const sendRawTransaction = vi.fn();
		const simulateTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
				logs: ["ok"],
				unitsConsumed: 125,
			},
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 9,
			}),
			sendRawTransaction,
			simulateTransaction,
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_kaminoBorrow");
		const result = await tool.execute("kamino-borrow-sim", {
			fromSecretKey: "mock",
			reserveMint,
			amountRaw: "1000",
			network: "devnet",
			simulate: true,
		});

		expect(sendRawTransaction).not.toHaveBeenCalled();
		expect(simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			reserveMint,
			obligationAddress,
		});
	});

	it("sends Kamino borrow transaction and confirms by default", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const reserveMint = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([22]),
		});
		runtimeMocks.buildKaminoBorrowInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress: Keypair.generate().publicKey.toBase58(),
			programId: Keypair.generate().publicKey.toBase58(),
			reserveMint,
			reserveAddress: Keypair.generate().publicKey.toBase58(),
			reserveSymbol: "USDC",
			amountRaw: "1000",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			obligationAddress: Keypair.generate().publicKey.toBase58(),
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["borrow"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const sendRawTransaction = vi.fn().mockResolvedValue("kamino-borrow-sig");
		const confirmTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
			},
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 10,
			}),
			sendRawTransaction,
			confirmTransaction,
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_kaminoBorrow");
		const result = await tool.execute("kamino-borrow-exec", {
			fromSecretKey: "mock",
			reserveMint,
			amountRaw: "1000",
			network: "devnet",
		});

		expect(sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(confirmTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: false,
			signature: "kamino-borrow-sig",
			confirmed: true,
		});
	});
});

describe("solana_kaminoRepay", () => {
	it("blocks mainnet Kamino repay unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_kaminoRepay");

		await expect(
			tool.execute("kamino-repay-mainnet-block", {
				reserveMint: Keypair.generate().publicKey.toBase58(),
				amountRaw: "1000",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(runtimeMocks.buildKaminoRepayInstructions).not.toHaveBeenCalled();
	});

	it("simulates Kamino repay without broadcasting", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const reserveMint = Keypair.generate().publicKey.toBase58();
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const programId = Keypair.generate().publicKey.toBase58();
		const reserveAddress = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([23]),
		});
		runtimeMocks.buildKaminoRepayInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId,
			reserveMint,
			reserveAddress,
			reserveSymbol: "USDC",
			amountRaw: "1000",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			currentSlot: "555",
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
		const sendRawTransaction = vi.fn();
		const simulateTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
				logs: ["ok"],
				unitsConsumed: 126,
			},
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 9,
			}),
			sendRawTransaction,
			simulateTransaction,
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_kaminoRepay");
		const result = await tool.execute("kamino-repay-sim", {
			fromSecretKey: "mock",
			reserveMint,
			amountRaw: "1000",
			currentSlot: "555",
			network: "devnet",
			simulate: true,
		});

		expect(sendRawTransaction).not.toHaveBeenCalled();
		expect(simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			reserveMint,
			currentSlot: "555",
			obligationAddress,
		});
	});

	it("sends Kamino repay transaction and confirms by default", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const reserveMint = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([24]),
		});
		runtimeMocks.buildKaminoRepayInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress: Keypair.generate().publicKey.toBase58(),
			programId: Keypair.generate().publicKey.toBase58(),
			reserveMint,
			reserveAddress: Keypair.generate().publicKey.toBase58(),
			reserveSymbol: "USDC",
			amountRaw: "1000",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			currentSlot: "777",
			obligationAddress: Keypair.generate().publicKey.toBase58(),
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["repay"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const sendRawTransaction = vi.fn().mockResolvedValue("kamino-repay-sig");
		const confirmTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
			},
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 10,
			}),
			sendRawTransaction,
			confirmTransaction,
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_kaminoRepay");
		const result = await tool.execute("kamino-repay-exec", {
			fromSecretKey: "mock",
			reserveMint,
			amountRaw: "1000",
			currentSlot: "777",
			network: "devnet",
		});

		expect(sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(confirmTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: false,
			signature: "kamino-repay-sig",
			confirmed: true,
			currentSlot: "777",
		});
	});
});

describe("solana_kaminoDepositAndBorrow", () => {
	it("blocks mainnet Kamino deposit+borrow unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_kaminoDepositAndBorrow");

		await expect(
			tool.execute("kamino-deposit-borrow-mainnet-block", {
				depositReserveMint: Keypair.generate().publicKey.toBase58(),
				depositAmountRaw: "1000",
				borrowReserveMint: Keypair.generate().publicKey.toBase58(),
				borrowAmountRaw: "10",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(
			runtimeMocks.buildKaminoDepositAndBorrowInstructions,
		).not.toHaveBeenCalled();
	});

	it("simulates Kamino deposit+borrow without broadcasting", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const depositReserveMint = Keypair.generate().publicKey.toBase58();
		const borrowReserveMint = Keypair.generate().publicKey.toBase58();
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const programId = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([41]),
		});
		runtimeMocks.buildKaminoDepositAndBorrowInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId,
			depositReserveMint,
			depositReserveAddress: Keypair.generate().publicKey.toBase58(),
			depositReserveSymbol: "USDC",
			depositAmountRaw: "1000",
			borrowReserveMint,
			borrowReserveAddress: Keypair.generate().publicKey.toBase58(),
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
		const sendRawTransaction = vi.fn();
		const simulateTransaction = vi.fn().mockResolvedValue({
			value: { err: null, logs: ["ok"], unitsConsumed: 130 },
		});
		runtimeMocks.getConnection.mockReturnValue({
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 9,
			}),
			sendRawTransaction,
			simulateTransaction,
		});

		const tool = getTool("solana_kaminoDepositAndBorrow");
		const result = await tool.execute("kamino-deposit-borrow-sim", {
			fromSecretKey: "mock",
			depositReserveMint,
			depositAmountRaw: "1000",
			borrowReserveMint,
			borrowAmountRaw: "10",
			network: "devnet",
			simulate: true,
		});

		expect(sendRawTransaction).not.toHaveBeenCalled();
		expect(simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			ownerAddress: signer.publicKey.toBase58(),
			depositReserveMint,
			borrowReserveMint,
			obligationAddress,
		});
	});

	it("sends Kamino deposit+borrow transaction and confirms by default", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const depositReserveMint = Keypair.generate().publicKey.toBase58();
		const borrowReserveMint = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([42]),
		});
		runtimeMocks.buildKaminoDepositAndBorrowInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress: Keypair.generate().publicKey.toBase58(),
			programId: Keypair.generate().publicKey.toBase58(),
			depositReserveMint,
			depositReserveAddress: Keypair.generate().publicKey.toBase58(),
			depositReserveSymbol: "USDC",
			depositAmountRaw: "1000",
			borrowReserveMint,
			borrowReserveAddress: Keypair.generate().publicKey.toBase58(),
			borrowReserveSymbol: "SOL",
			borrowAmountRaw: "10",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			obligationAddress: Keypair.generate().publicKey.toBase58(),
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["depositAndBorrow"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const sendRawTransaction = vi
			.fn()
			.mockResolvedValue("kamino-deposit-borrow-sig");
		const confirmTransaction = vi.fn().mockResolvedValue({
			value: { err: null },
		});
		runtimeMocks.getConnection.mockReturnValue({
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 10,
			}),
			sendRawTransaction,
			confirmTransaction,
		});

		const tool = getTool("solana_kaminoDepositAndBorrow");
		const result = await tool.execute("kamino-deposit-borrow-exec", {
			fromSecretKey: "mock",
			depositReserveMint,
			depositAmountRaw: "1000",
			borrowReserveMint,
			borrowAmountRaw: "10",
			network: "devnet",
		});

		expect(sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(confirmTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: false,
			signature: "kamino-deposit-borrow-sig",
			confirmed: true,
		});
	});
});

describe("solana_kaminoRepayAndWithdraw", () => {
	it("blocks mainnet Kamino repay+withdraw unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_kaminoRepayAndWithdraw");

		await expect(
			tool.execute("kamino-repay-withdraw-mainnet-block", {
				repayReserveMint: Keypair.generate().publicKey.toBase58(),
				repayAmountRaw: "1000",
				withdrawReserveMint: Keypair.generate().publicKey.toBase58(),
				withdrawAmountRaw: "10",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(
			runtimeMocks.buildKaminoRepayAndWithdrawInstructions,
		).not.toHaveBeenCalled();
	});

	it("simulates Kamino repay+withdraw without broadcasting", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const repayReserveMint = Keypair.generate().publicKey.toBase58();
		const withdrawReserveMint = Keypair.generate().publicKey.toBase58();
		const marketAddress = Keypair.generate().publicKey.toBase58();
		const programId = Keypair.generate().publicKey.toBase58();
		const obligationAddress = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([43]),
		});
		runtimeMocks.buildKaminoRepayAndWithdrawInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress,
			programId,
			repayReserveMint,
			repayReserveAddress: Keypair.generate().publicKey.toBase58(),
			repayReserveSymbol: "USDC",
			repayAmountRaw: "1000",
			withdrawReserveMint,
			withdrawReserveAddress: Keypair.generate().publicKey.toBase58(),
			withdrawReserveSymbol: "SOL",
			withdrawAmountRaw: "10",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			currentSlot: "900",
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
		const sendRawTransaction = vi.fn();
		const simulateTransaction = vi.fn().mockResolvedValue({
			value: { err: null, logs: ["ok"], unitsConsumed: 131 },
		});
		runtimeMocks.getConnection.mockReturnValue({
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 9,
			}),
			sendRawTransaction,
			simulateTransaction,
		});

		const tool = getTool("solana_kaminoRepayAndWithdraw");
		const result = await tool.execute("kamino-repay-withdraw-sim", {
			fromSecretKey: "mock",
			repayReserveMint,
			repayAmountRaw: "1000",
			withdrawReserveMint,
			withdrawAmountRaw: "10",
			currentSlot: "900",
			network: "devnet",
			simulate: true,
		});

		expect(sendRawTransaction).not.toHaveBeenCalled();
		expect(simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			ownerAddress: signer.publicKey.toBase58(),
			repayReserveMint,
			withdrawReserveMint,
			currentSlot: "900",
			obligationAddress,
		});
	});

	it("sends Kamino repay+withdraw transaction and confirms by default", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const repayReserveMint = Keypair.generate().publicKey.toBase58();
		const withdrawReserveMint = Keypair.generate().publicKey.toBase58();
		const instruction = new TransactionInstruction({
			programId: Keypair.generate().publicKey,
			keys: [],
			data: Buffer.from([44]),
		});
		runtimeMocks.buildKaminoRepayAndWithdrawInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			marketAddress: Keypair.generate().publicKey.toBase58(),
			programId: Keypair.generate().publicKey.toBase58(),
			repayReserveMint,
			repayReserveAddress: Keypair.generate().publicKey.toBase58(),
			repayReserveSymbol: "USDC",
			repayAmountRaw: "1000",
			withdrawReserveMint,
			withdrawReserveAddress: Keypair.generate().publicKey.toBase58(),
			withdrawReserveSymbol: "SOL",
			withdrawAmountRaw: "10",
			useV2Ixs: true,
			includeAtaIxs: true,
			extraComputeUnits: 1_000_000,
			requestElevationGroup: false,
			currentSlot: "901",
			obligationAddress: Keypair.generate().publicKey.toBase58(),
			instructionCount: 1,
			setupInstructionCount: 0,
			lendingInstructionCount: 1,
			cleanupInstructionCount: 0,
			setupInstructionLabels: [],
			lendingInstructionLabels: ["repayAndWithdraw"],
			cleanupInstructionLabels: [],
			instructions: [instruction],
		});
		const sendRawTransaction = vi
			.fn()
			.mockResolvedValue("kamino-repay-withdraw-sig");
		const confirmTransaction = vi.fn().mockResolvedValue({
			value: { err: null },
		});
		runtimeMocks.getConnection.mockReturnValue({
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 10,
			}),
			sendRawTransaction,
			confirmTransaction,
		});

		const tool = getTool("solana_kaminoRepayAndWithdraw");
		const result = await tool.execute("kamino-repay-withdraw-exec", {
			fromSecretKey: "mock",
			repayReserveMint,
			repayAmountRaw: "1000",
			withdrawReserveMint,
			withdrawAmountRaw: "10",
			currentSlot: "901",
			network: "devnet",
		});

		expect(sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(confirmTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: false,
			signature: "kamino-repay-withdraw-sig",
			confirmed: true,
			currentSlot: "901",
		});
	});
});

describe("solana_jupiterSwap", () => {
	it("simulates Jupiter swap and returns route metadata", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "42",
			routePlan: [{ route: "mock" }],
		});
		runtimeMocks.buildJupiterSwapTransaction.mockResolvedValue({
			swapTransaction: Buffer.from("swap-tx").toString("base64"),
		});
		const legacy = createLegacyTx("jupiter-signed");
		runtimeMocks.parseTransactionFromBase64.mockReturnValue(legacy.tx);

		const sendRawTransaction = vi.fn();
		const simulateTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
				logs: [],
				unitsConsumed: 120,
			},
		});
		runtimeMocks.getConnection.mockReturnValue({
			sendRawTransaction,
			simulateTransaction,
		});

		const tool = getTool("solana_jupiterSwap");
		const result = await tool.execute("jup-sim", {
			fromSecretKey: "mock",
			inputMint: Keypair.generate().publicKey.toBase58(),
			outputMint: Keypair.generate().publicKey.toBase58(),
			amountRaw: "1000",
			network: "mainnet-beta",
			simulate: true,
			confirmMainnet: true,
		});

		expect(runtimeMocks.assertJupiterNetworkSupported).toHaveBeenCalledWith(
			"mainnet-beta",
		);
		expect(sendRawTransaction).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			simulated: true,
			routeCount: 1,
			outAmount: "42",
			network: "mainnet-beta",
			swapMode: "ExactIn",
		});
	});

	it("skips confirmation for Jupiter execute when confirm=false", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "42",
			routePlan: [{ route: "mock" }],
			priceImpactPct: "0.1",
		});
		runtimeMocks.buildJupiterSwapTransaction.mockResolvedValue({
			swapTransaction: Buffer.from("swap-tx").toString("base64"),
		});
		const legacy = createLegacyTx("jupiter-signed");
		runtimeMocks.parseTransactionFromBase64.mockReturnValue(legacy.tx);

		const sendRawTransaction = vi.fn().mockResolvedValue("jup-sig");
		const confirmTransaction = vi.fn();
		runtimeMocks.getConnection.mockReturnValue({
			sendRawTransaction,
			confirmTransaction,
		});

		const tool = getTool("solana_jupiterSwap");
		const result = await tool.execute("jup-exec", {
			fromSecretKey: "mock",
			inputMint: Keypair.generate().publicKey.toBase58(),
			outputMint: Keypair.generate().publicKey.toBase58(),
			amountRaw: "1000",
			network: "mainnet-beta",
			confirmMainnet: true,
			confirm: false,
		});

		expect(confirmTransaction).not.toHaveBeenCalled();
		expect(result.details).toMatchObject({
			simulated: false,
			signature: "jup-sig",
			confirmed: false,
		});
	});
});

describe("protocol-scoped Jupiter swap tools", () => {
	it("simulates Orca swap with default dex filters", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "42",
			routePlan: [{ route: "orca" }],
		});
		runtimeMocks.buildJupiterSwapTransaction.mockResolvedValue({
			swapTransaction: Buffer.from("swap-tx").toString("base64"),
		});
		const legacy = createLegacyTx("orca-signed");
		runtimeMocks.parseTransactionFromBase64.mockReturnValue(legacy.tx);
		const simulateTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
				logs: [],
				unitsConsumed: 66,
			},
		});
		runtimeMocks.getConnection.mockReturnValue({
			simulateTransaction,
			sendRawTransaction: vi.fn(),
		});

		const tool = getTool("solana_orcaSwap");
		const result = await tool.execute("orca-sim", {
			fromSecretKey: "mock",
			inputMint: Keypair.generate().publicKey.toBase58(),
			outputMint: Keypair.generate().publicKey.toBase58(),
			amountRaw: "1000",
			network: "mainnet-beta",
			simulate: true,
			confirmMainnet: true,
		});

		expect(runtimeMocks.getJupiterQuote).toHaveBeenCalledWith(
			expect.objectContaining({
				dexes: ["Orca V2", "Orca Whirlpool"],
			}),
		);
		expect(result.details).toMatchObject({
			protocol: "orca",
			dexes: ["Orca V2", "Orca Whirlpool"],
			simulated: true,
		});
	});

	it("simulates Meteora swap with dex override", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const dexes = ["Meteora DLMM", "Meteora DAMM v2"];
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "42",
			routePlan: [{ route: "meteora" }],
		});
		runtimeMocks.buildJupiterSwapTransaction.mockResolvedValue({
			swapTransaction: Buffer.from("swap-tx").toString("base64"),
		});
		const legacy = createLegacyTx("meteora-signed");
		runtimeMocks.parseTransactionFromBase64.mockReturnValue(legacy.tx);
		const simulateTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
				logs: [],
				unitsConsumed: 77,
			},
		});
		runtimeMocks.getConnection.mockReturnValue({
			simulateTransaction,
			sendRawTransaction: vi.fn(),
		});

		const tool = getTool("solana_meteoraSwap");
		const result = await tool.execute("meteora-sim", {
			fromSecretKey: "mock",
			inputMint: Keypair.generate().publicKey.toBase58(),
			outputMint: Keypair.generate().publicKey.toBase58(),
			amountRaw: "1000",
			dexes,
			network: "mainnet-beta",
			simulate: true,
			confirmMainnet: true,
		});

		expect(runtimeMocks.getJupiterQuote).toHaveBeenCalledWith(
			expect.objectContaining({
				dexes,
			}),
		);
		expect(result.details).toMatchObject({
			protocol: "meteora",
			dexes,
			simulated: true,
		});
	});

	it("falls back to Jupiter routing for Orca and preserves swap options", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const destinationTokenAccount = Keypair.generate().publicKey.toBase58();
		const trackingAccount = Keypair.generate().publicKey.toBase58();
		const feeAccount = Keypair.generate().publicKey.toBase58();
		runtimeMocks.getJupiterQuote
			.mockResolvedValueOnce({
				outAmount: "0",
				routePlan: [],
			})
			.mockResolvedValueOnce({
				outAmount: "99",
				routePlan: [{ route: "jupiter" }],
			});
		runtimeMocks.buildJupiterSwapTransaction.mockResolvedValue({
			swapTransaction: Buffer.from("swap-tx").toString("base64"),
		});
		const legacy = createLegacyTx("orca-fallback-signed");
		runtimeMocks.parseTransactionFromBase64.mockReturnValue(legacy.tx);
		const simulateTransaction = vi.fn().mockResolvedValue({
			value: {
				err: null,
				logs: [],
				unitsConsumed: 90,
			},
		});
		runtimeMocks.getConnection.mockReturnValue({
			simulateTransaction,
			sendRawTransaction: vi.fn(),
		});

		const tool = getTool("solana_orcaSwap");
		const result = await tool.execute("orca-sim-fallback", {
			fromSecretKey: "mock",
			inputMint: Keypair.generate().publicKey.toBase58(),
			outputMint: Keypair.generate().publicKey.toBase58(),
			amountRaw: "1000",
			restrictIntermediateTokens: true,
			onlyDirectRoutes: true,
			maxAccounts: 32,
			wrapAndUnwrapSol: false,
			useSharedAccounts: false,
			dynamicComputeUnitLimit: false,
			skipUserAccountsRpcCalls: true,
			destinationTokenAccount,
			trackingAccount,
			feeAccount,
			priorityLevel: "high",
			priorityMaxLamports: 5000,
			priorityGlobal: true,
			fallbackToJupiterOnNoRoute: true,
			network: "mainnet-beta",
			simulate: true,
			confirmMainnet: true,
		});

		expect(runtimeMocks.getJupiterQuote).toHaveBeenCalledTimes(2);
		expect(runtimeMocks.getJupiterQuote.mock.calls[0]?.[0]).toMatchObject({
			dexes: ["Orca V2", "Orca Whirlpool"],
			restrictIntermediateTokens: true,
			onlyDirectRoutes: true,
			maxAccounts: 32,
		});
		expect(runtimeMocks.getJupiterQuote.mock.calls[1]?.[0]).toMatchObject({
			dexes: undefined,
			restrictIntermediateTokens: true,
			onlyDirectRoutes: true,
			maxAccounts: 32,
		});
		expect(runtimeMocks.parseJupiterPriorityLevel).toHaveBeenCalledWith("high");
		expect(runtimeMocks.buildJupiterSwapTransaction).toHaveBeenCalledWith(
			expect.objectContaining({
				wrapAndUnwrapSol: false,
				useSharedAccounts: false,
				dynamicComputeUnitLimit: false,
				skipUserAccountsRpcCalls: true,
				destinationTokenAccount,
				trackingAccount,
				feeAccount,
				priorityFee: {
					priorityLevel: "veryHigh",
					maxLamports: 5000,
					global: true,
				},
			}),
		);
		expect(result.details).toMatchObject({
			protocol: "orca",
			dexes: ["Orca V2", "Orca Whirlpool"],
			fallbackApplied: true,
			routeSource: "jupiter-fallback",
			outAmount: "99",
			routeCount: 1,
			simulated: true,
		});
	});

	it("fails clearly when Orca route is unavailable", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		runtimeMocks.getJupiterQuote.mockResolvedValue({
			outAmount: "0",
			routePlan: [],
		});

		const tool = getTool("solana_orcaSwap");
		await expect(
			tool.execute("orca-no-route", {
				fromSecretKey: "mock",
				inputMint: Keypair.generate().publicKey.toBase58(),
				outputMint: Keypair.generate().publicKey.toBase58(),
				amountRaw: "1000",
				network: "mainnet-beta",
				simulate: true,
				confirmMainnet: true,
			}),
		).rejects.toThrow("No Orca route found");
	});
});

describe("solana_raydiumSwap", () => {
	it("simulates multi-tx Raydium swap and reports partial failure", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
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
		const txOne = createLegacyTx("ray-signed-1");
		const txTwo = createLegacyTx("ray-signed-2");
		runtimeMocks.parseTransactionFromBase64
			.mockReturnValueOnce(txOne.tx)
			.mockReturnValueOnce(txTwo.tx);

		const simulateTransaction = vi
			.fn()
			.mockResolvedValueOnce({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 80,
				},
			})
			.mockResolvedValueOnce({
				value: {
					err: { InstructionError: [0, "Custom"] },
					logs: [],
					unitsConsumed: 81,
				},
			});
		runtimeMocks.getConnection.mockReturnValue({
			simulateTransaction,
		});

		const tool = getTool("solana_raydiumSwap");
		const result = await tool.execute("ray-sim", {
			fromSecretKey: "mock",
			inputMint: Keypair.generate().publicKey.toBase58(),
			outputMint: Keypair.generate().publicKey.toBase58(),
			amountRaw: "1000",
			slippageBps: 50,
			network: "mainnet-beta",
			simulate: true,
			confirmMainnet: true,
		});

		expect(runtimeMocks.getRaydiumPriorityFee).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			ok: false,
			txCount: 2,
			computeUnitPriceMicroLamports: "7000",
		});
	});

	it("throws when Raydium execution confirmation returns error", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		runtimeMocks.getRaydiumQuote.mockResolvedValue({
			data: { outputAmount: "2" },
		});
		runtimeMocks.buildRaydiumSwapTransactions.mockResolvedValue({
			data: [{ transaction: Buffer.from("ray-tx-1").toString("base64") }],
		});
		const tx = createLegacyTx("ray-signed-1");
		runtimeMocks.parseTransactionFromBase64.mockReturnValue(tx.tx);

		const sendRawTransaction = vi.fn().mockResolvedValue("ray-sig-1");
		const confirmTransaction = vi.fn().mockResolvedValue({
			value: {
				err: { InstructionError: [0, "Custom"] },
			},
		});
		runtimeMocks.getConnection.mockReturnValue({
			sendRawTransaction,
			confirmTransaction,
		});

		const tool = getTool("solana_raydiumSwap");
		await expect(
			tool.execute("ray-exec", {
				fromSecretKey: "mock",
				inputMint: Keypair.generate().publicKey.toBase58(),
				outputMint: Keypair.generate().publicKey.toBase58(),
				amountRaw: "1000",
				slippageBps: 50,
				computeUnitPriceMicroLamports: "9000",
				network: "mainnet-beta",
				confirmMainnet: true,
			}),
		).rejects.toThrow("Transaction confirmed with error:");
	});
});

describe("solana_transferSplToken", () => {
	it("fails when source token account is missing", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const connection = {
			getAccountInfo: vi.fn().mockResolvedValueOnce(null),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_transferSplToken");
		await expect(
			tool.execute("spl-source-missing", {
				fromSecretKey: "mock",
				toAddress: Keypair.generate().publicKey.toBase58(),
				tokenMint: Keypair.generate().publicKey.toBase58(),
				amountRaw: "1000",
				network: "devnet",
				simulate: true,
			}),
		).rejects.toThrow("Source token account not found");
	});

	it("simulates SPL transfer and auto-creates destination ATA when missing", async () => {
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const connection = {
			getAccountInfo: vi
				.fn()
				.mockResolvedValueOnce({ owner: signer.publicKey })
				.mockResolvedValueOnce(null),
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 10,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_transferSplToken");
		const result = await tool.execute("spl-sim", {
			fromSecretKey: "mock",
			toAddress: Keypair.generate().publicKey.toBase58(),
			tokenMint: Keypair.generate().publicKey.toBase58(),
			amountRaw: "1000",
			network: "devnet",
			simulate: true,
		});

		expect(connection.getAccountInfo).toHaveBeenCalledTimes(2);
		expect(result.details).toMatchObject({
			simulated: true,
			amountRaw: "1000",
			destinationAtaCreateIncluded: true,
			tokenProgram: "token",
			network: "devnet",
		});
	});
});

describe("native stake execute tools", () => {
	it("simulates stake create+delegate and derives seeded stake account", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		runtimeMocks.toLamports.mockReturnValue(123_000_000);
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const voteAccountAddress = Keypair.generate().publicKey.toBase58();
		const withdrawAuthorityAddress = Keypair.generate().publicKey.toBase58();
		const stakeSeed = "stake-seed-22";
		const expectedStakeAccount = (
			await PublicKey.createWithSeed(
				signer.publicKey,
				stakeSeed,
				StakeProgram.programId,
			)
		).toBase58();
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 123,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 150,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_stakeCreateAndDelegate");
		const result = await tool.execute("stake-create-delegate-sim", {
			fromSecretKey: "mock",
			withdrawAuthorityAddress,
			voteAccountAddress,
			stakeSeed,
			amountSol: 0.123,
			network: "mainnet-beta",
			simulate: true,
			confirmMainnet: true,
		});

		expect(runtimeMocks.toLamports).toHaveBeenCalledWith(0.123);
		expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			action: "createAndDelegate",
			simulated: true,
			stakeAuthority: signer.publicKey.toBase58(),
			withdrawAuthority: withdrawAuthorityAddress,
			stakeAccount: expectedStakeAccount,
			stakeSeed,
			voteAccount: voteAccountAddress,
			lamports: 123_000_000,
			network: "mainnet-beta",
		});
	});

	it("blocks mainnet stake create+delegate unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_stakeCreateAndDelegate");

		await expect(
			tool.execute("stake-create-delegate-mainnet", {
				fromSecretKey: "mock",
				voteAccountAddress: Keypair.generate().publicKey.toBase58(),
				amountSol: 0.1,
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
	});

	it("simulates stake authorize", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 444,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 75,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_stakeAuthorize");
		const stakeAccountAddress = Keypair.generate().publicKey.toBase58();
		const newAuthorityAddress = Keypair.generate().publicKey.toBase58();
		const result = await tool.execute("stake-authorize-sim", {
			fromSecretKey: "mock",
			stakeAccountAddress,
			newAuthorityAddress,
			authorizationType: "withdrawer",
			network: "mainnet-beta",
			simulate: true,
			confirmMainnet: true,
		});

		expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			action: "authorize",
			authorizationType: "withdrawer",
			simulated: true,
			stakeAuthority: signer.publicKey.toBase58(),
			stakeAccount: stakeAccountAddress,
			newAuthority: newAuthorityAddress,
			network: "mainnet-beta",
		});
	});

	it("blocks mainnet stake authorize unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_stakeAuthorize");

		await expect(
			tool.execute("stake-authorize-mainnet", {
				fromSecretKey: "mock",
				stakeAccountAddress: Keypair.generate().publicKey.toBase58(),
				newAuthorityAddress: Keypair.generate().publicKey.toBase58(),
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
	});

	it("simulates stake delegation", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 123,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: [],
					unitsConsumed: 91,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_stakeDelegate");
		const stakeAccountAddress = Keypair.generate().publicKey.toBase58();
		const voteAccountAddress = Keypair.generate().publicKey.toBase58();
		const result = await tool.execute("stake-delegate-sim", {
			fromSecretKey: "mock",
			stakeAccountAddress,
			voteAccountAddress,
			network: "mainnet-beta",
			simulate: true,
			confirmMainnet: true,
		});

		expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			action: "delegate",
			simulated: true,
			stakeAccount: stakeAccountAddress,
			voteAccount: voteAccountAddress,
			network: "mainnet-beta",
		});
	});

	it("blocks mainnet stake deactivation unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_stakeDeactivate");

		await expect(
			tool.execute("stake-deactivate-mainnet", {
				fromSecretKey: "mock",
				stakeAccountAddress: Keypair.generate().publicKey.toBase58(),
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
	});

	it("sends stake withdraw transaction", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		runtimeMocks.toLamports.mockReturnValue(500_000_000);
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const sendRawTransaction = vi.fn().mockResolvedValue("stake-withdraw-sig");
		const confirmTransaction = vi
			.fn()
			.mockResolvedValue({ value: { err: null } });
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 222,
			}),
			sendRawTransaction,
			confirmTransaction,
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_stakeWithdraw");
		const stakeAccountAddress = Keypair.generate().publicKey.toBase58();
		const toAddress = Keypair.generate().publicKey.toBase58();
		const result = await tool.execute("stake-withdraw-send", {
			fromSecretKey: "mock",
			stakeAccountAddress,
			toAddress,
			amountSol: 0.5,
			network: "devnet",
		});

		expect(runtimeMocks.toLamports).toHaveBeenCalledWith(0.5);
		expect(sendRawTransaction).toHaveBeenCalledTimes(1);
		expect(confirmTransaction).toHaveBeenCalledWith(
			"stake-withdraw-sig",
			"confirmed",
		);
		expect(result.details).toMatchObject({
			action: "withdraw",
			simulated: false,
			signature: "stake-withdraw-sig",
			stakeAccount: stakeAccountAddress,
			toAddress,
			lamports: 500_000_000,
			network: "devnet",
		});
	});

	it("blocks mainnet Orca increase-liquidity unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_orcaIncreaseLiquidity");

		await expect(
			tool.execute("orca-increase-mainnet", {
				fromSecretKey: "mock",
				positionMint: Keypair.generate().publicKey.toBase58(),
				liquidityAmountRaw: "10",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
	});

	it("simulates Orca decrease-liquidity transaction", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.buildOrcaDecreaseLiquidityInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			positionMint,
			quoteParamKind: "tokenB",
			quoteParamAmountRaw: "77",
			slippageBps: 90,
			instructionCount: 1,
			quote: { tokenMinA: "1", tokenMinB: "1" },
			instructions: [
				new TransactionInstruction({
					programId: Keypair.generate().publicKey,
					keys: [],
					data: Buffer.from([7]),
				}),
			],
		});
		const connection = {
			getLatestBlockhash: vi.fn().mockResolvedValue({
				blockhash: "11111111111111111111111111111111",
				lastValidBlockHeight: 999,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 321,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_orcaDecreaseLiquidity");
		const result = await tool.execute("orca-decrease-sim", {
			fromSecretKey: "mock",
			positionMint,
			tokenBAmountRaw: "77",
			slippageBps: 90,
			simulate: true,
			network: "devnet",
		});

		expect(
			runtimeMocks.buildOrcaDecreaseLiquidityInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				positionMint,
				tokenBAmountRaw: "77",
				slippageBps: 90,
			}),
		);
		expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			version: "legacy",
			ownerAddress: signer.publicKey.toBase58(),
			positionMint,
			quoteParamKind: "tokenB",
			quoteParamAmountRaw: "77",
		});
	});

	it("simulates Orca open-position transaction", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.buildOrcaOpenPositionInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			poolAddress,
			positionMint,
			quoteParamKind: "liquidity",
			quoteParamAmountRaw: "10",
			slippageBps: 100,
			fullRange: true,
			lowerPrice: null,
			upperPrice: null,
			initializationCostLamports: "1234",
			instructionCount: 1,
			quote: { tokenMaxA: "1", tokenMaxB: "2" },
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
				lastValidBlockHeight: 998,
			}),
			simulateTransaction: vi.fn().mockResolvedValue({
				value: {
					err: null,
					logs: ["ok"],
					unitsConsumed: 300,
				},
			}),
		};
		runtimeMocks.getConnection.mockReturnValue(connection);

		const tool = getTool("solana_orcaOpenPosition");
		const result = await tool.execute("orca-open-sim", {
			fromSecretKey: "mock",
			poolAddress,
			liquidityAmountRaw: "10",
			fullRange: true,
			simulate: true,
			network: "devnet",
		});

		expect(runtimeMocks.buildOrcaOpenPositionInstructions).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				poolAddress,
				liquidityAmountRaw: "10",
				fullRange: true,
			}),
		);
		expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			version: "legacy",
			ownerAddress: signer.publicKey.toBase58(),
			poolAddress,
			positionMint,
			quoteParamKind: "liquidity",
			quoteParamAmountRaw: "10",
		});
	});

	it("simulates Orca harvest-position transaction", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const positionMint = Keypair.generate().publicKey.toBase58();
		runtimeMocks.buildOrcaHarvestPositionInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			positionMint,
			instructionCount: 1,
			feesQuote: { feeOwedA: "4", feeOwedB: "5" },
			rewardsQuote: { rewards: [{ index: 0, amount: "6" }] },
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
				lastValidBlockHeight: 996,
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

		const tool = getTool("solana_orcaHarvestPosition");
		const result = await tool.execute("orca-harvest-sim", {
			fromSecretKey: "mock",
			positionMint,
			simulate: true,
			network: "devnet",
		});

		expect(
			runtimeMocks.buildOrcaHarvestPositionInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				positionMint,
			}),
		);
		expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			version: "legacy",
			ownerAddress: signer.publicKey.toBase58(),
			positionMint,
			instructionCount: 1,
			feesQuote: { feeOwedA: "4", feeOwedB: "5" },
		});
	});

	it("blocks mainnet Meteora add-liquidity unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta");
		const tool = getTool("solana_meteoraAddLiquidity");

		await expect(
			tool.execute("meteora-add-mainnet", {
				fromSecretKey: "mock",
				poolAddress: Keypair.generate().publicKey.toBase58(),
				positionAddress: Keypair.generate().publicKey.toBase58(),
				totalXAmountRaw: "1",
				totalYAmountRaw: "2",
				network: "mainnet-beta",
			}),
		).rejects.toThrow("confirmMainnet=true");
		expect(runtimeMocks.getConnection).not.toHaveBeenCalled();
	});

	it("simulates Meteora remove-liquidity transaction", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("devnet");
		const signer = Keypair.generate();
		runtimeMocks.resolveSecretKey.mockReturnValue(signer.secretKey);
		const poolAddress = Keypair.generate().publicKey.toBase58();
		const positionAddress = Keypair.generate().publicKey.toBase58();
		runtimeMocks.buildMeteoraRemoveLiquidityInstructions.mockResolvedValue({
			network: "devnet",
			ownerAddress: signer.publicKey.toBase58(),
			poolAddress,
			positionAddress,
			fromBinId: -10,
			toBinId: 10,
			bps: 5000,
			shouldClaimAndClose: false,
			skipUnwrapSol: true,
			positionLowerBinId: -12,
			positionUpperBinId: 12,
			activeBinId: 0,
			instructionCount: 1,
			transactionCount: 1,
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
				lastValidBlockHeight: 997,
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

		const tool = getTool("solana_meteoraRemoveLiquidity");
		const result = await tool.execute("meteora-remove-sim", {
			fromSecretKey: "mock",
			poolAddress,
			positionAddress,
			fromBinId: -10,
			toBinId: 10,
			bps: 5000,
			simulate: true,
			network: "devnet",
		});

		expect(
			runtimeMocks.buildMeteoraRemoveLiquidityInstructions,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAddress: signer.publicKey.toBase58(),
				poolAddress,
				positionAddress,
				fromBinId: -10,
				toBinId: 10,
				bps: 5000,
			}),
		);
		expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(result.details).toMatchObject({
			simulated: true,
			version: "legacy",
			ownerAddress: signer.publicKey.toBase58(),
			poolAddress,
			positionAddress,
			fromBinId: -10,
			toBinId: 10,
			bps: 5000,
		});
	});
});
