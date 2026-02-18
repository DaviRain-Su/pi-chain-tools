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
		const child = spawn("npm", ["run", "ci:resilient"], {
			stdio: "inherit",
			env: process.env,
			shell: process.platform === "win32",
		});
		child.on("close", (code, signal) => {
			resolve({ code: code ?? (signal ? 143 : 1), signal: signal || null });
		});
	});
}

let sigtermRetries = 0;
const maxSigtermRetries = Math.max(
	1,
	Number.parseInt(process.env.CI_RETRY_SIGTERM_MAX || "2", 10),
);

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
	console.log(`\n[ci-retry] attempt ${attempt}/${maxAttempts}`);
	const result = await runCiOnce();
	if (result.code === 0) {
		console.log("[ci-retry] success");
		process.exit(0);
	}
	if (result.code === 2) {
		console.error(
			"[ci-retry] non-retryable precheck failure detected (code=2); stopping retries",
		);
		process.exit(result.code);
	}
	if (result.signal === "SIGTERM" || result.code === 143) {
		sigtermRetries += 1;
		if (sigtermRetries > maxSigtermRetries) {
			console.error(
				`[ci-retry] exceeded SIGTERM retry budget (${sigtermRetries - 1}/${maxSigtermRetries})`,
			);
			process.exit(result.code);
		}
	}
	if (attempt < maxAttempts) {
		const backoffMs =
			retryDelayMs *
			Math.max(1, result.signal === "SIGTERM" || result.code === 143 ? 2 : 1);
		console.log(
			`[ci-retry] ci:resilient failed with code=${result.code}${result.signal ? ` signal=${result.signal}` : ""}, retrying in ${backoffMs}ms...`,
		);
		await new Promise((resolve) => setTimeout(resolve, backoffMs));
	} else {
		console.error(`[ci-retry] failed after ${maxAttempts} attempts`);
		process.exit(result.code);
	}
}
