#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.NEAR_DASHBOARD_PORT || "4173", 10);
const RPC_URL = process.env.NEAR_RPC_URL || "https://1rpc.io/near";
const ACCOUNT_ID = process.env.NEAR_ACCOUNT_ID || "davirain8.near";

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
	if (!response.ok) {
		throw new Error(`RPC HTTP ${response.status}`);
	}
	const payload = await response.json();
	if (payload.error) {
		throw new Error(payload.error?.message || "RPC error");
	}
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
	const rows = await Promise.all(
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
	return rows;
}

async function getBurrowRegistration(accountId) {
	try {
		const result = await viewFunction(
			"contract.main.burrow.near",
			"storage_balance_of",
			{ account_id: accountId },
		);
		return { registered: !!result, raw: result };
	} catch (error) {
		return {
			registered: false,
			error: error instanceof Error ? error.message : String(error),
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

async function buildSnapshot(accountId) {
	const [near, ft, burrow, prices] = await Promise.all([
		getNearBalance(accountId),
		getFtBalances(accountId),
		getBurrowRegistration(accountId),
		getPriceMap(),
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
