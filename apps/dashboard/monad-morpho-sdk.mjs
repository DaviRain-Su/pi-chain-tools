import { Interface } from "@ethersproject/abi";
import { JsonRpcProvider } from "@ethersproject/providers";

function formatUnits(raw, decimals) {
	const value = BigInt(raw || "0");
	const base = 10n ** BigInt(decimals);
	const whole = value / base;
	const fraction = value % base;
	const fractionText = fraction.toString().padStart(decimals, "0").slice(0, 6);
	return `${whole}.${fractionText}`.replace(/\.0+$/, "").replace(/\.$/, "");
}

function safeBigInt(input, fallback = 0n) {
	try {
		return BigInt(String(input ?? "0"));
	} catch {
		return fallback;
	}
}

function riskBandFromScore(score) {
	if (score >= 70) return "high";
	if (score >= 40) return "medium";
	return "low";
}

export function createMorphoSdkAdapter({
	rpcUrl,
	chainId,
	vaults = [],
	asset,
	assetDecimals = 18,
	apyBps = 0,
	riskScore = 45,
	liquidityCapRaw = "",
	sdkApiBaseUrl = "",
	sdkPackage = "",
} = {}) {
	const provider = new JsonRpcProvider(String(rpcUrl || ""), {
		name: "monad",
		chainId: Number(chainId || 0),
	});
	return {
		provider,
		config: {
			rpcUrl: String(rpcUrl || ""),
			chainId: Number(chainId || 0),
			vaults: [...vaults],
			asset: String(asset || ""),
			assetDecimals: Number(assetDecimals || 18),
			apyBps: Number(apyBps || 0),
			riskScore: Number(riskScore || 45),
			liquidityCapRaw: String(liquidityCapRaw || "").trim() || null,
			sdkApiBaseUrl: String(sdkApiBaseUrl || "").trim() || null,
			sdkPackage: String(sdkPackage || "").trim() || null,
		},
		meta: {
			client: "adapter-scaffold",
			officialSdkWired: false,
			warnings: ["official_morpho_sdk_not_wired_using_provider_scaffold"],
		},
	};
}

export async function fetchMorphoVaults(adapter) {
	const configured = Array.isArray(adapter?.config?.vaults)
		? adapter.config.vaults
		: [];
	return configured.map((vault) => ({
		vault,
		asset: adapter?.config?.asset || null,
		source: "config",
	}));
}

export async function fetchMorphoMarketMetrics(adapter, { vaults = [] } = {}) {
	const iface = new Interface([
		"function totalAssets() view returns (uint256)",
		"function totalSupply() view returns (uint256)",
		"function asset() view returns (address)",
	]);
	const metrics = [];
	for (const row of vaults) {
		const vault = String(row?.vault || "").trim();
		if (!vault) continue;
		try {
			const callRead = async (data) =>
				await adapter.provider.call({ to: vault, data });
			const [totalAssetsRawData, totalSupplyRawData, assetData] =
				await Promise.all([
					callRead(iface.encodeFunctionData("totalAssets", [])),
					callRead(iface.encodeFunctionData("totalSupply", [])),
					callRead(iface.encodeFunctionData("asset", [])),
				]);
			metrics.push({
				vault,
				tvlRaw:
					iface
						.decodeFunctionResult("totalAssets", totalAssetsRawData)?.[0]
						?.toString() || "0",
				totalSupplyRaw:
					iface
						.decodeFunctionResult("totalSupply", totalSupplyRawData)?.[0]
						?.toString() || "0",
				asset:
					iface.decodeFunctionResult("asset", assetData)?.[0] ||
					adapter?.config?.asset ||
					null,
			});
		} catch (error) {
			metrics.push({
				vault,
				error: error instanceof Error ? error.message : String(error),
				tvlRaw: "0",
				totalSupplyRaw: "0",
				asset: adapter?.config?.asset || null,
			});
		}
	}
	return metrics;
}

