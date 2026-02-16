/**
 * EvmSignerProvider — pluggable signing abstraction for EVM chains.
 *
 * Two implementations:
 * - `LocalKeySigner`  — wraps `ethers.Wallet` + local private key (dev/test)
 * - `PrivyEvmSigner`  — wraps `@privy-io/node` SDK (production)
 *
 * Adapters return `EvmCallData` (unsigned); signing is Signer Provider's job.
 * Workflow/Agent layers call `signerProvider.signAndSend()` — they never
 * touch private keys or care about which backend is used.
 */

import type { EvmNetwork } from "../runtime.js";

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

export type EvmSignAndSendParams = {
	/** Target EVM network */
	network: EvmNetwork;
	/** Contract or recipient address (0x...) */
	to: string;
	/** Encoded calldata (0x...) */
	data?: string;
	/** Value in wei (hex or decimal string). Defaults to "0x0". */
	value?: string;
	/** Gas limit override (hex or decimal string). Auto-estimated if omitted. */
	gasLimit?: string;
	/** Gas price override in wei (hex or decimal string). Auto-resolved if omitted. */
	gasPriceWei?: string;
	/** Nonce override. Auto-resolved if omitted. */
	nonce?: number;
};

export type EvmSignAndSendResult = {
	txHash: string;
	/** Signer address that signed the transaction */
	from: string;
};

export interface EvmSignerProvider {
	/** Human-readable signer backend identifier */
	readonly id: string;

	/** Get the signer's address for a given network */
	getAddress(network: EvmNetwork): Promise<string>;

	/**
	 * Sign and broadcast a single transaction.
	 * Handles gas estimation, nonce resolution, and broadcasting internally.
	 */
	signAndSend(params: EvmSignAndSendParams): Promise<EvmSignAndSendResult>;
}

// ---------------------------------------------------------------------------
// Resolution helper
// ---------------------------------------------------------------------------

export type SignerResolutionOptions = {
	/** Explicit private key from tool params (highest priority) */
	fromPrivateKey?: string;
	/** Network hint for Privy CAIP-2 resolution */
	network: EvmNetwork;
};

/**
 * Signer backend preference order:
 * 1. `fromPrivateKey` param → LocalKeySigner
 * 2. `EVM_PRIVATE_KEY` env → LocalKeySigner
 * 3. `PRIVY_WALLET_ID` + `PRIVY_APP_ID` + `PRIVY_APP_SECRET` → PrivyEvmSigner
 * 4. Error: no signer available
 *
 * This function returns { mode, privateKey? } so the caller can construct
 * the appropriate signer without importing both implementations eagerly.
 */
export type SignerResolution =
	| { mode: "local"; privateKey: string }
	| { mode: "privy"; walletId: string; appId: string; appSecret: string };

export function resolveSignerBackend(
	opts: SignerResolutionOptions,
): SignerResolution {
	// 1. Explicit private key from call params
	const explicitKey = opts.fromPrivateKey?.trim();
	if (explicitKey) {
		return { mode: "local", privateKey: explicitKey };
	}

	// 2. EVM_PRIVATE_KEY env (existing pattern)
	const envKey =
		process.env.EVM_PRIVATE_KEY?.trim() ||
		process.env.POLYMARKET_PRIVATE_KEY?.trim();
	if (envKey) {
		return { mode: "local", privateKey: envKey };
	}

	// 3. Privy env vars
	const walletId = process.env.PRIVY_WALLET_ID?.trim();
	const appId = process.env.PRIVY_APP_ID?.trim();
	const appSecret = process.env.PRIVY_APP_SECRET?.trim();
	if (walletId && appId && appSecret) {
		return { mode: "privy", walletId, appId, appSecret };
	}

	// 4. Nothing available
	throw new Error(
		"No EVM signer available. Set fromPrivateKey, EVM_PRIVATE_KEY, or " +
			"PRIVY_APP_ID + PRIVY_APP_SECRET + PRIVY_WALLET_ID.",
	);
}
