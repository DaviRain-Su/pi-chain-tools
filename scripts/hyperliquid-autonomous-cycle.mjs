#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { evaluateCycleTransitionEvidence } from "./autonomous-cycle-trigger-adapter.mjs";
import { runHyperliquidExecSafe } from "./hyperliquid-exec-safe.mjs";
import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";
import { normalizeTxReceipt } from "./tx-receipt-normalize.mjs";

import { applyLegacyBscAutonomousEnvCompat } from "../scripts/hyperliquid-env-compat.mjs";
applyLegacyBscAutonomousEnvCompat(process.env);
const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) ?? process.cwd();
const AUTONOMOUS_PROOFS_ROOT = path.join(
	REPO_ROOT,
	"apps",
	"dashboard",
	"data",
	"proofs",
	"autonomous-cycle",
);
const DEFAULT_OUT = path.join(AUTONOMOUS_PROOFS_ROOT, "latest.json");
const DEFAULT_HISTORY_DIR = path.join(AUTONOMOUS_PROOFS_ROOT, "runs");
const DEFAULT_STATE_PATH = path.join(
	REPO_ROOT,
	"apps",
	"dashboard",
	"data",
	"autonomous-cycle-state.json",
);

function nowIso() {
	return new Date().toISOString();
}

function isAutonomousOnchainMode(env) {
	return (
		String(env.HYPERLIQUID_AUTONOMOUS_MODE || "")
			.trim()
			.toLowerCase() === "true"
	);
}

function resolveReceiptChain(env) {
	return isAutonomousOnchainMode(env) ? "hyperliquid" : "offchain-orchestrator";
}

function normalizeRunId(input) {
	const raw = String(input || "").trim();
	if (!raw) return `autonomous-cycle-${Date.now()}`;
	return raw.replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 120);
}

function parsePositiveInt(input, fallback) {
	const value = Number.parseInt(String(input ?? ""), 10);
	if (!Number.isFinite(value) || value <= 0) return fallback;
	return value;
}

async function readJsonSafe(filePath, fallback = null) {
	try {
		const raw = await readFile(filePath, "utf8");
		return JSON.parse(raw);
	} catch {
		return fallback;
	}
}

