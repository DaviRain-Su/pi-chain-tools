#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Interface } from "@ethersproject/abi";
import { MaxUint256 } from "@ethersproject/constants";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";

import { reconcileBscExecutionArtifact } from "./bsc-reconcile.mjs";
import {
	buildStrategyDslFromLegacy,
	validateStrategyDslV1,
	validateStrategySemanticV1,
} from "./strategy-dsl.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DASHBOARD_CONFIG_PATH =
	process.env.NEAR_DASHBOARD_CONFIG_PATH ||
	path.join(__dirname, "config", "dashboard.config.json");

function deepGet(obj, dottedPath, fallback = undefined) {
	const parts = String(dottedPath || "")
		.split(".")
		.map((x) => x.trim())
		.filter(Boolean);
	let cur = obj;
	for (const part of parts) {
		if (!cur || typeof cur !== "object" || !(part in cur)) return fallback;
		cur = cur[part];
	}
	return cur === undefined ? fallback : cur;
}

let dashboardConfig = {};
try {
	if (existsSync(DASHBOARD_CONFIG_PATH)) {
		dashboardConfig = JSON.parse(
			readFileSync(DASHBOARD_CONFIG_PATH, "utf8") || "{}",
		);
	}
} catch (error) {
	console.warn(
		`[dashboard] failed to parse config ${DASHBOARD_CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`,
	);
	dashboardConfig = {};
}

const envOrCfg = (envKey, cfgPath, fallback = "") => {
	const envValue = process.env[envKey];
	if (envValue !== undefined && envValue !== "") return envValue;
	const cfgValue = deepGet(dashboardConfig, cfgPath, fallback);
	return cfgValue === undefined || cfgValue === null ? fallback : cfgValue;
};

const PORT = Number.parseInt(
	String(envOrCfg("NEAR_DASHBOARD_PORT", "server.port", "4173")),
	10,
);
const ACCOUNT_ID = String(
	envOrCfg("NEAR_ACCOUNT_ID", "near.accountId", "davirain8.near"),
);
const BURROW_CONTRACT = "contract.main.burrow.near";
const RPC_ENDPOINTS = String(
	envOrCfg(
		"NEAR_RPC_URLS",
		"near.rpcUrls",
		envOrCfg(
			"NEAR_RPC_URL",
			"near.rpcUrl",
			"https://1rpc.io/near,https://rpc.mainnet.near.org",
		),
	),
)
	.split(",")
	.map((value) => value.trim())
	.filter(Boolean);
const SESSION_DIR = String(
	envOrCfg(
		"OPENCLAW_SESSION_DIR",
		"openclaw.sessionDir",
		path.join(
			process.env.HOME || "/home/davirain",
			".openclaw/agents/main/sessions",
		),
	),
);
const METRICS_PATH = String(
	envOrCfg(
		"NEAR_DASHBOARD_METRICS_PATH",
		"paths.metrics",
		path.join(__dirname, "data", "rebalance-metrics.json"),
	),
);
const POLICY_PATH = String(
	envOrCfg(
		"NEAR_DASHBOARD_POLICY_PATH",
		"paths.policy",
		path.join(__dirname, "data", "portfolio-policy.json"),
	),
);
const MARKETPLACE_PATH = String(
	envOrCfg(
		"NEAR_DASHBOARD_MARKETPLACE_PATH",
		"paths.marketplace",
		path.join(__dirname, "data", "strategy-marketplace.json"),
	),
);
const CI_SIGNATURES_PATH = String(
	envOrCfg(
		"CI_SIGNATURES_JSONL_PATH",
		"paths.ciSignatures",
		path.join(__dirname, "data", "ci-signatures.jsonl"),
	),
);
const ALERT_WEBHOOK_URL = String(
	envOrCfg("NEAR_REBAL_ALERT_WEBHOOK_URL", "alerts.webhookUrl", ""),
);
const ALERT_TELEGRAM_BOT_TOKEN = String(
	envOrCfg(
		"NEAR_REBAL_ALERT_TELEGRAM_BOT_TOKEN",
		"alerts.telegramBotToken",
		"",
	),
);
const ALERT_TELEGRAM_CHAT_ID = String(
	envOrCfg("NEAR_REBAL_ALERT_TELEGRAM_CHAT_ID", "alerts.telegramChatId", ""),
);
const ALERT_SUCCESS_ENABLED =
	String(
		envOrCfg("NEAR_REBAL_ALERT_SUCCESS", "alerts.successEnabled", "false"),
	).toLowerCase() === "true";
const ALERT_DEDUPE_WINDOW_MS =
	Number.parseInt(
		String(
			envOrCfg("NEAR_REBAL_ALERT_DEDUPE_MS", "alerts.dedupeWindowMs", "300000"),
		),
		10,
	) || 300000;
const ALERT_BSC_NORMALIZATION_ENABLED =
	String(
		envOrCfg(
			"NEAR_REBAL_ALERT_BSC_NORMALIZATION",
			"alerts.bscNormalizationEnabled",
			"true",
		),
	).toLowerCase() === "true";
const ALERT_BSC_NORMALIZATION_MIN_BAND = String(
	envOrCfg(
		"NEAR_REBAL_ALERT_BSC_NORMALIZATION_MIN_BAND",
		"alerts.bscNormalizationMinBand",
		"medium",
	),
)
	.trim()
	.toLowerCase();
const BSC_CHAIN_ID = Number.parseInt(
	String(envOrCfg("BSC_CHAIN_ID", "bsc.chainId", "56")),
	10,
);
const BSC_RPC_URL = String(
	envOrCfg("BSC_RPC_URL", "bsc.rpcUrl", "https://bsc-dataseed.binance.org"),
);
const BSC_USDT = String(
	envOrCfg(
		"BSC_USDT",
		"bsc.tokens.usdt",
		"0x55d398326f99059fF775485246999027B3197955",
	),
);
const BSC_USDC = String(
	envOrCfg(
		"BSC_USDC",
		"bsc.tokens.usdc",
		"0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
	),
);
const BSC_ROUTER_V2 = String(
	envOrCfg(
		"BSC_ROUTER_V2",
		"bsc.routerV2",
		"0x10ED43C718714eb63d5aA57B78B54704E256024E",
	),
);
const ACP_BIN = String(envOrCfg("ACP_BIN", "acp.bin", "acp"));
const ACP_WORKDIR = String(
	envOrCfg("ACP_WORKDIR", "acp.workdir", process.cwd()),
);
const BSC_USDT_DECIMALS = Number.parseInt(
	String(envOrCfg("BSC_USDT_DECIMALS", "bsc.decimals.usdt", "18")),
	10,
);
const BSC_USDC_DECIMALS = Number.parseInt(
	String(envOrCfg("BSC_USDC_DECIMALS", "bsc.decimals.usdc", "18")),
	10,
);
const BSC_EXECUTE_ENABLED =
	String(
		envOrCfg("BSC_EXECUTE_ENABLED", "bsc.execute.enabled", "false"),
	).toLowerCase() === "true";
const BSC_EXECUTE_MODE = String(
	envOrCfg("BSC_EXECUTE_MODE", "bsc.execute.mode", "auto"),
)
	.trim()
	.toLowerCase();
const BSC_EXECUTE_COMMAND = String(
	envOrCfg("BSC_EXECUTE_COMMAND", "bsc.execute.command", ""),
).trim();
const BSC_EXECUTE_PRIVATE_KEY = String(
	envOrCfg("BSC_EXECUTE_PRIVATE_KEY", "bsc.execute.privateKey", ""),
).trim();
const BSC_EXECUTE_RECIPIENT = String(
	envOrCfg("BSC_EXECUTE_RECIPIENT", "bsc.execute.recipient", ""),
).trim();
const BSC_EXECUTE_CONFIRMATIONS = Math.max(
	1,
	Number.parseInt(
		String(
			envOrCfg("BSC_EXECUTE_CONFIRMATIONS", "bsc.execute.confirmations", "1"),
		),
		10,
	) || 1,
);
const BSC_EXECUTE_GAS_BUMP_PERCENT = Math.max(
	0,
	Number.parseInt(
		String(
			envOrCfg(
				"BSC_EXECUTE_GAS_BUMP_PERCENT",
				"bsc.execute.gasBumpPercent",
				"15",
			),
		),
		10,
	) || 15,
);
const BSC_EXECUTE_NONCE_RETRY = Math.max(
	0,
	Number.parseInt(
		String(envOrCfg("BSC_EXECUTE_NONCE_RETRY", "bsc.execute.nonceRetry", "1")),
		10,
	) || 1,
);
const BSC_QUOTE_MAX_DIVERGENCE_BPS = Math.max(
	0,
	Number.parseInt(
		String(
			envOrCfg(
				"BSC_QUOTE_MAX_DIVERGENCE_BPS",
				"bsc.quote.maxDivergenceBps",
				"800",
			),
		),
		10,
	) || 800,
);
const BSC_YIELD_MIN_APR_DELTA_BPS = Math.max(
	0,
	Number.parseInt(
		String(
			envOrCfg("BSC_YIELD_MIN_APR_DELTA_BPS", "bsc.yield.minAprDeltaBps", "30"),
		),
		10,
	) || 30,
);
const BSC_YIELD_REBALANCE_INTERVAL_DAYS = Math.max(
	1,
	Number.parseInt(
		String(
			envOrCfg(
				"BSC_YIELD_REBALANCE_INTERVAL_DAYS",
				"bsc.yield.rebalanceIntervalDays",
				"7",
			),
		),
		10,
	) || 7,
);
const BSC_YIELD_DEFAULT_QUOTE_USD = Math.max(
	1,
	Number.parseFloat(
		String(
			envOrCfg(
				"BSC_YIELD_DEFAULT_QUOTE_USD",
				"bsc.yield.defaultQuoteUsd",
				"100",
			),
		),
	) || 100,
);
const BSC_STABLE_APR_HINTS_JSON = String(
	envOrCfg("BSC_STABLE_APR_HINTS_JSON", "bsc.yield.stableAprHintsJson", ""),
).trim();
const BSC_AAVE_APR_HINTS_JSON = String(
	envOrCfg("BSC_AAVE_APR_HINTS_JSON", "bsc.yield.aaveAprHintsJson", ""),
).trim();
const BSC_LISTA_APR_HINTS_JSON = String(
	envOrCfg("BSC_LISTA_APR_HINTS_JSON", "bsc.yield.listaAprHintsJson", ""),
).trim();
const BSC_WOMBAT_APR_HINTS_JSON = String(
	envOrCfg("BSC_WOMBAT_APR_HINTS_JSON", "bsc.yield.wombatAprHintsJson", ""),
).trim();
const BSC_LISTA_APR_API_URL = String(
	envOrCfg("BSC_LISTA_APR_API_URL", "bsc.yield.listaAprApiUrl", ""),
).trim();
const BSC_WOMBAT_APR_API_URL = String(
	envOrCfg("BSC_WOMBAT_APR_API_URL", "bsc.yield.wombatAprApiUrl", ""),
).trim();
const BSC_VENUS_APR_API_URL = String(
	envOrCfg("BSC_VENUS_APR_API_URL", "bsc.yield.venusAprApiUrl", ""),
).trim();
const BSC_AAVE_APR_API_URL = String(
	envOrCfg("BSC_AAVE_APR_API_URL", "bsc.yield.aaveAprApiUrl", ""),
).trim();
const BSC_APR_CACHE_TTL_MS = Math.max(
	5_000,
	Number.parseInt(
		String(
			envOrCfg("BSC_APR_CACHE_TTL_MS", "bsc.yield.aprCacheTtlMs", "60000"),
		),
		10,
	) || 60_000,
);
const BSC_AAVE_EXECUTE_ENABLED =
	String(
		envOrCfg("BSC_AAVE_EXECUTE_ENABLED", "bsc.aave.enabled", "false"),
	).toLowerCase() === "true";
const BSC_LISTA_EXECUTE_ENABLED =
	String(
		envOrCfg("BSC_LISTA_EXECUTE_ENABLED", "bsc.lista.enabled", "false"),
	).toLowerCase() === "true";
const BSC_LISTA_EXECUTE_COMMAND = String(
	envOrCfg("BSC_LISTA_EXECUTE_COMMAND", "bsc.lista.executeCommand", ""),
).trim();
const BSC_LISTA_EXECUTE_MODE = String(
	envOrCfg("BSC_LISTA_EXECUTE_MODE", "bsc.lista.mode", "auto"),
)
	.trim()
	.toLowerCase();
const BSC_LISTA_NATIVE_EXECUTE_ENABLED =
	String(
		envOrCfg(
			"BSC_LISTA_NATIVE_EXECUTE_ENABLED",
			"bsc.lista.nativeEnabled",
			"false",
		),
	).toLowerCase() === "true";
const BSC_LISTA_EXECUTE_TIMEOUT_MS = Math.max(
	1_000,
	Number.parseInt(
		String(
			envOrCfg(
				"BSC_LISTA_EXECUTE_TIMEOUT_MS",
				"bsc.lista.executeTimeoutMs",
				"120000",
			),
		),
		10,
	) || 120_000,
);
const BSC_LISTA_MAX_AMOUNT_RAW = String(
	envOrCfg(
		"BSC_LISTA_MAX_AMOUNT_RAW",
		"bsc.lista.maxAmountRaw",
		"20000000000000000000000",
	),
).trim();
const BSC_LISTA_ALLOWED_TOKENS = String(
	envOrCfg(
		"BSC_LISTA_ALLOWED_TOKENS",
		"bsc.lista.allowedTokens",
		`${BSC_USDC},${BSC_USDT}`,
	),
)
	.split(",")
	.map((x) => x.trim().toLowerCase())
	.filter(Boolean);
const BSC_WOMBAT_EXECUTE_ENABLED =
	String(
		envOrCfg("BSC_WOMBAT_EXECUTE_ENABLED", "bsc.wombat.enabled", "false"),
	).toLowerCase() === "true";
const BSC_WOMBAT_EXECUTE_COMMAND = String(
	envOrCfg("BSC_WOMBAT_EXECUTE_COMMAND", "bsc.wombat.executeCommand", ""),
).trim();
const BSC_WOMBAT_EXECUTE_MODE = String(
	envOrCfg("BSC_WOMBAT_EXECUTE_MODE", "bsc.wombat.mode", "auto"),
)
	.trim()
	.toLowerCase();
const BSC_WOMBAT_NATIVE_EXECUTE_ENABLED =
	String(
		envOrCfg(
			"BSC_WOMBAT_NATIVE_EXECUTE_ENABLED",
			"bsc.wombat.nativeEnabled",
			"false",
		),
	).toLowerCase() === "true";
const BSC_WOMBAT_EXECUTE_TIMEOUT_MS = Math.max(
	1_000,
	Number.parseInt(
		String(
			envOrCfg(
				"BSC_WOMBAT_EXECUTE_TIMEOUT_MS",
				"bsc.wombat.executeTimeoutMs",
				"120000",
			),
		),
		10,
	) || 120_000,
);
const BSC_WOMBAT_MAX_AMOUNT_RAW = String(
	envOrCfg(
		"BSC_WOMBAT_MAX_AMOUNT_RAW",
		"bsc.wombat.maxAmountRaw",
		"20000000000000000000000",
	),
).trim();
const BSC_WOMBAT_ALLOWED_TOKENS = String(
	envOrCfg(
		"BSC_WOMBAT_ALLOWED_TOKENS",
		"bsc.wombat.allowedTokens",
		`${BSC_USDC},${BSC_USDT}`,
	),
)
	.split(",")
	.map((x) => x.trim().toLowerCase())
	.filter(Boolean);
const BSC_YIELD_EXECUTION_PROTOCOL_DEFAULT = String(
	envOrCfg(
		"BSC_YIELD_EXECUTION_PROTOCOL_DEFAULT",
		"bsc.yield.executionProtocolDefault",
		"venus",
	),
)
	.trim()
	.toLowerCase();
const BSC_AAVE_EXECUTE_COMMAND = String(
	envOrCfg("BSC_AAVE_EXECUTE_COMMAND", "bsc.aave.executeCommand", ""),
).trim();
const BSC_AAVE_EXECUTE_MODE = String(
	envOrCfg("BSC_AAVE_EXECUTE_MODE", "bsc.aave.mode", "auto"),
)
	.trim()
	.toLowerCase();
const BSC_AAVE_POOL = String(
	envOrCfg("BSC_AAVE_POOL", "bsc.aave.pool", ""),
).trim();
const BSC_AAVE_EXECUTE_PRIVATE_KEY = String(
	envOrCfg(
		"BSC_AAVE_EXECUTE_PRIVATE_KEY",
		"bsc.aave.privateKey",
		BSC_EXECUTE_PRIVATE_KEY || "",
	),
).trim();
const BSC_AAVE_REFERRAL_CODE = Math.max(
	0,
	Number.parseInt(
		String(envOrCfg("BSC_AAVE_REFERRAL_CODE", "bsc.aave.referralCode", "0")),
		10,
	) || 0,
);
const BSC_AAVE_MAX_AMOUNT_RAW = String(
	envOrCfg(
		"BSC_AAVE_MAX_AMOUNT_RAW",
		"bsc.aave.maxAmountRaw",
		"20000000000000000000000",
	),
).trim();
const BSC_AAVE_ALLOWED_TOKENS = String(
	envOrCfg(
		"BSC_AAVE_ALLOWED_TOKENS",
		"bsc.aave.allowedTokens",
		`${BSC_USDC},${BSC_USDT}`,
	),
)
	.split(",")
	.map((x) => x.trim().toLowerCase())
	.filter(Boolean);
const BSC_AAVE_ATOKEN_USDC = String(
	envOrCfg("BSC_AAVE_ATOKEN_USDC", "bsc.positions.aaveAtokenUsdc", ""),
).trim();
const BSC_AAVE_ATOKEN_USDT = String(
	envOrCfg("BSC_AAVE_ATOKEN_USDT", "bsc.positions.aaveAtokenUsdt", ""),
).trim();
const BSC_VENUS_VTOKEN_USDC = String(
	envOrCfg("BSC_VENUS_VTOKEN_USDC", "bsc.positions.venusVtokenUsdc", ""),
).trim();
const BSC_VENUS_VTOKEN_USDT = String(
	envOrCfg("BSC_VENUS_VTOKEN_USDT", "bsc.positions.venusVtokenUsdt", ""),
).trim();
const BSC_LISTA_TOKEN_USDC = String(
	envOrCfg("BSC_LISTA_TOKEN_USDC", "bsc.positions.listaTokenUsdc", ""),
).trim();
const BSC_LISTA_TOKEN_USDT = String(
	envOrCfg("BSC_LISTA_TOKEN_USDT", "bsc.positions.listaTokenUsdt", ""),
).trim();
const BSC_WOMBAT_TOKEN_USDC = String(
	envOrCfg("BSC_WOMBAT_TOKEN_USDC", "bsc.positions.wombatTokenUsdc", ""),
).trim();
const BSC_WOMBAT_TOKEN_USDT = String(
	envOrCfg("BSC_WOMBAT_TOKEN_USDT", "bsc.positions.wombatTokenUsdt", ""),
).trim();
const BSC_LISTA_USDC_EXCHANGE_RATE = Math.max(
	0,
	Number.parseFloat(
		String(
			envOrCfg(
				"BSC_LISTA_USDC_EXCHANGE_RATE",
				"bsc.positions.listaUsdcExchangeRate",
				"1",
			),
		),
	) || 1,
);
const BSC_LISTA_USDT_EXCHANGE_RATE = Math.max(
	0,
	Number.parseFloat(
		String(
			envOrCfg(
				"BSC_LISTA_USDT_EXCHANGE_RATE",
				"bsc.positions.listaUsdtExchangeRate",
				"1",
			),
		),
	) || 1,
);
const BSC_WOMBAT_USDC_EXCHANGE_RATE = Math.max(
	0,
	Number.parseFloat(
		String(
			envOrCfg(
				"BSC_WOMBAT_USDC_EXCHANGE_RATE",
				"bsc.positions.wombatUsdcExchangeRate",
				"1",
			),
		),
	) || 1,
);
const BSC_WOMBAT_USDT_EXCHANGE_RATE = Math.max(
	0,
	Number.parseFloat(
		String(
			envOrCfg(
				"BSC_WOMBAT_USDT_EXCHANGE_RATE",
				"bsc.positions.wombatUsdtExchangeRate",
				"1",
			),
		),
	) || 1,
);
const BSC_LISTA_POSITION_RATE_API_URL = String(
	envOrCfg(
		"BSC_LISTA_POSITION_RATE_API_URL",
		"bsc.positions.listaRateApiUrl",
		"",
	),
).trim();
const BSC_WOMBAT_POSITION_RATE_API_URL = String(
	envOrCfg(
		"BSC_WOMBAT_POSITION_RATE_API_URL",
		"bsc.positions.wombatRateApiUrl",
		"",
	),
).trim();
const BSC_POSITION_RATE_CACHE_TTL_MS = Math.max(
	5_000,
	Number.parseInt(
		String(
			envOrCfg(
				"BSC_POSITION_RATE_CACHE_TTL_MS",
				"bsc.positions.rateCacheTtlMs",
				"60000",
			),
		),
		10,
	) || 60_000,
);
const ACP_DISMISSED_PURGE_ENABLED =
	String(
		envOrCfg(
			"ACP_DISMISSED_PURGE_ENABLED",
			"acp.dismissedPurge.enabled",
			"false",
		),
	).toLowerCase() === "true";
const ACP_DISMISSED_PURGE_DAYS = Math.max(
	0,
	Number.parseInt(
		String(
			envOrCfg("ACP_DISMISSED_PURGE_DAYS", "acp.dismissedPurge.days", "7"),
		),
		10,
	) || 7,
);
const ACP_DISMISSED_PURGE_INTERVAL_MS = Math.max(
	60_000,
	Number.parseInt(
		String(
			envOrCfg(
				"ACP_DISMISSED_PURGE_INTERVAL_MS",
				"acp.dismissedPurge.intervalMs",
				String(6 * 60 * 60 * 1000),
			),
		),
		10,
	) || 6 * 60 * 60 * 1000,
);
const PAYMENT_WEBHOOK_SECRET = String(
	envOrCfg("PAYMENT_WEBHOOK_SECRET", "payments.webhookSecret", ""),
).trim();
const PAYMENT_WEBHOOK_PROVIDER = String(
	envOrCfg("PAYMENT_WEBHOOK_PROVIDER", "payments.webhookProvider", "generic"),
)
	.trim()
	.toLowerCase();
const NEAR_RPC_RETRY_ROUNDS = Number.parseInt(
	String(envOrCfg("NEAR_RPC_RETRY_ROUNDS", "near.rpcRetry.rounds", "2")),
	10,
);
const NEAR_RPC_RETRY_BASE_MS = Number.parseInt(
	String(envOrCfg("NEAR_RPC_RETRY_BASE_MS", "near.rpcRetry.baseMs", "250")),
	10,
);
const NEAR_RPC_ALERT_RETRY_RATE = Number.parseFloat(
	String(
		envOrCfg(
			"NEAR_RPC_ALERT_RETRY_RATE",
			"near.rpcRetry.alertRetryRate",
			"0.2",
		),
	),
);
const NEAR_RPC_ALERT_429_COUNT = Number.parseInt(
	String(
		envOrCfg("NEAR_RPC_ALERT_429_COUNT", "near.rpcRetry.alert429Count", "10"),
	),
	10,
);
const NEAR_RPC_WARMUP_CALLS = Number.parseInt(
	String(
		envOrCfg(
			"NEAR_RPC_WARMUP_CALLS",
			"near.rpcRetry.warmupCalls",
			String(Math.max(2, RPC_ENDPOINTS.length * 2)),
		),
	),
	10,
);

const ACTION_HISTORY = [];
const TOKEN_DECIMALS_CACHE = new Map();
const REBALANCE_STATE = {
	lastExecutedAt: 0,
	dailyWindowDay: "",
	dailyCount: 0,
	activeRunId: null,
	recentRuns: new Map(),
};
const ALERT_DEDUPE_CACHE = new Map();
const RPC_METRICS = {
	totalCalls: 0,
	totalAttempts: 0,
	totalRetries: 0,
	http429: 0,
	http5xx: 0,
	lastSuccessEndpoint: null,
	lastError: null,
	endpointStats: Object.fromEntries(
		RPC_ENDPOINTS.map((endpoint) => [
			endpoint,
			{ attempts: 0, success: 0, errors: 0, http429: 0, http5xx: 0 },
		]),
	),
};
const REBALANCE_METRICS = {
	totalRuns: 0,
	successRuns: 0,
	failedRuns: 0,
	rollbackRuns: 0,
	reconcileWarnings: 0,
	recent: [],
	pnlSeries: [],
};
const PAYMENT_WEBHOOK_METRICS = {
	accepted: 0,
	idempotent: 0,
	rejected: 0,
	lastEventAt: null,
	lastProvider: null,
	lastError: null,
};
const ACP_JOB_HISTORY = [];
const ACP_JOB_STATE = {
	dailyWindowDay: "",
	dailyCount: 0,
};
const ACP_ASYNC_JOBS = [];
let ACP_ASYNC_WORKER_ACTIVE = false;
const BSC_YIELD_WORKER = {
	running: false,
	dryRun: true,
	intervalMs: 5 * 60 * 1000,
	maxStepUsd: 100,
	minDriftBps: 500,
	minAprDeltaBps: BSC_YIELD_MIN_APR_DELTA_BPS,
	targetUsdcBps: 7000,
	lastRunAt: null,
	lastPlan: null,
	lastExecute: null,
	lastError: null,
	timer: null,
};
const BSC_APR_CACHE = {
	venus: { ts: 0, value: null },
	aave: { ts: 0, value: null },
	lista: { ts: 0, value: null },
	wombat: { ts: 0, value: null },
};
const BSC_APR_SOURCE_HEALTH = {
	venus: { lastSuccessAt: null, lastErrorAt: null, lastError: null },
	aave: { lastSuccessAt: null, lastErrorAt: null, lastError: null },
	lista: { lastSuccessAt: null, lastErrorAt: null, lastError: null },
	wombat: { lastSuccessAt: null, lastErrorAt: null, lastError: null },
};
const BSC_POSITION_RATE_CACHE = {
	lista: { ts: 0, value: null, source: "env" },
	wombat: { ts: 0, value: null, source: "env" },
};
const STRATEGY_CATALOG = [];
const STRATEGY_PURCHASES = [];
const STRATEGY_ENTITLEMENTS = [];
const STRATEGY_PAYMENTS = [];
const PAYMENT_WEBHOOK_EVENTS = [];
const PORTFOLIO_POLICY = {
	targetAllocation: { near: 0.6, bsc: 0.4 },
	constraints: {
		maxChainExposure: { near: 0.8, bsc: 0.8 },
		maxSingleTokenExposure: 0.5,
		minRebalanceUsd: 50,
		maxDailyRebalanceRuns: 10,
	},
	monetization: {
		settlementToken: "USDC",
		platformTakeRate: 0.15,
	},
	updatedAt: null,
};

