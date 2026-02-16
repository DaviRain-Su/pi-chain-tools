import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { resolveWorkflowRunMode } from "../../shared/workflow-runtime.js";
import { isMainnetLikeEvmNetwork } from "../policy.js";
import {
	EVM_TOOL_PREFIX,
	type EvmNetwork,
	evmNetworkSchema,
	parseEvmNetwork,
	parsePositiveIntegerString,
	parsePositiveNumber,
	stringifyUnknown,
} from "../runtime.js";
import { createEvmExecuteTools } from "./execute.js";

type WorkflowRunMode = "analysis" | "simulate" | "execute";
export type KnownTokenSymbol =
	| "USDC"
	| "USDT"
	| "DAI"
	| "WETH"
	| "WBTC"
	| "WBNB"
	| "BTCB"
	| "WBERA"
	| "HONEY"
	| "WMON";
export type TokenSymbolMetadata = {
	decimals: number;
	/** Per-network decimals override (e.g. BSC Binance-Peg USDC is 18, not 6). */
	decimalsByNetwork?: Partial<Record<EvmNetwork, number>>;
	addresses: Partial<Record<EvmNetwork, string>>;
};

const EVM_NETWORKS: EvmNetwork[] = [
	"ethereum",
	"sepolia",
	"polygon",
	"base",
	"arbitrum",
	"optimism",
	"bsc",
	"berachain",
	"monad",
];

export const EVM_TRANSFER_TOKEN_MAP_ENV_BY_NETWORK: Record<EvmNetwork, string> =
	{
		ethereum: "EVM_TRANSFER_TOKEN_MAP_ETHEREUM",
		sepolia: "EVM_TRANSFER_TOKEN_MAP_SEPOLIA",
		polygon: "EVM_TRANSFER_TOKEN_MAP_POLYGON",
		base: "EVM_TRANSFER_TOKEN_MAP_BASE",
		arbitrum: "EVM_TRANSFER_TOKEN_MAP_ARBITRUM",
		optimism: "EVM_TRANSFER_TOKEN_MAP_OPTIMISM",
		bsc: "EVM_TRANSFER_TOKEN_MAP_BSC",
		berachain: "EVM_TRANSFER_TOKEN_MAP_BERACHAIN",
		monad: "EVM_TRANSFER_TOKEN_MAP_MONAD",
	};

export const EVM_TRANSFER_TOKEN_MAP_ENV = "EVM_TRANSFER_TOKEN_MAP";
export const EVM_TRANSFER_TOKEN_DECIMALS_ENV = "EVM_TRANSFER_TOKEN_DECIMALS";

const TOKEN_METADATA_BY_SYMBOL: Record<KnownTokenSymbol, TokenSymbolMetadata> =
	{
		USDC: {
			decimals: 6,
			decimalsByNetwork: { bsc: 18 },
			addresses: {
				ethereum: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
				sepolia: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
				polygon: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
				base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
				arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
				optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
				bsc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
				monad: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
			},
		},
		USDT: {
			decimals: 6,
			decimalsByNetwork: { bsc: 18 },
			addresses: {
				ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
				polygon: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
				arbitrum: "0xFd086bC7CD5C481DCC9C85EBE478A1C0b69FCbb9",
				optimism: "0x94b008Aa00579c1307B0EF2c499aD98a8ce58e58",
				bsc: "0x55d398326f99059fF775485246999027B3197955",
				monad: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
			},
		},
		DAI: {
			decimals: 18,
			addresses: {
				ethereum: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
				polygon: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
				base: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
				arbitrum: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
				optimism: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
			},
		},
		WETH: {
			decimals: 18,
			addresses: {
				ethereum: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
				polygon: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
				base: "0x4200000000000000000000000000000000000006",
				arbitrum: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
				optimism: "0x4200000000000000000000000000000000000006",
				bsc: "0x2170Ed0880ac9A755fd29B2688956BD959F933f8",
				monad: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",
			},
		},
		WBTC: {
			decimals: 8,
			addresses: {
				ethereum: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
				polygon: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6",
				arbitrum: "0x2f2a2543B76A4166549F7AaB2e75Bef0aefC5B0f",
				optimism: "0x68f180fcce6836688e9084f035309e29bf0a2095",
				monad: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
			},
		},
		WBNB: {
			decimals: 18,
			addresses: {
				bsc: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
			},
		},
		BTCB: {
			decimals: 18,
			addresses: {
				bsc: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
			},
		},
		WBERA: {
			decimals: 18,
			addresses: {
				berachain: "0x7507c1dc16935B82698e4C63f2746A2fCf994dF8",
			},
		},
		HONEY: {
			decimals: 18,
			addresses: {
				berachain: "0x0E4aaF1351de4c0264C5c7056Ef3777b41BD8e03",
			},
		},
		WMON: {
			decimals: 18,
			addresses: {
				monad: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
			},
		},
	};