async function writeJsonAtomic(filePath, payload) {
	await mkdir(path.dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
	await rename(tempPath, filePath);
}

function buildInitialState() {
	return {
		version: 1,
		updatedAt: nowIso(),
		lastLiveAt: null,
		activeLiveRunId: null,
		activeLiveStartedAt: null,
		replay: {
			maxEntries: 200,
			runs: {},
		},
	};
}

function compactReplayRuns(runs, maxEntries) {
	const list = Object.entries(runs || {}).sort((a, b) => {
		const aTs = Date.parse(String(a[1]?.updatedAt || a[1]?.startedAt || "0"));
		const bTs = Date.parse(String(b[1]?.updatedAt || b[1]?.startedAt || "0"));
		return bTs - aTs;
	});
	return Object.fromEntries(list.slice(0, Math.max(20, maxEntries)));
}

async function loadCycleState(statePath) {
	const parsed = await readJsonSafe(statePath, null);
	if (!parsed || typeof parsed !== "object") return buildInitialState();
	const base = buildInitialState();
	const replay =
		parsed.replay && typeof parsed.replay === "object" ? parsed.replay : {};
	return {
		...base,
		...parsed,
		replay: {
			maxEntries: parsePositiveInt(replay.maxEntries, 200),
			runs:
				replay.runs && typeof replay.runs === "object"
					? compactReplayRuns(
							replay.runs,
							parsePositiveInt(replay.maxEntries, 200),
						)
					: {},
		},
	};
}

function parseArgs(rawArgs = process.argv.slice(2)) {
	const args = {
		mode: "dryrun",
		out: DEFAULT_OUT,
		historyDir: DEFAULT_HISTORY_DIR,
		statePath: DEFAULT_STATE_PATH,
		runId: normalizeRunId(`autonomous-cycle-${Date.now()}`),
		triggerJson: "",
	};
	for (let i = 0; i < rawArgs.length; i += 1) {
		const token = String(rawArgs[i] || "");
		if (!token.startsWith("--")) continue;
		const key = token.slice(2);
		const value = rawArgs[i + 1];
		if (value === undefined) throw new Error(`missing value for --${key}`);
		i += 1;
		switch (key) {
			case "mode":
				args.mode = String(value).trim().toLowerCase();
				break;
			case "out":
				args.out = path.resolve(String(value));
				break;
			case "history-dir":
				args.historyDir = path.resolve(String(value));
				break;
			case "state-path":
				args.statePath = path.resolve(String(value));
				break;
			case "run-id":
				args.runId = normalizeRunId(value);
				break;
			case "trigger-json":
				args.triggerJson = String(value).trim();
				break;
			default:
				throw new Error(`unknown argument: --${key}`);
		}
	}
	if (args.mode !== "dryrun" && args.mode !== "live") {
		throw new Error("--mode must be dryrun|live");
	}
	return args;
}

function buildIntent(runId, env) {
	return {
		runId,
		tokenIn: String(
			env.HYPERLIQUID_AUTONOMOUS_TOKEN_IN || env.BSC_USDC || "USDC",
		),
		tokenOut: String(
			env.HYPERLIQUID_AUTONOMOUS_TOKEN_OUT || env.BSC_USDT || "USDT",
		),
		amountRaw: String(
			env.HYPERLIQUID_AUTONOMOUS_AMOUNT_RAW || "1000000000000000",
		),
		routerAddress: String(env.HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS || ""),
		executorAddress: String(env.HYPERLIQUID_AUTONOMOUS_EXECUTOR_ADDRESS || ""),
	};
}

function parseJsonText(raw) {
	if (!raw) return null;
	try {
		return JSON.parse(String(raw));
	} catch {
		return null;
	}
}

function pickSnapshotBalance(snapshotData) {
	if (!snapshotData || typeof snapshotData !== "object") return null;
	const wallet =
		snapshotData.wallet && typeof snapshotData.wallet === "object"
			? snapshotData.wallet
			: snapshotData;
	const usdcRaw =
		wallet.usdcRaw ?? wallet.USDCRaw ?? wallet.usdc_balance_raw ?? null;
	const usdtRaw =
		wallet.usdtRaw ?? wallet.USDTRaw ?? wallet.usdt_balance_raw ?? null;
	const usdcUi = wallet.usdcUi ?? wallet.usdc ?? null;
	const usdtUi = wallet.usdtUi ?? wallet.usdt ?? null;
	if (usdcRaw == null && usdtRaw == null && usdcUi == null && usdtUi == null) {
		return null;
	}
	return {
		usdcRaw: usdcRaw != null ? String(usdcRaw) : null,
		usdtRaw: usdtRaw != null ? String(usdtRaw) : null,
		usdcUi: usdcUi != null ? String(usdcUi) : null,
		usdtUi: usdtUi != null ? String(usdtUi) : null,
	};
}

function runSnapshotCommand(commandTemplate, env, stage) {
	const command = String(commandTemplate || "").trim();
	if (!command) {
		return { stage, available: false, source: "not_configured" };
	}
	const timeoutMs = parsePositiveInt(
		env.HYPERLIQUID_AUTONOMOUS_RECONCILE_SNAPSHOT_TIMEOUT_MS,
		20000,
	);
	const out = spawnSync(command, {
		shell: true,
		encoding: "utf8",
		env,
		timeout: timeoutMs,
	});
	const stdout = String(out.stdout || "").trim();
	const stderr = String(out.stderr || "").trim();
	const parsed = parseJsonText(stdout) || parseJsonText(stderr);
	return {
		stage,
		available: out.status === 0,
		status: out.status,
		timeoutMs,
		parsed,
		summary: {
			stdoutTail: stdout.slice(-280),
			stderrTail: stderr.slice(-280),
		},
	};
}

function buildReconcileSnapshot(beforeSnapshot, afterSnapshot) {
	const beforeBalance = pickSnapshotBalance(beforeSnapshot?.parsed || null);
	const afterBalance = pickSnapshotBalance(afterSnapshot?.parsed || null);
	const delta =
		beforeBalance && afterBalance
			? {
					usdcRawDelta:
						beforeBalance.usdcRaw && afterBalance.usdcRaw
							? (
									BigInt(afterBalance.usdcRaw) - BigInt(beforeBalance.usdcRaw)
								).toString()
							: null,
					usdtRawDelta:
						beforeBalance.usdtRaw && afterBalance.usdtRaw
							? (
									BigInt(afterBalance.usdtRaw) - BigInt(beforeBalance.usdtRaw)
								).toString()
							: null,
				}
			: null;
	return {
		before: beforeSnapshot || { available: false, source: "not_captured" },
		after: afterSnapshot || { available: false, source: "not_captured" },
		beforeBalance,
		afterBalance,
		delta,
	};
}

function summarizeReconcile(execResult, reconcileSnapshot) {
	if (execResult.status === "executed") {
		return {
			status: execResult.txHash ? "submitted" : "submitted_without_hash",
			notes: ["Execution command completed.", "Verify txHash on BSC explorer."],
			reconcileSnapshot,
		};
	}
	if (execResult.status === "dryrun") {
		return {
			status: "dryrun_only",
			notes: [
				"No state change performed.",
				"Live mode requires explicit confirmation and active binding.",
			],
			reconcileSnapshot,
		};
	}
	return {
		status: "blocked_or_failed",
		notes: [
			"Execution path blocked or failed.",
			"Review blockers/evidence and resolve config guardrails.",
		],
		reconcileSnapshot,
	};
}

function createLiveSafetyContext(env) {
	return {
		minIntervalSeconds: parsePositiveInt(
			env.HYPERLIQUID_AUTONOMOUS_CYCLE_MIN_LIVE_INTERVAL_SECONDS,
			300,
		),
		lockTtlSeconds: parsePositiveInt(
			env.HYPERLIQUID_AUTONOMOUS_CYCLE_LOCK_TTL_SECONDS,
			900,
		),
	};
}

function guardAndMarkLiveRun({ state, runId, safety }) {
	const nowMs = Date.now();
	const replayRow = state.replay?.runs?.[runId] || null;
	if (replayRow) {
		throw new Error(
			`idempotency guard: run-id replay blocked (${runId}, status=${replayRow.status || "unknown"})`,
		);
	}
	if (state.activeLiveRunId && state.activeLiveRunId !== runId) {
		const activeStartedMs = Date.parse(
			String(state.activeLiveStartedAt || "0"),
		);
		if (
			Number.isFinite(activeStartedMs) &&
			nowMs - activeStartedMs <= safety.lockTtlSeconds * 1000
		) {
			throw new Error(
				`live lock active: ${state.activeLiveRunId} (ttl=${safety.lockTtlSeconds}s)`,
			);
		}
	}
	if (state.lastLiveAt) {
		const lastLiveMs = Date.parse(String(state.lastLiveAt));
		if (Number.isFinite(lastLiveMs)) {
			const deltaMs = nowMs - lastLiveMs;
			if (deltaMs < safety.minIntervalSeconds * 1000) {
				const waitMs = Math.max(0, safety.minIntervalSeconds * 1000 - deltaMs);
				throw new Error(
					`rate lock active: retry after ${Math.ceil(waitMs / 1000)}s (min interval ${safety.minIntervalSeconds}s)`,
				);
			}
		}
	}
	state.activeLiveRunId = runId;
	state.activeLiveStartedAt = nowIso();
	state.replay.runs[runId] = {
		status: "in_progress",
		startedAt: state.activeLiveStartedAt,
		updatedAt: state.activeLiveStartedAt,
		txHash: null,
		blockers: [],
	};
	state.replay.runs = compactReplayRuns(
		state.replay.runs,
		parsePositiveInt(state.replay.maxEntries, 200),
	);
	state.updatedAt = nowIso();
}

function finalizeLiveRunState({ state, runId, proof, error }) {
	const current = state.replay.runs[runId] || {
		status: "in_progress",
		startedAt: nowIso(),
	};
	const blockerList = Array.isArray(proof?.txEvidence?.blockers)
		? proof.txEvidence.blockers
		: [];
	const txHash = proof?.txEvidence?.txHash || null;
	const status = error
		? "failed"
		: proof?.ok
			? txHash
				? "submitted"
				: "ok_without_tx"
			: "blocked";
	state.replay.runs[runId] = {
		...current,
		status,
		updatedAt: nowIso(),
		txHash,
		blockers: blockerList,
		error: error
			? String(error instanceof Error ? error.message : error)
			: null,
	};
	if (!error && proof?.ok) {
		state.lastLiveAt = nowIso();
	}
	if (state.activeLiveRunId === runId) {
		state.activeLiveRunId = null;
		state.activeLiveStartedAt = null;
	}
	state.replay.runs = compactReplayRuns(
		state.replay.runs,
		parsePositiveInt(state.replay.maxEntries, 200),
	);
	state.updatedAt = nowIso();
}

function buildHistoryPath({ historyDir, runId }) {
	const stamp = nowIso().replace(/[:.]/g, "-");
	return path.join(historyDir, `${stamp}-${runId}.json`);
}

export async function runBscAutonomousCycle(
	rawArgs = process.argv.slice(2),
	env = process.env,
) {
	const args = parseArgs(rawArgs);
	const receiptChain = resolveReceiptChain(env);
	const startedAt = nowIso();
	const intent = buildIntent(args.runId, env);
	const transitionEvidence = evaluateCycleTransitionEvidence({
		raw:
			args.triggerJson ||
			String(env.HYPERLIQUID_AUTONOMOUS_TRIGGER_JSON || "").trim(),
		requiredCycleId: String(env.HYPERLIQUID_AUTONOMOUS_CYCLE_ID || "").trim(),
		env,
	});
	const confirm = String(
		env.HYPERLIQUID_AUTONOMOUS_CONFIRM_TEXT || "HYPERLIQUID_EXECUTE_LIVE",
	);
	const safety = createLiveSafetyContext(env);
	const state = await loadCycleState(args.statePath);
	let liveMarked = false;
	if (args.mode === "live") {
		guardAndMarkLiveRun({ state, runId: args.runId, safety });
		await writeJsonAtomic(args.statePath, state);
		liveMarked = true;
	}

	const requireOnchainTrigger =
		String(env.HYPERLIQUID_AUTONOMOUS_ONCHAIN_TRIGGER_REQUIRED || "true")
			.trim()
			.toLowerCase() === "true";
	const contractEntrypointEnabled =
		String(env.HYPERLIQUID_AUTONOMOUS_CONTRACT_ENTRYPOINT_ENABLED || "true")
			.trim()
			.toLowerCase() === "true";
	if (
		args.mode === "live" &&
		requireOnchainTrigger &&
		!transitionEvidence.verifiable &&
		!contractEntrypointEnabled
	) {
		const proof = {
			suite: "hyperliquid-autonomous-cycle",
			version: 2,
			startedAt,
			finishedAt: nowIso(),
			mode: args.mode,
			decision: "hold_blocked",
			intent,
			coreRouteSelection: {
				primaryFundingRoute: "hyperliquid_earn_core",
				selectedFundingRoute: "hyperliquid_earn_core",
				isCoreRoute: true,
				evidenceMarkers: ["ROUTE_CORE_HYPERLIQUID_EARN"],
			},
			cycleTransitionEvidence: transitionEvidence,
			txEvidence: {
				status: "blocked",
				txHash: null,
				blockers: transitionEvidence.blockers,
				reason: "onchain_trigger_unverifiable",
			},
			ok: false,
		};
		await mkdir(path.dirname(args.out), { recursive: true });
		await writeFile(args.out, `${JSON.stringify(proof, null, 2)}\n`);
		const historyPath = buildHistoryPath({
			historyDir: args.historyDir,
			runId: args.runId,
		});
		await writeJsonAtomic(historyPath, proof);
		if (liveMarked) {
			finalizeLiveRunState({ state, runId: args.runId, proof, error: null });
			await writeJsonAtomic(args.statePath, state);
		}
		return { ok: false, out: args.out, historyPath, proof };
	}

	const execArgs = [
		"--mode",
		args.mode,
		"--intent-json",
		JSON.stringify(intent),
		"--confirm",
		args.mode === "live" ? confirm : "",
		"--trigger-proof-json",
		JSON.stringify(transitionEvidence.onchainTrigger?.raw || {}),
	];

	let proof;
	try {
		const beforeSnapshot = runSnapshotCommand(
			env.HYPERLIQUID_AUTONOMOUS_RECONCILE_BEFORE_COMMAND ||
				env.HYPERLIQUID_AUTONOMOUS_RECONCILE_SNAPSHOT_COMMAND ||
				"",
			env,
			"before",
		);
		const execution = runHyperliquidExecSafe(execArgs, env);
		const afterSnapshot = runSnapshotCommand(
			env.HYPERLIQUID_AUTONOMOUS_RECONCILE_AFTER_COMMAND ||
				env.HYPERLIQUID_AUTONOMOUS_RECONCILE_SNAPSHOT_COMMAND ||
				"",
			env,
			"after",
		);
		const reconcileSnapshot = buildReconcileSnapshot(
			beforeSnapshot,
			afterSnapshot,
		);
		const decision = execution.ok
			? args.mode === "live"
				? "execute"
				: "simulate_execute"
			: "hold_blocked";
		const runtimeTransition = execution.evidence?.transition || null;
		const mergedTransitionEvidence = runtimeTransition
			? {
					verifiable: true,
					onchainTrigger: transitionEvidence.onchainTrigger,
					transition: runtimeTransition,
					blockers: [],
				}
			: transitionEvidence;
		proof = {
			suite: "hyperliquid-autonomous-cycle",
			version: 3,
			startedAt,
			finishedAt: nowIso(),
			mode: args.mode,
			decision,
			intent,
			coreRouteSelection: {
				primaryFundingRoute: "hyperliquid_earn_core",
				selectedFundingRoute: "hyperliquid_earn_core",
				isCoreRoute: true,
				evidenceMarkers: [
					"ROUTE_CORE_HYPERLIQUID_EARN",
					"FUNDING_PATH_PRIMARY",
				],
			},
			cycleTransitionEvidence: mergedTransitionEvidence,
			safety: {
				minLiveIntervalSeconds: safety.minIntervalSeconds,
				lockTtlSeconds: safety.lockTtlSeconds,
				statePath: args.statePath,
			},
			txEvidence: {
				status: execution.status,
				txHash:
					execution.txHash || transitionEvidence.onchainTrigger?.txHash || null,
				evidence: execution.evidence || null,
				emittedEvents:
					execution.evidence?.decodedEvents ||
					transitionEvidence.transition?.emittedEvents ||
					[],
				stateDelta:
					execution.evidence?.stateDelta ||
					transitionEvidence.transition?.stateDelta ||
					null,
				receiptNormalized: normalizeTxReceipt(
					{
						txHash: execution.txHash || null,
						status: execution.status,
						exitCode: execution?.evidence?.exitCode,
					},
					{ chain: receiptChain, runId: args.runId, mode: args.mode },
				),
				blockers: execution.blockers || [],
				reason: execution.reason || null,
			},
			reconcileSummary: summarizeReconcile(execution, reconcileSnapshot),
			ok: execution.ok,
		};
		await mkdir(path.dirname(args.out), { recursive: true });
		await writeFile(args.out, `${JSON.stringify(proof, null, 2)}\n`);
		const historyPath = buildHistoryPath({
			historyDir: args.historyDir,
			runId: args.runId,
		});
		await writeJsonAtomic(historyPath, proof);
		if (liveMarked) {
			finalizeLiveRunState({ state, runId: args.runId, proof, error: null });
			await writeJsonAtomic(args.statePath, state);
		}
		return { ok: proof.ok, out: args.out, historyPath, proof };
	} catch (error) {
		if (liveMarked) {
			finalizeLiveRunState({
				state,
				runId: args.runId,
				proof,
				error,
			});
			await writeJsonAtomic(args.statePath, state);
		}
		throw error;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runBscAutonomousCycle()
		.then((result) => {
			console.log(JSON.stringify(result, null, 2));
			if (!result.ok) process.exitCode = 1;
		})
		.catch((error) => {
			console.error(
				"[hyperliquid-autonomous-cycle] failed",
				error instanceof Error ? error.message : String(error),
			);
			process.exitCode = 1;
		});
}
