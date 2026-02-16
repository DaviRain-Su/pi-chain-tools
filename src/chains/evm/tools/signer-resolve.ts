/**
 * Signer resolution — auto-selects the right EvmSignerProvider based on
 * available credentials.
 *
 * Priority:
 * 1. `fromPrivateKey` param → LocalKeySigner
 * 2. `EVM_PRIVATE_KEY` env → LocalKeySigner
 * 3. `PRIVY_WALLET_ID` + `PRIVY_APP_ID` + `PRIVY_APP_SECRET` → PrivyEvmSigner
 * 4. Error
 */

import type { EvmNetwork } from "../runtime.js";
import { LocalKeySigner } from "./signer-local.js";
import { PrivyEvmSigner } from "./signer-privy.js";
import type {
	EvmSignerProvider,
	SignerResolutionOptions,
} from "./signer-types.js";
import { resolveSignerBackend } from "./signer-types.js";

/**
 * Resolve and construct the appropriate signer provider.
 */
export function resolveEvmSigner(
	opts: SignerResolutionOptions,
): EvmSignerProvider {
	const resolution = resolveSignerBackend(opts);
	switch (resolution.mode) {
		case "local":
			return new LocalKeySigner(resolution.privateKey);
		case "privy":
			return new PrivyEvmSigner({
				walletId: resolution.walletId,
				appId: resolution.appId,
				appSecret: resolution.appSecret,
			});
	}
}

/**
 * Convenience: resolve signer for a specific tool call.
 * This is the main entry point used by execute/workflow tools.
 */
export function resolveEvmSignerForTool(params: {
	fromPrivateKey?: string;
	network: EvmNetwork;
}): EvmSignerProvider {
	return resolveEvmSigner({
		fromPrivateKey: params.fromPrivateKey,
		network: params.network,
	});
}
