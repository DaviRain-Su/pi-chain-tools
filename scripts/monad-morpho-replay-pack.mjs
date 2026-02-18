#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = process.env.MONAD_MORPHO_REPLAY_OUT_DIR || "apps/dashboard/data";
const outPath = path.join(outDir, "monad-morpho-replay-trend.json");

const scenarios = [
	{ id: "success-1", status: "success", retryCount: 0 },
	{
		id: "failure-timeout",
		status: "error",
		retryCount: 2,
		errorCode: "TIMEOUT",
	},
	{ id: "retry-recovered", status: "success", retryCount: 1, recovered: true },
	{ id: "failure-guard", status: "blocked", retryCount: 0, errorCode: "GUARD" },
	{ id: "success-2", status: "success", retryCount: 0 },
];

const totals = scenarios.reduce(
	(acc, row) => {
		acc.total += 1;
		if (row.status === "success") acc.success += 1;
		if (row.status === "error") acc.error += 1;
		if (row.status === "blocked") acc.blocked += 1;
		acc.retries += Number(row.retryCount || 0);
		if (row.recovered) acc.retryRecovered += 1;
		return acc;
	},
	{ total: 0, success: 0, error: 0, blocked: 0, retries: 0, retryRecovered: 0 },
);

const trend = {
	ok: true,
	suite: "monad-morpho-replay-pack-v1",
	generatedAt: new Date().toISOString(),
	totals,
	successRate:
		totals.total > 0 ? Number((totals.success / totals.total).toFixed(4)) : 0,
	reliabilityScore: Math.max(
		0,
		Number(
			((totals.success + totals.retryRecovered * 0.5) / totals.total).toFixed(
				4,
			),
		),
	),
	scenarios,
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(trend, null, 2)}\n`, "utf8");
console.log(`[monad-morpho-replay] wrote ${outPath}`);
