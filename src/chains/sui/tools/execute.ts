import { Transaction } from "@mysten/sui/transactions";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	SUI_COIN_TYPE,
	SUI_TOOL_PREFIX,
	formatCoinAmount,
	getSuiClient,
	getSuiExplorerTransactionUrl,
	getSuiRpcEndpoint,
	normalizeAtPath,
	parsePositiveBigInt,
	parseSuiNetwork,
	resolveSuiKeypair,
	suiNetworkSchema,
	toMist,
} from "../runtime.js";

type SuiTransferParams = {
	toAddress: string;
	amountMist?: string;
	amountSui?: number;
	network?: string;
	rpcUrl?: string;
	fromPrivateKey?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
};

type SuiTransferCoinParams = {
	toAddress: string;
	coinType: string;
	amountRaw: string;
	network?: string;
	rpcUrl?: string;
	fromPrivateKey?: string;
	waitForLocalExecution?: boolean;
	confirmMainnet?: boolean;
	maxCoinObjectsToMerge?: number;
};

function resolveTransferAmount(params: SuiTransferParams): bigint {
	if (params.amountMist != null) {
		return parsePositiveBigInt(params.amountMist, "amountMist");
	}
	if (params.amountSui != null) {
		return toMist(params.amountSui);
	}
	throw new Error("Provide amountMist or amountSui");
}

function resolveRequestType(
	waitForLocalExecution?: boolean,
): "WaitForLocalExecution" | "WaitForEffectsCert" {
	return waitForLocalExecution === false
		? "WaitForEffectsCert"
		: "WaitForLocalExecution";
}

function assertMainnetExecutionConfirmed(
	network: string,
	confirmMainnet?: boolean,
): void {
	if (network === "mainnet" && confirmMainnet !== true) {
		throw new Error(
			"Mainnet execution is blocked. Set confirmMainnet=true to continue.",
		);
	}
}

function parseMaxCoinObjects(value: number | undefined): number {
	if (value == null) return 20;
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new Error("maxCoinObjectsToMerge must be an integer");
	}
	if (value < 1 || value > 100) {
		throw new Error("maxCoinObjectsToMerge must be between 1 and 100");
	}
	return value;
}

async function resolveCoinObjectIdsForAmount(
	client: ReturnType<typeof getSuiClient>,
	owner: string,
	coinType: string,
	amountRaw: bigint,
	maxCoinObjects: number,
): Promise<{
	selectedCoinObjectIds: string[];
	selectedBalanceRaw: bigint;
}> {
	let cursor: string | undefined;
	const selectedCoinObjectIds: string[] = [];
	let selectedBalanceRaw = 0n;

	while (
		selectedBalanceRaw < amountRaw &&
		selectedCoinObjectIds.length < maxCoinObjects
	) {
		const page = await client.getCoins({
			owner,
			coinType,
			cursor,
			limit: Math.min(100, maxCoinObjects - selectedCoinObjectIds.length),
		});

		if (!page.data.length) {
			break;
		}

		for (const coin of page.data) {
			const normalizedBalance = coin.balance.trim();
			if (!/^\d+$/.test(normalizedBalance)) continue;
			const balance = BigInt(normalizedBalance);
			if (balance <= 0n) continue;
			selectedCoinObjectIds.push(coin.coinObjectId);
			selectedBalanceRaw += balance;
			if (
				selectedBalanceRaw >= amountRaw ||
				selectedCoinObjectIds.length >= maxCoinObjects
			) {
				break;
			}
		}

		if (selectedBalanceRaw >= amountRaw) break;
		if (!page.hasNextPage || !page.nextCursor) break;
		cursor = page.nextCursor;
	}

	return {
		selectedCoinObjectIds,
		selectedBalanceRaw,
	};
}

