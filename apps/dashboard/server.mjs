#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.NEAR_DASHBOARD_PORT || "4173", 10);
const RPC_URL = process.env.NEAR_RPC_URL || "https://1rpc.io/near";
const ACCOUNT_ID = process.env.NEAR_ACCOUNT_ID || "davirain8.near";
const BURROW_CONTRACT = "contract.main.burrow.near";
const SESSION_DIR =
	process.env.OPENCLAW_SESSION_DIR ||
	path.join(
		process.env.HOME || "/home/davirain",
		".openclaw/agents/main/sessions",
	);

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

async function nearRpc(method, params) {
	const response = await fetch(RPC_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: "near-dashboard",
			method,
			params,
		}),
	});
	if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
	const payload = await response.json();
	if (payload.error) throw new Error(payload.error?.message || "RPC error");
	return payload.result;
}

async function viewFunction(contractId, methodName, args = {}) {
	const result = await nearRpc("query", {
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
	const state = await nearRpc("query", {
		request_type: "view_account",
		finality: "final",
		account_id: accountId,
	});
	return {
		availableRaw: state.amount,
		available: formatUnits(state.amount, 24),
		lockedRaw: state.locked,
		locked: formatUnits(state.locked, 24),
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

function toTokenAmountFromBurrowInner(balanceInner, extraDecimals = 0) {
	const decimals = 24 - Number(extraDecimals || 0);
	return formatUnits(balanceInner || "0", Math.max(0, decimals));
}

function stableSymbol(tokenId) {
	const match = TOKENS.find((item) => item.contractId === tokenId);
	return match?.symbol || tokenId;
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

		const normalizeRows = (rows = []) =>
			rows.map((row) => {
				const meta = metaMap.get(row.token_id) || {
					extraDecimals: 0,
					symbol: row.token_id,
				};
				return {
					tokenId: row.token_id,
					symbol: meta.symbol,
					apr: row.apr,
					balanceRawInner: row.balance,
					amount: toTokenAmountFromBurrowInner(row.balance, meta.extraDecimals),
				};
			});

		return {
			registered: true,
			collateral: normalizeRows(account.collateral),
			supplied: normalizeRows(account.supplied),
			borrowed: normalizeRows(account.borrowed),
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
	const tokens = ft.map((row) => {
		const usd =
			Number.parseFloat(row.amount) * (prices[row.symbol.toUpperCase()] || 0);
		return { ...row, usd: Number.isFinite(usd) ? usd : 0 };
	});

	return {
		accountId,
		rpcUrl: RPC_URL,
		updatedAt: new Date().toISOString(),
		near: { ...near, usd: Number.isFinite(nearUsd) ? nearUsd : 0 },
		tokens,
		burrow,
		strategy,
		worker: localSignals.worker,
		recentTxs: localSignals.recentTxs,
	};
}

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url || "/", `http://${req.headers.host}`);

		if (url.pathname === "/api/health") {
			return json(res, 200, {
				ok: true,
				rpcUrl: RPC_URL,
				accountId: ACCOUNT_ID,
			});
		}

		if (url.pathname === "/api/snapshot") {
			const accountId = url.searchParams.get("accountId") || ACCOUNT_ID;
			const snapshot = await buildSnapshot(accountId);
			return json(res, 200, snapshot);
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

server.listen(PORT, () => {
	console.log(`NEAR dashboard listening on http://127.0.0.1:${PORT}`);
});
