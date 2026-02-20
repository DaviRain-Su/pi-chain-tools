function toNonEmptyString(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function toFiniteNumber(value) {
	const num = Number(value);
	return Number.isFinite(num) ? num : null;
}

export function normalizeTxReceipt(receipt, context = {}) {
	const source = receipt && typeof receipt === "object" ? receipt : {};
	const txHash =
		toNonEmptyString(source.txHash) ||
		toNonEmptyString(source.transactionHash) ||
		toNonEmptyString(source.hash) ||
		null;
	return {
		schema: "tx-receipt-normalized/v1",
		chain:
			toNonEmptyString(context.chain) || toNonEmptyString(source.chain) || null,
		runId:
			toNonEmptyString(context.runId) || toNonEmptyString(source.runId) || null,
		mode:
			toNonEmptyString(context.mode) || toNonEmptyString(source.mode) || null,
		status:
			toNonEmptyString(context.status) ||
			toNonEmptyString(source.status) ||
			"unknown",
		txHash,
		blockNumber:
			toFiniteNumber(source.blockNumber) ??
			toFiniteNumber(source.block_height) ??
			null,
		exitCode:
			toFiniteNumber(source.exitCode) ?? toFiniteNumber(source.code) ?? null,
		observedAt: new Date().toISOString(),
	};
}
