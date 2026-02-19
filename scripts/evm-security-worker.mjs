#!/usr/bin/env node

import process from "node:process";
import {
	formatTerminalSummary,
	parseArgs,
	runSecurityScan,
} from "./evm-security-core.mjs";
import { dispatchSecurityAlerts } from "./evm-security-notify.mjs";

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	const parsed = parseArgs(process.argv.slice(2));
	const intervalSec =
		parsed.intervalSec && parsed.intervalSec > 0 ? parsed.intervalSec : 300;
	console.log(`[evm-security-watch] worker started interval=${intervalSec}s`);
	for (;;) {
		try {
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
			} catch (notifyError) {
				console.error(
					"[evm-security-watch] notify failed (non-fatal)",
					notifyError?.message || notifyError,
				);
			}
		} catch (error) {
			console.error(
				"[evm-security-watch] cycle failed (continuing)",
				error?.message || error,
			);
		}
		await sleep(intervalSec * 1000);
	}
}

main().catch((error) => {
	console.error(
		"[evm-security-watch] fatal startup error",
		error?.message || error,
	);
	process.exitCode = 1;
});
