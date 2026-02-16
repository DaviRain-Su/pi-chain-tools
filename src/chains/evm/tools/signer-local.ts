/**
 * LocalKeySigner — EvmSignerProvider backed by a local private key.
 *
 * Wraps the existing `ethers.Wallet` + RPC signing pattern into the
 * EvmSignerProvider interface. This is the dev/test signer backend.
 *
 * Fully backwards-compatible with the existing `resolveEvmPrivateKey` +
 * `new Wallet(privateKey)` flow — same env vars, same behavior.
 */

import { Wallet } from "ethers";
import { getEvmChainId, getEvmRpcEndpoint } from "../runtime.js";
import type { EvmNetwork } from "../runtime.js";
import type {
	EvmSignAndSendParams,
	EvmSignAndSendResult,
	EvmSignerProvider,
} from "./signer-types.js";

// ---------------------------------------------------------------------------
// Helpers (shared with execute.ts — extracted here for reuse)
// ---------------------------------------------------------------------------

type JsonRpcResponse<T> = {
	result?: T;
	error?: { code: number; message: string };
};

async function evmRpc<T>(
	rpcUrl: string,
	method: string,
	params: unknown[],
): Promise<T> {
	const res = await fetch(rpcUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method,
			params,
		}),
	});
	const json = (await res.json()) as JsonRpcResponse<T>;
	if (json.error) {
		throw new Error(`EVM RPC error: ${json.error.message}`);
	}
	if (json.result === undefined) {
		throw new Error(`EVM RPC returned no result for ${method}`);
	}
	return json.result;
}

function toHexQuantity(value: bigint | number | string): string {
	const n = typeof value === "string" ? BigInt(value) : BigInt(value);
	return `0x${n.toString(16)}`;
}

// ---------------------------------------------------------------------------
// LocalKeySigner
// ---------------------------------------------------------------------------

export class LocalKeySigner implements EvmSignerProvider {
	readonly id = "local-key";
	private readonly wallet: Wallet;

	constructor(privateKey: string) {
		this.wallet = new Wallet(privateKey);
	}

	async getAddress(_network: EvmNetwork): Promise<string> {
		return this.wallet.address;
	}

	async signAndSend(
		params: EvmSignAndSendParams,
	): Promise<EvmSignAndSendResult> {
		const rpcUrl = getEvmRpcEndpoint(params.network);
		const chainId = getEvmChainId(params.network);
		const fromAddress = this.wallet.address;

		// Resolve nonce
		const nonce =
			params.nonce ??
			Number.parseInt(
				await evmRpc<string>(rpcUrl, "eth_getTransactionCount", [
					fromAddress,
					"latest",
				]),
				16,
			);

		// Resolve gas price
		let gasPriceWei: bigint;
		if (params.gasPriceWei) {
			gasPriceWei = BigInt(params.gasPriceWei);
		} else {
			const gasPriceHex = await evmRpc<string>(rpcUrl, "eth_gasPrice", []);
			gasPriceWei = BigInt(gasPriceHex);
		}

		// Resolve gas limit
		let gasLimit: bigint;
		if (params.gasLimit) {
			gasLimit = BigInt(params.gasLimit);
		} else {
			const estimateHex = await evmRpc<string>(rpcUrl, "eth_estimateGas", [
				{
					from: fromAddress,
					to: params.to,
					data: params.data || "0x",
					value: params.value ? toHexQuantity(params.value) : "0x0",
				},
			]);
			// Add 20% buffer
			gasLimit = (BigInt(estimateHex) * 120n) / 100n;
		}

		// Sign
		const signedTx = await this.wallet.signTransaction({
			to: params.to,
			nonce,
			chainId,
			data: params.data || "0x",
			value: params.value ? toHexQuantity(params.value) : "0x0",
			gasPrice: toHexQuantity(gasPriceWei),
			gasLimit: toHexQuantity(gasLimit),
		});

		// Broadcast
		const txHash = await evmRpc<string>(rpcUrl, "eth_sendRawTransaction", [
			signedTx,
		]);

		return { txHash, from: fromAddress };
	}
}

/**
 * Factory — creates a LocalKeySigner from explicit key or env vars.
 * Uses the same resolution order as the legacy `resolveEvmPrivateKey`.
 */
export function createLocalKeySigner(fromPrivateKey?: string): LocalKeySigner {
	const key =
		fromPrivateKey?.trim() ||
		process.env.EVM_PRIVATE_KEY?.trim() ||
		process.env.POLYMARKET_PRIVATE_KEY?.trim() ||
		"";
	if (!key) {
		throw new Error(
			"No EVM private key provided. Set fromPrivateKey or EVM_PRIVATE_KEY.",
		);
	}
	return new LocalKeySigner(key);
}
