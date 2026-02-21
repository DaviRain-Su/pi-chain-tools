#!/usr/bin/env node
import { execSync } from "node:child_process";

const steps = [
	"npm run arch:federation:export:near",
	"npm run arch:federation:export:evm",
	"npm run arch:federation:export:solana",
];

for (const step of steps) {
	console.log(`[federation-export-all] ${step}`);
	execSync(step, { stdio: "inherit" });
}

console.log("[federation-export-all] done");
