#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { compileStrategySpecV0 } from "../apps/dashboard/strategy-compiler.mjs";

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const tmp = await mkdtemp(path.join(os.tmpdir(), "pct-strategy-smoke-"));
	const outSpec = path.join(tmp, "strategy.json");

	try {
		const compiled = compileStrategySpecV0({
			template: "rebalance-crosschain-v0",
		});
		assert(compiled.ok && compiled.spec, "compile failed");
		await writeFile(
			outSpec,
			`${JSON.stringify(compiled.spec, null, 2)}\n`,
			"utf8",
		);

		const loaded = JSON.parse(await readFile(outSpec, "utf8"));
		assert(loaded?.id, "compiled spec missing id");
		assert(
			Array.isArray(loaded?.plan?.steps),
			"compiled spec missing plan.steps",
		);

		const summary = {
			status: "ok",
			template: "rebalance-crosschain-v0",
			specId: loaded.id,
			steps: loaded.plan.steps.length,
			checks: [
				"compile-success",
				"write-success",
				"read-success",
				"structure-success",
			],
		};
		console.log(JSON.stringify(summary, null, 2));
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}

await main();
