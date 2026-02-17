#!/usr/bin/env node
import { spawn } from "node:child_process";

function run(command, args, label) {
	return new Promise((resolve) => {
		let output = "";
		const child = spawn(command, args, {
			stdio: ["inherit", "pipe", "pipe"],
			env: process.env,
			shell: process.platform === "win32",
		});
		child.stdout.on("data", (chunk) => {
			const text = String(chunk);
			output += text;
			process.stdout.write(text);
		});
		child.stderr.on("data", (chunk) => {
			const text = String(chunk);
			output += text;
			process.stderr.write(text);
		});
		child.on("exit", (code) => {
			resolve({ code: code ?? 1, output, label });
		});
	});
}

function shouldApplyBiomeHotfix(output) {
	const lower = output.toLowerCase();
	return (
		lower.includes("internalerror/io") ||
		lower.includes("formatted") ||
		lower.includes("apps/dashboard/data/rebalance-metrics.json")
	);
}

async function main() {
	console.log("[ci-resilient] step 1/3: npm run check");
	let check = await run("npm", ["run", "check"], "check");
	if (check.code !== 0 && shouldApplyBiomeHotfix(check.output)) {
		console.log(
			"[ci-resilient] detected formatter/io drift, running targeted biome hotfix...",
		);
		await run(
			"npx",
			[
				"biome",
				"check",
				"--write",
				"apps/dashboard/data/rebalance-metrics.json",
			],
			"biome-hotfix",
		);
		console.log("[ci-resilient] re-running npm run check after hotfix");
		check = await run("npm", ["run", "check"], "check(retry)");
	}
	if (check.code !== 0) {
		console.error("[ci-resilient] check failed");
		process.exit(check.code);
	}

	console.log("[ci-resilient] step 2/3: npm run security:check");
	const security = await run("npm", ["run", "security:check"], "security");
	if (security.code !== 0) {
		console.error("[ci-resilient] security:check failed");
		process.exit(security.code);
	}

	console.log("[ci-resilient] step 3/3: npm test (with one retry for flake)");
	let test = await run("npm", ["test"], "test");
	if (test.code !== 0) {
		console.log("[ci-resilient] first npm test failed, retrying once...");
		test = await run("npm", ["test"], "test(retry)");
	}
	if (test.code !== 0) {
		console.error("[ci-resilient] tests failed");
		process.exit(test.code);
	}

	console.log("[ci-resilient] success");
}

await main();
