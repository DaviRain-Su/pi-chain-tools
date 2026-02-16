/**
 * Unified lending protocol abstraction layer.
 *
 * Each lending protocol (Venus, Aave, Compound, etc.) implements
 * `LendingProtocolAdapter`. The LTV Manager and workflow layer consume
 * this interface and remain chain/protocol-agnostic.
 */

import type { EvmNetwork } from "../runtime.js";

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

export type LendingMarket = {
	protocol: string;
	network: EvmNetwork;
	/** vToken / aToken / cToken contract address */
	marketAddress: string;
	/** Underlying token address (address(0) for native asset like BNB) */
	underlyingAddress: string;
	underlyingSymbol: string;
	underlyingDecimals: number;
	/** Annual percentage yield for suppliers (0..100 scale, e.g. 3.5 = 3.5%) */
	supplyAPY: number;
	/** Annual percentage rate for borrowers */
	borrowAPY: number;
	/** Total supplied in underlying units (raw string) */
	totalSupply: string;
	/** Total borrowed in underlying units (raw string) */
	totalBorrow: string;
	/** Collateral factor (0..1 scale, e.g. 0.75 = 75%) */
	collateralFactor: number;
	/** Whether this market can be used as collateral */
	isCollateral: boolean;
	/** Whether this market is actively listed */
	isListed: boolean;
};

// ---------------------------------------------------------------------------
// Account position
// ---------------------------------------------------------------------------

export type LendingPositionAsset = {
	marketAddress: string;
	underlyingAddress: string;
	underlyingSymbol: string;
	underlyingDecimals: number;
	/** Balance in underlying units (raw string) */
	balanceRaw: string;
	/** Balance in human-readable decimal */
	balanceFormatted: string;
};

export type LendingPosition = {
	protocol: string;
	network: EvmNetwork;
	account: string;
	supplies: LendingPositionAsset[];
	borrows: LendingPositionAsset[];
	/** Total collateral value in USD (string) */
	totalCollateralValueUsd: string;
	/** Total borrow value in USD (string) */
	totalBorrowValueUsd: string;
	/** Current loan-to-value ratio (0..1) */
	currentLTV: number;
	/** Max LTV before liquidation (0..1) */
	liquidationLTV: number;
	/** Health factor (> 1 is safe, < 1 is liquidatable) */
	healthFactor: number;
};

// ---------------------------------------------------------------------------
// Transaction calldata
// ---------------------------------------------------------------------------

export type EvmCallData = {
	to: string;
	data: string;
	/** For native asset operations (e.g. vBNB.mint{value}) */
	value?: string;
	/** Human-readable description */
	description: string;
};

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export type SupplyParams = {
	network: EvmNetwork;
	account: string;
	/** Underlying token address */
	tokenAddress: string;
	/** Amount in raw units */
	amountRaw: string;
};

export type BorrowParams = {
	network: EvmNetwork;
	account: string;
	/** vToken / market address to borrow from */
	marketAddress: string;
	amountRaw: string;
};

export type RepayParams = {
	network: EvmNetwork;
	account: string;
	/** Underlying token address */
	tokenAddress: string;
	amountRaw: string;
};

export type WithdrawParams = {
	network: EvmNetwork;
	account: string;
	/** Underlying token address */
	tokenAddress: string;
	amountRaw: string;
};

export type EnterMarketParams = {
	network: EvmNetwork;
	account: string;
	marketAddresses: string[];
};

/**
 * Protocol adapter interface. Implementations live in per-protocol files
 * (e.g. venus-adapter.ts, aave-adapter.ts).
 */
export interface LendingProtocolAdapter {
	readonly protocolId: string;

	/** List available markets with live rate/TVL data. */
	getMarkets(network: EvmNetwork): Promise<LendingMarket[]>;

	/** Get a single account's full lending position. */
	getAccountPosition(
		network: EvmNetwork,
		account: string,
	): Promise<LendingPosition>;

	// -- Transaction builders (return unsigned calldata) --

	/** Build supply (deposit) tx calldata. */
	buildSupplyCalldata(params: SupplyParams): Promise<EvmCallData[]>;

	/** Build enterMarkets tx calldata (enable collateral). */
	buildEnterMarketCalldata(params: EnterMarketParams): Promise<EvmCallData>;

	/** Build borrow tx calldata. */
	buildBorrowCalldata(params: BorrowParams): Promise<EvmCallData>;

	/** Build repay tx calldata (may include approve step). */
	buildRepayCalldata(params: RepayParams): Promise<EvmCallData[]>;

	/** Build withdraw (redeem) tx calldata. */
	buildWithdrawCalldata(params: WithdrawParams): Promise<EvmCallData>;
}
