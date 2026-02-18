import { Interface } from "@ethersproject/abi";
import { JsonRpcProvider } from "@ethersproject/providers";

// TODO(sdk-coverage): migrate from configx metadata client to a full official Wombat execute/read SDK when available.
// Current package provides canonical config metadata only; runtime still needs ethers RPC for balances/execution.
const DEFAULT_WOMBAT_SDK_PACKAGE = "@wombat-exchange/configx";

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
	return text || DEFAULT_WOMBAT_SDK_PACKAGE;
}

async function tryLoadSdkPackage(packageName) {
	const normalized = normalizeSdkPackageName(packageName);
	try {
		const mod = await import(normalized);
		return {
			loaded: true,
			packageName: normalized,
			moduleKeys: Object.keys(mod || {}),
			error: null,
		};
	} catch (error) {
		return {
			loaded: false,
			packageName: normalized,
			moduleKeys: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
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

export async function createWombatSdkAdapter({
	rpcUrl,
	chainId,
	sdkPackage,
	loadSdkPackage,
} = {}) {
	const provider = new JsonRpcProvider(String(rpcUrl || ""), {
		name: "bsc",
		chainId: Number(chainId || 56),
	});
	const sdkLoader =
		typeof loadSdkPackage === "function" ? loadSdkPackage : tryLoadSdkPackage;
	const sdk = await sdkLoader(sdkPackage);
	const warnings = [];
	if (!sdk.loaded) {
		warnings.push(
			"official_wombat_client_package_not_available_using_scaffold_provider_path",
		);
	}
	return {
		provider,
		config: {
			rpcUrl: String(rpcUrl || ""),
			chainId: Number(chainId || 56),
			sdkPackage: sdk.packageName,
		},
		meta: {
			client: sdk.loaded ? "wombat-configx" : "wombat-sdk-scaffold",
			officialSdkWired: sdk.loaded,
			sdkPackage: sdk.packageName,
			sdkError: sdk.error,
			moduleKeys: sdk.moduleKeys,
			warnings,
		},
	};
}

export async function collectWombatSdkMarketView(
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
	if (!provider) throw new Error("wombat_sdk_adapter_provider_missing");
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
	if (!poolAddress) warnings.push("wombat_pool_missing_config");
	if (!usdcToken) warnings.push("wombat_usdc_token_missing_config");
	if (!usdtToken) warnings.push("wombat_usdt_token_missing_config");
	if (!adapter?.meta?.officialSdkWired) {
		warnings.push("wombat_sdk_scaffold_mode_enabled");
	}
	const market = {
		source: String(aprHints?.source || "wombat-sdk-scaffold"),
		usdtSupplyAprBps: resolvedUsdtApr,
		usdcSupplyAprBps: resolvedUsdcApr,
		updatedAt: String(aprHints?.updatedAt || new Date().toISOString()),
		dataSource: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
		sdk: {
			enabled: true,
			used: true,
			fallback: false,
			package: adapter?.meta?.sdkPackage || null,
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
		wombat: market,
		sdk: adapter?.meta || null,
		warnings,
	};
}

export async function collectWombatSdkPositionView(
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
	if (!provider) throw new Error("wombat_sdk_adapter_provider_missing");
	if (!accountAddress) throw new Error("wombat_sdk_position_account_missing");
	const warnings = [];
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
	if (!usdcToken) warnings.push("wombat_usdc_token_missing_config");
	if (!usdtToken) warnings.push("wombat_usdt_token_missing_config");
	if (!adapter?.meta?.officialSdkWired) {
		warnings.push("wombat_sdk_scaffold_mode_enabled");
	}
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
				package: adapter?.meta?.sdkPackage || null,
				officialSdkWired: Boolean(adapter?.meta?.officialSdkWired),
			},
		};
	};
	return {
		mode: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
		wombat: {
			usdc: buildRow(usdcToken, usdcRaw, usdcDecimals, usdcExchangeRate),
			usdt: buildRow(usdtToken, usdtRaw, usdtDecimals, usdtExchangeRate),
		},
		sdk: adapter?.meta || null,
		warnings,
	};
}
