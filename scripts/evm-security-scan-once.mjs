#!/usr/bin/env node

import process from "node:process";
import {
	formatTerminalSummary,
	parseArgs,
	runSecurityScan,
} from "./evm-security-core.mjs";

async function main() {
	const parsed = parseArgs(process.argv.slice(2));
	const result = await runSecurityScan(parsed);
	console.log(formatTerminalSummary(result));
	if (result.report.summary.critical > 0) {
		process.exitCode = 2;
	}
}

main().catch((error) => {
	console.error("[evm-security-watch] scan failed", error?.message || error);
	process.exitCode = 1;
});
