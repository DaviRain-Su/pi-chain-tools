import {
	Keypair,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
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
	toLamports: vi.fn(),
	getSplTokenProgramId: vi.fn(),
	parsePositiveBigInt: vi.fn(),
}));

vi.mock("../runtime.js", async () => {
	const actual =
		await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
	return {
		...actual,
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

type SignAndSendParams = {
	txBase64: string;
	network?: "mainnet-beta" | "devnet" | "testnet";
	fromSecretKey?: string;
	skipPreflight?: boolean;
	maxRetries?: number;
	confirm?: boolean;
	commitment?: "processed" | "confirmed" | "finalized";
	simulate?: boolean;
	confirmMainnet?: boolean;
};

type SignAndSendResult = {
	details?: {
		signature?: string;
		version?: "legacy" | "v0";
		network?: string;
		confirmed?: boolean;
	};
};

type SignAndSendTool = {
	execute(
		toolCallId: string,
		params: SignAndSendParams,
	): Promise<SignAndSendResult>;
};

function getSignAndSendTool(): SignAndSendTool {
	const tool = createSolanaExecuteTools().find(
		(item) => item.name === "solana_signAndSendTransaction",
	);
	if (!tool) throw new Error("solana_signAndSendTransaction not found");
	return tool as unknown as SignAndSendTool;
}

describe("solana_signAndSendTransaction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runtimeMocks.getExplorerAddressUrl.mockReturnValue(
			"https://explorer.solana.com/address/mock?cluster=devnet",
		);
		runtimeMocks.getExplorerTransactionUrl.mockReturnValue(
			"https://explorer.solana.com/tx/mock?cluster=devnet",
		);
	});

	it("blocks mainnet send unless confirmMainnet=true", async () => {
		runtimeMocks.parseNetwork.mockReturnValue("mainnet-beta" as never);
		const tool = getSignAndSendTool();

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

		const partialSign = vi.fn();
		const serialize = vi.fn(() => Buffer.from("legacy-signed"));
		runtimeMocks.parseTransactionFromBase64.mockReturnValue({
			partialSign,
			serialize,
		});

		const sendRawTransaction = vi.fn().mockResolvedValue("legacy-signature");
		const confirmTransaction = vi
			.fn()
			.mockResolvedValue({ value: { err: null } });
		runtimeMocks.getConnection.mockReturnValue({
			sendRawTransaction,
			confirmTransaction,
		});

		const tool = getSignAndSendTool();
		const result = await tool.execute("t2", {
			txBase64: Buffer.from("tx").toString("base64"),
			network: "devnet",
		});

		expect(partialSign).toHaveBeenCalledTimes(1);
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

		const tool = getSignAndSendTool();
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
});
