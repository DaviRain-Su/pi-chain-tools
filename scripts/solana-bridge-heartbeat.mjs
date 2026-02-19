#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const passthrough = [
	"scripts/solana-bridge-safe-batch.mjs",
	"--mode",
	"safe",
	...args,
];
const result = spawnSync(process.execPath, passthrough, {
	stdio: "inherit",
	env: process.env,
});
process.exit(result.status ?? 1);
