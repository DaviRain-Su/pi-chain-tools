import { Type } from "@sinclair/typebox";
import {
	Keypair,
	LAMPORTS_PER_SOL,
	PublicKey,
	SystemProgram,
	Transaction,
	VersionedTransaction,
	sendAndConfirmTransaction,
} from "@solana/web3.js";
import { defineTool } from "../../../core/types.js";
import {
	TOOL_PREFIX,
	assertPositiveAmount,
	commitmentSchema,
	getConnection,
	normalizeAtPath,
	parseFinality,
	parseNetwork,
	parseTransactionFromBase64,
	resolveSecretKey,
	solanaNetworkSchema,
	stringifyUnknown,
} from "../runtime.js";

export function createSolanaExecuteTools() {
	return [
		defineTool({
			name: `${TOOL_PREFIX}simulateTransaction`,
			label: "Solana Simulate Transaction",
			description: "Simulate a serialized transaction (base64)",
			parameters: Type.Object({
				txBase64: Type.String({
					description: "Serialized transaction as base64",
				}),
				network: solanaNetworkSchema(),
				commitment: commitmentSchema(),
				sigVerify: Type.Optional(Type.Boolean()),
				replaceRecentBlockhash: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const tx = parseTransactionFromBase64(params.txBase64);
				const finality = parseFinality(params.commitment);
				const simulation =
					tx instanceof VersionedTransaction
						? await connection.simulateTransaction(tx, {
								sigVerify: params.sigVerify ?? false,
								replaceRecentBlockhash: params.replaceRecentBlockhash ?? true,
								commitment: finality,
							})
						: await connection.simulateTransaction(tx);
				const ok = simulation.value.err == null;
				return {
					content: [
						{ type: "text", text: `Simulation ${ok ? "succeeded" : "failed"}` },
					],
					details: {
						ok,
						err: simulation.value.err,
						logs: simulation.value.logs ?? [],
						unitsConsumed: simulation.value.unitsConsumed ?? null,
						returnData: simulation.value.returnData ?? null,
						network: parseNetwork(params.network),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}sendRawTransaction`,
			label: "Solana Send Raw Transaction",
			description: "Broadcast a signed serialized transaction (base64)",
			parameters: Type.Object({
				txBase64: Type.String({
					description: "Signed serialized transaction as base64",
				}),
				network: solanaNetworkSchema(),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const raw = Buffer.from(params.txBase64, "base64");
				const signature = await connection.sendRawTransaction(raw, {
					skipPreflight: params.skipPreflight === true,
					maxRetries: params.maxRetries,
				});

				const commitment = parseFinality(params.commitment);
				let confirmationErr: unknown = null;
				if (params.confirm !== false) {
					const confirmation = await connection.confirmTransaction(
						signature,
						commitment,
					);
					confirmationErr = confirmation.value.err;
				}

				if (confirmationErr) {
					throw new Error(
						`Transaction confirmed with error: ${stringifyUnknown(confirmationErr)}`,
					);
				}

				const cluster = parseNetwork(params.network);
				return {
					content: [{ type: "text", text: `Transaction sent: ${signature}` }],
					details: {
						signature,
						confirmed: params.confirm !== false,
						network: cluster,
						explorer: `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`,
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}confirmTransaction`,
			label: "Solana Confirm Transaction",
			description: "Confirm a transaction signature",
			parameters: Type.Object({
				signature: Type.String({ description: "Transaction signature" }),
				network: solanaNetworkSchema(),
				commitment: commitmentSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const commitment = parseFinality(params.commitment);
				const confirmation = await connection.confirmTransaction(
					params.signature,
					commitment,
				);
				const ok = confirmation.value.err == null;
				return {
					content: [
						{
							type: "text",
							text: `Confirmation ${ok ? "succeeded" : "failed"}`,
						},
					],
					details: {
						signature: params.signature,
						ok,
						err: confirmation.value.err,
						network: parseNetwork(params.network),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}airdrop`,
			label: "Solana Airdrop",
			description: "Request SOL airdrop on devnet/testnet",
			parameters: Type.Object({
				address: Type.String({ description: "Receiver address" }),
				amountSol: Type.Number({ description: "Amount in SOL" }),
				network: Type.Optional(
					Type.Union([Type.Literal("devnet"), Type.Literal("testnet")]),
				),
			}),
			async execute(_toolCallId, params) {
				assertPositiveAmount(params.amountSol);
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta") {
					throw new Error("Airdrop is only supported on devnet/testnet");
				}
				const connection = getConnection(network);
				const to = new PublicKey(normalizeAtPath(params.address));
				const lamports = Math.round(params.amountSol * LAMPORTS_PER_SOL);
				const latestBlockhash = await connection.getLatestBlockhash();
				const signature = await connection.requestAirdrop(to, lamports);
				await connection.confirmTransaction(
					{
						signature,
						blockhash: latestBlockhash.blockhash,
						lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
					},
					"confirmed",
				);
				return {
					content: [{ type: "text", text: `Airdrop requested: ${signature}` }],
					details: {
						signature,
						address: to.toBase58(),
						lamports,
						network,
						explorer: `https://explorer.solana.com/tx/${signature}?cluster=${network}`,
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}transferSol`,
			label: "Solana Transfer SOL",
			description:
				"Transfer SOL. Supports mainnet-beta. For mainnet, set confirmMainnet=true explicitly. Optional simulate=true for dry run.",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Sender private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				toAddress: Type.String({ description: "Destination address" }),
				amountSol: Type.Number({ description: "Amount in SOL" }),
				network: solanaNetworkSchema(),
				simulate: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				assertPositiveAmount(params.amountSol);
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error("Mainnet transfer requires confirmMainnet=true");
				}

				const connection = getConnection(network);
				const from = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const to = new PublicKey(normalizeAtPath(params.toAddress));
				const lamports = Math.round(params.amountSol * LAMPORTS_PER_SOL);

				const tx = new Transaction().add(
					SystemProgram.transfer({
						fromPubkey: from.publicKey,
						toPubkey: to,
						lamports,
					}),
				);

				if (params.simulate === true) {
					tx.feePayer = from.publicKey;
					const { blockhash } = await connection.getLatestBlockhash();
					tx.recentBlockhash = blockhash;
					tx.sign(from);
					const sim = await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Simulation ${sim.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							simulated: true,
							err: sim.value.err,
							logs: sim.value.logs ?? [],
							from: from.publicKey.toBase58(),
							to: to.toBase58(),
							lamports,
							network,
						},
					};
				}

				tx.feePayer = from.publicKey;
				const latestBlockhash = await connection.getLatestBlockhash();
				tx.recentBlockhash = latestBlockhash.blockhash;
				const feeResult = await connection.getFeeForMessage(
					tx.compileMessage(),
				);
				const feeLamports = feeResult.value ?? 0;
				const balanceLamports = await connection.getBalance(from.publicKey);
				const requiredLamports = lamports + feeLamports;
				if (balanceLamports < requiredLamports) {
					throw new Error(
						`Insufficient funds: balance ${balanceLamports} lamports, required ${requiredLamports} lamports (short ${requiredLamports - balanceLamports})`,
					);
				}

				const signature = await sendAndConfirmTransaction(
					connection,
					tx,
					[from],
					{ commitment: "confirmed" },
				);
				const explorerCluster =
					network === "mainnet-beta" ? "mainnet-beta" : network;
				return {
					content: [{ type: "text", text: `Transfer sent: ${signature}` }],
					details: {
						simulated: false,
						signature,
						from: from.publicKey.toBase58(),
						to: to.toBase58(),
						lamports,
						amountSol: params.amountSol,
						feeLamports,
						balanceLamports,
						requiredLamports,
						network,
						explorer: `https://explorer.solana.com/tx/${signature}?cluster=${explorerCluster}`,
					},
				};
			},
		}),
	];
}
