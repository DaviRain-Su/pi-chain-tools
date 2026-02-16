/**
 * Morpho Blue adapter — LendingProtocolAdapter for Morpho Blue on Monad (and other EVM chains).
 *
 * Morpho Blue is a minimalist lending protocol with a single contract managing all markets.
 * Each market is identified by a `MarketParams` struct (loanToken, collateralToken, oracle, irm, lltv).
 *
 * This adapter uses:
 * - Morpho Blue GraphQL API (blue-api.morpho.org) for market/position reads
 * - On-chain eth_call for direct contract reads when needed
 * - ABI-encoded calldata for supply/borrow/repay/withdraw operations
 *
 * Contract: 0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee (Monad mainnet)
 */

import { type EvmNetwork, evmHttpJson } from "../runtime.js";
import type {
	BorrowParams,
	EvmCallData,
	LendingMarket,
	LendingPosition,
	LendingPositionAsset,
	LendingProtocolAdapter,
	RepayParams,
	SupplyParams,
	WithdrawParams,
} from "./lending-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MORPHO_PROTOCOL_ID = "morpho-blue";

/** Morpho Blue deployment addresses by network. */
const MORPHO_DEPLOYMENTS: Partial<Record<EvmNetwork, string>> = {
	monad: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
	// ethereum: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb", // mainnet Morpho Blue
};

const MORPHO_API_URL = "https://blue-api.morpho.org/graphql";

// -- Morpho Blue function selectors --

const SEL = {
	// Morpho Blue core
	supply: "0x73e7f8f4", // supply(MarketParams,uint256,uint256,address,bytes)
	borrow: "0x50d8cd4b", // borrow(MarketParams,uint256,uint256,address,address)
	repay: "0x4dfa44e5", // repay(MarketParams,uint256,uint256,address,bytes)
	withdraw: "0x5c2bea49", // withdraw(MarketParams,uint256,uint256,address,address)
	supplyCollateral: "0x238d6579", // supplyCollateral(MarketParams,uint256,address,bytes)
	withdrawCollateral: "0x8720316d", // withdrawCollateral(MarketParams,uint256,address,address)
	// ERC-20
	approve: "0x095ea7b3",
};

const MAX_UINT256_PADDED =
	"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

// ---------------------------------------------------------------------------
// ABI helpers
// ---------------------------------------------------------------------------

