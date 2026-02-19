#!/usr/bin/env node

import process from "node:process";
import {
	formatTerminalSummary,
	parseArgs,
	runSecurityScan,
} from "./evm-security-core.mjs";
import { dispatchSecurityAlerts } from "./evm-security-notify.mjs";

async function main() {
	const parsed = parseArgs(process.argv.slice(2));
	const result = await runSecurityScan(parsed);
	console.log(formatTerminalSummary(result));
	try {
		const notifyResult = await dispatchSecurityAlerts({
			report: result.report,
			statePath: parsed.statePath,
		});
		console.log(
			`[evm-security-watch] notify provider=${notifyResult.provider} critical=${notifyResult.sent.critical} warn=${notifyResult.sent.warn} info=${notifyResult.sent.info} errors=${notifyResult.sent.errors.length}`,
		);
	} catch (error) {
		console.error(
			"[evm-security-watch] notify failed (non-fatal)",
			error?.message || error,
		);
	}
	if (result.report.summary.critical > 0) {
		process.exitCode = 2;
	}
}

main().catch((error) => {
	console.error("[evm-security-watch] scan failed", error?.message || error);
	process.exitCode = 1;
});
