import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const EIP1967_IMPLEMENTATION_SLOT =
	"0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC";

const SEVERITY_ORDER = {
	info: 1,
	warn: 2,
	critical: 3,
};

const DEFAULT_STATE_PATH = "apps/dashboard/data/security-state.json";
const DEFAULT_REPORTS_ROOT = "apps/dashboard/data/security-reports";
const DEFAULT_CONFIG_PATH = "apps/dashboard/config/security-watchlist.json";
const FALLBACK_CONFIG_PATH =
	"apps/dashboard/config/security-watchlist.example.json";

function nowIso() {
	return new Date().toISOString();
}

function ensureDir(targetPath) {
	mkdirSync(targetPath, { recursive: true });
}

function readJsonFileSafe(filePath, fallback) {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return fallback;
	}
}

function writeJsonFile(filePath, payload) {
	ensureDir(path.dirname(filePath));
	writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseSeverityMin(value) {
	if (!value || typeof value !== "string") return "info";
	const normalized = value.toLowerCase();
	return SEVERITY_ORDER[normalized] ? normalized : "info";
}

function severityAtLeast(severity, threshold) {
	const a = SEVERITY_ORDER[severity] ?? 0;
	const b = SEVERITY_ORDER[threshold] ?? 0;
	return a >= b;
}

function classifySeverity(raw) {
	const normalized = String(raw ?? "").toLowerCase();
	if (SEVERITY_ORDER[normalized]) return normalized;
	return "info";
}

function parseArgs(argv) {
	const options = {
		configPath: process.env.EVM_SECURITY_WATCH_CONFIG ?? DEFAULT_CONFIG_PATH,
		statePath: process.env.EVM_SECURITY_WATCH_STATE ?? DEFAULT_STATE_PATH,
		reportsRoot:
			process.env.EVM_SECURITY_WATCH_REPORTS_ROOT ?? DEFAULT_REPORTS_ROOT,
		intervalSec: undefined,
		once: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--config") {
			options.configPath = argv[index + 1] ?? options.configPath;
			index += 1;
			continue;
		}
		if (token.startsWith("--config=")) {
			options.configPath = token.slice("--config=".length);
			continue;
		}
		if (token === "--state") {
			options.statePath = argv[index + 1] ?? options.statePath;
			index += 1;
			continue;
		}
		if (token.startsWith("--state=")) {
			options.statePath = token.slice("--state=".length);
			continue;
		}
		if (token === "--reports-root") {
			options.reportsRoot = argv[index + 1] ?? options.reportsRoot;
			index += 1;
			continue;
		}
		if (token.startsWith("--reports-root=")) {
			options.reportsRoot = token.slice("--reports-root=".length);
			continue;
		}
		if (token === "--interval") {
			const parsed = Number(argv[index + 1]);
			if (Number.isFinite(parsed) && parsed > 0) {
				options.intervalSec = parsed;
			}
			index += 1;
			continue;
		}
		if (token.startsWith("--interval=")) {
			const parsed = Number(token.slice("--interval=".length));
			if (Number.isFinite(parsed) && parsed > 0) {
				options.intervalSec = parsed;
			}
			continue;
		}
		if (token === "--once") {
			options.once = true;
		}
	}
	return options;
}

function normalizeAddress(address) {
	if (typeof address !== "string") return "";
	return address.trim().toLowerCase();
}

function validateWatchlist(rawConfig) {
	const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
	const chains = Array.isArray(config.chains) ? config.chains : [];
	const contracts = Array.isArray(config.contracts) ? config.contracts : [];
	const thresholds =
		config.thresholds && typeof config.thresholds === "object"
			? config.thresholds
			: {};
	const notify =
		config.notify && typeof config.notify === "object" ? config.notify : {};

	const chainList = chains
		.map((chain) => ({
			chainId: Number(chain?.chainId),
			name: typeof chain?.name === "string" ? chain.name : "",
			rpcUrlEnv: typeof chain?.rpcUrlEnv === "string" ? chain.rpcUrlEnv : "",
			explorerBaseUrl:
				typeof chain?.explorerBaseUrl === "string"
					? chain.explorerBaseUrl
					: null,
		}))
		.filter((chain) => Number.isInteger(chain.chainId) && chain.rpcUrlEnv);

	const contractList = contracts
		.map((entry) => ({
			chainId: Number(entry?.chainId),
			address: normalizeAddress(entry?.address),
			label:
				typeof entry?.label === "string" && entry.label.trim()
					? entry.label.trim()
					: normalizeAddress(entry?.address),
			type: typeof entry?.type === "string" ? entry.type : "contract",
			ownerExpected: entry?.ownerExpected
				? normalizeAddress(entry.ownerExpected)
				: undefined,
			proxyExpected: entry?.proxyExpected
				? normalizeAddress(entry.proxyExpected)
				: undefined,
		}))
		.filter(
			(entry) =>
				Number.isInteger(entry.chainId) &&
				entry.address.startsWith("0x") &&
				entry.address.length === 42,
		);

	return {
		chains: chainList,
		contracts: contractList,
		thresholds: {
			largeApprovalUsd:
				typeof thresholds.largeApprovalUsd === "number"
					? thresholds.largeApprovalUsd
					: 100_000,
			largeTransferUsd:
				typeof thresholds.largeTransferUsd === "number"
					? thresholds.largeTransferUsd
					: 100_000,
			checkIntervalSec:
				typeof thresholds.checkIntervalSec === "number"
					? thresholds.checkIntervalSec
					: 300,
		},
		notify: {
			enabled: Boolean(notify.enabled),
			severityMin: parseSeverityMin(notify.severityMin),
			channelHint:
				typeof notify.channelHint === "string" ? notify.channelHint : undefined,
		},
	};
}

