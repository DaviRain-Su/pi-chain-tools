import { Type } from "@sinclair/typebox";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountInstruction,
	createTransferInstruction,
	getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
	Authorized,
	type BlockhashWithExpiryBlockHeight,
	type Connection,
	PublicKey,
	StakeProgram,
	SystemProgram,
	Transaction,
	type TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import { defineTool } from "../../../core/types.js";
import {
	TOOL_PREFIX,
	assertJupiterNetworkSupported,
	assertRaydiumNetworkSupported,
	buildJupiterSwapInstructions,
	buildJupiterSwapTransaction,
	buildRaydiumSwapTransactions,
	getConnection,
	getExplorerAddressUrl,
	getJupiterApiBaseUrl,
	getJupiterQuote,
	getRaydiumApiBaseUrl,
	getRaydiumPriorityFee,
	getRaydiumPriorityFeeMicroLamports,
	getRaydiumQuote,
	getSplTokenProgramId,
	jupiterPriorityLevelSchema,
	jupiterSwapModeSchema,
	normalizeAtPath,
	parseJupiterPriorityLevel,
	parseJupiterSwapMode,
	parseNetwork,
	parsePositiveBigInt,
	parseRaydiumSwapType,
	parseRaydiumTxVersion,
	parseSplTokenProgram,
	raydiumSwapTypeSchema,
	raydiumTxVersionSchema,
	solanaNetworkSchema,
	splTokenProgramSchema,
	toLamports,
} from "../runtime.js";

const ORCA_DEFAULT_DEXES = ["Orca V2", "Orca Whirlpool"] as const;
const METEORA_DEFAULT_DEXES = ["Meteora DLMM"] as const;

function resolveScopedDexes(
	dexes: string[] | undefined,
	defaultDexes: readonly string[],
): string[] {
	return dexes && dexes.length > 0 ? dexes : [...defaultDexes];
}

function hasPositiveOutAmount(outAmount: string | null): boolean {
	return (
		typeof outAmount === "string" &&
		/^\d+$/.test(outAmount) &&
		BigInt(outAmount) > 0n
	);
}

function hasScopedRoute(
	routePlan: unknown[],
	outAmount: string | null,
): boolean {
	return routePlan.length > 0 || hasPositiveOutAmount(outAmount);
}

function parseQuoteRouteContext(quote: unknown): {
	outAmount: string | null;
	routePlan: unknown[];
	hasRoute: boolean;
} {
	const quotePayload =
		quote && typeof quote === "object"
			? (quote as Record<string, unknown>)
			: {};
	const outAmount =
		typeof quotePayload.outAmount === "string" ? quotePayload.outAmount : null;
	const routePlan = Array.isArray(quotePayload.routePlan)
		? quotePayload.routePlan
		: [];
	return {
		outAmount,
		routePlan,
		hasRoute: hasScopedRoute(routePlan, outAmount),
	};
}

function assertScopedRouteAvailability(
	protocol: "orca" | "meteora",
	dexes: string[],
	routePlan: unknown[],
	outAmount: string | null,
): void {
	if (hasScopedRoute(routePlan, outAmount)) {
		return;
	}
	const label = protocol === "orca" ? "Orca" : "Meteora";
	throw new Error(
		`No ${label} route found under dex constraints [${dexes.join(", ")}]. Set fallbackToJupiterOnNoRoute=true, try solana_buildJupiterSwapTransaction, or adjust dexes.`,
	);
}

function normalizeStakeSeed(value: string | undefined): string {
	const rawSeed = value?.trim().length ? value.trim() : "w3rt-stake";
	const sanitized = rawSeed.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
	if (!sanitized.length) {
		throw new Error(
			"stakeSeed is invalid. Use 1-32 chars with letters, numbers, _ or -.",
		);
	}
	return sanitized;
}

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

function createLegacyTransaction(
	payer: PublicKey,
	instructions: TransactionInstruction[],
	blockhash: BlockhashWithExpiryBlockHeight,
): Transaction {
	const tx = new Transaction().add(...instructions);
	tx.feePayer = payer;
	tx.recentBlockhash = blockhash.blockhash;
	return tx;
}

function createV0Transaction(
	payer: PublicKey,
	instructions: TransactionInstruction[],
	blockhash: BlockhashWithExpiryBlockHeight,
): VersionedTransaction {
	const message = new TransactionMessage({
		payerKey: payer,
		recentBlockhash: blockhash.blockhash,
		instructions,
	}).compileToV0Message();
	return new VersionedTransaction(message);
}

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

function extractRaydiumTransactions(response: unknown): string[] {
	if (!response || typeof response !== "object") return [];
	const payload = response as Record<string, unknown>;
	const data = payload.data;
	if (Array.isArray(data)) {
		return data
			.map((entry) => {
				if (!entry || typeof entry !== "object") return null;
				const record = entry as Record<string, unknown>;
				return typeof record.transaction === "string"
					? record.transaction
					: null;
			})
			.filter((entry): entry is string => entry !== null);
	}
	if (data && typeof data === "object") {
		const record = data as Record<string, unknown>;
		if (typeof record.transaction === "string") {
			return [record.transaction];
		}
	}
	if (typeof payload.transaction === "string") {
		return [payload.transaction];
	}
	return [];
}