export async function fetchUserPositions(
	adapter,
	{ accountAddress = "", vaults = [] } = {},
) {
	if (!accountAddress) return [];
	const iface = new Interface([
		"function balanceOf(address owner) view returns (uint256)",
	]);
	const rows = [];
	for (const row of vaults) {
		const vault = String(row?.vault || "").trim();
		if (!vault) continue;
		try {
			const raw = await adapter.provider.call({
				to: vault,
				data: iface.encodeFunctionData("balanceOf", [accountAddress]),
			});
			rows.push({
				vault,
				userSharesRaw:
					iface.decodeFunctionResult("balanceOf", raw)?.[0]?.toString() || "0",
			});
		} catch (error) {
			rows.push({
				vault,
				userSharesRaw: "0",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return rows;
}

export function normalizeMorphoMarketData(
	adapter,
	{ vaults = [], metrics = [], userPositions = [] } = {},
) {
	const metricByVault = new Map(
		metrics.map((row) => [String(row?.vault || "").toLowerCase(), row]),
	);
	const positionByVault = new Map(
		userPositions.map((row) => [String(row?.vault || "").toLowerCase(), row]),
	);
	const apyBps = Number(adapter?.config?.apyBps || 0);
	const riskScore = Number(adapter?.config?.riskScore || 45);
	const decimals = Number(adapter?.config?.assetDecimals || 18);
	const riskBand = riskBandFromScore(riskScore);

	return vaults.map((row) => {
		const vault = String(row?.vault || "");
		const metric = metricByVault.get(vault.toLowerCase()) || {};
		const pos = positionByVault.get(vault.toLowerCase()) || {};
		const tvlRaw = String(metric?.tvlRaw || "0");
		const userSharesRaw = String(pos?.userSharesRaw || "0");
		const warnings = [
			...(metric?.error ? ["vault_metric_read_failed"] : []),
			...(pos?.error ? ["user_position_read_failed"] : []),
		];
		return {
			vault,
			asset: metric?.asset || adapter?.config?.asset || null,
			tvlRaw,
			tvl: formatUnits(tvlRaw, decimals),
			totalSupplyRaw: String(metric?.totalSupplyRaw || "0"),
			userSharesRaw,
			userShares: formatUnits(userSharesRaw, decimals),
			apyBps,
			apy: `${(apyBps / 100).toFixed(2)}%`,
			risk: {
				score: riskScore,
				band: riskBand,
			},
			liquidityCapRaw: adapter?.config?.liquidityCapRaw || null,
			liquidityRaw: tvlRaw,
			warnings,
			error: metric?.error || null,
			normalized: {
				apyBps,
				tvlRaw,
				liquidityRaw: tvlRaw,
				riskScore,
				riskBand,
				userSharesRaw,
			},
		};
	});
}

export function normalizeMarketsForStrategy(markets = []) {
	return (Array.isArray(markets) ? markets : []).map((row) => ({
		...row,
		apyBps: Number(row?.apyBps || row?.normalized?.apyBps || 0),
		tvlRaw: String(
			row?.tvlRaw || row?.liquidityRaw || row?.normalized?.tvlRaw || "0",
		),
		liquidityRaw: String(
			row?.liquidityRaw || row?.tvlRaw || row?.normalized?.liquidityRaw || "0",
		),
		risk: {
			score: Number(row?.risk?.score || row?.normalized?.riskScore || 50),
			band:
				row?.risk?.band ||
				row?.normalized?.riskBand ||
				riskBandFromScore(
					Number(row?.risk?.score || row?.normalized?.riskScore || 50),
				),
		},
	}));
}

export async function collectMonadMorphoSdkSnapshot(
	config,
	{ accountAddress = "" } = {},
) {
	const adapter = createMorphoSdkAdapter(config);
	const vaults = await fetchMorphoVaults(adapter);
	const [metrics, userPositions] = await Promise.all([
		fetchMorphoMarketMetrics(adapter, { vaults }),
		fetchUserPositions(adapter, { accountAddress, vaults }),
	]);
	const markets = normalizeMorphoMarketData(adapter, {
		vaults,
		metrics,
		userPositions,
	});
	const warnings = [];
	if (!adapter.meta.officialSdkWired) {
		warnings.push("sdk_scaffold_mode_enabled");
	}
	const metricFailures = markets.filter((row) => row.error).length;
	if (metricFailures > 0) warnings.push("partial_market_fetch_failure");
	return {
		mode: adapter.meta.officialSdkWired ? "sdk" : "sdk-scaffold",
		warnings,
		meta: adapter.meta,
		markets,
		strategyMarkets: normalizeMarketsForStrategy(markets),
		stats: {
			vaultCount: vaults.length,
			metricFailures,
			totalUserSharesRaw: markets
				.reduce((acc, row) => acc + safeBigInt(row.userSharesRaw), 0n)
				.toString(),
		},
	};
}
