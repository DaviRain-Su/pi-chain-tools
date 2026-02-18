export function buildDebridgeExecutionArtifact({
	payload,
	output,
	txHash,
	status,
	error,
}) {
	return {
		type: "debridge_crosschain_execute",
		version: "v1",
		provider: "debridge-mcp",
		status,
		runId: String(payload?.runId || ""),
		originChain: String(payload?.originChain || "").trim() || null,
		destinationChain: String(payload?.destinationChain || "").trim() || null,
		tokenIn: String(payload?.tokenIn || "").trim() || null,
		tokenOut: String(payload?.tokenOut || "").trim() || null,
		amount: String(payload?.amount || "").trim() || null,
		recipient: String(payload?.recipient || "").trim() || null,
		txHash: txHash || null,
		error: error || null,
		rawOutput: output || null,
		occurredAt: new Date().toISOString(),
	};
}

export function reconcileDebridgeExecutionArtifact(artifact) {
	const providerConsistent = artifact?.provider === "debridge-mcp";
	const txHashPresent = /^0x[a-fA-F0-9]{64}$/.test(
		String(artifact?.txHash || ""),
	);
	const normalizedStatus =
		artifact?.status === "success" ? "ok" : artifact?.status;
	return {
		type: "debridge_execution_reconciliation",
		version: "v1",
		ok: normalizedStatus === "ok",
		normalizedStatus,
		providerConsistent,
		txHashPresent,
		issues: [
			...(providerConsistent ? [] : ["provider_mismatch"]),
			...(normalizedStatus === "ok" && !txHashPresent
				? ["tx_hash_missing"]
				: []),
		],
		checkedAt: new Date().toISOString(),
	};
}

export function validateDebridgeExecutionArtifactV1(artifact) {
	if (!artifact || typeof artifact !== "object") return false;
	if (artifact.type !== "debridge_crosschain_execute") return false;
	if (artifact.version !== "v1") return false;
	if (artifact.provider !== "debridge-mcp") return false;
	if (!["success", "blocked", "error"].includes(String(artifact.status || "")))
		return false;
	if (
		!artifact.occurredAt ||
		Number.isNaN(Date.parse(String(artifact.occurredAt)))
	)
		return false;
	return true;
}

export function validateDebridgeExecutionReconciliationV1(reconciliation) {
	if (!reconciliation || typeof reconciliation !== "object") return false;
	if (reconciliation.type !== "debridge_execution_reconciliation") return false;
	if (reconciliation.version !== "v1") return false;
	if (typeof reconciliation.ok !== "boolean") return false;
	if (typeof reconciliation.providerConsistent !== "boolean") return false;
	if (typeof reconciliation.txHashPresent !== "boolean") return false;
	if (!Array.isArray(reconciliation.issues)) return false;
	if (
		!reconciliation.checkedAt ||
		Number.isNaN(Date.parse(String(reconciliation.checkedAt)))
	)
		return false;
	return true;
}

export function classifyDebridgeExecuteError(errorLike) {
	const message = String(errorLike || "").toLowerCase();
	const matchers = [
		{
			pattern: /(timed out|timeout|etimedout)/,
			code: "debridge_execute_timeout",
			retryable: true,
			category: "timeout",
		},
		{
			pattern: /(rate limit|429|too many requests)/,
			code: "debridge_execute_rate_limited",
			retryable: true,
			category: "rate_limit",
		},
		{
			pattern: /(econnreset|econnrefused|enotfound|network|socket hang up)/,
			code: "debridge_execute_network_error",
			retryable: true,
			category: "network",
		},
		{
			pattern: /(insufficient|insufficient funds|balance too low)/,
			code: "debridge_execute_insufficient_funds",
			retryable: false,
			category: "funds",
		},
		{
			pattern: /(revert|invalid param|invalid argument|bad request)/,
			code: "debridge_execute_invalid_request",
			retryable: false,
			category: "request",
		},
		{
			pattern: /(permission|unauthorized|forbidden)/,
			code: "debridge_execute_unauthorized",
			retryable: false,
			category: "auth",
		},
	];
	for (const rule of matchers) {
		if (rule.pattern.test(message)) {
			return {
				code: rule.code,
				retryable: rule.retryable,
				category: rule.category,
			};
		}
	}
	return {
		code: "debridge_execute_unknown_error",
		retryable: false,
		category: "unknown",
	};
}