export function createSuiExecuteTools() {
	return [
		defineTool({
			name: `${SUI_TOOL_PREFIX}transferSui`,
			label: "Sui Transfer SUI",
			description:
				"Sign and execute a native SUI transfer. Uses amountMist or amountSui.",
			parameters: Type.Object({
				toAddress: Type.String({ description: "Recipient Sui address" }),
				amountMist: Type.Optional(
					Type.String({
						description: "Amount in MIST (u64 integer string), e.g. 1000000",
					}),
				),
				amountSui: Type.Optional(
					Type.Number({
						description: "Amount in SUI (up to 9 decimal places), e.g. 0.001",
					}),
				),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override Sui JSON-RPC endpoint URL" }),
				),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Signer private key in suiprivkey format. Falls back to SUI_PRIVATE_KEY",
					}),
				),
				waitForLocalExecution: Type.Optional(
					Type.Boolean({
						description:
							"true: WaitForLocalExecution (default), false: WaitForEffectsCert",
					}),
				),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description:
							"Required as true when network=mainnet to prevent accidental broadcast",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);

				const signer = resolveSuiKeypair(params.fromPrivateKey);
				const fromAddress = signer.toSuiAddress();
				const toAddress = normalizeAtPath(params.toAddress);
				const amountMist = resolveTransferAmount(params);
				const amountMistRaw = amountMist.toString();
				const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
				const client = getSuiClient(network, params.rpcUrl);
				const tx = new Transaction();

				const [coin] = tx.splitCoins(tx.gas, [amountMistRaw]);
				tx.transferObjects([coin], toAddress);

				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Sui transfer failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Transfer submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						toAddress,
						amountMist: amountMistRaw,
						amountSui: formatCoinAmount(amountMistRaw, 9),
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						network,
						rpcUrl,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
		defineTool({
			name: `${SUI_TOOL_PREFIX}transferCoin`,
			label: "Sui Transfer Coin",
			description:
				"Sign and execute a non-SUI coin transfer by merging coin objects as needed",
			parameters: Type.Object({
				toAddress: Type.String({ description: "Recipient Sui address" }),
				coinType: Type.String({
					description:
						"Coin type to transfer (non-SUI), e.g. 0x...::coin::COIN",
				}),
				amountRaw: Type.String({
					description: "Raw integer amount to transfer",
				}),
				network: suiNetworkSchema(),
				rpcUrl: Type.Optional(
					Type.String({ description: "Override Sui JSON-RPC endpoint URL" }),
				),
				fromPrivateKey: Type.Optional(
					Type.String({
						description:
							"Signer private key in suiprivkey format. Falls back to SUI_PRIVATE_KEY",
					}),
				),
				waitForLocalExecution: Type.Optional(
					Type.Boolean({
						description:
							"true: WaitForLocalExecution (default), false: WaitForEffectsCert",
					}),
				),
				confirmMainnet: Type.Optional(
					Type.Boolean({
						description:
							"Required as true when network=mainnet to prevent accidental broadcast",
					}),
				),
				maxCoinObjectsToMerge: Type.Optional(
					Type.Number({
						description:
							"Maximum coin objects to use when collecting transfer amount (1-100, default 20)",
						minimum: 1,
						maximum: 100,
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const network = parseSuiNetwork(params.network);
				assertMainnetExecutionConfirmed(network, params.confirmMainnet);

				const coinType = params.coinType.trim();
				if (coinType === SUI_COIN_TYPE) {
					throw new Error(
						"coinType=0x2::sui::SUI is not supported in sui_transferCoin. Use sui_transferSui.",
					);
				}

				const signer = resolveSuiKeypair(params.fromPrivateKey);
				const fromAddress = signer.toSuiAddress();
				const toAddress = normalizeAtPath(params.toAddress);
				const amountRawBigInt = parsePositiveBigInt(
					params.amountRaw,
					"amountRaw",
				);
				const amountRaw = amountRawBigInt.toString();
				const maxCoinObjects = parseMaxCoinObjects(
					params.maxCoinObjectsToMerge,
				);
				const rpcUrl = getSuiRpcEndpoint(network, params.rpcUrl);
				const client = getSuiClient(network, params.rpcUrl);

				const { selectedCoinObjectIds, selectedBalanceRaw } =
					await resolveCoinObjectIdsForAmount(
						client,
						fromAddress,
						coinType,
						amountRawBigInt,
						maxCoinObjects,
					);

				if (!selectedCoinObjectIds.length) {
					throw new Error(
						`No coin objects found for coinType=${coinType} at owner=${fromAddress}`,
					);
				}
				if (selectedBalanceRaw < amountRawBigInt) {
					throw new Error(
						`Insufficient balance for ${coinType}. Need ${amountRaw}, found ${selectedBalanceRaw.toString()} using up to ${maxCoinObjects} coin objects.`,
					);
				}

				const tx = new Transaction();
				const primaryCoinId = selectedCoinObjectIds[0];
				if (!primaryCoinId) {
					throw new Error("No primary coin object selected");
				}
				if (selectedCoinObjectIds.length > 1) {
					tx.mergeCoins(primaryCoinId, selectedCoinObjectIds.slice(1));
				}
				const [splitCoin] = tx.splitCoins(primaryCoinId, [amountRaw]);
				tx.transferObjects([splitCoin], toAddress);

				const response = await client.signAndExecuteTransaction({
					signer,
					transaction: tx,
					options: {
						showEffects: true,
						showEvents: true,
						showObjectChanges: true,
						showBalanceChanges: true,
					},
					requestType: resolveRequestType(params.waitForLocalExecution),
				});

				const status = response.effects?.status.status ?? "unknown";
				const error =
					response.effects?.status.error ?? response.errors?.[0] ?? null;
				if (status === "failure") {
					throw new Error(
						`Sui coin transfer failed: ${error ?? "unknown error"} (digest=${response.digest})`,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: `Coin transfer submitted: digest=${response.digest} status=${status}`,
						},
					],
					details: {
						digest: response.digest,
						status,
						error,
						fromAddress,
						toAddress,
						coinType,
						amountRaw,
						selectedCoinObjectIds,
						selectedCoinObjectCount: selectedCoinObjectIds.length,
						selectedBalanceRaw: selectedBalanceRaw.toString(),
						confirmedLocalExecution: response.confirmedLocalExecution ?? null,
						network,
						rpcUrl,
						explorer: getSuiExplorerTransactionUrl(response.digest, network),
					},
				};
			},
		}),
	];
}