type TransferIntent =
	| {
			type: "evm.transfer.native";
			toAddress: string;
			amountNative?: number;
			amountWei?: string;
	  }
	| {
			type: "evm.transfer.erc20";
			tokenAddress: string;
			tokenSymbol?: string;
			toAddress: string;
			amountRaw: string;
	  };

type WorkflowParams = {
	runId?: string;
	runMode?: WorkflowRunMode;
	network?: string;
	intentType?: TransferIntent["type"];
	intentText?: string;
	toAddress?: string;
	tokenAddress?: string;
	tokenSymbol?: string;
	amountNative?: number;
	amountWei?: string;
	amountRaw?: string;
	amountToken?: string;
	rpcUrl?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
	fromPrivateKey?: string;
};

type ParsedIntentHints = {
	intentType?: TransferIntent["type"];
	toAddress?: string;
	tokenAddress?: string;
	tokenSymbol?: KnownTokenSymbol;
	amountNative?: number;
	amountWei?: string;
	amountRaw?: string;
	amountToken?: string;
	confirmMainnet?: boolean;
	confirmToken?: string;
};

type WorkflowSessionRecord = {
	runId: string;
	network: string;
	intent: TransferIntent;
	rpcUrl?: string;
	fromPrivateKey?: string;
};

type ExecuteTool = {
	name: string;
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

const SESSION_BY_RUN_ID = new Map<string, WorkflowSessionRecord>();
let latestSession: WorkflowSessionRecord | null = null;

function normalizeTokenSymbol(value: string): string {
	return value
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");
}

function parseKnownTokenSymbol(value?: string): KnownTokenSymbol | undefined {
	if (!value?.trim()) return undefined;
	const normalized = normalizeTokenSymbol(value);
	if (normalized === "USDC" || normalized === "USDCE") return "USDC";
	if (normalized === "USDT") return "USDT";
	if (normalized === "DAI") return "DAI";
	if (normalized === "WETH") return "WETH";
	if (normalized === "WBTC") return "WBTC";
	if (normalized === "WBNB" || normalized === "BNB") return "WBNB";
	if (normalized === "BTCB") return "BTCB";
	if (normalized === "WBERA" || normalized === "BERA") return "WBERA";
	if (normalized === "HONEY") return "HONEY";
	if (normalized === "WMON" || normalized === "MON") return "WMON";
	return undefined;
}

function normalizeConfiguredEvmAddress(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
		return undefined;
	}
	return normalized;
}

function parseEvmNetworkAlias(value: string): EvmNetwork | undefined {
	const normalized = value.trim().toLowerCase();
	if (
		normalized === "ethereum" ||
		normalized === "eth" ||
		normalized === "mainnet"
	) {
		return "ethereum";
	}
	if (normalized === "sepolia") return "sepolia";
	if (normalized === "polygon" || normalized === "matic") return "polygon";
	if (normalized === "base") return "base";
	if (normalized === "arbitrum" || normalized === "arb") return "arbitrum";
	if (normalized === "optimism" || normalized === "op") return "optimism";
	if (normalized === "bsc" || normalized === "bnb") return "bsc";
	if (
		normalized === "berachain" ||
		normalized === "bera" ||
		normalized === "bartio"
	)
		return "berachain";
	if (normalized === "monad" || normalized === "mon") return "monad";
	return undefined;
}

function parseTokenDecimalsEnv(
	value: string | undefined,
): Partial<Record<KnownTokenSymbol, number>> {
	const normalized = value?.trim();
	if (!normalized) return {};
	try {
		const parsed = JSON.parse(normalized) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const map: Partial<Record<KnownTokenSymbol, number>> = {};
		for (const [rawKey, rawValue] of Object.entries(parsed)) {
			const symbol = parseKnownTokenSymbol(rawKey);
			if (!symbol) continue;
			const decimals =
				typeof rawValue === "number" ? rawValue : Number(rawValue);
			if (
				Number.isFinite(decimals) &&
				Number.isInteger(decimals) &&
				decimals >= 0 &&
				decimals <= 255
			) {
				map[symbol] = decimals;
			}
		}
		return map;
	} catch {
		return {};
	}
}

