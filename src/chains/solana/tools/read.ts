import { Type } from "@sinclair/typebox";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { defineTool } from "../../../core/types.js";
import {
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	TOOL_PREFIX,
	assertJupiterNetworkSupported,
	assertRaydiumNetworkSupported,
	callJupiterApi,
	callRaydiumApi,
	commitmentSchema,
	getConnection,
	getExplorerAddressUrl,
	getExplorerTransactionUrl,
	getJupiterApiBaseUrl,
	getJupiterDexLabels,
	getJupiterQuote,
	getRaydiumApiBaseUrl,
	getRaydiumPriorityFee,
	getRaydiumPriorityFeeApiBaseUrl,
	getRaydiumQuote,
	jupiterSwapModeSchema,
	normalizeAtPath,
	parseCommitment,
	parseFinality,
	parseJupiterSwapMode,
	parseNetwork,
	parsePositiveBigInt,
	parseRaydiumSwapType,
	parseRaydiumTxVersion,
	parseTokenAccountInfo,
	raydiumSwapTypeSchema,
	raydiumTxVersionSchema,
	solanaNetworkSchema,
} from "../runtime.js";

const KNOWN_MINT_SYMBOLS: Record<string, string> = {
	So11111111111111111111111111111111111111112: "SOL",
	EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
	Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
	"4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "RAY",
	orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: "ORCA",
	mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
	bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: "bSOL",
	"6dhTynDkYsVM7cbF7TKfC9DWB636TcEM935fq7JzL2ES": "BONK",
};

function formatTokenUiAmount(amountRaw: bigint, decimals: number): string {
	if (decimals <= 0) {
		return amountRaw.toString();
	}
	const base = 10n ** BigInt(decimals);
	const whole = amountRaw / base;
	const fractionRaw = amountRaw % base;
	if (fractionRaw === 0n) {
		return whole.toString();
	}
	const fraction = fractionRaw
		.toString()
		.padStart(decimals, "0")
		.replace(/0+$/, "");
	return `${whole.toString()}.${fraction}`;
}