function formatRawAmount(raw: string, decimals: number): string {
	const n = BigInt(raw);
	const divisor = 10n ** BigInt(decimals);
	const whole = n / divisor;
	const frac = n % divisor;
	const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function padAddress(address: string): string {
	return address.toLowerCase().replace("0x", "").padStart(64, "0");
}

function padUint256(value: string | bigint): string {
	const hex =
		typeof value === "bigint" ? value.toString(16) : BigInt(value).toString(16);
	return hex.padStart(64, "0");
}

/**
 * Encode MarketParams struct as ABI tuple:
 * (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)
 */
function encodeMarketParams(params: {
	loanToken: string;
	collateralToken: string;
	oracle: string;
	irm: string;
	lltv: string;
}): string {
	return (
		padAddress(params.loanToken) +
		padAddress(params.collateralToken) +
		padAddress(params.oracle) +
		padAddress(params.irm) +
		padUint256(params.lltv)
	);
}

// ---------------------------------------------------------------------------
// GraphQL helpers
// ---------------------------------------------------------------------------

type MorphoApiMarket = {
	uniqueKey: string;
	morphoBlue: { address: string };
	state: {
		supplyApy: number | null;
		borrowApy: number | null;
		supplyAssetsUsd: number | null;
		borrowAssetsUsd: number | null;
	};
	loanAsset: { address: string; symbol: string; decimals: number };
	collateralAsset: {
		address: string;
		symbol: string;
		decimals: number;
	} | null;
	lltv: string;
	oracleAddress: string;
	irmAddress: string;
};

type MorphoApiPosition = {
	market: {
		uniqueKey: string;
		loanAsset: { address: string; symbol: string; decimals: number };
		collateralAsset: {
			address: string;
			symbol: string;
			decimals: number;
		} | null;
		lltv: string;
	};
	state: {
		supplyAssets: string;
		borrowAssets: string;
		collateral: string;
		supplyAssetsUsd: number | null;
		borrowAssetsUsd: number | null;
		collateralUsd: number | null;
	};
};

async function queryMorphoApi<T>(query: string): Promise<T> {
	const response = await evmHttpJson<{ data?: T; errors?: unknown[] }>({
		url: MORPHO_API_URL,
		method: "POST",
		body: { query },
		timeoutMs: 15_000,
	});
	if (response.errors) {
		throw new Error(
			`Morpho API error: ${JSON.stringify(response.errors).slice(0, 200)}`,
		);
	}
	if (!response.data) {
		throw new Error("Morpho API returned empty data");
	}
	return response.data;
}

function chainIdForNetwork(network: EvmNetwork): number {
	const map: Partial<Record<EvmNetwork, number>> = {
		monad: 143,
		ethereum: 1,
		base: 8453,
	};
	return map[network] ?? 0;
}

// ---------------------------------------------------------------------------
// MarketParams resolution
// ---------------------------------------------------------------------------

export type MorphoMarketParams = {
	loanToken: string;
	collateralToken: string;
	oracle: string;
	irm: string;
	lltv: string;
};

/**
 * Resolve full MarketParams from Morpho API by market uniqueKey + chainId.
 * This is required for all Morpho Blue on-chain operations.
 */
async function resolveMarketParams(
	network: EvmNetwork,
	marketId: string,
): Promise<MorphoMarketParams> {
	const chainId = chainIdForNetwork(network);
	const data = await queryMorphoApi<{
		market: MorphoApiMarket | null;
	}>(`{
		market(uniqueKey: "${marketId}", chainId: ${chainId}) {
			uniqueKey
			loanAsset { address }
			collateralAsset { address }
			oracleAddress
			irmAddress
			lltv
		}
	}`);

	if (!data.market) {
		throw new Error(
			`Morpho market not found: uniqueKey=${marketId} on chain ${chainId}`,
		);
	}

	const m = data.market;
	return {
		loanToken: m.loanAsset.address,
		collateralToken:
			m.collateralAsset?.address ??
			"0x0000000000000000000000000000000000000000",
		oracle: m.oracleAddress ?? "0x0000000000000000000000000000000000000000",
		irm: m.irmAddress ?? "0x0000000000000000000000000000000000000000",
		lltv: m.lltv,
	};
}

/**
 * Resolve MarketParams for the highest-TVL market that uses the given token as loanToken.
 * Used by supply/repay/withdraw which receive tokenAddress but not marketId.
 */
async function resolveMarketParamsForToken(
	network: EvmNetwork,
	tokenAddress: string,
): Promise<MorphoMarketParams> {
	const chainId = chainIdForNetwork(network);
	const data = await queryMorphoApi<{
		markets: { items: MorphoApiMarket[] };
	}>(`{
		markets(
			where: {
				chainId_in: [${chainId}]
				loanAssetAddress_in: ["${tokenAddress.toLowerCase()}"]
				supplyAssetsUsd_gte: 100
			}
			first: 1
			orderBy: SupplyAssetsUsd
			orderDirection: Desc
		) {
			items {
				uniqueKey
				loanAsset { address }
				collateralAsset { address }
				oracleAddress
				irmAddress
				lltv
			}
		}
	}`);

	const m = data.markets.items[0];
	if (!m) {
		throw new Error(
			`No Morpho market found for loanToken=${tokenAddress} on chain ${chainId}`,
		);
	}

	return {
		loanToken: m.loanAsset.address,
		collateralToken:
			m.collateralAsset?.address ??
			"0x0000000000000000000000000000000000000000",
		oracle: m.oracleAddress ?? "0x0000000000000000000000000000000000000000",
		irm: m.irmAddress ?? "0x0000000000000000000000000000000000000000",
		lltv: m.lltv,
	};
}

// ---------------------------------------------------------------------------
// Network guard
// ---------------------------------------------------------------------------

function getMorphoAddress(network: EvmNetwork): string {
	const addr = MORPHO_DEPLOYMENTS[network];
	if (!addr) {
		throw new Error(
			`Morpho Blue is not configured for network=${network}. Supported: ${Object.keys(MORPHO_DEPLOYMENTS).join(", ")}`,
		);
	}
	return addr;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export { MORPHO_PROTOCOL_ID, MORPHO_DEPLOYMENTS, MORPHO_API_URL };

// Export internals for testing
export {
	padAddress as morphoPadAddress,
	padUint256 as morphoPadUint256,
	encodeMarketParams,
	chainIdForNetwork,
	getMorphoAddress,
	resolveMarketParams,
};

export function createMorphoAdapter(): LendingProtocolAdapter {
	return {
		protocolId: MORPHO_PROTOCOL_ID,

		async getMarkets(network: EvmNetwork): Promise<LendingMarket[]> {
			getMorphoAddress(network); // validate network
			const chainId = chainIdForNetwork(network);

			const data = await queryMorphoApi<{
				markets: {
					items: MorphoApiMarket[];
				};
			}>(`{
				markets(
					where: { chainId_in: [${chainId}], supplyAssetsUsd_gte: 1000 }
					first: 50
					orderBy: SupplyAssetsUsd
					orderDirection: Desc
				) {
					items {
						uniqueKey
						morphoBlue { address }
						state { supplyApy borrowApy supplyAssetsUsd borrowAssetsUsd }
						loanAsset { address symbol decimals }
						collateralAsset { address symbol decimals }
						lltv
						oracleAddress
						irmAddress
					}
				}
			}`);

			return data.markets.items
				.filter((m) => m.loanAsset.symbol !== "UNKNOWN")
				.map((m) => {
					const lltv = Number(BigInt(m.lltv)) / 1e18;
					const collSym = m.collateralAsset?.symbol ?? "none";
					return {
						protocol: MORPHO_PROTOCOL_ID,
						network,
						marketAddress: m.uniqueKey, // Morpho uses uniqueKey as market ID
						underlyingAddress: m.loanAsset.address,
						underlyingSymbol: `${m.loanAsset.symbol}/${collSym}`,
						underlyingDecimals: m.loanAsset.decimals,
						supplyAPY: (m.state.supplyApy ?? 0) * 100,
						borrowAPY: (m.state.borrowApy ?? 0) * 100,
						totalSupply: String(m.state.supplyAssetsUsd ?? 0),
						totalBorrow: String(m.state.borrowAssetsUsd ?? 0),
						collateralFactor: lltv,
						isCollateral: lltv > 0,
						isListed: true,
						// Morpho-specific metadata
						extra: {
							uniqueKey: m.uniqueKey,
							loanToken: m.loanAsset.address,
							collateralToken: m.collateralAsset?.address ?? "",
							oracle: m.oracleAddress ?? "",
							irm: m.irmAddress ?? "",
							lltv: m.lltv,
							collateralSymbol: collSym,
							collateralDecimals: m.collateralAsset?.decimals ?? 0,
						},
					};
				});
		},

		async getAccountPosition(
			network: EvmNetwork,
			account: string,
		): Promise<LendingPosition> {
			getMorphoAddress(network);
			const chainId = chainIdForNetwork(network);

			const data = await queryMorphoApi<{
				marketPositions: {
					items: MorphoApiPosition[];
				};
			}>(`{
				marketPositions(
					where: {
						chainId_in: [${chainId}]
						userAddress_in: ["${account.toLowerCase()}"]
					}
					first: 50
				) {
					items {
						market {
							uniqueKey
							loanAsset { address symbol decimals }
							collateralAsset { address symbol decimals }
							lltv
						}
						state {
							supplyAssets
							borrowAssets
							collateral
							supplyAssetsUsd
							borrowAssetsUsd
							collateralUsd
						}
					}
				}
			}`);

			const supplies: LendingPositionAsset[] = [];
			const borrows: LendingPositionAsset[] = [];
			let totalCollateralUsd = 0;
			let totalBorrowUsd = 0;

			for (const pos of data.marketPositions.items) {
				const supplyRaw = pos.state.supplyAssets ?? "0";
				const borrowRaw = pos.state.borrowAssets ?? "0";
				const collateralRaw = pos.state.collateral ?? "0";

				if (BigInt(supplyRaw) > 0n || BigInt(collateralRaw) > 0n) {
					const usd =
						(pos.state.supplyAssetsUsd ?? 0) + (pos.state.collateralUsd ?? 0);
					totalCollateralUsd += usd;
					const dec = pos.market.loanAsset.decimals;
					supplies.push({
						marketAddress: pos.market.uniqueKey,
						underlyingAddress: pos.market.loanAsset.address,
						underlyingSymbol: pos.market.loanAsset.symbol,
						underlyingDecimals: dec,
						balanceRaw: supplyRaw,
						balanceFormatted: formatRawAmount(supplyRaw, dec),
					});
				}

				if (BigInt(borrowRaw) > 0n) {
					const borrowUsd = pos.state.borrowAssetsUsd ?? 0;
					totalBorrowUsd += borrowUsd;
					const dec = pos.market.loanAsset.decimals;
					borrows.push({
						marketAddress: pos.market.uniqueKey,
						underlyingAddress: pos.market.loanAsset.address,
						underlyingSymbol: pos.market.loanAsset.symbol,
						underlyingDecimals: dec,
						balanceRaw: borrowRaw,
						balanceFormatted: formatRawAmount(borrowRaw, dec),
					});
				}
			}

			const currentLTV =
				totalCollateralUsd > 0 ? totalBorrowUsd / totalCollateralUsd : 0;

			return {
				protocol: MORPHO_PROTOCOL_ID,
				network,
				account,
				supplies,
				borrows,
				totalCollateralValueUsd: String(totalCollateralUsd),
				totalBorrowValueUsd: String(totalBorrowUsd),
				currentLTV,
				liquidationLTV: 0.86, // most common Morpho lltv
				healthFactor:
					totalBorrowUsd > 0
						? totalCollateralUsd / totalBorrowUsd
						: Number.POSITIVE_INFINITY,
			};
		},

		async buildSupplyCalldata(params: SupplyParams): Promise<EvmCallData[]> {
			const morpho = getMorphoAddress(params.network);
			// SupplyParams doesn't have marketId — look up by tokenAddress as loanToken
			// For Morpho, caller should set tokenAddress = loanToken address
			const mp = await resolveMarketParamsForToken(
				params.network,
				params.tokenAddress,
			);
			const calldata: EvmCallData[] = [];

			// ERC-20 approve for loan token
			const approveData = `${SEL.approve}${padAddress(morpho)}${MAX_UINT256_PADDED}`;
			calldata.push({
				to: params.tokenAddress,
				data: approveData,
				description: `Approve Morpho Blue to spend ${params.tokenAddress}`,
			});

			const mpEncoded = encodeMarketParams(mp);
			// supply(MarketParams,uint256 assets,uint256 shares,address onBehalf,bytes data)
			// Dynamic bytes `data` requires ABI offset pointer
			const supplyData =
				`${SEL.supply}${mpEncoded}` +
				`${padUint256(params.amountRaw)}` + // assets
				`${padUint256("0")}` + // shares (0 = use assets)
				`${padAddress(params.account)}` + // onBehalf
				`${padUint256("224")}` + // offset to bytes data (7 * 32 = 224)
				`${padUint256("0")}`; // bytes length = 0

			calldata.push({
				to: morpho,
				data: supplyData,
				description: `Supply ${params.amountRaw} to Morpho Blue market ${mp.loanToken.slice(0, 10)}...`,
			});

			return calldata;
		},

		async buildBorrowCalldata(params: BorrowParams): Promise<EvmCallData> {
			const morpho = getMorphoAddress(params.network);
			const mp = await resolveMarketParams(
				params.network,
				params.marketAddress,
			);

			const mpEncoded = encodeMarketParams(mp);
			// borrow(MarketParams,uint256 assets,uint256 shares,address onBehalf,address receiver)
			const borrowData =
				`${SEL.borrow}${mpEncoded}` +
				`${padUint256(params.amountRaw)}` + // assets
				`${padUint256("0")}` + // shares
				`${padAddress(params.account)}` + // onBehalf
				`${padAddress(params.account)}`; // receiver

			return {
				to: morpho,
				data: borrowData,
				description: `Borrow ${params.amountRaw} from Morpho Blue market ${mp.loanToken.slice(0, 10)}...`,
			};
		},

		async buildRepayCalldata(params: RepayParams): Promise<EvmCallData[]> {
			const morpho = getMorphoAddress(params.network);
			const mp = await resolveMarketParamsForToken(
				params.network,
				params.tokenAddress,
			);
			const calldata: EvmCallData[] = [];

			// Approve
			const approveData = `${SEL.approve}${padAddress(morpho)}${MAX_UINT256_PADDED}`;
			calldata.push({
				to: params.tokenAddress,
				data: approveData,
				description: `Approve Morpho Blue to spend ${params.tokenAddress}`,
			});

			const mpEncoded = encodeMarketParams(mp);
			// repay(MarketParams,uint256 assets,uint256 shares,address onBehalf,bytes data)
			const repayData =
				`${SEL.repay}${mpEncoded}` +
				`${padUint256(params.amountRaw)}` + // assets
				`${padUint256("0")}` + // shares
				`${padAddress(params.account)}` + // onBehalf
				`${padUint256("224")}` + // offset to bytes data
				`${padUint256("0")}`; // bytes length = 0

			calldata.push({
				to: morpho,
				data: repayData,
				description: `Repay ${params.amountRaw} to Morpho Blue market ${mp.loanToken.slice(0, 10)}...`,
			});

			return calldata;
		},

		async buildWithdrawCalldata(params: WithdrawParams): Promise<EvmCallData> {
			const morpho = getMorphoAddress(params.network);
			const mp = await resolveMarketParamsForToken(
				params.network,
				params.tokenAddress,
			);

			const mpEncoded = encodeMarketParams(mp);
			// withdraw(MarketParams,uint256 assets,uint256 shares,address onBehalf,address receiver)
			const withdrawData =
				`${SEL.withdraw}${mpEncoded}` +
				`${padUint256(params.amountRaw)}` + // assets
				`${padUint256("0")}` + // shares
				`${padAddress(params.account)}` + // onBehalf
				`${padAddress(params.account)}`; // receiver

			return {
				to: morpho,
				data: withdrawData,
				description: `Withdraw ${params.amountRaw} from Morpho Blue market ${mp.loanToken.slice(0, 10)}...`,
			};
		},

		async buildEnterMarketCalldata(): Promise<EvmCallData> {
			throw new Error(
				"Morpho Blue does not have enterMarkets. Collateral is managed per-market via supplyCollateral.",
			);
		},
	};
}

// ---------------------------------------------------------------------------
// Morpho-specific operations (beyond LendingProtocolAdapter)
// ---------------------------------------------------------------------------

export type MorphoSupplyCollateralParams = {
	network: EvmNetwork;
	account: string;
	/** Morpho market uniqueKey */
	marketId: string;
	/** Collateral token address */
	collateralTokenAddress: string;
	/** Amount in raw units */
	amountRaw: string;
};

/**
 * Build calldata to supply collateral to a Morpho Blue market.
 * This is separate from `supply` — in Morpho, supply = lending, supplyCollateral = posting collateral.
 */
export async function buildMorphoSupplyCollateralCalldata(
	params: MorphoSupplyCollateralParams,
): Promise<EvmCallData[]> {
	const morpho = getMorphoAddress(params.network);
	const mp = await resolveMarketParams(params.network, params.marketId);
	const calldata: EvmCallData[] = [];

	// Approve collateral token
	const approveData = `${SEL.approve}${padAddress(morpho)}${MAX_UINT256_PADDED}`;
	calldata.push({
		to: params.collateralTokenAddress,
		data: approveData,
		description: `Approve Morpho Blue to spend collateral ${params.collateralTokenAddress}`,
	});

	const mpEncoded = encodeMarketParams(mp);
	// supplyCollateral(MarketParams,uint256 assets,address onBehalf,bytes data)
	const supplyCollData =
		`${SEL.supplyCollateral}${mpEncoded}` +
		`${padUint256(params.amountRaw)}` + // assets
		`${padAddress(params.account)}` + // onBehalf
		`${padUint256("192")}` + // offset to bytes data (6 * 32 = 192)
		`${padUint256("0")}`; // bytes length = 0

	calldata.push({
		to: morpho,
		data: supplyCollData,
		description: `Supply ${params.amountRaw} collateral to Morpho Blue market`,
	});

	return calldata;
}

export type MorphoWithdrawCollateralParams = {
	network: EvmNetwork;
	account: string;
	/** Morpho market uniqueKey */
	marketId: string;
	/** Amount in raw units */
	amountRaw: string;
};

/**
 * Build calldata to withdraw collateral from a Morpho Blue market.
 */
export async function buildMorphoWithdrawCollateralCalldata(
	params: MorphoWithdrawCollateralParams,
): Promise<EvmCallData> {
	const morpho = getMorphoAddress(params.network);
	const mp = await resolveMarketParams(params.network, params.marketId);

	const mpEncoded = encodeMarketParams(mp);
	// withdrawCollateral(MarketParams,uint256 assets,address onBehalf,address receiver)
	const withdrawCollData =
		`${SEL.withdrawCollateral}${mpEncoded}` +
		`${padUint256(params.amountRaw)}` + // assets
		`${padAddress(params.account)}` + // onBehalf
		`${padAddress(params.account)}`; // receiver

	return {
		to: morpho,
		data: withdrawCollData,
		description: `Withdraw ${params.amountRaw} collateral from Morpho Blue market`,
	};
}
