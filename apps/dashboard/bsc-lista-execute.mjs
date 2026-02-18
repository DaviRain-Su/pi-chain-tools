import { createListaSdkAdapter } from "./bsc-lista-sdk.mjs";

function toErrorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

export async function executeListaSupplySdkFirst(params) {
	const sdkEnabled = params?.sdkEnabled === true;
	const fallbackToNative = params?.fallbackToNative !== false;
	const warnings = [];
	const fallback = {
		used: false,
		from: null,
		to: null,
		reason: null,
	};
	let sdkMeta = null;
	let providerOverride = null;

	if (sdkEnabled) {
		try {
			const createAdapter = params?.createAdapter || createListaSdkAdapter;
			const adapter = await createAdapter({
				rpcUrl: params?.rpcUrl,
				chainId: params?.chainId,
				sdkPackage: params?.sdkPackage,
			});
			sdkMeta = adapter?.meta || null;
			providerOverride = adapter?.provider || null;
		} catch (error) {
			if (!fallbackToNative) throw error;
			fallback.used = true;
			fallback.from = "sdk";
			fallback.to = "native";
			fallback.reason = toErrorMessage(error);
			warnings.push("lista_sdk_execute_failed_fallback_to_native");
		}
	}

	const executeCanonical = params?.executeCanonical;
	if (typeof executeCanonical !== "function") {
		throw new Error("lista_execute_canonical_executor_missing");
	}

	const native = await executeCanonical({ providerOverride });
	warnings.push(
		"lista_execute_tx_uses_canonical_ethers_signer_no_official_sdk_executor",
	);
	if (fallback.used) {
		warnings.push("lista_execute_path_native_fallback_active");
	} else if (!sdkEnabled) {
		warnings.push("lista_execute_path_native_mode_active");
	}

	return {
		...native,
		mode:
			sdkEnabled && !fallback.used
				? "sdk"
				: fallback.used
					? "native-fallback"
					: "native",
		warnings: [
			...(Array.isArray(native?.warnings) ? native.warnings : []),
			...warnings,
		],
		sdk: {
			enabled: sdkEnabled,
			used: sdkEnabled && !fallback.used,
			fallback: fallback.used,
			meta: sdkMeta,
		},
		fallback,
		error: null,
		remainingNonSdkPath: {
			active: true,
			marker: "lista_execute_canonical_ethers_path_no_official_sdk_executor",
			reason: fallback.used
				? fallback.reason || "sdk_resolution_failed"
				: "official_lista_execute_sdk_not_available",
		},
	};
}
