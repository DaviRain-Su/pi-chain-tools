import {
	Keypair,
	PublicKey,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	assertJupiterNetworkSupported: vi.fn(),
	assertRaydiumNetworkSupported: vi.fn(),
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
});