function loadWatchlist(configPath) {
	const raw = readJsonFileSafe(configPath, null);
	if (raw) {
		return {
			config: validateWatchlist(raw),
			configPath,
			usedFallback: false,
		};
	}
	const fallbackRaw = readJsonFileSafe(FALLBACK_CONFIG_PATH, {});
	return {
		config: validateWatchlist(fallbackRaw),
		configPath: FALLBACK_CONFIG_PATH,
		usedFallback: true,
	};
}

async function rpcCall(rpcUrl, method, params = []) {
	const response = await fetch(rpcUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
	if (!response.ok) {
		throw new Error(`RPC HTTP ${response.status}`);
	}
	const payload = await response.json();
	if (payload.error) {
		throw new Error(payload.error.message || "RPC error");
	}
	return payload.result;
}

function makeEvidenceLink(chain, kind, value) {
	if (!chain?.explorerBaseUrl) return null;
	if (kind === "address") {
		return `${chain.explorerBaseUrl.replace(/\/$/, "")}/address/${value}`;
	}
	if (kind === "tx") {
		return `${chain.explorerBaseUrl.replace(/\/$/, "")}/tx/${value}`;
	}
	return null;
}

function computeCodeHash(hexCode) {
	const digest = createHash("sha256")
		.update(hexCode || "0x")
		.digest("hex");
	return `sha256:${digest}`;
}

function decodeAddressFromStorageWord(word) {
	if (typeof word !== "string" || !word.startsWith("0x")) return null;
	if (word.length < 42) return null;
	return `0x${word.slice(-40)}`.toLowerCase();
}

function readAddressFromEthCallResult(value) {
	if (typeof value !== "string" || !value.startsWith("0x")) return null;
	if (value.length < 42) return null;
	return `0x${value.slice(-40)}`.toLowerCase();
}

function readBooleanFromEthCallResult(value) {
	if (typeof value !== "string" || !value.startsWith("0x")) return null;
	if (value.length < 3) return null;
	const asBigInt = BigInt(value);
	return asBigInt !== 0n;
}

async function safeEthCall(chain, to, selectorHex) {
	try {
		return await rpcCall(chain.rpcUrl, "eth_call", [
			{ to, data: selectorHex },
			"latest",
		]);
	} catch {
		return null;
	}
}

function makeFinding({ severity, chain, contract, kind, message, evidence }) {
	return {
		severity: classifySeverity(severity),
		chainId: chain.chainId,
		chainName: chain.name,
		contract: {
			address: contract.address,
			label: contract.label,
			type: contract.type,
		},
		kind,
		message,
		evidence,
		detectedAt: nowIso(),
	};
}

async function detectContractFindings({
	chain,
	contract,
	previousState,
	thresholds,
}) {
	const findings = [];
	const currentState = {
		codeHash: null,
		proxyImplementation: null,
		owner: null,
		paused: null,
		lastScanAt: nowIso(),
	};

	let bytecode = "0x";
	try {
		bytecode = await rpcCall(chain.rpcUrl, "eth_getCode", [
			contract.address,
			"latest",
		]);
		currentState.codeHash = computeCodeHash(bytecode);
		if (
			previousState?.codeHash &&
			previousState.codeHash !== currentState.codeHash
		) {
			findings.push(
				makeFinding({
					severity: "critical",
					chain,
					contract,
					kind: "code_hash_drift",
					message: `${contract.label} code hash drift detected`,
					evidence: {
						previous: previousState.codeHash,
						current: currentState.codeHash,
						addressLink: makeEvidenceLink(chain, "address", contract.address),
					},
				}),
			);
		}
	} catch (error) {
		findings.push(
			makeFinding({
				severity: "warn",
				chain,
				contract,
				kind: "rpc_code_read_failed",
				message: `${contract.label} code read failed`,
				evidence: {
					error: String(error?.message || error),
					rpcUrl: chain.rpcUrl,
				},
			}),
		);
	}

	try {
		const implementationWord = await rpcCall(chain.rpcUrl, "eth_getStorageAt", [
			contract.address,
			EIP1967_IMPLEMENTATION_SLOT,
			"latest",
		]);
		const implementation = decodeAddressFromStorageWord(implementationWord);
		if (
			implementation &&
			implementation !== "0x0000000000000000000000000000000000000000"
		) {
			currentState.proxyImplementation = implementation;
			if (
				previousState?.proxyImplementation &&
				previousState.proxyImplementation !== implementation
			) {
				findings.push(
					makeFinding({
						severity: "critical",
						chain,
						contract,
						kind: "proxy_impl_drift",
						message: `${contract.label} proxy implementation changed`,
						evidence: {
							previous: previousState.proxyImplementation,
							current: implementation,
							addressLink: makeEvidenceLink(chain, "address", contract.address),
						},
					}),
				);
			}
			if (contract.proxyExpected && contract.proxyExpected !== implementation) {
				findings.push(
					makeFinding({
						severity: "critical",
						chain,
						contract,
						kind: "proxy_impl_unexpected",
						message: `${contract.label} proxy implementation differs from expected`,
						evidence: {
							expected: contract.proxyExpected,
							current: implementation,
						},
					}),
				);
			}
		}
	} catch {
		// best-effort
	}

	const ownerResult = await safeEthCall(chain, contract.address, "0x8da5cb5b");
	if (ownerResult) {
		const ownerAddress = readAddressFromEthCallResult(ownerResult);
		if (ownerAddress) {
			currentState.owner = ownerAddress;
			if (previousState?.owner && previousState.owner !== ownerAddress) {
				findings.push(
					makeFinding({
						severity: "critical",
						chain,
						contract,
						kind: "owner_drift",
						message: `${contract.label} owner changed`,
						evidence: {
							previous: previousState.owner,
							current: ownerAddress,
						},
					}),
				);
			}
			if (contract.ownerExpected && contract.ownerExpected !== ownerAddress) {
				findings.push(
					makeFinding({
						severity: "critical",
						chain,
						contract,
						kind: "owner_unexpected",
						message: `${contract.label} owner differs from expected`,
						evidence: {
							expected: contract.ownerExpected,
							current: ownerAddress,
						},
					}),
				);
			}
		}
	}

	const pausedResult = await safeEthCall(chain, contract.address, "0x5c975abb");
	if (pausedResult) {
		const paused = readBooleanFromEthCallResult(pausedResult);
		if (typeof paused === "boolean") {
			currentState.paused = paused;
			if (
				typeof previousState?.paused === "boolean" &&
				previousState.paused !== paused
			) {
				findings.push(
					makeFinding({
						severity: paused ? "warn" : "info",
						chain,
						contract,
						kind: "pause_flag_changed",
						message: `${contract.label} paused() changed to ${paused}`,
						evidence: {
							previous: previousState.paused,
							current: paused,
						},
					}),
				);
			}
		}
	}

	if (contract.ownerExpected) {
		const approvalFindings = await detectApprovalSpikes({
			chain,
			contract,
			thresholds,
			ownerAddress: contract.ownerExpected,
		});
		findings.push(...approvalFindings);
	}

	return { findings, currentState };
}

async function detectApprovalSpikes({
	chain,
	contract,
	thresholds,
	ownerAddress,
}) {
	const findings = [];
	const approvalTopic =
		"0x8c5be1e5ebec7d5bd14f714f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b";
	const paddedOwner = `0x000000000000000000000000${ownerAddress.slice(2)}`;
	try {
		const latestBlockHex = await rpcCall(chain.rpcUrl, "eth_blockNumber", []);
		const latestBlock = Number.parseInt(latestBlockHex, 16);
		if (!Number.isFinite(latestBlock)) return findings;
		const from = Math.max(0, latestBlock - 1000).toString(16);
		const logs = await rpcCall(chain.rpcUrl, "eth_getLogs", [
			{
				fromBlock: `0x${from}`,
				toBlock: latestBlockHex,
				address: contract.address,
				topics: [approvalTopic, paddedOwner],
			},
		]);
		for (const log of logs || []) {
			const dataHex = typeof log?.data === "string" ? log.data : "0x0";
			let amount = 0n;
			try {
				amount = BigInt(dataHex);
			} catch {
				continue;
			}
			if (amount >= 2n ** 200n) {
				findings.push(
					makeFinding({
						severity:
							thresholds.largeApprovalUsd &&
							thresholds.largeApprovalUsd >= 500_000
								? "warn"
								: "info",
						chain,
						contract,
						kind: "allowance_spike",
						message: `${contract.label} large approval observed for watched owner`,
						evidence: {
							ownerAddress,
							amountRaw: amount.toString(),
							transactionHash: log.transactionHash,
							txLink: makeEvidenceLink(chain, "tx", log.transactionHash),
						},
					}),
				);
			}
		}
	} catch {
		// optional, keep silent
	}
	return findings;
}

function buildSummary(findings) {
	const summary = { info: 0, warn: 0, critical: 0, total: findings.length };
	for (const item of findings) {
		summary[item.severity] = (summary[item.severity] ?? 0) + 1;
	}
	return summary;
}

function buildAlertPayloads(findings) {
	const grouped = {
		critical: findings.filter((item) => item.severity === "critical"),
		warn: findings.filter((item) => item.severity === "warn"),
		info: findings.filter((item) => item.severity === "info"),
	};
	return {
		critical: {
			policy: "immediate_per_finding_with_dedupe_cooldown",
			findings: grouped.critical,
		},
		warn: {
			policy: "batched_per_scan",
			findings: grouped.warn,
		},
		info: {
			policy: "optional_off_by_default",
			findings: grouped.info,
		},
	};
}

async function runSecurityScan(options = {}) {
	const parsed = {
		...parseArgs([]),
		...options,
	};
	const loaded = loadWatchlist(parsed.configPath);
	const { config } = loaded;
	const state = readJsonFileSafe(parsed.statePath, {
		contracts: {},
		notify: {},
	});
	const nextState = {
		contracts: { ...(state.contracts ?? {}) },
		notify:
			state.notify && typeof state.notify === "object"
				? { ...state.notify }
				: {},
		updatedAt: nowIso(),
	};
	const findings = [];
	const chainById = new Map();

	for (const chain of config.chains) {
		const rpcUrl = process.env[chain.rpcUrlEnv];
		if (!rpcUrl) {
			findings.push({
				severity: "warn",
				chainId: chain.chainId,
				chainName: chain.name,
				contract: null,
				kind: "missing_rpc_env",
				message: `RPC env ${chain.rpcUrlEnv} is missing; chain scan skipped`,
				evidence: { rpcUrlEnv: chain.rpcUrlEnv },
				detectedAt: nowIso(),
			});
			continue;
		}
		chainById.set(chain.chainId, { ...chain, rpcUrl });
	}

	for (const contract of config.contracts) {
		const chain = chainById.get(contract.chainId);
		if (!chain) continue;
		const key = `${contract.chainId}:${contract.address}`;
		const previousState = nextState.contracts[key] ?? {};
		const result = await detectContractFindings({
			chain,
			contract,
			previousState,
			thresholds: config.thresholds,
		});
		nextState.contracts[key] = {
			...previousState,
			...result.currentState,
			label: contract.label,
			type: contract.type,
		};
		findings.push(...result.findings);
	}

	writeJsonFile(parsed.statePath, nextState);

	const summary = buildSummary(findings);
	const today = new Date().toISOString().slice(0, 10);
	const reportDir = path.join(parsed.reportsRoot, today);
	ensureDir(reportDir);
	const alerts = buildAlertPayloads(findings);
	const report = {
		schema: "evm.security.watch.report.v1",
		scannedAt: nowIso(),
		configPath: loaded.configPath,
		usedFallbackConfig: loaded.usedFallback,
		notify: config.notify,
		summary,
		alerts,
		findings,
	};
	const latestPath = path.join(reportDir, "latest.json");
	writeJsonFile(latestPath, report);

	return {
		report,
		reportPath: latestPath,
		notifyFindings: findings.filter((item) =>
			severityAtLeast(item.severity, config.notify.severityMin),
		),
		alertPayloads: alerts,
	};
}

function formatTerminalSummary(result) {
	const summary = result.report.summary;
	return [
		`[evm-security-watch] total=${summary.total} critical=${summary.critical} warn=${summary.warn} info=${summary.info}`,
		`report=${result.reportPath}`,
	].join("\n");
}

export {
	DEFAULT_CONFIG_PATH,
	DEFAULT_REPORTS_ROOT,
	DEFAULT_STATE_PATH,
	classifySeverity,
	formatTerminalSummary,
	parseArgs,
	runSecurityScan,
	severityAtLeast,
	validateWatchlist,
};
