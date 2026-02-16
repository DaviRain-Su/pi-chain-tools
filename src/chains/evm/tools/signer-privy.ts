/**
 * PrivyEvmSigner — EvmSignerProvider backed by Privy Agentic Wallets.
 *
 * Uses `@privy-io/node` SDK for MPC/enclave-based remote signing.
 * The Agent never touches private keys — Privy holds them in secure enclaves.
 *
 * One walletId works across ALL EVM chains — the `caip2` parameter
 * (`eip155:<chainId>`) tells Privy which chain to broadcast on.
 *
 * Requirements:
 * - `PRIVY_APP_ID` + `PRIVY_APP_SECRET` env vars (or constructor params)
 * - `PRIVY_WALLET_ID` env var (or constructor param)
 *
 * Note: This module dynamically imports `@privy-io/node` — it is an
 * optional dependency. If not installed, an error is thrown at runtime.
 */

import { getEvmChainId } from "../runtime.js";
import type { EvmNetwork } from "../runtime.js";
import type {
	EvmSignAndSendParams,
	EvmSignAndSendResult,
	EvmSignerProvider,
} from "./signer-types.js";

// ---------------------------------------------------------------------------
// Privy type subset (to avoid hard dependency on @privy-io/node types)
// ---------------------------------------------------------------------------

interface PrivyEthereumSendResult {
	hash: string;
}

interface PrivyWalletInfo {
	address: string;
}

interface PrivyClientLike {
	wallets: {
		get(params: { id: string }): Promise<PrivyWalletInfo>;
		ethereum(): {
			sendTransaction(
				walletId: string,
				params: {
					caip2: string;
					params: {
						transaction: {
							to: string;
							data?: string;
							value?: string;
							gas?: string;
						};
					};
				},
			): Promise<PrivyEthereumSendResult>;
		};
	};
}

// ---------------------------------------------------------------------------
// PrivyEvmSigner
// ---------------------------------------------------------------------------

export class PrivyEvmSigner implements EvmSignerProvider {
	readonly id = "privy";
	private readonly walletId: string;
	private privyClient: PrivyClientLike | null = null;
	private readonly appId: string;
	private readonly appSecret: string;
	private cachedAddress: string | null = null;

	constructor(opts: {
		walletId: string;
		appId: string;
		appSecret: string;
	}) {
		this.walletId = opts.walletId;
		this.appId = opts.appId;
		this.appSecret = opts.appSecret;
	}

	private async getClient(): Promise<PrivyClientLike> {
		if (this.privyClient) return this.privyClient;

		try {
			// Dynamic import — @privy-io/node is optional
			const privyModule = await import("@privy-io/node");
			const PrivyClient =
				privyModule.PrivyClient ||
				(privyModule as Record<string, unknown>).default;
			if (!PrivyClient) {
				throw new Error("PrivyClient constructor not found in @privy-io/node");
			}
			this.privyClient = new (
				PrivyClient as new (
					appId: string,
					appSecret: string,
				) => PrivyClientLike
			)(this.appId, this.appSecret);
			return this.privyClient;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (
				msg.includes("Cannot find module") ||
				msg.includes("MODULE_NOT_FOUND")
			) {
				throw new Error(
					"@privy-io/node is not installed. Run: npm install @privy-io/node\n" +
						"Or use LocalKeySigner by setting EVM_PRIVATE_KEY instead.",
				);
			}
			throw err;
		}
	}

	async getAddress(_network: EvmNetwork): Promise<string> {
		if (this.cachedAddress) return this.cachedAddress;
		const client = await this.getClient();
		const wallet = await client.wallets.get({ id: this.walletId });
		this.cachedAddress = wallet.address;
		return wallet.address;
	}

	async signAndSend(
		params: EvmSignAndSendParams,
	): Promise<EvmSignAndSendResult> {
		const client = await this.getClient();
		const chainId = getEvmChainId(params.network);
		const caip2 = `eip155:${chainId}`;

		const result = await client.wallets
			.ethereum()
			.sendTransaction(this.walletId, {
				caip2,
				params: {
					transaction: {
						to: params.to,
						data: params.data,
						value: params.value,
						gas: params.gasLimit,
					},
				},
			});

		const fromAddress = await this.getAddress(params.network);
		return { txHash: result.hash, from: fromAddress };
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create PrivyEvmSigner from explicit params or env vars.
 */
export function createPrivyEvmSigner(opts?: {
	walletId?: string;
	appId?: string;
	appSecret?: string;
}): PrivyEvmSigner {
	const walletId = opts?.walletId || process.env.PRIVY_WALLET_ID?.trim() || "";
	const appId = opts?.appId || process.env.PRIVY_APP_ID?.trim() || "";
	const appSecret =
		opts?.appSecret || process.env.PRIVY_APP_SECRET?.trim() || "";

	if (!walletId || !appId || !appSecret) {
		throw new Error(
			"Privy signer requires PRIVY_APP_ID, PRIVY_APP_SECRET, and PRIVY_WALLET_ID. " +
				"Set them via env vars or pass explicitly.",
		);
	}

	return new PrivyEvmSigner({ walletId, appId, appSecret });
}
