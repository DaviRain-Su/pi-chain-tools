/**
 * ERC-4626 Vault adapter — generic deposit/withdraw/balance for yield vaults.
 *
 * ERC-4626 is the standard tokenized vault interface. BorrowBot deposits
 * borrowed USDC into yield vaults (e.g. 40acres, YO) to earn yield.
 *
 * This adapter works with any ERC-4626 vault on any EVM chain.
 *
 * Key functions:
 * - deposit(assets, receiver): deposit underlying → receive vault shares
 * - withdraw(assets, receiver, owner): withdraw underlying by burning shares
 * - redeem(shares, receiver, owner): redeem exact shares → receive underlying
 * - balanceOf(owner): vault share balance
 * - convertToAssets(shares): shares → underlying value
 * - totalAssets(): total underlying managed by vault
 * - asset(): underlying token address
 */

import type { EvmNetwork } from "../runtime.js";
import { evmHttpJson, getEvmRpcEndpoint } from "../runtime.js";
import type { EvmCallData } from "./lending-types.js";

// ---------------------------------------------------------------------------
// Function selectors (ERC-4626 / ERC-20)
// ---------------------------------------------------------------------------

const SEL = {
	// ERC-4626
	deposit: "0x6e553f65", // deposit(uint256 assets, address receiver)
	withdraw: "0xb460af94", // withdraw(uint256 assets, address receiver, address owner)
	redeem: "0xba087652", // redeem(uint256 shares, address receiver, address owner)
	convertToAssets: "0x07a2d13a", // convertToAssets(uint256 shares)
	convertToShares: "0xc6e6f592", // convertToShares(uint256 assets)
	totalAssets: "0x01e1d114", // totalAssets()
	asset: "0x38d52e0f", // asset() → underlying token address
	// ERC-20
	balanceOf: "0x70a08231", // balanceOf(address)
	approve: "0x095ea7b3", // approve(address spender, uint256 amount)
	decimals: "0x313ce567", // decimals()
	name: "0x06fdde03", // name()
	symbol: "0x95d89b41", // symbol()
};

const MAX_UINT256_PADDED =
	"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

// ---------------------------------------------------------------------------
// ABI helpers
// ---------------------------------------------------------------------------

function padAddress(address: string): string {
	return address.toLowerCase().replace("0x", "").padStart(64, "0");
}

function padUint256(value: string | bigint): string {
	const hex =
		typeof value === "bigint" ? value.toString(16) : BigInt(value).toString(16);
	return hex.padStart(64, "0");
}

function decodeUint256(hex: string): bigint {
	const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
	if (cleaned.length < 64) return 0n;
	return BigInt(`0x${cleaned.slice(0, 64)}`);
}

function decodeAddress(hex: string): string {
	const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
	if (cleaned.length < 64) return "0x0000000000000000000000000000000000000000";
	return `0x${cleaned.slice(24, 64)}`;
}

// ---------------------------------------------------------------------------
// RPC helper
// ---------------------------------------------------------------------------

async function ethCall(
	network: EvmNetwork,
	to: string,
	data: string,
): Promise<string> {
	const rpcUrl =
		process.env[`EVM_RPC_${network.toUpperCase()}`] ||
		getEvmRpcEndpoint(network);
	const resp = await evmHttpJson<{
		result?: string;
		error?: { message: string };
	}>({
		url: rpcUrl,
		method: "POST",
		body: {
			jsonrpc: "2.0",
			method: "eth_call",
			params: [{ to, data }, "latest"],
			id: 1,
		},
		timeoutMs: 10_000,
	});
	if (resp.error) {
		throw new Error(`eth_call failed: ${resp.error.message}`);
	}
	return resp.result ?? "0x";
}

// ---------------------------------------------------------------------------
// Read functions
// ---------------------------------------------------------------------------

export type VaultInfo = {
	vaultAddress: string;
	network: EvmNetwork;
	underlyingAsset: string;
	totalAssets: string;
	vaultName: string;
	vaultSymbol: string;
	vaultDecimals: number;
};

