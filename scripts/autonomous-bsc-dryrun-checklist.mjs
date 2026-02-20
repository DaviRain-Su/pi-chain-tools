#!/usr/bin/env node

function parseBoolean(raw) {
	return (
		String(raw || "")
			.trim()
			.toLowerCase() === "true"
	);
}

function line(key, value) {
	return `${key}=${value}`;
}

const env = process.env;
const confirmText = String(
	env.BSC_AUTONOMOUS_HYPERLIQUID_CONFIRM_TEXT || "HYPERLIQUID_EXECUTE_LIVE",
);
const checklist = [
	line(
		"BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_ACTIVE",
		env.BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_ACTIVE || "true",
	),
	line(
		"BSC_AUTONOMOUS_HYPERLIQUID_LIVE_COMMAND",
		env.BSC_AUTONOMOUS_HYPERLIQUID_LIVE_COMMAND || "<set-live-command>",
	),
	line("BSC_AUTONOMOUS_HYPERLIQUID_CONFIRM_TEXT", confirmText),
	line(
		"BSC_AUTONOMOUS_HYPERLIQUID_MAX_AMOUNT_RAW",
		env.BSC_AUTONOMOUS_HYPERLIQUID_MAX_AMOUNT_RAW || "1000000000000000000",
	),
	line(
		"BSC_AUTONOMOUS_CYCLE_MIN_LIVE_INTERVAL_SECONDS",
		env.BSC_AUTONOMOUS_CYCLE_MIN_LIVE_INTERVAL_SECONDS || "300",
	),
	line(
		"BSC_AUTONOMOUS_CYCLE_LOCK_TTL_SECONDS",
		env.BSC_AUTONOMOUS_CYCLE_LOCK_TTL_SECONDS || "900",
	),
	line(
		"BSC_AUTONOMOUS_RECONCILE_SNAPSHOT_COMMAND",
		env.BSC_AUTONOMOUS_RECONCILE_SNAPSHOT_COMMAND ||
			"<optional-balance-snapshot-command>",
	),
];

console.log("# BSC autonomous dryrun checklist (copy to .env.bsc.local)");
for (const row of checklist) console.log(row);
console.log("");
console.log("# Dryrun command");
console.log(
	"npm run autonomous:bsc:cycle -- --mode dryrun --run-id dryrun-check",
);
console.log("# Live command (guarded)");
console.log(
	`npm run autonomous:bsc:cycle -- --mode live --run-id live-check --confirm ${confirmText}`,
);

const ready =
	parseBoolean(env.BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_ACTIVE) &&
	String(env.BSC_AUTONOMOUS_HYPERLIQUID_LIVE_COMMAND || "").trim();
if (!ready) {
	console.log(
		"# status: live mode currently blocked until required env keys are set.",
	);
}
