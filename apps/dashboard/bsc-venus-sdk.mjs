import { Interface } from "@ethersproject/abi";
import { JsonRpcProvider } from "@ethersproject/providers";
import {
	MainnetChainId,
	vTokens as venusChainVTokens,
} from "@venusprotocol/chains";

function safeBigInt(value, fallback = 0n) {
	try {
		return BigInt(String(value ?? "0"));
	} catch {
		return fallback;
	}
}

function formatUnits(raw, decimals) {
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

// TODO(sdk-coverage): switch to official @venusprotocol/sdk when it becomes publicly available on npm.
// Current path uses official canonical metadata package + provider ABI reads/execution for safety.
const DEFAULT_VENUS_SDK_PACKAGE = "@venusprotocol/chains";

function normalizeSdkPackageName(input) {
	const text = String(input || "").trim();
	return text || DEFAULT_VENUS_SDK_PACKAGE;
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

export function resolveDefaultBscVToken(symbol) {
	const entries = Array.isArray(venusChainVTokens?.[MainnetChainId.BSC_MAINNET])
		? venusChainVTokens[MainnetChainId.BSC_MAINNET]
		: [];
	const upper = String(symbol || "")
		.trim()
		.toUpperCase();
	if (!upper) return null;
	return (
		entries.find((entry) => {
			const vTokenSymbol = String(entry?.symbol || "").toUpperCase();
			const underlyingSymbol = String(
				entry?.underlyingToken?.symbol || "",
			).toUpperCase();
			return vTokenSymbol === `V${upper}` || underlyingSymbol === upper;
		}) || null
	);
}

export async function createVenusSdkAdapter({
	rpcUrl,
	chainId,
	comptroller,
	sdkPackage,
} = {}) {
	const provider = new JsonRpcProvider(String(rpcUrl || ""), {
		name: "bsc",
		chainId: Number(chainId || 56),
	});
	const sdk = await tryLoadSdkPackage(sdkPackage);
	const warnings = [];
	if (!sdk.loaded) {
		warnings.push(
			"official_venus_client_package_not_available_using_scaffold_provider_path",
		);
	}
	return {
		provider,
		config: {
			rpcUrl: String(rpcUrl || ""),
			chainId: Number(chainId || 56),
			comptroller: String(comptroller || "").trim() || null,
			sdkPackage: sdk.packageName,
		},
		meta: {
			client: sdk.loaded ? "venus-sdk" : "venus-sdk-scaffold",
			officialSdkWired: sdk.loaded,
			sdkPackage: sdk.packageName,
			sdkError: sdk.error,
			moduleKeys: sdk.moduleKeys,
			warnings,
		},
	};
}

async function readWithFallback(callFn, fallback = null) {
	try {
		return await callFn();
	} catch {
		return fallback;
	}
}

async function readVenusTokenSnapshot(provider, vToken, accountAddress = "") {
	const iface = new Interface([
		"function balanceOf(address owner) view returns (uint256)",
		"function exchangeRateStored() view returns (uint256)",
		"function borrowBalanceStored(address account) view returns (uint256)",
		"function cash() view returns (uint256)",
		"function totalBorrows() view returns (uint256)",
		"function totalReserves() view returns (uint256)",
	]);
	const readCall = async (method, args = []) => {
		const raw = await provider.call({
			to: vToken,
			data: iface.encodeFunctionData(method, args),
		});
		return iface.decodeFunctionResult(method, raw)?.[0]?.toString() || "0";
	};
	const [exchangeRateRaw, totalBorrowsRaw, totalReservesRaw, cashRaw] =
		await Promise.all([
			readWithFallback(
				() => readCall("exchangeRateStored"),
				"1000000000000000000",
			),
			readWithFallback(() => readCall("totalBorrows"), "0"),
			readWithFallback(() => readCall("totalReserves"), "0"),
			readWithFallback(() => readCall("cash"), "0"),
		]);
	const userVTokenRaw = accountAddress
		? await readWithFallback(() => readCall("balanceOf", [accountAddress]), "0")
		: "0";
	const userBorrowRaw = accountAddress
		? await readWithFallback(
				() => readCall("borrowBalanceStored", [accountAddress]),
				"0",
			)
		: "0";
	const exchangeRate = safeBigInt(exchangeRateRaw, 0n);
	const userUnderlyingRaw =
		exchangeRate > 0n
			? ((safeBigInt(userVTokenRaw, 0n) * exchangeRate) / 10n ** 18n).toString()
			: "0";
	return {
		vToken,
		userVTokenRaw,
		userUnderlyingRaw,
		userBorrowRaw,
		exchangeRateRaw: String(exchangeRateRaw || "0"),
		market: {
			cashRaw: String(cashRaw || "0"),
			totalBorrowsRaw: String(totalBorrowsRaw || "0"),
			totalReservesRaw: String(totalReservesRaw || "0"),
		},
	};
}

async function readComptrollerMarket(provider, comptroller, vToken) {
	const fallback = {
		collateralFactorMantissa: null,
		isListed: null,
	};
	if (!comptroller) return fallback;
	const iface = new Interface([
		"function markets(address vToken) view returns (bool isListed, uint256 collateralFactorMantissa, bool isComped)",
	]);
	const value = await readWithFallback(async () => {
		const raw = await provider.call({
			to: comptroller,
			data: iface.encodeFunctionData("markets", [vToken]),
		});
		const decoded = iface.decodeFunctionResult("markets", raw);
		return {
			isListed: Boolean(decoded?.isListed ?? decoded?.[0]),
			collateralFactorMantissa: String(
				decoded?.collateralFactorMantissa ?? decoded?.[1] ?? "0",
			),
		};
	}, fallback);
	return value || fallback;
}

function computeUtilizationBps(cashRaw, borrowsRaw, reservesRaw) {
	const cash = safeBigInt(cashRaw, 0n);
	const borrows = safeBigInt(borrowsRaw, 0n);
	const reserves = safeBigInt(reservesRaw, 0n);
	const denom = cash + borrows - reserves;
	if (denom <= 0n) return 0;
	return Number((borrows * 10_000n) / denom);
}

export async function collectVenusSdkMarketView(
	adapter,
	{
		usdcVToken,
		usdtVToken,
		aprHints = null,
		usdcDecimals = 18,
		usdtDecimals = 18,
	} = {},
) {
	const warnings = [];
	const provider = adapter?.provider;
	if (!provider) throw new Error("venus_sdk_adapter_provider_missing");
	const defaultUsdcVToken = resolveDefaultBscVToken("USDC");
	const defaultUsdtVToken = resolveDefaultBscVToken("USDT");
	const resolvedUsdcVToken =
		String(usdcVToken || "").trim() || defaultUsdcVToken?.address || "";
	const resolvedUsdtVToken =
		String(usdtVToken || "").trim() || defaultUsdtVToken?.address || "";
	if (!String(usdcVToken || "").trim() && resolvedUsdcVToken) {
		warnings.push("venus_usdc_vtoken_defaulted_from_official_registry");
	}
	if (!String(usdtVToken || "").trim() && resolvedUsdtVToken) {
		warnings.push("venus_usdt_vtoken_defaulted_from_official_registry");
	}
	const [usdcToken, usdtToken] = await Promise.all([
		resolvedUsdcVToken
			? readVenusTokenSnapshot(provider, resolvedUsdcVToken)
			: Promise.resolve(null),
		resolvedUsdtVToken
			? readVenusTokenSnapshot(provider, resolvedUsdtVToken)
			: Promise.resolve(null),
	]);
	if (!usdcToken) warnings.push("venus_usdc_vtoken_missing_config");
	if (!usdtToken) warnings.push("venus_usdt_vtoken_missing_config");
	const [usdcComptroller, usdtComptroller] = await Promise.all([
		usdcToken
			? readComptrollerMarket(
					provider,
					adapter?.config?.comptroller,
					String(usdcToken.vToken),
				)
			: Promise.resolve(null),
		usdtToken
			? readComptrollerMarket(
					provider,
					adapter?.config?.comptroller,
					String(usdtToken.vToken),
				)
			: Promise.resolve(null),
	]);
	const riskMetrics = {
		usdc: usdcToken
			? {
					utilizationBps: computeUtilizationBps(
						usdcToken.market.cashRaw,
						usdcToken.market.totalBorrowsRaw,
						usdcToken.market.totalReservesRaw,
					),
					collateralFactorBps: usdcComptroller?.collateralFactorMantissa
						? Number(
								(safeBigInt(usdcComptroller.collateralFactorMantissa, 0n) *
									10_000n) /
									10n ** 18n,
							)
						: null,
					isListed: usdcComptroller?.isListed ?? null,
				}
			: null,
		usdt: usdtToken
			? {
					utilizationBps: computeUtilizationBps(
						usdtToken.market.cashRaw,
						usdtToken.market.totalBorrowsRaw,
						usdtToken.market.totalReservesRaw,
					),
					collateralFactorBps: usdtComptroller?.collateralFactorMantissa
						? Number(
								(safeBigInt(usdtComptroller.collateralFactorMantissa, 0n) *
									10_000n) /
									10n ** 18n,
							)
						: null,
					isListed: usdtComptroller?.isListed ?? null,
				}
			: null,
	};
	if (!adapter?.meta?.officialSdkWired) {
		warnings.push("venus_sdk_scaffold_mode_enabled");
	}
	return {
		mode: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
		warnings,
		sdk: adapter?.meta || null,
		venus: {
			source: String(aprHints?.source || "venus-sdk-scaffold"),
			usdtSupplyAprBps: Number(aprHints?.usdtSupplyAprBps || 0),
			usdcSupplyAprBps: Number(aprHints?.usdcSupplyAprBps || 0),
			updatedAt: String(aprHints?.updatedAt || new Date().toISOString()),
			dataSource: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
			sdk: {
				enabled: true,
				used: true,
				official: adapter?.meta?.officialSdkWired === true,
				package: adapter?.meta?.sdkPackage || null,
			},
			warnings,
			riskMetrics,
			marketStats: {
				usdc: usdcToken
					? {
							vToken: usdcToken.vToken,
							totalBorrowsRaw: usdcToken.market.totalBorrowsRaw,
							totalReservesRaw: usdcToken.market.totalReservesRaw,
							cashRaw: usdcToken.market.cashRaw,
							exchangeRateRaw: usdcToken.exchangeRateRaw,
						}
					: null,
				usdt: usdtToken
					? {
							vToken: usdtToken.vToken,
							totalBorrowsRaw: usdtToken.market.totalBorrowsRaw,
							totalReservesRaw: usdtToken.market.totalReservesRaw,
							cashRaw: usdtToken.market.cashRaw,
							exchangeRateRaw: usdtToken.exchangeRateRaw,
						}
					: null,
			},
			preview: {
				usdcUnderlyingUi: usdcToken
					? Number(formatUnits(usdcToken.userUnderlyingRaw, usdcDecimals))
					: 0,
				usdtUnderlyingUi: usdtToken
					? Number(formatUnits(usdtToken.userUnderlyingRaw, usdtDecimals))
					: 0,
			},
		},
	};
}

export async function collectVenusSdkPositionView(
	adapter,
	{
		accountAddress,
		usdcVToken,
		usdtVToken,
		usdcDecimals = 18,
		usdtDecimals = 18,
	} = {},
) {
	const warnings = [];
	if (!accountAddress) {
		warnings.push("venus_account_missing_sdk_position_best_effort");
	}
	const defaultUsdcVToken = resolveDefaultBscVToken("USDC");
	const defaultUsdtVToken = resolveDefaultBscVToken("USDT");
	const resolvedUsdcVToken =
		String(usdcVToken || "").trim() || defaultUsdcVToken?.address || "";
	const resolvedUsdtVToken =
		String(usdtVToken || "").trim() || defaultUsdtVToken?.address || "";
	if (!String(usdcVToken || "").trim() && resolvedUsdcVToken) {
		warnings.push("venus_usdc_vtoken_defaulted_from_official_registry");
	}
	if (!String(usdtVToken || "").trim() && resolvedUsdtVToken) {
		warnings.push("venus_usdt_vtoken_defaulted_from_official_registry");
	}
	const [usdc, usdt] = await Promise.all([
		resolvedUsdcVToken
			? readVenusTokenSnapshot(
					adapter.provider,
					resolvedUsdcVToken,
					accountAddress,
				)
			: Promise.resolve(null),
		resolvedUsdtVToken
			? readVenusTokenSnapshot(
					adapter.provider,
					resolvedUsdtVToken,
					accountAddress,
				)
			: Promise.resolve(null),
	]);
	if (!usdc) warnings.push("venus_usdc_vtoken_missing_config");
	if (!usdt) warnings.push("venus_usdt_vtoken_missing_config");
	if (!adapter?.meta?.officialSdkWired) {
		warnings.push("venus_sdk_scaffold_mode_enabled");
	}
	const mapTokenRow = (row, decimals, symbol) => {
		if (!row) {
			return {
				token: null,
				missingConfig: true,
				configKey:
					symbol === "USDC" ? "BSC_VENUS_VTOKEN_USDC" : "BSC_VENUS_VTOKEN_USDT",
				balanceUi: 0,
				normalizedUsdApprox: 0,
				exchangeRate: 1,
				ok: true,
				dataSource: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
			};
		}
		const balanceUi = Number(formatUnits(row.userUnderlyingRaw, decimals));
		return {
			token: row.vToken,
			balanceRaw: row.userUnderlyingRaw,
			balanceUi,
			normalizedUsdApprox: Number(balanceUi.toFixed(6)),
			exchangeRate: 1,
			ok: true,
			borrowRaw: row.userBorrowRaw,
			borrowUi: Number(formatUnits(row.userBorrowRaw, decimals)),
			vTokenBalanceRaw: row.userVTokenRaw,
			vTokenExchangeRateRaw: row.exchangeRateRaw,
			dataSource: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
			sdk: {
				enabled: true,
				used: true,
				official: adapter?.meta?.officialSdkWired === true,
				package: adapter?.meta?.sdkPackage || null,
			},
			warnings,
		};
	};
	return {
		mode: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
		warnings,
		sdk: adapter?.meta || null,
		venus: {
			usdc: mapTokenRow(usdc, usdcDecimals, "USDC"),
			usdt: mapTokenRow(usdt, usdtDecimals, "USDT"),
		},
	};
}
