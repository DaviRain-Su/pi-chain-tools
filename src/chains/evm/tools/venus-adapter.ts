/**
 * Venus Protocol adapter (Compound V2 fork on BSC).
 *
 * All on-chain reads use raw `eth_call` via the existing EVM RPC infrastructure,
 * no external SDK dependency. Transaction calldata is ABI-encoded manually using
 * known function selectors.
 */

import { type EvmNetwork, evmHttpJson, getEvmRpcEndpoint } from "../runtime.js";
import type {
	BorrowParams,
	EnterMarketParams,
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

const VENUS_PROTOCOL_ID = "venus";

/** Blocks per year on BSC (~3 s/block). */
const BSC_BLOCKS_PER_YEAR = 10_512_000;

/** Zero address placeholder used for native BNB underlying. */
const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// -- Contract addresses (BSC mainnet) --

const VENUS_COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384";
const VENUS_VBNB = "0xA07c5b74C9B40447a954e1466938b865b6BBea36";

/** Well-known Venus markets on BSC mainnet. */
const VENUS_MARKET_REGISTRY: Record<
	string,
	{ vToken: string; underlying: string; symbol: string; decimals: number }
> = {
	vBNB: {
		vToken: "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
		underlying: NATIVE_ADDRESS,
		symbol: "BNB",
		decimals: 18,
	},
	vUSDC: {
		vToken: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
		underlying: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
		symbol: "USDC",
		decimals: 18,
	},
	vUSDT: {
		vToken: "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
		underlying: "0x55d398326f99059fF775485246999027B3197955",
		symbol: "USDT",
		decimals: 18,
	},
	vBTCB: {
		vToken: "0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B",
		underlying: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
		symbol: "BTCB",
		decimals: 18,
	},
	vETH: {
		vToken: "0xf508fCD89b8bd15579dc79A6827cB4686A3592c8",
		underlying: "0x2170Ed0880ac9A755fd29B2688956BD959F933f8",
		symbol: "ETH",
		decimals: 18,
	},
};

// -- Function selectors --

const SEL = {
	// vToken
	mint: "0xa0712d68",
	redeem: "0xdb006a75",
	redeemUnderlying: "0x852a12e3",
	borrow: "0xc5ebeaec",
	repayBorrow: "0x0e752702",
	balanceOfUnderlying: "0x3af9e669",
	borrowBalanceCurrent: "0x17bfdfbc",
	supplyRatePerBlock: "0xae9d70b0",
	borrowRatePerBlock: "0xf8f9da28",
	exchangeRateCurrent: "0xbd6d894d",
	underlying: "0x6f307dc3",
	totalBorrows: "0x47bd3718",
	getCash: "0x3b1d21a2",
	// Comptroller
	enterMarkets: "0xc2998238",
	getAccountLiquidity: "0x5ec88c79",
	getAllMarkets: "0xb0772d0b",
	markets: "0x8e8f294b",
	// ERC-20
	approve: "0x095ea7b3",
};

// ---------------------------------------------------------------------------
// ABI encoding helpers
// ---------------------------------------------------------------------------

function padAddress(address: string): string {
	return address.toLowerCase().replace("0x", "").padStart(64, "0");
}

function padUint256(value: string | bigint): string {
	const hex = typeof value === "bigint" ? value.toString(16) : value;
	return hex.padStart(64, "0");
}

function encodeUint256(value: string): string {
	const bn = BigInt(value);
	return padUint256(bn.toString(16));
}

function decodeUint256(hex: string): bigint {
	const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
	if (!cleaned || cleaned === "" || /^0+$/.test(cleaned)) return 0n;
	return BigInt(`0x${cleaned}`);
}

function decodeBool(hex: string): boolean {
	return decodeUint256(hex) !== 0n;
}

const MAX_UINT256 =
	"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

// ---------------------------------------------------------------------------
// RPC helpers
// ---------------------------------------------------------------------------

type RpcCallParams = {
	network: EvmNetwork;
	to: string;
	data: string;
	rpcUrl?: string;
};

async function ethCall(params: RpcCallParams): Promise<string> {
	const endpoint = getEvmRpcEndpoint(params.network, params.rpcUrl);
	const result = await evmHttpJson<{
		result?: string;
		error?: { message?: string };
	}>({
		url: endpoint,
		method: "POST",
		body: {
			jsonrpc: "2.0",
			id: 1,
			method: "eth_call",
			params: [{ to: params.to, data: params.data }, "latest"],
		},
	});
	if (result.error?.message) {
		throw new Error(`eth_call to ${params.to} failed: ${result.error.message}`);
	}
	return result.result ?? "0x";
}

// ---------------------------------------------------------------------------
// Venus read helpers
// ---------------------------------------------------------------------------

function ratePerBlockToAPY(ratePerBlock: bigint): number {
	// APY = ((ratePerBlock / 1e18) * blocksPerYear) * 100
	const rateFloat = Number(ratePerBlock) / 1e18;
	return rateFloat * BSC_BLOCKS_PER_YEAR * 100;
}

function formatUnits(raw: bigint, decimals: number): string {
	if (raw === 0n) return "0";
	const str = raw.toString();
	if (decimals === 0) return str;
	if (str.length <= decimals) {
		const padded = str.padStart(decimals + 1, "0");
		const whole = padded.slice(0, padded.length - decimals);
		const frac = padded.slice(padded.length - decimals).replace(/0+$/, "");
		return frac ? `${whole}.${frac}` : whole;
	}
	const whole = str.slice(0, str.length - decimals);
	const frac = str.slice(str.length - decimals).replace(/0+$/, "");
	return frac ? `${whole}.${frac}` : whole;
}

async function readSupplyRatePerBlock(
	network: EvmNetwork,
	vToken: string,
): Promise<bigint> {
	const hex = await ethCall({
		network,
		to: vToken,
		data: SEL.supplyRatePerBlock,
	});
	return decodeUint256(hex);
}

async function readBorrowRatePerBlock(
	network: EvmNetwork,
	vToken: string,
): Promise<bigint> {
	const hex = await ethCall({
		network,
		to: vToken,
		data: SEL.borrowRatePerBlock,
	});
	return decodeUint256(hex);
}

async function readBalanceOfUnderlying(
	network: EvmNetwork,
	vToken: string,
	account: string,
): Promise<bigint> {
	const hex = await ethCall({
		network,
		to: vToken,
		data: `${SEL.balanceOfUnderlying}${padAddress(account)}`,
	});
	return decodeUint256(hex);
}

async function readBorrowBalanceCurrent(
	network: EvmNetwork,
	vToken: string,
	account: string,
): Promise<bigint> {
	const hex = await ethCall({
		network,
		to: vToken,
		data: `${SEL.borrowBalanceCurrent}${padAddress(account)}`,
	});
	return decodeUint256(hex);
}

async function readTotalBorrows(
	network: EvmNetwork,
	vToken: string,
): Promise<bigint> {
	const hex = await ethCall({
		network,
		to: vToken,
		data: SEL.totalBorrows,
	});
	return decodeUint256(hex);
}

async function readCash(network: EvmNetwork, vToken: string): Promise<bigint> {
	const hex = await ethCall({
		network,
		to: vToken,
		data: SEL.getCash,
	});
	return decodeUint256(hex);
}

async function readMarketInfo(
	network: EvmNetwork,
	vToken: string,
): Promise<{ isListed: boolean; collateralFactorMantissa: bigint }> {
	const hex = await ethCall({
		network,
		to: VENUS_COMPTROLLER,
		data: `${SEL.markets}${padAddress(vToken)}`,
	});
	const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
	// markets() returns (bool isListed, uint256 collateralFactorMantissa, bool isVenus)
	const isListed = decodeBool(cleaned.slice(0, 64));
	const collateralFactorMantissa = decodeUint256(cleaned.slice(64, 128));
	return { isListed, collateralFactorMantissa };
}

async function readAccountLiquidity(
	network: EvmNetwork,
	account: string,
): Promise<{ error: bigint; liquidity: bigint; shortfall: bigint }> {
	const hex = await ethCall({
		network,
		to: VENUS_COMPTROLLER,
		data: `${SEL.getAccountLiquidity}${padAddress(account)}`,
	});
	const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
	// returns (uint error, uint liquidity, uint shortfall)
	const error = decodeUint256(cleaned.slice(0, 64));
	const liquidity = decodeUint256(cleaned.slice(64, 128));
	const shortfall = decodeUint256(cleaned.slice(128, 192));
	return { error, liquidity, shortfall };
}

// ---------------------------------------------------------------------------
// Venus adapter implementation
// ---------------------------------------------------------------------------

function assertBscNetwork(network: EvmNetwork): void {
	if (network !== "bsc") {
		throw new Error(
			`Venus Protocol is only available on BSC. Got network=${network}.`,
		);
	}
}

function findMarketByUnderlying(
	underlying: string,
): (typeof VENUS_MARKET_REGISTRY)[string] | undefined {
	const normalized = underlying.toLowerCase();
	for (const entry of Object.values(VENUS_MARKET_REGISTRY)) {
		if (entry.underlying.toLowerCase() === normalized) {
			return entry;
		}
	}
	return undefined;
}

function findMarketByVToken(
	vToken: string,
): (typeof VENUS_MARKET_REGISTRY)[string] | undefined {
	const normalized = vToken.toLowerCase();
	for (const entry of Object.values(VENUS_MARKET_REGISTRY)) {
		if (entry.vToken.toLowerCase() === normalized) {
			return entry;
		}
	}
	return undefined;
}

export function createVenusAdapter(): LendingProtocolAdapter {
	return {
		protocolId: VENUS_PROTOCOL_ID,

		async getMarkets(network: EvmNetwork): Promise<LendingMarket[]> {
			assertBscNetwork(network);

			const markets: LendingMarket[] = [];
			for (const [, entry] of Object.entries(VENUS_MARKET_REGISTRY)) {
				const [supplyRate, borrowRate, marketInfo, totalBorrows, cash] =
					await Promise.all([
						readSupplyRatePerBlock(network, entry.vToken),
						readBorrowRatePerBlock(network, entry.vToken),
						readMarketInfo(network, entry.vToken),
						readTotalBorrows(network, entry.vToken),
						readCash(network, entry.vToken),
					]);

				const collateralFactor =
					Number(marketInfo.collateralFactorMantissa) / 1e18;

				// totalSupply (underlying) ≈ cash + totalBorrows
				const totalSupplyUnderlying = cash + totalBorrows;

				markets.push({
					protocol: VENUS_PROTOCOL_ID,
					network,
					marketAddress: entry.vToken,
					underlyingAddress: entry.underlying,
					underlyingSymbol: entry.symbol,
					underlyingDecimals: entry.decimals,
					supplyAPY: ratePerBlockToAPY(supplyRate),
					borrowAPY: ratePerBlockToAPY(borrowRate),
					totalSupply: formatUnits(totalSupplyUnderlying, entry.decimals),
					totalBorrow: formatUnits(totalBorrows, entry.decimals),
					collateralFactor,
					isCollateral: collateralFactor > 0,
					isListed: marketInfo.isListed,
				});
			}
			return markets;
		},

		async getAccountPosition(
			network: EvmNetwork,
			account: string,
		): Promise<LendingPosition> {
			assertBscNetwork(network);

			const supplies: LendingPositionAsset[] = [];
			const borrows: LendingPositionAsset[] = [];

			for (const [, entry] of Object.entries(VENUS_MARKET_REGISTRY)) {
				const [supplyBal, borrowBal] = await Promise.all([
					readBalanceOfUnderlying(network, entry.vToken, account),
					readBorrowBalanceCurrent(network, entry.vToken, account),
				]);

				if (supplyBal > 0n) {
					supplies.push({
						marketAddress: entry.vToken,
						underlyingAddress: entry.underlying,
						underlyingSymbol: entry.symbol,
						underlyingDecimals: entry.decimals,
						balanceRaw: supplyBal.toString(),
						balanceFormatted: formatUnits(supplyBal, entry.decimals),
					});
				}

				if (borrowBal > 0n) {
					borrows.push({
						marketAddress: entry.vToken,
						underlyingAddress: entry.underlying,
						underlyingSymbol: entry.symbol,
						underlyingDecimals: entry.decimals,
						balanceRaw: borrowBal.toString(),
						balanceFormatted: formatUnits(borrowBal, entry.decimals),
					});
				}
			}

			// Compute health from Comptroller
			const liq = await readAccountLiquidity(network, account);
			const liquidityFloat = Number(liq.liquidity) / 1e18;
			const shortfallFloat = Number(liq.shortfall) / 1e18;
			const healthFactor =
				shortfallFloat > 0
					? 0
					: liquidityFloat > 0
						? Number.POSITIVE_INFINITY
						: 1;

			// Approximate LTV from position data
			// Note: precise USD values require oracle reads (future enhancement)
			const totalCollateralValueUsd = liquidityFloat.toFixed(2);
			const totalBorrowValueUsd = shortfallFloat.toFixed(2);
			const currentLTV =
				liquidityFloat + shortfallFloat > 0
					? shortfallFloat / (liquidityFloat + shortfallFloat)
					: 0;

			return {
				protocol: VENUS_PROTOCOL_ID,
				network,
				account,
				supplies,
				borrows,
				totalCollateralValueUsd,
				totalBorrowValueUsd,
				currentLTV,
				liquidationLTV: 0.8, // Venus default
				healthFactor,
			};
		},

		// -- Transaction builders --

		async buildSupplyCalldata(params: SupplyParams): Promise<EvmCallData[]> {
			assertBscNetwork(params.network);
			const market = findMarketByUnderlying(params.tokenAddress);
			if (!market) {
				throw new Error(
					`No Venus market found for underlying ${params.tokenAddress}`,
				);
			}

			const txs: EvmCallData[] = [];
			const isNative =
				market.underlying.toLowerCase() === NATIVE_ADDRESS.toLowerCase();

			if (!isNative) {
				// Step 1: approve vToken to spend underlying
				txs.push({
					to: market.underlying,
					data: `${SEL.approve}${padAddress(market.vToken)}${encodeUint256(params.amountRaw)}`,
					description: `Approve Venus ${market.symbol} market to spend ${params.amountRaw} ${market.symbol}`,
				});
			}

			// Step 2: mint vToken
			if (isNative) {
				// vBNB uses msg.value
				txs.push({
					to: market.vToken,
					data: SEL.mint.padEnd(10, "0"),
					value: `0x${BigInt(params.amountRaw).toString(16)}`,
					description: `Supply ${formatUnits(BigInt(params.amountRaw), market.decimals)} BNB to Venus`,
				});
			} else {
				txs.push({
					to: market.vToken,
					data: `${SEL.mint}${encodeUint256(params.amountRaw)}`,
					description: `Supply ${formatUnits(BigInt(params.amountRaw), market.decimals)} ${market.symbol} to Venus`,
				});
			}

			return txs;
		},

		async buildEnterMarketCalldata(
			params: EnterMarketParams,
		): Promise<EvmCallData> {
			assertBscNetwork(params.network);
			// enterMarkets(address[]) — dynamic array ABI encoding
			const offset = padUint256("20"); // 0x20 = 32 bytes offset to array data
			const length = padUint256(
				BigInt(params.marketAddresses.length).toString(16),
			);
			const addresses = params.marketAddresses
				.map((addr) => padAddress(addr))
				.join("");
			return {
				to: VENUS_COMPTROLLER,
				data: `${SEL.enterMarkets}${offset}${length}${addresses}`,
				description: `Enable ${params.marketAddresses.length} market(s) as collateral on Venus`,
			};
		},

		async buildBorrowCalldata(params: BorrowParams): Promise<EvmCallData> {
			assertBscNetwork(params.network);
			const market = findMarketByVToken(params.marketAddress);
			const symbol = market?.symbol ?? "unknown";
			return {
				to: params.marketAddress,
				data: `${SEL.borrow}${encodeUint256(params.amountRaw)}`,
				description: `Borrow ${market ? formatUnits(BigInt(params.amountRaw), market.decimals) : params.amountRaw} ${symbol} from Venus`,
			};
		},

		async buildRepayCalldata(params: RepayParams): Promise<EvmCallData[]> {
			assertBscNetwork(params.network);
			const market = findMarketByUnderlying(params.tokenAddress);
			if (!market) {
				throw new Error(
					`No Venus market found for underlying ${params.tokenAddress}`,
				);
			}

			const txs: EvmCallData[] = [];
			const isNative =
				market.underlying.toLowerCase() === NATIVE_ADDRESS.toLowerCase();

			if (!isNative) {
				// Step 1: approve vToken to spend underlying for repay
				txs.push({
					to: market.underlying,
					data: `${SEL.approve}${padAddress(market.vToken)}${encodeUint256(params.amountRaw)}`,
					description: `Approve Venus ${market.symbol} market to spend ${params.amountRaw} ${market.symbol} for repay`,
				});
			}

			// Step 2: repayBorrow
			if (isNative) {
				txs.push({
					to: market.vToken,
					data: `${SEL.repayBorrow}${encodeUint256(params.amountRaw)}`,
					value: `0x${BigInt(params.amountRaw).toString(16)}`,
					description: `Repay ${formatUnits(BigInt(params.amountRaw), market.decimals)} BNB on Venus`,
				});
			} else {
				txs.push({
					to: market.vToken,
					data: `${SEL.repayBorrow}${encodeUint256(params.amountRaw)}`,
					description: `Repay ${formatUnits(BigInt(params.amountRaw), market.decimals)} ${market.symbol} on Venus`,
				});
			}

			return txs;
		},

		async buildWithdrawCalldata(params: WithdrawParams): Promise<EvmCallData> {
			assertBscNetwork(params.network);
			const market = findMarketByUnderlying(params.tokenAddress);
			if (!market) {
				throw new Error(
					`No Venus market found for underlying ${params.tokenAddress}`,
				);
			}
			return {
				to: market.vToken,
				data: `${SEL.redeemUnderlying}${encodeUint256(params.amountRaw)}`,
				description: `Withdraw ${formatUnits(BigInt(params.amountRaw), market.decimals)} ${market.symbol} from Venus`,
			};
		},
	};
}

// ---------------------------------------------------------------------------
// Exported helpers for use by read/execute tools
// ---------------------------------------------------------------------------

export {
	VENUS_COMPTROLLER,
	VENUS_VBNB,
	VENUS_MARKET_REGISTRY,
	VENUS_PROTOCOL_ID,
	BSC_BLOCKS_PER_YEAR,
	NATIVE_ADDRESS,
	ethCall,
	padAddress,
	padUint256,
	encodeUint256,
	decodeUint256,
	decodeBool,
	ratePerBlockToAPY,
	formatUnits,
	readSupplyRatePerBlock,
	readBorrowRatePerBlock,
	readBalanceOfUnderlying,
	readBorrowBalanceCurrent,
	readMarketInfo,
	readAccountLiquidity,
};