function parseNetworkTokenMapEnv(
	value: string | undefined,
): Partial<Record<KnownTokenSymbol, string>> {
	const normalized = value?.trim();
	if (!normalized) return {};
	try {
		const parsed = JSON.parse(normalized) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const map: Partial<Record<KnownTokenSymbol, string>> = {};
		for (const [rawKey, rawValue] of Object.entries(parsed)) {
			const symbol = parseKnownTokenSymbol(rawKey);
			if (!symbol) continue;
			const address = normalizeConfiguredEvmAddress(rawValue);
			if (!address) continue;
			map[symbol] = address;
		}
		return map;
	} catch {
		return {};
	}
}

function parseGlobalTokenMapEnv(
	value: string | undefined,
): Partial<Record<KnownTokenSymbol, Partial<Record<EvmNetwork, string>>>> {
	const normalized = value?.trim();
	if (!normalized) return {};
	try {
		const parsed = JSON.parse(normalized) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const map: Partial<
			Record<KnownTokenSymbol, Partial<Record<EvmNetwork, string>>>
		> = {};
		for (const [rawKey, rawValue] of Object.entries(parsed)) {
			const symbol = parseKnownTokenSymbol(rawKey);
			if (!symbol) continue;
			if (
				!rawValue ||
				typeof rawValue !== "object" ||
				Array.isArray(rawValue)
			) {
				continue;
			}
			const networkMap: Partial<Record<EvmNetwork, string>> = {};
			for (const [rawNetwork, rawAddress] of Object.entries(rawValue)) {
				const network = parseEvmNetworkAlias(rawNetwork);
				if (!network) continue;
				const address = normalizeConfiguredEvmAddress(rawAddress);
				if (!address) continue;
				networkMap[network] = address;
			}
			if (Object.keys(networkMap).length > 0) {
				map[symbol] = networkMap;
			}
		}
		return map;
	} catch {
		return {};
	}
}

function copyDefaultTokenMetadata(): Record<
	KnownTokenSymbol,
	TokenSymbolMetadata
> {
	return {
		USDC: {
			decimals: TOKEN_METADATA_BY_SYMBOL.USDC.decimals,
			...(TOKEN_METADATA_BY_SYMBOL.USDC.decimalsByNetwork
				? {
						decimalsByNetwork: {
							...TOKEN_METADATA_BY_SYMBOL.USDC.decimalsByNetwork,
						},
					}
				: {}),
			addresses: { ...TOKEN_METADATA_BY_SYMBOL.USDC.addresses },
		},
		USDT: {
			decimals: TOKEN_METADATA_BY_SYMBOL.USDT.decimals,
			...(TOKEN_METADATA_BY_SYMBOL.USDT.decimalsByNetwork
				? {
						decimalsByNetwork: {
							...TOKEN_METADATA_BY_SYMBOL.USDT.decimalsByNetwork,
						},
					}
				: {}),
			addresses: { ...TOKEN_METADATA_BY_SYMBOL.USDT.addresses },
		},
		DAI: {
			decimals: TOKEN_METADATA_BY_SYMBOL.DAI.decimals,
			addresses: { ...TOKEN_METADATA_BY_SYMBOL.DAI.addresses },
		},
		WETH: {
			decimals: TOKEN_METADATA_BY_SYMBOL.WETH.decimals,
			addresses: { ...TOKEN_METADATA_BY_SYMBOL.WETH.addresses },
		},
		WBTC: {
			decimals: TOKEN_METADATA_BY_SYMBOL.WBTC.decimals,
			addresses: { ...TOKEN_METADATA_BY_SYMBOL.WBTC.addresses },
		},
		WBNB: {
			decimals: TOKEN_METADATA_BY_SYMBOL.WBNB.decimals,
			addresses: { ...TOKEN_METADATA_BY_SYMBOL.WBNB.addresses },
		},
		BTCB: {
			decimals: TOKEN_METADATA_BY_SYMBOL.BTCB.decimals,
			addresses: { ...TOKEN_METADATA_BY_SYMBOL.BTCB.addresses },
		},
		WBERA: {
			decimals: TOKEN_METADATA_BY_SYMBOL.WBERA.decimals,
			addresses: { ...TOKEN_METADATA_BY_SYMBOL.WBERA.addresses },
		},
		HONEY: {
			decimals: TOKEN_METADATA_BY_SYMBOL.HONEY.decimals,
			addresses: { ...TOKEN_METADATA_BY_SYMBOL.HONEY.addresses },
		},
		WMON: {
			decimals: TOKEN_METADATA_BY_SYMBOL.WMON.decimals,
			addresses: { ...TOKEN_METADATA_BY_SYMBOL.WMON.addresses },
		},
	};
}

export function resolveTokenMetadataBySymbol(): Record<
	KnownTokenSymbol,
	TokenSymbolMetadata
