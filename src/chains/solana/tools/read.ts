import { Type } from "@sinclair/typebox";
import {
	LAMPORTS_PER_SOL,
	type ParsedAccountData,
	PublicKey,
	StakeProgram,
} from "@solana/web3.js";
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
	getKaminoLendingMarkets,
	getKaminoLendingPositions,
	getOrcaWhirlpoolPositions,
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
const ORCA_DEFAULT_DEXES = ["Orca V2", "Orca Whirlpool"] as const;
const METEORA_DEFAULT_DEXES = ["Meteora DLMM"] as const;
const DEFI_TOKEN_PROFILES: Record<
	string,
	{
		symbol: string;
		protocol: string;
		category: "liquid-staking" | "dex-token" | "stablecoin";
	}
> = {
	EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
		symbol: "USDC",
		protocol: "stablecoin",
		category: "stablecoin",
	},
	Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
		symbol: "USDT",
		protocol: "stablecoin",
		category: "stablecoin",
	},
	"4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": {
		symbol: "RAY",
		protocol: "raydium",
		category: "dex-token",
	},
	orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: {
		symbol: "ORCA",
		protocol: "orca",
		category: "dex-token",
	},
	mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: {
		symbol: "mSOL",
		protocol: "marinade",
		category: "liquid-staking",
	},
	bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: {
		symbol: "bSOL",
		protocol: "blaze",
		category: "liquid-staking",
	},
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

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	return value as Record<string, unknown>;
}