async function saveMetricsToDisk() {
	try {
		await mkdir(path.dirname(METRICS_PATH), { recursive: true });
		await writeFile(
			METRICS_PATH,
			JSON.stringify(
				{
					rebalanceMetrics: REBALANCE_METRICS,
					rpcMetrics: RPC_METRICS,
					paymentWebhookMetrics: PAYMENT_WEBHOOK_METRICS,
					acpJobHistory: ACP_JOB_HISTORY,
					acpAsyncJobs: ACP_ASYNC_JOBS,
				},
				null,
				2,
			),
		);
	} catch {
		// best-effort persistence
	}
}

async function loadMetricsFromDisk() {
	try {
		const raw = await readFile(METRICS_PATH, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return;
		const rebalance = parsed.rebalanceMetrics || parsed;
		REBALANCE_METRICS.totalRuns = Number(rebalance.totalRuns || 0);
		REBALANCE_METRICS.successRuns = Number(rebalance.successRuns || 0);
		REBALANCE_METRICS.failedRuns = Number(rebalance.failedRuns || 0);
		REBALANCE_METRICS.rollbackRuns = Number(rebalance.rollbackRuns || 0);
		REBALANCE_METRICS.reconcileWarnings = Number(
			rebalance.reconcileWarnings || 0,
		);
		REBALANCE_METRICS.recent = Array.isArray(rebalance.recent)
			? rebalance.recent.slice(0, 30)
			: [];
		REBALANCE_METRICS.pnlSeries = Array.isArray(rebalance.pnlSeries)
			? rebalance.pnlSeries.slice(0, 100)
			: [];

		const webhook = parsed.paymentWebhookMetrics;
		if (webhook && typeof webhook === "object") {
			PAYMENT_WEBHOOK_METRICS.accepted = Number(webhook.accepted || 0);
			PAYMENT_WEBHOOK_METRICS.idempotent = Number(webhook.idempotent || 0);
			PAYMENT_WEBHOOK_METRICS.rejected = Number(webhook.rejected || 0);
			PAYMENT_WEBHOOK_METRICS.lastEventAt = webhook.lastEventAt || null;
			PAYMENT_WEBHOOK_METRICS.lastProvider = webhook.lastProvider || null;
			PAYMENT_WEBHOOK_METRICS.lastError = webhook.lastError || null;
		}

		const acpHistory = parsed.acpJobHistory;
		if (Array.isArray(acpHistory)) {
			ACP_JOB_HISTORY.length = 0;
			ACP_JOB_HISTORY.push(...acpHistory.slice(0, 50));
		}

		const acpAsyncJobs = parsed.acpAsyncJobs;
		if (Array.isArray(acpAsyncJobs)) {
			ACP_ASYNC_JOBS.length = 0;
			for (const row of acpAsyncJobs.slice(0, 200)) {
				const status = String(row?.status || "queued");
				ACP_ASYNC_JOBS.push({
					jobId: String(row?.jobId || `acp-job-${Date.now()}`),
					status: status === "running" ? "queued" : status,
					createdAt: row?.createdAt || new Date().toISOString(),
					updatedAt: row?.updatedAt || new Date().toISOString(),
					dismissedAt: row?.dismissedAt || null,
					payload: row?.payload || {},
					result: row?.result || null,
					error: row?.error || null,
					attemptCount: Math.max(0, Number(row?.attemptCount || 0)),
					maxAttempts: Math.max(1, Number(row?.maxAttempts || 3)),
					nextAttemptAt: row?.nextAttemptAt || null,
					lastErrorAt: row?.lastErrorAt || null,
				});
			}
		}

		const rpc = parsed.rpcMetrics;
		if (rpc && typeof rpc === "object") {
			RPC_METRICS.totalCalls = Number(rpc.totalCalls || 0);
			RPC_METRICS.totalAttempts = Number(rpc.totalAttempts || 0);
			RPC_METRICS.totalRetries = Number(rpc.totalRetries || 0);
			RPC_METRICS.http429 = Number(rpc.http429 || 0);
			RPC_METRICS.http5xx = Number(rpc.http5xx || 0);
			RPC_METRICS.lastSuccessEndpoint = rpc.lastSuccessEndpoint || null;
			RPC_METRICS.lastError = rpc.lastError || null;
			if (rpc.endpointStats && typeof rpc.endpointStats === "object") {
				for (const endpoint of RPC_ENDPOINTS) {
					const v = rpc.endpointStats[endpoint] || {};
					RPC_METRICS.endpointStats[endpoint] = {
						attempts: Number(v.attempts || 0),
						success: Number(v.success || 0),
						errors: Number(v.errors || 0),
						http429: Number(v.http429 || 0),
						http5xx: Number(v.http5xx || 0),
					};
				}
			}
		}
	} catch {
		// ignore missing/corrupt metrics file
	}
}

async function savePolicyToDisk() {
	try {
		await mkdir(path.dirname(POLICY_PATH), { recursive: true });
		PORTFOLIO_POLICY.updatedAt = new Date().toISOString();
		await writeFile(POLICY_PATH, JSON.stringify(PORTFOLIO_POLICY, null, 2));
	} catch {
		// best-effort persistence
	}
}

async function loadPolicyFromDisk() {
	try {
		const raw = await readFile(POLICY_PATH, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return;
		if (
			parsed.targetAllocation &&
			typeof parsed.targetAllocation === "object"
		) {
			PORTFOLIO_POLICY.targetAllocation = {
				...PORTFOLIO_POLICY.targetAllocation,
				...parsed.targetAllocation,
			};
		}
		if (parsed.constraints && typeof parsed.constraints === "object") {
			PORTFOLIO_POLICY.constraints = {
				...PORTFOLIO_POLICY.constraints,
				...parsed.constraints,
			};
		}
		if (parsed.monetization && typeof parsed.monetization === "object") {
			PORTFOLIO_POLICY.monetization = {
				...PORTFOLIO_POLICY.monetization,
				...parsed.monetization,
			};
		}
		PORTFOLIO_POLICY.updatedAt = parsed.updatedAt || null;
	} catch {
		// ignore missing/corrupt policy file
	}
}

async function saveMarketplaceToDisk() {
	try {
		await mkdir(path.dirname(MARKETPLACE_PATH), { recursive: true });
		await writeFile(
			MARKETPLACE_PATH,
			JSON.stringify(
				{
					strategies: STRATEGY_CATALOG,
					purchases: STRATEGY_PURCHASES,
					entitlements: STRATEGY_ENTITLEMENTS,
					payments: STRATEGY_PAYMENTS,
					paymentWebhookEvents: PAYMENT_WEBHOOK_EVENTS,
				},
				null,
				2,
			),
		);
	} catch {
		// best-effort persistence
	}
}

async function loadMarketplaceFromDisk() {
	try {
		const raw = await readFile(MARKETPLACE_PATH, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return;
		STRATEGY_CATALOG.length = 0;
		STRATEGY_PURCHASES.length = 0;
		STRATEGY_ENTITLEMENTS.length = 0;
		STRATEGY_PAYMENTS.length = 0;
		PAYMENT_WEBHOOK_EVENTS.length = 0;
		if (Array.isArray(parsed.strategies)) {
			STRATEGY_CATALOG.push(...parsed.strategies.slice(0, 200));
		}
		if (Array.isArray(parsed.purchases)) {
			STRATEGY_PURCHASES.push(...parsed.purchases.slice(0, 500));
		}
		if (Array.isArray(parsed.entitlements)) {
			STRATEGY_ENTITLEMENTS.push(...parsed.entitlements.slice(0, 1000));
		}
		if (Array.isArray(parsed.payments)) {
			STRATEGY_PAYMENTS.push(...parsed.payments.slice(0, 1000));
		}
		if (Array.isArray(parsed.paymentWebhookEvents)) {
			PAYMENT_WEBHOOK_EVENTS.push(
				...parsed.paymentWebhookEvents.slice(0, 2000),
			);
		}
	} catch {
		// ignore missing/corrupt marketplace file
	}
}

const TOKENS = [
	{ symbol: "USDt", contractId: "usdt.tether-token.near", decimals: 6 },
	{
		symbol: "USDC.e",
		contractId: "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
		decimals: 6,
	},
	{
		symbol: "USDC",
		contractId:
			"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
		decimals: 6,
	},
	{
		symbol: "DAI",
		contractId: "6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near",
		decimals: 18,
	},
	{ symbol: "wNEAR", contractId: "wrap.near", decimals: 24 },
];

function json(res, status, data) {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(JSON.stringify(data));
}

function toBase64(input) {
	return Buffer.from(input, "utf8").toString("base64");
}

function formatUnits(raw, decimals) {
	const value = BigInt(raw || "0");
	const base = 10n ** BigInt(decimals);
	const whole = value / base;
	const fraction = value % base;
	const fractionText = fraction.toString().padStart(decimals, "0").slice(0, 6);
	return `${whole}.${fractionText}`.replace(/\.0+$/, "").replace(/\.$/, "");
}

function getRpcEndpointsByHealth() {
	const ranked = Object.entries(RPC_METRICS.endpointStats)
		.map(([endpoint, stats]) => {
			const attempts = Number(stats?.attempts || 0);
			const success = Number(stats?.success || 0);
			const errors = Number(stats?.errors || 0);
			const score = attempts > 0 ? (success - errors) / attempts : 0;
			return { endpoint, attempts, score };
		})
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return b.attempts - a.attempts;
		})
		.map((row) => row.endpoint);
	if (ranked.length === 0) return [...RPC_ENDPOINTS];
	const missing = RPC_ENDPOINTS.filter(
		(endpoint) => !ranked.includes(endpoint),
	);
	return [...ranked, ...missing];
}

function getRpcEndpointsForCall() {
	if (RPC_ENDPOINTS.length <= 1) return [...RPC_ENDPOINTS];
	if (RPC_METRICS.totalCalls < Math.max(1, NEAR_RPC_WARMUP_CALLS)) {
		const offset = RPC_METRICS.totalCalls % RPC_ENDPOINTS.length;
		return [...RPC_ENDPOINTS.slice(offset), ...RPC_ENDPOINTS.slice(0, offset)];
	}
	return getRpcEndpointsByHealth();
}

async function nearRpc(method, params) {
	RPC_METRICS.totalCalls += 1;
	let lastError = null;
	const rounds = Math.max(1, NEAR_RPC_RETRY_ROUNDS + 1);
	for (let round = 0; round < rounds; round += 1) {
		const orderedEndpoints = getRpcEndpointsForCall();
		for (const endpoint of orderedEndpoints) {
			RPC_METRICS.totalAttempts += 1;
			if (round > 0) RPC_METRICS.totalRetries += 1;
			if (!RPC_METRICS.endpointStats[endpoint]) {
				RPC_METRICS.endpointStats[endpoint] = {
					attempts: 0,
					success: 0,
					errors: 0,
					http429: 0,
					http5xx: 0,
				};
			}
			const es = RPC_METRICS.endpointStats[endpoint];
			es.attempts += 1;
			try {
				const response = await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: "near-dashboard",
						method,
						params,
					}),
				});
				if (!response.ok) {
					es.errors += 1;
					if (response.status === 429) {
						RPC_METRICS.http429 += 1;
						es.http429 += 1;
					}
					if (response.status >= 500) {
						RPC_METRICS.http5xx += 1;
						es.http5xx += 1;
					}
					if (response.status === 429 || response.status >= 500) {
						lastError = new Error(`RPC HTTP ${response.status} at ${endpoint}`);
						RPC_METRICS.lastError = lastError.message;
						continue;
					}
					throw new Error(`RPC HTTP ${response.status} at ${endpoint}`);
				}
				const payload = await response.json();
				if (payload.error) {
					es.errors += 1;
					const msg = String(
						payload.error?.message || `RPC error at ${endpoint}`,
					);
					if (
						msg.toLowerCase().includes("too many requests") ||
						msg.toLowerCase().includes("timeout")
					) {
						lastError = new Error(msg);
						RPC_METRICS.lastError = msg;
						continue;
					}
					throw new Error(msg);
				}
				es.success += 1;
				RPC_METRICS.lastSuccessEndpoint = endpoint;
				return { result: payload.result, endpoint };
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				RPC_METRICS.lastError = lastError.message;
			}
		}
		if (round < rounds - 1) {
			const sleepMs = NEAR_RPC_RETRY_BASE_MS * (round + 1);
			await new Promise((resolve) => setTimeout(resolve, sleepMs));
		}
	}
	throw lastError || new Error("All RPC endpoints failed");
}

async function viewFunction(contractId, methodName, args = {}) {
	const { result } = await nearRpc("query", {
		request_type: "call_function",
		finality: "final",
		account_id: contractId,
		method_name: methodName,
		args_base64: toBase64(JSON.stringify(args)),
	});
	const raw = Buffer.from(result.result).toString("utf8");
	return raw ? JSON.parse(raw) : null;
}

async function getNearBalance(accountId) {
	const { result: state, endpoint } = await nearRpc("query", {
		request_type: "view_account",
		finality: "final",
		account_id: accountId,
	});
	return {
		availableRaw: state.amount,
		available: formatUnits(state.amount, 24),
		lockedRaw: state.locked,
		locked: formatUnits(state.locked, 24),
		rpcEndpoint: endpoint,
	};
}

async function getFtBalances(accountId) {
	return Promise.all(
		TOKENS.map(async (token) => {
			try {
				const raw = await viewFunction(token.contractId, "ft_balance_of", {
					account_id: accountId,
				});
				return {
					...token,
					raw: String(raw || "0"),
					amount: formatUnits(String(raw || "0"), token.decimals),
				};
			} catch (error) {
				return {
					...token,
					raw: "0",
					amount: "0",
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}),
	);
}

async function getBurrowTokenMetaMap() {
	try {
		const rows = await viewFunction(BURROW_CONTRACT, "get_assets_paged", {
			from_index: 0,
			limit: 200,
		});
		const map = new Map();
		for (const row of rows || []) {
			const [tokenId, asset] = row;
			map.set(tokenId, {
				extraDecimals: asset?.config?.extra_decimals ?? 0,
				symbol:
					TOKENS.find((item) => item.contractId === tokenId)?.symbol ||
					tokenId.slice(0, 10),
			});
		}
		return map;
	} catch {
		return new Map();
	}
}

function toTokenAmountFromBurrowInner(
	balanceInner,
	extraDecimals = 0,
	tokenDecimals = 24,
) {
	const decimals = Number(extraDecimals || 0) + Number(tokenDecimals || 0);
	return formatUnits(balanceInner || "0", Math.max(0, decimals));
}

function stableSymbol(tokenId) {
	const match = TOKENS.find((item) => item.contractId === tokenId);
	return match?.symbol || tokenId;
}

async function resolveTokenDecimals(tokenId) {
	if (TOKEN_DECIMALS_CACHE.has(tokenId)) {
		return TOKEN_DECIMALS_CACHE.get(tokenId);
	}
	const known = TOKENS.find((item) => item.contractId === tokenId)?.decimals;
	if (typeof known === "number") {
		TOKEN_DECIMALS_CACHE.set(tokenId, known);
		return known;
	}
	try {
		const meta = await viewFunction(tokenId, "ft_metadata", {});
		const decimals = Number(meta?.decimals);
		if (Number.isFinite(decimals) && decimals >= 0) {
			TOKEN_DECIMALS_CACHE.set(tokenId, decimals);
			return decimals;
		}
	} catch {
		// ignore
	}
	TOKEN_DECIMALS_CACHE.set(tokenId, 24);
	return 24;
}

async function getBurrowAccount(accountId) {
	try {
		const [registration, account, metaMap] = await Promise.all([
			viewFunction(BURROW_CONTRACT, "storage_balance_of", {
				account_id: accountId,
			}),
			viewFunction(BURROW_CONTRACT, "get_account", { account_id: accountId }),
			getBurrowTokenMetaMap(),
		]);

		if (!registration || !account) {
			return { registered: false, collateral: [], supplied: [], borrowed: [] };
		}

		const normalizeRows = async (rows = []) =>
			Promise.all(
				rows.map(async (row) => {
					const meta = metaMap.get(row.token_id) || {
						extraDecimals: 0,
						symbol: row.token_id,
					};
					const tokenDecimals = await resolveTokenDecimals(row.token_id);
					return {
						tokenId: row.token_id,
						symbol: meta.symbol,
						apr: row.apr,
						balanceRawInner: row.balance,
						amount: toTokenAmountFromBurrowInner(
							row.balance,
							meta.extraDecimals,
							tokenDecimals,
						),
					};
				}),
			);

		return {
			registered: true,
			collateral: await normalizeRows(account.collateral),
			supplied: await normalizeRows(account.supplied),
			borrowed: await normalizeRows(account.borrowed),
		};
	} catch (error) {
		return {
			registered: false,
			error: error instanceof Error ? error.message : String(error),
			collateral: [],
			supplied: [],
			borrowed: [],
		};
	}
}

async function getPriceMap() {
	try {
		const response = await fetch("https://1click.chaindefuser.com/v0/tokens");
		if (!response.ok) return {};
		const payload = await response.json();
		const map = {};
		for (const row of payload.tokens || []) {
			if (row.symbol && typeof row.priceUsd === "number") {
				map[row.symbol.toUpperCase()] = row.priceUsd;
			}
		}
		return map;
	} catch {
		return {};
	}
}

async function getStableAprStrategy(accountId) {
	try {
		const burrow = await getBurrowAccount(accountId);
		const currentStableCollateral = (burrow.collateral || []).filter((row) =>
			["USDT", "USDC", "USDC.E", "DAI", "USDT.E", "USDT"].includes(
				String(row.symbol).toUpperCase(),
			),
		);
		const ranked = [...currentStableCollateral].sort(
			(a, b) => Number(b.apr || 0) - Number(a.apr || 0),
		);
		return {
			currentStableCollateral: ranked,
			recommendation:
				ranked.length > 0
					? `Current best stable APR in your collateral: ${ranked[0].symbol} ${(Number(ranked[0].apr || 0) * 100).toFixed(2)}%`
					: "No stable collateral yet. Consider NEAR -> stable -> Burrow supply",
		};
	} catch (error) {
		return {
			currentStableCollateral: [],
			recommendation: `Strategy scan error: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function findNewestSessionFile() {
	const entries = await readdir(SESSION_DIR, { withFileTypes: true });
	const files = entries.filter(
		(entry) => entry.isFile() && entry.name.endsWith(".jsonl"),
	);
	if (files.length === 0) return null;
	const stats = await Promise.all(
		files.map(async (file) => {
			const filePath = path.join(SESSION_DIR, file.name);
			const info = await stat(filePath);
			return { filePath, mtimeMs: info.mtimeMs };
		}),
	);
	stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return stats[0]?.filePath || null;
}

function extractRecentFromSessionLog(rawText, accountId) {
	const lines = rawText.split("\n").filter(Boolean);
	const worker = [];
	const txs = [];
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		try {
			const line = JSON.parse(lines[i]);
			const msg = line?.message;
			if (!msg || msg.role !== "toolResult") continue;

			if (msg.toolName === "near_yieldWorkerStatus" && worker.length === 0) {
				const details = msg.details || {};
				if (details.accountId === accountId) {
					worker.push({
						status: details.status,
						dryRun: details.dryRun,
						cycleCount: details.cycleCount,
						lastCycleAt: details.lastCycleAt,
						recentLogs: details.recentLogs || [],
					});
				}
			}

			const details = msg.details || {};
			if (details.txHash && txs.length < 10) {
				txs.push({
					tool: msg.toolName,
					txHash: details.txHash,
					network: details.network,
					explorerUrl: details.explorerUrl || null,
					timestamp: line.timestamp,
				});
			}

			if (worker.length > 0 && txs.length >= 10) break;
		} catch {
			// ignore parse errors
		}
	}
	return { worker: worker[0] || null, recentTxs: txs };
}

async function getLocalRuntimeSignals(accountId) {
	try {
		const filePath = await findNewestSessionFile();
		if (!filePath) return { worker: null, recentTxs: [] };
		const content = await readFile(filePath, "utf8");
		return extractRecentFromSessionLog(content, accountId);
	} catch {
		return { worker: null, recentTxs: [] };
	}
}

async function buildSnapshot(accountId) {
	const [near, ft, burrow, prices, localSignals, strategy] = await Promise.all([
		getNearBalance(accountId),
		getFtBalances(accountId),
		getBurrowAccount(accountId),
		getPriceMap(),
		getLocalRuntimeSignals(accountId),
		getStableAprStrategy(accountId),
	]);

	const nearUsd = Number.parseFloat(near.available) * (prices.NEAR || 0);
	const retryRate =
		RPC_METRICS.totalAttempts > 0
			? RPC_METRICS.totalRetries / RPC_METRICS.totalAttempts
			: 0;
	if (
		retryRate >= NEAR_RPC_ALERT_RETRY_RATE ||
		RPC_METRICS.http429 >= NEAR_RPC_ALERT_429_COUNT
	) {
		await sendAlert({
			level: "warn",
			title: "RPC pressure warning",
			message: `retryRate=${(retryRate * 100).toFixed(1)}% attempts=${RPC_METRICS.totalAttempts} retries=${RPC_METRICS.totalRetries} 429=${RPC_METRICS.http429}`,
		});
	}
	void saveMetricsToDisk();
	const tokens = ft.map((row) => {
		const usd =
			Number.parseFloat(row.amount) * (prices[row.symbol.toUpperCase()] || 0);
		return { ...row, usd: Number.isFinite(usd) ? usd : 0 };
	});

	return {
		accountId,
		rpcUrl: near.rpcEndpoint,
		rpcCandidates: RPC_ENDPOINTS,
		updatedAt: new Date().toISOString(),
		near: { ...near, usd: Number.isFinite(nearUsd) ? nearUsd : 0 },
		tokens,
		burrow,
		strategy,
		worker: localSignals.worker,
		recentTxs: localSignals.recentTxs,
		actionHistory: ACTION_HISTORY,
		rpcMetrics: {
			...RPC_METRICS,
			retryRate:
				RPC_METRICS.totalAttempts > 0
					? RPC_METRICS.totalRetries / RPC_METRICS.totalAttempts
					: 0,
			ranking: Object.entries(RPC_METRICS.endpointStats)
				.map(([endpoint, stats]) => {
					const attempts = Number(stats?.attempts || 0);
					const success = Number(stats?.success || 0);
					const errors = Number(stats?.errors || 0);
					const score = attempts > 0 ? (success - errors) / attempts : 0;
					return { endpoint, ...stats, score };
				})
				.sort((a, b) => b.score - a.score),
		},
		rebalanceMetrics: {
			...REBALANCE_METRICS,
			recent: REBALANCE_METRICS.recent,
		},
		paymentWebhookMetrics: {
			...PAYMENT_WEBHOOK_METRICS,
		},
	};
}

async function buildUnifiedPortfolio(accountId) {
	const snapshot = await buildSnapshot(accountId);
	let acp = { ok: false, error: "acp not queried" };
	try {
		const [whoami, wallet] = await Promise.all([
			runAcpJson(["whoami"]),
			runAcpJson(["wallet", "balance"]),
		]);
		acp = { ok: true, whoami, wallet };
	} catch (error) {
		acp = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	const nearTokenUsd = (snapshot.tokens || []).reduce(
		(acc, row) => acc + Number(row.usd || 0),
		0,
	);
	const nearTotalUsd = Number(snapshot.near?.usd || 0) + nearTokenUsd;

	const bscAccount = String(BSC_EXECUTE_RECIPIENT || "").trim();
	let bscLayer = {
		chain: "bsc",
		status: "degraded",
		note: "missing BSC_EXECUTE_RECIPIENT; cannot query wallet balances",
	};
	if (bscAccount) {
		try {
			const [balances, marketCompare, yieldPlan, protocolPositions] =
				await Promise.all([
					getBscWalletStableBalances(bscAccount),
					getBscLendingMarketCompare(),
					computeBscYieldPlan({ account: bscAccount }),
					getBscProtocolPositions(bscAccount),
				]);
			const bscWalletUsd =
				Number(balances?.usdtUi || 0) + Number(balances?.usdcUi || 0);
			const bscTotalUsd =
				bscWalletUsd + Number(protocolPositions?.totalUsdApprox || 0);
			const normalizationHealth =
				evaluateNormalizationHealth(protocolPositions);
			if (ALERT_BSC_NORMALIZATION_ENABLED) {
				const minBandRank = getRiskBandRank(ALERT_BSC_NORMALIZATION_MIN_BAND);
				const currentBandRank = getRiskBandRank(normalizationHealth?.band);
				if (
					currentBandRank >= minBandRank &&
					normalizationHealth?.status !== "ok"
				) {
					const topRowsText = Array.isArray(normalizationHealth?.topRows)
						? normalizationHealth.topRows
								.map((row) => {
									const ageMin = Number.isFinite(Number(row?.ageMs))
										? Math.round(Number(row.ageMs) / 60000)
										: "-";
									return `${row?.protocol || "-"}:${row?.freshness || "unknown"}@${ageMin}m(${row?.source || "unknown"})`;
								})
								.join(", ")
						: "-";
					await sendAlert({
						level: "warn",
						title: "BSC normalization health warning",
						message: `account=${bscAccount} status=${normalizationHealth.status} band=${normalizationHealth.band} maxRisk=${normalizationHealth.maxRiskScore} stale=${normalizationHealth.staleCount} unknown=${normalizationHealth.unknownCount} top=${topRowsText} runbook=docs/near-dashboard.md#alerts`,
						meta: {
							normalizationHealth,
							thresholdBand: ALERT_BSC_NORMALIZATION_MIN_BAND,
							runbookHint: normalizationHealth?.runbookHint || null,
						},
					});
				}
			}
			bscLayer = {
				chain: "bsc",
				status: "active",
				account: bscAccount,
				portfolioUsd: bscTotalUsd,
				positions: {
					wallet: balances,
					protocols: protocolPositions,
					normalizationHealth,
					yield: {
						plan: yieldPlan?.plan || null,
						executionProtocol: yieldPlan?.executionProtocol || "venus",
						executeReadiness: yieldPlan?.executeReadiness || null,
					},
					markets: marketCompare,
				},
			};
		} catch (error) {
			bscLayer = {
				chain: "bsc",
				status: "error",
				account: bscAccount,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	return {
		updatedAt: new Date().toISOString(),
		policy: PORTFOLIO_POLICY,
		identityLayer: {
			chain: "base",
			provider: "virtual-acp",
			acp,
		},
		executionLayers: [
			{
				chain: "near",
				accountId,
				portfolioUsd: nearTotalUsd,
				positions: {
					wallet: snapshot.tokens,
					burrow: snapshot.burrow,
				},
			},
			bscLayer,
		],
		risk: {
			retryRate: snapshot.rpcMetrics?.retryRate || 0,
			http429: snapshot.rpcMetrics?.http429 || 0,
			rebalance: snapshot.rebalanceMetrics,
			bscNormalization: bscLayer?.positions?.normalizationHealth || {
				status: "unknown",
				band: "high",
				maxRiskScore: 100,
				staleCount: 0,
				unknownCount: 2,
				rows: [],
			},
		},
	};
}

function getRiskBandRank(band) {
	const b = String(band || "low").toLowerCase();
	if (b === "high") return 3;
	if (b === "medium") return 2;
	return 1;
}

function hasRequiredPlaceholders(template, required = []) {
	const source = String(template || "");
	return required.every((ph) => source.includes(ph));
}

function evaluateNormalizationHealth(protocolPositions) {
	const sources = protocolPositions?.normalizationSources || {};
	const now = Date.now();
	const staleMs = 6 * 60 * 60 * 1000;
	const unknownMs = 24 * 60 * 60 * 1000;
	const rows = ["lista", "wombat"].map((protocol) => {
		const row = sources?.[protocol] || {};
		const source = String(row?.source || "unknown");
		const updatedAt = String(row?.updatedAt || "").trim();
		const ts = Date.parse(updatedAt);
		const ageMs = Number.isFinite(ts) ? Math.max(0, now - ts) : null;
		const freshness =
			ageMs == null
				? "unknown"
				: ageMs > unknownMs
					? "unknown"
					: ageMs > staleMs
						? "stale"
						: "fresh";
		const riskScore =
			freshness === "fresh" ? 10 : freshness === "stale" ? 55 : 85;
		return {
			protocol,
			source,
			updatedAt: updatedAt || null,
			ageMs,
			freshness,
			riskScore,
		};
	});
	const maxRiskScore = rows.reduce(
		(acc, row) => Math.max(acc, Number(row?.riskScore || 0)),
		0,
	);
	const staleCount = rows.filter((row) => row.freshness === "stale").length;
	const unknownCount = rows.filter((row) => row.freshness === "unknown").length;
	const status = unknownCount > 0 ? "degraded" : staleCount > 0 ? "warn" : "ok";
	const band =
		maxRiskScore >= 80 ? "high" : maxRiskScore >= 40 ? "medium" : "low";
	const topRows = rows
		.slice()
		.sort((a, b) => Number(b?.riskScore || 0) - Number(a?.riskScore || 0))
		.slice(0, 2);
	return {
		status,
		band,
		maxRiskScore,
		staleCount,
		unknownCount,
		thresholds: {
			staleAfterMs: staleMs,
			unknownAfterMs: unknownMs,
		},
		runbookHint:
			"Check bsc.positions.*RateApiUrl and fallback exchange rates; verify updatedAt freshness and provider availability.",
		topRows,
		rows,
	};
}

function runCommand(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{
				timeout: options.timeoutMs || 120_000,
				env: { ...process.env, ...(options.env || {}) },
				cwd: options.cwd || process.cwd(),
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(stderr?.trim() || error.message));
					return;
				}
				resolve((stdout || "").trim());
			},
		);
	});
}

