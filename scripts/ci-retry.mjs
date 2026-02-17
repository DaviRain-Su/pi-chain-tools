#!/usr/bin/env node
import { spawn } from "node:child_process";

const maxAttempts = Math.max(
	1,
	Number.parseInt(process.env.CI_RETRY_MAX || "3", 10),
);
const retryDelayMs = Math.max(
	0,
	Number.parseInt(process.env.CI_RETRY_DELAY_MS || "2000", 10),
);

function runCiOnce() {
	return new Promise((resolve) => {
		const child = spawn("npm", ["run", "ci"], {
			stdio: "inherit",
			env: process.env,
			shell: process.platform === "win32",
		});
		child.on("exit", (code) => resolve(code ?? 1));
	});
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
	console.log(`\n[ci-retry] attempt ${attempt}/${maxAttempts}`);
	const code = await runCiOnce();
	if (code === 0) {
		console.log("[ci-retry] success");
		process.exit(0);
	}
	if (attempt < maxAttempts) {
		console.log(
			`[ci-retry] failed with code=${code}, retrying in ${retryDelayMs}ms...`,
		);
		await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
	} else {
		console.error(`[ci-retry] failed after ${maxAttempts} attempts`);
		process.exit(code);
	}
}
