import { Type } from "@sinclair/typebox";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountInstruction,
	createTransferInstruction,
	getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
	Authorized,
	type Connection,
	Keypair,
	PublicKey,
	StakeAuthorizationLayout,
	StakeProgram,
	SystemProgram,
	Transaction,
	type TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
	sendAndConfirmTransaction,
} from "@solana/web3.js";
import { defineTool } from "../../../core/types.js";
import {
	TOOL_PREFIX,
	assertJupiterNetworkSupported,
	assertRaydiumNetworkSupported,
	buildJupiterSwapTransaction,
	buildKaminoBorrowInstructions,
	buildKaminoDepositAndBorrowInstructions,
	buildKaminoDepositInstructions,
	buildKaminoRepayAndWithdrawInstructions,
	buildKaminoRepayInstructions,
	buildKaminoWithdrawInstructions,
	buildOrcaDecreaseLiquidityInstructions,
	buildOrcaIncreaseLiquidityInstructions,
	buildRaydiumSwapTransactions,
	commitmentSchema,
	getConnection,
	getExplorerAddressUrl,
	getExplorerTransactionUrl,
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
	parseFinality,
	parseJupiterPriorityLevel,
	parseJupiterSwapMode,
	parseNetwork,
	parsePositiveBigInt,
	parseRaydiumSwapType,
	parseRaydiumTxVersion,
	parseSplTokenProgram,
	parseTransactionFromBase64,
	raydiumSwapTypeSchema,
	raydiumTxVersionSchema,
	resolveSecretKey,
	solanaNetworkSchema,
	splTokenProgramSchema,
	stringifyUnknown,
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
	const routePlan = Array.isArray(quotePayload.routePlan)
		? quotePayload.routePlan
		: [];
	const outAmount =
		typeof quotePayload.outAmount === "string" ? quotePayload.outAmount : null;
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
		`No ${label} route found under dex constraints [${dexes.join(", ")}]. Set fallbackToJupiterOnNoRoute=true, try solana_jupiterSwap, or adjust dexes.`,
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

function parseStakeAuthorizationType(
	value: string | undefined,
): "staker" | "withdrawer" {
	if (!value || value === "staker") return "staker";
	if (value === "withdrawer") return "withdrawer";
	throw new Error("authorizationType must be 'staker' or 'withdrawer'");
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

type ScopedJupiterExecuteParams = {
	fromSecretKey?: string;
	userPublicKey?: string;
	inputMint: string;
	outputMint: string;
	amountRaw: string;
	slippageBps?: number;
	swapMode?: string;
	restrictIntermediateTokens?: boolean;
	onlyDirectRoutes?: boolean;
	maxAccounts?: number;
	asLegacyTransaction?: boolean;
	dexes?: string[];
	excludeDexes?: string[];
	wrapAndUnwrapSol?: boolean;
	useSharedAccounts?: boolean;
	dynamicComputeUnitLimit?: boolean;
	skipUserAccountsRpcCalls?: boolean;
	destinationTokenAccount?: string;
	trackingAccount?: string;
	feeAccount?: string;
	priorityLevel?: string;
	priorityMaxLamports?: number;
	priorityGlobal?: boolean;
	jitoTipLamports?: number;
	fallbackToJupiterOnNoRoute?: boolean;
	network?: string;
	skipPreflight?: boolean;
	maxRetries?: number;
	confirm?: boolean;
	commitment?: string;
	simulate?: boolean;
	confirmMainnet?: boolean;
};

async function executeScopedJupiterSwap(
	protocol: "orca" | "meteora",
	defaultDexes: readonly string[],
	params: ScopedJupiterExecuteParams,
) {
	const network = parseNetwork(params.network);
	assertJupiterNetworkSupported(network);
	const protocolLabel = protocol === "orca" ? "Orca" : "Meteora";
	if (network === "mainnet-beta" && params.confirmMainnet !== true) {
		throw new Error(
			`Mainnet ${protocolLabel} swap requires confirmMainnet=true`,
		);
	}

	const connection = getConnection(network);
	const signer = Keypair.fromSecretKey(resolveSecretKey(params.fromSecretKey));
	const signerPublicKey = signer.publicKey.toBase58();
	if (params.userPublicKey) {
		const asserted = new PublicKey(
			normalizeAtPath(params.userPublicKey),
		).toBase58();
		if (asserted !== signerPublicKey) {
			throw new Error(
				`userPublicKey mismatch: expected ${signerPublicKey}, got ${asserted}`,
			);
		}
	}

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
		restrictIntermediateTokens: params.restrictIntermediateTokens,
		onlyDirectRoutes: params.onlyDirectRoutes,
		asLegacyTransaction: params.asLegacyTransaction,
		maxAccounts: params.maxAccounts,
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
	const priorityLevel = parseJupiterPriorityLevel(params.priorityLevel);
	const swapResponse = await buildJupiterSwapTransaction({
		userPublicKey: signerPublicKey,
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

	const swapPayload =
		swapResponse && typeof swapResponse === "object"
			? (swapResponse as Record<string, unknown>)
			: {};
	const txBase64 =
		typeof swapPayload.swapTransaction === "string"
			? swapPayload.swapTransaction
			: "";
	if (!txBase64) {
		throw new Error("Jupiter swap response missing swapTransaction");
	}
	const tx = parseTransactionFromBase64(txBase64);
	let version: "legacy" | "v0" = "legacy";
	if (tx instanceof VersionedTransaction) {
		tx.sign([signer]);
		version = "v0";
	} else {
		tx.partialSign(signer);
	}

	const commitment = parseFinality(params.commitment);

	if (params.simulate === true) {
		const simulation =
			tx instanceof VersionedTransaction
				? await connection.simulateTransaction(tx, {
						sigVerify: true,
						replaceRecentBlockhash: false,
						commitment,
					})
				: await connection.simulateTransaction(tx);
		return {
			content: [
				{
					type: "text",
					text: `${protocolLabel} simulation ${simulation.value.err ? "failed" : "succeeded"}`,
				},
			],
			details: {
				protocol,
				dexes,
				simulated: true,
				version,
				inputMint,
				outputMint,
				amountRaw,
				outAmount: quoteRoute.outAmount,
				routeCount: quoteRoute.routePlan.length,
				err: simulation.value.err ?? null,
				logs: simulation.value.logs ?? [],
				unitsConsumed: simulation.value.unitsConsumed ?? null,
				signer: signerPublicKey,
				swapMode,
				effectiveDexes: fallbackApplied ? null : dexes,
				fallbackToJupiterOnNoRoute: fallbackRequested,
				fallbackApplied,
				routeSource: fallbackApplied ? "jupiter-fallback" : "scoped",
				quote,
				scopedQuote: fallbackApplied ? scopedQuote : undefined,
				swapResponse: swapPayload,
				network,
				jupiterBaseUrl: getJupiterApiBaseUrl(),
				explorerSigner: getExplorerAddressUrl(signerPublicKey, network),
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
		content: [
			{ type: "text", text: `${protocolLabel} swap sent: ${signature}` },
		],
		details: {
			protocol,
			dexes,
			simulated: false,
			signature,
			version,
			signer: signerPublicKey,
			inputMint,
			outputMint,
			amountRaw,
			outAmount: quoteRoute.outAmount,
			routeCount: quoteRoute.routePlan.length,
			swapMode,
			quote,
			scopedQuote: fallbackApplied ? scopedQuote : undefined,
			effectiveDexes: fallbackApplied ? null : dexes,
			fallbackToJupiterOnNoRoute: fallbackRequested,
			fallbackApplied,
			routeSource: fallbackApplied ? "jupiter-fallback" : "scoped",
			swapResponse: swapPayload,
			confirmed: params.confirm !== false,
			network,
			jupiterBaseUrl: getJupiterApiBaseUrl(),
			explorer: getExplorerTransactionUrl(signature, network),
			explorerSigner: getExplorerAddressUrl(signerPublicKey, network),
			explorerInputMint: getExplorerAddressUrl(inputMint, network),
			explorerOutputMint: getExplorerAddressUrl(outputMint, network),
		},
	};
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
			name: `${TOOL_PREFIX}jupiterSwap`,
			label: "Solana Jupiter Swap",
			description:
				"End-to-end Jupiter swap: quote, build transaction, sign, simulate/send, and confirm",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				userPublicKey: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
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
				fallbackToJupiterOnNoRoute: Type.Optional(
					Type.Boolean({
						description:
							"Fallback to unconstrained Jupiter routing if no Orca route is available",
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
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, build/sign and simulate only (no broadcast)",
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
				assertJupiterNetworkSupported(network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error("Mainnet Jupiter swap requires confirmMainnet=true");
				}

				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.userPublicKey) {
					const asserted = new PublicKey(
						normalizeAtPath(params.userPublicKey),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`userPublicKey mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}

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
					userPublicKey: signerPublicKey,
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

				const swapPayload =
					swapResponse && typeof swapResponse === "object"
						? (swapResponse as Record<string, unknown>)
						: {};
				const txBase64 =
					typeof swapPayload.swapTransaction === "string"
						? swapPayload.swapTransaction
						: "";
				if (!txBase64) {
					throw new Error("Jupiter swap response missing swapTransaction");
				}

				const tx = parseTransactionFromBase64(txBase64);
				let version: "legacy" | "v0" = "legacy";
				if (tx instanceof VersionedTransaction) {
					tx.sign([signer]);
					version = "v0";
				} else {
					tx.partialSign(signer);
				}

				const commitment = parseFinality(params.commitment);
				if (params.simulate === true) {
					const simulation =
						tx instanceof VersionedTransaction
							? await connection.simulateTransaction(tx, {
									sigVerify: true,
									replaceRecentBlockhash: false,
									commitment,
								})
							: await connection.simulateTransaction(tx);
					const quotePayload =
						quote && typeof quote === "object"
							? (quote as Record<string, unknown>)
							: {};
					const routePlan = Array.isArray(quotePayload.routePlan)
						? quotePayload.routePlan
						: [];
					const outAmount =
						typeof quotePayload.outAmount === "string"
							? quotePayload.outAmount
							: null;
					return {
						content: [
							{
								type: "text",
								text: `Jupiter simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							simulated: true,
							version,
							inputMint,
							outputMint,
							amountRaw,
							outAmount,
							routeCount: routePlan.length,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							signer: signerPublicKey,
							swapMode,
							quote,
							swapResponse: swapPayload,
							network,
							jupiterBaseUrl: getJupiterApiBaseUrl(),
							explorerSigner: getExplorerAddressUrl(signerPublicKey, network),
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

				const quotePayload =
					quote && typeof quote === "object"
						? (quote as Record<string, unknown>)
						: {};
				const routePlan = Array.isArray(quotePayload.routePlan)
					? quotePayload.routePlan
					: [];
				const outAmount =
					typeof quotePayload.outAmount === "string"
						? quotePayload.outAmount
						: null;
				const priceImpactPct =
					typeof quotePayload.priceImpactPct === "string"
						? quotePayload.priceImpactPct
						: null;
				return {
					content: [{ type: "text", text: `Jupiter swap sent: ${signature}` }],
					details: {
						simulated: false,
						signature,
						version,
						signer: signerPublicKey,
						inputMint,
						outputMint,
						amountRaw,
						outAmount,
						priceImpactPct,
						routeCount: routePlan.length,
						swapMode,
						quote,
						swapResponse: swapPayload,
						confirmed: params.confirm !== false,
						network,
						jupiterBaseUrl: getJupiterApiBaseUrl(),
						explorer: getExplorerTransactionUrl(signature, network),
						explorerSigner: getExplorerAddressUrl(signerPublicKey, network),
						explorerInputMint: getExplorerAddressUrl(inputMint, network),
						explorerOutputMint: getExplorerAddressUrl(outputMint, network),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}orcaSwap`,
			label: "Solana Orca Swap",
			description:
				"End-to-end Orca-scoped swap (via Jupiter with Orca dex filters)",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				userPublicKey: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
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
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, build/sign and simulate only (no broadcast)",
					}),
				),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required when network=mainnet-beta",
					}),
				),
			}),
			async execute(toolCallId, params) {
				void toolCallId;
				return executeScopedJupiterSwap("orca", ORCA_DEFAULT_DEXES, params);
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}meteoraSwap`,
			label: "Solana Meteora Swap",
			description:
				"End-to-end Meteora-scoped swap (via Jupiter with Meteora dex filters)",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				userPublicKey: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
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
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, build/sign and simulate only (no broadcast)",
					}),
				),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required when network=mainnet-beta",
					}),
				),
			}),
			async execute(toolCallId, params) {
				void toolCallId;
				return executeScopedJupiterSwap(
					"meteora",
					METEORA_DEFAULT_DEXES,
					params,
				);
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}raydiumSwap`,
			label: "Solana Raydium Swap",
			description:
				"End-to-end Raydium swap: quote, build transaction(s), sign, simulate/send, and confirm",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				userPublicKey: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
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
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, build/sign and simulate only (no broadcast)",
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
				assertRaydiumNetworkSupported(network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error("Mainnet Raydium swap requires confirmMainnet=true");
				}

				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.userPublicKey) {
					const asserted = new PublicKey(
						normalizeAtPath(params.userPublicKey),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`userPublicKey mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}

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
					wallet: signerPublicKey,
					txVersion,
					swapType,
					quoteResponse: quote,
					computeUnitPriceMicroLamports,
					wrapSol: params.wrapSol,
					unwrapSol: params.unwrapSol,
					inputAccount,
					outputAccount,
				});
				const txBase64List = extractRaydiumTransactions(swapResponse);
				if (txBase64List.length === 0) {
					throw new Error(
						"Raydium swap response missing serialized transaction",
					);
				}

				const signed = txBase64List.map((txBase64) => {
					const tx = parseTransactionFromBase64(txBase64);
					let version: "legacy" | "v0" = "legacy";
					if (tx instanceof VersionedTransaction) {
						tx.sign([signer]);
						version = "v0";
					} else {
						tx.partialSign(signer);
					}
					return { tx, version };
				});

				const commitment = parseFinality(params.commitment);
				if (params.simulate === true) {
					const simulations = [];
					for (const [index, entry] of signed.entries()) {
						const simulation =
							entry.tx instanceof VersionedTransaction
								? await connection.simulateTransaction(entry.tx, {
										sigVerify: true,
										replaceRecentBlockhash: false,
										commitment,
									})
								: await connection.simulateTransaction(entry.tx);
						simulations.push({
							index,
							version: entry.version,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
						});
					}
					const ok = simulations.every((item) => item.err == null);
					return {
						content: [
							{
								type: "text",
								text: `Raydium simulation ${ok ? "succeeded" : "failed"} (${simulations.length} tx)`,
							},
						],
						details: {
							simulated: true,
							ok,
							signer: signerPublicKey,
							txCount: signed.length,
							txVersions: signed.map((item) => item.version),
							inputMint,
							outputMint,
							amountRaw,
							slippageBps: params.slippageBps,
							txVersion,
							swapType,
							computeUnitPriceMicroLamports,
							simulations,
							quote,
							swapResponse,
							autoFeePayload,
							network,
							raydiumApiBaseUrl: getRaydiumApiBaseUrl(),
							explorerSigner: getExplorerAddressUrl(signerPublicKey, network),
						},
					};
				}

				const signatures: string[] = [];
				for (const entry of signed) {
					const signature = await connection.sendRawTransaction(
						entry.tx.serialize(),
						{
							skipPreflight: params.skipPreflight === true,
							maxRetries: params.maxRetries,
						},
					);
					signatures.push(signature);
					if (params.confirm !== false) {
						const confirmation = await connection.confirmTransaction(
							signature,
							commitment,
						);
						if (confirmation.value.err) {
							throw new Error(
								`Transaction confirmed with error: ${stringifyUnknown(confirmation.value.err)}`,
							);
						}
					}
				}
				const signature = signatures[signatures.length - 1] ?? null;
				return {
					content: [
						{
							type: "text",
							text: `Raydium swap sent: ${signature ?? "unknown"} (${signatures.length} tx)`,
						},
					],
					details: {
						simulated: false,
						signature,
						signatures,
						confirmed: params.confirm !== false,
						signer: signerPublicKey,
						txCount: signed.length,
						txVersions: signed.map((item) => item.version),
						inputMint,
						outputMint,
						amountRaw,
						slippageBps: params.slippageBps,
						txVersion,
						swapType,
						computeUnitPriceMicroLamports,
						quote,
						swapResponse,
						autoFeePayload,
						network,
						raydiumApiBaseUrl: getRaydiumApiBaseUrl(),
						explorer: signature
							? getExplorerTransactionUrl(signature, network)
							: null,
						explorerSigner: getExplorerAddressUrl(signerPublicKey, network),
						explorerInputMint: getExplorerAddressUrl(inputMint, network),
						explorerOutputMint: getExplorerAddressUrl(outputMint, network),
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
			name: `${TOOL_PREFIX}orcaIncreaseLiquidity`,
			label: "Solana Orca Increase Liquidity",
			description:
				"Execute an Orca Whirlpool increase-liquidity action with local/private key signer",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				ownerAddress: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
				positionMint: Type.String({
					description: "Orca position mint address",
				}),
				liquidityAmountRaw: Type.Optional(
					Type.String({
						description:
							"Liquidity delta as raw integer. Provide exactly one of liquidityAmountRaw/tokenAAmountRaw/tokenBAmountRaw.",
					}),
				),
				tokenAAmountRaw: Type.Optional(
					Type.String({
						description:
							"Token A amount as raw integer. Provide exactly one of liquidityAmountRaw/tokenAAmountRaw/tokenBAmountRaw.",
					}),
				),
				tokenBAmountRaw: Type.Optional(
					Type.String({
						description:
							"Token B amount as raw integer. Provide exactly one of liquidityAmountRaw/tokenAAmountRaw/tokenBAmountRaw.",
					}),
				),
				slippageBps: Type.Optional(
					Type.Integer({
						minimum: 0,
						maximum: 10_000,
						description: "Slippage tolerance in basis points (default 100)",
					}),
				),
				asLegacyTransaction: Type.Optional(
					Type.Boolean({
						description: "Use legacy transaction when true; v0 when false",
					}),
				),
				network: solanaNetworkSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
					}),
				),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required when network=mainnet-beta",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error(
						"Mainnet Orca increase-liquidity requires confirmMainnet=true",
					);
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.ownerAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.ownerAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`ownerAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const positionMint = new PublicKey(
					normalizeAtPath(params.positionMint),
				).toBase58();
				const build = await buildOrcaIncreaseLiquidityInstructions({
					ownerAddress: signerPublicKey,
					positionMint,
					liquidityAmountRaw: params.liquidityAmountRaw,
					tokenAAmountRaw: params.tokenAAmountRaw,
					tokenBAmountRaw: params.tokenBAmountRaw,
					slippageBps: params.slippageBps,
					network,
				});
				const latestBlockhash = await connection.getLatestBlockhash();
				const asLegacyTransaction = params.asLegacyTransaction !== false;
				const tx = asLegacyTransaction
					? new Transaction().add(...build.instructions)
					: new VersionedTransaction(
							new TransactionMessage({
								payerKey: signer.publicKey,
								recentBlockhash: latestBlockhash.blockhash,
								instructions: build.instructions,
							}).compileToV0Message(),
						);

				let version: "legacy" | "v0" = "legacy";
				if (tx instanceof VersionedTransaction) {
					tx.sign([signer]);
					version = "v0";
				} else {
					tx.feePayer = signer.publicKey;
					tx.recentBlockhash = latestBlockhash.blockhash;
					tx.partialSign(signer);
				}

				const commitment = parseFinality(params.commitment);
				if (params.simulate === true) {
					const simulation =
						tx instanceof VersionedTransaction
							? await connection.simulateTransaction(tx, {
									sigVerify: true,
									replaceRecentBlockhash: false,
									commitment,
								})
							: await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Orca increase-liquidity simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							simulated: true,
							version,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							network,
							signer: signerPublicKey,
							ownerAddress: build.ownerAddress,
							positionMint: build.positionMint,
							quoteParamKind: build.quoteParamKind,
							quoteParamAmountRaw: build.quoteParamAmountRaw,
							slippageBps: build.slippageBps,
							instructionCount: build.instructionCount,
							quote: build.quote,
							signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
							positionMintExplorer: getExplorerAddressUrl(
								build.positionMint,
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
					content: [
						{
							type: "text",
							text: `Orca increase-liquidity sent: ${signature}`,
						},
					],
					details: {
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						version,
						network,
						signer: signerPublicKey,
						ownerAddress: build.ownerAddress,
						positionMint: build.positionMint,
						quoteParamKind: build.quoteParamKind,
						quoteParamAmountRaw: build.quoteParamAmountRaw,
						slippageBps: build.slippageBps,
						instructionCount: build.instructionCount,
						quote: build.quote,
						explorer: getExplorerTransactionUrl(signature, network),
						signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
						positionMintExplorer: getExplorerAddressUrl(
							build.positionMint,
							network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}orcaDecreaseLiquidity`,
			label: "Solana Orca Decrease Liquidity",
			description:
				"Execute an Orca Whirlpool decrease-liquidity action with local/private key signer",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				ownerAddress: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
				positionMint: Type.String({
					description: "Orca position mint address",
				}),
				liquidityAmountRaw: Type.Optional(
					Type.String({
						description:
							"Liquidity delta as raw integer. Provide exactly one of liquidityAmountRaw/tokenAAmountRaw/tokenBAmountRaw.",
					}),
				),
				tokenAAmountRaw: Type.Optional(
					Type.String({
						description:
							"Token A amount as raw integer. Provide exactly one of liquidityAmountRaw/tokenAAmountRaw/tokenBAmountRaw.",
					}),
				),
				tokenBAmountRaw: Type.Optional(
					Type.String({
						description:
							"Token B amount as raw integer. Provide exactly one of liquidityAmountRaw/tokenAAmountRaw/tokenBAmountRaw.",
					}),
				),
				slippageBps: Type.Optional(
					Type.Integer({
						minimum: 0,
						maximum: 10_000,
						description: "Slippage tolerance in basis points (default 100)",
					}),
				),
				asLegacyTransaction: Type.Optional(
					Type.Boolean({
						description: "Use legacy transaction when true; v0 when false",
					}),
				),
				network: solanaNetworkSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
					}),
				),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required when network=mainnet-beta",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error(
						"Mainnet Orca decrease-liquidity requires confirmMainnet=true",
					);
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.ownerAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.ownerAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`ownerAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const positionMint = new PublicKey(
					normalizeAtPath(params.positionMint),
				).toBase58();
				const build = await buildOrcaDecreaseLiquidityInstructions({
					ownerAddress: signerPublicKey,
					positionMint,
					liquidityAmountRaw: params.liquidityAmountRaw,
					tokenAAmountRaw: params.tokenAAmountRaw,
					tokenBAmountRaw: params.tokenBAmountRaw,
					slippageBps: params.slippageBps,
					network,
				});
				const latestBlockhash = await connection.getLatestBlockhash();
				const asLegacyTransaction = params.asLegacyTransaction !== false;
				const tx = asLegacyTransaction
					? new Transaction().add(...build.instructions)
					: new VersionedTransaction(
							new TransactionMessage({
								payerKey: signer.publicKey,
								recentBlockhash: latestBlockhash.blockhash,
								instructions: build.instructions,
							}).compileToV0Message(),
						);

				let version: "legacy" | "v0" = "legacy";
				if (tx instanceof VersionedTransaction) {
					tx.sign([signer]);
					version = "v0";
				} else {
					tx.feePayer = signer.publicKey;
					tx.recentBlockhash = latestBlockhash.blockhash;
					tx.partialSign(signer);
				}

				const commitment = parseFinality(params.commitment);
				if (params.simulate === true) {
					const simulation =
						tx instanceof VersionedTransaction
							? await connection.simulateTransaction(tx, {
									sigVerify: true,
									replaceRecentBlockhash: false,
									commitment,
								})
							: await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Orca decrease-liquidity simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							simulated: true,
							version,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							network,
							signer: signerPublicKey,
							ownerAddress: build.ownerAddress,
							positionMint: build.positionMint,
							quoteParamKind: build.quoteParamKind,
							quoteParamAmountRaw: build.quoteParamAmountRaw,
							slippageBps: build.slippageBps,
							instructionCount: build.instructionCount,
							quote: build.quote,
							signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
							positionMintExplorer: getExplorerAddressUrl(
								build.positionMint,
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
					content: [
						{
							type: "text",
							text: `Orca decrease-liquidity sent: ${signature}`,
						},
					],
					details: {
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						version,
						network,
						signer: signerPublicKey,
						ownerAddress: build.ownerAddress,
						positionMint: build.positionMint,
						quoteParamKind: build.quoteParamKind,
						quoteParamAmountRaw: build.quoteParamAmountRaw,
						slippageBps: build.slippageBps,
						instructionCount: build.instructionCount,
						quote: build.quote,
						explorer: getExplorerTransactionUrl(signature, network),
						signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
						positionMintExplorer: getExplorerAddressUrl(
							build.positionMint,
							network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}kaminoDeposit`,
			label: "Solana Kamino Deposit",
			description:
				"Execute a Kamino lending deposit with local/private key signer",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				ownerAddress: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
				reserveMint: Type.String({
					description: "Liquidity mint to deposit into Kamino reserve",
				}),
				amountRaw: Type.String({
					description: "Deposit amount in raw integer base units",
				}),
				marketAddress: Type.Optional(
					Type.String({
						description:
							"Optional Kamino market address. Defaults to main market on mainnet-beta.",
					}),
				),
				programId: Type.Optional(
					Type.String({
						description:
							"Optional Kamino lending program id. Defaults to official KLend program.",
					}),
				),
				useV2Ixs: Type.Optional(
					Type.Boolean({
						description: "Use V2 lending instructions (default true)",
					}),
				),
				includeAtaIxs: Type.Optional(
					Type.Boolean({
						description: "Include token ATA setup instructions (default true)",
					}),
				),
				extraComputeUnits: Type.Optional(
					Type.Integer({
						minimum: 0,
						maximum: 2_000_000,
						description:
							"Optional compute unit limit for Kamino action (default 1000000)",
					}),
				),
				requestElevationGroup: Type.Optional(
					Type.Boolean({
						description:
							"Request elevation group before deposit (default false)",
					}),
				),
				asLegacyTransaction: Type.Optional(
					Type.Boolean({
						description: "Use legacy transaction when true; v0 when false",
					}),
				),
				network: solanaNetworkSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
					}),
				),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required when network=mainnet-beta",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error(
						"Mainnet Kamino deposit requires confirmMainnet=true",
					);
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.ownerAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.ownerAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`ownerAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const reserveMint = new PublicKey(
					normalizeAtPath(params.reserveMint),
				).toBase58();
				const build = await buildKaminoDepositInstructions({
					ownerAddress: signerPublicKey,
					reserveMint,
					amountRaw: params.amountRaw,
					marketAddress: params.marketAddress,
					programId: params.programId,
					useV2Ixs: params.useV2Ixs,
					includeAtaIxs: params.includeAtaIxs,
					extraComputeUnits: params.extraComputeUnits,
					requestElevationGroup: params.requestElevationGroup,
					network,
				});
				const latestBlockhash = await connection.getLatestBlockhash();
				const asLegacyTransaction = params.asLegacyTransaction !== false;
				const tx = asLegacyTransaction
					? new Transaction().add(...build.instructions)
					: new VersionedTransaction(
							new TransactionMessage({
								payerKey: signer.publicKey,
								recentBlockhash: latestBlockhash.blockhash,
								instructions: build.instructions,
							}).compileToV0Message(),
						);

				let version: "legacy" | "v0" = "legacy";
				if (tx instanceof VersionedTransaction) {
					tx.sign([signer]);
					version = "v0";
				} else {
					tx.feePayer = signer.publicKey;
					tx.recentBlockhash = latestBlockhash.blockhash;
					tx.partialSign(signer);
				}

				const commitment = parseFinality(params.commitment);
				if (params.simulate === true) {
					const simulation =
						tx instanceof VersionedTransaction
							? await connection.simulateTransaction(tx, {
									sigVerify: true,
									replaceRecentBlockhash: false,
									commitment,
								})
							: await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Kamino deposit simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							simulated: true,
							version,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							network,
							signer: signerPublicKey,
							ownerAddress: build.ownerAddress,
							marketAddress: build.marketAddress,
							programId: build.programId,
							reserveMint: build.reserveMint,
							reserveAddress: build.reserveAddress,
							reserveSymbol: build.reserveSymbol,
							amountRaw: build.amountRaw,
							obligationAddress: build.obligationAddress,
							instructionCount: build.instructionCount,
							setupInstructionCount: build.setupInstructionCount,
							lendingInstructionCount: build.lendingInstructionCount,
							cleanupInstructionCount: build.cleanupInstructionCount,
							setupInstructionLabels: build.setupInstructionLabels,
							lendingInstructionLabels: build.lendingInstructionLabels,
							cleanupInstructionLabels: build.cleanupInstructionLabels,
							signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
							marketExplorer: getExplorerAddressUrl(
								build.marketAddress,
								network,
							),
							reserveMintExplorer: getExplorerAddressUrl(
								build.reserveMint,
								network,
							),
							obligationExplorer: getExplorerAddressUrl(
								build.obligationAddress,
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
					content: [
						{ type: "text", text: `Kamino deposit sent: ${signature}` },
					],
					details: {
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						version,
						network,
						signer: signerPublicKey,
						ownerAddress: build.ownerAddress,
						marketAddress: build.marketAddress,
						programId: build.programId,
						reserveMint: build.reserveMint,
						reserveAddress: build.reserveAddress,
						reserveSymbol: build.reserveSymbol,
						amountRaw: build.amountRaw,
						obligationAddress: build.obligationAddress,
						instructionCount: build.instructionCount,
						setupInstructionCount: build.setupInstructionCount,
						lendingInstructionCount: build.lendingInstructionCount,
						cleanupInstructionCount: build.cleanupInstructionCount,
						setupInstructionLabels: build.setupInstructionLabels,
						lendingInstructionLabels: build.lendingInstructionLabels,
						cleanupInstructionLabels: build.cleanupInstructionLabels,
						explorer: getExplorerTransactionUrl(signature, network),
						signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
						marketExplorer: getExplorerAddressUrl(build.marketAddress, network),
						reserveMintExplorer: getExplorerAddressUrl(
							build.reserveMint,
							network,
						),
						obligationExplorer: getExplorerAddressUrl(
							build.obligationAddress,
							network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}kaminoWithdraw`,
			label: "Solana Kamino Withdraw",
			description:
				"Execute a Kamino lending withdraw with local/private key signer",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				ownerAddress: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
				reserveMint: Type.String({
					description: "Liquidity mint to withdraw from Kamino reserve",
				}),
				amountRaw: Type.String({
					description: "Withdraw amount in raw integer base units",
				}),
				marketAddress: Type.Optional(
					Type.String({
						description:
							"Optional Kamino market address. Defaults to main market on mainnet-beta.",
					}),
				),
				programId: Type.Optional(
					Type.String({
						description:
							"Optional Kamino lending program id. Defaults to official KLend program.",
					}),
				),
				useV2Ixs: Type.Optional(
					Type.Boolean({
						description: "Use V2 lending instructions (default true)",
					}),
				),
				includeAtaIxs: Type.Optional(
					Type.Boolean({
						description: "Include token ATA setup instructions (default true)",
					}),
				),
				extraComputeUnits: Type.Optional(
					Type.Integer({
						minimum: 0,
						maximum: 2_000_000,
						description:
							"Optional compute unit limit for Kamino action (default 1000000)",
					}),
				),
				requestElevationGroup: Type.Optional(
					Type.Boolean({
						description:
							"Request elevation group after withdraw (default false)",
					}),
				),
				asLegacyTransaction: Type.Optional(
					Type.Boolean({
						description: "Use legacy transaction when true; v0 when false",
					}),
				),
				network: solanaNetworkSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
					}),
				),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required when network=mainnet-beta",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error(
						"Mainnet Kamino withdraw requires confirmMainnet=true",
					);
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.ownerAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.ownerAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`ownerAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const reserveMint = new PublicKey(
					normalizeAtPath(params.reserveMint),
				).toBase58();
				const build = await buildKaminoWithdrawInstructions({
					ownerAddress: signerPublicKey,
					reserveMint,
					amountRaw: params.amountRaw,
					marketAddress: params.marketAddress,
					programId: params.programId,
					useV2Ixs: params.useV2Ixs,
					includeAtaIxs: params.includeAtaIxs,
					extraComputeUnits: params.extraComputeUnits,
					requestElevationGroup: params.requestElevationGroup,
					network,
				});
				const latestBlockhash = await connection.getLatestBlockhash();
				const asLegacyTransaction = params.asLegacyTransaction !== false;
				const tx = asLegacyTransaction
					? new Transaction().add(...build.instructions)
					: new VersionedTransaction(
							new TransactionMessage({
								payerKey: signer.publicKey,
								recentBlockhash: latestBlockhash.blockhash,
								instructions: build.instructions,
							}).compileToV0Message(),
						);

				let version: "legacy" | "v0" = "legacy";
				if (tx instanceof VersionedTransaction) {
					tx.sign([signer]);
					version = "v0";
				} else {
					tx.feePayer = signer.publicKey;
					tx.recentBlockhash = latestBlockhash.blockhash;
					tx.partialSign(signer);
				}

				const commitment = parseFinality(params.commitment);
				if (params.simulate === true) {
					const simulation =
						tx instanceof VersionedTransaction
							? await connection.simulateTransaction(tx, {
									sigVerify: true,
									replaceRecentBlockhash: false,
									commitment,
								})
							: await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Kamino withdraw simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							simulated: true,
							version,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							network,
							signer: signerPublicKey,
							ownerAddress: build.ownerAddress,
							marketAddress: build.marketAddress,
							programId: build.programId,
							reserveMint: build.reserveMint,
							reserveAddress: build.reserveAddress,
							reserveSymbol: build.reserveSymbol,
							amountRaw: build.amountRaw,
							obligationAddress: build.obligationAddress,
							instructionCount: build.instructionCount,
							setupInstructionCount: build.setupInstructionCount,
							lendingInstructionCount: build.lendingInstructionCount,
							cleanupInstructionCount: build.cleanupInstructionCount,
							setupInstructionLabels: build.setupInstructionLabels,
							lendingInstructionLabels: build.lendingInstructionLabels,
							cleanupInstructionLabels: build.cleanupInstructionLabels,
							signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
							marketExplorer: getExplorerAddressUrl(
								build.marketAddress,
								network,
							),
							reserveMintExplorer: getExplorerAddressUrl(
								build.reserveMint,
								network,
							),
							obligationExplorer: getExplorerAddressUrl(
								build.obligationAddress,
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
					content: [
						{ type: "text", text: `Kamino withdraw sent: ${signature}` },
					],
					details: {
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						version,
						network,
						signer: signerPublicKey,
						ownerAddress: build.ownerAddress,
						marketAddress: build.marketAddress,
						programId: build.programId,
						reserveMint: build.reserveMint,
						reserveAddress: build.reserveAddress,
						reserveSymbol: build.reserveSymbol,
						amountRaw: build.amountRaw,
						obligationAddress: build.obligationAddress,
						instructionCount: build.instructionCount,
						setupInstructionCount: build.setupInstructionCount,
						lendingInstructionCount: build.lendingInstructionCount,
						cleanupInstructionCount: build.cleanupInstructionCount,
						setupInstructionLabels: build.setupInstructionLabels,
						lendingInstructionLabels: build.lendingInstructionLabels,
						cleanupInstructionLabels: build.cleanupInstructionLabels,
						explorer: getExplorerTransactionUrl(signature, network),
						signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
						marketExplorer: getExplorerAddressUrl(build.marketAddress, network),
						reserveMintExplorer: getExplorerAddressUrl(
							build.reserveMint,
							network,
						),
						obligationExplorer: getExplorerAddressUrl(
							build.obligationAddress,
							network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}kaminoBorrow`,
			label: "Solana Kamino Borrow",
			description:
				"Execute a Kamino lending borrow with local/private key signer",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				ownerAddress: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
				reserveMint: Type.String({
					description: "Liquidity mint to borrow from Kamino reserve",
				}),
				amountRaw: Type.String({
					description: "Borrow amount in raw integer base units",
				}),
				marketAddress: Type.Optional(
					Type.String({
						description:
							"Optional Kamino market address. Defaults to main market on mainnet-beta.",
					}),
				),
				programId: Type.Optional(
					Type.String({
						description:
							"Optional Kamino lending program id. Defaults to official KLend program.",
					}),
				),
				useV2Ixs: Type.Optional(
					Type.Boolean({
						description: "Use V2 lending instructions (default true)",
					}),
				),
				includeAtaIxs: Type.Optional(
					Type.Boolean({
						description: "Include token ATA setup instructions (default true)",
					}),
				),
				extraComputeUnits: Type.Optional(
					Type.Integer({
						minimum: 0,
						maximum: 2_000_000,
						description:
							"Optional compute unit limit for Kamino action (default 1000000)",
					}),
				),
				requestElevationGroup: Type.Optional(
					Type.Boolean({
						description:
							"Request elevation group before borrow (default false)",
					}),
				),
				asLegacyTransaction: Type.Optional(
					Type.Boolean({
						description: "Use legacy transaction when true; v0 when false",
					}),
				),
				network: solanaNetworkSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
					}),
				),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required when network=mainnet-beta",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error("Mainnet Kamino borrow requires confirmMainnet=true");
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.ownerAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.ownerAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`ownerAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const reserveMint = new PublicKey(
					normalizeAtPath(params.reserveMint),
				).toBase58();
				const build = await buildKaminoBorrowInstructions({
					ownerAddress: signerPublicKey,
					reserveMint,
					amountRaw: params.amountRaw,
					marketAddress: params.marketAddress,
					programId: params.programId,
					useV2Ixs: params.useV2Ixs,
					includeAtaIxs: params.includeAtaIxs,
					extraComputeUnits: params.extraComputeUnits,
					requestElevationGroup: params.requestElevationGroup,
					network,
				});
				const latestBlockhash = await connection.getLatestBlockhash();
				const asLegacyTransaction = params.asLegacyTransaction !== false;
				const tx = asLegacyTransaction
					? new Transaction().add(...build.instructions)
					: new VersionedTransaction(
							new TransactionMessage({
								payerKey: signer.publicKey,
								recentBlockhash: latestBlockhash.blockhash,
								instructions: build.instructions,
							}).compileToV0Message(),
						);

				let version: "legacy" | "v0" = "legacy";
				if (tx instanceof VersionedTransaction) {
					tx.sign([signer]);
					version = "v0";
				} else {
					tx.feePayer = signer.publicKey;
					tx.recentBlockhash = latestBlockhash.blockhash;
					tx.partialSign(signer);
				}

				const commitment = parseFinality(params.commitment);
				if (params.simulate === true) {
					const simulation =
						tx instanceof VersionedTransaction
							? await connection.simulateTransaction(tx, {
									sigVerify: true,
									replaceRecentBlockhash: false,
									commitment,
								})
							: await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Kamino borrow simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							simulated: true,
							version,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							network,
							signer: signerPublicKey,
							ownerAddress: build.ownerAddress,
							marketAddress: build.marketAddress,
							programId: build.programId,
							reserveMint: build.reserveMint,
							reserveAddress: build.reserveAddress,
							reserveSymbol: build.reserveSymbol,
							amountRaw: build.amountRaw,
							obligationAddress: build.obligationAddress,
							instructionCount: build.instructionCount,
							setupInstructionCount: build.setupInstructionCount,
							lendingInstructionCount: build.lendingInstructionCount,
							cleanupInstructionCount: build.cleanupInstructionCount,
							setupInstructionLabels: build.setupInstructionLabels,
							lendingInstructionLabels: build.lendingInstructionLabels,
							cleanupInstructionLabels: build.cleanupInstructionLabels,
							signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
							marketExplorer: getExplorerAddressUrl(
								build.marketAddress,
								network,
							),
							reserveMintExplorer: getExplorerAddressUrl(
								build.reserveMint,
								network,
							),
							obligationExplorer: getExplorerAddressUrl(
								build.obligationAddress,
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
					content: [{ type: "text", text: `Kamino borrow sent: ${signature}` }],
					details: {
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						version,
						network,
						signer: signerPublicKey,
						ownerAddress: build.ownerAddress,
						marketAddress: build.marketAddress,
						programId: build.programId,
						reserveMint: build.reserveMint,
						reserveAddress: build.reserveAddress,
						reserveSymbol: build.reserveSymbol,
						amountRaw: build.amountRaw,
						obligationAddress: build.obligationAddress,
						instructionCount: build.instructionCount,
						setupInstructionCount: build.setupInstructionCount,
						lendingInstructionCount: build.lendingInstructionCount,
						cleanupInstructionCount: build.cleanupInstructionCount,
						setupInstructionLabels: build.setupInstructionLabels,
						lendingInstructionLabels: build.lendingInstructionLabels,
						cleanupInstructionLabels: build.cleanupInstructionLabels,
						explorer: getExplorerTransactionUrl(signature, network),
						signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
						marketExplorer: getExplorerAddressUrl(build.marketAddress, network),
						reserveMintExplorer: getExplorerAddressUrl(
							build.reserveMint,
							network,
						),
						obligationExplorer: getExplorerAddressUrl(
							build.obligationAddress,
							network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}kaminoRepay`,
			label: "Solana Kamino Repay",
			description:
				"Execute a Kamino lending repay with local/private key signer",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				ownerAddress: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
				reserveMint: Type.String({
					description: "Liquidity mint to repay into Kamino reserve",
				}),
				amountRaw: Type.String({
					description: "Repay amount in raw integer base units",
				}),
				marketAddress: Type.Optional(
					Type.String({
						description:
							"Optional Kamino market address. Defaults to main market on mainnet-beta.",
					}),
				),
				programId: Type.Optional(
					Type.String({
						description:
							"Optional Kamino lending program id. Defaults to official KLend program.",
					}),
				),
				useV2Ixs: Type.Optional(
					Type.Boolean({
						description: "Use V2 lending instructions (default true)",
					}),
				),
				includeAtaIxs: Type.Optional(
					Type.Boolean({
						description: "Include token ATA setup instructions (default true)",
					}),
				),
				extraComputeUnits: Type.Optional(
					Type.Integer({
						minimum: 0,
						maximum: 2_000_000,
						description:
							"Optional compute unit limit for Kamino action (default 1000000)",
					}),
				),
				requestElevationGroup: Type.Optional(
					Type.Boolean({
						description: "Request elevation group after repay (default false)",
					}),
				),
				currentSlot: Type.Optional(
					Type.String({
						description:
							"Optional slot override for repay instruction build. Defaults to current RPC slot.",
					}),
				),
				asLegacyTransaction: Type.Optional(
					Type.Boolean({
						description: "Use legacy transaction when true; v0 when false",
					}),
				),
				network: solanaNetworkSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
					}),
				),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required when network=mainnet-beta",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error("Mainnet Kamino repay requires confirmMainnet=true");
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.ownerAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.ownerAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`ownerAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const reserveMint = new PublicKey(
					normalizeAtPath(params.reserveMint),
				).toBase58();
				const build = await buildKaminoRepayInstructions({
					ownerAddress: signerPublicKey,
					reserveMint,
					amountRaw: params.amountRaw,
					marketAddress: params.marketAddress,
					programId: params.programId,
					useV2Ixs: params.useV2Ixs,
					includeAtaIxs: params.includeAtaIxs,
					extraComputeUnits: params.extraComputeUnits,
					requestElevationGroup: params.requestElevationGroup,
					currentSlot: params.currentSlot,
					network,
				});
				const latestBlockhash = await connection.getLatestBlockhash();
				const asLegacyTransaction = params.asLegacyTransaction !== false;
				const tx = asLegacyTransaction
					? new Transaction().add(...build.instructions)
					: new VersionedTransaction(
							new TransactionMessage({
								payerKey: signer.publicKey,
								recentBlockhash: latestBlockhash.blockhash,
								instructions: build.instructions,
							}).compileToV0Message(),
						);

				let version: "legacy" | "v0" = "legacy";
				if (tx instanceof VersionedTransaction) {
					tx.sign([signer]);
					version = "v0";
				} else {
					tx.feePayer = signer.publicKey;
					tx.recentBlockhash = latestBlockhash.blockhash;
					tx.partialSign(signer);
				}

				const commitment = parseFinality(params.commitment);
				if (params.simulate === true) {
					const simulation =
						tx instanceof VersionedTransaction
							? await connection.simulateTransaction(tx, {
									sigVerify: true,
									replaceRecentBlockhash: false,
									commitment,
								})
							: await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Kamino repay simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							simulated: true,
							version,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							network,
							signer: signerPublicKey,
							ownerAddress: build.ownerAddress,
							marketAddress: build.marketAddress,
							programId: build.programId,
							reserveMint: build.reserveMint,
							reserveAddress: build.reserveAddress,
							reserveSymbol: build.reserveSymbol,
							amountRaw: build.amountRaw,
							currentSlot: build.currentSlot,
							obligationAddress: build.obligationAddress,
							instructionCount: build.instructionCount,
							setupInstructionCount: build.setupInstructionCount,
							lendingInstructionCount: build.lendingInstructionCount,
							cleanupInstructionCount: build.cleanupInstructionCount,
							setupInstructionLabels: build.setupInstructionLabels,
							lendingInstructionLabels: build.lendingInstructionLabels,
							cleanupInstructionLabels: build.cleanupInstructionLabels,
							signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
							marketExplorer: getExplorerAddressUrl(
								build.marketAddress,
								network,
							),
							reserveMintExplorer: getExplorerAddressUrl(
								build.reserveMint,
								network,
							),
							obligationExplorer: getExplorerAddressUrl(
								build.obligationAddress,
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
					content: [{ type: "text", text: `Kamino repay sent: ${signature}` }],
					details: {
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						version,
						network,
						signer: signerPublicKey,
						ownerAddress: build.ownerAddress,
						marketAddress: build.marketAddress,
						programId: build.programId,
						reserveMint: build.reserveMint,
						reserveAddress: build.reserveAddress,
						reserveSymbol: build.reserveSymbol,
						amountRaw: build.amountRaw,
						currentSlot: build.currentSlot,
						obligationAddress: build.obligationAddress,
						instructionCount: build.instructionCount,
						setupInstructionCount: build.setupInstructionCount,
						lendingInstructionCount: build.lendingInstructionCount,
						cleanupInstructionCount: build.cleanupInstructionCount,
						setupInstructionLabels: build.setupInstructionLabels,
						lendingInstructionLabels: build.lendingInstructionLabels,
						cleanupInstructionLabels: build.cleanupInstructionLabels,
						explorer: getExplorerTransactionUrl(signature, network),
						signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
						marketExplorer: getExplorerAddressUrl(build.marketAddress, network),
						reserveMintExplorer: getExplorerAddressUrl(
							build.reserveMint,
							network,
						),
						obligationExplorer: getExplorerAddressUrl(
							build.obligationAddress,
							network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}kaminoDepositAndBorrow`,
			label: "Solana Kamino Deposit+Borrow",
			description:
				"Execute a Kamino lending deposit+borrow with local/private key signer",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				ownerAddress: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
				depositReserveMint: Type.String({
					description: "Liquidity mint to deposit into Kamino reserve",
				}),
				depositAmountRaw: Type.String({
					description: "Deposit amount in raw integer base units",
				}),
				borrowReserveMint: Type.String({
					description: "Liquidity mint to borrow from Kamino reserve",
				}),
				borrowAmountRaw: Type.String({
					description: "Borrow amount in raw integer base units",
				}),
				marketAddress: Type.Optional(
					Type.String({
						description:
							"Optional Kamino market address. Defaults to main market on mainnet-beta.",
					}),
				),
				programId: Type.Optional(
					Type.String({
						description:
							"Optional Kamino lending program id. Defaults to official KLend program.",
					}),
				),
				useV2Ixs: Type.Optional(
					Type.Boolean({
						description: "Use V2 lending instructions (default true)",
					}),
				),
				includeAtaIxs: Type.Optional(
					Type.Boolean({
						description: "Include token ATA setup instructions (default true)",
					}),
				),
				extraComputeUnits: Type.Optional(
					Type.Integer({
						minimum: 0,
						maximum: 2_000_000,
						description:
							"Optional compute unit limit for Kamino action (default 1000000)",
					}),
				),
				requestElevationGroup: Type.Optional(
					Type.Boolean({
						description:
							"Request elevation group before deposit+borrow (default false)",
					}),
				),
				asLegacyTransaction: Type.Optional(
					Type.Boolean({
						description: "Use legacy transaction when true; v0 when false",
					}),
				),
				network: solanaNetworkSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
					}),
				),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required when network=mainnet-beta",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error(
						"Mainnet Kamino deposit+borrow requires confirmMainnet=true",
					);
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.ownerAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.ownerAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`ownerAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const depositReserveMint = new PublicKey(
					normalizeAtPath(params.depositReserveMint),
				).toBase58();
				const borrowReserveMint = new PublicKey(
					normalizeAtPath(params.borrowReserveMint),
				).toBase58();
				const build = await buildKaminoDepositAndBorrowInstructions({
					ownerAddress: signerPublicKey,
					depositReserveMint,
					depositAmountRaw: params.depositAmountRaw,
					borrowReserveMint,
					borrowAmountRaw: params.borrowAmountRaw,
					marketAddress: params.marketAddress,
					programId: params.programId,
					useV2Ixs: params.useV2Ixs,
					includeAtaIxs: params.includeAtaIxs,
					extraComputeUnits: params.extraComputeUnits,
					requestElevationGroup: params.requestElevationGroup,
					network,
				});
				const latestBlockhash = await connection.getLatestBlockhash();
				const asLegacyTransaction = params.asLegacyTransaction !== false;
				const tx = asLegacyTransaction
					? new Transaction().add(...build.instructions)
					: new VersionedTransaction(
							new TransactionMessage({
								payerKey: signer.publicKey,
								recentBlockhash: latestBlockhash.blockhash,
								instructions: build.instructions,
							}).compileToV0Message(),
						);

				let version: "legacy" | "v0" = "legacy";
				if (tx instanceof VersionedTransaction) {
					tx.sign([signer]);
					version = "v0";
				} else {
					tx.feePayer = signer.publicKey;
					tx.recentBlockhash = latestBlockhash.blockhash;
					tx.partialSign(signer);
				}

				const commitment = parseFinality(params.commitment);
				if (params.simulate === true) {
					const simulation =
						tx instanceof VersionedTransaction
							? await connection.simulateTransaction(tx, {
									sigVerify: true,
									replaceRecentBlockhash: false,
									commitment,
								})
							: await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Kamino deposit+borrow simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							simulated: true,
							version,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							network,
							signer: signerPublicKey,
							ownerAddress: build.ownerAddress,
							marketAddress: build.marketAddress,
							programId: build.programId,
							depositReserveMint: build.depositReserveMint,
							depositReserveAddress: build.depositReserveAddress,
							depositReserveSymbol: build.depositReserveSymbol,
							depositAmountRaw: build.depositAmountRaw,
							borrowReserveMint: build.borrowReserveMint,
							borrowReserveAddress: build.borrowReserveAddress,
							borrowReserveSymbol: build.borrowReserveSymbol,
							borrowAmountRaw: build.borrowAmountRaw,
							obligationAddress: build.obligationAddress,
							instructionCount: build.instructionCount,
							setupInstructionCount: build.setupInstructionCount,
							lendingInstructionCount: build.lendingInstructionCount,
							cleanupInstructionCount: build.cleanupInstructionCount,
							setupInstructionLabels: build.setupInstructionLabels,
							lendingInstructionLabels: build.lendingInstructionLabels,
							cleanupInstructionLabels: build.cleanupInstructionLabels,
							signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
							marketExplorer: getExplorerAddressUrl(
								build.marketAddress,
								network,
							),
							depositReserveMintExplorer: getExplorerAddressUrl(
								build.depositReserveMint,
								network,
							),
							borrowReserveMintExplorer: getExplorerAddressUrl(
								build.borrowReserveMint,
								network,
							),
							obligationExplorer: getExplorerAddressUrl(
								build.obligationAddress,
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
					content: [
						{
							type: "text",
							text: `Kamino deposit+borrow sent: ${signature}`,
						},
					],
					details: {
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						version,
						network,
						signer: signerPublicKey,
						ownerAddress: build.ownerAddress,
						marketAddress: build.marketAddress,
						programId: build.programId,
						depositReserveMint: build.depositReserveMint,
						depositReserveAddress: build.depositReserveAddress,
						depositReserveSymbol: build.depositReserveSymbol,
						depositAmountRaw: build.depositAmountRaw,
						borrowReserveMint: build.borrowReserveMint,
						borrowReserveAddress: build.borrowReserveAddress,
						borrowReserveSymbol: build.borrowReserveSymbol,
						borrowAmountRaw: build.borrowAmountRaw,
						obligationAddress: build.obligationAddress,
						instructionCount: build.instructionCount,
						setupInstructionCount: build.setupInstructionCount,
						lendingInstructionCount: build.lendingInstructionCount,
						cleanupInstructionCount: build.cleanupInstructionCount,
						setupInstructionLabels: build.setupInstructionLabels,
						lendingInstructionLabels: build.lendingInstructionLabels,
						cleanupInstructionLabels: build.cleanupInstructionLabels,
						explorer: getExplorerTransactionUrl(signature, network),
						signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
						marketExplorer: getExplorerAddressUrl(build.marketAddress, network),
						depositReserveMintExplorer: getExplorerAddressUrl(
							build.depositReserveMint,
							network,
						),
						borrowReserveMintExplorer: getExplorerAddressUrl(
							build.borrowReserveMint,
							network,
						),
						obligationExplorer: getExplorerAddressUrl(
							build.obligationAddress,
							network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}kaminoRepayAndWithdraw`,
			label: "Solana Kamino Repay+Withdraw",
			description:
				"Execute a Kamino lending repay+withdraw with local/private key signer",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				ownerAddress: Type.Optional(
					Type.String({
						description:
							"Optional signer pubkey assertion. If set, must match derived key from fromSecretKey.",
					}),
				),
				repayReserveMint: Type.String({
					description: "Liquidity mint to repay into Kamino reserve",
				}),
				repayAmountRaw: Type.String({
					description: "Repay amount in raw integer base units",
				}),
				withdrawReserveMint: Type.String({
					description: "Liquidity mint to withdraw from Kamino reserve",
				}),
				withdrawAmountRaw: Type.String({
					description: "Withdraw amount in raw integer base units",
				}),
				currentSlot: Type.Optional(
					Type.String({
						description:
							"Optional slot override for repay+withdraw instruction build. Defaults to current RPC slot.",
					}),
				),
				marketAddress: Type.Optional(
					Type.String({
						description:
							"Optional Kamino market address. Defaults to main market on mainnet-beta.",
					}),
				),
				programId: Type.Optional(
					Type.String({
						description:
							"Optional Kamino lending program id. Defaults to official KLend program.",
					}),
				),
				useV2Ixs: Type.Optional(
					Type.Boolean({
						description: "Use V2 lending instructions (default true)",
					}),
				),
				includeAtaIxs: Type.Optional(
					Type.Boolean({
						description: "Include token ATA setup instructions (default true)",
					}),
				),
				extraComputeUnits: Type.Optional(
					Type.Integer({
						minimum: 0,
						maximum: 2_000_000,
						description:
							"Optional compute unit limit for Kamino action (default 1000000)",
					}),
				),
				requestElevationGroup: Type.Optional(
					Type.Boolean({
						description:
							"Request elevation group after repay+withdraw (default false)",
					}),
				),
				asLegacyTransaction: Type.Optional(
					Type.Boolean({
						description: "Use legacy transaction when true; v0 when false",
					}),
				),
				network: solanaNetworkSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
					}),
				),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required when network=mainnet-beta",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseNetwork(params.network);
				if (network === "mainnet-beta" && params.confirmMainnet !== true) {
					throw new Error(
						"Mainnet Kamino repay+withdraw requires confirmMainnet=true",
					);
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.ownerAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.ownerAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`ownerAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const repayReserveMint = new PublicKey(
					normalizeAtPath(params.repayReserveMint),
				).toBase58();
				const withdrawReserveMint = new PublicKey(
					normalizeAtPath(params.withdrawReserveMint),
				).toBase58();
				const build = await buildKaminoRepayAndWithdrawInstructions({
					ownerAddress: signerPublicKey,
					repayReserveMint,
					repayAmountRaw: params.repayAmountRaw,
					withdrawReserveMint,
					withdrawAmountRaw: params.withdrawAmountRaw,
					currentSlot: params.currentSlot,
					marketAddress: params.marketAddress,
					programId: params.programId,
					useV2Ixs: params.useV2Ixs,
					includeAtaIxs: params.includeAtaIxs,
					extraComputeUnits: params.extraComputeUnits,
					requestElevationGroup: params.requestElevationGroup,
					network,
				});
				const latestBlockhash = await connection.getLatestBlockhash();
				const asLegacyTransaction = params.asLegacyTransaction !== false;
				const tx = asLegacyTransaction
					? new Transaction().add(...build.instructions)
					: new VersionedTransaction(
							new TransactionMessage({
								payerKey: signer.publicKey,
								recentBlockhash: latestBlockhash.blockhash,
								instructions: build.instructions,
							}).compileToV0Message(),
						);

				let version: "legacy" | "v0" = "legacy";
				if (tx instanceof VersionedTransaction) {
					tx.sign([signer]);
					version = "v0";
				} else {
					tx.feePayer = signer.publicKey;
					tx.recentBlockhash = latestBlockhash.blockhash;
					tx.partialSign(signer);
				}

				const commitment = parseFinality(params.commitment);
				if (params.simulate === true) {
					const simulation =
						tx instanceof VersionedTransaction
							? await connection.simulateTransaction(tx, {
									sigVerify: true,
									replaceRecentBlockhash: false,
									commitment,
								})
							: await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Kamino repay+withdraw simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							simulated: true,
							version,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							network,
							signer: signerPublicKey,
							ownerAddress: build.ownerAddress,
							marketAddress: build.marketAddress,
							programId: build.programId,
							repayReserveMint: build.repayReserveMint,
							repayReserveAddress: build.repayReserveAddress,
							repayReserveSymbol: build.repayReserveSymbol,
							repayAmountRaw: build.repayAmountRaw,
							withdrawReserveMint: build.withdrawReserveMint,
							withdrawReserveAddress: build.withdrawReserveAddress,
							withdrawReserveSymbol: build.withdrawReserveSymbol,
							withdrawAmountRaw: build.withdrawAmountRaw,
							currentSlot: build.currentSlot,
							obligationAddress: build.obligationAddress,
							instructionCount: build.instructionCount,
							setupInstructionCount: build.setupInstructionCount,
							lendingInstructionCount: build.lendingInstructionCount,
							cleanupInstructionCount: build.cleanupInstructionCount,
							setupInstructionLabels: build.setupInstructionLabels,
							lendingInstructionLabels: build.lendingInstructionLabels,
							cleanupInstructionLabels: build.cleanupInstructionLabels,
							signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
							marketExplorer: getExplorerAddressUrl(
								build.marketAddress,
								network,
							),
							repayReserveMintExplorer: getExplorerAddressUrl(
								build.repayReserveMint,
								network,
							),
							withdrawReserveMintExplorer: getExplorerAddressUrl(
								build.withdrawReserveMint,
								network,
							),
							obligationExplorer: getExplorerAddressUrl(
								build.obligationAddress,
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
					content: [
						{
							type: "text",
							text: `Kamino repay+withdraw sent: ${signature}`,
						},
					],
					details: {
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						version,
						network,
						signer: signerPublicKey,
						ownerAddress: build.ownerAddress,
						marketAddress: build.marketAddress,
						programId: build.programId,
						repayReserveMint: build.repayReserveMint,
						repayReserveAddress: build.repayReserveAddress,
						repayReserveSymbol: build.repayReserveSymbol,
						repayAmountRaw: build.repayAmountRaw,
						withdrawReserveMint: build.withdrawReserveMint,
						withdrawReserveAddress: build.withdrawReserveAddress,
						withdrawReserveSymbol: build.withdrawReserveSymbol,
						withdrawAmountRaw: build.withdrawAmountRaw,
						currentSlot: build.currentSlot,
						obligationAddress: build.obligationAddress,
						instructionCount: build.instructionCount,
						setupInstructionCount: build.setupInstructionCount,
						lendingInstructionCount: build.lendingInstructionCount,
						cleanupInstructionCount: build.cleanupInstructionCount,
						setupInstructionLabels: build.setupInstructionLabels,
						lendingInstructionLabels: build.lendingInstructionLabels,
						cleanupInstructionLabels: build.cleanupInstructionLabels,
						explorer: getExplorerTransactionUrl(signature, network),
						signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
						marketExplorer: getExplorerAddressUrl(build.marketAddress, network),
						repayReserveMintExplorer: getExplorerAddressUrl(
							build.repayReserveMint,
							network,
						),
						withdrawReserveMintExplorer: getExplorerAddressUrl(
							build.withdrawReserveMint,
							network,
						),
						obligationExplorer: getExplorerAddressUrl(
							build.obligationAddress,
							network,
						),
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
			name: `${TOOL_PREFIX}stakeCreateAndDelegate`,
			label: "Solana Stake Create+Delegate",
			description:
				"Create a new native stake account from seed and delegate it to a validator vote account",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Stake authority private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				stakeAuthorityAddress: Type.Optional(
					Type.String({
						description:
							"Optional authority assertion. Must match the public key derived from fromSecretKey.",
					}),
				),
				withdrawAuthorityAddress: Type.Optional(
					Type.String({
						description:
							"Optional withdraw authority for the new stake account. Defaults to signer public key.",
					}),
				),
				voteAccountAddress: Type.String({
					description: "Validator vote account public key",
				}),
				stakeSeed: Type.Optional(
					Type.String({
						description:
							"Optional seed used with signer pubkey to derive stake account (max 32 chars after sanitization).",
					}),
				),
				amountSol: Type.Number({
					description: "Stake amount in SOL",
				}),
				network: solanaNetworkSchema(),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
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
					throw new Error(
						"Mainnet stake create+delegate requires confirmMainnet=true",
					);
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.stakeAuthorityAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.stakeAuthorityAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`stakeAuthorityAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const withdrawAuthority = new PublicKey(
					normalizeAtPath(
						params.withdrawAuthorityAddress ?? signer.publicKey.toBase58(),
					),
				);
				const voteAccount = new PublicKey(
					normalizeAtPath(params.voteAccountAddress),
				);
				const stakeSeed = normalizeStakeSeed(params.stakeSeed);
				const stakeAccount = await PublicKey.createWithSeed(
					signer.publicKey,
					stakeSeed,
					StakeProgram.programId,
				);
				const lamports = toLamports(params.amountSol);
				const createStakeTx = StakeProgram.createAccountWithSeed({
					fromPubkey: signer.publicKey,
					stakePubkey: stakeAccount,
					basePubkey: signer.publicKey,
					seed: stakeSeed,
					authorized: new Authorized(signer.publicKey, withdrawAuthority),
					lamports,
				});
				const delegateTx = StakeProgram.delegate({
					stakePubkey: stakeAccount,
					authorizedPubkey: signer.publicKey,
					votePubkey: voteAccount,
				});
				const tx = new Transaction().add(
					...createStakeTx.instructions,
					...delegateTx.instructions,
				);
				tx.feePayer = signer.publicKey;
				const latestBlockhash = await connection.getLatestBlockhash();
				tx.recentBlockhash = latestBlockhash.blockhash;
				tx.sign(signer);
				const commitment = parseFinality(params.commitment);

				if (params.simulate === true) {
					const simulation = await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Stake create+delegate simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							action: "createAndDelegate",
							simulated: true,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							stakeAuthority: signerPublicKey,
							withdrawAuthority: withdrawAuthority.toBase58(),
							stakeAccount: stakeAccount.toBase58(),
							stakeSeed,
							voteAccount: voteAccount.toBase58(),
							amountSol: params.amountSol,
							lamports,
							network,
							stakeAuthorityExplorer: getExplorerAddressUrl(
								signerPublicKey,
								network,
							),
							withdrawAuthorityExplorer: getExplorerAddressUrl(
								withdrawAuthority.toBase58(),
								network,
							),
							stakeAccountExplorer: getExplorerAddressUrl(
								stakeAccount.toBase58(),
								network,
							),
							voteAccountExplorer: getExplorerAddressUrl(
								voteAccount.toBase58(),
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
					content: [
						{
							type: "text",
							text: `Stake created+delegated: ${signature}`,
						},
					],
					details: {
						action: "createAndDelegate",
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						stakeAuthority: signerPublicKey,
						withdrawAuthority: withdrawAuthority.toBase58(),
						stakeAccount: stakeAccount.toBase58(),
						stakeSeed,
						voteAccount: voteAccount.toBase58(),
						amountSol: params.amountSol,
						lamports,
						network,
						explorer: getExplorerTransactionUrl(signature, network),
						stakeAuthorityExplorer: getExplorerAddressUrl(
							signerPublicKey,
							network,
						),
						withdrawAuthorityExplorer: getExplorerAddressUrl(
							withdrawAuthority.toBase58(),
							network,
						),
						stakeAccountExplorer: getExplorerAddressUrl(
							stakeAccount.toBase58(),
							network,
						),
						voteAccountExplorer: getExplorerAddressUrl(
							voteAccount.toBase58(),
							network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}stakeDelegate`,
			label: "Solana Stake Delegate",
			description:
				"Delegate an existing native stake account to a validator vote account",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Stake authority private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				stakeAuthorityAddress: Type.Optional(
					Type.String({
						description:
							"Optional authority assertion. Must match the public key derived from fromSecretKey.",
					}),
				),
				stakeAccountAddress: Type.String({
					description: "Stake account public key",
				}),
				voteAccountAddress: Type.String({
					description: "Validator vote account public key",
				}),
				network: solanaNetworkSchema(),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
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
					throw new Error(
						"Mainnet stake delegate requires confirmMainnet=true",
					);
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.stakeAuthorityAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.stakeAuthorityAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`stakeAuthorityAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const stakeAccount = new PublicKey(
					normalizeAtPath(params.stakeAccountAddress),
				);
				const voteAccount = new PublicKey(
					normalizeAtPath(params.voteAccountAddress),
				);
				const tx = new Transaction().add(
					StakeProgram.delegate({
						stakePubkey: stakeAccount,
						authorizedPubkey: signer.publicKey,
						votePubkey: voteAccount,
					}),
				);
				tx.feePayer = signer.publicKey;
				const latestBlockhash = await connection.getLatestBlockhash();
				tx.recentBlockhash = latestBlockhash.blockhash;
				tx.sign(signer);
				const commitment = parseFinality(params.commitment);

				if (params.simulate === true) {
					const simulation = await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Stake delegate simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							action: "delegate",
							simulated: true,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							stakeAuthority: signerPublicKey,
							stakeAccount: stakeAccount.toBase58(),
							voteAccount: voteAccount.toBase58(),
							network,
							stakeAuthorityExplorer: getExplorerAddressUrl(
								signerPublicKey,
								network,
							),
							stakeAccountExplorer: getExplorerAddressUrl(
								stakeAccount.toBase58(),
								network,
							),
							voteAccountExplorer: getExplorerAddressUrl(
								voteAccount.toBase58(),
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
					content: [{ type: "text", text: `Stake delegated: ${signature}` }],
					details: {
						action: "delegate",
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						stakeAuthority: signerPublicKey,
						stakeAccount: stakeAccount.toBase58(),
						voteAccount: voteAccount.toBase58(),
						network,
						explorer: getExplorerTransactionUrl(signature, network),
						stakeAuthorityExplorer: getExplorerAddressUrl(
							signerPublicKey,
							network,
						),
						stakeAccountExplorer: getExplorerAddressUrl(
							stakeAccount.toBase58(),
							network,
						),
						voteAccountExplorer: getExplorerAddressUrl(
							voteAccount.toBase58(),
							network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}stakeAuthorize`,
			label: "Solana Stake Authorize",
			description:
				"Rotate staker/withdrawer authority for an existing native stake account",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Current stake authority private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				stakeAuthorityAddress: Type.Optional(
					Type.String({
						description:
							"Optional current authority assertion. Must match the public key derived from fromSecretKey.",
					}),
				),
				stakeAccountAddress: Type.String({
					description: "Stake account public key",
				}),
				newAuthorityAddress: Type.String({
					description: "New authority wallet address",
				}),
				authorizationType: Type.Optional(
					Type.Union([Type.Literal("staker"), Type.Literal("withdrawer")], {
						description:
							"Authority type to rotate. Defaults to staker when omitted.",
					}),
				),
				custodianAddress: Type.Optional(
					Type.String({
						description:
							"Optional lockup custodian public key. Required by chain rules for some lockup-constrained updates.",
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
						description: "If true, sign and simulate only (no broadcast)",
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
					throw new Error(
						"Mainnet stake authorize requires confirmMainnet=true",
					);
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.stakeAuthorityAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.stakeAuthorityAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`stakeAuthorityAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const stakeAccount = new PublicKey(
					normalizeAtPath(params.stakeAccountAddress),
				);
				const newAuthority = new PublicKey(
					normalizeAtPath(params.newAuthorityAddress),
				);
				const authorizationType = parseStakeAuthorizationType(
					params.authorizationType,
				);
				const custodian =
					typeof params.custodianAddress === "string"
						? new PublicKey(normalizeAtPath(params.custodianAddress))
						: undefined;
				const tx = new Transaction().add(
					StakeProgram.authorize({
						stakePubkey: stakeAccount,
						authorizedPubkey: signer.publicKey,
						newAuthorizedPubkey: newAuthority,
						stakeAuthorizationType:
							authorizationType === "withdrawer"
								? StakeAuthorizationLayout.Withdrawer
								: StakeAuthorizationLayout.Staker,
						custodianPubkey: custodian,
					}),
				);
				tx.feePayer = signer.publicKey;
				const latestBlockhash = await connection.getLatestBlockhash();
				tx.recentBlockhash = latestBlockhash.blockhash;
				tx.sign(signer);
				const commitment = parseFinality(params.commitment);

				if (params.simulate === true) {
					const simulation = await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Stake authorize simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							action: "authorize",
							authorizationType,
							simulated: true,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							stakeAuthority: signerPublicKey,
							stakeAccount: stakeAccount.toBase58(),
							newAuthority: newAuthority.toBase58(),
							custodian: custodian?.toBase58() ?? null,
							network,
							stakeAuthorityExplorer: getExplorerAddressUrl(
								signerPublicKey,
								network,
							),
							stakeAccountExplorer: getExplorerAddressUrl(
								stakeAccount.toBase58(),
								network,
							),
							newAuthorityExplorer: getExplorerAddressUrl(
								newAuthority.toBase58(),
								network,
							),
							custodianExplorer: custodian
								? getExplorerAddressUrl(custodian.toBase58(), network)
								: null,
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
					content: [{ type: "text", text: `Stake authorized: ${signature}` }],
					details: {
						action: "authorize",
						authorizationType,
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						stakeAuthority: signerPublicKey,
						stakeAccount: stakeAccount.toBase58(),
						newAuthority: newAuthority.toBase58(),
						custodian: custodian?.toBase58() ?? null,
						network,
						explorer: getExplorerTransactionUrl(signature, network),
						stakeAuthorityExplorer: getExplorerAddressUrl(
							signerPublicKey,
							network,
						),
						stakeAccountExplorer: getExplorerAddressUrl(
							stakeAccount.toBase58(),
							network,
						),
						newAuthorityExplorer: getExplorerAddressUrl(
							newAuthority.toBase58(),
							network,
						),
						custodianExplorer: custodian
							? getExplorerAddressUrl(custodian.toBase58(), network)
							: null,
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}stakeDeactivate`,
			label: "Solana Stake Deactivate",
			description: "Deactivate an existing native stake account",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Stake authority private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				stakeAuthorityAddress: Type.Optional(
					Type.String({
						description:
							"Optional authority assertion. Must match the public key derived from fromSecretKey.",
					}),
				),
				stakeAccountAddress: Type.String({
					description: "Stake account public key",
				}),
				network: solanaNetworkSchema(),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
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
					throw new Error(
						"Mainnet stake deactivate requires confirmMainnet=true",
					);
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.stakeAuthorityAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.stakeAuthorityAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`stakeAuthorityAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const stakeAccount = new PublicKey(
					normalizeAtPath(params.stakeAccountAddress),
				);
				const tx = new Transaction().add(
					StakeProgram.deactivate({
						stakePubkey: stakeAccount,
						authorizedPubkey: signer.publicKey,
					}),
				);
				tx.feePayer = signer.publicKey;
				const latestBlockhash = await connection.getLatestBlockhash();
				tx.recentBlockhash = latestBlockhash.blockhash;
				tx.sign(signer);
				const commitment = parseFinality(params.commitment);

				if (params.simulate === true) {
					const simulation = await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Stake deactivate simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							action: "deactivate",
							simulated: true,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							stakeAuthority: signerPublicKey,
							stakeAccount: stakeAccount.toBase58(),
							network,
							stakeAuthorityExplorer: getExplorerAddressUrl(
								signerPublicKey,
								network,
							),
							stakeAccountExplorer: getExplorerAddressUrl(
								stakeAccount.toBase58(),
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
					content: [{ type: "text", text: `Stake deactivated: ${signature}` }],
					details: {
						action: "deactivate",
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						stakeAuthority: signerPublicKey,
						stakeAccount: stakeAccount.toBase58(),
						network,
						explorer: getExplorerTransactionUrl(signature, network),
						stakeAuthorityExplorer: getExplorerAddressUrl(
							signerPublicKey,
							network,
						),
						stakeAccountExplorer: getExplorerAddressUrl(
							stakeAccount.toBase58(),
							network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}stakeWithdraw`,
			label: "Solana Stake Withdraw",
			description:
				"Withdraw SOL from an existing native stake account using withdraw authority",
			parameters: Type.Object({
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Withdraw authority private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				withdrawAuthorityAddress: Type.Optional(
					Type.String({
						description:
							"Optional authority assertion. Must match the public key derived from fromSecretKey.",
					}),
				),
				stakeAccountAddress: Type.String({
					description: "Stake account public key",
				}),
				toAddress: Type.String({
					description: "Destination wallet address",
				}),
				amountSol: Type.Number({
					description: "Withdraw amount in SOL",
				}),
				network: solanaNetworkSchema(),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				commitment: commitmentSchema(),
				simulate: Type.Optional(
					Type.Boolean({
						description: "If true, sign and simulate only (no broadcast)",
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
					throw new Error(
						"Mainnet stake withdraw requires confirmMainnet=true",
					);
				}
				const connection = getConnection(network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				if (params.withdrawAuthorityAddress) {
					const asserted = new PublicKey(
						normalizeAtPath(params.withdrawAuthorityAddress),
					).toBase58();
					if (asserted !== signerPublicKey) {
						throw new Error(
							`withdrawAuthorityAddress mismatch: expected ${signerPublicKey}, got ${asserted}`,
						);
					}
				}
				const stakeAccount = new PublicKey(
					normalizeAtPath(params.stakeAccountAddress),
				);
				const to = new PublicKey(normalizeAtPath(params.toAddress));
				const lamports = toLamports(params.amountSol);
				const tx = new Transaction().add(
					StakeProgram.withdraw({
						stakePubkey: stakeAccount,
						authorizedPubkey: signer.publicKey,
						toPubkey: to,
						lamports,
					}),
				);
				tx.feePayer = signer.publicKey;
				const latestBlockhash = await connection.getLatestBlockhash();
				tx.recentBlockhash = latestBlockhash.blockhash;
				tx.sign(signer);
				const commitment = parseFinality(params.commitment);

				if (params.simulate === true) {
					const simulation = await connection.simulateTransaction(tx);
					return {
						content: [
							{
								type: "text",
								text: `Stake withdraw simulation ${simulation.value.err ? "failed" : "succeeded"}`,
							},
						],
						details: {
							action: "withdraw",
							simulated: true,
							err: simulation.value.err ?? null,
							logs: simulation.value.logs ?? [],
							unitsConsumed: simulation.value.unitsConsumed ?? null,
							withdrawAuthority: signerPublicKey,
							stakeAccount: stakeAccount.toBase58(),
							toAddress: to.toBase58(),
							amountSol: params.amountSol,
							lamports,
							network,
							withdrawAuthorityExplorer: getExplorerAddressUrl(
								signerPublicKey,
								network,
							),
							stakeAccountExplorer: getExplorerAddressUrl(
								stakeAccount.toBase58(),
								network,
							),
							toAddressExplorer: getExplorerAddressUrl(to.toBase58(), network),
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
					content: [
						{
							type: "text",
							text: `Stake withdraw sent: ${signature}`,
						},
					],
					details: {
						action: "withdraw",
						simulated: false,
						signature,
						confirmed: params.confirm !== false,
						withdrawAuthority: signerPublicKey,
						stakeAccount: stakeAccount.toBase58(),
						toAddress: to.toBase58(),
						amountSol: params.amountSol,
						lamports,
						network,
						explorer: getExplorerTransactionUrl(signature, network),
						withdrawAuthorityExplorer: getExplorerAddressUrl(
							signerPublicKey,
							network,
						),
						stakeAccountExplorer: getExplorerAddressUrl(
							stakeAccount.toBase58(),
							network,
						),
						toAddressExplorer: getExplorerAddressUrl(to.toBase58(), network),
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