function isTransientExecError(error) {
	const text = String(error?.message || error || "").toLowerCase();
	return (
		text.includes("429") ||
		text.includes("too many requests") ||
		text.includes("fetch failed") ||
		text.includes("timeout") ||
		text.includes("503")
	);
}

async function runAcpJson(args = []) {
	const output = await runCommand(ACP_BIN, [...args, "--json"], {
		env: process.env,
		cwd: ACP_WORKDIR,
	});
	try {
		return JSON.parse(output);
	} catch {
		return { raw: output };
	}
}

async function executeBscSwapViaNativeRpc(params) {
	if (!BSC_EXECUTE_PRIVATE_KEY) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_execute_private_key_missing",
		);
	}
	const provider = new JsonRpcProvider(params.rpcUrl || BSC_RPC_URL, {
		name: "bsc",
		chainId: Number(params.chainId || BSC_CHAIN_ID),
	});
	const wallet = new Wallet(BSC_EXECUTE_PRIVATE_KEY, provider);
	const recipient = BSC_EXECUTE_RECIPIENT || wallet.address;
	const erc20Iface = new Interface([
		"function allowance(address owner,address spender) view returns (uint256)",
		"function approve(address spender,uint256 value) returns (bool)",
		"function balanceOf(address owner) view returns (uint256)",
	]);
	const routerIface = new Interface([
		"function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[] amounts)",
	]);
	const readTokenBalance = async (token, owner) => {
		const data = erc20Iface.encodeFunctionData("balanceOf", [owner]);
		const raw = await provider.call({ to: token, data });
		return erc20Iface.decodeFunctionResult("balanceOf", raw)[0];
	};
	const bumpGas = async () => {
		const fee = await provider.getFeeData();
		const bump = BigInt(100 + BSC_EXECUTE_GAS_BUMP_PERCENT);
		const out = {};
		if (fee?.gasPrice) {
			const gp = (BigInt(fee.gasPrice.toString()) * bump) / 100n;
			out.gasPrice = gp.toString();
		}
		if (fee?.maxFeePerGas && fee?.maxPriorityFeePerGas) {
			const mf = (BigInt(fee.maxFeePerGas.toString()) * bump) / 100n;
			const mp = (BigInt(fee.maxPriorityFeePerGas.toString()) * bump) / 100n;
			out.maxFeePerGas = mf.toString();
			out.maxPriorityFeePerGas = mp.toString();
		}
		return out;
	};
	try {
		const [tokenInBefore, tokenOutBefore] = await Promise.all([
			readTokenBalance(params.tokenIn, wallet.address),
			readTokenBalance(params.tokenOut, recipient),
		]);
		const allowanceCallData = erc20Iface.encodeFunctionData("allowance", [
			wallet.address,
			params.router,
		]);
		const allowanceRaw = await provider.call({
			to: params.tokenIn,
			data: allowanceCallData,
		});
		const allowance = erc20Iface.decodeFunctionResult(
			"allowance",
			allowanceRaw,
		)[0];
		if (allowance.lt(params.amountInRaw)) {
			const approveData = erc20Iface.encodeFunctionData("approve", [
				params.router,
				MaxUint256,
			]);
			const approveTx = await wallet.sendTransaction({
				to: params.tokenIn,
				data: approveData,
				value: 0,
				...(await bumpGas()),
			});
			await approveTx.wait(BSC_EXECUTE_CONFIRMATIONS);
		}
		const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
		const swapData = routerIface.encodeFunctionData(
			"swapExactTokensForTokens",
			[
				String(params.amountInRaw),
				String(params.minAmountOutRaw),
				[params.tokenIn, params.tokenOut],
				recipient,
				deadline,
			],
		);
		let tx;
		let lastErr = null;
		for (let attempt = 0; attempt <= BSC_EXECUTE_NONCE_RETRY; attempt += 1) {
			try {
				tx = await wallet.sendTransaction({
					to: params.router,
					data: swapData,
					value: 0,
					...(await bumpGas()),
					nonce: await provider.getTransactionCount(wallet.address, "pending"),
				});
				break;
			} catch (error) {
				lastErr = error;
				const msg = String(error?.message || error || "").toLowerCase();
				if (
					attempt >= BSC_EXECUTE_NONCE_RETRY ||
					(!msg.includes("nonce") && !msg.includes("underpriced"))
				) {
					throw error;
				}
			}
		}
		if (!tx) throw lastErr || new Error("bsc swap tx not created");
		const receipt = await tx.wait(BSC_EXECUTE_CONFIRMATIONS);
		const [tokenInAfter, tokenOutAfter] = await Promise.all([
			readTokenBalance(params.tokenIn, wallet.address),
			readTokenBalance(params.tokenOut, recipient),
		]);
		const tokenOutDelta = tokenOutAfter.sub(tokenOutBefore);
		const tokenInDelta = tokenInBefore.sub(tokenInAfter);
		const reconcileOk = tokenOutDelta.gte(String(params.minAmountOutRaw));
		return {
			ok: true,
			mode: "execute",
			txHash: tx.hash,
			receipt: {
				status: receipt?.status,
				blockNumber: receipt?.blockNumber,
				gasUsed: receipt?.gasUsed?.toString?.() || null,
				confirmations: BSC_EXECUTE_CONFIRMATIONS,
				reconcileOk,
				tokenInDeltaRaw: tokenInDelta.toString(),
				tokenOutDeltaRaw: tokenOutDelta.toString(),
				minAmountOutRaw: String(params.minAmountOutRaw),
			},
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		const retryable = isTransientExecError(error);
		throw new Error(
			`BSC_EXECUTE_FAILED retryable=${retryable ? "true" : "false"} message=${msg}`,
		);
	}
}

async function executeBscSwapViaCommand(params) {
	if (!BSC_EXECUTE_COMMAND) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_execute_command_missing",
		);
	}
	const replacements = {
		"{amountInRaw}": String(params.amountInRaw || ""),
		"{minAmountOutRaw}": String(params.minAmountOutRaw || ""),
		"{tokenIn}": String(params.tokenIn || ""),
		"{tokenOut}": String(params.tokenOut || ""),
		"{router}": String(params.router || ""),
		"{rpcUrl}": String(params.rpcUrl || ""),
		"{chainId}": String(params.chainId || ""),
		"{runId}": String(params.runId || ""),
	};
	let cmd = BSC_EXECUTE_COMMAND;
	for (const [k, v] of Object.entries(replacements)) {
		cmd = cmd.split(k).join(v);
	}
	try {
		const output = await runCommand("bash", ["-lc", cmd], {
			env: process.env,
			cwd: ACP_WORKDIR,
		});
		const txHash =
			extractTxHash(output) ||
			String(output.match(/0x[a-fA-F0-9]{64}/)?.[0] || "") ||
			null;
		return { ok: true, mode: "execute", output, txHash, provider: "command" };
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		const retryable = isTransientExecError(error);
		throw new Error(
			`BSC_EXECUTE_FAILED retryable=${retryable ? "true" : "false"} message=${msg}`,
		);
	}
}

async function executeBscSwap(params) {
	if (!BSC_EXECUTE_ENABLED) {
		return { ok: false, reason: "bsc_execute_disabled" };
	}
	const mode = BSC_EXECUTE_MODE;
	if (mode === "native") {
		const out = await executeBscSwapViaNativeRpc(params);
		return { ...out, provider: "native-rpc" };
	}
	if (mode === "command") {
		return executeBscSwapViaCommand(params);
	}
	if (BSC_EXECUTE_PRIVATE_KEY) {
		const out = await executeBscSwapViaNativeRpc(params);
		return { ...out, provider: "native-rpc" };
	}
	if (BSC_EXECUTE_COMMAND) {
		return executeBscSwapViaCommand(params);
	}
	throw new Error(
		"BSC_EXECUTE_CONFIG retryable=false message=missing_native_key_and_command",
	);
}

function validateBscAaveSupplyInput(params) {
	const token = String(params?.token || "")
		.trim()
		.toLowerCase();
	const amountRaw = String(params?.amountRaw || "0").trim();
	if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_aave_amount_invalid",
		);
	}
	const maxRaw = /^\d+$/.test(BSC_AAVE_MAX_AMOUNT_RAW)
		? BigInt(BSC_AAVE_MAX_AMOUNT_RAW)
		: 0n;
	if (maxRaw > 0n && BigInt(amountRaw) > maxRaw) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_aave_amount_exceeds_limit",
		);
	}
	if (!token || !BSC_AAVE_ALLOWED_TOKENS.includes(token)) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_aave_token_not_allowed",
		);
	}
	return { token, amountRaw };
}

async function executeBscAaveSupplyViaCommand(params) {
	if (!BSC_AAVE_EXECUTE_COMMAND) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_aave_execute_command_missing",
		);
	}
	const { token, amountRaw } = validateBscAaveSupplyInput(params);
	const requiredPlaceholders = ["{amountRaw}", "{runId}"];
	for (const placeholder of requiredPlaceholders) {
		if (!BSC_AAVE_EXECUTE_COMMAND.includes(placeholder)) {
			throw new Error(
				`BSC_EXECUTE_CONFIG retryable=false message=bsc_aave_execute_command_missing_placeholder_${placeholder}`,
			);
		}
	}
	const replacements = {
		"{amountRaw}": amountRaw,
		"{token}": token,
		"{rpcUrl}": String(params.rpcUrl || BSC_RPC_URL || ""),
		"{chainId}": String(params.chainId || BSC_CHAIN_ID || ""),
		"{runId}": String(params.runId || ""),
	};
	let cmd = BSC_AAVE_EXECUTE_COMMAND;
	for (const [k, v] of Object.entries(replacements)) {
		cmd = cmd.split(k).join(v);
	}
	try {
		const output = await runCommand("bash", ["-lc", cmd], {
			env: process.env,
			cwd: ACP_WORKDIR,
		});
		const txHash = String(output.match(/0x[a-fA-F0-9]{64}/)?.[0] || "") || null;
		return {
			ok: true,
			mode: "execute",
			provider: "aave-command",
			output,
			txHash,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		const retryable = isTransientExecError(error);
		throw new Error(
			`BSC_EXECUTE_FAILED retryable=${retryable ? "true" : "false"} message=${msg}`,
		);
	}
}

async function executeBscAaveSupplyViaNativeRpc(params) {
	const { token, amountRaw } = validateBscAaveSupplyInput(params);
	if (!BSC_AAVE_POOL) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_aave_pool_missing",
		);
	}
	if (!BSC_AAVE_EXECUTE_PRIVATE_KEY) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_aave_private_key_missing",
		);
	}
	const provider = new JsonRpcProvider(params.rpcUrl || BSC_RPC_URL, {
		name: "bsc",
		chainId: Number(params.chainId || BSC_CHAIN_ID),
	});
	const wallet = new Wallet(BSC_AAVE_EXECUTE_PRIVATE_KEY, provider);
	const erc20Iface = new Interface([
		"function allowance(address owner,address spender) view returns (uint256)",
		"function approve(address spender,uint256 value) returns (bool)",
	]);
	const poolIface = new Interface([
		"function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)",
	]);
	try {
		const allowanceRaw = await provider.call({
			to: token,
			data: erc20Iface.encodeFunctionData("allowance", [
				wallet.address,
				BSC_AAVE_POOL,
			]),
		});
		const allowance = erc20Iface.decodeFunctionResult(
			"allowance",
			allowanceRaw,
		)[0];
		if (allowance.lt(amountRaw)) {
			const approveTx = await wallet.sendTransaction({
				to: token,
				data: erc20Iface.encodeFunctionData("approve", [
					BSC_AAVE_POOL,
					MaxUint256,
				]),
				value: 0,
			});
			await approveTx.wait(BSC_EXECUTE_CONFIRMATIONS);
		}
		const data = poolIface.encodeFunctionData("supply", [
			token,
			String(amountRaw),
			wallet.address,
			BSC_AAVE_REFERRAL_CODE,
		]);
		const tx = await wallet.sendTransaction({
			to: BSC_AAVE_POOL,
			data,
			value: 0,
		});
		const receipt = await tx.wait(BSC_EXECUTE_CONFIRMATIONS);
		return {
			ok: true,
			mode: "execute",
			provider: "aave-native-rpc",
			txHash: tx.hash,
			receipt: {
				status: receipt?.status,
				blockNumber: receipt?.blockNumber,
				gasUsed: receipt?.gasUsed?.toString?.() || null,
			},
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		const retryable = isTransientExecError(error);
		throw new Error(
			`BSC_EXECUTE_FAILED retryable=${retryable ? "true" : "false"} message=${msg}`,
		);
	}
}

async function executeBscAaveSupply(params) {
	if (BSC_AAVE_EXECUTE_MODE === "native") {
		return executeBscAaveSupplyViaNativeRpc(params);
	}
	if (BSC_AAVE_EXECUTE_MODE === "command") {
		return executeBscAaveSupplyViaCommand(params);
	}
	if (BSC_AAVE_EXECUTE_PRIVATE_KEY && BSC_AAVE_POOL) {
		return executeBscAaveSupplyViaNativeRpc(params);
	}
	return executeBscAaveSupplyViaCommand(params);
}

async function executeBscListaSupplyViaCommand(params) {
	if (!BSC_LISTA_EXECUTE_COMMAND) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_lista_execute_command_missing",
		);
	}
	if (
		!hasRequiredPlaceholders(BSC_LISTA_EXECUTE_COMMAND, [
			"{amountRaw}",
			"{runId}",
		])
	) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_lista_execute_command_missing_required_placeholders",
		);
	}
	const token = String(params?.token || "")
		.trim()
		.toLowerCase();
	const amountRaw = String(params?.amountRaw || "0").trim();
	if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_lista_amount_invalid",
		);
	}
	const maxRaw = /^\d+$/.test(BSC_LISTA_MAX_AMOUNT_RAW)
		? BigInt(BSC_LISTA_MAX_AMOUNT_RAW)
		: 0n;
	if (maxRaw > 0n && BigInt(amountRaw) > maxRaw) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_lista_amount_exceeds_limit",
		);
	}
	if (!token || !BSC_LISTA_ALLOWED_TOKENS.includes(token)) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_lista_token_not_allowed",
		);
	}
	const replacements = {
		"{amountRaw}": amountRaw,
		"{token}": token,
		"{rpcUrl}": String(params.rpcUrl || BSC_RPC_URL || ""),
		"{chainId}": String(params.chainId || BSC_CHAIN_ID || ""),
		"{runId}": String(params.runId || ""),
	};
	let cmd = BSC_LISTA_EXECUTE_COMMAND;
	for (const [k, v] of Object.entries(replacements)) {
		cmd = cmd.split(k).join(v);
	}
	try {
		const output = await runCommand("bash", ["-lc", cmd], {
			env: process.env,
			cwd: ACP_WORKDIR,
			timeoutMs: BSC_LISTA_EXECUTE_TIMEOUT_MS,
		});
		const txHash = String(output.match(/0x[a-fA-F0-9]{64}/)?.[0] || "") || null;
		return {
			ok: true,
			mode: "execute",
			provider: "lista-command",
			output,
			txHash,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		const retryable = isTransientExecError(error);
		throw new Error(
			`BSC_EXECUTE_FAILED retryable=${retryable ? "true" : "false"} message=${msg}`,
		);
	}
}

async function executeBscWombatSupplyViaCommand(params) {
	if (!BSC_WOMBAT_EXECUTE_COMMAND) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_wombat_execute_command_missing",
		);
	}
	if (
		!hasRequiredPlaceholders(BSC_WOMBAT_EXECUTE_COMMAND, [
			"{amountRaw}",
			"{runId}",
		])
	) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_wombat_execute_command_missing_required_placeholders",
		);
	}
	const token = String(params?.token || "")
		.trim()
		.toLowerCase();
	const amountRaw = String(params?.amountRaw || "0").trim();
	if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_wombat_amount_invalid",
		);
	}
	const maxRaw = /^\d+$/.test(BSC_WOMBAT_MAX_AMOUNT_RAW)
		? BigInt(BSC_WOMBAT_MAX_AMOUNT_RAW)
		: 0n;
	if (maxRaw > 0n && BigInt(amountRaw) > maxRaw) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_wombat_amount_exceeds_limit",
		);
	}
	if (!token || !BSC_WOMBAT_ALLOWED_TOKENS.includes(token)) {
		throw new Error(
			"BSC_EXECUTE_CONFIG retryable=false message=bsc_wombat_token_not_allowed",
		);
	}
	const replacements = {
		"{amountRaw}": amountRaw,
		"{token}": token,
		"{rpcUrl}": String(params.rpcUrl || BSC_RPC_URL || ""),
		"{chainId}": String(params.chainId || BSC_CHAIN_ID || ""),
		"{runId}": String(params.runId || ""),
	};
	let cmd = BSC_WOMBAT_EXECUTE_COMMAND;
	for (const [k, v] of Object.entries(replacements)) {
		cmd = cmd.split(k).join(v);
	}
	try {
		const output = await runCommand("bash", ["-lc", cmd], {
			env: process.env,
			cwd: ACP_WORKDIR,
			timeoutMs: BSC_WOMBAT_EXECUTE_TIMEOUT_MS,
		});
		const txHash = String(output.match(/0x[a-fA-F0-9]{64}/)?.[0] || "") || null;
		return {
			ok: true,
			mode: "execute",
			provider: "wombat-command",
			output,
			txHash,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		const retryable = isTransientExecError(error);
		throw new Error(
			`BSC_EXECUTE_FAILED retryable=${retryable ? "true" : "false"} message=${msg}`,
		);
	}
}

async function executeBscListaSupplyViaNativeSlot(_params) {
	throw new Error(
		"BSC_EXECUTE_CONFIG retryable=false message=bsc_lista_native_slot_not_implemented",
	);
}

async function executeBscWombatSupplyViaNativeSlot(_params) {
	throw new Error(
		"BSC_EXECUTE_CONFIG retryable=false message=bsc_wombat_native_slot_not_implemented",
	);
}

function isNativeSlotNotImplementedError(error) {
	const msg = String(
		error instanceof Error ? error.message : error || "",
	).toLowerCase();
	return msg.includes("native_slot_not_implemented");
}

async function executeBscListaSupply(params) {
	if (BSC_LISTA_EXECUTE_MODE === "native") {
		if (!BSC_LISTA_NATIVE_EXECUTE_ENABLED) {
			throw new Error(
				"BSC_EXECUTE_CONFIG retryable=false message=bsc_lista_native_execute_not_enabled",
			);
		}
		return executeBscListaSupplyViaNativeSlot(params);
	}
	if (BSC_LISTA_EXECUTE_MODE === "command") {
		return executeBscListaSupplyViaCommand(params);
	}
	if (BSC_LISTA_NATIVE_EXECUTE_ENABLED) {
		try {
			return await executeBscListaSupplyViaNativeSlot(params);
		} catch (error) {
			if (!isNativeSlotNotImplementedError(error)) throw error;
		}
	}
	return executeBscListaSupplyViaCommand(params);
}

async function executeBscWombatSupply(params) {
	if (BSC_WOMBAT_EXECUTE_MODE === "native") {
		if (!BSC_WOMBAT_NATIVE_EXECUTE_ENABLED) {
			throw new Error(
				"BSC_EXECUTE_CONFIG retryable=false message=bsc_wombat_native_execute_not_enabled",
			);
		}
		return executeBscWombatSupplyViaNativeSlot(params);
	}
	if (BSC_WOMBAT_EXECUTE_MODE === "command") {
		return executeBscWombatSupplyViaCommand(params);
	}
	if (BSC_WOMBAT_NATIVE_EXECUTE_ENABLED) {
		try {
			return await executeBscWombatSupplyViaNativeSlot(params);
		} catch (error) {
			if (!isNativeSlotNotImplementedError(error)) throw error;
		}
	}
	return executeBscWombatSupplyViaCommand(params);
}

const BSC_POST_ACTION_SUPPLY_EXECUTORS = {
	aave: executeBscAaveSupply,
	lista: executeBscListaSupply,
	wombat: executeBscWombatSupply,
};

async function executeBscPostActionSupply(protocol, params) {
	const p = String(protocol || "")
		.trim()
		.toLowerCase();
	const executor = BSC_POST_ACTION_SUPPLY_EXECUTORS[p];
	if (!executor) {
		return {
			ok: false,
			reason: "unsupported_post_action_protocol",
			provider: null,
		};
	}
	const result = await executor(params);
	return {
		...result,
		adapterProtocol: p,
	};
}

function buildBscPostActionArtifact({
	protocol,
	supplyAmountRaw,
	postAction,
	runId,
}) {
	const p = String(protocol || "unknown").toLowerCase();
	const amountRaw = /^\d+$/.test(String(supplyAmountRaw || ""))
		? String(supplyAmountRaw)
		: null;
	const status = postAction?.ok ? "success" : "error";
	return {
		type: "bsc_post_action_supply",
		version: "v1",
		protocol: p,
		runId: String(runId || ""),
		status,
		amountRaw,
		token: String(BSC_USDC).toLowerCase(),
		provider: postAction?.provider || null,
		txHash: postAction?.txHash || null,
		reason: postAction?.reason || null,
		retryable: Boolean(postAction && postAction.ok !== true),
		occurredAt: new Date().toISOString(),
	};
}

function buildAcpExecutionPlan(payload) {
	const requirements = payload?.requirements || {};
	const targetChain = String(
		requirements.targetChain || payload.targetChain || "near",
	)
		.trim()
		.toLowerCase();
	const intentType = String(
		requirements.intentType || payload.intentType || "swap",
	)
		.trim()
		.toLowerCase();
	const riskProfile = String(
		requirements.riskProfile || payload.riskProfile || "balanced",
	)
		.trim()
		.toLowerCase();
	if (!["near", "bsc"].includes(targetChain)) {
		throw new Error(
			`Unsupported targetChain='${targetChain}'. Supported: near|bsc`,
		);
	}
	return {
		targetChain,
		intentType,
		riskProfile,
		router:
			targetChain === "near"
				? {
						mode: "near-components",
						steps: [
							"quote/intents-or-ref",
							"risk guards",
							"execute + reconcile",
						],
					}
				: {
						mode: "evm-bsc-components",
						steps: [
							"quote",
							"minOut/slippage guards",
							"execute via bsc adapter",
						],
					},
	};
}

function findStrategyEntitlement({ strategyId, buyer }) {
	const now = Date.now();
	return STRATEGY_ENTITLEMENTS.find((row) => {
		if (String(row?.strategyId || "") !== String(strategyId || ""))
			return false;
		if (String(row?.buyer || "") !== String(buyer || "")) return false;
		const expiresAtMs = Date.parse(String(row?.expiresAt || ""));
		if (Number.isFinite(expiresAtMs) && expiresAtMs < now) return false;
		const remainingUses = Number(row?.remainingUses ?? 0);
		if (remainingUses <= 0) return false;
		return true;
	});
}

