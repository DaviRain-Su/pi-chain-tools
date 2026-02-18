import { Interface } from "@ethersproject/abi";
import { MaxUint256 } from "@ethersproject/constants";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";

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

function isHexAddress(value) {
	return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function parseRewardsJsonInput(input) {
	if (Array.isArray(input)) return input;
	if (typeof input === "string" && input.trim()) {
		try {
			const parsed = JSON.parse(input);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

function shellQuote(value) {
	const text = String(value ?? "");
	if (!text) return "''";
	return `'${text.replace(/'/g, `'"'"'`)}'`;
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
	rewardsJson = [],
	rewardsClaimCommand = "",
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
			rewardsJson: parseRewardsJsonInput(rewardsJson),
			rewardsClaimCommand: String(rewardsClaimCommand || "").trim(),
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

export async function fetchRewards(
	adapter,
	{ accountAddress = "", vault = "" } = {},
) {
	const requestedVault = String(vault || "")
		.trim()
		.toLowerCase();
	const rows = parseRewardsJsonInput(adapter?.config?.rewardsJson);
	const normalized = rows
		.map((row, index) => {
			const rewardVault = String(row?.vault || "").trim();
			const rewardToken = String(
				row?.rewardToken || row?.token || row?.tokenAddress || "",
			).trim();
			const campaign = String(
				row?.campaign ||
					row?.campaignId ||
					row?.campaignName ||
					`campaign-${index}`,
			).trim();
			const claimableRaw = String(
				row?.claimableRaw || row?.amountRaw || row?.claimable || "0",
			).trim();
			const decimals = Number.isFinite(Number(row?.decimals))
				? Number(row.decimals)
				: Number(adapter?.config?.assetDecimals || 18);
			return {
				campaign,
				token: rewardToken,
				rewardToken,
				vault: rewardVault,
				account: String(accountAddress || row?.account || "").trim() || null,
				claimableRaw,
				claimable: formatUnits(claimableRaw, Math.max(0, decimals)),
				decimals,
				source: String(row?.source || "config").trim(),
			};
		})
		.filter((row) => {
			if (!requestedVault) return true;
			return String(row?.vault || "").toLowerCase() === requestedVault;
		});
	const totalClaimableRaw = normalized
		.reduce((acc, row) => acc + safeBigInt(row?.claimableRaw || "0"), 0n)
		.toString();
	const warnings = [];
	if (!adapter?.meta?.officialSdkWired) {
		warnings.push("sdk_scaffold_mode_enabled");
	}
	if (!accountAddress)
		warnings.push("account_not_provided_rewards_best_effort");
	return {
		mode: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
		warnings,
		meta: adapter?.meta || null,
		rewards: normalized,
		tracking: {
			source: "sdk-adapter",
			count: normalized.length,
			totalClaimableRaw,
		},
		filters: {
			accountAddress: accountAddress || null,
			vault: vault || null,
		},
	};
}

export function buildRewardsClaimRequest(
	adapter,
	{
		accountAddress = "",
		vault = "",
		campaign = "",
		token = "",
		runId = "",
	} = {},
) {
	const resolvedVault = String(vault || "").trim();
	if (!isHexAddress(resolvedVault)) {
		return {
			ok: false,
			code: "MONAD_MORPHO_REWARDS_CLAIM_INVALID_VAULT",
			retryable: false,
			category: "input",
			message: "vault must be a valid 0x address",
		};
	}
	const commandTemplate = String(
		adapter?.config?.rewardsClaimCommand || "",
	).trim();
	if (!commandTemplate) {
		return {
			ok: false,
			code: "MONAD_MORPHO_REWARDS_CLAIM_BLOCKED",
			retryable: false,
			category: "config",
			message: "rewards claim command template is not configured",
		};
	}
	const replacements = {
		"{account}": shellQuote(accountAddress || ""),
		"{vault}": shellQuote(resolvedVault),
		"{campaign}": shellQuote(campaign || ""),
		"{token}": shellQuote(token || ""),
		"{runId}": shellQuote(runId || ""),
	};
	let command = commandTemplate;
	for (const [key, value] of Object.entries(replacements)) {
		command = command.replaceAll(key, value);
	}
	return {
		ok: true,
		mode: adapter?.meta?.officialSdkWired ? "sdk" : "sdk-scaffold",
		claimRequest: {
			accountAddress: accountAddress || null,
			vault: resolvedVault,
			campaign: campaign || null,
			token: token || null,
			runId: runId || null,
		},
		command,
		commandPreview: command.slice(0, 180),
	};
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

export async function executeMorphoDepositWithSdk(
	config,
	{ privateKey, amountRaw, vault, asset, confirmations = 1, runId = null } = {},
) {
	const adapter = createMorphoSdkAdapter(config);
	const resolvedVault = String(
		vault || adapter?.config?.vaults?.[0] || "",
	).trim();
	const resolvedAsset = String(asset || adapter?.config?.asset || "").trim();
	if (!resolvedVault || !isHexAddress(resolvedVault)) {
		throw new Error(
			"MONAD_MORPHO_CONFIG retryable=false message=missing_monad_morpho_vault",
		);
	}
	if (!resolvedAsset || !isHexAddress(resolvedAsset)) {
		throw new Error(
			"MONAD_MORPHO_CONFIG retryable=false message=missing_monad_morpho_asset",
		);
	}
	const safeAmountRaw = String(amountRaw || "").trim();
	if (!/^\d+$/.test(safeAmountRaw) || BigInt(safeAmountRaw) <= 0n) {
		throw new Error(
			"MONAD_MORPHO_CONFIG retryable=false message=amount_invalid",
		);
	}
	const signer = new Wallet(String(privateKey || ""), adapter.provider);
	const account = signer.address;
	const erc20Iface = new Interface([
		"function allowance(address owner,address spender) view returns (uint256)",
		"function approve(address spender,uint256 value) returns (bool)",
		"function balanceOf(address owner) view returns (uint256)",
	]);
	const vaultIface = new Interface([
		"function deposit(uint256 assets,address receiver) returns (uint256 shares)",
		"function balanceOf(address owner) view returns (uint256)",
	]);
	const readBalance = async () => {
		const [assetRawData, sharesRawData] = await Promise.all([
			adapter.provider.call({
				to: resolvedAsset,
				data: erc20Iface.encodeFunctionData("balanceOf", [account]),
			}),
			adapter.provider.call({
				to: resolvedVault,
				data: vaultIface.encodeFunctionData("balanceOf", [account]),
			}),
		]);
		return {
			assetRaw:
				erc20Iface
					.decodeFunctionResult("balanceOf", assetRawData)?.[0]
					?.toString() || "0",
			sharesRaw:
				vaultIface
					.decodeFunctionResult("balanceOf", sharesRawData)?.[0]
					?.toString() || "0",
		};
	};
	const before = await readBalance();
	const allowanceRawData = await adapter.provider.call({
		to: resolvedAsset,
		data: erc20Iface.encodeFunctionData("allowance", [account, resolvedVault]),
	});
	const allowance = BigInt(
		erc20Iface
			.decodeFunctionResult("allowance", allowanceRawData)?.[0]
			?.toString() || "0",
	);
	const approveTxHashes = [];
	if (allowance < BigInt(safeAmountRaw)) {
		const approveTx = await signer.sendTransaction({
			to: resolvedAsset,
			data: erc20Iface.encodeFunctionData("approve", [
				resolvedVault,
				MaxUint256,
			]),
		});
		await approveTx.wait(Math.max(1, Number(confirmations || 1)));
		approveTxHashes.push(approveTx.hash);
	}
	const depositTx = await signer.sendTransaction({
		to: resolvedVault,
		data: vaultIface.encodeFunctionData("deposit", [safeAmountRaw, account]),
	});
	const receipt = await depositTx.wait(Math.max(1, Number(confirmations || 1)));
	const after = await readBalance();
	return {
		mode: adapter.meta.officialSdkWired ? "sdk" : "sdk-scaffold",
		sdk: {
			enabled: true,
			used: true,
			fallback: false,
			meta: adapter.meta,
		},
		runId: runId || null,
		txHash: depositTx.hash,
		account,
		vault: resolvedVault,
		asset: resolvedAsset,
		amountRaw: safeAmountRaw,
		before,
		after,
		receipt: {
			transactionHash: receipt?.transactionHash || depositTx.hash,
			blockNumber: receipt?.blockNumber || null,
			confirmations: Math.max(1, Number(confirmations || 1)),
			approveTxHashes,
		},
	};
}
