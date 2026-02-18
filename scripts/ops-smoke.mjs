#!/usr/bin/env node
import { spawn } from "node:child_process";

function run(command, args, label) {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			env: process.env,
			shell: process.platform === "win32",
		});
		child.on("close", (code, signal) => {
			resolve({
				code: code ?? (signal ? 143 : 1),
				signal: signal || null,
				label,
			});
		});
	});
}

async function runWithSigtermRetry(command, args, label) {
	let result = await run(command, args, label);
	if (result.signal === "SIGTERM" || result.code === 143) {
		console.warn(`[ops-smoke] ${label} interrupted by SIGTERM, retrying once`);
		result = await run(command, args, `${label}(sigterm-retry)`);
	}
	return result;
}

async function main() {
	const steps = [
		["npm", ["run", "check"], "check"],
		["npm", ["run", "security:check"], "security:check"],
		["npm", ["test"], "test"],
	];
	for (const [command, args, label] of steps) {
		console.log(`[ops-smoke] step: ${label}`);
		const result = await runWithSigtermRetry(command, args, label);
		if (result.code !== 0) {
			console.error(
				`[ops-smoke] failed at ${label} code=${result.code}${result.signal ? ` signal=${result.signal}` : ""}`,
			);
			console.error(
				"[ops-smoke] hint: run npm run ci:resilient for richer failure signatures and retry guidance",
			);
			process.exit(result.code);
		}
	}
	console.log("[ops-smoke] success");
}

await main();
