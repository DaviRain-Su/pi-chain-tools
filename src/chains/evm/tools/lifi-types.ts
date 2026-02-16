/**
 * LI.FI types for cross-chain bridge/swap integration.
 *
 * LI.FI API docs: https://docs.li.fi/
 * Base URL: https://li.quest/v1
 */

// ---------------------------------------------------------------------------
// Quote request/response
// ---------------------------------------------------------------------------

export type LifiQuoteRequest = {
	/** Source chain ID (e.g. 56 for BSC) */
	fromChain: number;
	/** Destination chain ID (e.g. 8453 for Base) */
	toChain: number;
	/** Source token address (0x... or native: 0x0000000000000000000000000000000000000000) */
	fromToken: string;
	/** Destination token address */
	toToken: string;
	/** Amount in raw integer units (string) */
	fromAmount: string;
	/** User wallet address */
	fromAddress: string;
	/** Destination wallet address (defaults to fromAddress) */
	toAddress?: string;
	/** Slippage in decimal (e.g. 0.03 = 3%) */
	slippage?: number;
	/** Allowed bridges (optional filter) */
	allowBridges?: string[];
	/** Denied bridges (optional filter) */
	denyBridges?: string[];
	/** Order preference: RECOMMENDED, FASTEST, CHEAPEST, SAFEST */
	order?: "RECOMMENDED" | "FASTEST" | "CHEAPEST" | "SAFEST";
	/** Integrator identifier */
	integrator?: string;
};

export type LifiEstimate = {
	fromAmount: string;
	toAmount: string;
	toAmountMin: string;
	approvalAddress: string;
	executionDuration: number;
	feeCosts: {
		name: string;
		amount: string;
		token: { symbol: string; decimals: number; address: string };
	}[];
	gasCosts: {
		type: string;
		estimate: string;
		token: { symbol: string; decimals: number; address: string };
	}[];
	tool: string;
	toolDetails?: { key: string; name: string; logoURI?: string };
};

export type LifiAction = {
	fromChainId: number;
	toChainId: number;
	fromToken: { address: string; symbol: string; decimals: number };
	toToken: { address: string; symbol: string; decimals: number };
	fromAmount: string;
	slippage: number;
};

export type LifiTransactionRequest = {
	to: string;
	data: string;
	value: string;
	gasLimit: string;
	gasPrice?: string;
	chainId: number;
	from: string;
};

export type LifiStep = {
	id: string;
	type: string;
	tool: string;
	toolDetails?: { key: string; name: string; logoURI?: string };
	action: LifiAction;
	estimate: LifiEstimate;
};

export type LifiQuoteResponse = {
	id: string;
	type: string;
	tool: string;
	toolDetails?: { key: string; name: string; logoURI?: string };
	action: LifiAction;
	estimate: LifiEstimate;
	includedSteps: LifiStep[];
	transactionRequest: LifiTransactionRequest;
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type LifiStatusRequest = {
	/** Transaction hash on source chain */
	txHash: string;
	/** Source chain ID */
	fromChain: number;
	/** Destination chain ID */
	toChain: number;
	/** Bridge tool name */
	bridge?: string;
};

export type LifiStatusResponse = {
	status: "NOT_FOUND" | "INVALID" | "PENDING" | "DONE" | "FAILED";
	substatus?: string;
	substatusMessage?: string;
	sending?: {
		txHash: string;
		txLink?: string;
		amount: string;
		token: { symbol: string; address: string };
		chainId: number;
	};
	receiving?: {
		txHash: string;
		txLink?: string;
		amount: string;
		token: { symbol: string; address: string };
		chainId: number;
	};
	tool?: string;
	bridgeExplorerLink?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LIFI_API_BASE = "https://li.quest/v1";

/** Native token placeholder used by LI.FI */
export const LIFI_NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

/** Default slippage (3%) */
export const LIFI_DEFAULT_SLIPPAGE = 0.03;
