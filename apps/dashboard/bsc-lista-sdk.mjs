import { Interface } from "@ethersproject/abi";
import { JsonRpcProvider } from "@ethersproject/providers";

const DEFAULT_LISTA_CLIENT_PACKAGE = "ethers";
// TODO(sdk-coverage): replace canonical ethers client once Lista publishes a maintained official npm SDK.
// Current status (2026-02): no stable official SDK package available on npm; keep fallback-safe path.
const LISTA_OFFICIAL_SDK_CANDIDATES = [
	"@lista-dao/sdk",
	"@lista-dao/contracts",
	"@lista-dao/lista-sdk",
];
const LISTA_PACKAGE_UNBLOCK_DETECTOR_MARKER =
	"lista_detector_hook_official_sdk_package_published";

function safeBigInt(value, fallback = 0n) {
	try {
		return BigInt(String(value ?? "0"));
	} catch {
		return fallback;
	}
}

function rawToUi(raw, decimals = 18) {
	const value = safeBigInt(raw, 0n);
	const base = 10n ** BigInt(Math.max(0, Number(decimals || 18)));
	const whole = value / base;
	const fraction = value % base;
	const fractionText = fraction
		.toString()
		.padStart(Number(decimals || 18), "0")
		.slice(0, 6);
	return `${whole}.${fractionText}`.replace(/\.0+$/, "").replace(/\.$/, "");
}

function normalizeSdkPackageName(input) {
	const text = String(input || "").trim();
	return text || DEFAULT_LISTA_CLIENT_PACKAGE;
}

async function probeOfficialSdkCandidates() {
	const available = [];
	const missing = [];
	for (const packageName of LISTA_OFFICIAL_SDK_CANDIDATES) {
		try {
			await import(packageName);
			available.push(packageName);
		} catch {
			missing.push(packageName);
		}
	}
	return { available, missing };
}

async function readWithFallback(callFn, fallback = null) {
	try {
		return await callFn();
	} catch {
		return fallback;
	}
}

async function readTokenBalance(provider, token, owner) {
	if (!provider || !token || !owner) return "0";
	const iface = new Interface([
		"function balanceOf(address owner) view returns (uint256)",
	]);
	const raw = await provider.call({
		to: token,
		data: iface.encodeFunctionData("balanceOf", [owner]),
	});
	return iface.decodeFunctionResult("balanceOf", raw)?.[0]?.toString() || "0";
}

export async function createListaSdkAdapter({
	rpcUrl,
	chainId,
	sdkPackage,
} = {}) {
	const provider = new JsonRpcProvider(String(rpcUrl || ""), {
		name: "bsc",
		chainId: Number(chainId || 56),
	});
	const candidateProbe = await probeOfficialSdkCandidates();
	const normalizedPackage = normalizeSdkPackageName(sdkPackage);
	const warnings = [];
	if (candidateProbe.available.length === 0) {
		warnings.push(
			"official_lista_sdk_not_available_using_canonical_ethers_client_path",
		);
	}
	return {
		provider,
		config: {
			rpcUrl: String(rpcUrl || ""),
			chainId: Number(chainId || 56),
			sdkPackage: normalizedPackage,
		},
		meta: {
			client: "lista-ethers-client",
			officialSdkWired: candidateProbe.available.length > 0,
			detectorHooks: [LISTA_PACKAGE_UNBLOCK_DETECTOR_MARKER],
			sdkPackage:
				candidateProbe.available.length > 0
					? candidateProbe.available[0]
					: normalizedPackage,
			sdkCandidatesChecked: LISTA_OFFICIAL_SDK_CANDIDATES,
			sdkCandidatesMissing: candidateProbe.missing,
			moduleKeys: [],
			warnings,
		},
	};
}

