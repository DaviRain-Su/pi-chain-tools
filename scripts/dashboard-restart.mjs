#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = process.cwd();
const LOG_PATH = path.join(
	ROOT,
	"apps",
	"dashboard",
	"data",
	"dashboard-session.log",
);
const CONFIG_PATH = path.join(
	ROOT,
	"apps",
	"dashboard",
	"config",
	"dashboard.config.json",
);
const ENV_FILES = [
	path.join(ROOT, ".env"),
	path.join(ROOT, ".env.local"),
	path.join(ROOT, ".env.bsc.local"),
];

function parseArgs(argv) {
	const flags = new Set(argv.slice(2));
	return {
		restart: flags.has("--restart") || flags.has("--force-restart"),
		timeoutMs: Number.parseInt(
			process.env.DASHBOARD_RESTART_TIMEOUT_MS || "15000",
			10,
		),
		healthPath: process.env.DASHBOARD_HEALTH_PATH || "/api/health",
	};
}

function resolvePort() {
	if (process.env.NEAR_DASHBOARD_PORT) {
		return Number.parseInt(process.env.NEAR_DASHBOARD_PORT, 10);
	}
	try {
		const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		const fromConfig = Number.parseInt(String(config?.server?.port || ""), 10);
		if (Number.isFinite(fromConfig) && fromConfig > 0) return fromConfig;
	} catch {
		// ignore missing/invalid config
	}
	return 4173;
}

function healthCheck(port, healthPath, timeoutMs = 2500) {
	return new Promise((resolve) => {
		const req = http.request(
			{
				host: "127.0.0.1",
				port,
				path: healthPath,
				method: "GET",
				timeout: timeoutMs,
			},
			(res) => {
				const ok =
					Number(res.statusCode || 0) >= 200 &&
					Number(res.statusCode || 0) < 300;
				res.resume();
				resolve(ok);
			},
		);
		req.on("timeout", () => {
			req.destroy();
			resolve(false);
		});
		req.on("error", () => resolve(false));
		req.end();
	});
}

function listPortPids(port) {
	const lsof = spawnSync("bash", ["-lc", `lsof -ti tcp:${port} -sTCP:LISTEN`], {
		encoding: "utf8",
	});
	if (lsof.status === 0) {
		return Array.from(
			new Set(
				String(lsof.stdout || "")
					.split("\n")
					.map((v) => v.trim())
					.filter(Boolean),
			),
		);
	}
	return [];
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitPortFree(port, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (listPortPids(port).length === 0) return true;
		await sleep(250);
	}
	return listPortPids(port).length === 0;
}

async function waitHealthy(port, healthPath, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await healthCheck(port, healthPath, 1500)) return true;
		await sleep(400);
	}
	return false;
}

function parseEnvFile(content) {
	const out = {};
	for (const line of String(content || "").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const idx = trimmed.indexOf("=");
		if (idx <= 0) continue;
		const key = trimmed.slice(0, idx).trim();
		let val = trimmed.slice(idx + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		out[key] = val;
	}
	return out;
}

function loadEnvOverrides() {
	const merged = {};
	for (const filePath of ENV_FILES) {
		if (!existsSync(filePath)) continue;
		try {
			Object.assign(merged, parseEnvFile(readFileSync(filePath, "utf8")));
		} catch {
			// ignore parse errors; keep startup resilient
		}
	}
	return merged;
}

function startDashboard() {
	mkdirSync(path.dirname(LOG_PATH), { recursive: true });
	const fd = openSync(LOG_PATH, "a");
	const env = { ...process.env, ...loadEnvOverrides() };
	const child = spawn("npm", ["run", "dashboard:start"], {
		detached: true,
		stdio: ["ignore", fd, fd],
		env,
		shell: process.platform === "win32",
	});
	child.unref();
	return child.pid;
}

async function main() {
	const options = parseArgs(process.argv);
	const port = resolvePort();
	const healthyBefore = await healthCheck(port, options.healthPath);
	const pidsBefore = listPortPids(port);
	const collisionDetected = pidsBefore.length > 0;

	if (!options.restart && healthyBefore) {
		console.log(
			JSON.stringify({
				ok: true,
				action: "ensure",
				port,
				healthy: true,
				preflightAvoidedCollision: collisionDetected,
				collisionDetected,
				message: "dashboard already healthy; skipped restart",
			}),
		);
		process.exit(0);
	}

	for (const pid of pidsBefore) {
		try {
			process.kill(Number(pid), "SIGTERM");
		} catch {
			// process already gone or inaccessible
		}
	}

	let forcedKill = false;
	const freed = await waitPortFree(port, Math.min(options.timeoutMs, 7000));
	if (!freed) {
		for (const pid of listPortPids(port)) {
			try {
				process.kill(Number(pid), "SIGKILL");
				forcedKill = true;
			} catch {
				// ignore
			}
		}
		await waitPortFree(port, 3000);
	}

	const startedPid = startDashboard();
	const healthyAfter = await waitHealthy(
		port,
		options.healthPath,
		options.timeoutMs,
	);
	if (!healthyAfter) {
		console.error(
			JSON.stringify({
				ok: false,
				action: options.restart ? "restart" : "ensure-start",
				port,
				collisionDetected,
				forcedKill,
				startedPid,
				message: "dashboard failed health check after launch",
			}),
		);
		process.exit(1);
	}

	console.log(
		JSON.stringify({
			ok: true,
			action: options.restart ? "restart" : "ensure-start",
			port,
			collisionDetected,
			preflightAvoidedCollision: collisionDetected,
			forcedKill,
			startedPid,
			healthy: true,
			sessionId:
				process.env.OPENCLAW_SESSION_ID || process.env.SESSION_ID || null,
		}),
	);
}

await main();