function grantStrategyEntitlement({
	strategyId,
	buyer,
	uses,
	expiresAt,
	sourceReceiptId,
	sourcePaymentId,
}) {
	const keyStrategy = String(strategyId || "");
	const keyBuyer = String(buyer || "");
	const idx = STRATEGY_ENTITLEMENTS.findIndex(
		(row) =>
			String(row?.strategyId || "") === keyStrategy &&
			String(row?.buyer || "") === keyBuyer,
	);
	const nextUses = Number(uses || 0);
	if (idx >= 0) {
		const prev = STRATEGY_ENTITLEMENTS[idx];
		STRATEGY_ENTITLEMENTS[idx] = {
			...prev,
			remainingUses: Number(prev?.remainingUses || 0) + nextUses,
			expiresAt,
			sourceReceiptId,
			sourcePaymentId,
			updatedAt: new Date().toISOString(),
		};
		return STRATEGY_ENTITLEMENTS[idx];
	}
	const created = {
		id: `ent-${Date.now()}`,
		strategyId: keyStrategy,
		buyer: keyBuyer,
		remainingUses: nextUses,
		expiresAt,
		sourceReceiptId,
		sourcePaymentId,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
	STRATEGY_ENTITLEMENTS.unshift(created);
	if (STRATEGY_ENTITLEMENTS.length > 1000) STRATEGY_ENTITLEMENTS.length = 1000;
	return created;
}

function consumeStrategyEntitlement(entitlement) {
	if (!entitlement) return null;
	const idx = STRATEGY_ENTITLEMENTS.findIndex(
		(row) => row.id === entitlement.id,
	);
	if (idx < 0) return null;
	const current = STRATEGY_ENTITLEMENTS[idx];
	const remaining = Math.max(0, Number(current.remainingUses || 0) - 1);
	STRATEGY_ENTITLEMENTS[idx] = {
		...current,
		remainingUses: remaining,
		updatedAt: new Date().toISOString(),
	};
	return STRATEGY_ENTITLEMENTS[idx];
}

function findPaymentById(paymentId) {
	return STRATEGY_PAYMENTS.find(
		(row) => String(row?.paymentId || "") === String(paymentId || ""),
	);
}

function verifyPaymentWebhookSignature(rawBody, signatureHeader) {
	if (!PAYMENT_WEBHOOK_SECRET) return true;
	const sig = String(signatureHeader || "").trim();
	if (!sig) return false;
	const digest = createHmac("sha256", PAYMENT_WEBHOOK_SECRET)
		.update(String(rawBody || ""), "utf8")
		.digest("hex");
	const expected = `sha256=${digest}`;
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

function isWebhookEventProcessed(eventId) {
	const id = String(eventId || "").trim();
	if (!id) return false;
	return PAYMENT_WEBHOOK_EVENTS.some(
		(row) => String(row?.eventId || "") === id,
	);
}

function markWebhookEventProcessed({ eventId, paymentId, status, source }) {
	const id = String(eventId || "").trim();
	if (!id) return;
	PAYMENT_WEBHOOK_EVENTS.unshift({
		eventId: id,
		paymentId: String(paymentId || ""),
		status: String(status || "unknown"),
		source: String(source || "webhook"),
		processedAt: new Date().toISOString(),
	});
	if (PAYMENT_WEBHOOK_EVENTS.length > 2000)
		PAYMENT_WEBHOOK_EVENTS.length = 2000;
}

function normalizeWebhookPayload(payload, providerHint = "generic") {
	const provider = String(
		providerHint ||
			payload?.provider ||
			payload?.source ||
			PAYMENT_WEBHOOK_PROVIDER ||
			"generic",
	)
		.trim()
		.toLowerCase();

	if (provider === "ping") {
		const eventId =
			payload?.id || payload?.eventId || payload?.event_id || null;
		const paymentId =
			payload?.data?.paymentId ||
			payload?.data?.payment_id ||
			payload?.paymentId ||
			null;
		const status = payload?.data?.status || payload?.status || null;
		const txRef =
			payload?.data?.txHash || payload?.data?.txRef || payload?.txRef || null;
		return { provider, eventId, paymentId, status, txRef, raw: payload };
	}

	if (provider === "x402") {
		const eventId =
			payload?.event_id || payload?.eventId || payload?.id || null;
		const paymentId =
			payload?.payment_id ||
			payload?.paymentId ||
			payload?.data?.payment_id ||
			null;
		const status = payload?.payment_status || payload?.status || null;
		const txRef =
			payload?.tx_hash || payload?.txRef || payload?.transactionHash || null;
		return { provider, eventId, paymentId, status, txRef, raw: payload };
	}

	const eventId = payload?.eventId || payload?.id || payload?.event_id || null;
	const paymentId =
		payload?.paymentId ||
		payload?.payment_id ||
		payload?.data?.paymentId ||
		payload?.data?.payment_id ||
		null;
	const status =
		payload?.status || payload?.paymentStatus || payload?.state || null;
	const txRef =
		payload?.txRef || payload?.txHash || payload?.transactionHash || null;
	return { provider, eventId, paymentId, status, txRef, raw: payload };
}

function applyPaymentStatusUpdate(payload, source = "manual") {
	const paymentId = String(payload?.paymentId || "").trim();
	const payment = findPaymentById(paymentId);
	if (!payment) {
		return {
			ok: false,
			status: 404,
			error: `payment '${paymentId}' not found`,
		};
	}
	const isPaid =
		String(payload?.status || "").toLowerCase() === "paid" ||
		payload?.paid !== false;
	if (payment.status === "paid" && isPaid) {
		return {
			ok: true,
			payment,
			entitlementGranted: false,
			reason: "already_paid",
		};
	}
	payment.status = isPaid ? "paid" : "failed";
	payment.txRef = payload?.txRef || payment.txRef || null;
	payment.webhookEventId = payload?.eventId || payment.webhookEventId || null;
	payment.webhookSource = source;
	payment.updatedAt = new Date().toISOString();
	let entitlement = null;
	if (payment.status === "paid") {
		const entitlementUses = Math.max(
			1,
			Number.parseInt(String(payload?.entitlementUses || 30), 10) || 30,
		);
		const entitlementDays = Math.max(
			1,
			Number.parseInt(String(payload?.entitlementDays || 30), 10) || 30,
		);
		const expiresAt = new Date(
			Date.now() + entitlementDays * 24 * 60 * 60 * 1000,
		).toISOString();
		entitlement = grantStrategyEntitlement({
			strategyId: payment.strategyId,
			buyer: payment.buyer,
			uses: entitlementUses,
			expiresAt,
			sourceReceiptId: payment.paymentId,
			sourcePaymentId: payment.paymentId,
		});
	}
	return {
		ok: true,
		payment,
		entitlementGranted: Boolean(entitlement),
		entitlement,
	};
}

async function executeAcpJob(payload) {
	const plan = buildAcpExecutionPlan(payload);
	const requirements = payload?.requirements || {};
	const amountRaw = String(
		requirements.amountRaw || payload.amountRaw || "1000000",
	).trim();
	const intentType = plan.intentType;
	const dryRun = payload?.dryRun !== false;
	const runId = String(payload?.runId || `acp-${Date.now()}`).trim();
	const amountUsd = Number(amountRaw) / 1_000_000;
	const minRebalanceUsd = Number(
		PORTFOLIO_POLICY?.constraints?.minRebalanceUsd || 50,
	);
	if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
		pushAcpJobHistory({
			runId,
			status: "error",
			reason: "invalid_amount",
			amountRaw,
		});
		throw new Error("Invalid amountRaw for ACP job");
	}
	if (amountUsd < minRebalanceUsd) {
		pushAcpJobHistory({
			runId,
			status: "blocked",
			reason: "below_min_rebalance_usd",
			amountUsd,
			minRebalanceUsd,
		});
		throw new Error(
			`amountUsd ${amountUsd.toFixed(6)} below policy minRebalanceUsd ${minRebalanceUsd}`,
		);
	}
	const strategyId = String(payload?.strategyId || "").trim();
	const buyer = String(payload?.buyer || "").trim();
	const paymentId = String(payload?.paymentId || "").trim();
	let entitlement = null;
	if (!dryRun && strategyId && paymentId) {
		const prior = findAcpPriorTerminalRun({ runId, paymentId });
		if (prior) {
			pushAcpJobHistory({
				runId,
				status: "blocked",
				reason: "duplicate_run",
				strategyId,
				buyer,
				paymentId,
				priorStatus: prior.status,
			});
			throw new Error(
				`duplicate run blocked: runId='${runId}' paymentId='${paymentId}' priorStatus='${prior.status}'`,
			);
		}
	}
	if (!dryRun && strategyId) {
		if (!buyer) {
			throw new Error(
				"buyer is required when strategyId is provided for execute mode",
			);
		}
		if (!paymentId) {
			pushAcpJobHistory({
				runId,
				status: "blocked",
				reason: "missing_payment_id",
				strategyId,
				buyer,
			});
			throw new Error(
				"paymentId is required when strategyId is provided for execute mode",
			);
		}
		const payment = findPaymentById(paymentId);
		if (!payment) {
			pushAcpJobHistory({
				runId,
				status: "blocked",
				reason: "payment_not_found",
				strategyId,
				buyer,
				paymentId,
			});
			throw new Error(`paymentId '${paymentId}' not found`);
		}
		if (String(payment.status || "") !== "paid") {
			pushAcpJobHistory({
				runId,
				status: "blocked",
				reason: "payment_not_paid",
				strategyId,
				buyer,
				paymentId,
				paymentStatus: payment.status,
			});
			throw new Error(
				`paymentId '${paymentId}' is not paid (status=${payment.status || "unknown"})`,
			);
		}
		if (
			String(payment.strategyId || "") !== strategyId ||
			String(payment.buyer || "") !== buyer
		) {
			pushAcpJobHistory({
				runId,
				status: "blocked",
				reason: "payment_mismatch",
				strategyId,
				buyer,
				paymentId,
				paymentStrategyId: payment.strategyId,
				paymentBuyer: payment.buyer,
			});
			throw new Error(
				`paymentId '${paymentId}' does not match strategyId/buyer`,
			);
		}
		entitlement = findStrategyEntitlement({ strategyId, buyer });
		if (!entitlement) {
			pushAcpJobHistory({
				runId,
				status: "blocked",
				reason: "missing_entitlement",
				strategyId,
				buyer,
				paymentId,
			});
			throw new Error(
				`No active entitlement for strategyId='${strategyId}' buyer='${buyer}'`,
			);
		}
	}

	const receiptBase = {
		runId,
		identityChain: "base",
		targetChain: plan.targetChain,
		intentType,
		strategyId: strategyId || undefined,
		buyer: buyer || undefined,
		paymentId: paymentId || undefined,
		amountRaw,
		amountUsd,
		status: "planned",
	};

	if (dryRun) {
		pushAcpJobHistory({
			runId,
			status: "dry-run",
			targetChain: plan.targetChain,
			intentType,
			amountRaw,
		});
		return {
			ok: true,
			mode: "dry-run",
			runId,
			identityChain: "base",
			plan,
			receipt: {
				...receiptBase,
				status: "dry-run",
			},
		};
	}

	if (intentType !== "rebalance") {
		pushAcpJobHistory({
			runId,
			status: "error",
			reason: "unsupported_intent",
			intentType,
			targetChain: plan.targetChain,
		});
		throw new Error(
			`Unsupported intentType='${intentType}' for execute mode. Supported now: rebalance`,
		);
	}

	ensureAcpDailyRunLimit();
	const result = await executeAction({
		action: "rebalance_usdt_to_usdce_txn",
		chain: plan.targetChain,
		amountRaw,
		slippageBps: Number.parseInt(String(requirements.slippageBps || 50), 10),
		poolId: requirements.poolId || 3725,
		runId,
		step: payload?.step || `acp-${plan.targetChain}-rebalance`,
	});

	const txHash = result?.details?.step3Tx || result?.details?.step2Tx || null;
	const receiptStatus = result?.mode === "plan-only" ? "planned" : "executed";
	let entitlementAfter = null;
	if (receiptStatus === "executed") {
		registerAcpExecutedRun();
		if (entitlement) {
			entitlementAfter = consumeStrategyEntitlement(entitlement);
			await saveMarketplaceToDisk();
		}
	}
	pushAcpJobHistory({
		runId,
		status: receiptStatus,
		targetChain: plan.targetChain,
		intentType,
		strategyId: strategyId || undefined,
		buyer: buyer || undefined,
		paymentId: paymentId || undefined,
		amountRaw,
		txHash,
		adapterMode: result?.mode || "execute",
		remainingUses: entitlementAfter?.remainingUses,
		entitlementSourcePaymentId: entitlementAfter?.sourcePaymentId,
	});
	return {
		ok: true,
		mode: "execute",
		runId,
		identityChain: "base",
		plan,
		result,
		receipt: {
			...receiptBase,
			status: receiptStatus,
			txHash,
			adapterMode: result?.mode || "execute",
			remainingUses: entitlementAfter?.remainingUses,
			entitlementSourcePaymentId: entitlementAfter?.sourcePaymentId,
		},
	};
}

function getAcpAsyncJobById(jobId) {
	return ACP_ASYNC_JOBS.find(
		(row) => String(row?.jobId || "") === String(jobId || ""),
	);
}

function retryAcpAsyncJob(jobId) {
	const row = getAcpAsyncJobById(jobId);
	if (!row) return null;
	row.status = "queued";
	row.error = null;
	row.nextAttemptAt = null;
	row.updatedAt = new Date().toISOString();
	void saveMetricsToDisk();
	void processAcpAsyncQueue();
	return row;
}

function dismissAcpAsyncJob(jobId) {
	const row = getAcpAsyncJobById(jobId);
	if (!row) return null;
	row.status = "dismissed";
	row.dismissedAt = new Date().toISOString();
	row.nextAttemptAt = null;
	row.updatedAt = new Date().toISOString();
	void saveMetricsToDisk();
	return row;
}

function purgeDismissedAcpJobs(olderThanDays = 7) {
	const days = Math.max(0, Number(olderThanDays || 0));
	const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
	const before = ACP_ASYNC_JOBS.length;
	for (let i = ACP_ASYNC_JOBS.length - 1; i >= 0; i -= 1) {
		const row = ACP_ASYNC_JOBS[i];
		if (String(row?.status || "") !== "dismissed") continue;
		const ts = Date.parse(
			String(row?.dismissedAt || row?.updatedAt || row?.createdAt || ""),
		);
		if (!Number.isFinite(ts)) continue;
		if (ts <= cutoffMs) ACP_ASYNC_JOBS.splice(i, 1);
	}
	const removed = before - ACP_ASYNC_JOBS.length;
	if (removed > 0) void saveMetricsToDisk();
	return { removed, retained: ACP_ASYNC_JOBS.length };
}

function setupDismissedPurgeScheduler() {
	if (!ACP_DISMISSED_PURGE_ENABLED) return;
	const runOnce = () => {
		const out = purgeDismissedAcpJobs(ACP_DISMISSED_PURGE_DAYS);
		if (out.removed > 0) {
			console.log(
				`[acp-purge] removed=${out.removed} olderThanDays=${ACP_DISMISSED_PURGE_DAYS}`,
			);
		}
	};
	runOnce();
	setInterval(runOnce, ACP_DISMISSED_PURGE_INTERVAL_MS);
}

function enqueueAcpAsyncJob(payload) {
	const jobId = String(payload?.jobId || `acp-job-${Date.now()}`).trim();
	const maxAttempts = Math.max(
		1,
		Number.parseInt(String(payload?.maxAttempts || 3), 10) || 3,
	);
	const record = {
		jobId,
		status: "queued",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		payload,
		dismissedAt: null,
		result: null,
		error: null,
		attemptCount: 0,
		maxAttempts,
		nextAttemptAt: null,
		lastErrorAt: null,
	};
	ACP_ASYNC_JOBS.unshift(record);
	if (ACP_ASYNC_JOBS.length > 200) ACP_ASYNC_JOBS.length = 200;
	void saveMetricsToDisk();
	void processAcpAsyncQueue();
	return record;
}

function computeAcpRetryBackoffMs(attemptCount) {
	const n = Math.max(1, Number(attemptCount || 1));
	const capped = Math.min(n, 6);
	return 1000 * 2 ** (capped - 1);
}

function classifyAcpErrorType(error) {
	const text = String(error?.message || error || "").toLowerCase();
	if (text.includes("missing_payment_id")) return "missing_payment_id";
	if (text.includes("payment_not_found")) return "payment_not_found";
	if (text.includes("payment_not_paid")) return "payment_not_paid";
	if (text.includes("payment_mismatch")) return "payment_mismatch";
	if (text.includes("missing_entitlement")) return "missing_entitlement";
	if (text.includes("duplicate run blocked")) return "duplicate_run";
	if (text.includes("unsupported intenttype")) return "unsupported_intent";
	if (text.includes("unsupported targetchain"))
		return "unsupported_target_chain";
	if (text.includes("invalid amountraw")) return "invalid_amount";
	if (text.includes("slippagebps must be between")) return "invalid_slippage";
	if (text.includes("poolid must be a non-negative integer"))
		return "invalid_pool_id";
	if (text.includes("bsc_execute_config")) return "bsc_execute_config";
	if (text.includes("bsc_aave_post_action_failed"))
		return "bsc_aave_post_action_failed";
	if (text.includes("bsc_lista_post_action_failed"))
		return "bsc_lista_post_action_failed";
	if (text.includes("bsc_wombat_post_action_failed"))
		return "bsc_wombat_post_action_failed";
	if (text.includes("bsc_execute_failed")) return "bsc_execute_failed";
	if (text.includes("429") || text.includes("too many requests"))
		return "rpc_429";
	if (text.includes("timeout")) return "timeout";
	if (text.includes("503")) return "rpc_503";
	return "unknown";
}

function isAcpRetryableError(error) {
	if (isTransientExecError(error)) return true;
	const text = String(error?.message || error || "").toLowerCase();
	if (text.includes("retryable=true")) return true;
	const type = classifyAcpErrorType(error);
	return [
		"rpc_429",
		"timeout",
		"rpc_503",
		"bsc_execute_failed",
		"bsc_aave_post_action_failed",
		"bsc_lista_post_action_failed",
		"bsc_wombat_post_action_failed",
	].includes(type);
}

async function processAcpAsyncQueue() {
	if (ACP_ASYNC_WORKER_ACTIVE) return;
	ACP_ASYNC_WORKER_ACTIVE = true;
	try {
		while (true) {
			const now = Date.now();
			const next = ACP_ASYNC_JOBS.find((row) => {
				if (row.status !== "queued") return false;
				if (!row.nextAttemptAt) return true;
				const nextTs = Date.parse(String(row.nextAttemptAt));
				return !Number.isFinite(nextTs) || nextTs <= now;
			});
			if (!next) break;
			next.status = "running";
			next.updatedAt = new Date().toISOString();
			void saveMetricsToDisk();
			try {
				next.attemptCount = Math.max(0, Number(next.attemptCount || 0)) + 1;
				const result = await executeAcpJob(next.payload || {});
				next.status = "done";
				next.result = result;
				next.error = null;
				next.nextAttemptAt = null;
			} catch (error) {
				next.lastErrorAt = new Date().toISOString();
				next.error = error instanceof Error ? error.message : String(error);
				const attempt = Math.max(0, Number(next.attemptCount || 0));
				const maxAttempts = Math.max(1, Number(next.maxAttempts || 3));
				const retryable = isAcpRetryableError(error);
				if (!retryable || attempt >= maxAttempts) {
					next.status = "dead-letter";
					next.nextAttemptAt = null;
				} else {
					next.status = "queued";
					const backoffMs = computeAcpRetryBackoffMs(attempt);
					next.nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();
				}
			}
			next.updatedAt = new Date().toISOString();
			void saveMetricsToDisk();
		}
	} finally {
		ACP_ASYNC_WORKER_ACTIVE = false;
	}
}

async function runNearCommandWithRpcFallback(args) {
	let lastError = null;
	for (const endpoint of RPC_ENDPOINTS) {
		try {
			return {
				output: await runCommand("near", args, {
					env: { NEAR_RPC_URL: endpoint },
				}),
				rpcEndpoint: endpoint,
			};
		} catch (error) {
			lastError = error;
			if (!isTransientExecError(error)) {
				throw error;
			}
		}
	}
	throw lastError || new Error("All RPC endpoints failed");
}

function pushActionHistory(entry) {
	ACTION_HISTORY.unshift({
		id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		timestamp: new Date().toISOString(),
		...entry,
	});
	if (ACTION_HISTORY.length > 30) {
		ACTION_HISTORY.length = 30;
	}
}

function pushAcpJobHistory(entry) {
	ACP_JOB_HISTORY.unshift({
		id: `acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		timestamp: new Date().toISOString(),
		...entry,
	});
	if (ACP_JOB_HISTORY.length > 50) {
		ACP_JOB_HISTORY.length = 50;
	}
	void saveMetricsToDisk();
}

function findAcpPriorTerminalRun({ runId, paymentId }) {
	const rid = String(runId || "").trim();
	const pid = String(paymentId || "").trim();
	if (!rid || !pid) return null;
	return ACP_JOB_HISTORY.find((row) => {
		const rowRunId = String(row?.runId || "").trim();
		const rowPaymentId = String(row?.paymentId || "").trim();
		const status = String(row?.status || "").trim();
		const terminal =
			status === "executed" ||
			status === "simulated" ||
			status === "failed" ||
			status === "error" ||
			status === "blocked";
		return terminal && rowRunId === rid && rowPaymentId === pid;
	});
}

function registerAcpExecutedRun() {
	const day = currentDayKey();
	if (ACP_JOB_STATE.dailyWindowDay !== day) {
		ACP_JOB_STATE.dailyWindowDay = day;
		ACP_JOB_STATE.dailyCount = 0;
	}
	ACP_JOB_STATE.dailyCount += 1;
}

function ensureAcpDailyRunLimit() {
	const dailyMax = Number(
		PORTFOLIO_POLICY?.constraints?.maxDailyRebalanceRuns || 10,
	);
	const day = currentDayKey();
	if (ACP_JOB_STATE.dailyWindowDay !== day) {
		ACP_JOB_STATE.dailyWindowDay = day;
		ACP_JOB_STATE.dailyCount = 0;
	}
	if (ACP_JOB_STATE.dailyCount >= dailyMax) {
		throw new Error(
			`ACP daily run limit reached (${ACP_JOB_STATE.dailyCount}/${dailyMax})`,
		);
	}
}

function extractTxHash(outputText) {
	const text = String(outputText || "");
	const m = text.match(/Transaction ID:\s*([A-Za-z0-9_-]{20,})/i);
	return m?.[1] || null;
}

function nearExplorerUrl(txHash) {
	if (!txHash) return null;
	return `https://explorer.near.org/transactions/${txHash}`;
}

async function sendAlert(params) {
	const level = String(params.level || "info").toLowerCase();
	if (level === "info" && !ALERT_SUCCESS_ENABLED) {
		return;
	}
	const dedupeKey = `${level}|${params.title || "event"}|${params.message || ""}`;
	const now = Date.now();
	const lastSentAt = ALERT_DEDUPE_CACHE.get(dedupeKey) || 0;
	if (now - lastSentAt < ALERT_DEDUPE_WINDOW_MS) {
		return;
	}
	ALERT_DEDUPE_CACHE.set(dedupeKey, now);
	if (ALERT_DEDUPE_CACHE.size > 200) {
		const entries = [...ALERT_DEDUPE_CACHE.entries()];
		for (const [key] of entries.slice(0, entries.length - 200)) {
			ALERT_DEDUPE_CACHE.delete(key);
		}
	}

	const payload = {
		timestamp: new Date().toISOString(),
		...params,
	};
	const tasks = [];
	if (ALERT_WEBHOOK_URL) {
		tasks.push(
			fetch(ALERT_WEBHOOK_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			}).catch(() => null),
		);
	}
	if (ALERT_TELEGRAM_BOT_TOKEN && ALERT_TELEGRAM_CHAT_ID) {
		const text = [
			`[NEAR Rebalance][${level}] ${params.title || "event"}`,
			params.message || "",
		].join("\n");
		tasks.push(
			fetch(
				`https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chat_id: ALERT_TELEGRAM_CHAT_ID,
						text,
						disable_web_page_preview: true,
					}),
				},
			).catch(() => null),
		);
	}
	if (tasks.length > 0) {
		await Promise.allSettled(tasks);
	}
}

async function snapshotRebalanceState(accountId) {
	const [walletUsdtRaw, walletUsdcRaw, burrow] = await Promise.all([
		viewFunction("usdt.tether-token.near", "ft_balance_of", {
			account_id: accountId,
		}).catch(() => "0"),
		viewFunction(
			"a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
			"ft_balance_of",
			{ account_id: accountId },
		).catch(() => "0"),
		getBurrowAccount(accountId).catch(() => ({ collateral: [] })),
	]);
	const coll = burrow?.collateral || [];
	const cUsdt = coll.find(
		(row) => String(row.tokenId) === "usdt.tether-token.near",
	);
	const cUsdc = coll.find(
		(row) =>
			String(row.tokenId) ===
			"a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
	);
	return {
		walletUsdtRaw: String(walletUsdtRaw || "0"),
		walletUsdcRaw: String(walletUsdcRaw || "0"),
		collateralUsdtRaw: String(cUsdt?.balanceRawInner || "0"),
		collateralUsdcRaw: String(cUsdc?.balanceRawInner || "0"),
		collateralUsdtAmount: Number.parseFloat(String(cUsdt?.amount || "0")) || 0,
		collateralUsdcAmount: Number.parseFloat(String(cUsdc?.amount || "0")) || 0,
	};
}

function applySlippage(rawAmount, slippageBps) {
	const bps = BigInt(Number(slippageBps || 50));
	const base = 10_000n;
	const amount = BigInt(String(rawAmount || "0"));
	if (amount <= 0n) return "0";
	return ((amount * (base - bps)) / base).toString();
}

function rawToUi(raw, decimals) {
	return Number(raw) / 10 ** Number(decimals || 18);
}

function uiToRaw(ui, decimals) {
	const n = Number(ui);
	if (!Number.isFinite(n) || n <= 0) return "0";
	return String(Math.floor(n * 10 ** Number(decimals || 18)));
}

function quoteDivergenceBps(aRaw, bRaw) {
	const a = BigInt(String(aRaw || "0"));
	const b = BigInt(String(bRaw || "0"));
	if (a <= 0n || b <= 0n) return null;
	const base = a > b ? a : b;
	const diff = a > b ? a - b : b - a;
	return Number((diff * 10_000n) / base);
}

async function getBscPancakeV2Quote(amountInRaw) {
	const provider = new JsonRpcProvider(BSC_RPC_URL, {
		name: "bsc",
		chainId: BSC_CHAIN_ID,
	});
	const routerIface = new Interface([
		"function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
	]);
	const data = routerIface.encodeFunctionData("getAmountsOut", [
		String(amountInRaw),
		[BSC_USDT, BSC_USDC],
	]);
	const raw = await provider.call({ to: BSC_ROUTER_V2, data });
	const decoded = routerIface.decodeFunctionResult("getAmountsOut", raw);
	const amounts = decoded?.[0] || [];
	const outRaw = String(amounts?.[1]?.toString?.() || "0");
	const inUi = rawToUi(amountInRaw, BSC_USDT_DECIMALS);
	const outUi = rawToUi(outRaw, BSC_USDC_DECIMALS);
	const rate = inUi > 0 ? outUi / inUi : 0;
	return {
		source: "pancake-v2-router",
		amountOutRaw: outRaw,
		rate,
		pairAddress: "",
		liquidityUsd: 0,
	};
}

async function getBscUsdtUsdcQuote(amountInRaw) {
	const usdt = BSC_USDT.toLowerCase();
	const usdc = BSC_USDC.toLowerCase();
	let dexQuote = null;
	let onchainQuote = null;

	try {
		const response = await fetch(
			`https://api.dexscreener.com/latest/dex/tokens/${usdt}`,
		);
		if (!response.ok) throw new Error(`dexscreener http ${response.status}`);
		const payload = await response.json();
		const pairs = Array.isArray(payload?.pairs) ? payload.pairs : [];
		const candidates = pairs.filter((pair) => {
			const chainOk = String(pair.chainId || "").toLowerCase() === "bsc";
			if (!chainOk) return false;
			const base = String(pair.baseToken?.address || "").toLowerCase();
			const quote = String(pair.quoteToken?.address || "").toLowerCase();
			return (
				(base === usdt && quote === usdc) || (base === usdc && quote === usdt)
			);
		});
		if (candidates.length > 0) {
			candidates.sort(
				(a, b) =>
					Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0),
			);
			const best = candidates[0];
			const base = String(best.baseToken?.address || "").toLowerCase();
			const priceNative = Number(best.priceNative || 0);
			if (Number.isFinite(priceNative) && priceNative > 0) {
				const inUi = rawToUi(amountInRaw, BSC_USDT_DECIMALS);
				const rate = base === usdt ? priceNative : 1 / priceNative;
				const outUi = inUi * rate;
				const outRaw = uiToRaw(outUi, BSC_USDC_DECIMALS);
				dexQuote = {
					source: "dexscreener",
					amountOutRaw: outRaw,
					rate,
					pairAddress: String(best.pairAddress || ""),
					liquidityUsd: Number(best?.liquidity?.usd || 0),
				};
			}
		}
	} catch {
		// ignore dexscreener failures; rely on onchain/fallback
	}

	try {
		onchainQuote = await getBscPancakeV2Quote(amountInRaw);
	} catch {
		// ignore onchain quote failure; keep other sources
	}

	if (dexQuote && onchainQuote) {
		const divergenceBps = quoteDivergenceBps(
			dexQuote.amountOutRaw,
			onchainQuote.amountOutRaw,
		);
		const conservative =
			BigInt(dexQuote.amountOutRaw) < BigInt(onchainQuote.amountOutRaw)
				? dexQuote
				: onchainQuote;
		return {
			source: "dexscreener+pancake-v2",
			amountOutRaw: conservative.amountOutRaw,
			rate: conservative.rate,
			pairAddress: dexQuote.pairAddress,
			liquidityUsd: dexQuote.liquidityUsd,
			dexAmountOutRaw: dexQuote.amountOutRaw,
			pancakeV2AmountOutRaw: onchainQuote.amountOutRaw,
			onchainAmountOutRaw: onchainQuote.amountOutRaw,
			divergenceBps,
			dexQuoteCompare: {
				bestSource:
					BigInt(dexQuote.amountOutRaw) >= BigInt(onchainQuote.amountOutRaw)
						? "dexscreener"
						: "pancake-v2-router",
				conservativeSource:
					BigInt(dexQuote.amountOutRaw) <= BigInt(onchainQuote.amountOutRaw)
						? "dexscreener"
						: "pancake-v2-router",
				spreadBps: divergenceBps,
			},
		};
	}
	if (onchainQuote) {
		return {
			...onchainQuote,
			divergenceBps: null,
			dexQuoteCompare: {
				bestSource: "pancake-v2-router",
				conservativeSource: "pancake-v2-router",
				spreadBps: null,
			},
		};
	}
	if (dexQuote) {
		return {
			...dexQuote,
			divergenceBps: null,
			dexQuoteCompare: {
				bestSource: "dexscreener",
				conservativeSource: "dexscreener",
				spreadBps: null,
			},
		};
	}

	const inUi = rawToUi(amountInRaw, BSC_USDT_DECIMALS);
	const outRaw = uiToRaw(inUi, BSC_USDC_DECIMALS);
	return {
		source: "fallback-1to1",
		amountOutRaw: outRaw,
		rate: 1,
		pairAddress: "",
		liquidityUsd: 0,
		divergenceBps: null,
		dexQuoteCompare: {
			bestSource: "fallback-1to1",
			conservativeSource: "fallback-1to1",
			spreadBps: null,
		},
	};
}

function parseAprHintsFromJson(raw, sourceName) {
	const fallback = {
		source: `${sourceName}-default`,
		usdtSupplyAprBps: 0,
		usdcSupplyAprBps: 0,
		updatedAt: new Date().toISOString(),
	};
	if (!raw) return fallback;
	try {
		const parsed = JSON.parse(raw);
		const usdtSupplyAprBps = Math.max(
			0,
			Number.parseInt(String(parsed?.usdtSupplyAprBps || 0), 10) || 0,
		);
		const usdcSupplyAprBps = Math.max(
			0,
			Number.parseInt(String(parsed?.usdcSupplyAprBps || 0), 10) || 0,
		);
		return {
			source: `${sourceName}-env-json`,
			usdtSupplyAprBps,
			usdcSupplyAprBps,
			updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
		};
	} catch {
		return { ...fallback, source: `${sourceName}-invalid-env-json` };
	}
}

function normalizeAprHintsFromApi(payload, sourceName) {
	const pick = (obj, keys) => {
		for (const key of keys) {
			if (obj && obj[key] != null) return obj[key];
		}
		return null;
	};
	const usdtRaw = pick(payload, [
		"usdtSupplyAprBps",
		"usdtAprBps",
		"usdt_supply_apr_bps",
	]);
	const usdcRaw = pick(payload, [
		"usdcSupplyAprBps",
		"usdcAprBps",
		"usdc_supply_apr_bps",
	]);
	if (usdtRaw == null && usdcRaw == null) {
		throw new Error(`${sourceName}_apr_api_schema_missing_fields`);
	}
	const usdtParsed = Number.parseInt(String(usdtRaw ?? 0), 10);
	const usdcParsed = Number.parseInt(String(usdcRaw ?? 0), 10);
	if (!Number.isFinite(usdtParsed) || !Number.isFinite(usdcParsed)) {
		throw new Error(`${sourceName}_apr_api_schema_invalid_numeric`);
	}
	const usdtSupplyAprBps = Math.max(0, usdtParsed);
	const usdcSupplyAprBps = Math.max(0, usdcParsed);
	const updatedAtRaw = pick(payload, ["updatedAt", "timestamp", "updated_at"]);
	const updatedAt = String(updatedAtRaw || new Date().toISOString());
	const ts = Date.parse(updatedAt);
	if (!Number.isFinite(ts)) {
		throw new Error(`${sourceName}_apr_api_schema_invalid_updatedAt`);
	}
	return {
		source: `${sourceName}-api`,
		usdtSupplyAprBps,
		usdcSupplyAprBps,
		updatedAt,
	};
}

async function fetchAprHintsFromApi(url, sourceName) {
	if (!url) return null;
	const resp = await fetch(url);
	if (!resp.ok) throw new Error(`${sourceName}_apr_api_http_${resp.status}`);
	const payload = await resp.json();
	return normalizeAprHintsFromApi(payload, sourceName);
}

async function getBscProtocolAprHints(protocol) {
	const key = String(protocol || "venus").toLowerCase();
	const cache = BSC_APR_CACHE[key] || BSC_APR_CACHE.venus;
	const health = BSC_APR_SOURCE_HEALTH[key] || BSC_APR_SOURCE_HEALTH.venus;
	if (Date.now() - cache.ts < BSC_APR_CACHE_TTL_MS && cache.value)
		return cache.value;
	const apiUrlByProtocol = {
		venus: BSC_VENUS_APR_API_URL,
		aave: BSC_AAVE_APR_API_URL,
		lista: BSC_LISTA_APR_API_URL,
		wombat: BSC_WOMBAT_APR_API_URL,
	};
	const envJsonByProtocol = {
		venus: BSC_STABLE_APR_HINTS_JSON,
		aave: BSC_AAVE_APR_HINTS_JSON,
		lista: BSC_LISTA_APR_HINTS_JSON,
		wombat: BSC_WOMBAT_APR_HINTS_JSON,
	};
	const apiUrl = apiUrlByProtocol[key] || apiUrlByProtocol.venus;
	const envJson = envJsonByProtocol[key] || envJsonByProtocol.venus;
	let value = null;
	try {
		value = await fetchAprHintsFromApi(apiUrl, key);
		health.lastSuccessAt = new Date().toISOString();
		health.lastError = null;
	} catch (error) {
		health.lastErrorAt = new Date().toISOString();
		health.lastError = error instanceof Error ? error.message : String(error);
		value = parseAprHintsFromJson(envJson, key);
	}
	cache.ts = Date.now();
	cache.value = value;
	return value;
}

async function getBscStableAprHints() {
	return getBscProtocolAprHints("venus");
}

async function getBscAaveAprHints() {
	return getBscProtocolAprHints("aave");
}

async function getBscLendingMarketCompare() {
	const [venus, aave, lista, wombat] = await Promise.all([
		getBscStableAprHints(),
		getBscAaveAprHints(),
		getBscProtocolAprHints("lista"),
		getBscProtocolAprHints("wombat"),
	]);
	const protocolRows = [
		{
			protocol: "venus",
			usdt: venus.usdtSupplyAprBps,
			usdc: venus.usdcSupplyAprBps,
		},
		{
			protocol: "aave",
			usdt: aave.usdtSupplyAprBps,
			usdc: aave.usdcSupplyAprBps,
		},
		{
			protocol: "lista",
			usdt: lista.usdtSupplyAprBps,
			usdc: lista.usdcSupplyAprBps,
		},
		{
			protocol: "wombat",
			usdt: wombat.usdtSupplyAprBps,
			usdc: wombat.usdcSupplyAprBps,
		},
	];
	const bestUsdt = protocolRows.reduce((best, row) =>
		row.usdt > best.usdt ? row : best,
	);
	const bestUsdc = protocolRows.reduce((best, row) =>
		row.usdc > best.usdc ? row : best,
	);
	const marketHealth = Object.fromEntries(
		["venus", "aave", "lista", "wombat"].map((protocol) => {
			const row =
				protocol === "venus"
					? venus
					: protocol === "aave"
						? aave
						: protocol === "lista"
							? lista
							: wombat;
			const updatedAt = String(row?.updatedAt || "").trim();
			const ts = Date.parse(updatedAt);
			const ageMs = Number.isFinite(ts) ? Date.now() - ts : null;
			const status =
				ageMs == null
					? "unknown"
					: ageMs <= 6 * 60 * 60 * 1000
						? "fresh"
						: "stale";
			const source = String(row?.source || protocol);
			return [
				protocol,
				{
					status,
					source,
					updatedAt: updatedAt || null,
					ageMs,
				},
			];
		}),
	);
	const marketRiskTags = Object.fromEntries(
		Object.entries(marketHealth).map(([protocol, row]) => {
			const tags = [];
			if (row?.status === "stale") tags.push("stale_data");
			if (row?.status === "unknown") tags.push("missing_timestamp");
			if (row?.source === "env-json") tags.push("manual_hint_source");
			if (tags.length === 0) tags.push("healthy");
			return [protocol, tags];
		}),
	);
	const marketRiskScore = Object.fromEntries(
		Object.entries(marketRiskTags).map(([protocol, tags]) => {
			let score = 0;
			if (Array.isArray(tags)) {
				if (tags.includes("stale_data")) score += 45;
				if (tags.includes("missing_timestamp")) score += 35;
				if (tags.includes("manual_hint_source")) score += 20;
			}
			if (score > 100) score = 100;
			return [protocol, score];
		}),
	);
	const marketRiskBand = Object.fromEntries(
		Object.entries(marketRiskScore).map(([protocol, score]) => {
			const n = Number(score || 0);
			const band = n >= 70 ? "high" : n >= 40 ? "medium" : "low";
			return [protocol, band];
		}),
	);
	const riskScores = Object.values(marketRiskScore).map((x) => Number(x || 0));
	const avgRiskScore =
		riskScores.length > 0
			? Number(
					(
						riskScores.reduce((acc, n) => acc + n, 0) / riskScores.length
					).toFixed(1),
				)
			: 0;
	const maxRiskScore = riskScores.length > 0 ? Math.max(...riskScores) : 0;
	const aggregateRiskBand =
		avgRiskScore >= 70 ? "high" : avgRiskScore >= 40 ? "medium" : "low";
	const aggregateRisk = {
		avgScore: avgRiskScore,
		maxScore: maxRiskScore,
		band: aggregateRiskBand,
	};
	return {
		ok: true,
		chain: "bsc",
		markets: { venus, aave, lista, wombat },
		marketHealth,
		marketRiskTags,
		marketRiskScore,
		marketRiskBand,
		aggregateRisk,
		recommendation: {
			bestUsdtSupply: {
				protocol: bestUsdt.protocol,
				aprBps: bestUsdt.usdt,
			},
			bestUsdcSupply: {
				protocol: bestUsdc.protocol,
				aprBps: bestUsdc.usdc,
			},
		},
	};
}

async function buildBscDexNetYieldInsight(compare, options = {}) {
	const amountUsd = Math.max(
		1,
		Number.parseFloat(
			String(options.amountUsd || BSC_YIELD_DEFAULT_QUOTE_USD),
		) || BSC_YIELD_DEFAULT_QUOTE_USD,
	);
	const rebalanceIntervalDays = Math.max(
		1,
		Number.parseInt(
			String(
				options.rebalanceIntervalDays || BSC_YIELD_REBALANCE_INTERVAL_DAYS,
			),
			10,
		) || BSC_YIELD_REBALANCE_INTERVAL_DAYS,
	);
	const amountInRaw = uiToRaw(amountUsd, BSC_USDT_DECIMALS);
	const quote = await getBscUsdtUsdcQuote(amountInRaw);
	const outUi = rawToUi(quote.amountOutRaw, BSC_USDC_DECIMALS);
	const slipBps =
		amountUsd > 0 ? Math.max(0, ((amountUsd - outUi) / amountUsd) * 10_000) : 0;
	const annualizedSwapCostBps = slipBps * (365 / rebalanceIntervalDays);
	const venusAprDeltaBps =
		Number(compare?.markets?.venus?.usdcSupplyAprBps || 0) -
		Number(compare?.markets?.venus?.usdtSupplyAprBps || 0);
	const aaveAprDeltaBps =
		Number(compare?.markets?.aave?.usdcSupplyAprBps || 0) -
		Number(compare?.markets?.aave?.usdtSupplyAprBps || 0);
	const venusNetDeltaBps = venusAprDeltaBps - annualizedSwapCostBps;
	const aaveNetDeltaBps = aaveAprDeltaBps - annualizedSwapCostBps;
	const preferredProtocol =
		aaveNetDeltaBps > venusNetDeltaBps
			? "aave"
			: venusNetDeltaBps > aaveNetDeltaBps
				? "venus"
				: compare?.recommendation?.bestUsdcSupply?.protocol || "venus";
	return {
		amountUsd,
		rebalanceIntervalDays,
		quote: {
			source: quote.source,
			amountInRaw,
			amountOutRaw: quote.amountOutRaw,
			rate: quote.rate,
			divergenceBps: quote.divergenceBps ?? null,
			dexAmountOutRaw: quote.dexAmountOutRaw || null,
			pancakeV2AmountOutRaw:
				quote.pancakeV2AmountOutRaw || quote.onchainAmountOutRaw || null,
			dexQuoteCompare: quote.dexQuoteCompare || null,
		},
		swapCost: {
			estimatedSlipBps: Number(slipBps.toFixed(2)),
			annualizedSwapCostBps: Number(annualizedSwapCostBps.toFixed(2)),
		},
		netYieldDelta: {
			venusAprDeltaBps: Number(venusAprDeltaBps.toFixed(2)),
			aaveAprDeltaBps: Number(aaveAprDeltaBps.toFixed(2)),
			venusNetDeltaBps: Number(venusNetDeltaBps.toFixed(2)),
			aaveNetDeltaBps: Number(aaveNetDeltaBps.toFixed(2)),
			preferredProtocol,
		},
	};
}

async function getBscPositionRates(protocol) {
	const key = String(protocol || "").toLowerCase();
	if (key !== "lista" && key !== "wombat") {
		return {
			usdc: 1,
			usdt: 1,
			source: "default",
			updatedAt: new Date().toISOString(),
		};
	}
	const cache = BSC_POSITION_RATE_CACHE[key];
	if (
		cache?.value &&
		Date.now() - Number(cache.ts || 0) < BSC_POSITION_RATE_CACHE_TTL_MS
	) {
		return cache.value;
	}
	const fallback = {
		usdc:
			key === "lista"
				? BSC_LISTA_USDC_EXCHANGE_RATE
				: BSC_WOMBAT_USDC_EXCHANGE_RATE,
		usdt:
			key === "lista"
				? BSC_LISTA_USDT_EXCHANGE_RATE
				: BSC_WOMBAT_USDT_EXCHANGE_RATE,
		source: `${key}-env`,
		updatedAt: new Date().toISOString(),
	};
	const apiUrl =
		key === "lista"
			? BSC_LISTA_POSITION_RATE_API_URL
			: BSC_WOMBAT_POSITION_RATE_API_URL;
	if (!apiUrl) {
		cache.ts = Date.now();
		cache.value = fallback;
		cache.source = "env";
		return fallback;
	}
	try {
		const resp = await fetch(apiUrl);
		if (!resp.ok) throw new Error(`http_${resp.status}`);
		const payload = await resp.json();
		const usdc =
			Math.max(
				0,
				Number.parseFloat(
					String(
						payload?.usdc ??
							payload?.usdcRate ??
							payload?.usdcExchangeRate ??
							1,
					),
				),
			) || 1;
		const usdt =
			Math.max(
				0,
				Number.parseFloat(
					String(
						payload?.usdt ??
							payload?.usdtRate ??
							payload?.usdtExchangeRate ??
							1,
					),
				),
			) || 1;
		const value = {
			usdc,
			usdt,
			source: `${key}-api`,
			updatedAt: String(payload?.updatedAt || new Date().toISOString()),
		};
		cache.ts = Date.now();
		cache.value = value;
		cache.source = "api";
		return value;
	} catch {
		cache.ts = Date.now();
		cache.value = fallback;
		cache.source = "env-fallback";
		return fallback;
	}
}

async function getBscWalletStableBalances(account) {
	const owner = String(account || "").trim();
	if (!owner) throw new Error("account is required");
	const provider = new JsonRpcProvider(BSC_RPC_URL, {
		name: "bsc",
		chainId: BSC_CHAIN_ID,
	});
	const erc20Iface = new Interface([
		"function balanceOf(address owner) view returns (uint256)",
	]);
	const readBalance = async (token) => {
		const data = erc20Iface.encodeFunctionData("balanceOf", [owner]);
		const raw = await provider.call({ to: token, data });
		return erc20Iface.decodeFunctionResult("balanceOf", raw)[0].toString();
	};
	const [usdtRaw, usdcRaw] = await Promise.all([
		readBalance(BSC_USDT),
		readBalance(BSC_USDC),
	]);
	return {
		account: owner,
		usdtRaw,
		usdcRaw,
		usdtUi: rawToUi(usdtRaw, BSC_USDT_DECIMALS),
		usdcUi: rawToUi(usdcRaw, BSC_USDC_DECIMALS),
	};
}

async function getBscProtocolPositions(account) {
	const owner = String(account || "").trim();
	if (!owner) {
		return {
			aave: {},
			venus: {},
			lista: {},
			wombat: {},
			subtotalsUsdApprox: { aave: 0, venus: 0, lista: 0, wombat: 0 },
			totalUsdApprox: 0,
			health: { status: "degraded", reason: "missing_account" },
			fetchedAt: new Date().toISOString(),
		};
	}
	const provider = new JsonRpcProvider(BSC_RPC_URL, {
		name: "bsc",
		chainId: BSC_CHAIN_ID,
	});
	const erc20Iface = new Interface([
		"function balanceOf(address owner) view returns (uint256)",
	]);
	const readMaybe = async (token, decimals, configKey, exchangeRate = 1) => {
		if (!token) {
			return {
				token: null,
				configKey,
				missingConfig: true,
				balanceUi: 0,
				normalizedUsdApprox: 0,
				exchangeRate,
			};
		}
		try {
			const data = erc20Iface.encodeFunctionData("balanceOf", [owner]);
			const raw = await provider.call({ to: token, data });
			const bal = erc20Iface
				.decodeFunctionResult("balanceOf", raw)[0]
				.toString();
			const balanceUi = rawToUi(bal, decimals);
			return {
				token,
				balanceRaw: bal,
				balanceUi,
				normalizedUsdApprox: Number(
					(Number(balanceUi) * Number(exchangeRate || 1)).toFixed(6),
				),
				exchangeRate,
				ok: true,
			};
		} catch {
			return {
				token,
				error: "read_failed",
				balanceUi: 0,
				normalizedUsdApprox: 0,
				exchangeRate,
				ok: false,
			};
		}
	};
	const [listaRates, wombatRates] = await Promise.all([
		getBscPositionRates("lista"),
		getBscPositionRates("wombat"),
	]);
	const [
		aaveUsdc,
		aaveUsdt,
		venusUsdc,
		venusUsdt,
		listaUsdc,
		listaUsdt,
		wombatUsdc,
		wombatUsdt,
	] = await Promise.all([
		readMaybe(BSC_AAVE_ATOKEN_USDC, BSC_USDC_DECIMALS, "BSC_AAVE_ATOKEN_USDC"),
		readMaybe(BSC_AAVE_ATOKEN_USDT, BSC_USDT_DECIMALS, "BSC_AAVE_ATOKEN_USDT"),
		readMaybe(
			BSC_VENUS_VTOKEN_USDC,
			BSC_USDC_DECIMALS,
			"BSC_VENUS_VTOKEN_USDC",
		),
		readMaybe(
			BSC_VENUS_VTOKEN_USDT,
			BSC_USDT_DECIMALS,
			"BSC_VENUS_VTOKEN_USDT",
		),
		readMaybe(
			BSC_LISTA_TOKEN_USDC,
			BSC_USDC_DECIMALS,
			"BSC_LISTA_TOKEN_USDC",
			Number(listaRates?.usdc || BSC_LISTA_USDC_EXCHANGE_RATE),
		),
		readMaybe(
			BSC_LISTA_TOKEN_USDT,
			BSC_USDT_DECIMALS,
			"BSC_LISTA_TOKEN_USDT",
			Number(listaRates?.usdt || BSC_LISTA_USDT_EXCHANGE_RATE),
		),
		readMaybe(
			BSC_WOMBAT_TOKEN_USDC,
			BSC_USDC_DECIMALS,
			"BSC_WOMBAT_TOKEN_USDC",
			Number(wombatRates?.usdc || BSC_WOMBAT_USDC_EXCHANGE_RATE),
		),
		readMaybe(
			BSC_WOMBAT_TOKEN_USDT,
			BSC_USDT_DECIMALS,
			"BSC_WOMBAT_TOKEN_USDT",
			Number(wombatRates?.usdt || BSC_WOMBAT_USDT_EXCHANGE_RATE),
		),
	]);
	const subtotalAave =
		Number(aaveUsdc?.normalizedUsdApprox || 0) +
		Number(aaveUsdt?.normalizedUsdApprox || 0);
	const subtotalVenus =
		Number(venusUsdc?.normalizedUsdApprox || 0) +
		Number(venusUsdt?.normalizedUsdApprox || 0);
	const subtotalLista =
		Number(listaUsdc?.normalizedUsdApprox || 0) +
		Number(listaUsdt?.normalizedUsdApprox || 0);
	const subtotalWombat =
		Number(wombatUsdc?.normalizedUsdApprox || 0) +
		Number(wombatUsdt?.normalizedUsdApprox || 0);
	const totalUsdApprox =
		subtotalAave + subtotalVenus + subtotalLista + subtotalWombat;
	const rows = [
		aaveUsdc,
		aaveUsdt,
		venusUsdc,
		venusUsdt,
		listaUsdc,
		listaUsdt,
		wombatUsdc,
		wombatUsdt,
	];
	const hasReadError = rows.some((r) => r && r.ok === false);
	const missingAnyConfig = rows.some((r) => r?.missingConfig);
	const missingConfigKeys = rows
		.filter((r) => r?.missingConfig)
		.map((r) => String(r?.configKey || ""))
		.filter(Boolean);
	const failedTokens = rows
		.filter((r) => r && r.ok === false)
		.map((r) => String(r?.token || ""))
		.filter(Boolean);
	const hasNormalized = rows.some((r) => Number(r?.exchangeRate || 1) !== 1);
	const health = hasReadError
		? {
				status: "error",
				reason: "one_or_more_reads_failed",
				detail:
					failedTokens.length > 0 ? `failed=${failedTokens.join(",")}` : "-",
			}
		: missingAnyConfig
			? {
					status: "degraded",
					reason: "partial_missing_token_config",
					detail:
						missingConfigKeys.length > 0
							? `missing=${missingConfigKeys.join(",")}`
							: "-",
				}
			: {
					status: "ok",
					reason: hasNormalized
						? "all_configured_reads_ok_with_normalization"
						: "all_configured_reads_ok",
					detail: hasNormalized ? "includes_exchange_rate_normalization" : "-",
				};
	return {
		aave: { usdc: aaveUsdc, usdt: aaveUsdt },
		venus: { usdc: venusUsdc, usdt: venusUsdt },
		lista: { usdc: listaUsdc, usdt: listaUsdt },
		wombat: { usdc: wombatUsdc, usdt: wombatUsdt },
		normalizationSources: {
			lista: {
				source: String(listaRates?.source || "env"),
				updatedAt: String(listaRates?.updatedAt || ""),
				usdc: Number(listaRates?.usdc || BSC_LISTA_USDC_EXCHANGE_RATE),
				usdt: Number(listaRates?.usdt || BSC_LISTA_USDT_EXCHANGE_RATE),
			},
			wombat: {
				source: String(wombatRates?.source || "env"),
				updatedAt: String(wombatRates?.updatedAt || ""),
				usdc: Number(wombatRates?.usdc || BSC_WOMBAT_USDC_EXCHANGE_RATE),
				usdt: Number(wombatRates?.usdt || BSC_WOMBAT_USDT_EXCHANGE_RATE),
			},
		},
		subtotalsUsdApprox: {
			aave: subtotalAave,
			venus: subtotalVenus,
			lista: subtotalLista,
			wombat: subtotalWombat,
		},
		totalUsdApprox,
		health,
		fetchedAt: new Date().toISOString(),
	};
}

function buildBscYieldPlan({
	balances,
	targetUsdcBps,
	minDriftBps,
	maxStepUsd,
	aprHints,
	minAprDeltaBps,
}) {
	const totalRaw = BigInt(balances.usdtRaw) + BigInt(balances.usdcRaw);
	if (totalRaw <= 0n) {
		return {
			action: "hold",
			reason: "empty_wallet_balances",
			targetUsdcBps,
			currentUsdcBps: 0,
			recommendedAmountRaw: "0",
		};
	}
	let effectiveTargetUsdcBps = targetUsdcBps;
	const usdcApr = Number(aprHints?.usdcSupplyAprBps || 0);
	const usdtApr = Number(aprHints?.usdtSupplyAprBps || 0);
	if (usdcApr - usdtApr >= minAprDeltaBps) {
		effectiveTargetUsdcBps = Math.max(effectiveTargetUsdcBps, 8500);
	} else if (usdtApr - usdcApr >= minAprDeltaBps) {
		effectiveTargetUsdcBps = Math.min(effectiveTargetUsdcBps, 3000);
	}

	const currentUsdcBps = Number(
		(BigInt(balances.usdcRaw) * 10_000n) / totalRaw,
	);
	const drift = effectiveTargetUsdcBps - currentUsdcBps;
	if (Math.abs(drift) < minDriftBps || drift <= 0) {
		return {
			action: "hold",
			reason: drift <= 0 ? "usdc_at_or_above_target" : "drift_below_threshold",
			targetUsdcBps: effectiveTargetUsdcBps,
			currentUsdcBps,
			recommendedAmountRaw: "0",
		};
	}
	if (usdtApr - usdcApr >= minAprDeltaBps) {
		return {
			action: "hold",
			reason: "usdt_apr_preferred_but_reverse_path_not_enabled",
			targetUsdcBps: effectiveTargetUsdcBps,
			currentUsdcBps,
			recommendedAmountRaw: "0",
		};
	}
	const targetUsdcRaw = (totalRaw * BigInt(effectiveTargetUsdcBps)) / 10_000n;
	const needUsdcRaw =
		targetUsdcRaw > BigInt(balances.usdcRaw)
			? targetUsdcRaw - BigInt(balances.usdcRaw)
			: 0n;
	const maxStepRaw = BigInt(uiToRaw(maxStepUsd, BSC_USDT_DECIMALS));
	const byUsdtRaw = BigInt(balances.usdtRaw);
	const amountRaw =
		needUsdcRaw < byUsdtRaw
			? needUsdcRaw < maxStepRaw
				? needUsdcRaw
				: maxStepRaw
			: byUsdtRaw < maxStepRaw
				? byUsdtRaw
				: maxStepRaw;
	if (amountRaw <= 0n) {
		return {
			action: "hold",
			reason: "no_usable_usdt_amount",
			targetUsdcBps: effectiveTargetUsdcBps,
			currentUsdcBps,
			recommendedAmountRaw: "0",
		};
	}
	return {
		action: "rebalance_usdt_to_usdc",
		reason:
			usdcApr - usdtApr >= minAprDeltaBps
				? "usdc_apr_preferred"
				: "usdc_below_target",
		targetUsdcBps: effectiveTargetUsdcBps,
		currentUsdcBps,
		recommendedAmountRaw: amountRaw.toString(),
	};
}

async function computeBscYieldPlan(input = {}) {
	const account = String(input.account || BSC_EXECUTE_RECIPIENT || "").trim();
	if (!account) {
		throw new Error(
			"missing bsc account: pass account or configure BSC_EXECUTE_RECIPIENT",
		);
	}
	const targetUsdcBps = Math.max(
		0,
		Math.min(10_000, Number.parseInt(String(input.targetUsdcBps || 7000), 10)),
	);
	const minDriftBps = Math.max(
		0,
		Number.parseInt(String(input.minDriftBps || 500), 10) || 500,
	);
	const maxStepUsd = Math.max(
		1,
		Number.parseFloat(String(input.maxStepUsd || 100)) || 100,
	);
	const minAprDeltaBps = Math.max(
		0,
		Number.parseInt(
			String(input.minAprDeltaBps || BSC_YIELD_MIN_APR_DELTA_BPS),
			10,
		) || BSC_YIELD_MIN_APR_DELTA_BPS,
	);
	const [balances, compare] = await Promise.all([
		getBscWalletStableBalances(account),
		getBscLendingMarketCompare(),
	]);
	const netYieldInsight = await buildBscDexNetYieldInsight(compare, {
		amountUsd: input.amountUsd,
		rebalanceIntervalDays: input.rebalanceIntervalDays,
	});
	const explicitProtocol = String(input.executionProtocol || "")
		.trim()
		.toLowerCase();
	const hasExplicitProtocol =
		explicitProtocol === "aave" ||
		explicitProtocol === "venus" ||
		explicitProtocol === "lista" ||
		explicitProtocol === "wombat";
	const envDefaultProtocol = String(
		BSC_YIELD_EXECUTION_PROTOCOL_DEFAULT || "venus",
	)
		.trim()
		.toLowerCase();
	const fallbackProtocol =
		envDefaultProtocol === "aave" || envDefaultProtocol === "venus"
			? envDefaultProtocol
			: "venus";
	const recommendedProtocolFromNet = String(
		netYieldInsight?.netYieldDelta?.preferredProtocol ||
			compare?.recommendation?.bestUsdcSupply?.protocol ||
			fallbackProtocol,
	)
		.trim()
		.toLowerCase();
	const recommendedProtocol =
		recommendedProtocolFromNet === "aave" ||
		recommendedProtocolFromNet === "venus" ||
		recommendedProtocolFromNet === "lista" ||
		recommendedProtocolFromNet === "wombat"
			? recommendedProtocolFromNet
			: fallbackProtocol;
	const executionProtocol = hasExplicitProtocol
		? explicitProtocol
		: recommendedProtocol;
	const aprHints = {
		source: "best-of-venus-aave-lista-wombat",
		usdtSupplyAprBps: Math.max(
			Number(compare?.markets?.venus?.usdtSupplyAprBps || 0),
			Number(compare?.markets?.aave?.usdtSupplyAprBps || 0),
			Number(compare?.markets?.lista?.usdtSupplyAprBps || 0),
			Number(compare?.markets?.wombat?.usdtSupplyAprBps || 0),
		),
		usdcSupplyAprBps: Math.max(
			Number(compare?.markets?.venus?.usdcSupplyAprBps || 0),
			Number(compare?.markets?.aave?.usdcSupplyAprBps || 0),
			Number(compare?.markets?.lista?.usdcSupplyAprBps || 0),
			Number(compare?.markets?.wombat?.usdcSupplyAprBps || 0),
		),
		updatedAt: new Date().toISOString(),
	};
	const plan = buildBscYieldPlan({
		balances,
		targetUsdcBps,
		minDriftBps,
		maxStepUsd,
		aprHints,
		minAprDeltaBps,
	});
	const aaveBlockers = [];
	if (executionProtocol === "aave") {
		if (!BSC_AAVE_EXECUTE_ENABLED) aaveBlockers.push("aave_execute_disabled");
		if (
			BSC_AAVE_EXECUTE_MODE === "native" ||
			BSC_AAVE_EXECUTE_MODE === "auto"
		) {
			if (!BSC_AAVE_POOL) aaveBlockers.push("missing_bsc_aave_pool");
			if (!BSC_AAVE_EXECUTE_PRIVATE_KEY) {
				aaveBlockers.push("missing_bsc_aave_execute_private_key");
			}
		}
		if (
			BSC_AAVE_EXECUTE_MODE === "command" ||
			BSC_AAVE_EXECUTE_MODE === "auto"
		) {
			if (!BSC_AAVE_EXECUTE_COMMAND) {
				aaveBlockers.push("missing_bsc_aave_execute_command");
			}
		}
		if (!BSC_AAVE_ALLOWED_TOKENS.includes(String(BSC_USDC).toLowerCase())) {
			aaveBlockers.push("bsc_usdc_not_in_aave_allowed_tokens");
		}
		if (/^\d+$/.test(plan?.recommendedAmountRaw || "0")) {
			const maxRaw = /^\d+$/.test(BSC_AAVE_MAX_AMOUNT_RAW)
				? BigInt(BSC_AAVE_MAX_AMOUNT_RAW)
				: 0n;
			if (
				maxRaw > 0n &&
				BigInt(String(plan?.recommendedAmountRaw || "0")) > maxRaw
			) {
				aaveBlockers.push("recommended_amount_exceeds_bsc_aave_max_amount_raw");
			}
		}
	}
	const listaBlockers = [];
	if (executionProtocol === "lista") {
		if (!BSC_LISTA_EXECUTE_ENABLED)
			listaBlockers.push("lista_execute_disabled");
		if (BSC_LISTA_EXECUTE_MODE === "native") {
			if (!BSC_LISTA_NATIVE_EXECUTE_ENABLED) {
				listaBlockers.push("lista_native_execute_not_enabled");
			} else {
				listaBlockers.push("lista_native_slot_not_implemented");
			}
		}
		if (BSC_LISTA_EXECUTE_MODE !== "native") {
			if (!BSC_LISTA_EXECUTE_COMMAND)
				listaBlockers.push("missing_bsc_lista_execute_command");
			if (
				BSC_LISTA_EXECUTE_COMMAND &&
				!hasRequiredPlaceholders(BSC_LISTA_EXECUTE_COMMAND, [
					"{amountRaw}",
					"{runId}",
				])
			) {
				listaBlockers.push(
					"bsc_lista_execute_command_missing_required_placeholders",
				);
			}
		}
		if (!BSC_LISTA_ALLOWED_TOKENS.includes(String(BSC_USDC).toLowerCase())) {
			listaBlockers.push("bsc_usdc_not_in_lista_allowed_tokens");
		}
		if (/^\d+$/.test(plan?.recommendedAmountRaw || "0")) {
			const maxRaw = /^\d+$/.test(BSC_LISTA_MAX_AMOUNT_RAW)
				? BigInt(BSC_LISTA_MAX_AMOUNT_RAW)
				: 0n;
			if (
				maxRaw > 0n &&
				BigInt(String(plan?.recommendedAmountRaw || "0")) > maxRaw
			) {
				listaBlockers.push(
					"recommended_amount_exceeds_bsc_lista_max_amount_raw",
				);
			}
		}
	}
	const wombatBlockers = [];
	if (executionProtocol === "wombat") {
		if (!BSC_WOMBAT_EXECUTE_ENABLED)
			wombatBlockers.push("wombat_execute_disabled");
		if (BSC_WOMBAT_EXECUTE_MODE === "native") {
			if (!BSC_WOMBAT_NATIVE_EXECUTE_ENABLED) {
				wombatBlockers.push("wombat_native_execute_not_enabled");
			} else {
				wombatBlockers.push("wombat_native_slot_not_implemented");
			}
		}
		if (BSC_WOMBAT_EXECUTE_MODE !== "native") {
			if (!BSC_WOMBAT_EXECUTE_COMMAND)
				wombatBlockers.push("missing_bsc_wombat_execute_command");
			if (
				BSC_WOMBAT_EXECUTE_COMMAND &&
				!hasRequiredPlaceholders(BSC_WOMBAT_EXECUTE_COMMAND, [
					"{amountRaw}",
					"{runId}",
				])
			) {
				wombatBlockers.push(
					"bsc_wombat_execute_command_missing_required_placeholders",
				);
			}
		}
		if (!BSC_WOMBAT_ALLOWED_TOKENS.includes(String(BSC_USDC).toLowerCase())) {
			wombatBlockers.push("bsc_usdc_not_in_wombat_allowed_tokens");
		}
		if (/^\d+$/.test(plan?.recommendedAmountRaw || "0")) {
			const maxRaw = /^\d+$/.test(BSC_WOMBAT_MAX_AMOUNT_RAW)
				? BigInt(BSC_WOMBAT_MAX_AMOUNT_RAW)
				: 0n;
			if (
				maxRaw > 0n &&
				BigInt(String(plan?.recommendedAmountRaw || "0")) > maxRaw
			) {
				wombatBlockers.push(
					"recommended_amount_exceeds_bsc_wombat_max_amount_raw",
				);
			}
		}
	}
	const protocolBlockers =
		executionProtocol === "aave"
			? aaveBlockers
			: executionProtocol === "lista"
				? listaBlockers
				: executionProtocol === "wombat"
					? wombatBlockers
					: [];
	const envHintByBlocker = {
		aave_execute_disabled: "BSC_AAVE_EXECUTE_ENABLED=true",
		missing_bsc_aave_pool: "BSC_AAVE_POOL=0x...",
		missing_bsc_aave_execute_private_key: "BSC_AAVE_EXECUTE_PRIVATE_KEY=0x...",
		missing_bsc_aave_execute_command:
			"BSC_AAVE_EXECUTE_COMMAND='node scripts/aave-supply.mjs --amount {amountRaw} --run {runId}'",
		bsc_usdc_not_in_aave_allowed_tokens:
			"BSC_AAVE_ALLOWED_TOKENS=0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d,0x55d398326f99059ff775485246999027b3197955",
		recommended_amount_exceeds_bsc_aave_max_amount_raw:
			"BSC_AAVE_MAX_AMOUNT_RAW=<larger_raw_cap>",
		lista_execute_disabled: "BSC_LISTA_EXECUTE_ENABLED=true",
		lista_native_execute_not_enabled: "BSC_LISTA_NATIVE_EXECUTE_ENABLED=true",
		lista_native_slot_not_implemented:
			"# native slot reserved: keep BSC_LISTA_EXECUTE_MODE=command or auto until native adapter lands",
		missing_bsc_lista_execute_command:
			"BSC_LISTA_EXECUTE_COMMAND='node scripts/lista-supply.mjs --amount {amountRaw} --run {runId}'",
		bsc_usdc_not_in_lista_allowed_tokens:
			"BSC_LISTA_ALLOWED_TOKENS=0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d,0x55d398326f99059ff775485246999027b3197955",
		recommended_amount_exceeds_bsc_lista_max_amount_raw:
			"BSC_LISTA_MAX_AMOUNT_RAW=<larger_raw_cap>",
		bsc_lista_execute_command_missing_required_placeholders:
			"BSC_LISTA_EXECUTE_COMMAND='node scripts/lista-supply.mjs --amount {amountRaw} --run {runId}'",
		wombat_execute_disabled: "BSC_WOMBAT_EXECUTE_ENABLED=true",
		wombat_native_execute_not_enabled: "BSC_WOMBAT_NATIVE_EXECUTE_ENABLED=true",
		wombat_native_slot_not_implemented:
			"# native slot reserved: keep BSC_WOMBAT_EXECUTE_MODE=command or auto until native adapter lands",
		missing_bsc_wombat_execute_command:
			"BSC_WOMBAT_EXECUTE_COMMAND='node scripts/wombat-supply.mjs --amount {amountRaw} --run {runId}'",
		bsc_usdc_not_in_wombat_allowed_tokens:
			"BSC_WOMBAT_ALLOWED_TOKENS=0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d,0x55d398326f99059ff775485246999027b3197955",
		recommended_amount_exceeds_bsc_wombat_max_amount_raw:
			"BSC_WOMBAT_MAX_AMOUNT_RAW=<larger_raw_cap>",
		bsc_wombat_execute_command_missing_required_placeholders:
			"BSC_WOMBAT_EXECUTE_COMMAND='node scripts/wombat-supply.mjs --amount {amountRaw} --run {runId}'",
	};
	const fixLines = protocolBlockers
		.map((b) => envHintByBlocker[b])
		.filter(Boolean);
	const modePack =
		executionProtocol === "aave"
			? BSC_AAVE_EXECUTE_MODE === "native"
				? [
						"BSC_AAVE_EXECUTE_MODE=native",
						"# requires: BSC_AAVE_POOL + BSC_AAVE_EXECUTE_PRIVATE_KEY",
					]
				: BSC_AAVE_EXECUTE_MODE === "command"
					? [
							"BSC_AAVE_EXECUTE_MODE=command",
							"# requires: BSC_AAVE_EXECUTE_COMMAND",
						]
					: [
							"BSC_AAVE_EXECUTE_MODE=auto",
							"# auto prefers native when key is present; falls back to command",
						]
			: executionProtocol === "lista"
				? BSC_LISTA_EXECUTE_MODE === "native"
					? [
							"BSC_LISTA_EXECUTE_MODE=native",
							"# requires: BSC_LISTA_NATIVE_EXECUTE_ENABLED=true (native slot currently routes via command fallback)",
						]
					: BSC_LISTA_EXECUTE_MODE === "command"
						? [
								"BSC_LISTA_EXECUTE_MODE=command",
								"# requires: BSC_LISTA_EXECUTE_ENABLED + BSC_LISTA_EXECUTE_COMMAND",
							]
						: [
								"BSC_LISTA_EXECUTE_MODE=auto",
								"# auto prefers native slot when enabled, falls back to command",
							]
				: executionProtocol === "wombat"
					? BSC_WOMBAT_EXECUTE_MODE === "native"
						? [
								"BSC_WOMBAT_EXECUTE_MODE=native",
								"# requires: BSC_WOMBAT_NATIVE_EXECUTE_ENABLED=true (native slot currently routes via command fallback)",
							]
						: BSC_WOMBAT_EXECUTE_MODE === "command"
							? [
									"BSC_WOMBAT_EXECUTE_MODE=command",
									"# requires: BSC_WOMBAT_EXECUTE_ENABLED + BSC_WOMBAT_EXECUTE_COMMAND",
								]
							: [
									"BSC_WOMBAT_EXECUTE_MODE=auto",
									"# auto prefers native slot when enabled, falls back to command",
								]
					: ["# venus uses existing swap+supply path"];
	const safeDefaults = [
		"BSC_AAVE_ALLOWED_TOKENS=0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d,0x55d398326f99059ff775485246999027b3197955",
		`BSC_AAVE_MAX_AMOUNT_RAW=${BSC_AAVE_MAX_AMOUNT_RAW}`,
		"BSC_LISTA_ALLOWED_TOKENS=0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d,0x55d398326f99059ff775485246999027b3197955",
		`BSC_LISTA_MAX_AMOUNT_RAW=${BSC_LISTA_MAX_AMOUNT_RAW}`,
		"BSC_WOMBAT_ALLOWED_TOKENS=0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d,0x55d398326f99059ff775485246999027b3197955",
		`BSC_WOMBAT_MAX_AMOUNT_RAW=${BSC_WOMBAT_MAX_AMOUNT_RAW}`,
		`BSC_LISTA_EXECUTE_TIMEOUT_MS=${BSC_LISTA_EXECUTE_TIMEOUT_MS}`,
		`BSC_LISTA_EXECUTE_MODE=${BSC_LISTA_EXECUTE_MODE}`,
		`BSC_LISTA_NATIVE_EXECUTE_ENABLED=${BSC_LISTA_NATIVE_EXECUTE_ENABLED}`,
		`BSC_WOMBAT_EXECUTE_TIMEOUT_MS=${BSC_WOMBAT_EXECUTE_TIMEOUT_MS}`,
		`BSC_WOMBAT_EXECUTE_MODE=${BSC_WOMBAT_EXECUTE_MODE}`,
		`BSC_WOMBAT_NATIVE_EXECUTE_ENABLED=${BSC_WOMBAT_NATIVE_EXECUTE_ENABLED}`,
		"BSC_YIELD_EXECUTION_PROTOCOL_DEFAULT=venus",
	];
	const fullFixPack = [
		`# bsc ${executionProtocol} execute full fix pack`,
		...modePack,
		"",
		"# blockers (current)",
		...(fixLines.length ? fixLines : ["# none"]),
		"",
		"# safe defaults",
		...safeDefaults,
	].join("\n");
	const canExecute =
		executionProtocol === "venus"
			? true
			: executionProtocol === "aave" ||
					executionProtocol === "lista" ||
					executionProtocol === "wombat"
				? protocolBlockers.length === 0
				: false;
	const executeReadiness = {
		requestedProtocol: hasExplicitProtocol ? explicitProtocol : "auto",
		venusEnabled: true,
		aaveEnabled: BSC_AAVE_EXECUTE_ENABLED,
		listaEnabled: BSC_LISTA_EXECUTE_ENABLED,
		wombatEnabled: BSC_WOMBAT_EXECUTE_ENABLED,
		aaveMode: BSC_AAVE_EXECUTE_MODE,
		listaMode: BSC_LISTA_EXECUTE_MODE,
		wombatMode: BSC_WOMBAT_EXECUTE_MODE,
		listaNativeEnabled: BSC_LISTA_NATIVE_EXECUTE_ENABLED,
		wombatNativeEnabled: BSC_WOMBAT_NATIVE_EXECUTE_ENABLED,
		canExecute,
		reason: canExecute
			? "ok"
			: executionProtocol === "aave"
				? "aave_precheck_failed"
				: executionProtocol === "lista"
					? "lista_precheck_failed"
					: executionProtocol === "wombat"
						? "wombat_precheck_failed"
						: "execute_not_ready",
		blockers: protocolBlockers,
		recommendedProtocol,
		fixPack:
			executionProtocol === "aave" ||
			executionProtocol === "lista" ||
			executionProtocol === "wombat"
				? {
						mode:
							executionProtocol === "aave"
								? BSC_AAVE_EXECUTE_MODE
								: executionProtocol === "lista" ||
										executionProtocol === "wombat"
									? "command"
									: "blocked",
						envLines: fixLines,
						fullTemplate: fullFixPack,
					}
				: null,
	};
	return {
		ok: true,
		chain: "bsc",
		mode: "stable-yield-plan",
		account,
		balances,
		aprHints,
		marketCompare: compare,
		netYieldInsight,
		executionProtocol,
		executeReadiness,
		minAprDeltaBps,
		plan,
	};
}

function parsePositiveRaw(value, fieldName) {
	const text = String(value || "").trim();
	if (!/^\d+$/.test(text) || BigInt(text) <= 0n) {
		throw new Error(`${fieldName} must be a positive integer raw amount`);
	}
	return text;
}

function parsePositiveInt(value, fallback) {
	const n = Number.parseInt(String(value || fallback), 10);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return n;
}

function currentDayKey() {
	return new Date().toISOString().slice(0, 10);
}

function enforceRebalanceGuards({
	amountRaw,
	quoteOutRaw,
	minAmountOutRaw,
	slippageBps,
}) {
	const maxAmountRaw = BigInt(
		process.env.NEAR_REBAL_MAX_AMOUNT_RAW || "5000000",
	);
	const minQuoteOutRaw = BigInt(
		process.env.NEAR_REBAL_MIN_QUOTE_OUT_RAW || "500000",
	);
	const maxSlippageBps = parsePositiveInt(
		process.env.NEAR_REBAL_MAX_SLIPPAGE_BPS,
		100,
	);
	const cooldownSeconds = parsePositiveInt(
		process.env.NEAR_REBAL_COOLDOWN_SECONDS,
		120,
	);
	const dailyMax = parsePositiveInt(process.env.NEAR_REBAL_DAILY_MAX, 6);
	const minEffectiveRate = Number.parseFloat(
		process.env.NEAR_REBAL_MIN_EFFECTIVE_RATE || "0.5",
	);

	const amount = BigInt(amountRaw);
	const quoteOut = BigInt(quoteOutRaw);
	const minOut = BigInt(minAmountOutRaw);
	if (amount > maxAmountRaw) {
		throw new Error(
			`risk guard: amountRaw ${amountRaw} exceeds max ${maxAmountRaw.toString()}`,
		);
	}
	if (quoteOut < minQuoteOutRaw) {
		throw new Error(
			`quote guard: quoteOutRaw ${quoteOutRaw} below minimum ${minQuoteOutRaw.toString()}`,
		);
	}
	if (Number(slippageBps) > maxSlippageBps) {
		throw new Error(
			`risk guard: slippageBps ${slippageBps} exceeds max ${maxSlippageBps}`,
		);
	}
	if (minOut <= 0n || minOut > quoteOut) {
		throw new Error("quote guard: invalid minAmountOutRaw boundary");
	}
	if (Number.isFinite(minEffectiveRate) && minEffectiveRate > 0) {
		const rate = Number(quoteOut) / Number(amount);
		if (Number.isFinite(rate) && rate < minEffectiveRate) {
			throw new Error(
				`quote guard: effective rate ${rate.toFixed(4)} below minimum ${minEffectiveRate.toFixed(4)}`,
			);
		}
	}

	const now = Date.now();
	const day = currentDayKey();
	if (REBALANCE_STATE.dailyWindowDay !== day) {
		REBALANCE_STATE.dailyWindowDay = day;
		REBALANCE_STATE.dailyCount = 0;
	}
	if (REBALANCE_STATE.dailyCount >= dailyMax) {
		throw new Error(`risk guard: daily rebalance limit reached (${dailyMax})`);
	}
	if (
		REBALANCE_STATE.lastExecutedAt > 0 &&
		now - REBALANCE_STATE.lastExecutedAt < cooldownSeconds * 1000
	) {
		throw new Error(
			`risk guard: cooldown active (${cooldownSeconds}s). please retry later.`,
		);
	}
}

function markRebalanceExecuted() {
	const day = currentDayKey();
	if (REBALANCE_STATE.dailyWindowDay !== day) {
		REBALANCE_STATE.dailyWindowDay = day;
		REBALANCE_STATE.dailyCount = 0;
	}
	REBALANCE_STATE.dailyCount += 1;
	REBALANCE_STATE.lastExecutedAt = Date.now();
}

function beginRebalanceRun(runId) {
	if (REBALANCE_STATE.activeRunId && REBALANCE_STATE.activeRunId !== runId) {
		throw new Error(
			`idempotency guard: another rebalance is running (${REBALANCE_STATE.activeRunId})`,
		);
	}
	if (REBALANCE_STATE.recentRuns.has(runId)) {
		const recent = REBALANCE_STATE.recentRuns.get(runId);
		throw new Error(
			`idempotency guard: runId already processed (${recent.status})`,
		);
	}
	REBALANCE_STATE.activeRunId = runId;
}

function endRebalanceRun(runId, status, details = {}) {
	if (REBALANCE_STATE.activeRunId === runId) {
		REBALANCE_STATE.activeRunId = null;
	}
	REBALANCE_STATE.recentRuns.set(runId, {
		status,
		at: new Date().toISOString(),
		...details,
	});
	const entries = [...REBALANCE_STATE.recentRuns.entries()];
	if (entries.length > 30) {
		for (const [key] of entries.slice(0, entries.length - 30)) {
			REBALANCE_STATE.recentRuns.delete(key);
		}
	}
}

function recordRebalanceMetric(entry) {
	REBALANCE_METRICS.recent.unshift({
		timestamp: new Date().toISOString(),
		...entry,
	});
	if (REBALANCE_METRICS.recent.length > 30) {
		REBALANCE_METRICS.recent.length = 30;
	}
	void saveMetricsToDisk();
}

async function executeAction(payload) {
	const accountId = String(payload.accountId || ACCOUNT_ID).trim();
	const nearBin = "near";
	try {
		if (payload.action === "wrap_near") {
			const amountNear = String(payload.amountNear || "1").trim();
			const out = await runCommand(nearBin, [
				"contract",
				"call-function",
				"as-transaction",
				"wrap.near",
				"near_deposit",
				"json-args",
				"{}",
				"prepaid-gas",
				"100 Tgas",
				"attached-deposit",
				`${amountNear} NEAR`,
				"sign-as",
				accountId,
				"network-config",
				"mainnet",
				"sign-with-keychain",
				"send",
			]);
			const txHash = extractTxHash(out);
			const result = {
				ok: true,
				action: payload.action,
				output: out,
				txHash,
				explorerUrl: nearExplorerUrl(txHash),
			};
			pushActionHistory({
				action: payload.action,
				step: payload.step || null,
				accountId,
				status: "success",
				summary: `wrapped ${amountNear} NEAR`,
				txHash,
				explorerUrl: nearExplorerUrl(txHash),
			});
			return result;
		}
		if (payload.action === "supply_usdt_collateral") {
			const amountRaw = String(payload.amountRaw || "1000000").trim();
			const msg = JSON.stringify({
				Execute: {
					actions: [
						{
							IncreaseCollateral: {
								token_id: "usdt.tether-token.near",
								amount: null,
								max_amount: null,
							},
						},
					],
				},
			});
			const args = JSON.stringify({
				receiver_id: BURROW_CONTRACT,
				amount: amountRaw,
				msg,
			});
			const out = await runCommand(nearBin, [
				"contract",
				"call-function",
				"as-transaction",
				"usdt.tether-token.near",
				"ft_transfer_call",
				"json-args",
				args,
				"prepaid-gas",
				"180 Tgas",
				"attached-deposit",
				"1 yoctoNEAR",
				"sign-as",
				accountId,
				"network-config",
				"mainnet",
				"sign-with-keychain",
				"send",
			]);
			const txHash = extractTxHash(out);
			const result = {
				ok: true,
				action: payload.action,
				output: out,
				txHash,
				explorerUrl: nearExplorerUrl(txHash),
			};
			pushActionHistory({
				action: payload.action,
				step: payload.step || null,
				accountId,
				status: "success",
				summary: `supplied ${amountRaw} raw USDt`,
				txHash,
				explorerUrl: nearExplorerUrl(txHash),
			});
			return result;
		}
		if (payload.action === "rebalance_usdt_to_usdce_txn") {
			const chain = String(payload.chain || "near")
				.trim()
				.toLowerCase();
			if (chain === "bsc") {
				const amountRaw = parsePositiveRaw(payload.amountRaw, "amountRaw");
				const slippageBps = Number.parseInt(
					String(payload.slippageBps || "50"),
					10,
				);
				if (
					!Number.isFinite(slippageBps) ||
					slippageBps < 0 ||
					slippageBps > 5000
				) {
					throw new Error("slippageBps must be between 0 and 5000");
				}
				const runId = String(payload.runId || `run-${Date.now()}`).trim();
				const quote = await getBscUsdtUsdcQuote(amountRaw);
				const divergenceBps = Number(quote?.divergenceBps ?? -1);
				if (
					Number.isFinite(divergenceBps) &&
					divergenceBps >= 0 &&
					divergenceBps > BSC_QUOTE_MAX_DIVERGENCE_BPS
				) {
					throw new Error(
						`quote divergence too high: ${divergenceBps}bps > ${BSC_QUOTE_MAX_DIVERGENCE_BPS}bps`,
					);
				}
				const minAmountOutRaw = applySlippage(quote.amountOutRaw, slippageBps);
				const executeResult = await executeBscSwap({
					amountInRaw: amountRaw,
					minAmountOutRaw,
					tokenIn: BSC_USDT,
					tokenOut: BSC_USDC,
					router: BSC_ROUTER_V2,
					rpcUrl: BSC_RPC_URL,
					chainId: BSC_CHAIN_ID,
					runId,
				});
				const mode = executeResult.ok ? "execute" : "plan-only";
				pushActionHistory({
					action: payload.action,
					step: payload.step || null,
					accountId,
					status: executeResult.ok ? "success" : "warning",
					summary: executeResult.ok
						? `BSC executed amountIn=${amountRaw} minOut=${minAmountOutRaw}`
						: `BSC plan prepared amountIn=${amountRaw} quoteOut=${quote.amountOutRaw} minOut=${minAmountOutRaw} reason=${executeResult.reason}`,
					txHash: executeResult.txHash || null,
				});
				recordRebalanceMetric({
					runId,
					status: executeResult.ok ? "bsc-executed" : "bsc-plan",
					amountRaw,
					suppliedRaw: quote.amountOutRaw,
					note: executeResult.ok
						? `bsc execution success provider=${executeResult.provider || "unknown"}`
						: `execution fallback: ${executeResult.reason}`,
				});
				return {
					ok: true,
					action: payload.action,
					chain: "bsc",
					mode,
					txHash: executeResult.txHash || null,
					explorerUrl: executeResult.txHash
						? `https://bscscan.com/tx/${executeResult.txHash}`
						: null,
					execution: executeResult.ok
						? {
								provider: executeResult.provider || "unknown",
								output: executeResult.output,
								receipt: executeResult.receipt || null,
							}
						: {
								provider: "none",
								reason: executeResult.reason,
							},
					plan: {
						rpcUrl: BSC_RPC_URL,
						chainId: BSC_CHAIN_ID,
						router: BSC_ROUTER_V2,
						tokenIn: BSC_USDT,
						tokenOut: BSC_USDC,
						amountInRaw: amountRaw,
						quotedOutRaw: quote.amountOutRaw,
						minAmountOutRaw,
						quoteSource: quote.source,
						quoteRate: quote.rate,
						quotePairAddress: quote.pairAddress,
						quoteLiquidityUsd: quote.liquidityUsd,
						quoteDivergenceBps: quote.divergenceBps ?? null,
						dexAmountOutRaw: quote.dexAmountOutRaw || null,
						pancakeV2AmountOutRaw:
							quote.pancakeV2AmountOutRaw || quote.onchainAmountOutRaw || null,
						onchainAmountOutRaw: quote.onchainAmountOutRaw || null,
						slippageBps,
						next: executeResult.ok
							? ["optional lend supply adapter"]
							: [
									"set BSC_EXECUTE_ENABLED=true",
									"prefer BSC_EXECUTE_MODE=native + BSC_EXECUTE_PRIVATE_KEY",
									"or set BSC_EXECUTE_MODE=command + BSC_EXECUTE_COMMAND",
									"retry execute",
								],
					},
				};
			}
			if (chain !== "near") {
				throw new Error(`unsupported chain '${chain}'`);
			}
			const stepBase = String(payload.step || "rebalance").trim();
			const runId = String(payload.runId || `run-${Date.now()}`).trim();
			beginRebalanceRun(runId);
			REBALANCE_METRICS.totalRuns += 1;
			try {
				const amountRaw = parsePositiveRaw(payload.amountRaw, "amountRaw");
				const stateBefore = await snapshotRebalanceState(accountId);
				const poolId = Number.parseInt(String(payload.poolId || "3725"), 10);
				const slippageBps = Number.parseInt(
					String(payload.slippageBps || "50"),
					10,
				);
				if (!Number.isFinite(poolId) || poolId < 0) {
					throw new Error("poolId must be a non-negative integer");
				}
				if (
					!Number.isFinite(slippageBps) ||
					slippageBps < 0 ||
					slippageBps > 5000
				) {
					throw new Error("slippageBps must be between 0 and 5000");
				}

				const usdcToken =
					"a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near";
				const usdtToken = "usdt.tether-token.near";
				const refContract = "v2.ref-finance.near";

				const usdcBeforeRaw = String(
					(await viewFunction(usdcToken, "ft_balance_of", {
						account_id: accountId,
					})) || "0",
				);

				const withdrawArgs = JSON.stringify({
					token_id: usdtToken,
					amount: amountRaw,
					recipient_id: accountId,
				});
				const step1 = await runNearCommandWithRpcFallback([
					"contract",
					"call-function",
					"as-transaction",
					BURROW_CONTRACT,
					"simple_withdraw",
					"json-args",
					withdrawArgs,
					"prepaid-gas",
					"250 Tgas",
					"attached-deposit",
					"1 yoctoNEAR",
					"sign-as",
					accountId,
					"network-config",
					"mainnet",
					"sign-with-keychain",
					"send",
				]);
				const step1Tx = extractTxHash(step1.output);
				pushActionHistory({
					action: payload.action,
					step: `${stepBase}-step1`,
					accountId,
					status: "success",
					summary: `withdraw ${amountRaw} raw USDt from Burrow`,
					txHash: step1Tx,
					explorerUrl: nearExplorerUrl(step1Tx),
				});

				const refQuoteOutRaw = String(
					await viewFunction(refContract, "get_return", {
						pool_id: poolId,
						token_in: usdtToken,
						amount_in: amountRaw,
						token_out: usdcToken,
					}),
				);
				const minAmountOutRaw = parsePositiveRaw(
					payload.minAmountOutRaw || applySlippage(refQuoteOutRaw, slippageBps),
					"minAmountOutRaw",
				);
				enforceRebalanceGuards({
					amountRaw,
					quoteOutRaw: refQuoteOutRaw,
					minAmountOutRaw,
					slippageBps,
				});

				const swapMsg = JSON.stringify({
					force: 0,
					actions: [
						{
							pool_id: poolId,
							token_in: usdtToken,
							amount_in: amountRaw,
							token_out: usdcToken,
							min_amount_out: minAmountOutRaw,
						},
					],
				});
				const swapArgs = JSON.stringify({
					receiver_id: refContract,
					amount: amountRaw,
					msg: swapMsg,
				});

				let step2;
				let step2Tx = null;
				try {
					step2 = await runNearCommandWithRpcFallback([
						"contract",
						"call-function",
						"as-transaction",
						usdtToken,
						"ft_transfer_call",
						"json-args",
						swapArgs,
						"prepaid-gas",
						"180 Tgas",
						"attached-deposit",
						"1 yoctoNEAR",
						"sign-as",
						accountId,
						"network-config",
						"mainnet",
						"sign-with-keychain",
						"send",
					]);
					step2Tx = extractTxHash(step2.output);
					pushActionHistory({
						action: payload.action,
						step: `${stepBase}-step2`,
						accountId,
						status: "success",
						summary: `swap ${amountRaw} raw USDt -> USDC.e`,
						txHash: step2Tx,
						explorerUrl: nearExplorerUrl(step2Tx),
					});
				} catch (error) {
					const rollbackMsg = JSON.stringify({
						Execute: {
							actions: [
								{
									IncreaseCollateral: {
										token_id: usdtToken,
										amount: null,
										max_amount: null,
									},
								},
							],
						},
					});
					const rollbackArgs = JSON.stringify({
						receiver_id: BURROW_CONTRACT,
						amount: amountRaw,
						msg: rollbackMsg,
					});
					const rollback = await runNearCommandWithRpcFallback([
						"contract",
						"call-function",
						"as-transaction",
						usdtToken,
						"ft_transfer_call",
						"json-args",
						rollbackArgs,
						"prepaid-gas",
						"180 Tgas",
						"attached-deposit",
						"1 yoctoNEAR",
						"sign-as",
						accountId,
						"network-config",
						"mainnet",
						"sign-with-keychain",
						"send",
					]);
					const rollbackTx = extractTxHash(rollback.output);
					pushActionHistory({
						action: payload.action,
						step: `${stepBase}-rollback`,
						accountId,
						status: "success",
						summary: `step2 failed, rolled back ${amountRaw} raw USDt to Burrow`,
						txHash: rollbackTx,
						explorerUrl: nearExplorerUrl(rollbackTx),
					});
					REBALANCE_METRICS.rollbackRuns += 1;
					recordRebalanceMetric({
						runId,
						status: "rollback",
						amountRaw,
						rollbackTx,
					});
					await sendAlert({
						level: "warn",
						title: "Rebalance rollback",
						message: `runId=${runId} step2 failed, rollback executed. rollbackTx=${rollbackTx || "n/a"}`,
					});
					throw new Error(
						`step2 swap failed and rollback completed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}

				const usdcAfterRaw = String(
					(await viewFunction(usdcToken, "ft_balance_of", {
						account_id: accountId,
					})) || "0",
				);
				const delta = (BigInt(usdcAfterRaw) - BigInt(usdcBeforeRaw)).toString();
				const supplyOutRaw = BigInt(delta) > 0n ? delta : minAmountOutRaw;

				const supplyUsdcMsg = JSON.stringify({
					Execute: {
						actions: [
							{
								IncreaseCollateral: {
									token_id: usdcToken,
									amount: null,
									max_amount: null,
								},
							},
						],
					},
				});
				const supplyUsdcArgs = JSON.stringify({
					receiver_id: BURROW_CONTRACT,
					amount: supplyOutRaw,
					msg: supplyUsdcMsg,
				});
				const step3 = await runNearCommandWithRpcFallback([
					"contract",
					"call-function",
					"as-transaction",
					usdcToken,
					"ft_transfer_call",
					"json-args",
					supplyUsdcArgs,
					"prepaid-gas",
					"180 Tgas",
					"attached-deposit",
					"1 yoctoNEAR",
					"sign-as",
					accountId,
					"network-config",
					"mainnet",
					"sign-with-keychain",
					"send",
				]);
				const step3Tx = extractTxHash(step3.output);
				pushActionHistory({
					action: payload.action,
					step: `${stepBase}-step3`,
					accountId,
					status: "success",
					summary: `supplied ${supplyOutRaw} raw USDC.e to Burrow`,
					txHash: step3Tx,
					explorerUrl: nearExplorerUrl(step3Tx),
				});
				const stateAfter = await snapshotRebalanceState(accountId);
				const walletUsdtAfter = BigInt(stateAfter.walletUsdtRaw || "0");
				const walletUsdcAfter = BigInt(stateAfter.walletUsdcRaw || "0");
				const reconciled = walletUsdtAfter <= 10n && walletUsdcAfter <= 10n;
				const quoteRate = Number(refQuoteOutRaw) / Number(amountRaw);
				const execRate = Number(supplyOutRaw) / Number(amountRaw);
				const slippageUsedBps =
					Number(refQuoteOutRaw) > 0
						? Math.max(
								0,
								((Number(refQuoteOutRaw) - Number(supplyOutRaw)) /
									Number(refQuoteOutRaw)) *
									10000,
							)
						: null;
				REBALANCE_METRICS.successRuns += 1;
				if (!reconciled) REBALANCE_METRICS.reconcileWarnings += 1;
				recordRebalanceMetric({
					runId,
					status: "success",
					amountRaw,
					suppliedRaw: supplyOutRaw,
					quoteRate: Number.isFinite(quoteRate) ? quoteRate : null,
					execRate: Number.isFinite(execRate) ? execRate : null,
					slippageUsedBps:
						typeof slippageUsedBps === "number" &&
						Number.isFinite(slippageUsedBps)
							? slippageUsedBps
							: null,
					reconciled,
				});
				const beforeTotalStable =
					stateBefore.collateralUsdtAmount + stateBefore.collateralUsdcAmount;
				const afterTotalStable =
					stateAfter.collateralUsdtAmount + stateAfter.collateralUsdcAmount;
				REBALANCE_METRICS.pnlSeries.unshift({
					timestamp: new Date().toISOString(),
					runId,
					beforeTotalStable,
					afterTotalStable,
					deltaStable: afterTotalStable - beforeTotalStable,
				});
				if (REBALANCE_METRICS.pnlSeries.length > 100) {
					REBALANCE_METRICS.pnlSeries.length = 100;
				}
				void saveMetricsToDisk();
				markRebalanceExecuted();
				endRebalanceRun(runId, "success", {
					step1Tx,
					step2Tx,
					step3Tx,
					reconciled,
				});
				pushActionHistory({
					action: payload.action,
					step: `${stepBase}-reconcile`,
					accountId,
					status: reconciled ? "success" : "error",
					summary: reconciled
						? "reconciliation passed (wallet residuals near zero)"
						: `reconciliation warning: wallet residuals usdt=${stateAfter.walletUsdtRaw} usdc=${stateAfter.walletUsdcRaw}`,
				});
				if (!reconciled) {
					await sendAlert({
						level: "warn",
						title: "Rebalance reconciliation warning",
						message: `runId=${runId} residual wallet balances usdt=${stateAfter.walletUsdtRaw} usdc=${stateAfter.walletUsdcRaw}`,
					});
				}
				await sendAlert({
					level: "info",
					title: "Rebalance success",
					message: `runId=${runId} amountRaw=${amountRaw} suppliedRaw=${supplyOutRaw} reconciled=${reconciled}`,
				});

				return {
					ok: true,
					action: payload.action,
					step: stepBase,
					runId,
					summary: "rebalance completed",
					details: {
						amountRaw,
						minAmountOutRaw,
						suppliedRaw: supplyOutRaw,
						step1Tx,
						step2Tx,
						step3Tx,
						reconciliation: {
							reconciled,
							before: stateBefore,
							after: stateAfter,
						},
					},
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				REBALANCE_METRICS.failedRuns += 1;
				recordRebalanceMetric({
					runId,
					status: "failed",
					error: msg,
				});
				endRebalanceRun(runId, "failed", {
					error: msg,
				});
				await sendAlert({
					level: "error",
					title: "Rebalance failed",
					message: `runId=${runId} error=${msg}`,
				});
				throw error;
			}
		}
		throw new Error(`Unsupported action: ${payload.action}`);
	} catch (error) {
		pushActionHistory({
			action: payload.action,
			step: payload.step || null,
			accountId,
			status: "error",
			summary: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

async function runBscYieldWorkerTick() {
	const planSnapshot = await computeBscYieldPlan({
		account: BSC_EXECUTE_RECIPIENT,
		targetUsdcBps: BSC_YIELD_WORKER.targetUsdcBps,
		minDriftBps: BSC_YIELD_WORKER.minDriftBps,
		minAprDeltaBps: BSC_YIELD_WORKER.minAprDeltaBps,
		maxStepUsd: BSC_YIELD_WORKER.maxStepUsd,
	});
	BSC_YIELD_WORKER.lastPlan = planSnapshot;
	BSC_YIELD_WORKER.lastRunAt = new Date().toISOString();
	if (planSnapshot?.plan?.action !== "rebalance_usdt_to_usdc") return;
	if (planSnapshot?.executeReadiness?.canExecute !== true) {
		BSC_YIELD_WORKER.lastExecute = {
			dryRun: BSC_YIELD_WORKER.dryRun,
			blocked: true,
			reason: planSnapshot?.executeReadiness?.reason || "execute_not_ready",
			timestamp: new Date().toISOString(),
		};
		return;
	}
	if (BSC_YIELD_WORKER.dryRun) {
		BSC_YIELD_WORKER.lastExecute = {
			dryRun: true,
			recommendedAmountRaw: planSnapshot.plan.recommendedAmountRaw,
			timestamp: new Date().toISOString(),
		};
		return;
	}
	const actionResult = await executeAction({
		action: "rebalance_usdt_to_usdce_txn",
		chain: "bsc",
		amountRaw: planSnapshot.plan.recommendedAmountRaw,
		slippageBps: 50,
		runId: `bsc-yield-${Date.now()}`,
		step: "bsc-stable-yield-agent",
	});
	BSC_YIELD_WORKER.lastExecute = {
		dryRun: false,
		timestamp: new Date().toISOString(),
		result: actionResult,
	};
}

function stopBscYieldWorker() {
	if (BSC_YIELD_WORKER.timer) {
		clearInterval(BSC_YIELD_WORKER.timer);
		BSC_YIELD_WORKER.timer = null;
	}
	BSC_YIELD_WORKER.running = false;
}

function startBscYieldWorker(options = {}) {
	stopBscYieldWorker();
	BSC_YIELD_WORKER.running = true;
	BSC_YIELD_WORKER.dryRun = options.dryRun !== false;
	BSC_YIELD_WORKER.intervalMs = Math.max(
		30_000,
		Number.parseInt(
			String(options.intervalMs || BSC_YIELD_WORKER.intervalMs),
			10,
		) || BSC_YIELD_WORKER.intervalMs,
	);
	BSC_YIELD_WORKER.maxStepUsd = Math.max(
		1,
		Number.parseFloat(
			String(options.maxStepUsd || BSC_YIELD_WORKER.maxStepUsd),
		) || BSC_YIELD_WORKER.maxStepUsd,
	);
	BSC_YIELD_WORKER.minDriftBps = Math.max(
		0,
		Number.parseInt(
			String(options.minDriftBps || BSC_YIELD_WORKER.minDriftBps),
			10,
		) || BSC_YIELD_WORKER.minDriftBps,
	);
	BSC_YIELD_WORKER.minAprDeltaBps = Math.max(
		0,
		Number.parseInt(
			String(options.minAprDeltaBps || BSC_YIELD_WORKER.minAprDeltaBps),
			10,
		) || BSC_YIELD_WORKER.minAprDeltaBps,
	);
	BSC_YIELD_WORKER.targetUsdcBps = Math.max(
		0,
		Math.min(
			10_000,
			Number.parseInt(
				String(options.targetUsdcBps || BSC_YIELD_WORKER.targetUsdcBps),
				10,
			) || BSC_YIELD_WORKER.targetUsdcBps,
		),
	);
	BSC_YIELD_WORKER.lastError = null;
	const tick = async () => {
		try {
			await runBscYieldWorkerTick();
		} catch (error) {
			BSC_YIELD_WORKER.lastError =
				error instanceof Error ? error.message : String(error);
		}
	};
	void tick();
	BSC_YIELD_WORKER.timer = setInterval(() => {
		void tick();
	}, BSC_YIELD_WORKER.intervalMs);
}

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url || "/", `http://${req.headers.host}`);

		if (url.pathname === "/api/health") {
			return json(res, 200, {
				ok: true,
				rpcCandidates: RPC_ENDPOINTS,
				accountId: ACCOUNT_ID,
			});
		}

		if (url.pathname === "/api/snapshot") {
			const accountId = url.searchParams.get("accountId") || ACCOUNT_ID;
			const snapshot = await buildSnapshot(accountId);
			return json(res, 200, snapshot);
		}

		if (url.pathname === "/api/acp/status") {
			try {
				const [whoami, wallet] = await Promise.all([
					runAcpJson(["whoami"]),
					runAcpJson(["wallet", "balance"]),
				]);
				return json(res, 200, {
					ok: true,
					bin: ACP_BIN,
					workdir: ACP_WORKDIR,
					whoami,
					wallet,
				});
			} catch (error) {
				return json(res, 200, {
					ok: false,
					bin: ACP_BIN,
					workdir: ACP_WORKDIR,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		if (url.pathname === "/api/portfolio/unified") {
			const accountId = url.searchParams.get("accountId") || ACCOUNT_ID;
			const portfolio = await buildUnifiedPortfolio(accountId);
			return json(res, 200, {
				ok: true,
				portfolio,
			});
		}

		if (url.pathname === "/api/policy") {
			if (req.method === "GET") {
				return json(res, 200, { ok: true, policy: PORTFOLIO_POLICY });
			}
			if (req.method === "POST") {
				const chunks = [];
				for await (const chunk of req) chunks.push(chunk);
				const text = Buffer.concat(chunks).toString("utf8") || "{}";
				const payload = JSON.parse(text);
				if (payload.confirm !== true) {
					return json(res, 400, { ok: false, error: "Missing confirm=true" });
				}
				if (
					payload.targetAllocation &&
					typeof payload.targetAllocation === "object"
				) {
					PORTFOLIO_POLICY.targetAllocation = {
						...PORTFOLIO_POLICY.targetAllocation,
						...payload.targetAllocation,
					};
				}
				if (payload.constraints && typeof payload.constraints === "object") {
					PORTFOLIO_POLICY.constraints = {
						...PORTFOLIO_POLICY.constraints,
						...payload.constraints,
					};
				}
				if (payload.monetization && typeof payload.monetization === "object") {
					PORTFOLIO_POLICY.monetization = {
						...PORTFOLIO_POLICY.monetization,
						...payload.monetization,
					};
				}
				await savePolicyToDisk();
				return json(res, 200, { ok: true, policy: PORTFOLIO_POLICY });
			}
		}

		if (url.pathname === "/api/strategies/validate" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			const dslCandidate = payload.dsl
				? payload.dsl
				: buildStrategyDslFromLegacy(payload);
			const validation = validateStrategyDslV1(dslCandidate);
			if (!validation.ok) {
				return json(res, 200, {
					ok: false,
					phase: "schema",
					errors: validation.errors,
					warnings: validation.warnings || [],
				});
			}
			const semantic = validateStrategySemanticV1(
				validation.normalized,
				PORTFOLIO_POLICY,
			);
			if (!semantic.ok) {
				return json(res, 200, {
					ok: false,
					phase: "semantic",
					errors: semantic.errors,
					warnings: [
						...(validation.warnings || []),
						...(semantic.warnings || []),
					],
					normalized: validation.normalized,
				});
			}
			return json(res, 200, {
				ok: true,
				phase: "ready",
				errors: [],
				warnings: [
					...(validation.warnings || []),
					...(semantic.warnings || []),
				],
				normalized: validation.normalized,
			});
		}

		if (url.pathname === "/api/strategies") {
			if (req.method === "GET") {
				return json(res, 200, { ok: true, strategies: STRATEGY_CATALOG });
			}
			if (req.method === "POST") {
				const chunks = [];
				for await (const chunk of req) chunks.push(chunk);
				const text = Buffer.concat(chunks).toString("utf8") || "{}";
				const payload = JSON.parse(text);
				if (payload.confirm !== true) {
					return json(res, 400, { ok: false, error: "Missing confirm=true" });
				}
				const dslCandidate = payload.dsl
					? payload.dsl
					: buildStrategyDslFromLegacy(payload);
				const validation = validateStrategyDslV1(dslCandidate);
				if (!validation.ok) {
					return json(res, 400, {
						ok: false,
						error: "strategy dsl validation failed",
						errors: validation.errors,
						warnings: validation.warnings,
					});
				}
				const normalized = validation.normalized;
				const semantic = validateStrategySemanticV1(
					normalized,
					PORTFOLIO_POLICY,
				);
				if (!semantic.ok) {
					return json(res, 400, {
						ok: false,
						error: "strategy semantic validation failed",
						errors: semantic.errors,
						warnings: [
							...(validation.warnings || []),
							...(semantic.warnings || []),
						],
					});
				}
				const row = {
					id: normalized.id,
					name: normalized.name,
					creator: normalized.creator,
					priceUsd: normalized.pricing.priceUsd,
					targetChain: normalized.targetChain,
					intentType: normalized.intentType,
					riskProfile: payload.riskProfile || "balanced",
					dslVersion: normalized.version,
					dsl: normalized,
					validation: {
						ok: true,
						warnings: [
							...(validation.warnings || []),
							...(semantic.warnings || []),
						],
						validatedAt: new Date().toISOString(),
					},
					updatedAt: new Date().toISOString(),
				};
				const idx = STRATEGY_CATALOG.findIndex((x) => x.id === row.id);
				if (idx >= 0) STRATEGY_CATALOG[idx] = row;
				else STRATEGY_CATALOG.unshift(row);
				if (STRATEGY_CATALOG.length > 200) STRATEGY_CATALOG.length = 200;
				await saveMarketplaceToDisk();
				return json(res, 200, { ok: true, strategy: row });
			}
		}

		if (url.pathname === "/api/payments/create" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const strategyId = String(payload.strategyId || "").trim();
			const buyer = String(payload.buyer || "").trim() || "anonymous";
			const strategy = STRATEGY_CATALOG.find((x) => x.id === strategyId);
			if (!strategy) {
				return json(res, 404, {
					ok: false,
					error: `strategy '${strategyId}' not found`,
				});
			}
			const paymentId = String(payload.paymentId || `pay-${Date.now()}`).trim();
			const payment = {
				paymentId,
				strategyId,
				strategyName: strategy.name,
				buyer,
				amountUsd: Number(strategy.priceUsd || 0),
				currency: PORTFOLIO_POLICY?.monetization?.settlementToken || "USDC",
				status: "pending",
				provider: payload.provider || "manual",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			STRATEGY_PAYMENTS.unshift(payment);
			if (STRATEGY_PAYMENTS.length > 1000) STRATEGY_PAYMENTS.length = 1000;
			await saveMarketplaceToDisk();
			return json(res, 200, { ok: true, payment });
		}

		if (url.pathname === "/api/payments/confirm" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const out = applyPaymentStatusUpdate(payload, "manual-confirm");
			if (!out.ok) return json(res, out.status || 400, out);
			await saveMarketplaceToDisk();
			return json(res, 200, out);
		}

		if (url.pathname === "/api/payments/webhook" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const rawText = Buffer.concat(chunks).toString("utf8") || "{}";
			const signature =
				req.headers["x-payment-signature"] ||
				req.headers["x-openclaw-signature"];
			if (!verifyPaymentWebhookSignature(rawText, signature)) {
				PAYMENT_WEBHOOK_METRICS.rejected += 1;
				PAYMENT_WEBHOOK_METRICS.lastEventAt = new Date().toISOString();
				PAYMENT_WEBHOOK_METRICS.lastError = "invalid_signature";
				void saveMetricsToDisk();
				return json(res, 401, {
					ok: false,
					error: "Invalid webhook signature",
				});
			}
			const payload = JSON.parse(rawText);
			const providerHint = String(
				url.searchParams.get("provider") ||
					req.headers["x-payment-provider"] ||
					PAYMENT_WEBHOOK_PROVIDER ||
					"generic",
			)
				.trim()
				.toLowerCase();
			const normalized = normalizeWebhookPayload(payload, providerHint);
			if (!normalized.paymentId) {
				PAYMENT_WEBHOOK_METRICS.rejected += 1;
				PAYMENT_WEBHOOK_METRICS.lastEventAt = new Date().toISOString();
				PAYMENT_WEBHOOK_METRICS.lastProvider = normalized.provider || null;
				PAYMENT_WEBHOOK_METRICS.lastError = "missing_payment_id";
				void saveMetricsToDisk();
				return json(res, 400, {
					ok: false,
					error: "Missing paymentId in webhook payload",
				});
			}
			if (normalized.eventId && isWebhookEventProcessed(normalized.eventId)) {
				PAYMENT_WEBHOOK_METRICS.idempotent += 1;
				PAYMENT_WEBHOOK_METRICS.lastEventAt = new Date().toISOString();
				PAYMENT_WEBHOOK_METRICS.lastProvider = normalized.provider || null;
				void saveMetricsToDisk();
				return json(res, 200, {
					ok: true,
					idempotent: true,
					eventId: normalized.eventId,
					reason: "event_already_processed",
				});
			}
			const out = applyPaymentStatusUpdate(
				{
					paymentId: normalized.paymentId,
					status: normalized.status,
					paid: payload?.paid,
					txRef: normalized.txRef,
					eventId: normalized.eventId,
					entitlementUses: payload?.entitlementUses,
					entitlementDays: payload?.entitlementDays,
				},
				`provider-webhook:${normalized.provider}`,
			);
			if (!out.ok) {
				PAYMENT_WEBHOOK_METRICS.rejected += 1;
				PAYMENT_WEBHOOK_METRICS.lastEventAt = new Date().toISOString();
				PAYMENT_WEBHOOK_METRICS.lastProvider = normalized.provider || null;
				PAYMENT_WEBHOOK_METRICS.lastError = out.error || "status_update_failed";
				void saveMetricsToDisk();
				return json(res, out.status || 400, out);
			}
			if (normalized.eventId) {
				markWebhookEventProcessed({
					eventId: normalized.eventId,
					paymentId: normalized.paymentId,
					status: normalized.status,
					source: normalized.provider,
				});
			}
			PAYMENT_WEBHOOK_METRICS.accepted += 1;
			PAYMENT_WEBHOOK_METRICS.lastEventAt = new Date().toISOString();
			PAYMENT_WEBHOOK_METRICS.lastProvider = normalized.provider || null;
			PAYMENT_WEBHOOK_METRICS.lastError = null;
			await saveMarketplaceToDisk();
			void saveMetricsToDisk();
			return json(res, 200, {
				ok: true,
				idempotent: false,
				eventId: normalized.eventId,
				provider: normalized.provider,
				...out,
			});
		}

		if (url.pathname === "/api/payments") {
			return json(res, 200, { ok: true, payments: STRATEGY_PAYMENTS });
		}

		if (url.pathname === "/api/strategies/purchase" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const strategyId = String(payload.strategyId || "").trim();
			const buyer = String(payload.buyer || "").trim() || "anonymous";
			const strategy = STRATEGY_CATALOG.find((x) => x.id === strategyId);
			if (!strategy) {
				return json(res, 404, {
					ok: false,
					error: `strategy '${strategyId}' not found`,
				});
			}
			const entitlementUses = Math.max(
				1,
				Number.parseInt(String(payload.entitlementUses || 30), 10) || 30,
			);
			const entitlementDays = Math.max(
				1,
				Number.parseInt(String(payload.entitlementDays || 30), 10) || 30,
			);
			const takeRate = Number(
				PORTFOLIO_POLICY?.monetization?.platformTakeRate || 0.15,
			);
			const amountUsd = Number(strategy.priceUsd || 0);
			const platformFeeUsd = amountUsd * takeRate;
			const creatorPayoutUsd = amountUsd - platformFeeUsd;
			const expiresAt = new Date(
				Date.now() + entitlementDays * 24 * 60 * 60 * 1000,
			).toISOString();
			const receipt = {
				id: `purchase-${Date.now()}`,
				strategyId,
				strategyName: strategy.name,
				buyer,
				amountUsd,
				settlementToken:
					PORTFOLIO_POLICY?.monetization?.settlementToken || "USDC",
				platformTakeRate: takeRate,
				platformFeeUsd,
				creatorPayoutUsd,
				entitlementUses,
				entitlementDays,
				expiresAt,
				createdAt: new Date().toISOString(),
			};
			const entitlement = grantStrategyEntitlement({
				strategyId,
				buyer,
				uses: entitlementUses,
				expiresAt,
				sourceReceiptId: receipt.id,
			});
			STRATEGY_PURCHASES.unshift(receipt);
			if (STRATEGY_PURCHASES.length > 500) STRATEGY_PURCHASES.length = 500;
			await saveMarketplaceToDisk();
			return json(res, 200, { ok: true, receipt, entitlement });
		}

		if (url.pathname === "/api/strategies/purchases") {
			return json(res, 200, { ok: true, purchases: STRATEGY_PURCHASES });
		}

		if (url.pathname === "/api/strategies/entitlements") {
			const buyer = String(url.searchParams.get("buyer") || "").trim();
			const strategyId = String(
				url.searchParams.get("strategyId") || "",
			).trim();
			const rows = STRATEGY_ENTITLEMENTS.filter((row) => {
				if (buyer && String(row?.buyer || "") !== buyer) return false;
				if (strategyId && String(row?.strategyId || "") !== strategyId)
					return false;
				return true;
			});
			return json(res, 200, { ok: true, entitlements: rows });
		}

		if (url.pathname === "/api/acp/route-preview" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			const plan = buildAcpExecutionPlan(payload);
			return json(res, 200, {
				ok: true,
				identityChain: "base",
				plan,
			});
		}

		if (url.pathname === "/api/acp/job/submit" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const job = enqueueAcpAsyncJob(payload);
			return json(res, 200, {
				ok: true,
				jobId: job.jobId,
				status: job.status,
				createdAt: job.createdAt,
			});
		}

		if (url.pathname === "/api/acp/job/execute" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const result = await executeAcpJob(payload);
			return json(res, 200, result);
		}

		if (url.pathname === "/api/acp/jobs/dead-letter") {
			const deadLetters = ACP_ASYNC_JOBS.filter(
				(row) => String(row?.status || "") === "dead-letter",
			).map((row) => {
				const errorType = classifyAcpErrorType(row?.error || "");
				const retryable = isAcpRetryableError(row?.error || "");
				return {
					jobId: row.jobId,
					status: row.status,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
					attemptCount: Number(row.attemptCount || 0),
					maxAttempts: Number(row.maxAttempts || 3),
					lastErrorAt: row.lastErrorAt || null,
					errorType,
					retryable,
					error: row.error,
				};
			});
			return json(res, 200, { ok: true, deadLetters });
		}

		if (url.pathname === "/api/acp/jobs/dismissed") {
			const dismissed = ACP_ASYNC_JOBS.filter(
				(row) => String(row?.status || "") === "dismissed",
			).map((row) => ({
				jobId: row.jobId,
				status: row.status,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
				dismissedAt: row.dismissedAt || null,
				attemptCount: Number(row.attemptCount || 0),
				maxAttempts: Number(row.maxAttempts || 3),
				lastErrorAt: row.lastErrorAt || null,
				error: row.error,
			}));
			return json(res, 200, { ok: true, dismissed });
		}

		if (
			url.pathname === "/api/acp/jobs/dismissed/purge" &&
			req.method === "POST"
		) {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const olderThanDays = Math.max(
				0,
				Number.parseInt(String(payload.olderThanDays || 7), 10) || 7,
			);
			const out = purgeDismissedAcpJobs(olderThanDays);
			return json(res, 200, {
				ok: true,
				olderThanDays,
				removed: out.removed,
				retained: out.retained,
			});
		}

		if (url.pathname === "/api/acp/jobs/retry" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const jobId = String(payload.jobId || "").trim();
			if (!jobId) {
				return json(res, 400, { ok: false, error: "Missing jobId" });
			}
			const row = retryAcpAsyncJob(jobId);
			if (!row) {
				return json(res, 404, { ok: false, error: `job '${jobId}' not found` });
			}
			return json(res, 200, {
				ok: true,
				job: {
					jobId: row.jobId,
					status: row.status,
					updatedAt: row.updatedAt,
					attemptCount: Number(row.attemptCount || 0),
					maxAttempts: Number(row.maxAttempts || 3),
				},
			});
		}

		if (url.pathname === "/api/acp/jobs/retry-batch" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const ids = Array.isArray(payload.jobIds)
				? payload.jobIds.map((v) => String(v || "").trim()).filter(Boolean)
				: [];
			if (ids.length === 0) {
				return json(res, 400, { ok: false, error: "Missing jobIds[]" });
			}
			const retried = [];
			for (const id of ids) {
				const row = retryAcpAsyncJob(id);
				if (row) retried.push(id);
			}
			return json(res, 200, { ok: true, requested: ids.length, retried });
		}

		if (url.pathname === "/api/acp/jobs/dismiss" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const ids = Array.isArray(payload.jobIds)
				? payload.jobIds.map((v) => String(v || "").trim()).filter(Boolean)
				: [];
			if (ids.length === 0) {
				return json(res, 400, { ok: false, error: "Missing jobIds[]" });
			}
			const dismissed = [];
			for (const id of ids) {
				const row = dismissAcpAsyncJob(id);
				if (row) dismissed.push(id);
			}
			return json(res, 200, { ok: true, requested: ids.length, dismissed });
		}

		if (
			url.pathname === "/api/acp/jobs/retry-retryable" &&
			req.method === "POST"
		) {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const retryableRows = ACP_ASYNC_JOBS.filter((row) => {
				if (String(row?.status || "") !== "dead-letter") return false;
				return isAcpRetryableError(row?.error || "");
			});
			const retried = [];
			for (const row of retryableRows) {
				const out = retryAcpAsyncJob(row.jobId);
				if (out) retried.push(row.jobId);
			}
			return json(res, 200, {
				ok: true,
				retried,
				retriedCount: retried.length,
				retryableCount: retryableRows.length,
			});
		}

		if (url.pathname.startsWith("/api/acp/jobs/")) {
			const jobId = decodeURIComponent(
				url.pathname.replace("/api/acp/jobs/", ""),
			);
			const row = getAcpAsyncJobById(jobId);
			if (!row) {
				return json(res, 404, { ok: false, error: `job '${jobId}' not found` });
			}
			return json(res, 200, {
				ok: true,
				job: {
					jobId: row.jobId,
					status: row.status,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
					attemptCount: Number(row.attemptCount || 0),
					maxAttempts: Number(row.maxAttempts || 3),
					nextAttemptAt: row.nextAttemptAt || null,
					lastErrorAt: row.lastErrorAt || null,
					result: row.result,
					error: row.error,
				},
			});
		}

		if (url.pathname === "/api/acp/jobs") {
			return json(res, 200, {
				ok: true,
				jobs: ACP_JOB_HISTORY,
				queue: ACP_ASYNC_JOBS.map((row) => ({
					jobId: row.jobId,
					status: row.status,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
					attemptCount: Number(row.attemptCount || 0),
					maxAttempts: Number(row.maxAttempts || 3),
					nextAttemptAt: row.nextAttemptAt || null,
					lastErrorAt: row.lastErrorAt || null,
					error: row.error,
				})),
			});
		}

		if (url.pathname === "/api/acp/jobs/summary") {
			const byStatus = ACP_JOB_HISTORY.reduce((acc, row) => {
				const key = String(row?.status || "unknown");
				acc[key] = (acc[key] || 0) + 1;
				return acc;
			}, {});
			const queueByStatus = ACP_ASYNC_JOBS.reduce((acc, row) => {
				const key = String(row?.status || "unknown");
				acc[key] = (acc[key] || 0) + 1;
				return acc;
			}, {});
			return json(res, 200, {
				ok: true,
				summary: {
					total: ACP_JOB_HISTORY.length,
					byStatus,
					queue: {
						total: ACP_ASYNC_JOBS.length,
						byStatus: queueByStatus,
					},
					dailyState: ACP_JOB_STATE,
					policyDailyLimit: Number(
						PORTFOLIO_POLICY?.constraints?.maxDailyRebalanceRuns || 10,
					),
				},
			});
		}

		if (url.pathname === "/api/ops/ci-signatures") {
			const limit = Math.min(
				200,
				Math.max(1, Number.parseInt(url.searchParams.get("limit") || "50", 10)),
			);
			try {
				const raw = await readFile(CI_SIGNATURES_PATH, "utf8");
				const rows = String(raw || "")
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean)
					.map((line) => {
						try {
							return JSON.parse(line);
						} catch {
							return null;
						}
					})
					.filter(Boolean);
				return json(res, 200, {
					ok: true,
					path: CI_SIGNATURES_PATH,
					count: rows.length,
					items: rows.slice(-limit).reverse(),
				});
			} catch {
				return json(res, 200, {
					ok: true,
					path: CI_SIGNATURES_PATH,
					count: 0,
					items: [],
				});
			}
		}

		if (url.pathname === "/api/bsc/yield/plan") {
			const plan = await computeBscYieldPlan({
				account: url.searchParams.get("account") || undefined,
				targetUsdcBps: url.searchParams.get("targetUsdcBps") || undefined,
				minDriftBps: url.searchParams.get("minDriftBps") || undefined,
				maxStepUsd: url.searchParams.get("maxStepUsd") || undefined,
				minAprDeltaBps: url.searchParams.get("minAprDeltaBps") || undefined,
				amountUsd: url.searchParams.get("amountUsd") || undefined,
				rebalanceIntervalDays:
					url.searchParams.get("rebalanceIntervalDays") || undefined,
				executionProtocol:
					url.searchParams.get("executionProtocol") || undefined,
			});
			return json(res, 200, plan);
		}

		if (url.pathname === "/api/bsc/yield/markets") {
			const compare = await getBscLendingMarketCompare();
			const netYieldInsight = await buildBscDexNetYieldInsight(compare, {
				amountUsd: url.searchParams.get("amountUsd") || undefined,
				rebalanceIntervalDays:
					url.searchParams.get("rebalanceIntervalDays") || undefined,
			});
			const now = Date.now();
			const sourceHealth = {
				venus: {
					...BSC_APR_SOURCE_HEALTH.venus,
					cacheAgeMs: BSC_APR_CACHE.venus.ts
						? now - BSC_APR_CACHE.venus.ts
						: null,
					cacheTtlMs: BSC_APR_CACHE_TTL_MS,
				},
				aave: {
					...BSC_APR_SOURCE_HEALTH.aave,
					cacheAgeMs: BSC_APR_CACHE.aave.ts
						? now - BSC_APR_CACHE.aave.ts
						: null,
					cacheTtlMs: BSC_APR_CACHE_TTL_MS,
				},
				lista: {
					...BSC_APR_SOURCE_HEALTH.lista,
					cacheAgeMs: BSC_APR_CACHE.lista.ts
						? now - BSC_APR_CACHE.lista.ts
						: null,
					cacheTtlMs: BSC_APR_CACHE_TTL_MS,
				},
				wombat: {
					...BSC_APR_SOURCE_HEALTH.wombat,
					cacheAgeMs: BSC_APR_CACHE.wombat.ts
						? now - BSC_APR_CACHE.wombat.ts
						: null,
					cacheTtlMs: BSC_APR_CACHE_TTL_MS,
				},
			};
			return json(res, 200, {
				...compare,
				netYieldInsight,
				sourceHealth,
				executionReadiness: {
					defaultProtocol: BSC_YIELD_EXECUTION_PROTOCOL_DEFAULT,
					aaveEnabled: BSC_AAVE_EXECUTE_ENABLED,
					listaEnabled: BSC_LISTA_EXECUTE_ENABLED,
					wombatEnabled: BSC_WOMBAT_EXECUTE_ENABLED,
					listaMode: BSC_LISTA_EXECUTE_MODE,
					wombatMode: BSC_WOMBAT_EXECUTE_MODE,
					listaNativeEnabled: BSC_LISTA_NATIVE_EXECUTE_ENABLED,
					wombatNativeEnabled: BSC_WOMBAT_NATIVE_EXECUTE_ENABLED,
				},
				minAprDeltaBpsDefault: BSC_YIELD_MIN_APR_DELTA_BPS,
			});
		}

		if (url.pathname === "/api/bsc/yield/execute" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const plan = await computeBscYieldPlan({
				account: payload.account,
				targetUsdcBps: payload.targetUsdcBps,
				minDriftBps: payload.minDriftBps,
				minAprDeltaBps: payload.minAprDeltaBps,
				maxStepUsd: payload.maxStepUsd,
				amountUsd: payload.amountUsd,
				rebalanceIntervalDays: payload.rebalanceIntervalDays,
				executionProtocol: payload.executionProtocol,
			});
			if (plan.plan.action !== "rebalance_usdt_to_usdc") {
				return json(res, 200, { ok: true, mode: "noop", plan });
			}
			if (plan.executeReadiness?.canExecute !== true) {
				return json(res, 200, {
					ok: true,
					mode: "blocked",
					plan,
					reason: plan.executeReadiness?.reason || "execute_not_ready",
				});
			}
			const runId = payload.runId || `bsc-yield-${Date.now()}`;
			try {
				const result = await executeAction({
					action: "rebalance_usdt_to_usdce_txn",
					chain: "bsc",
					amountRaw: plan.plan.recommendedAmountRaw,
					slippageBps: Number.parseInt(String(payload.slippageBps || 50), 10),
					runId,
					step: payload.step || "bsc-stable-yield-execute",
				});
				let postAction = null;
				let postActionArtifact = null;
				let postActionReconciliation = null;
				if (
					plan.executionProtocol === "aave" ||
					plan.executionProtocol === "lista" ||
					plan.executionProtocol === "wombat"
				) {
					const supplyAmountRaw = String(
						result?.execution?.receipt?.tokenOutDeltaRaw ||
							result?.plan?.quotedOutRaw ||
							"0",
					);
					if (/^\d+$/.test(supplyAmountRaw) && BigInt(supplyAmountRaw) > 0n) {
						postAction = await executeBscPostActionSupply(
							plan.executionProtocol,
							{
								amountRaw: supplyAmountRaw,
								token: BSC_USDC,
								rpcUrl: BSC_RPC_URL,
								chainId: BSC_CHAIN_ID,
								runId,
							},
						);
					} else {
						postAction = {
							ok: false,
							reason:
								plan.executionProtocol === "aave"
									? "aave_supply_amount_unavailable"
									: plan.executionProtocol === "lista"
										? "lista_supply_amount_unavailable"
										: "wombat_supply_amount_unavailable",
						};
					}
					const isAave = plan.executionProtocol === "aave";
					const isLista = plan.executionProtocol === "lista";
					postActionArtifact = buildBscPostActionArtifact({
						protocol: plan.executionProtocol,
						supplyAmountRaw,
						postAction,
						runId,
					});
					postActionReconciliation =
						reconcileBscExecutionArtifact(postActionArtifact);
					pushActionHistory({
						action: isAave
							? "bsc_aave_supply"
							: isLista
								? "bsc_lista_supply"
								: "bsc_wombat_supply",
						step: payload.step || "bsc-stable-yield-post-action",
						accountId: payload.account || null,
						status: postAction?.ok ? "success" : "error",
						summary: postAction?.ok
							? `${isAave ? "aave" : isLista ? "lista" : "wombat"} post-swap supply executed`
							: `${isAave ? "aave" : isLista ? "lista" : "wombat"} post-swap supply failed: ${postAction?.reason || "unknown"}`,
						txHash: postAction?.txHash || null,
					});
					if (!postAction?.ok) {
						throw new Error(
							`${isAave ? "BSC_AAVE_POST_ACTION_FAILED" : isLista ? "BSC_LISTA_POST_ACTION_FAILED" : "BSC_WOMBAT_POST_ACTION_FAILED"} retryable=true message=${postAction?.reason || "unknown"}`,
						);
					}
				}
				pushAcpJobHistory({
					runId,
					status: "executed",
					targetChain: "bsc",
					intentType: "bsc_stable_yield",
					executionProtocol: plan.executionProtocol,
					amountRaw: plan.plan.recommendedAmountRaw,
					txHash: result?.txHash || null,
					postActionStatus: postAction
						? postAction.ok
							? "success"
							: "error"
						: "none",
					postActionTxHash: postAction?.txHash || null,
					postActionReason: postAction?.reason || null,
					postActionArtifact,
					postActionReconciliation,
				});
				return json(res, 200, {
					ok: true,
					mode: "execute",
					plan,
					result,
					postAction,
					postActionArtifact,
					postActionReconciliation,
				});
			} catch (error) {
				pushAcpJobHistory({
					runId,
					status: "error",
					targetChain: "bsc",
					intentType: "bsc_stable_yield",
					executionProtocol: plan.executionProtocol,
					amountRaw: plan.plan.recommendedAmountRaw,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
		}

		if (
			url.pathname === "/api/bsc/yield/worker/start" &&
			req.method === "POST"
		) {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			startBscYieldWorker(payload);
			return json(res, 200, {
				ok: true,
				worker: { ...BSC_YIELD_WORKER, timer: undefined },
			});
		}

		if (
			url.pathname === "/api/bsc/yield/worker/stop" &&
			req.method === "POST"
		) {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			stopBscYieldWorker();
			return json(res, 200, {
				ok: true,
				worker: { ...BSC_YIELD_WORKER, timer: undefined },
			});
		}

		if (url.pathname === "/api/bsc/yield/worker/status") {
			return json(res, 200, {
				ok: true,
				worker: { ...BSC_YIELD_WORKER, timer: undefined },
			});
		}

		if (url.pathname === "/api/action" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			const result = await executeAction(payload);
			return json(res, 200, result);
		}

		if (url.pathname === "/api/alerts/test" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const text = Buffer.concat(chunks).toString("utf8") || "{}";
			const payload = JSON.parse(text);
			if (payload.confirm !== true) {
				return json(res, 400, { ok: false, error: "Missing confirm=true" });
			}
			await sendAlert({
				level: payload.level || "info",
				title: payload.title || "Manual test alert",
				message:
					payload.message ||
					`dashboard test ping account=${payload.accountId || ACCOUNT_ID}`,
			});
			return json(res, 200, {
				ok: true,
				sent: true,
				channel: {
					webhook: Boolean(ALERT_WEBHOOK_URL),
					telegram: Boolean(ALERT_TELEGRAM_BOT_TOKEN && ALERT_TELEGRAM_CHAT_ID),
				},
			});
		}

		if (url.pathname === "/" || url.pathname === "/index.html") {
			const html = await readFile(path.join(__dirname, "index.html"), "utf8");
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(html);
			return;
		}

		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		res.end("Not found");
	} catch (error) {
		json(res, 500, {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
});

Promise.all([
	loadMetricsFromDisk(),
	loadPolicyFromDisk(),
	loadMarketplaceFromDisk(),
]).finally(() => {
	void processAcpAsyncQueue();
	setupDismissedPurgeScheduler();
	server.listen(PORT, () => {
		console.log(`NEAR dashboard listening on http://127.0.0.1:${PORT}`);
	});
});