type ScopedJupiterComposeParams = {
	userPublicKey: string;
	inputMint: string;
	outputMint: string;
	amountRaw: string;
	slippageBps?: number;
	swapMode?: string;
	asLegacyTransaction?: boolean;
	dexes?: string[];
	excludeDexes?: string[];
	fallbackToJupiterOnNoRoute?: boolean;
	network?: string;
};

async function buildScopedJupiterSwapTransaction(
	protocol: "orca" | "meteora",
	defaultDexes: readonly string[],
	params: ScopedJupiterComposeParams,
) {
	assertJupiterNetworkSupported(params.network);
	const userPublicKey = new PublicKey(
		normalizeAtPath(params.userPublicKey),
	).toBase58();
	const inputMint = new PublicKey(normalizeAtPath(params.inputMint)).toBase58();
	const outputMint = new PublicKey(
		normalizeAtPath(params.outputMint),
	).toBase58();
	const amountRaw = parsePositiveBigInt(
		params.amountRaw,
		"amountRaw",
	).toString();
	const swapMode = parseJupiterSwapMode(params.swapMode);
	const dexes = resolveScopedDexes(params.dexes, defaultDexes);
	const quoteRequest = {
		inputMint,
		outputMint,
		amount: amountRaw,
		slippageBps: params.slippageBps,
		swapMode,
		asLegacyTransaction: params.asLegacyTransaction,
		dexes,
		excludeDexes: params.excludeDexes,
	};
	const scopedQuote = await getJupiterQuote(quoteRequest);
	const fallbackRequested = params.fallbackToJupiterOnNoRoute === true;
	let fallbackApplied = false;
	let quote = scopedQuote;
	let quoteRoute = parseQuoteRouteContext(scopedQuote);
	if (!quoteRoute.hasRoute) {
		if (fallbackRequested) {
			const fallbackQuote = await getJupiterQuote({
				...quoteRequest,
				dexes: undefined,
			});
			const fallbackRoute = parseQuoteRouteContext(fallbackQuote);
			if (!fallbackRoute.hasRoute) {
				const protocolLabel = protocol === "orca" ? "Orca" : "Meteora";
				throw new Error(
					`No ${protocolLabel} route found under dex constraints [${dexes.join(", ")}], and Jupiter fallback also returned no route.`,
				);
			}
			quote = fallbackQuote;
			quoteRoute = fallbackRoute;
			fallbackApplied = true;
		} else {
			assertScopedRouteAvailability(
				protocol,
				dexes,
				quoteRoute.routePlan,
				quoteRoute.outAmount,
			);
		}
	}
	const swapResponse = await buildJupiterSwapTransaction({
		userPublicKey,
		quoteResponse: quote,
		asLegacyTransaction: params.asLegacyTransaction,
	});
	const payload =
		swapResponse && typeof swapResponse === "object"
			? (swapResponse as Record<string, unknown>)
			: {};
	const txBase64 =
		typeof payload.swapTransaction === "string" ? payload.swapTransaction : "";
	if (!txBase64) {
		throw new Error("Jupiter swap response missing swapTransaction");
	}
	const protocolLabel = protocol === "orca" ? "Orca" : "Meteora";
	return {
		content: [
			{
				type: "text",
				text: `Unsigned ${protocolLabel} swap transaction built`,
			},
		],
		details: {
			protocol,
			dexes,
			effectiveDexes: fallbackApplied ? null : dexes,
			fallbackToJupiterOnNoRoute: fallbackRequested,
			fallbackApplied,
			routeSource: fallbackApplied ? "jupiter-fallback" : "scoped",
			txBase64,
			userPublicKey,
			inputMint,
			outputMint,
			amountRaw,
			outAmount: quoteRoute.outAmount,
			routeCount: quoteRoute.routePlan.length,
			swapMode,
			quote,
			scopedQuote: fallbackApplied ? scopedQuote : undefined,
			swapResponse: payload,
			network: parseNetwork(params.network),
			jupiterBaseUrl: getJupiterApiBaseUrl(),
			userExplorer: getExplorerAddressUrl(userPublicKey, params.network),
			inputMintExplorer: getExplorerAddressUrl(inputMint, params.network),
			outputMintExplorer: getExplorerAddressUrl(outputMint, params.network),
		},
	};
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
		defineTool({
			name: `${TOOL_PREFIX}buildSplTokenTransferTransaction`,
			label: "Solana Build SPL Token Transfer Transaction",
			description:
				"Build an unsigned SPL token transfer transaction (legacy, base64). Supports optional ATA auto-create for destination.",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender wallet address (fee payer)",
				}),
				toAddress: Type.String({ description: "Receiver wallet address" }),
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
							"Create receiver ATA instruction when destination ATA is missing (default true).",
					}),
				),
				tokenProgram: splTokenProgramSchema(),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const fromOwner = new PublicKey(normalizeAtPath(params.fromAddress));
				const toOwner = new PublicKey(normalizeAtPath(params.toAddress));
				const mint = new PublicKey(normalizeAtPath(params.tokenMint));
				const tokenProgram = parseSplTokenProgram(params.tokenProgram);
				const tokenProgramId = getSplTokenProgramId(tokenProgram);
				const amountRaw = parsePositiveBigInt(params.amountRaw, "amountRaw");

				const sourceTokenAccount = params.sourceTokenAccount
					? new PublicKey(normalizeAtPath(params.sourceTokenAccount))
					: getAssociatedTokenAddressSync(
							mint,
							fromOwner,
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
						fromOwner,
						toOwner,
						mint,
						sourceTokenAccount,
						destinationTokenAccount,
						amountRaw,
						tokenProgramId,
						params.createDestinationAtaIfMissing !== false,
					);

				const latestBlockhash = await connection.getLatestBlockhash();
				const tx = createLegacyTransaction(
					fromOwner,
					instructions,
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
						{
							type: "text",
							text: "Unsigned SPL token transfer transaction built (legacy)",
						},
					],
					details: {
						txBase64,
						version: "legacy",
						fromAddress: fromOwner.toBase58(),
						toAddress: toOwner.toBase58(),
						tokenMint: mint.toBase58(),
						amountRaw: amountRaw.toString(),
						sourceTokenAccount: sourceTokenAccount.toBase58(),
						destinationTokenAccount: destinationTokenAccount.toBase58(),
						destinationAtaCreateIncluded,
						tokenProgram,
						tokenProgramId: tokenProgramId.toBase58(),
						feeLamports,
						blockhash: latestBlockhash.blockhash,
						lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
						network: parseNetwork(params.network),
						fromExplorer: getExplorerAddressUrl(
							fromOwner.toBase58(),
							params.network,
						),
						toExplorer: getExplorerAddressUrl(
							toOwner.toBase58(),
							params.network,
						),
						tokenMintExplorer: getExplorerAddressUrl(
							mint.toBase58(),
							params.network,
						),
						sourceTokenAccountExplorer: getExplorerAddressUrl(
							sourceTokenAccount.toBase58(),
							params.network,
						),
						destinationTokenAccountExplorer: getExplorerAddressUrl(
							destinationTokenAccount.toBase58(),
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}buildSplTokenTransferV0Transaction`,
			label: "Solana Build SPL Token Transfer V0 Transaction",
			description:
				"Build an unsigned SPL token transfer transaction (v0, base64). Supports optional ATA auto-create for destination.",
			parameters: Type.Object({
				fromAddress: Type.String({
					description: "Sender wallet address (fee payer)",
				}),
				toAddress: Type.String({ description: "Receiver wallet address" }),
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
							"Create receiver ATA instruction when destination ATA is missing (default true).",
					}),
				),
				tokenProgram: splTokenProgramSchema(),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const fromOwner = new PublicKey(normalizeAtPath(params.fromAddress));
				const toOwner = new PublicKey(normalizeAtPath(params.toAddress));
				const mint = new PublicKey(normalizeAtPath(params.tokenMint));
				const tokenProgram = parseSplTokenProgram(params.tokenProgram);
				const tokenProgramId = getSplTokenProgramId(tokenProgram);
				const amountRaw = parsePositiveBigInt(params.amountRaw, "amountRaw");

				const sourceTokenAccount = params.sourceTokenAccount
					? new PublicKey(normalizeAtPath(params.sourceTokenAccount))
					: getAssociatedTokenAddressSync(
							mint,
							fromOwner,
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
						fromOwner,
						toOwner,
						mint,
						sourceTokenAccount,
						destinationTokenAccount,
						amountRaw,
						tokenProgramId,
						params.createDestinationAtaIfMissing !== false,
					);

				const latestBlockhash = await connection.getLatestBlockhash();
				const tx = createV0Transaction(
					fromOwner,
					instructions,
					latestBlockhash,
				);
				const feeResult = await connection.getFeeForMessage(tx.message);
				const feeLamports = feeResult.value ?? 0;
				const txBase64 = Buffer.from(tx.serialize()).toString("base64");
				return {
					content: [
						{
							type: "text",
							text: "Unsigned SPL token transfer transaction built (v0)",
						},
					],
					details: {
						txBase64,
						version: "v0",
						fromAddress: fromOwner.toBase58(),
						toAddress: toOwner.toBase58(),
						tokenMint: mint.toBase58(),
						amountRaw: amountRaw.toString(),
						sourceTokenAccount: sourceTokenAccount.toBase58(),
						destinationTokenAccount: destinationTokenAccount.toBase58(),
						destinationAtaCreateIncluded,
						tokenProgram,
						tokenProgramId: tokenProgramId.toBase58(),
						feeLamports,
						blockhash: latestBlockhash.blockhash,
						lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
						network: parseNetwork(params.network),
						fromExplorer: getExplorerAddressUrl(
							fromOwner.toBase58(),
							params.network,
						),
						toExplorer: getExplorerAddressUrl(
							toOwner.toBase58(),
							params.network,
						),
						tokenMintExplorer: getExplorerAddressUrl(
							mint.toBase58(),
							params.network,
						),
						sourceTokenAccountExplorer: getExplorerAddressUrl(
							sourceTokenAccount.toBase58(),
							params.network,
						),
						destinationTokenAccountExplorer: getExplorerAddressUrl(
							destinationTokenAccount.toBase58(),
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}buildStakeCreateAndDelegateTransaction`,
			label: "Solana Build Stake Create+Delegate Transaction",
			description:
				"Build an unsigned native staking create-and-delegate transaction (legacy, base64) that derives a stake account from seed",
			parameters: Type.Object({
				stakeAuthorityAddress: Type.String({
					description: "Stake authority wallet address (also fee payer/base)",
				}),
				withdrawAuthorityAddress: Type.Optional(
					Type.String({
						description:
							"Optional withdraw authority for the new stake account. Defaults to stakeAuthorityAddress.",
					}),
				),
				voteAccountAddress: Type.String({
					description: "Validator vote account public key",
				}),
				stakeSeed: Type.Optional(
					Type.String({
						description:
							"Optional seed used with stakeAuthorityAddress to derive stake account (max 32 chars after sanitization).",
					}),
				),
				amountSol: Type.Number({
					description: "Stake amount in SOL",
				}),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const stakeAuthority = new PublicKey(
					normalizeAtPath(params.stakeAuthorityAddress),
				);
				const withdrawAuthority = new PublicKey(
					normalizeAtPath(
						params.withdrawAuthorityAddress ?? params.stakeAuthorityAddress,
					),
				);
				const voteAccount = new PublicKey(
					normalizeAtPath(params.voteAccountAddress),
				);
				const stakeSeed = normalizeStakeSeed(params.stakeSeed);
				const stakeAccount = await PublicKey.createWithSeed(
					stakeAuthority,
					stakeSeed,
					StakeProgram.programId,
				);
				const lamports = toLamports(params.amountSol);
				const createStakeTx = StakeProgram.createAccountWithSeed({
					fromPubkey: stakeAuthority,
					stakePubkey: stakeAccount,
					basePubkey: stakeAuthority,
					seed: stakeSeed,
					authorized: new Authorized(stakeAuthority, withdrawAuthority),
					lamports,
				});
				const delegateTx = StakeProgram.delegate({
					stakePubkey: stakeAccount,
					authorizedPubkey: stakeAuthority,
					votePubkey: voteAccount,
				});
				const latestBlockhash = await connection.getLatestBlockhash();
				const tx = createLegacyTransaction(
					stakeAuthority,
					[...createStakeTx.instructions, ...delegateTx.instructions],
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
						{
							type: "text",
							text: "Unsigned stake create+delegate transaction built (legacy)",
						},
					],
					details: {
						txBase64,
						version: "legacy",
						action: "createAndDelegate",
						stakeAuthority: stakeAuthority.toBase58(),
						withdrawAuthority: withdrawAuthority.toBase58(),
						stakeAccount: stakeAccount.toBase58(),
						stakeSeed,
						voteAccount: voteAccount.toBase58(),
						amountSol: params.amountSol,
						lamports,
						feeLamports,
						blockhash: latestBlockhash.blockhash,
						lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
						network: parseNetwork(params.network),
						stakeAuthorityExplorer: getExplorerAddressUrl(
							stakeAuthority.toBase58(),
							params.network,
						),
						withdrawAuthorityExplorer: getExplorerAddressUrl(
							withdrawAuthority.toBase58(),
							params.network,
						),
						stakeAccountExplorer: getExplorerAddressUrl(
							stakeAccount.toBase58(),
							params.network,
						),
						voteAccountExplorer: getExplorerAddressUrl(
							voteAccount.toBase58(),
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}buildStakeDelegateTransaction`,
			label: "Solana Build Stake Delegate Transaction",
			description:
				"Build an unsigned native staking delegate transaction (legacy, base64) for an existing stake account",
			parameters: Type.Object({
				stakeAuthorityAddress: Type.String({
					description: "Stake authority wallet address (also fee payer)",
				}),
				stakeAccountAddress: Type.String({
					description: "Stake account public key",
				}),
				voteAccountAddress: Type.String({
					description: "Validator vote account public key",
				}),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const stakeAuthority = new PublicKey(
					normalizeAtPath(params.stakeAuthorityAddress),
				);
				const stakeAccount = new PublicKey(
					normalizeAtPath(params.stakeAccountAddress),
				);
				const voteAccount = new PublicKey(
					normalizeAtPath(params.voteAccountAddress),
				);
				const delegateTx = StakeProgram.delegate({
					stakePubkey: stakeAccount,
					authorizedPubkey: stakeAuthority,
					votePubkey: voteAccount,
				});
				const instruction =
					delegateTx.instructions[delegateTx.instructions.length - 1];
				if (!instruction) {
					throw new Error("Failed to build stake delegate instruction");
				}
				const latestBlockhash = await connection.getLatestBlockhash();
				const tx = createLegacyTransaction(
					stakeAuthority,
					[instruction],
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
						{
							type: "text",
							text: "Unsigned stake delegate transaction built (legacy)",
						},
					],
					details: {
						txBase64,
						version: "legacy",
						action: "delegate",
						stakeAuthority: stakeAuthority.toBase58(),
						stakeAccount: stakeAccount.toBase58(),
						voteAccount: voteAccount.toBase58(),
						feeLamports,
						blockhash: latestBlockhash.blockhash,
						lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
						network: parseNetwork(params.network),
						stakeAuthorityExplorer: getExplorerAddressUrl(
							stakeAuthority.toBase58(),
							params.network,
						),
						stakeAccountExplorer: getExplorerAddressUrl(
							stakeAccount.toBase58(),
							params.network,
						),
						voteAccountExplorer: getExplorerAddressUrl(
							voteAccount.toBase58(),
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}buildStakeDeactivateTransaction`,
			label: "Solana Build Stake Deactivate Transaction",
			description:
				"Build an unsigned native staking deactivate transaction (legacy, base64) for an existing stake account",
			parameters: Type.Object({
				stakeAuthorityAddress: Type.String({
					description: "Stake authority wallet address (also fee payer)",
				}),
				stakeAccountAddress: Type.String({
					description: "Stake account public key",
				}),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const stakeAuthority = new PublicKey(
					normalizeAtPath(params.stakeAuthorityAddress),
				);
				const stakeAccount = new PublicKey(
					normalizeAtPath(params.stakeAccountAddress),
				);
				const deactivateTx = StakeProgram.deactivate({
					stakePubkey: stakeAccount,
					authorizedPubkey: stakeAuthority,
				});
				const instruction =
					deactivateTx.instructions[deactivateTx.instructions.length - 1];
				if (!instruction) {
					throw new Error("Failed to build stake deactivate instruction");
				}
				const latestBlockhash = await connection.getLatestBlockhash();
				const tx = createLegacyTransaction(
					stakeAuthority,
					[instruction],
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
						{
							type: "text",
							text: "Unsigned stake deactivate transaction built (legacy)",
						},
					],
					details: {
						txBase64,
						version: "legacy",
						action: "deactivate",
						stakeAuthority: stakeAuthority.toBase58(),
						stakeAccount: stakeAccount.toBase58(),
						feeLamports,
						blockhash: latestBlockhash.blockhash,
						lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
						network: parseNetwork(params.network),
						stakeAuthorityExplorer: getExplorerAddressUrl(
							stakeAuthority.toBase58(),
							params.network,
						),
						stakeAccountExplorer: getExplorerAddressUrl(
							stakeAccount.toBase58(),
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}buildStakeWithdrawTransaction`,
			label: "Solana Build Stake Withdraw Transaction",
			description:
				"Build an unsigned native staking withdraw transaction (legacy, base64) for an existing stake account",
			parameters: Type.Object({
				withdrawAuthorityAddress: Type.String({
					description: "Withdraw authority wallet address (also fee payer)",
				}),
				stakeAccountAddress: Type.String({
					description: "Stake account public key",
				}),
				toAddress: Type.String({
					description: "Destination wallet address for withdrawn SOL",
				}),
				amountSol: Type.Number({
					description: "Withdraw amount in SOL",
				}),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const withdrawAuthority = new PublicKey(
					normalizeAtPath(params.withdrawAuthorityAddress),
				);
				const stakeAccount = new PublicKey(
					normalizeAtPath(params.stakeAccountAddress),
				);
				const to = new PublicKey(normalizeAtPath(params.toAddress));
				const lamports = toLamports(params.amountSol);
				const withdrawTx = StakeProgram.withdraw({
					stakePubkey: stakeAccount,
					authorizedPubkey: withdrawAuthority,
					toPubkey: to,
					lamports,
				});
				const instruction =
					withdrawTx.instructions[withdrawTx.instructions.length - 1];
				if (!instruction) {
					throw new Error("Failed to build stake withdraw instruction");
				}
				const latestBlockhash = await connection.getLatestBlockhash();
				const tx = createLegacyTransaction(
					withdrawAuthority,
					[instruction],
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
						{
							type: "text",
							text: "Unsigned stake withdraw transaction built (legacy)",
						},
					],
					details: {
						txBase64,
						version: "legacy",
						action: "withdraw",
						withdrawAuthority: withdrawAuthority.toBase58(),
						stakeAccount: stakeAccount.toBase58(),
						toAddress: to.toBase58(),
						amountSol: params.amountSol,
						lamports,
						feeLamports,
						blockhash: latestBlockhash.blockhash,
						lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
						network: parseNetwork(params.network),
						withdrawAuthorityExplorer: getExplorerAddressUrl(
							withdrawAuthority.toBase58(),
							params.network,
						),
						stakeAccountExplorer: getExplorerAddressUrl(
							stakeAccount.toBase58(),
							params.network,
						),
						toAddressExplorer: getExplorerAddressUrl(
							to.toBase58(),
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}buildJupiterSwapTransaction`,
			label: "Solana Build Jupiter Swap Transaction",
			description:
				"Build an unsigned Jupiter swap transaction (base64) using best available route across Solana DEXes",
			parameters: Type.Object({
				userPublicKey: Type.String({
					description: "Wallet public key (fee payer / signer)",
				}),
				inputMint: Type.String({ description: "Input token mint address" }),
				outputMint: Type.String({ description: "Output token mint address" }),
				amountRaw: Type.String({
					description: "Swap amount in raw integer base units",
				}),
				slippageBps: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
				swapMode: jupiterSwapModeSchema(),
				restrictIntermediateTokens: Type.Optional(Type.Boolean()),
				onlyDirectRoutes: Type.Optional(Type.Boolean()),
				maxAccounts: Type.Optional(Type.Integer({ minimum: 8, maximum: 256 })),
				dexes: Type.Optional(
					Type.Array(Type.String({ description: "DEX labels to include" }), {
						minItems: 1,
						maxItems: 20,
					}),
				),
				excludeDexes: Type.Optional(
					Type.Array(Type.String({ description: "DEX labels to exclude" }), {
						minItems: 1,
						maxItems: 20,
					}),
				),
				asLegacyTransaction: Type.Optional(Type.Boolean()),
				wrapAndUnwrapSol: Type.Optional(Type.Boolean()),
				useSharedAccounts: Type.Optional(Type.Boolean()),
				dynamicComputeUnitLimit: Type.Optional(Type.Boolean()),
				skipUserAccountsRpcCalls: Type.Optional(Type.Boolean()),
				destinationTokenAccount: Type.Optional(Type.String()),
				trackingAccount: Type.Optional(Type.String()),
				feeAccount: Type.Optional(Type.String()),
				priorityLevel: jupiterPriorityLevelSchema(),
				priorityMaxLamports: Type.Optional(
					Type.Integer({ minimum: 1, maximum: 20_000_000 }),
				),
				priorityGlobal: Type.Optional(Type.Boolean()),
				jitoTipLamports: Type.Optional(
					Type.Integer({ minimum: 1, maximum: 20_000_000 }),
				),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				assertJupiterNetworkSupported(params.network);
				const userPublicKey = new PublicKey(
					normalizeAtPath(params.userPublicKey),
				).toBase58();
				const inputMint = new PublicKey(
					normalizeAtPath(params.inputMint),
				).toBase58();
				const outputMint = new PublicKey(
					normalizeAtPath(params.outputMint),
				).toBase58();
				const amountRaw = parsePositiveBigInt(
					params.amountRaw,
					"amountRaw",
				).toString();
				const swapMode = parseJupiterSwapMode(params.swapMode);

				const quote = await getJupiterQuote({
					inputMint,
					outputMint,
					amount: amountRaw,
					slippageBps: params.slippageBps,
					swapMode,
					restrictIntermediateTokens: params.restrictIntermediateTokens,
					onlyDirectRoutes: params.onlyDirectRoutes,
					asLegacyTransaction: params.asLegacyTransaction,
					maxAccounts: params.maxAccounts,
					dexes: params.dexes,
					excludeDexes: params.excludeDexes,
				});

				const priorityLevel = parseJupiterPriorityLevel(params.priorityLevel);
				const swapResponse = await buildJupiterSwapTransaction({
					userPublicKey,
					quoteResponse: quote,
					wrapAndUnwrapSol: params.wrapAndUnwrapSol,
					useSharedAccounts: params.useSharedAccounts,
					dynamicComputeUnitLimit: params.dynamicComputeUnitLimit ?? true,
					skipUserAccountsRpcCalls: params.skipUserAccountsRpcCalls,
					destinationTokenAccount: params.destinationTokenAccount,
					trackingAccount: params.trackingAccount,
					feeAccount: params.feeAccount,
					asLegacyTransaction: params.asLegacyTransaction,
					jitoTipLamports: params.jitoTipLamports,
					priorityFee:
						params.jitoTipLamports === undefined
							? {
									priorityLevel,
									maxLamports: params.priorityMaxLamports,
									global: params.priorityGlobal,
								}
							: undefined,
				});

				const payload =
					swapResponse && typeof swapResponse === "object"
						? (swapResponse as Record<string, unknown>)
						: {};
				const txBase64 =
					typeof payload.swapTransaction === "string"
						? payload.swapTransaction
						: "";
				if (!txBase64) {
					throw new Error("Jupiter swap response missing swapTransaction");
				}

				const quotePayload =
					quote && typeof quote === "object"
						? (quote as Record<string, unknown>)
						: {};
				const outAmount =
					typeof quotePayload.outAmount === "string"
						? quotePayload.outAmount
						: null;
				const routePlan = Array.isArray(quotePayload.routePlan)
					? quotePayload.routePlan
					: [];

				return {
					content: [
						{ type: "text", text: "Unsigned Jupiter swap transaction built" },
					],
					details: {
						txBase64,
						userPublicKey,
						inputMint,
						outputMint,
						amountRaw,
						outAmount,
						routeCount: routePlan.length,
						swapMode,
						quote,
						swapResponse: payload,
						network: parseNetwork(params.network),
						jupiterBaseUrl: getJupiterApiBaseUrl(),
						userExplorer: getExplorerAddressUrl(userPublicKey, params.network),
						inputMintExplorer: getExplorerAddressUrl(inputMint, params.network),
						outputMintExplorer: getExplorerAddressUrl(
							outputMint,
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}buildOrcaSwapTransaction`,
			label: "Solana Build Orca Swap Transaction",
			description:
				"Build an unsigned Orca-scoped swap transaction (via Jupiter with Orca dex filters)",
			parameters: Type.Object({
				userPublicKey: Type.String({
					description: "Wallet public key (fee payer / signer)",
				}),
				inputMint: Type.String({ description: "Input token mint address" }),
				outputMint: Type.String({ description: "Output token mint address" }),
				amountRaw: Type.String({
					description: "Swap amount in raw integer base units",
				}),
				slippageBps: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
				swapMode: jupiterSwapModeSchema(),
				asLegacyTransaction: Type.Optional(Type.Boolean()),
				dexes: Type.Optional(
					Type.Array(
						Type.String({ description: "Optional DEX labels override" }),
						{
							minItems: 1,
							maxItems: 20,
						},
					),
				),
				excludeDexes: Type.Optional(
					Type.Array(Type.String({ description: "DEX labels to exclude" }), {
						minItems: 1,
						maxItems: 20,
					}),
				),
				fallbackToJupiterOnNoRoute: Type.Optional(
					Type.Boolean({
						description:
							"Fallback to unconstrained Jupiter routing if no Orca route is available",
					}),
				),
				network: solanaNetworkSchema(),
			}),
			async execute(toolCallId, params) {
				void toolCallId;
				return buildScopedJupiterSwapTransaction(
					"orca",
					ORCA_DEFAULT_DEXES,
					params,
				);
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}buildMeteoraSwapTransaction`,
			label: "Solana Build Meteora Swap Transaction",
			description:
				"Build an unsigned Meteora-scoped swap transaction (via Jupiter with Meteora dex filters)",
			parameters: Type.Object({
				userPublicKey: Type.String({
					description: "Wallet public key (fee payer / signer)",
				}),
				inputMint: Type.String({ description: "Input token mint address" }),
				outputMint: Type.String({ description: "Output token mint address" }),
				amountRaw: Type.String({
					description: "Swap amount in raw integer base units",
				}),
				slippageBps: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
				swapMode: jupiterSwapModeSchema(),
				asLegacyTransaction: Type.Optional(Type.Boolean()),
				dexes: Type.Optional(
					Type.Array(
						Type.String({ description: "Optional DEX labels override" }),
						{
							minItems: 1,
							maxItems: 20,
						},
					),
				),
				excludeDexes: Type.Optional(
					Type.Array(Type.String({ description: "DEX labels to exclude" }), {
						minItems: 1,
						maxItems: 20,
					}),
				),
				fallbackToJupiterOnNoRoute: Type.Optional(
					Type.Boolean({
						description:
							"Fallback to unconstrained Jupiter routing if no Meteora route is available",
					}),
				),
				network: solanaNetworkSchema(),
			}),
			async execute(toolCallId, params) {
				void toolCallId;
				return buildScopedJupiterSwapTransaction(
					"meteora",
					METEORA_DEFAULT_DEXES,
					params,
				);
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}buildJupiterSwapInstructions`,
			label: "Solana Build Jupiter Swap Instructions",
			description:
				"Build Jupiter swap instructions payload for composing with custom transactions",
			parameters: Type.Object({
				userPublicKey: Type.String({
					description: "Wallet public key (fee payer / signer)",
				}),
				inputMint: Type.String({ description: "Input token mint address" }),
				outputMint: Type.String({ description: "Output token mint address" }),
				amountRaw: Type.String({
					description: "Swap amount in raw integer base units",
				}),
				slippageBps: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
				swapMode: jupiterSwapModeSchema(),
				restrictIntermediateTokens: Type.Optional(Type.Boolean()),
				onlyDirectRoutes: Type.Optional(Type.Boolean()),
				maxAccounts: Type.Optional(Type.Integer({ minimum: 8, maximum: 256 })),
				dexes: Type.Optional(
					Type.Array(Type.String({ description: "DEX labels to include" }), {
						minItems: 1,
						maxItems: 20,
					}),
				),
				excludeDexes: Type.Optional(
					Type.Array(Type.String({ description: "DEX labels to exclude" }), {
						minItems: 1,
						maxItems: 20,
					}),
				),
				asLegacyTransaction: Type.Optional(Type.Boolean()),
				wrapAndUnwrapSol: Type.Optional(Type.Boolean()),
				useSharedAccounts: Type.Optional(Type.Boolean()),
				dynamicComputeUnitLimit: Type.Optional(Type.Boolean()),
				skipUserAccountsRpcCalls: Type.Optional(Type.Boolean()),
				destinationTokenAccount: Type.Optional(Type.String()),
				trackingAccount: Type.Optional(Type.String()),
				feeAccount: Type.Optional(Type.String()),
				priorityLevel: jupiterPriorityLevelSchema(),
				priorityMaxLamports: Type.Optional(
					Type.Integer({ minimum: 1, maximum: 20_000_000 }),
				),
				priorityGlobal: Type.Optional(Type.Boolean()),
				jitoTipLamports: Type.Optional(
					Type.Integer({ minimum: 1, maximum: 20_000_000 }),
				),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				assertJupiterNetworkSupported(params.network);
				const userPublicKey = new PublicKey(
					normalizeAtPath(params.userPublicKey),
				).toBase58();
				const inputMint = new PublicKey(
					normalizeAtPath(params.inputMint),
				).toBase58();
				const outputMint = new PublicKey(
					normalizeAtPath(params.outputMint),
				).toBase58();
				const amountRaw = parsePositiveBigInt(
					params.amountRaw,
					"amountRaw",
				).toString();
				const swapMode = parseJupiterSwapMode(params.swapMode);

				const quote = await getJupiterQuote({
					inputMint,
					outputMint,
					amount: amountRaw,
					slippageBps: params.slippageBps,
					swapMode,
					restrictIntermediateTokens: params.restrictIntermediateTokens,
					onlyDirectRoutes: params.onlyDirectRoutes,
					asLegacyTransaction: params.asLegacyTransaction,
					maxAccounts: params.maxAccounts,
					dexes: params.dexes,
					excludeDexes: params.excludeDexes,
				});

				const priorityLevel = parseJupiterPriorityLevel(params.priorityLevel);
				const instructions = await buildJupiterSwapInstructions({
					userPublicKey,
					quoteResponse: quote,
					wrapAndUnwrapSol: params.wrapAndUnwrapSol,
					useSharedAccounts: params.useSharedAccounts,
					dynamicComputeUnitLimit: params.dynamicComputeUnitLimit ?? true,
					skipUserAccountsRpcCalls: params.skipUserAccountsRpcCalls,
					destinationTokenAccount: params.destinationTokenAccount,
					trackingAccount: params.trackingAccount,
					feeAccount: params.feeAccount,
					asLegacyTransaction: params.asLegacyTransaction,
					jitoTipLamports: params.jitoTipLamports,
					priorityFee:
						params.jitoTipLamports === undefined
							? {
									priorityLevel,
									maxLamports: params.priorityMaxLamports,
									global: params.priorityGlobal,
								}
							: undefined,
				});
				const payload =
					instructions && typeof instructions === "object"
						? (instructions as Record<string, unknown>)
						: {};
				const quotePayload =
					quote && typeof quote === "object"
						? (quote as Record<string, unknown>)
						: {};
				const routePlan = Array.isArray(quotePayload.routePlan)
					? quotePayload.routePlan
					: [];

				return {
					content: [{ type: "text", text: "Jupiter swap instructions built" }],
					details: {
						userPublicKey,
						inputMint,
						outputMint,
						amountRaw,
						routeCount: routePlan.length,
						swapMode,
						quote,
						instructions: payload,
						network: parseNetwork(params.network),
						jupiterBaseUrl: getJupiterApiBaseUrl(),
						userExplorer: getExplorerAddressUrl(userPublicKey, params.network),
						inputMintExplorer: getExplorerAddressUrl(inputMint, params.network),
						outputMintExplorer: getExplorerAddressUrl(
							outputMint,
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}buildRaydiumSwapTransaction`,
			label: "Solana Build Raydium Swap Transaction",
			description:
				"Build unsigned Raydium swap transaction(s) from official Trade API quote",
			parameters: Type.Object({
				userPublicKey: Type.String({
					description: "Wallet public key (fee payer / signer)",
				}),
				inputMint: Type.String({ description: "Input token mint address" }),
				outputMint: Type.String({ description: "Output token mint address" }),
				amountRaw: Type.String({
					description: "Swap amount in raw integer base units",
				}),
				slippageBps: Type.Integer({ minimum: 1, maximum: 5000 }),
				txVersion: raydiumTxVersionSchema(),
				swapType: raydiumSwapTypeSchema(),
				computeUnitPriceMicroLamports: Type.Optional(
					Type.String({
						description:
							"Priority fee as micro-lamports per CU. If omitted, auto-fee endpoint will be used.",
					}),
				),
				wrapSol: Type.Optional(Type.Boolean()),
				unwrapSol: Type.Optional(Type.Boolean()),
				inputAccount: Type.Optional(Type.String()),
				outputAccount: Type.Optional(Type.String()),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				assertRaydiumNetworkSupported(params.network);
				const userPublicKey = new PublicKey(
					normalizeAtPath(params.userPublicKey),
				).toBase58();
				const inputMint = new PublicKey(
					normalizeAtPath(params.inputMint),
				).toBase58();
				const outputMint = new PublicKey(
					normalizeAtPath(params.outputMint),
				).toBase58();
				const amountRaw = parsePositiveBigInt(
					params.amountRaw,
					"amountRaw",
				).toString();
				const txVersion = parseRaydiumTxVersion(params.txVersion);
				const swapType = parseRaydiumSwapType(params.swapType);
				const inputAccount = params.inputAccount
					? new PublicKey(normalizeAtPath(params.inputAccount)).toBase58()
					: undefined;
				const outputAccount = params.outputAccount
					? new PublicKey(normalizeAtPath(params.outputAccount)).toBase58()
					: undefined;

				const quote = await getRaydiumQuote({
					inputMint,
					outputMint,
					amount: amountRaw,
					slippageBps: params.slippageBps,
					txVersion,
					swapType,
				});

				let autoFeePayload: unknown = null;
				let computeUnitPriceMicroLamports =
					params.computeUnitPriceMicroLamports;
				if (!computeUnitPriceMicroLamports) {
					autoFeePayload = await getRaydiumPriorityFee();
					computeUnitPriceMicroLamports =
						getRaydiumPriorityFeeMicroLamports(autoFeePayload) ?? undefined;
				}
				if (!computeUnitPriceMicroLamports) {
					throw new Error(
						"Unable to resolve Raydium computeUnitPriceMicroLamports from auto-fee endpoint. Provide computeUnitPriceMicroLamports explicitly.",
					);
				}

				const swapResponse = await buildRaydiumSwapTransactions({
					wallet: userPublicKey,
					txVersion,
					swapType,
					quoteResponse: quote,
					computeUnitPriceMicroLamports,
					wrapSol: params.wrapSol,
					unwrapSol: params.unwrapSol,
					inputAccount,
					outputAccount,
				});

				const transactions = extractRaydiumTransactions(swapResponse);
				if (transactions.length === 0) {
					throw new Error(
						"Raydium swap response missing serialized transaction",
					);
				}
				const txBase64 = transactions[0] ?? "";

				return {
					content: [
						{
							type: "text",
							text: `Raydium swap transaction built (${transactions.length} tx)`,
						},
					],
					details: {
						txBase64,
						transactions,
						txCount: transactions.length,
						userPublicKey,
						inputMint,
						outputMint,
						amountRaw,
						slippageBps: params.slippageBps,
						txVersion,
						swapType,
						computeUnitPriceMicroLamports,
						inputAccount: inputAccount ?? null,
						outputAccount: outputAccount ?? null,
						quote,
						swapResponse,
						autoFeePayload,
						network: parseNetwork(params.network),
						raydiumApiBaseUrl: getRaydiumApiBaseUrl(),
						userExplorer: getExplorerAddressUrl(userPublicKey, params.network),
						inputMintExplorer: getExplorerAddressUrl(inputMint, params.network),
						outputMintExplorer: getExplorerAddressUrl(
							outputMint,
							params.network,
						),
					},
				};
			},
		}),
	];
}
