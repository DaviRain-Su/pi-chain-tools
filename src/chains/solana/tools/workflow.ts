import { createHash, randomBytes } from "node:crypto";
import { Type } from "@sinclair/typebox";
import {
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
	VersionedTransaction,
} from "@solana/web3.js";
import { defineTool } from "../../../core/types.js";
import {
	assertJupiterNetworkSupported,
	buildJupiterSwapTransaction,
	commitmentSchema,
	getConnection,
	getExplorerAddressUrl,
	getExplorerTransactionUrl,
	getJupiterApiBaseUrl,
	getJupiterQuote,
	jupiterPriorityLevelSchema,
	jupiterSwapModeSchema,
	normalizeAtPath,
	parseFinality,
	parseJupiterPriorityLevel,
	parseJupiterSwapMode,
	parseNetwork,
	parsePositiveBigInt,
	parseTransactionFromBase64,
	resolveSecretKey,
	solanaNetworkSchema,
	toLamports,
} from "../runtime.js";

type WorkflowRunMode = "analysis" | "simulate" | "execute";
type WorkflowIntentType = "solana.transfer.sol" | "solana.swap.jupiter";

type TransferSolIntent = {
	type: "solana.transfer.sol";
	fromAddress: string;
	toAddress: string;
	amountSol: number;
	lamports: number;
};

type JupiterSwapIntent = {
	type: "solana.swap.jupiter";
	userPublicKey: string;
	inputMint: string;
	outputMint: string;
	amountRaw: string;
	slippageBps?: number;
	swapMode: "ExactIn" | "ExactOut";
	restrictIntermediateTokens?: boolean;
	onlyDirectRoutes?: boolean;
	maxAccounts?: number;
	dexes?: string[];
	excludeDexes?: string[];
	asLegacyTransaction?: boolean;
};

type WorkflowIntent = TransferSolIntent | JupiterSwapIntent;

type PreparedTransaction = {
	tx: Transaction | VersionedTransaction;
	version: "legacy" | "v0";
	simulation: {
		ok: boolean;
		err: unknown;
		logs: string[];
		unitsConsumed: number | null;
	};
	context: Record<string, unknown>;
};

function parseRunMode(value?: string): WorkflowRunMode {
	if (value === "analysis" || value === "simulate" || value === "execute") {
		return value;
	}
	return "execute";
}

function ensureString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${field} is required`);
	}
	return value;
}

function ensureNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${field} is required`);
	}
	return value;
}

