#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.NEAR_DASHBOARD_PORT || "4173", 10);
const ACCOUNT_ID = process.env.NEAR_ACCOUNT_ID || "davirain8.near";
const BURROW_CONTRACT = "contract.main.burrow.near";
const RPC_ENDPOINTS = (
	process.env.NEAR_RPC_URLS ||
	process.env.NEAR_RPC_URL ||
	"https://1rpc.io/near,https://rpc.mainnet.near.org"
)
	.split(",")
	.map((value) => value.trim())
	.filter(Boolean);
const SESSION_DIR =
	process.env.OPENCLAW_SESSION_DIR ||
	path.join(
		process.env.HOME || "/home/davirain",
		".openclaw/agents/main/sessions",
	);
const METRICS_PATH =
	process.env.NEAR_DASHBOARD_METRICS_PATH ||
	path.join(__dirname, "data", "rebalance-metrics.json");
const POLICY_PATH =
	process.env.NEAR_DASHBOARD_POLICY_PATH ||
	path.join(__dirname, "data", "portfolio-policy.json");
const ALERT_WEBHOOK_URL = process.env.NEAR_REBAL_ALERT_WEBHOOK_URL || "";
const ALERT_TELEGRAM_BOT_TOKEN =
	process.env.NEAR_REBAL_ALERT_TELEGRAM_BOT_TOKEN || "";
const ALERT_TELEGRAM_CHAT_ID =
	process.env.NEAR_REBAL_ALERT_TELEGRAM_CHAT_ID || "";
const ALERT_SUCCESS_ENABLED =
	String(process.env.NEAR_REBAL_ALERT_SUCCESS || "false").toLowerCase() ===
	"true";
const ALERT_DEDUPE_WINDOW_MS =
	Number.parseInt(process.env.NEAR_REBAL_ALERT_DEDUPE_MS || "300000", 10) ||
	300000;
const BSC_CHAIN_ID = Number.parseInt(process.env.BSC_CHAIN_ID || "56", 10);
const BSC_RPC_URL =
	process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org";
const BSC_USDT =
	process.env.BSC_USDT || "0x55d398326f99059fF775485246999027B3197955";
const BSC_USDC =
	process.env.BSC_USDC || "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
const BSC_ROUTER_V2 =
	process.env.BSC_ROUTER_V2 || "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const ACP_BIN = process.env.ACP_BIN || "acp";
const ACP_WORKDIR = process.env.ACP_WORKDIR || process.cwd();
const BSC_USDT_DECIMALS = Number.parseInt(
	process.env.BSC_USDT_DECIMALS || "18",
	10,
);
const BSC_USDC_DECIMALS = Number.parseInt(
	process.env.BSC_USDC_DECIMALS || "18",
	10,
);
const NEAR_RPC_RETRY_ROUNDS = Number.parseInt(
	process.env.NEAR_RPC_RETRY_ROUNDS || "2",
	10,
);
const NEAR_RPC_RETRY_BASE_MS = Number.parseInt(
	process.env.NEAR_RPC_RETRY_BASE_MS || "250",
	10,
);
const NEAR_RPC_ALERT_RETRY_RATE = Number.parseFloat(
	process.env.NEAR_RPC_ALERT_RETRY_RATE || "0.2",
);
const NEAR_RPC_ALERT_429_COUNT = Number.parseInt(
	process.env.NEAR_RPC_ALERT_429_COUNT || "10",
	10,
);
const NEAR_RPC_WARMUP_CALLS = Number.parseInt(
	process.env.NEAR_RPC_WARMUP_CALLS ||
		String(Math.max(2, RPC_ENDPOINTS.length * 2)),
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
const PORTFOLIO_POLICY = {
	targetAllocation: { near: 0.6, bsc: 0.4 },
	constraints: {
		maxChainExposure: { near: 0.8, bsc: 0.8 },
		maxSingleTokenExposure: 0.5,
		minRebalanceUsd: 50,
		maxDailyRebalanceRuns: 10,
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
		PORTFOLIO_POLICY.updatedAt = parsed.updatedAt || null;
	} catch {
		// ignore missing/corrupt policy file
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
			{
				chain: "bsc",
				status: "scaffold",
				note: "bsc execution adapter in progress; portfolio ingestion pending",
			},
		],
		risk: {
			retryRate: snapshot.rpcMetrics?.retryRate || 0,
			http429: snapshot.rpcMetrics?.http429 || 0,
			rebalance: snapshot.rebalanceMetrics,
		},
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

async function getBscUsdtUsdcQuote(amountInRaw) {
	const usdt = BSC_USDT.toLowerCase();
	const usdc = BSC_USDC.toLowerCase();
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
		if (candidates.length === 0) {
			throw new Error("no usdt/usdc pair found on bsc from dexscreener");
		}
		candidates.sort(
			(a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0),
		);
		const best = candidates[0];
		const base = String(best.baseToken?.address || "").toLowerCase();
		const priceNative = Number(best.priceNative || 0);
		if (!Number.isFinite(priceNative) || priceNative <= 0) {
			throw new Error("invalid dexscreener priceNative");
		}
		const inUi = rawToUi(amountInRaw, BSC_USDT_DECIMALS);
		const rate = base === usdt ? priceNative : 1 / priceNative;
		const outUi = inUi * rate;
		const outRaw = uiToRaw(outUi, BSC_USDC_DECIMALS);
		return {
			source: "dexscreener",
			amountOutRaw: outRaw,
			rate,
			pairAddress: String(best.pairAddress || ""),
			liquidityUsd: Number(best?.liquidity?.usd || 0),
		};
	} catch {
		const inUi = rawToUi(amountInRaw, BSC_USDT_DECIMALS);
		const outRaw = uiToRaw(inUi, BSC_USDC_DECIMALS);
		return {
			source: "fallback-1to1",
			amountOutRaw: outRaw,
			rate: 1,
			pairAddress: "",
			liquidityUsd: 0,
		};
	}
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
				const minAmountOutRaw = applySlippage(quote.amountOutRaw, slippageBps);
				pushActionHistory({
					action: payload.action,
					step: payload.step || null,
					accountId,
					status: "success",
					summary: `BSC plan prepared amountIn=${amountRaw} quoteOut=${quote.amountOutRaw} minOut=${minAmountOutRaw}`,
				});
				recordRebalanceMetric({
					runId,
					status: "bsc-plan",
					amountRaw,
					suppliedRaw: quote.amountOutRaw,
					note: "execution not enabled yet",
				});
				return {
					ok: true,
					action: payload.action,
					chain: "bsc",
					mode: "plan-only",
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
						slippageBps,
						next: [
							"enforce minOut by slippage",
							"execute swap through BSC adapter",
							"optional lend supply adapter",
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
				await savePolicyToDisk();
				return json(res, 200, { ok: true, policy: PORTFOLIO_POLICY });
			}
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

Promise.all([loadMetricsFromDisk(), loadPolicyFromDisk()]).finally(() => {
	server.listen(PORT, () => {
		console.log(`NEAR dashboard listening on http://127.0.0.1:${PORT}`);
	});
});
