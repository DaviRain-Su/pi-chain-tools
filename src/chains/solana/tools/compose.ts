import { Type } from "@sinclair/typebox";
import {
	type BlockhashWithExpiryBlockHeight,
	LAMPORTS_PER_SOL,
	PublicKey,
	SystemProgram,
	Transaction,
} from "@solana/web3.js";
import { defineTool } from "../../../core/types.js";
import {
	TOOL_PREFIX,
	assertPositiveAmount,
	getConnection,
	normalizeAtPath,
	parseNetwork,
	solanaNetworkSchema,
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
				assertPositiveAmount(params.amountSol);
				const connection = getConnection(params.network);
				const lamports = Math.round(params.amountSol * LAMPORTS_PER_SOL);
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
					},
				};
			},
		}),
	];
}
