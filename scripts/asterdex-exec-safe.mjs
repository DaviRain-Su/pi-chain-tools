#!/usr/bin/env node
// Deprecated compatibility wrapper: use scripts/hyperliquid-exec-safe.mjs
import { runHyperliquidExecSafe } from "./hyperliquid-exec-safe.mjs";

export const runAsterDexExecSafe = runHyperliquidExecSafe;

if (import.meta.url === `file://${process.argv[1]}`) {
	const result = runHyperliquidExecSafe();
	console.log(JSON.stringify(result, null, 2));
	if (!result.ok) process.exitCode = 1;
}
