import { Type } from "@sinclair/typebox";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountInstruction,
	createTransferInstruction,
	getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
	type Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
	type TransactionInstruction,
	VersionedTransaction,
	sendAndConfirmTransaction,
} from "@solana/web3.js";
import { defineTool } from "../../../core/types.js";
import {
	TOOL_PREFIX,
	commitmentSchema,
	getConnection,
	getExplorerAddressUrl,
	getExplorerTransactionUrl,
	getSplTokenProgramId,
	normalizeAtPath,
	parseFinality,
	parseNetwork,
	parsePositiveBigInt,
	parseSplTokenProgram,
	parseTransactionFromBase64,
	resolveSecretKey,
	solanaNetworkSchema,
	splTokenProgramSchema,
	stringifyUnknown,
	toLamports,
} from "../runtime.js";

async function buildSplTransferInstructions(
	connection: Connection,
	fromOwner: PublicKey,
	toOwner: PublicKey,
	mint: PublicKey,
	sourceTokenAccount: PublicKey,
	destinationTokenAccount: PublicKey,
	amountRaw: bigint,
	tokenProgramId: PublicKey,
	createDestinationAtaIfMissing: boolean,
): Promise<{
	instructions: TransactionInstruction[];
	destinationAtaCreateIncluded: boolean;
}> {
	const sourceInfo = await connection.getAccountInfo(sourceTokenAccount);
	if (!sourceInfo) {
		throw new Error(
			`Source token account not found: ${sourceTokenAccount.toBase58()}`,
		);
	}

	const instructions: TransactionInstruction[] = [];
	const destinationInfo = await connection.getAccountInfo(
		destinationTokenAccount,
	);
	let destinationAtaCreateIncluded = false;

	if (!destinationInfo && createDestinationAtaIfMissing) {
		instructions.push(
			createAssociatedTokenAccountInstruction(
				fromOwner,
				destinationTokenAccount,
				toOwner,
				mint,
				tokenProgramId,
				ASSOCIATED_TOKEN_PROGRAM_ID,
			),
		);
		destinationAtaCreateIncluded = true;
	}

	if (!destinationInfo && !destinationAtaCreateIncluded) {
		throw new Error(
			`Destination token account not found: ${destinationTokenAccount.toBase58()}. Set createDestinationAtaIfMissing=true or provide an existing destinationTokenAccount.`,
		);
	}

	instructions.push(
		createTransferInstruction(
			sourceTokenAccount,
			destinationTokenAccount,
			fromOwner,
			amountRaw,
			[],
			tokenProgramId,
		),
	);
	return { instructions, destinationAtaCreateIncluded };
}

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
						explorer: getExplorerTransactionUrl(signature, params.network),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}signAndSendTransaction`,
			label: "Solana Sign And Send Transaction",
			description:
				"Sign a serialized transaction (base64) with local/private key and send it. Supports both legacy and v0 transactions.",
			parameters: Type.Object({
				txBase64: Type.String({
					description: "Serialized transaction (legacy or v0) as base64",
				}),
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				network: solanaNetworkSchema(),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, only sign and simulate (no broadcast)",
					}),
				),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required when network=mainnet-beta",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error("Mainnet signing/send requires confirmMainnet=true");
				}

				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const tx = parseTransactionFromBase64(params.txBase64);
				const commitment = parseFinality(params.commitment);

				let version: "legacy" | "v0" = "legacy";
				if (tx instanceof VersionedTransaction) {
					tx.sign([signer]);
					version = "v0";
				} else {
					tx.partialSign(signer);
				}

				if (params.simulate === true) {
					const simulation =
						tx instanceof VersionedTransaction
							? await connection.simulateTransaction(tx, {
									sigVerify: true,
									replaceRecentBlockhash: false,
									commitment,
								})
							: await connection.simulateTransaction(tx);
					const ok = simulation.value.err == null;
					return {
						content: [
							{
								type: "text",
								text: `Signed simulation ${ok ? "succeeded" : "failed"}`,
							},
						],
						details: {
							simulated: true,
							ok,
							version,
							signer: signer.publicKey.toBase58(),
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							network,
							signerExplorer: getExplorerAddressUrl(
								signer.publicKey.toBase58(),
								network,
							),
						},
					};
				}

				const signature = await connection.sendRawTransaction(tx.serialize(), {
					skipPreflight: params.skipPreflight === true,
					maxRetries: params.maxRetries,
				});

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

				return {
					content: [{ type: "text", text: `Signed and sent: ${signature}` }],
					details: {
						simulated: false,
						signature,
						version,
						signer: signer.publicKey.toBase58(),
						confirmed: params.confirm !== false,
						network,
						explorer: getExplorerTransactionUrl(signature, network),
						signerExplorer: getExplorerAddressUrl(
							signer.publicKey.toBase58(),
							network,
						),
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
				const lamports = toLamports(params.amountSol);
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta") {
					throw new Error("Airdrop is only supported on devnet/testnet");
				}
				const connection = getConnection(network);
				const to = new PublicKey(normalizeAtPath(params.address));
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
						explorer: getExplorerTransactionUrl(signature, network),
						addressExplorer: getExplorerAddressUrl(to.toBase58(), network),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}transferSplToken`,
			label: "Solana Transfer SPL Token",
			description:
				"Transfer SPL token using local/private key signer. Supports destination ATA auto-create.",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Sender private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				toAddress: Type.String({ description: "Destination wallet address" }),
				tokenMint: Type.String({ description: "Token mint address" }),
				amountRaw: Type.String({
					description: "Transfer amount in raw integer units (base units)",
				}),
				sourceTokenAccount: Type.Optional(
					Type.String({
						description:
							"Optional source token account. Defaults to sender ATA for the mint.",
					}),
				),
				destinationTokenAccount: Type.Optional(
					Type.String({
						description:
							"Optional destination token account. Defaults to receiver ATA for the mint.",
					}),
				),
				createDestinationAtaIfMissing: Type.Optional(
					Type.Boolean({
						description:
							"Create receiver ATA when destination ATA is missing (default true).",
					}),
				),
				tokenProgram: splTokenProgramSchema(),
				network: solanaNetworkSchema(),
				simulate: Type.Optional(Type.Boolean()),
				confirmMainnet: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params) {
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error("Mainnet SPL transfer requires confirmMainnet=true");
				}

				const connection = getConnection(network);
				const from = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const toOwner = new PublicKey(normalizeAtPath(params.toAddress));
				const mint = new PublicKey(normalizeAtPath(params.tokenMint));
				const tokenProgram = parseSplTokenProgram(params.tokenProgram);
				const tokenProgramId = getSplTokenProgramId(tokenProgram);
				const amountRaw = parsePositiveBigInt(params.amountRaw, "amountRaw");

				const sourceTokenAccount = params.sourceTokenAccount
					? new PublicKey(normalizeAtPath(params.sourceTokenAccount))
					: getAssociatedTokenAddressSync(
							mint,
							from.publicKey,
							false,
							tokenProgramId,
							ASSOCIATED_TOKEN_PROGRAM_ID,
						);
				const destinationTokenAccount = params.destinationTokenAccount
					? new PublicKey(normalizeAtPath(params.destinationTokenAccount))
					: getAssociatedTokenAddressSync(
							mint,
							toOwner,
							false,
							tokenProgramId,
							ASSOCIATED_TOKEN_PROGRAM_ID,
						);

				const { instructions, destinationAtaCreateIncluded } =
					await buildSplTransferInstructions(
						connection,
						from.publicKey,
						toOwner,
						mint,
						sourceTokenAccount,
						destinationTokenAccount,
						amountRaw,
						tokenProgramId,
						params.createDestinationAtaIfMissing !== false,
					);

				const tx = new Transaction().add(...instructions);
				tx.feePayer = from.publicKey;
				const latestBlockhash = await connection.getLatestBlockhash();
				tx.recentBlockhash = latestBlockhash.blockhash;

				if (params.simulate === true) {
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
							to: toOwner.toBase58(),
							tokenMint: mint.toBase58(),
							amountRaw: amountRaw.toString(),
							sourceTokenAccount: sourceTokenAccount.toBase58(),
							destinationTokenAccount: destinationTokenAccount.toBase58(),
							destinationAtaCreateIncluded,
							tokenProgram,
							tokenProgramId: tokenProgramId.toBase58(),
							network,
						},
					};
				}

				const feeResult = await connection.getFeeForMessage(
					tx.compileMessage(),
				);
				const feeLamports = feeResult.value ?? 0;
				const balanceLamports = await connection.getBalance(from.publicKey);
				if (balanceLamports < feeLamports) {
					throw new Error(
						`Insufficient SOL for fee: balance ${balanceLamports} lamports, required ${feeLamports} lamports (short ${feeLamports - balanceLamports})`,
					);
				}

				const signature = await sendAndConfirmTransaction(
					connection,
					tx,
					[from],
					{ commitment: "confirmed" },
				);
				return {
					content: [{ type: "text", text: `SPL transfer sent: ${signature}` }],
					details: {
						simulated: false,
						signature,
						from: from.publicKey.toBase58(),
						to: toOwner.toBase58(),
						tokenMint: mint.toBase58(),
						amountRaw: amountRaw.toString(),
						sourceTokenAccount: sourceTokenAccount.toBase58(),
						destinationTokenAccount: destinationTokenAccount.toBase58(),
						destinationAtaCreateIncluded,
						tokenProgram,
						tokenProgramId: tokenProgramId.toBase58(),
						feeLamports,
						balanceLamports,
						network,
						explorer: getExplorerTransactionUrl(signature, network),
						fromExplorer: getExplorerAddressUrl(
							from.publicKey.toBase58(),
							network,
						),
						toExplorer: getExplorerAddressUrl(toOwner.toBase58(), network),
						tokenMintExplorer: getExplorerAddressUrl(mint.toBase58(), network),
						sourceTokenAccountExplorer: getExplorerAddressUrl(
							sourceTokenAccount.toBase58(),
							network,
						),
						destinationTokenAccountExplorer: getExplorerAddressUrl(
							destinationTokenAccount.toBase58(),
							network,
						),
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
				const lamports = toLamports(params.amountSol);
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error("Mainnet transfer requires confirmMainnet=true");
				}

				const connection = getConnection(network);
				const from = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const to = new PublicKey(normalizeAtPath(params.toAddress));

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
						explorer: getExplorerTransactionUrl(signature, network),
						fromExplorer: getExplorerAddressUrl(
							from.publicKey.toBase58(),
							network,
						),
						toExplorer: getExplorerAddressUrl(to.toBase58(), network),
					},
				};
			},
		}),
	];
}