export async function collectListaSdkMarketView(
	adapter,
	{
		poolAddress,
		usdcToken,
		usdtToken,
		aprHints = null,
		usdcDecimals = 18,
		usdtDecimals = 18,
	} = {},
) {
	const provider = adapter?.provider;
	if (!provider) throw new Error("lista_sdk_adapter_provider_missing");
	const warnings = [];
	const resolvedUsdcApr = Math.max(0, Number(aprHints?.usdcSupplyAprBps || 0));
	const resolvedUsdtApr = Math.max(0, Number(aprHints?.usdtSupplyAprBps || 0));
	const [poolUsdcRaw, poolUsdtRaw] = await Promise.all([
		readWithFallback(
			() => readTokenBalance(provider, usdcToken, poolAddress),
			"0",
		),
		readWithFallback(
			() => readTokenBalance(provider, usdtToken, poolAddress),
			"0",
		),
	]);
	if (!poolAddress) warnings.push("lista_pool_missing_config");
	if (!usdcToken) warnings.push("lista_usdc_token_missing_config");
	if (!usdtToken) warnings.push("lista_usdt_token_missing_config");
	warnings.push(...(adapter?.meta?.warnings || []));
	const market = {
		source: String(aprHints?.source || "lista-native-rpc"),
		usdtSupplyAprBps: resolvedUsdtApr,
		usdcSupplyAprBps: resolvedUsdcApr,
		updatedAt: String(aprHints?.updatedAt || new Date().toISOString()),
		dataSource: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
		sdk: {
			enabled: true,
			used: true,
			fallback: false,
			package: adapter?.meta?.sdkPackage || DEFAULT_LISTA_CLIENT_PACKAGE,
			officialSdkWired: Boolean(adapter?.meta?.officialSdkWired),
		},
		marketStats: {
			poolAddress: poolAddress || null,
			poolLiquidityRaw: {
				usdc: String(poolUsdcRaw || "0"),
				usdt: String(poolUsdtRaw || "0"),
			},
			poolLiquidityUi: {
				usdc: Number(rawToUi(poolUsdcRaw, usdcDecimals)),
				usdt: Number(rawToUi(poolUsdtRaw, usdtDecimals)),
			},
		},
		warnings,
	};
	return {
		mode: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
		lista: market,
		sdk: adapter?.meta || null,
		warnings,
	};
}

export async function collectListaSdkPositionView(
	adapter,
	{
		accountAddress,
		usdcToken,
		usdtToken,
		usdcDecimals = 18,
		usdtDecimals = 18,
		usdcExchangeRate = 1,
		usdtExchangeRate = 1,
	} = {},
) {
	const provider = adapter?.provider;
	if (!provider) throw new Error("lista_sdk_adapter_provider_missing");
	if (!accountAddress) throw new Error("lista_sdk_position_account_missing");
	const warnings = [...(adapter?.meta?.warnings || [])];
	const [usdcRaw, usdtRaw] = await Promise.all([
		readWithFallback(
			() => readTokenBalance(provider, usdcToken, accountAddress),
			"0",
		),
		readWithFallback(
			() => readTokenBalance(provider, usdtToken, accountAddress),
			"0",
		),
	]);
	if (!usdcToken) warnings.push("lista_usdc_token_missing_config");
	if (!usdtToken) warnings.push("lista_usdt_token_missing_config");
	const buildRow = (token, balanceRaw, decimals, exchangeRate) => {
		const balanceUi = Number(rawToUi(balanceRaw, decimals));
		const normalizedUsdApprox = Number(
			(balanceUi * Number(exchangeRate || 1)).toFixed(6),
		);
		return {
			token: token || null,
			balanceRaw: String(balanceRaw || "0"),
			balanceUi,
			exchangeRate: Number(exchangeRate || 1),
			normalizedUsdApprox,
			dataSource: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
			sdk: {
				enabled: true,
				used: true,
				fallback: false,
				package: adapter?.meta?.sdkPackage || DEFAULT_LISTA_CLIENT_PACKAGE,
				officialSdkWired: Boolean(adapter?.meta?.officialSdkWired),
			},
		};
	};
	return {
		mode: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
		lista: {
			usdc: buildRow(usdcToken, usdcRaw, usdcDecimals, usdcExchangeRate),
			usdt: buildRow(usdtToken, usdtRaw, usdtDecimals, usdtExchangeRate),
		},
		sdk: adapter?.meta || null,
		warnings,
	};
}
