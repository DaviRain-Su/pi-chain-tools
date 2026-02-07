import { Type } from "@sinclair/typebox";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { defineTool } from "../../../core/types.js";
import {
	TOKEN_PROGRAM_ID,
	TOOL_PREFIX,
	commitmentSchema,
	getConnection,
	getExplorerAddressUrl,
	getExplorerTransactionUrl,
	normalizeAtPath,
	parseCommitment,
	parseFinality,
	parseNetwork,
	parseTokenAccountInfo,
	solanaNetworkSchema,
} from "../runtime.js";

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
	];
}
