import { Interface } from "@ethersproject/abi";
import { MaxUint256 } from "@ethersproject/constants";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import {
	createVenusSdkAdapter,
	resolveDefaultBscVToken,
} from "./bsc-venus-sdk.mjs";

function toErrorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function isTransientExecError(error) {
	const text = String(error?.message || error || "").toLowerCase();
	return (
		text.includes("429") ||
		text.includes("too many requests") ||
		text.includes("fetch failed") ||
		text.includes("timeout") ||
		text.includes("503") ||
		text.includes("nonce") ||
		text.includes("underpriced") ||
		text.includes("replacement transaction")
	);
}

/**
 * Canonical execution path: ethers provider/signer transaction flow.
 * NOTE(sdk-coverage): official Venus npm tx executor SDK is not publicly available,
 * so execute remains on canonical ethers path even in sdk-first routing.
 * Marker: venus_execute_canonical_ethers_path_no_official_sdk_executor
 */
async function executeVenusSupplyViaCanonicalEthers(params) {
	const {
		rpcUrl,
		chainId,
		privateKey,
		tokenAddress,
		amountRaw,
		vTokenAddress,
		confirmations = 1,
		recipient,
		providerOverride,
	} = params;
	if (!privateKey) {
		throw new Error("bsc_venus_private_key_missing");
	}
	if (!vTokenAddress) {
		throw new Error("bsc_venus_vtoken_missing");
	}
	const provider =
		providerOverride ||
		new JsonRpcProvider(String(rpcUrl || ""), {
			name: "bsc",
			chainId: Number(chainId || 56),
		});
	const wallet = new Wallet(String(privateKey), provider);
	const owner = String(recipient || wallet.address);
	const erc20 = new Interface([
		"function allowance(address owner,address spender) view returns (uint256)",
		"function approve(address spender,uint256 value) returns (bool)",
		"function balanceOf(address owner) view returns (uint256)",
	]);
	const vtoken = new Interface([
		"function mint(uint256 mintAmount) returns (uint256)",
	]);
	const readTokenBalance = async (token, account) => {
		const data = erc20.encodeFunctionData("balanceOf", [account]);
		const raw = await provider.call({ to: token, data });
		return erc20.decodeFunctionResult("balanceOf", raw)[0];
	};
	const readAllowance = async () => {
		const data = erc20.encodeFunctionData("allowance", [
			wallet.address,
			vTokenAddress,
		]);
		const raw = await provider.call({ to: tokenAddress, data });
		return erc20.decodeFunctionResult("allowance", raw)[0];
	};
	const txHashes = [];
	const tokenBefore = await readTokenBalance(tokenAddress, wallet.address);
	const allowance = await readAllowance();
	if (allowance.lt(String(amountRaw))) {
		const approveTx = await wallet.sendTransaction({
			to: tokenAddress,
			data: erc20.encodeFunctionData("approve", [vTokenAddress, MaxUint256]),
			value: 0,
		});
		txHashes.push(approveTx.hash);
		await approveTx.wait(confirmations);
	}
	const mintTx = await wallet.sendTransaction({
		to: vTokenAddress,
		data: vtoken.encodeFunctionData("mint", [String(amountRaw)]),
		value: 0,
	});
	txHashes.push(mintTx.hash);
	const mintReceipt = await mintTx.wait(confirmations);
	const tokenAfter = await readTokenBalance(tokenAddress, wallet.address);
	const tokenInDeltaRaw = tokenBefore.sub(tokenAfter).toString();
	const minExpected = BigInt(String(amountRaw || "0"));
	const actual = BigInt(tokenInDeltaRaw);
	return {
		status: "executed",
		txHash: mintTx.hash,
		txHashes,
		receipt: {
			status: mintReceipt?.status,
			blockNumber: mintReceipt?.blockNumber,
			confirmations,
			tokenInDeltaRaw,
			reconcileOk: actual >= minExpected,
			minExpectedInRaw: String(amountRaw),
		},
		account: owner,
		vToken: vTokenAddress,
		executePath: "canonical-ethers",
	};
}