> {
	const resolved = copyDefaultTokenMetadata();
	const decimalsOverrides = parseTokenDecimalsEnv(
		process.env[EVM_TRANSFER_TOKEN_DECIMALS_ENV],
	);
	for (const symbol of Object.keys(decimalsOverrides)) {
		const parsedSymbol = parseKnownTokenSymbol(symbol);
		const decimals = parsedSymbol ? decimalsOverrides[parsedSymbol] : undefined;
		if (parsedSymbol && decimals != null) {
			resolved[parsedSymbol].decimals = decimals;
		}
	}

	const globalMap = parseGlobalTokenMapEnv(
		process.env[EVM_TRANSFER_TOKEN_MAP_ENV],
	);
	for (const symbol of Object.keys(globalMap)) {
		const parsedSymbol = parseKnownTokenSymbol(symbol);
		if (!parsedSymbol) continue;
		const networkMap = globalMap[parsedSymbol];
		if (!networkMap) continue;
		for (const network of EVM_NETWORKS) {
			const address = networkMap[network];
			if (address) {
				resolved[parsedSymbol].addresses[network] = address;
			}
		}
	}

	for (const network of EVM_NETWORKS) {
		const envKey = EVM_TRANSFER_TOKEN_MAP_ENV_BY_NETWORK[network];
		const overrides = parseNetworkTokenMapEnv(process.env[envKey]);
		for (const symbol of Object.keys(overrides)) {
			const parsedSymbol = parseKnownTokenSymbol(symbol);
			const address = parsedSymbol ? overrides[parsedSymbol] : undefined;
			if (parsedSymbol && address) {
				resolved[parsedSymbol].addresses[network] = address;
			}
		}
	}
	return resolved;
}

function parsePositiveDecimalString(value: string, fieldName: string): string {
	const normalized = value.trim();
	if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
		throw new Error(`${fieldName} must be a positive decimal string`);
	}
	if (/^0(?:\.0+)?$/.test(normalized)) {
		throw new Error(`${fieldName} must be greater than 0`);
	}
	return normalized;
}

/** Resolve decimals for a token on a specific network, respecting per-network overrides. */
function resolveTokenDecimals(
	metadata: TokenSymbolMetadata,
	network?: EvmNetwork,
): number {
	if (network && metadata.decimalsByNetwork?.[network] != null) {
		return metadata.decimalsByNetwork[network] as number;
	}
	return metadata.decimals;
}

function decimalToRaw(params: {
	amountDecimal: string;
	decimals: number;
	fieldName: string;
}): string {
	const normalized = parsePositiveDecimalString(
		params.amountDecimal,
		params.fieldName,
	);
	const [whole, fractional = ""] = normalized.split(".");
	if (fractional.length > params.decimals) {
		throw new Error(
			`${params.fieldName} has too many decimal places for token decimals=${params.decimals}`,
		);
	}
	const scale = 10n ** BigInt(params.decimals);
	const wholePart = BigInt(whole);
	const fractionalText = fractional.padEnd(params.decimals, "0");
	const fractionalPart = fractionalText ? BigInt(fractionalText) : 0n;
	const raw = wholePart * scale + fractionalPart;
	if (raw <= 0n) {
		throw new Error(`${params.fieldName} must be greater than 0`);
	}
	return raw.toString();
}

function createRunId(input?: string): string {
	if (input?.trim()) return input.trim();
	const nonce = Math.random().toString(36).slice(2, 8);
	return `wf-evm-transfer-${Date.now().toString(36)}-${nonce}`;
}

function rememberSession(record: WorkflowSessionRecord): void {
	SESSION_BY_RUN_ID.set(record.runId, record);
	latestSession = record;
}

function readSession(runId?: string): WorkflowSessionRecord | null {
	if (runId?.trim()) return SESSION_BY_RUN_ID.get(runId.trim()) ?? null;
	return latestSession;
}