export async function getVaultInfo(
	network: EvmNetwork,
	vaultAddress: string,
): Promise<VaultInfo> {
	const [assetHex, totalAssetsHex, nameHex, symbolHex, decimalsHex] =
		await Promise.all([
			ethCall(network, vaultAddress, SEL.asset),
			ethCall(network, vaultAddress, SEL.totalAssets),
			ethCall(network, vaultAddress, SEL.name),
			ethCall(network, vaultAddress, SEL.symbol),
			ethCall(network, vaultAddress, SEL.decimals),
		]);

	const underlyingAsset = decodeAddress(assetHex);
	const totalAssets = decodeUint256(totalAssetsHex).toString();
	const vaultDecimals = Number(decodeUint256(decimalsHex));

	// Decode name/symbol from ABI-encoded string
	let vaultName = "";
	let vaultSymbol = "";
	try {
		const nameData = Buffer.from(nameHex.slice(2), "hex");
		if (nameData.length >= 96) {
			const len = Number(
				decodeUint256(`0x${nameData.subarray(32, 64).toString("hex")}`),
			);
			vaultName = nameData.subarray(64, 64 + len).toString("utf-8");
		}
	} catch {
		/* name decode optional */
	}
	try {
		const symData = Buffer.from(symbolHex.slice(2), "hex");
		if (symData.length >= 96) {
			const len = Number(
				decodeUint256(`0x${symData.subarray(32, 64).toString("hex")}`),
			);
			vaultSymbol = symData.subarray(64, 64 + len).toString("utf-8");
		}
	} catch {
		/* symbol decode optional */
	}

	return {
		vaultAddress,
		network,
		underlyingAsset,
		totalAssets,
		vaultName,
		vaultSymbol,
		vaultDecimals,
	};
}

export async function getVaultBalance(
	network: EvmNetwork,
	vaultAddress: string,
	account: string,
): Promise<{ shares: string; assets: string }> {
	const sharesHex = await ethCall(
		network,
		vaultAddress,
		`${SEL.balanceOf}${padAddress(account)}`,
	);
	const shares = decodeUint256(sharesHex);

	let assets = 0n;
	if (shares > 0n) {
		const assetsHex = await ethCall(
			network,
			vaultAddress,
			`${SEL.convertToAssets}${padUint256(shares)}`,
		);
		assets = decodeUint256(assetsHex);
	}

	return { shares: shares.toString(), assets: assets.toString() };
}

// ---------------------------------------------------------------------------
// Calldata builders
// ---------------------------------------------------------------------------

export type VaultDepositParams = {
	network: EvmNetwork;
	vaultAddress: string;
	/** Underlying token address (retrieved from vault.asset() if needed) */
	underlyingTokenAddress: string;
	account: string;
	amountRaw: string;
};

/**
 * Build calldata for vault deposit: approve underlying → deposit.
 */
export function buildVaultDepositCalldata(
	params: VaultDepositParams,
): EvmCallData[] {
	const calldata: EvmCallData[] = [];

	// 1. Approve underlying token to vault
	const approveData = `${SEL.approve}${padAddress(params.vaultAddress)}${MAX_UINT256_PADDED}`;
	calldata.push({
		to: params.underlyingTokenAddress,
		data: approveData,
		description: `Approve vault to spend ${params.underlyingTokenAddress}`,
	});

	// 2. Deposit assets, receiver = account
	const depositData = `${SEL.deposit}${padUint256(params.amountRaw)}${padAddress(params.account)}`;
	calldata.push({
		to: params.vaultAddress,
		data: depositData,
		description: `Deposit ${params.amountRaw} to vault ${params.vaultAddress.slice(0, 10)}...`,
	});

	return calldata;
}

export type VaultWithdrawParams = {
	network: EvmNetwork;
	vaultAddress: string;
	account: string;
	/** Amount of underlying assets to withdraw */
	amountRaw: string;
};

/**
 * Build calldata for vault withdraw (by underlying amount).
 */
export function buildVaultWithdrawCalldata(
	params: VaultWithdrawParams,
): EvmCallData {
	// withdraw(uint256 assets, address receiver, address owner)
	const withdrawData = `${SEL.withdraw}${padUint256(params.amountRaw)}${padAddress(params.account)}${padAddress(params.account)}`;
	return {
		to: params.vaultAddress,
		data: withdrawData,
		description: `Withdraw ${params.amountRaw} from vault ${params.vaultAddress.slice(0, 10)}...`,
	};
}

export type VaultRedeemParams = {
	network: EvmNetwork;
	vaultAddress: string;
	account: string;
	/** Number of vault shares to redeem */
	sharesRaw: string;
};

/**
 * Build calldata for vault redeem (by share amount).
 */
export function buildVaultRedeemCalldata(
	params: VaultRedeemParams,
): EvmCallData {
	// redeem(uint256 shares, address receiver, address owner)
	const redeemData = `${SEL.redeem}${padUint256(params.sharesRaw)}${padAddress(params.account)}${padAddress(params.account)}`;
	return {
		to: params.vaultAddress,
		data: redeemData,
		description: `Redeem ${params.sharesRaw} shares from vault ${params.vaultAddress.slice(0, 10)}...`,
	};
}