export function createSolanaReadTools() {
	return [
		defineTool({
			name: `${TOOL_PREFIX}getBalance`,
			label: "Solana Get Balance",
			description: "Get account balance in lamports and SOL",
			parameters: Type.Object({
				address: Type.String({ description: "Solana wallet/account address" }),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const publicKey = new PublicKey(normalizeAtPath(params.address));
				const lamports = await connection.getBalance(publicKey);
				const sol = lamports / LAMPORTS_PER_SOL;
				return {
					content: [
						{
							type: "text",
							text: `Balance: ${sol} SOL (${lamports} lamports)`,
						},
					],
					details: {
						address: publicKey.toBase58(),
						lamports,
						sol,
						network: parseNetwork(params.network),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getAccountInfo`,
			label: "Solana Get Account Info",
			description: "Get basic account metadata",
			parameters: Type.Object({
				address: Type.String({ description: "Solana account address" }),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const publicKey = new PublicKey(normalizeAtPath(params.address));
				const info = await connection.getAccountInfo(publicKey);
				if (!info) {
					return {
						content: [{ type: "text", text: "Account not found" }],
						details: {
							address: publicKey.toBase58(),
							found: false,
							network: parseNetwork(params.network),
						},
					};
				}
				return {
					content: [
						{
							type: "text",
							text: `owner=${info.owner.toBase58()} executable=${info.executable} rentEpoch=${info.rentEpoch} dataLength=${info.data.length}`,
						},
					],
					details: {
						address: publicKey.toBase58(),
						found: true,
						owner: info.owner.toBase58(),
						executable: info.executable,
						rentEpoch: info.rentEpoch,
						dataLength: info.data.length,
						lamports: info.lamports,
						network: parseNetwork(params.network),
						explorer: getExplorerAddressUrl(
							publicKey.toBase58(),
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getMultipleAccounts`,
			label: "Solana Get Multiple Accounts",
			description: "Fetch multiple account metadata entries in one RPC call",
			parameters: Type.Object({
				addresses: Type.Array(
					Type.String({ description: "Solana account address" }),
					{ minItems: 1, maxItems: 100 },
				),
				network: solanaNetworkSchema(),
				commitment: commitmentSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const addresses = params.addresses.map(normalizeAtPath);
				const publicKeys = addresses.map((value) => new PublicKey(value));
				const commitment = parseCommitment(params.commitment);
				const infos = await connection.getMultipleAccountsInfo(
					publicKeys,
					commitment,
				);
				const accounts = infos.map((info, index) => {
					const address = publicKeys[index]?.toBase58() ?? addresses[index];
					if (!info) {
						return {
							address,
							found: false,
							explorer: getExplorerAddressUrl(address, params.network),
						};
					}
					return {
						address,
						found: true,
						owner: info.owner.toBase58(),
						executable: info.executable,
						rentEpoch: info.rentEpoch,
						dataLength: info.data.length,
						lamports: info.lamports,
						explorer: getExplorerAddressUrl(address, params.network),
					};
				});
				const foundCount = accounts.filter((item) => item.found).length;
				return {
					content: [
						{
							type: "text",
							text: `Fetched ${accounts.length} account(s), found ${foundCount}`,
						},
					],
					details: {
						count: accounts.length,
						foundCount,
						accounts,
						network: parseNetwork(params.network),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getRecentBlockhash`,
			label: "Solana Get Recent Blockhash",
			description: "Fetch latest blockhash and last valid block height",
			parameters: Type.Object({
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const blockhash = await connection.getLatestBlockhash();
				return {
					content: [
						{
							type: "text",
							text: `blockhash=${blockhash.blockhash} lastValidBlockHeight=${blockhash.lastValidBlockHeight}`,
						},
					],
					details: { ...blockhash, network: parseNetwork(params.network) },
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getRentExemptionMinimum`,
			label: "Solana Get Rent Exemption Minimum",
			description:
				"Get minimum lamports/SOL needed for rent exemption by account data size",
			parameters: Type.Object({
				dataLength: Type.Integer({
					description: "Account data length in bytes",
					minimum: 0,
				}),
				network: solanaNetworkSchema(),
				commitment: commitmentSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const commitment = parseCommitment(params.commitment);
				const lamports = await connection.getMinimumBalanceForRentExemption(
					params.dataLength,
					commitment,
				);
				const sol = lamports / LAMPORTS_PER_SOL;
				return {
					content: [
						{
							type: "text",
							text: `Rent exemption minimum: ${sol} SOL (${lamports} lamports)`,
						},
					],
					details: {
						dataLength: params.dataLength,
						lamports,
						sol,
						commitment,
						network: parseNetwork(params.network),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getTransaction`,
			label: "Solana Get Transaction",
			description: "Fetch transaction details by signature",
			parameters: Type.Object({
				signature: Type.String({ description: "Transaction signature" }),
				network: solanaNetworkSchema(),
				commitment: commitmentSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const commitment = parseFinality(params.commitment);
				const transaction = await connection.getTransaction(params.signature, {
					commitment,
				});
				if (!transaction) {
					return {
						content: [{ type: "text", text: "Transaction not found" }],
						details: {
							signature: params.signature,
							found: false,
							network: parseNetwork(params.network),
						},
					};
				}

				const status = transaction.meta?.err ? "failed" : "success";
				const explorerCluster = parseNetwork(params.network);
				return {
					content: [
						{
							type: "text",
							text: `Transaction ${status} slot=${transaction.slot}`,
						},
					],
					details: {
						signature: params.signature,
						found: true,
						status,
						slot: transaction.slot,
						blockTime: transaction.blockTime ?? null,
						fee: transaction.meta?.fee ?? null,
						err: transaction.meta?.err ?? null,
						logs: transaction.meta?.logMessages ?? [],
						network: explorerCluster,
						explorer: getExplorerTransactionUrl(
							params.signature,
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getSignaturesForAddress`,
			label: "Solana Get Signatures For Address",
			description: "Fetch recent transaction signatures for an address",
			parameters: Type.Object({
				address: Type.String({ description: "Address to query" }),
				network: solanaNetworkSchema(),
				limit: Type.Optional(
					Type.Integer({
						description: "Max signatures to return",
						minimum: 1,
						maximum: 1000,
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const publicKey = new PublicKey(normalizeAtPath(params.address));
				const options = params.limit ? { limit: params.limit } : undefined;
				const signatures = await connection.getSignaturesForAddress(
					publicKey,
					options,
				);
				return {
					content: [
						{ type: "text", text: `Found ${signatures.length} signatures` },
					],
					details: {
						address: publicKey.toBase58(),
						count: signatures.length,
						signatures: signatures.map((entry) => ({
							signature: entry.signature,
							slot: entry.slot,
							blockTime: entry.blockTime ?? null,
							err: entry.err ?? null,
							confirmationStatus: entry.confirmationStatus ?? null,
							explorer: getExplorerTransactionUrl(
								entry.signature,
								params.network,
							),
						})),
						network: parseNetwork(params.network),
						addressExplorer: getExplorerAddressUrl(
							publicKey.toBase58(),
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getTokenAccounts`,
			label: "Solana Get Token Accounts",
			description: "Get SPL token accounts for an address",
			parameters: Type.Object({
				address: Type.String({ description: "Wallet address" }),
				tokenMint: Type.Optional(
					Type.String({ description: "Optional token mint filter" }),
				),
				includeZero: Type.Optional(
					Type.Boolean({ description: "Include zero-balance token accounts" }),
				),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const owner = new PublicKey(normalizeAtPath(params.address));
				const tokenMint = params.tokenMint
					? new PublicKey(normalizeAtPath(params.tokenMint))
					: null;
				const response = tokenMint
					? await connection.getParsedTokenAccountsByOwner(owner, {
							mint: tokenMint,
						})
					: await connection.getParsedTokenAccountsByOwner(owner, {
							programId: TOKEN_PROGRAM_ID,
						});

				const parsed = response.value
					.map((entry) => {
						const tokenInfo = parseTokenAccountInfo(entry.account.data);
						if (!tokenInfo) return null;
						return {
							pubkey: entry.pubkey.toBase58(),
							mint: tokenInfo.mint,
							owner: tokenInfo.owner,
							amount: tokenInfo.tokenAmount.amount,
							decimals: tokenInfo.tokenAmount.decimals,
							uiAmount: tokenInfo.tokenAmount.uiAmount,
						};
					})
					.filter(
						(entry): entry is NonNullable<typeof entry> => entry !== null,
					);

				const accounts =
					params.includeZero === true
						? parsed
						: parsed.filter((entry) => BigInt(entry.amount) > 0n);
				return {
					content: [
						{ type: "text", text: `Found ${accounts.length} token account(s)` },
					],
					details: {
						address: owner.toBase58(),
						count: accounts.length,
						accounts,
						network: parseNetwork(params.network),
						addressExplorer: getExplorerAddressUrl(
							owner.toBase58(),
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getTokenBalance`,
			label: "Solana Get Token Balance",
			description: "Get total SPL token balance for a wallet + mint",
			parameters: Type.Object({
				address: Type.String({ description: "Wallet address" }),
				tokenMint: Type.String({ description: "Token mint address" }),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const owner = new PublicKey(normalizeAtPath(params.address));
				const mint = new PublicKey(normalizeAtPath(params.tokenMint));
				const response = await connection.getParsedTokenAccountsByOwner(owner, {
					mint,
				});

				let totalAmountRaw = 0n;
				let totalUiAmount = 0;
				let decimals = 0;
				for (const entry of response.value) {
					const tokenInfo = parseTokenAccountInfo(entry.account.data);
					if (!tokenInfo) continue;
					totalAmountRaw += BigInt(tokenInfo.tokenAmount.amount);
					totalUiAmount += tokenInfo.tokenAmount.uiAmount ?? 0;
					decimals = tokenInfo.tokenAmount.decimals;
				}

				return {
					content: [
						{
							type: "text",
							text: `Token balance: ${totalUiAmount} (raw ${totalAmountRaw.toString()})`,
						},
					],
					details: {
						address: owner.toBase58(),
						tokenMint: mint.toBase58(),
						amount: totalAmountRaw.toString(),
						uiAmount: totalUiAmount,
						decimals,
						tokenAccountCount: response.value.length,
						network: parseNetwork(params.network),
						addressExplorer: getExplorerAddressUrl(
							owner.toBase58(),
							params.network,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getPortfolio`,
			label: "Solana Get Portfolio",
			description:
				"Get aggregated wallet portfolio including SOL and SPL token balances",
			parameters: Type.Object({
				address: Type.String({ description: "Wallet address" }),
				includeZero: Type.Optional(
					Type.Boolean({
						description: "Include zero-balance token positions",
					}),
				),
				includeToken2022: Type.Optional(
					Type.Boolean({
						description:
							"Include Token-2022 accounts in addition to legacy SPL Token accounts",
					}),
				),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const owner = new PublicKey(normalizeAtPath(params.address));
				const includeToken2022 = params.includeToken2022 !== false;
				const [lamports, tokenProgramResponse, token2022Response] =
					await Promise.all([
						connection.getBalance(owner),
						connection.getParsedTokenAccountsByOwner(owner, {
							programId: TOKEN_PROGRAM_ID,
						}),
						includeToken2022
							? connection.getParsedTokenAccountsByOwner(owner, {
									programId: TOKEN_2022_PROGRAM_ID,
								})
							: Promise.resolve(null),
					]);

				const tokenAccounts = [
					...tokenProgramResponse.value,
					...(token2022Response?.value ?? []),
				];
				const positions = new Map<
					string,
					{
						amountRaw: bigint;
						decimals: number;
						tokenAccountCount: number;
					}
				>();

				for (const entry of tokenAccounts) {
					const tokenInfo = parseTokenAccountInfo(entry.account.data);
					if (!tokenInfo) continue;
					const amountRaw = BigInt(tokenInfo.tokenAmount.amount);
					const existing = positions.get(tokenInfo.mint);
					if (!existing) {
						positions.set(tokenInfo.mint, {
							amountRaw,
							decimals: tokenInfo.tokenAmount.decimals,
							tokenAccountCount: 1,
						});
						continue;
					}
					existing.amountRaw += amountRaw;
					existing.tokenAccountCount += 1;
				}

				const tokens = [...positions.entries()]
					.map(([mint, position]) => ({
						mint,
						symbol: KNOWN_MINT_SYMBOLS[mint] ?? null,
						amount: position.amountRaw.toString(),
						uiAmount: formatTokenUiAmount(
							position.amountRaw,
							position.decimals,
						),
						decimals: position.decimals,
						tokenAccountCount: position.tokenAccountCount,
						explorer: getExplorerAddressUrl(mint, params.network),
					}))
					.filter((position) =>
						params.includeZero === true ? true : BigInt(position.amount) > 0n,
					)
					.sort((a, b) => {
						if (a.symbol && b.symbol) return a.symbol.localeCompare(b.symbol);
						if (a.symbol) return -1;
						if (b.symbol) return 1;
						return a.mint.localeCompare(b.mint);
					});

				const sol = lamports / LAMPORTS_PER_SOL;
				return {
					content: [
						{
							type: "text",
							text: `Portfolio: ${sol} SOL + ${tokens.length} token position(s)`,
						},
					],
					details: {
						address: owner.toBase58(),
						network: parseNetwork(params.network),
						addressExplorer: getExplorerAddressUrl(
							owner.toBase58(),
							params.network,
						),
						sol: {
							lamports,
							uiAmount: sol,
						},
						tokenCount: tokens.length,
						tokenAccountCount: tokenAccounts.length,
						tokenProgramAccountCount: tokenProgramResponse.value.length,
						token2022AccountCount: token2022Response?.value.length ?? 0,
						tokens,
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getJupiterDexLabels`,
			label: "Solana Jupiter Get Dex Labels",
			description:
				"Fetch DEX/AMM program labels supported by Jupiter routing engine",
			parameters: Type.Object({
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				assertJupiterNetworkSupported(params.network);
				const labels = await getJupiterDexLabels();
				const entries = Object.entries(labels).map(([programId, label]) => ({
					programId,
					label,
				}));
				return {
					content: [
						{ type: "text", text: `Jupiter DEX labels: ${entries.length}` },
					],
					details: {
						count: entries.length,
						labels: entries,
						network: parseNetwork(params.network),
						jupiterBaseUrl: getJupiterApiBaseUrl(),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getJupiterQuote`,
			label: "Solana Jupiter Get Quote",
			description:
				"Fetch Jupiter swap quote (best route across Solana DEX/AMM venues)",
			parameters: Type.Object({
				inputMint: Type.String({ description: "Input token mint address" }),
				outputMint: Type.String({ description: "Output token mint address" }),
				amountRaw: Type.String({
					description: "Amount in raw integer base units",
				}),
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
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				assertJupiterNetworkSupported(params.network);
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

				const payload =
					quote && typeof quote === "object"
						? (quote as Record<string, unknown>)
						: {};
				const routePlan = Array.isArray(payload.routePlan)
					? payload.routePlan
					: [];
				const outAmount =
					typeof payload.outAmount === "string" ? payload.outAmount : null;
				const priceImpactPct =
					typeof payload.priceImpactPct === "string"
						? payload.priceImpactPct
						: null;

				return {
					content: [
						{
							type: "text",
							text: `Jupiter quote ready: outAmount=${outAmount ?? "unknown"} routeCount=${routePlan.length}`,
						},
					],
					details: {
						inputMint,
						outputMint,
						amountRaw,
						swapMode,
						outAmount,
						priceImpactPct,
						routeCount: routePlan.length,
						quote,
						network: parseNetwork(params.network),
						jupiterBaseUrl: getJupiterApiBaseUrl(),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getRaydiumPriorityFee`,
			label: "Solana Raydium Priority Fee",
			description:
				"Fetch Raydium recommended priority fee presets for swap transactions",
			parameters: Type.Object({
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				assertRaydiumNetworkSupported(params.network);
				const feePayload = await getRaydiumPriorityFee();
				return {
					content: [{ type: "text", text: "Raydium priority fee fetched" }],
					details: {
						feePayload,
						network: parseNetwork(params.network),
						raydiumPriorityFeeApiBaseUrl: getRaydiumPriorityFeeApiBaseUrl(),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getRaydiumQuote`,
			label: "Solana Raydium Get Quote",
			description: "Fetch Raydium swap quote from official Trade API",
			parameters: Type.Object({
				inputMint: Type.String({ description: "Input token mint address" }),
				outputMint: Type.String({ description: "Output token mint address" }),
				amountRaw: Type.String({
					description: "Amount in raw integer base units",
				}),
				slippageBps: Type.Integer({ minimum: 1, maximum: 5000 }),
				txVersion: raydiumTxVersionSchema(),
				swapType: raydiumSwapTypeSchema(),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				assertRaydiumNetworkSupported(params.network);
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

				const quote = await getRaydiumQuote({
					inputMint,
					outputMint,
					amount: amountRaw,
					slippageBps: params.slippageBps,
					txVersion,
					swapType,
				});
				const payload =
					quote && typeof quote === "object"
						? (quote as Record<string, unknown>)
						: {};
				const success = payload.success === true;
				return {
					content: [
						{
							type: "text",
							text: `Raydium quote ${success ? "ready" : "returned"} (txVersion=${txVersion}, swapType=${swapType})`,
						},
					],
					details: {
						inputMint,
						outputMint,
						amountRaw,
						slippageBps: params.slippageBps,
						txVersion,
						swapType,
						quote,
						success,
						network: parseNetwork(params.network),
						raydiumApiBaseUrl: getRaydiumApiBaseUrl(),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}raydiumRawApi`,
			label: "Solana Raydium Raw API",
			description:
				"Call Raydium Trade API directly for advanced DeFi integrations",
			parameters: Type.Object({
				path: Type.String({
					description:
						"Raydium API path, e.g. /compute/swap-base-in or /transaction/swap-base-in",
				}),
				method: Type.Optional(
					Type.Union([Type.Literal("GET"), Type.Literal("POST")]),
				),
				query: Type.Optional(Type.Record(Type.String(), Type.String())),
				body: Type.Optional(Type.Unknown()),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				assertRaydiumNetworkSupported(params.network);
				const response = await callRaydiumApi(params.path, {
					method: params.method ?? "GET",
					query: params.query,
					body: params.body,
				});
				return {
					content: [
						{ type: "text", text: `Raydium API ${params.path} executed` },
					],
					details: {
						path: params.path,
						method: params.method ?? "GET",
						query: params.query ?? {},
						response,
						network: parseNetwork(params.network),
						raydiumApiBaseUrl: getRaydiumApiBaseUrl(),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}jupiterRawApi`,
			label: "Solana Jupiter Raw API",
			description:
				"Call Jupiter REST endpoint directly for advanced DeFi integrations",
			parameters: Type.Object({
				path: Type.String({
					description:
						"Jupiter API path, e.g. /swap/v1/quote or /swap/v1/program-id-to-label",
				}),
				method: Type.Optional(
					Type.Union([Type.Literal("GET"), Type.Literal("POST")]),
				),
				query: Type.Optional(Type.Record(Type.String(), Type.String())),
				body: Type.Optional(Type.Unknown()),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				assertJupiterNetworkSupported(params.network);
				const response = await callJupiterApi(params.path, {
					method: params.method ?? "GET",
					query: params.query,
					body: params.body,
				});
				return {
					content: [
						{ type: "text", text: `Jupiter API ${params.path} executed` },
					],
					details: {
						path: params.path,
						method: params.method ?? "GET",
						query: params.query ?? {},
						response,
						network: parseNetwork(params.network),
						jupiterBaseUrl: getJupiterApiBaseUrl(),
					},
				};
			},
		}),
	];
}