async function resolveSdkExecuteContext(params) {
	const sdkEnabled = params.sdkEnabled === true;
	const fallbackToNative = params.fallbackToNative !== false;
	const warnings = [];
	const fallback = {
		used: false,
		from: null,
		to: null,
		reason: null,
	};
	let sdkMeta = null;
	let adapter = null;
	let resolvedVToken = String(params.vTokenAddress || "").trim();

	if (!sdkEnabled) {
		return {
			sdkEnabled,
			fallbackToNative,
			warnings,
			fallback,
			sdkMeta,
			adapter,
			resolvedVToken,
		};
	}

	try {
		adapter = await createVenusSdkAdapter({
			rpcUrl: params.rpcUrl,
			chainId: params.chainId,
			comptroller: params.comptroller,
			sdkPackage: params.sdkPackage,
		});
		sdkMeta = adapter?.meta || null;
		const symbol = String(params.tokenSymbol || "USDC").toUpperCase();
		const market = resolveDefaultBscVToken(symbol);
		if (!resolvedVToken) {
			resolvedVToken = String(market?.address || "").trim();
			if (!resolvedVToken) {
				throw new Error(`venus_sdk_market_missing_for_${symbol.toLowerCase()}`);
			}
		}
		if (market?.address && resolvedVToken) {
			const registryAddress = String(market.address).toLowerCase();
			if (registryAddress !== resolvedVToken.toLowerCase()) {
				warnings.push(
					"venus_sdk_registry_vtoken_mismatch_using_requested_vtoken",
				);
			}
		}
	} catch (error) {
		if (!fallbackToNative) throw error;
		fallback.used = true;
		fallback.from = "sdk";
		fallback.to = "native";
		fallback.reason = toErrorMessage(error);
		warnings.push("venus_sdk_execute_failed_fallback_to_native");
	}

	if (!resolvedVToken) {
		resolvedVToken = String(params.vTokenAddress || "").trim();
	}

	return {
		sdkEnabled,
		fallbackToNative,
		warnings,
		fallback,
		sdkMeta,
		adapter,
		resolvedVToken,
	};
}

export async function executeVenusSupplySdkFirst(params) {
	const context = await resolveSdkExecuteContext(params);
	const { sdkEnabled, warnings, fallback, sdkMeta, adapter, resolvedVToken } =
		context;

	if (!resolvedVToken) {
		throw new Error("bsc_venus_vtoken_missing");
	}

	try {
		const native = await executeVenusSupplyViaCanonicalEthers({
			rpcUrl: params.rpcUrl,
			chainId: params.chainId,
			privateKey: params.privateKey,
			tokenAddress: params.tokenAddress,
			amountRaw: params.amountRaw,
			vTokenAddress: resolvedVToken,
			confirmations: params.confirmations,
			recipient: params.recipient,
			providerOverride: adapter?.provider,
		});
		warnings.push(
			"venus_execute_tx_uses_canonical_ethers_signer_no_official_sdk_executor",
		);
		if (fallback.used) {
			warnings.push("venus_execute_path_native_fallback_active");
		} else if (!sdkEnabled) {
			warnings.push("venus_execute_path_native_mode_active");
		}
		return {
			...native,
			mode:
				sdkEnabled && !fallback.used
					? "sdk"
					: fallback.used
						? "native-fallback"
						: "native",
			warnings,
			sdk: {
				enabled: sdkEnabled,
				used: sdkEnabled && !fallback.used,
				fallback: fallback.used,
				meta: sdkMeta,
			},
			fallback,
			error: null,
			remainingNonSdkPath: {
				active: !sdkEnabled || fallback.used,
				marker: fallback.used
					? "venus_execute_non_sdk_native_fallback_path"
					: !sdkEnabled
						? "venus_execute_non_sdk_native_mode"
						: "venus_execute_non_sdk_path_inactive",
				reason: !sdkEnabled
					? "sdk_disabled_or_execute_mode_native"
					: fallback.used
						? fallback.reason || "sdk_unavailable_or_resolution_failed"
						: null,
			},
		};
	} catch (error) {
		const msg = toErrorMessage(error);
		const retryable = isTransientExecError(error);
		throw new Error(
			`BSC_VENUS_POST_ACTION_FAILED retryable=${retryable ? "true" : "false"} message=${msg}`,
		);
	}
}

export const __venusExecuteInternals = {
	executeVenusSupplyViaCanonicalEthers,
	resolveSdkExecuteContext,
};