function parseStakePositionFromAccount(entry: {
	pubkey: PublicKey;
	account: {
		lamports: number;
		data: unknown;
	};
}) {
	const parsedData = entry.account.data as ParsedAccountData;
	if (!parsedData || typeof parsedData !== "object") {
		return null;
	}
	const parsed = asRecord(parsedData.parsed);
	if (!parsed) {
		return null;
	}
	const info = asRecord(parsed.info);
	if (!info) {
		return null;
	}
	const meta = asRecord(info.meta);
	const authorized = asRecord(meta?.authorized);
	const stake = asRecord(info.stake);
	const delegation = asRecord(stake?.delegation);
	const delegatedLamports =
		typeof delegation?.stake === "string" && /^\d+$/.test(delegation.stake)
			? delegation.stake
			: null;
	return {
		stakeAccount: entry.pubkey.toBase58(),
		state: typeof parsed.type === "string" ? parsed.type : "unknown",
		lamports: entry.account.lamports,
		lamportsUiAmount: formatTokenUiAmount(BigInt(entry.account.lamports), 9),
		delegatedLamports,
		delegatedUiAmount:
			delegatedLamports == null
				? null
				: formatTokenUiAmount(BigInt(delegatedLamports), 9),
		voter:
			typeof delegation?.voter === "string"
				? (delegation.voter as string)
				: null,
		activationEpoch:
			typeof delegation?.activationEpoch === "string"
				? (delegation.activationEpoch as string)
				: null,
		deactivationEpoch:
			typeof delegation?.deactivationEpoch === "string"
				? (delegation.deactivationEpoch as string)
				: null,
		staker:
			typeof authorized?.staker === "string"
				? (authorized.staker as string)
				: null,
		withdrawer:
			typeof authorized?.withdrawer === "string"
				? (authorized.withdrawer as string)
				: null,
	};
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
				includeToken2022: Type.Optional(
					Type.Boolean({
						description:
							"Include Token-2022 accounts in addition to legacy SPL Token accounts (default true).",
					}),
				),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const owner = new PublicKey(normalizeAtPath(params.address));
				const tokenMint = params.tokenMint
					? new PublicKey(normalizeAtPath(params.tokenMint))
					: null;
				const includeToken2022 = params.includeToken2022 !== false;
				const [tokenProgramResponse, token2022Response] = await Promise.all([
					connection.getParsedTokenAccountsByOwner(owner, {
						programId: TOKEN_PROGRAM_ID,
					}),
					includeToken2022
						? connection.getParsedTokenAccountsByOwner(owner, {
								programId: TOKEN_2022_PROGRAM_ID,
							})
						: Promise.resolve(null),
				]);
				const rawAccounts = [
					...tokenProgramResponse.value,
					...(token2022Response?.value ?? []),
				];

				const parsed = rawAccounts
					.map((entry) => {
						const tokenInfo = parseTokenAccountInfo(entry.account.data);
						if (!tokenInfo) return null;
						if (tokenMint && tokenInfo.mint !== tokenMint.toBase58()) {
							return null;
						}
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
						tokenProgramAccountCount: tokenProgramResponse.value.length,
						token2022AccountCount: token2022Response?.value.length ?? 0,
						tokenAccountCount: rawAccounts.length,
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
				includeToken2022: Type.Optional(
					Type.Boolean({
						description:
							"Include Token-2022 accounts in addition to legacy SPL Token accounts (default true).",
					}),
				),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const owner = new PublicKey(normalizeAtPath(params.address));
				const mint = new PublicKey(normalizeAtPath(params.tokenMint));
				const includeToken2022 = params.includeToken2022 !== false;
				const [tokenProgramResponse, token2022Response] = await Promise.all([
					connection.getParsedTokenAccountsByOwner(owner, {
						programId: TOKEN_PROGRAM_ID,
					}),
					includeToken2022
						? connection.getParsedTokenAccountsByOwner(owner, {
								programId: TOKEN_2022_PROGRAM_ID,
							})
						: Promise.resolve(null),
				]);
				const accounts = [
					...tokenProgramResponse.value,
					...(token2022Response?.value ?? []),
				];

				let totalAmountRaw = 0n;
				let totalUiAmount = 0;
				let decimals = 0;
				let tokenAccountCount = 0;
				for (const entry of accounts) {
					const tokenInfo = parseTokenAccountInfo(entry.account.data);
					if (!tokenInfo) continue;
					if (tokenInfo.mint !== mint.toBase58()) continue;
					totalAmountRaw += BigInt(tokenInfo.tokenAmount.amount);
					totalUiAmount += tokenInfo.tokenAmount.uiAmount ?? 0;
					decimals = tokenInfo.tokenAmount.decimals;
					tokenAccountCount += 1;
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
						tokenAccountCount,
						tokenProgramAccountCount: tokenProgramResponse.value.length,
						token2022AccountCount: token2022Response?.value.length ?? 0,
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
			name: `${TOOL_PREFIX}getDefiPositions`,
			label: "Solana Get DeFi Positions",
			description:
				"Get wallet DeFi positions summary including protocol-tagged token exposures and native stake accounts",
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
				includeStakeAccounts: Type.Optional(
					Type.Boolean({
						description:
							"Include native stake account discovery using StakeProgram parsed account scans",
					}),
				),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const connection = getConnection(params.network);
				const owner = new PublicKey(normalizeAtPath(params.address));
				const includeToken2022 = params.includeToken2022 !== false;
				const includeStakeAccounts = params.includeStakeAccounts !== false;

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
				const tokenPositions = new Map<
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
					const existing = tokenPositions.get(tokenInfo.mint);
					if (!existing) {
						tokenPositions.set(tokenInfo.mint, {
							amountRaw,
							decimals: tokenInfo.tokenAmount.decimals,
							tokenAccountCount: 1,
						});
						continue;
					}
					existing.amountRaw += amountRaw;
					existing.tokenAccountCount += 1;
				}

				const tokens = [...tokenPositions.entries()]
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

				const defiTokenPositions = tokens
					.map((token) => {
						const profile = DEFI_TOKEN_PROFILES[token.mint];
						if (!profile) return null;
						return {
							...token,
							protocol: profile.protocol,
							category: profile.category,
							symbol: profile.symbol,
						};
					})
					.filter(
						(position): position is NonNullable<typeof position> =>
							position !== null,
					);

				let rawStakeAccounts: Array<{
					pubkey: PublicKey;
					account: {
						lamports: number;
						data: unknown;
					};
				}> = [];
				const stakeQueryErrors: string[] = [];
				if (includeStakeAccounts) {
					const ownerAddress = owner.toBase58();
					const stakeFilters = [
						{ memcmp: { offset: 12, bytes: ownerAddress } },
						{ memcmp: { offset: 44, bytes: ownerAddress } },
					];
					const settled = await Promise.all(
						stakeFilters.map((filter) =>
							connection
								.getParsedProgramAccounts(StakeProgram.programId, {
									filters: [filter],
								})
								.catch((error: unknown) => {
									stakeQueryErrors.push(String(error));
									return [];
								}),
						),
					);
					const deduped = new Map<string, (typeof settled)[number][number]>();
					for (const accounts of settled) {
						for (const account of accounts) {
							deduped.set(account.pubkey.toBase58(), account);
						}
					}
					rawStakeAccounts = [...deduped.values()].map((entry) => ({
						pubkey: entry.pubkey,
						account: {
							lamports: entry.account.lamports,
							data: entry.account.data,
						},
					}));
				}
				const stakeAccounts = rawStakeAccounts
					.map((entry) => parseStakePositionFromAccount(entry))
					.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
					.sort((a, b) => a.stakeAccount.localeCompare(b.stakeAccount));
				const totalDelegatedStakeLamports = stakeAccounts.reduce(
					(total, entry) => total + BigInt(entry.delegatedLamports ?? "0"),
					0n,
				);

				const categoryExposureCounts = defiTokenPositions.reduce<
					Record<string, number>
				>((acc, position) => {
					acc[position.category] = (acc[position.category] ?? 0) + 1;
					return acc;
				}, {});
				const protocolExposureCounts = defiTokenPositions.reduce<
					Record<string, number>
				>((acc, position) => {
					acc[position.protocol] = (acc[position.protocol] ?? 0) + 1;
					return acc;
				}, {});

				const sol = lamports / LAMPORTS_PER_SOL;
				return {
					content: [
						{
							type: "text",
							text: `DeFi positions: ${defiTokenPositions.length} token exposure(s), ${stakeAccounts.length} stake account(s)`,
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
						defiTokenPositionCount: defiTokenPositions.length,
						defiTokenPositions,
						categoryExposureCounts,
						protocolExposureCounts,
						stakeAccountCount: stakeAccounts.length,
						stakeAccounts,
						stakeQueryErrors,
						totalDelegatedStakeLamports: totalDelegatedStakeLamports.toString(),
						totalDelegatedStakeUiAmount: formatTokenUiAmount(
							totalDelegatedStakeLamports,
							9,
						),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getLendingMarkets`,
			label: "Solana Get Lending Markets",
			description:
				"Get Kamino lending market catalog (market addresses and metadata)",
			parameters: Type.Object({
				protocol: Type.Optional(
					Type.Union([Type.Literal("kamino")], {
						description:
							"Lending protocol identifier. Currently supports only kamino.",
					}),
				),
				programId: Type.Optional(
					Type.String({
						description:
							"Optional Kamino lending program id filter for market discovery",
					}),
				),
				limitMarkets: Type.Optional(
					Type.Integer({
						minimum: 1,
						maximum: 200,
						description:
							"Limit number of markets returned (default 20, max 200)",
					}),
				),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const protocol = params.protocol ?? "kamino";
				if (protocol !== "kamino") {
					throw new Error(
						`Unsupported lending protocol: ${protocol}. Supported values: kamino`,
					);
				}
				const lendingMarkets = await getKaminoLendingMarkets({
					programId: params.programId,
					limitMarkets: params.limitMarkets,
				});
				return {
					content: [
						{
							type: "text",
							text: `Lending markets (${protocol}): ${lendingMarkets.marketCountQueried}/${lendingMarkets.marketCount}`,
						},
					],
					details: {
						...lendingMarkets,
						network: parseNetwork(params.network),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getLendingPositions`,
			label: "Solana Get Lending Positions",
			description:
				"Get wallet lending positions (deposits/borrows) from Kamino lending markets",
			parameters: Type.Object({
				address: Type.String({ description: "Wallet address" }),
				protocol: Type.Optional(
					Type.Union([Type.Literal("kamino")], {
						description:
							"Lending protocol identifier. Currently supports only kamino.",
					}),
				),
				programId: Type.Optional(
					Type.String({
						description:
							"Optional Kamino lending program id filter for market discovery",
					}),
				),
				limitMarkets: Type.Optional(
					Type.Integer({
						minimum: 1,
						maximum: 200,
						description:
							"Limit number of markets to query (default 20, max 200)",
					}),
				),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const protocol = params.protocol ?? "kamino";
				if (protocol !== "kamino") {
					throw new Error(
						`Unsupported lending protocol: ${protocol}. Supported values: kamino`,
					);
				}
				const address = new PublicKey(
					normalizeAtPath(params.address),
				).toBase58();
				const lending = await getKaminoLendingPositions({
					address,
					network: params.network,
					programId: params.programId,
					limitMarkets: params.limitMarkets,
				});
				return {
					content: [
						{
							type: "text",
							text: `Lending positions (${protocol}): ${lending.obligationCount} obligation(s), ${lending.depositPositionCount} deposit(s), ${lending.borrowPositionCount} borrow(s)`,
						},
					],
					details: {
						...lending,
						addressExplorer: getExplorerAddressUrl(address, params.network),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getOrcaWhirlpoolPositions`,
			label: "Solana Get Orca Whirlpool Positions",
			description:
				"Get wallet Orca Whirlpool LP positions (including bundled positions)",
			parameters: Type.Object({
				address: Type.String({ description: "Wallet address" }),
				network: solanaNetworkSchema(),
			}),
			async execute(_toolCallId, params) {
				const address = new PublicKey(
					normalizeAtPath(params.address),
				).toBase58();
				const positions = await getOrcaWhirlpoolPositions({
					address,
					network: params.network,
				});
				return {
					content: [
						{
							type: "text",
							text: `Orca Whirlpool positions: ${positions.positionCount} position(s) across ${positions.poolCount} pool(s)`,
						},
					],
					details: {
						...positions,
						addressExplorer: getExplorerAddressUrl(address, params.network),
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
			name: `${TOOL_PREFIX}getOrcaQuote`,
			label: "Solana Orca Get Quote",
			description:
				"Fetch Orca-scoped quote via Jupiter by restricting routes to Orca DEX labels",
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
				const dexes =
					params.dexes && params.dexes.length > 0
						? params.dexes
						: [...ORCA_DEFAULT_DEXES];

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
					dexes,
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

				return {
					content: [
						{
							type: "text",
							text: `Orca quote ready: outAmount=${outAmount ?? "unknown"} routeCount=${routePlan.length}`,
						},
					],
					details: {
						protocol: "orca",
						inputMint,
						outputMint,
						amountRaw,
						swapMode,
						dexes,
						outAmount,
						routeCount: routePlan.length,
						quote,
						network: parseNetwork(params.network),
						jupiterBaseUrl: getJupiterApiBaseUrl(),
					},
				};
			},
		}),
		defineTool({
			name: `${TOOL_PREFIX}getMeteoraQuote`,
			label: "Solana Meteora Get Quote",
			description:
				"Fetch Meteora-scoped quote via Jupiter by restricting routes to Meteora DEX labels",
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
				const dexes =
					params.dexes && params.dexes.length > 0
						? params.dexes
						: [...METEORA_DEFAULT_DEXES];

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
					dexes,
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

				return {
					content: [
						{
							type: "text",
							text: `Meteora quote ready: outAmount=${outAmount ?? "unknown"} routeCount=${routePlan.length}`,
						},
					],
					details: {
						protocol: "meteora",
						inputMint,
						outputMint,
						amountRaw,
						swapMode,
						dexes,
						outAmount,
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