function isEvmAddress(value: string): boolean {
	return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function parseEvmAddress(value: string, fieldName: string): string {
	const normalized = value.trim();
	if (!isEvmAddress(normalized)) {
		throw new Error(`${fieldName} must be a valid EVM address`);
	}
	return normalized;
}

function extractConfirmTokenFromText(text?: string): string | undefined {
	if (!text?.trim()) return undefined;
	const explicit =
		text.match(/\bconfirmToken\s*[:= ]\s*(EVM-[A-Za-z0-9]+)\b/i)?.[1] ??
		text.match(/\b(EVM-[A-Za-z0-9]{8,})\b/i)?.[1];
	return explicit?.trim();
}

function hasConfirmMainnetPhrase(text?: string): boolean {
	if (!text?.trim()) return false;
	const lower = text.toLowerCase();
	return (
		lower.includes("确认主网执行") ||
		lower.includes("确认执行") ||
		lower.includes("confirm mainnet") ||
		lower.includes("confirmmainnet=true") ||
		lower.includes("confirmmainnet true")
	);
}

function parseIntentText(text?: string): ParsedIntentHints {
	if (!text?.trim()) return {};
	const addresses = text.match(/0x[a-fA-F0-9]{40}/g) ?? [];
	const tokenAddressMatch =
		text.match(/\btoken(?:Address)?\s*[:= ]\s*(0x[a-fA-F0-9]{40})\b/i)?.[1] ??
		undefined;
	const tokenSymbolMatch =
		text.match(/\btoken(?:Symbol)?\s*[:= ]\s*([A-Za-z0-9._-]{2,16})\b/i)?.[1] ??
		text.match(
			/\b(USDC(?:\.E)?|USDT|DAI|WETH|WBTC|WBNB|BTCB|WBERA|BERA|HONEY|WMON|MON)\b/i,
		)?.[1] ??
		undefined;
	const toAddressMatch =
		text.match(
			/(?:to|给|转给|收款地址)\s*[:： ]\s*(0x[a-fA-F0-9]{40})/i,
		)?.[1] ?? undefined;
	const amountRawMatch =
		text.match(/\bamountRaw\s*[:= ]\s*(\d+)/i)?.[1] ??
		text.match(/\braw\s*[:= ]\s*(\d+)/i)?.[1] ??
		undefined;
	const amountWeiMatch =
		text.match(/\bamountWei\s*[:= ]\s*(\d+)/i)?.[1] ??
		text.match(/\bwei\s*[:= ]\s*(\d+)/i)?.[1] ??
		undefined;
	const amountTokenMatch =
		text.match(/\bamount(?:Token)?\s*[:= ]\s*(\d+(?:\.\d+)?)\b/i)?.[1] ??
		text.match(
			/(\d+(?:\.\d+)?)\s*(?:USDC(?:\.E)?|USDT|DAI|WETH|WBTC|WBNB|BTCB|WBERA|BERA|HONEY|WMON|MON)\b/i,
		)?.[1] ??
		undefined;
	const amountNativeMatch =
		text.match(/(\d+(?:\.\d+)?)\s*(?:matic|eth|native|主币|原生币)/i)?.[1] ??
		text.match(/(?:转|给|send|transfer)\s*(\d+(?:\.\d+)?)/i)?.[1] ??
		undefined;
	const lower = text.toLowerCase();
	const knownTokenSymbol = parseKnownTokenSymbol(tokenSymbolMatch);
	const erc20Hint =
		/(erc20|token\s+transfer|代币转账)/i.test(text) ||
		knownTokenSymbol != null ||
		tokenAddressMatch != null ||
		(amountRawMatch != null && lower.includes("raw"));

	const tokenAddress = tokenAddressMatch || undefined;
	let toAddress = toAddressMatch || undefined;
	if (!toAddress && addresses.length > 0) {
		if (tokenAddress && addresses.length >= 2) {
			toAddress = addresses.find((entry) => entry !== tokenAddress);
		} else if (!tokenAddress) {
			toAddress = addresses[0];
		}
	}

	return {
		intentType: erc20Hint ? "evm.transfer.erc20" : undefined,
		toAddress,
		tokenAddress,
		tokenSymbol: knownTokenSymbol,
		amountNative:
			amountNativeMatch != null
				? Number.parseFloat(amountNativeMatch)
				: undefined,
		amountWei: amountWeiMatch,
		amountRaw: amountRawMatch,
		amountToken: amountTokenMatch,
		confirmMainnet: hasConfirmMainnetPhrase(text) ? true : undefined,
		confirmToken: extractConfirmTokenFromText(text),
	};
}

function hasIntentInput(params: WorkflowParams): boolean {
	const parsed = parseIntentText(params.intentText);
	return Boolean(
		params.intentType ||
			params.toAddress?.trim() ||
			params.tokenAddress?.trim() ||
			params.tokenSymbol?.trim() ||
			params.amountNative != null ||
			params.amountWei?.trim() ||
			params.amountRaw?.trim() ||
			params.amountToken?.trim() ||
			parsed.intentType ||
			parsed.toAddress ||
			parsed.tokenAddress ||
			parsed.tokenSymbol ||
			parsed.amountNative != null ||
			parsed.amountWei ||
			parsed.amountRaw ||
			parsed.amountToken,
	);
}

function normalizeIntent(
	params: WorkflowParams,
	network: EvmNetwork,
): TransferIntent {
	const parsed = parseIntentText(params.intentText);
	const intentType =
		params.intentType ?? parsed.intentType ?? "evm.transfer.native";
	if (intentType === "evm.transfer.erc20") {
		const metadataBySymbol = resolveTokenMetadataBySymbol();
		const tokenSymbol =
			parseKnownTokenSymbol(params.tokenSymbol) ?? parsed.tokenSymbol;
		const tokenAddressInput =
			params.tokenAddress?.trim() ||
			parsed.tokenAddress ||
			(tokenSymbol
				? metadataBySymbol[tokenSymbol].addresses[network]
				: undefined);
		if (!tokenAddressInput) {
			if (tokenSymbol) {
				throw new Error(
					`No known ${tokenSymbol} address configured for network=${network}. Provide tokenAddress explicitly or set ${EVM_TRANSFER_TOKEN_MAP_ENV_BY_NETWORK[network]}.`,
				);
			}
			throw new Error(
				"Provide tokenAddress (or known tokenSymbol like USDC/USDT/DAI/WETH/WBTC/WBNB/BTCB/WBERA/HONEY/WMON with configured map)",
			);
		}
		const tokenAddress = parseEvmAddress(tokenAddressInput, "tokenAddress");
		const toAddress = parseEvmAddress(
			params.toAddress?.trim() || parsed.toAddress || "",
			"toAddress",
		);
		const amountRawInput = params.amountRaw?.trim() || parsed.amountRaw;
		let amountRaw: string;
		if (amountRawInput) {
			amountRaw = parsePositiveIntegerString(amountRawInput, "amountRaw");
		} else {
			const amountTokenInput = params.amountToken?.trim() || parsed.amountToken;
			if (!amountTokenInput || !tokenSymbol) {
				throw new Error(
					"Provide amountRaw, or amountToken together with tokenSymbol/known token text for evm.transfer.erc20",
				);
			}
			const decimals = resolveTokenDecimals(
				metadataBySymbol[tokenSymbol],
				network,
			);
			amountRaw = decimalToRaw({
				amountDecimal: amountTokenInput,
				decimals,
				fieldName: "amountToken",
			});
		}
		return {
			type: "evm.transfer.erc20",
			tokenAddress,
			...(tokenSymbol ? { tokenSymbol } : {}),
			toAddress,
			amountRaw,
		};
	}

	const toAddress = parseEvmAddress(
		params.toAddress?.trim() || parsed.toAddress || "",
		"toAddress",
	);
	const amountWei =
		params.amountWei?.trim() || parsed.amountWei
			? parsePositiveIntegerString(
					(params.amountWei?.trim() || parsed.amountWei) as string,
					"amountWei",
				)
			: undefined;
	const amountNative =
		amountWei == null
			? params.amountNative != null
				? parsePositiveNumber(params.amountNative, "amountNative")
				: parsed.amountNative != null
					? parsePositiveNumber(parsed.amountNative, "amountNative")
					: undefined
			: undefined;
	if (!amountWei && amountNative == null) {
		throw new Error(
			"Provide amountNative or amountWei for evm.transfer.native",
		);
	}
	return {
		type: "evm.transfer.native",
		toAddress,
		amountNative,
		amountWei,
	};
}

function stableHash(input: string): string {
	return createHash("sha256").update(input).digest("hex").toUpperCase();
}

function createConfirmToken(
	runId: string,
	network: string,
	intent: TransferIntent,
): string {
	const base = JSON.stringify({ runId, network, intent });
	return `EVM-${stableHash(base).slice(0, 16)}`;
}

function intentsMatch(a: TransferIntent, b: TransferIntent): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function buildSummaryLine(params: {
	intent: TransferIntent;
	phase: WorkflowRunMode;
	status: string;
	confirmToken?: string;
	txHash?: string | null;
}): string {
	const parts = [`${params.intent.type}`, `${params.phase}=${params.status}`];
	if (params.intent.type === "evm.transfer.native") {
		parts.push(`to=${params.intent.toAddress}`);
		if (params.intent.amountNative != null) {
			parts.push(`amountNative=${params.intent.amountNative}`);
		}
		if (params.intent.amountWei) {
			parts.push(`amountWei=${params.intent.amountWei}`);
		}
	} else {
		parts.push(
			`token=${params.intent.tokenSymbol ?? params.intent.tokenAddress}`,
		);
		if (params.intent.tokenSymbol) {
			parts.push(`tokenAddress=${params.intent.tokenAddress}`);
		}
		parts.push(`to=${params.intent.toAddress}`);
		parts.push(`amountRaw=${params.intent.amountRaw}`);
	}
	if (params.txHash) parts.push(`tx=${params.txHash}`);
	if (params.confirmToken) parts.push(`confirmToken=${params.confirmToken}`);
	return parts.join(" ");
}

function resolveExecuteTool(name: string): ExecuteTool {
	const tool = createEvmExecuteTools().find((entry) => entry.name === name);
	if (!tool) {
		throw new Error(`${name} tool not found`);
	}
	return tool as unknown as ExecuteTool;
}

function buildExecuteParams(params: {
	network: string;
	intent: TransferIntent;
	rpcUrl?: string;
	fromPrivateKey?: string;
	dryRun: boolean;
	confirmMainnet?: boolean;
}): Record<string, unknown> {
	if (params.intent.type === "evm.transfer.native") {
		return {
			network: params.network,
			toAddress: params.intent.toAddress,
			...(params.intent.amountNative != null
				? { amountNative: params.intent.amountNative }
				: {}),
			...(params.intent.amountWei
				? { amountWei: params.intent.amountWei }
				: {}),
			...(params.rpcUrl ? { rpcUrl: params.rpcUrl } : {}),
			...(params.fromPrivateKey
				? { fromPrivateKey: params.fromPrivateKey }
				: {}),
			dryRun: params.dryRun,
			...(params.confirmMainnet != null
				? { confirmMainnet: params.confirmMainnet }
				: {}),
		};
	}
	return {
		network: params.network,
		tokenAddress: params.intent.tokenAddress,
		toAddress: params.intent.toAddress,
		amountRaw: params.intent.amountRaw,
		...(params.rpcUrl ? { rpcUrl: params.rpcUrl } : {}),
		...(params.fromPrivateKey ? { fromPrivateKey: params.fromPrivateKey } : {}),
		dryRun: params.dryRun,
		...(params.confirmMainnet != null
			? { confirmMainnet: params.confirmMainnet }
			: {}),
	};
}

function resolveExecuteToolName(intent: TransferIntent): string {
	return intent.type === "evm.transfer.native"
		? `${EVM_TOOL_PREFIX}transferNative`
		: `${EVM_TOOL_PREFIX}transferErc20`;
}

function extractTxHash(details: unknown): string | null {
	if (!details || typeof details !== "object") return null;
	const payload = details as { txHash?: unknown };
	return typeof payload.txHash === "string" ? payload.txHash : null;
}

export function createEvmTransferWorkflowTools() {
	return [
		defineTool({
			name: "w3rt_run_evm_transfer_workflow_v0",
			label: "w3rt Run EVM Transfer Workflow v0",
			description:
				"Deterministic EVM transfer workflow entrypoint for native/ERC20 transfers (supports tokenSymbol+amountToken for mapped tokens): analysis -> simulate -> execute.",
			parameters: Type.Object({
				runId: Type.Optional(Type.String()),
				runMode: Type.Optional(
					Type.Union([
						Type.Literal("analysis"),
						Type.Literal("simulate"),
						Type.Literal("execute"),
					]),
				),
				network: evmNetworkSchema(),
				intentType: Type.Optional(
					Type.Union([
						Type.Literal("evm.transfer.native"),
						Type.Literal("evm.transfer.erc20"),
					]),
				),
				intentText: Type.Optional(Type.String()),
				toAddress: Type.Optional(Type.String()),
				tokenAddress: Type.Optional(Type.String()),
				tokenSymbol: Type.Optional(Type.String()),
				amountNative: Type.Optional(
					Type.Number({ minimum: 0.000000000000000001 }),
				),
				amountWei: Type.Optional(Type.String()),
				amountRaw: Type.Optional(Type.String()),
				amountToken: Type.Optional(Type.String()),
				rpcUrl: Type.Optional(Type.String()),
				confirmMainnet: Type.Optional(Type.Boolean()),
				confirmToken: Type.Optional(Type.String()),
				fromPrivateKey: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as WorkflowParams;
				const parsedHints = parseIntentText(params.intentText);
				const runMode = resolveWorkflowRunMode(
					params.runMode,
					params.intentText,
					{
						allowCompose: false,
					},
				);
				const priorSession =
					runMode === "execute" ? readSession(params.runId) : null;
				const runId = createRunId(
					params.runId ||
						(runMode === "execute" ? priorSession?.runId : undefined),
				);
				const network = parseEvmNetwork(
					params.network ||
						(runMode === "execute" ? priorSession?.network : undefined),
				);
				const intent =
					runMode === "execute" &&
					!hasIntentInput(params) &&
					priorSession?.intent
						? priorSession.intent
						: normalizeIntent(params, network);
				const confirmToken = createConfirmToken(runId, network, intent);
				const providedConfirmToken =
					params.confirmToken?.trim() || parsedHints.confirmToken?.trim();
				const effectiveConfirmMainnet =
					params.confirmMainnet === true || parsedHints.confirmMainnet === true;
				const mainnetGuardRequired = isMainnetLikeEvmNetwork(network);
				const executeTool = resolveExecuteTool(resolveExecuteToolName(intent));
				const effectiveRpcUrl = params.rpcUrl || priorSession?.rpcUrl;
				const effectivePrivateKey =
					params.fromPrivateKey || priorSession?.fromPrivateKey;

				if (runMode === "analysis") {
					const summaryLine = buildSummaryLine({
						intent,
						phase: "analysis",
						status: "ready",
						confirmToken: mainnetGuardRequired ? confirmToken : undefined,
					});
					rememberSession({
						runId,
						network,
						intent,
						rpcUrl: effectiveRpcUrl,
						fromPrivateKey: effectivePrivateKey,
					});
					return {
						content: [
							{ type: "text", text: `Workflow analyzed: ${intent.type}` },
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation: mainnetGuardRequired,
							confirmToken,
							artifacts: {
								analysis: {
									intent,
									summaryLine,
									summary: {
										schema: "w3rt.workflow.summary.v1",
										phase: "analysis",
										status: "ready",
										intentType: intent.type,
										line: summaryLine,
									},
								},
							},
						},
					};
				}

				if (runMode === "simulate") {
					let previewResult: unknown = null;
					let status = "ready";
					try {
						const preview = await executeTool.execute(
							"wf-evm-transfer-simulate",
							buildExecuteParams({
								network,
								intent,
								rpcUrl: effectiveRpcUrl,
								fromPrivateKey: effectivePrivateKey,
								dryRun: true,
							}),
						);
						previewResult = preview.details ?? null;
					} catch (error) {
						status = "precheck_failed";
						previewResult = { error: stringifyUnknown(error) };
					}
					const summaryLine = buildSummaryLine({
						intent,
						phase: "simulate",
						status,
						confirmToken: mainnetGuardRequired ? confirmToken : undefined,
					});
					rememberSession({
						runId,
						network,
						intent,
						rpcUrl: effectiveRpcUrl,
						fromPrivateKey: effectivePrivateKey,
					});
					return {
						content: [
							{
								type: "text",
								text: `Workflow simulated: ${intent.type} status=${status}`,
							},
						],
						details: {
							runId,
							runMode,
							network,
							intentType: intent.type,
							intent,
							needsMainnetConfirmation: mainnetGuardRequired,
							confirmToken,
							artifacts: {
								simulate: {
									status,
									preview: previewResult,
									summaryLine,
									summary: {
										schema: "w3rt.workflow.summary.v1",
										phase: "simulate",
										status,
										intentType: intent.type,
										line: summaryLine,
									},
								},
							},
						},
					};
				}

				if (mainnetGuardRequired) {
					if (!effectiveConfirmMainnet) {
						throw new Error(
							`Mainnet execute blocked. Re-run with confirmMainnet=true and confirmToken=${confirmToken}`,
						);
					}
					const sessionConfirmed =
						priorSession?.runId === runId &&
						priorSession.network === network &&
						intentsMatch(priorSession.intent, intent) &&
						!providedConfirmToken;
					if (!sessionConfirmed && providedConfirmToken !== confirmToken) {
						throw new Error(
							`Invalid confirmToken. Expected ${confirmToken}, got ${providedConfirmToken ?? "(empty)"}`,
						);
					}
				}

				const executeResult = await executeTool.execute(
					"wf-evm-transfer-execute",
					buildExecuteParams({
						network,
						intent,
						rpcUrl: effectiveRpcUrl,
						fromPrivateKey: effectivePrivateKey,
						dryRun: false,
						confirmMainnet: mainnetGuardRequired ? true : undefined,
					}),
				);
				const txHash = extractTxHash(executeResult.details);
				const summaryLine = buildSummaryLine({
					intent,
					phase: "execute",
					status: "submitted",
					txHash,
				});
				rememberSession({
					runId,
					network,
					intent,
					rpcUrl: effectiveRpcUrl,
					fromPrivateKey: effectivePrivateKey,
				});
				return {
					content: [
						{ type: "text", text: `Workflow executed: ${intent.type}` },
					],
					details: {
						runId,
						runMode,
						network,
						intentType: intent.type,
						intent,
						needsMainnetConfirmation: mainnetGuardRequired,
						confirmToken,
						artifacts: {
							execute: {
								status: "submitted",
								txHash,
								result: executeResult.details ?? null,
								summaryLine,
								summary: {
									schema: "w3rt.workflow.summary.v1",
									phase: "execute",
									status: "submitted",
									intentType: intent.type,
									line: summaryLine,
								},
							},
						},
					},
				};
			},
		}),
	];
}
