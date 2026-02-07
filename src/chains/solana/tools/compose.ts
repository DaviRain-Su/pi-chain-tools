import { Type } from "@sinclair/typebox";
import {
	type BlockhashWithExpiryBlockHeight,
	PublicKey,
	SystemProgram,
	Transaction,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import { defineTool } from "../../../core/types.js";
import {
	TOOL_PREFIX,
	getConnection,
	getExplorerAddressUrl,
	normalizeAtPath,
	parseNetwork,
	solanaNetworkSchema,
	toLamports,
} from "../runtime.js";

function createTransferTransaction(
	fromAddress: string,
	toAddress: string,
	lamports: number,
	blockhash: BlockhashWithExpiryBlockHeight,
): Transaction {
	const from = new PublicKey(normalizeAtPath(fromAddress));
	const to = new PublicKey(normalizeAtPath(toAddress));
	const tx = new Transaction().add(
		SystemProgram.transfer({
			fromPubkey: from,
			toPubkey: to,
			lamports,
		}),
	);
	tx.feePayer = from;
	tx.recentBlockhash = blockhash.blockhash;
	return tx;
}

function createTransferV0Transaction(
	fromAddress: string,
	toAddress: string,
	lamports: number,
	blockhash: BlockhashWithExpiryBlockHeight,
): VersionedTransaction {
	const from = new PublicKey(normalizeAtPath(fromAddress));
	const to = new PublicKey(normalizeAtPath(toAddress));
	const instruction = SystemProgram.transfer({
		fromPubkey: from,
		toPubkey: to,
		lamports,
	});
	const message = new TransactionMessage({
		payerKey: from,
		recentBlockhash: blockhash.blockhash,
		instructions: [instruction],
	}).compileToV0Message();
	return new VersionedTransaction(message);
}

export function createSolanaComposeTools() {
	return [
		defineTool({
			name: `${TOOL_PREFIX}buildSolTransferTransaction`,
			label: "Solana Build SOL Transfer Transaction",
			description:
				"Build an unsigned SOL transfer transaction (base64) for later signing and sending",
			parameters: Type.Object({
				fromAddress: Type.String({ description: "Sender address (fee payer)" }),
				toAddress: Type.String({ description: "Receiver address" }),
				amountSol: Type.Number({ description: "Amount in SOL" }),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const lamports = toLamports(params.amountSol);
				const latestBlockhash = await connection.getLatestBlockhash();
				const tx = createTransferTransaction(
					params.fromAddress,
					params.toAddress,
					lamports,
					latestBlockhash,
				);
				const feeResult = await connection.getFeeForMessage(
					tx.compileMessage(),
				);
				const feeLamports = feeResult.value ?? 0;
				const txBase64 = tx
					.serialize({
						requireAllSignatures: false,
						verifySignatures: false,
					})
					.toString("base64");
				return {
					content: [
						{ type: "text", text: "Unsigned SOL transfer transaction built" },
					],
					details: {
						txBase64,
						fromAddress: normalizeAtPath(params.fromAddress),
						toAddress: normalizeAtPath(params.toAddress),
						lamports,
						amountSol: params.amountSol,
						feeLamports,
						blockhash: latestBlockhash.blockhash,
						lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
						network: parseNetwork(params.network),
						fromExplorer: getExplorerAddressUrl(
							normalizeAtPath(params.fromAddress),
							params.network,
						),
						toExplorer: getExplorerAddressUrl(
							normalizeAtPath(params.toAddress),
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}buildSolTransferV0Transaction`,
			label: "Solana Build SOL Transfer V0 Transaction",
			description:
				"Build an unsigned v0 SOL transfer transaction (base64) for later signing and sending",
			parameters: Type.Object({
				fromAddress: Type.String({ description: "Sender address (fee payer)" }),
				toAddress: Type.String({ description: "Receiver address" }),
				amountSol: Type.Number({ description: "Amount in SOL" }),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const lamports = toLamports(params.amountSol);
				const latestBlockhash = await connection.getLatestBlockhash();
				const tx = createTransferV0Transaction(
					params.fromAddress,
					params.toAddress,
					lamports,
					latestBlockhash,
				);
				const feeResult = await connection.getFeeForMessage(tx.message);
				const feeLamports = feeResult.value ?? 0;
				const txBase64 = Buffer.from(tx.serialize()).toString("base64");
				return {
					content: [
						{
							type: "text",
							text: "Unsigned v0 SOL transfer transaction built",
						},
					],
					details: {
						txBase64,
						version: "v0",
						fromAddress: normalizeAtPath(params.fromAddress),
						toAddress: normalizeAtPath(params.toAddress),
						lamports,
						amountSol: params.amountSol,
						feeLamports,
						blockhash: latestBlockhash.blockhash,
						lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
						network: parseNetwork(params.network),
						fromExplorer: getExplorerAddressUrl(
							normalizeAtPath(params.fromAddress),
							params.network,
						),
						toExplorer: getExplorerAddressUrl(
							normalizeAtPath(params.toAddress),
							params.network,
						),
					},
				};
			},
		}),
	];
}
