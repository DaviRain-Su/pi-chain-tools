#!/usr/bin/env node
import { constants, accessSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function hasEnv(name) {
	return Boolean(String(process.env[name] || "").trim());
}

function checkPathExists(relativePath) {
	const full = path.join(ROOT, relativePath);
	return existsSync(full);
}

function checkPathReadable(relativePath) {
	const full = path.join(ROOT, relativePath);
	try {
		accessSync(full, constants.R_OK);
		return true;
	} catch {
		return false;
	}
}

function summarize() {
	const envChecks = [
		"NEAR_ACCOUNT_ID",
		"NEAR_RPC_URL",
		"TELEGRAM_BOT_TOKEN",
		"TELEGRAM_CHAT_ID",
		"BREEZE_API_BASE_URL",
		"BREEZE_API_KEY",
	];
	const env = Object.fromEntries(
		envChecks.map((name) => [name, { present: hasEnv(name) }]),
	);

	const service = {
		templateExists: checkPathExists("ops/systemd/evm-security-watch.service"),
		envTemplateExists: checkPathExists(
			"ops/systemd/evm-security-watch.env.example",
		),
		helpScriptExists: checkPathExists(
			"scripts/security-watch-service-help.mjs",
		),
		suggest: [
			"npm run security:watch:service:help",
			"sudo systemctl daemon-reload",
			"sudo systemctl enable --now evm-security-watch.service",
		],
	};

	const cron = {
		docExists: checkPathExists("docs/evm-security-watch-cron.md"),
		runbookExists: checkPathExists("docs/openclaw-ops-runbook.md"),
		readmeHasOpsSmoke: checkPathReadable("README.md")
			? readFileSync(path.join(ROOT, "README.md"), "utf8").includes("ops:smoke")
			: false,
	};

	const nextSteps = [];
	if (!env.NEAR_ACCOUNT_ID.present)
		nextSteps.push("Set NEAR_ACCOUNT_ID in your runtime env.");
	if (!env.NEAR_RPC_URL.present)
		nextSteps.push(
			"Set NEAR_RPC_URL (or NEAR_RPC_URLS) for reliable RPC routing.",
		);
	if (!env.TELEGRAM_BOT_TOKEN.present || !env.TELEGRAM_CHAT_ID.present) {
		nextSteps.push("Configure Telegram env to enable alert delivery.");
	}
	if (!env.BREEZE_API_BASE_URL.present || !env.BREEZE_API_KEY.present) {
		nextSteps.push("Configure Breeze env before running npm run breeze:smoke.");
	}
	if (!service.templateExists) {
		nextSteps.push(
			"Add systemd service template under ops/systemd for one-click watcher setup.",
		);
	}
	if (!cron.docExists) {
		nextSteps.push(
			"Add/restore cron readiness docs at docs/evm-security-watch-cron.md.",
		);
	}
	if (nextSteps.length === 0) {
		nextSteps.push(
			"Bootstrap checks passed. You can run smoke + watchers now.",
		);
	}

	const ok = nextSteps.length === 1 && nextSteps[0].includes("passed");
	return {
		ok,
		generatedAt: new Date().toISOString(),
		env,
		service,
		cron,
		nextSteps,
	};
}

const payload = summarize();
console.log(JSON.stringify(payload, null, 2));
console.log("\nOps bootstrap summary:");
console.log(`- status: ${payload.ok ? "ok" : "needs-action"}`);
for (const step of payload.nextSteps) {
	console.log(`- ${step}`);
}