function createRunId(): string {
	return `w3rt_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function createConfirmToken(
	runId: string,
	network: string,
	intent: WorkflowIntent,
) {
	const payload = JSON.stringify({
		runId,
		network,
		intent,
	});
	const digest = createHash("sha256").update(payload).digest("hex");
	return `SOL-${digest.slice(0, 12).toUpperCase()}`;
}

function createWorkflowPlan(intentType: WorkflowIntentType): string[] {
	return [
		`analysis:${intentType}`,
		"simulate:transaction",
		"approval:policy",
		"execute:broadcast",
		"monitor:confirm",
	];
}

function normalizeIntent(
	params: Record<string, unknown>,
	signerPublicKey: string,
): WorkflowIntent {
	const intentType = params.intentType as WorkflowIntentType;
	if (intentType === "solana.transfer.sol") {
		const toAddress = new PublicKey(
			normalizeAtPath(ensureString(params.toAddress, "toAddress")),
		).toBase58();
		const amountSol = ensureNumber(params.amountSol, "amountSol");
		const lamports = toLamports(amountSol);
		return {
			type: intentType,
			fromAddress: signerPublicKey,
			toAddress,
			amountSol,
			lamports,
		};
	}

	const inputMint = new PublicKey(
		normalizeAtPath(ensureString(params.inputMint, "inputMint")),
	).toBase58();
	const outputMint = new PublicKey(
		normalizeAtPath(ensureString(params.outputMint, "outputMint")),
	).toBase58();
	const amountRaw = parsePositiveBigInt(
		ensureString(params.amountRaw, "amountRaw"),
		"amountRaw",
	).toString();
	return {
		type: intentType,
		userPublicKey: signerPublicKey,
		inputMint,
		outputMint,
		amountRaw,
		slippageBps:
			typeof params.slippageBps === "number" ? params.slippageBps : undefined,
		swapMode: parseJupiterSwapMode(
			typeof params.swapMode === "string" ? params.swapMode : undefined,
		),
		restrictIntermediateTokens:
			typeof params.restrictIntermediateTokens === "boolean"
				? params.restrictIntermediateTokens
				: undefined,
		onlyDirectRoutes:
			typeof params.onlyDirectRoutes === "boolean"
				? params.onlyDirectRoutes
				: undefined,
		maxAccounts:
			typeof params.maxAccounts === "number" ? params.maxAccounts : undefined,
		dexes: Array.isArray(params.dexes)
			? params.dexes.filter(
					(entry): entry is string => typeof entry === "string",
				)
			: undefined,
		excludeDexes: Array.isArray(params.excludeDexes)
			? params.excludeDexes.filter(
					(entry): entry is string => typeof entry === "string",
				)
			: undefined,
		asLegacyTransaction:
			typeof params.asLegacyTransaction === "boolean"
				? params.asLegacyTransaction
				: undefined,
	};
}

async function prepareTransferSolSimulation(
	network: string,
	signer: Keypair,
	intent: TransferSolIntent,
): Promise<PreparedTransaction> {
	const connection = getConnection(network);
	const tx = new Transaction().add(
		SystemProgram.transfer({
			fromPubkey: signer.publicKey,
			toPubkey: new PublicKey(intent.toAddress),
			lamports: intent.lamports,
		}),
	);
	tx.feePayer = signer.publicKey;
	const latestBlockhash = await connection.getLatestBlockhash();
	tx.recentBlockhash = latestBlockhash.blockhash;
	tx.partialSign(signer);
	const simulation = await connection.simulateTransaction(tx);
	return {
		tx,
		version: "legacy",
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			latestBlockhash,
			lamports: intent.lamports,
			fromAddress: intent.fromAddress,
			toAddress: intent.toAddress,
			amountSol: intent.amountSol,
		},
	};
}

async function prepareJupiterSwapSimulation(
	network: string,
	signer: Keypair,
	intent: JupiterSwapIntent,
	params: Record<string, unknown>,
): Promise<PreparedTransaction> {
	assertJupiterNetworkSupported(network);
	const quote = await getJupiterQuote({
		inputMint: intent.inputMint,
		outputMint: intent.outputMint,
		amount: intent.amountRaw,
		slippageBps: intent.slippageBps,
		swapMode: intent.swapMode,
		restrictIntermediateTokens: intent.restrictIntermediateTokens,
		onlyDirectRoutes: intent.onlyDirectRoutes,
		asLegacyTransaction: intent.asLegacyTransaction,
		maxAccounts: intent.maxAccounts,
		dexes: intent.dexes,
		excludeDexes: intent.excludeDexes,
	});
	const priorityLevel = parseJupiterPriorityLevel(
		typeof params.priorityLevel === "string" ? params.priorityLevel : undefined,
	);
	const swapResponse = await buildJupiterSwapTransaction({
		userPublicKey: signer.publicKey.toBase58(),
		quoteResponse: quote,
		asLegacyTransaction: intent.asLegacyTransaction,
		wrapAndUnwrapSol:
			typeof params.wrapAndUnwrapSol === "boolean"
				? params.wrapAndUnwrapSol
				: undefined,
		useSharedAccounts:
			typeof params.useSharedAccounts === "boolean"
				? params.useSharedAccounts
				: undefined,
		dynamicComputeUnitLimit:
			typeof params.dynamicComputeUnitLimit === "boolean"
				? params.dynamicComputeUnitLimit
				: true,
		skipUserAccountsRpcCalls:
			typeof params.skipUserAccountsRpcCalls === "boolean"
				? params.skipUserAccountsRpcCalls
				: undefined,
		destinationTokenAccount:
			typeof params.destinationTokenAccount === "string"
				? params.destinationTokenAccount
				: undefined,
		trackingAccount:
			typeof params.trackingAccount === "string"
				? params.trackingAccount
				: undefined,
		feeAccount:
			typeof params.feeAccount === "string" ? params.feeAccount : undefined,
		jitoTipLamports:
			typeof params.jitoTipLamports === "number"
				? params.jitoTipLamports
				: undefined,
		priorityFee:
			typeof params.jitoTipLamports === "number"
				? undefined
				: {
						priorityLevel,
						maxLamports:
							typeof params.priorityMaxLamports === "number"
								? params.priorityMaxLamports
								: undefined,
						global:
							typeof params.priorityGlobal === "boolean"
								? params.priorityGlobal
								: undefined,
					},
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
	const connection = getConnection(network);
	const commitment = parseFinality(
		typeof params.commitment === "string" ? params.commitment : undefined,
	);
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
	return {
		tx,
		version,
		simulation: {
			ok: simulation.value.err == null,
			err: simulation.value.err ?? null,
			logs: simulation.value.logs ?? [],
			unitsConsumed: simulation.value.unitsConsumed ?? null,
		},
		context: {
			quote,
			swapResponse: swapPayload,
			outAmount:
				typeof quotePayload.outAmount === "string"
					? quotePayload.outAmount
					: null,
			routeCount: routePlan.length,
			jupiterBaseUrl: getJupiterApiBaseUrl(),
		},
	};
}

async function prepareSimulation(
	network: string,
	signer: Keypair,
	intent: WorkflowIntent,
	params: Record<string, unknown>,
): Promise<PreparedTransaction> {
	if (intent.type === "solana.transfer.sol") {
		return prepareTransferSolSimulation(network, signer, intent);
	}
	return prepareJupiterSwapSimulation(network, signer, intent, params);
}

async function executePreparedTransaction(
	network: string,
	prepared: PreparedTransaction,
	params: Record<string, unknown>,
): Promise<{
	signature: string;
	confirmed: boolean;
}> {
	const connection = getConnection(network);
	const signature = await connection.sendRawTransaction(
		prepared.tx.serialize(),
		{
			skipPreflight: params.skipPreflight === true,
			maxRetries:
				typeof params.maxRetries === "number" ? params.maxRetries : undefined,
		},
	);
	const commitment = parseFinality(
		typeof params.commitment === "string" ? params.commitment : undefined,
	);
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
			`Transaction confirmed with error: ${JSON.stringify(confirmationErr)}`,
		);
	}
	return {
		signature,
		confirmed: params.confirm !== false,
	};
}

export function createSolanaWorkflowTools() {
	return [
		defineTool({
			name: "w3rt_run_workflow_v0",
			label: "W3RT Run Workflow V0 (Solana)",
			description:
				"Deterministic Solana workflow entrypoint: analysis -> simulation -> approval -> execution -> monitor",
			parameters: Type.Object({
				runId: Type.Optional(
					Type.String({
						description:
							"Optional workflow run id. Provide the same id when replaying simulate->execute on mainnet.",
					}),
				),
				intentType: Type.Union([
					Type.Literal("solana.transfer.sol"),
					Type.Literal("solana.swap.jupiter"),
				]),
				runMode: Type.Optional(
					Type.Union([
						Type.Literal("analysis"),
						Type.Literal("simulate"),
						Type.Literal("execute"),
					]),
				),
				fromSecretKey: Type.Optional(
					Type.String({
						description:
							"Signer private key (base58 or JSON array). Optional if SOLANA_SECRET_KEY or local keypair file is configured",
					}),
				),
				network: solanaNetworkSchema(),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description: "Required for mainnet execute mode",
					}),
				),
				confirmToken: Type.Optional(
					Type.String({
						description:
							"Mainnet confirmation token returned by a previous analysis/simulate call for the same runId",
					}),
				),
				commitment: commitmentSchema(),
				skipPreflight: Type.Optional(Type.Boolean()),
				maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				confirm: Type.Optional(
					Type.Boolean({ description: "Wait for confirmation (default true)" }),
				),
				toAddress: Type.Optional(
					Type.String({
						description:
							"Destination address for intentType=solana.transfer.sol",
					}),
				),
				amountSol: Type.Optional(
					Type.Number({
						description: "Amount in SOL for intentType=solana.transfer.sol",
					}),
				),
				inputMint: Type.Optional(
					Type.String({
						description: "Input mint for intentType=solana.swap.jupiter",
					}),
				),
				outputMint: Type.Optional(
					Type.String({
						description: "Output mint for intentType=solana.swap.jupiter",
					}),
				),
				amountRaw: Type.Optional(
					Type.String({
						description:
							"Raw integer amount for intentType=solana.swap.jupiter",
					}),
				),
				slippageBps: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
				swapMode: jupiterSwapModeSchema(),
				restrictIntermediateTokens: Type.Optional(Type.Boolean()),
				onlyDirectRoutes: Type.Optional(Type.Boolean()),
				asLegacyTransaction: Type.Optional(Type.Boolean()),
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
				priorityLevel: jupiterPriorityLevelSchema(),
				priorityMaxLamports: Type.Optional(
					Type.Integer({ minimum: 1, maximum: 20_000_000 }),
				),
				priorityGlobal: Type.Optional(Type.Boolean()),
				jitoTipLamports: Type.Optional(
					Type.Integer({ minimum: 1, maximum: 20_000_000 }),
				),
				wrapAndUnwrapSol: Type.Optional(Type.Boolean()),
				useSharedAccounts: Type.Optional(Type.Boolean()),
				dynamicComputeUnitLimit: Type.Optional(Type.Boolean()),
				skipUserAccountsRpcCalls: Type.Optional(Type.Boolean()),
				destinationTokenAccount: Type.Optional(Type.String()),
				trackingAccount: Type.Optional(Type.String()),
				feeAccount: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params) {
				const runMode = parseRunMode(params.runMode);
				const network = parseNetwork(params.network);
				const signer = Keypair.fromSecretKey(
					resolveSecretKey(params.fromSecretKey),
				);
				const signerPublicKey = signer.publicKey.toBase58();
				const runId =
					typeof params.runId === "string" && params.runId.trim().length > 0
						? params.runId.trim()
						: createRunId();
				const intent = normalizeIntent(
					params as Record<string, unknown>,
					signerPublicKey,
				);
				const confirmToken = createConfirmToken(runId, network, intent);
				const approvalRequired = network === "mainnet-beta";
				const plan = createWorkflowPlan(intent.type);

				const analysisArtifact = {
					stage: "analysis",
					intent,
					plan,
					signer: signerPublicKey,
					network,
					runMode,
				};
				const approvalArtifact = {
					stage: "approval",
					required: approvalRequired,
					runId,
					confirmToken: approvalRequired ? confirmToken : null,
					confirmMainnet: params.confirmMainnet === true,
					providedConfirmToken: params.confirmToken ?? null,
				};

				if (runMode === "analysis") {
					const tokenText =
						approvalRequired && approvalArtifact.confirmToken
							? approvalArtifact.confirmToken
							: "N/A";
					return {
						content: [
							{
								type: "text",
								text: `Workflow analyzed: ${intent.type}`,
							},
							{
								type: "text",
								text: `runId=${runId} approvalRequired=${approvalRequired} confirmToken=${tokenText}`,
							},
						],
						details: {
							runId,
							status: "analysis",
							artifacts: {
								analysis: analysisArtifact,
								simulate: null,
								approval: approvalArtifact,
								execute: null,
								monitor: null,
							},
						},
					};
				}

				const prepared = await prepareSimulation(
					network,
					signer,
					intent,
					params as Record<string, unknown>,
				);
				const simulationArtifact = {
					stage: "simulate",
					ok: prepared.simulation.ok,
					err: prepared.simulation.err,
					logs: prepared.simulation.logs,
					unitsConsumed: prepared.simulation.unitsConsumed,
					version: prepared.version,
					context: prepared.context,
				};

				if (runMode === "simulate") {
					const tokenText =
						approvalRequired && approvalArtifact.confirmToken
							? approvalArtifact.confirmToken
							: "N/A";
					return {
						content: [
							{
								type: "text",
								text: `Workflow simulation ${prepared.simulation.ok ? "succeeded" : "failed"}`,
							},
							{
								type: "text",
								text: `runId=${runId} approvalRequired=${approvalRequired} confirmToken=${tokenText}`,
							},
						],
						details: {
							runId,
							status: "simulated",
							artifacts: {
								analysis: analysisArtifact,
								simulate: simulationArtifact,
								approval: approvalArtifact,
								execute: null,
								monitor: null,
							},
						},
					};
				}

				if (approvalRequired) {
					if (params.confirmMainnet !== true) {
						throw new Error(
							"Mainnet execute requires confirmMainnet=true. Run analysis/simulate first to obtain confirmToken.",
						);
					}
					if (params.confirmToken !== confirmToken) {
						throw new Error(
							`Invalid confirmToken for runId=${runId}. Expected ${confirmToken}.`,
						);
					}
				}
				if (!prepared.simulation.ok) {
					throw new Error(
						"Simulation failed; execution blocked by workflow policy",
					);
				}

				const execution = await executePreparedTransaction(
					network,
					prepared,
					params as Record<string, unknown>,
				);
				const executeArtifact = {
					stage: "execute",
					signature: execution.signature,
					confirmed: execution.confirmed,
					version: prepared.version,
				};
				const monitorArtifact = {
					stage: "monitor",
					signature: execution.signature,
					explorer: getExplorerTransactionUrl(execution.signature, network),
					signerExplorer: getExplorerAddressUrl(signerPublicKey, network),
				};

				return {
					content: [
						{
							type: "text",
							text: `Workflow executed: ${execution.signature}`,
						},
						{
							type: "text",
							text: `runId=${runId}`,
						},
					],
					details: {
						runId,
						status: "executed",
						artifacts: {
							analysis: analysisArtifact,
							simulate: simulationArtifact,
							approval: {
								...approvalArtifact,
								approved:
									!approvalRequired || params.confirmToken === confirmToken,
							},
							execute: executeArtifact,
							monitor: monitorArtifact,
						},
					},
				};
			},
		}),
	];
}
