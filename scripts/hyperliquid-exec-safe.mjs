#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const DEFAULT_CONFIRM_TEXT = "HYPERLIQUID_EXECUTE_LIVE";
const TX_HASH_PATTERN = /0x[a-fA-F0-9]{64}/;

function parseBoolean(raw, fallback = false) {
	if (raw == null || String(raw).trim() === "") return fallback;
	return String(raw).trim().toLowerCase() === "true";
}

function parseArgs(rawArgs = process.argv.slice(2)) {
	const args = {
		mode: "dryrun",
		confirm: "",
		intentJson: String(rawArgs[0] || "").trim(),
		triggerProofJson: "",
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
			case "confirm":
				args.confirm = String(value).trim();
				break;
			case "intent-json":
				args.intentJson = String(value).trim();
				break;
			case "trigger-proof-json":
				args.triggerProofJson = String(value).trim();
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

function parseIntent(raw) {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed;
		return null;
	} catch {
		return null;
	}
}

function parseTriggerProof(raw) {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed;
		return null;
	} catch {
		return null;
	}
}

function parseStructuredOutput(text) {
	if (!text) return null;
	const trimmed = String(text).trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

function parseTxHashFromOutput(text) {
	if (!text) return null;
	const direct = String(text).match(TX_HASH_PATTERN);
	if (direct?.[0]) return direct[0];
	const parsed = parseStructuredOutput(text);
	const hash = parsed?.txHash || parsed?.transactionHash || parsed?.hash;
	return typeof hash === "string" && TX_HASH_PATTERN.test(hash) ? hash : null;
}

function applyTemplate(template, intent) {
	return template
		.replaceAll("{intent}", JSON.stringify(intent))
		.replaceAll("{runId}", String(intent.runId || ""))
		.replaceAll("{amountRaw}", String(intent.amountRaw || ""))
		.replaceAll("{tokenIn}", String(intent.tokenIn || ""))
		.replaceAll("{tokenOut}", String(intent.tokenOut || ""))
		.replaceAll("{routerAddress}", String(intent.routerAddress || ""))
		.replaceAll("{executorAddress}", String(intent.executorAddress || ""));
}

export function runHyperliquidExecSafe(
	rawArgs = process.argv.slice(2),
	env = process.env,
) {
	const args = parseArgs(rawArgs);
	const intent = parseIntent(args.intentJson);
	const triggerProof = parseTriggerProof(args.triggerProofJson);
	const verifiableOnchainTrigger =
		Boolean(triggerProof?.txHash) &&
		Boolean(triggerProof?.cycleId) &&
		Boolean(triggerProof?.transitionId) &&
		Boolean(triggerProof?.stateDelta?.previousState) &&
		Boolean(triggerProof?.stateDelta?.nextState);
	const confirmText = String(
		env.BSC_AUTONOMOUS_HYPERLIQUID_CONFIRM_TEXT || DEFAULT_CONFIRM_TEXT,
	);
	const maxAmountRaw = BigInt(
		String(
			env.BSC_AUTONOMOUS_HYPERLIQUID_MAX_AMOUNT_RAW || "1000000000000000000",
		),
	);
	const liveCommandTemplate = String(
		env.BSC_AUTONOMOUS_HYPERLIQUID_LIVE_COMMAND || "",
	).trim();
	if (!intent || !intent.amountRaw || !intent.runId) {
		return {
			ok: false,
			status: "blocked",
			reason: "invalid_intent",
			blockers: ["Intent JSON must include runId and amountRaw."],
		};
	}

	const amountRaw = BigInt(String(intent.amountRaw));
	if (amountRaw > maxAmountRaw) {
		return {
			ok: false,
			status: "blocked",
			reason: "amount_exceeds_cap",
			blockers: [
				`amountRaw exceeds configured cap (${maxAmountRaw.toString()}).`,
			],
			evidence: {
				runId: intent.runId,
				amountRaw: String(intent.amountRaw),
				maxAmountRaw: maxAmountRaw.toString(),
			},
		};
	}

	if (args.mode === "dryrun") {
		return {
			ok: true,
			status: "dryrun",
			reason: "not_executed",
			txHash: null,
			evidence: {
				runId: intent.runId,
				amountRaw: String(intent.amountRaw),
				commandConfigured: Boolean(liveCommandTemplate),
				primaryFundingRoute: "hyperliquid_earn_core",
				routeSelection: "core",
			},
		};
	}

	if (args.confirm !== confirmText && !verifiableOnchainTrigger) {
		return {
			ok: false,
			status: "blocked",
			reason: "confirm_mismatch",
			blockers: [
				`Live execution blocked: confirmation mismatch. Required input: --confirm ${confirmText} (or provide verifiable onchain trigger proof).`,
			],
			evidence: {
				expectedConfirmText: confirmText,
				runId: intent.runId,
				verifiableOnchainTrigger,
			},
		};
	}
	if (!parseBoolean(env.BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_ACTIVE, false)) {
		return {
			ok: false,
			status: "blocked",
			reason: "execute_binding_not_active",
			blockers: [
				"Live execution blocked: missing/disabled env key BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_ACTIVE=true",
			],
			evidence: {
				runId: intent.runId,
				missingEnvKeys: ["BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_ACTIVE"],
			},
		};
	}
	if (!liveCommandTemplate) {
		return {
			ok: false,
			status: "blocked",
			reason: "live_command_missing",
			blockers: [
				"Live execution blocked: missing env key BSC_AUTONOMOUS_HYPERLIQUID_LIVE_COMMAND",
			],
			evidence: {
				runId: intent.runId,
				missingEnvKeys: ["BSC_AUTONOMOUS_HYPERLIQUID_LIVE_COMMAND"],
			},
		};
	}

	const liveCommand = applyTemplate(liveCommandTemplate, intent);
	const commandResult = spawnSync(liveCommand, {
		shell: true,
		encoding: "utf8",
		env,
		timeout: Number.parseInt(
			String(env.BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_TIMEOUT_MS || "120000"),
			10,
		),
	});
	const stdout = String(commandResult.stdout || "").trim();
	const stderr = String(commandResult.stderr || "").trim();
	const stdoutJson = parseStructuredOutput(stdout);
	const stderrJson = parseStructuredOutput(stderr);
	const structured = stdoutJson || stderrJson || null;
	const txHash =
		parseTxHashFromOutput(stdout) ||
		parseTxHashFromOutput(stderr) ||
		(structured?.txHash ?? null);
	return {
		ok: commandResult.status === 0,
		status: commandResult.status === 0 ? "executed" : "failed",
		txHash: txHash || null,
		evidence: {
			runId: intent.runId,
			command: liveCommand,
			exitCode: commandResult.status,
			stdout: stdout.slice(-500),
			stderr: stderr.slice(-500),
			decodedEvents: structured?.emittedEvents || [],
			stateDelta: structured?.stateDelta || null,
			transition: structured?.transition || null,
			primaryFundingRoute: "hyperliquid_earn_core",
			routeSelection: "core",
			confirmationMode: verifiableOnchainTrigger
				? "onchain_trigger"
				: "manual_confirm",
			triggerProof: triggerProof || null,
		},
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		const result = runHyperliquidExecSafe();
		console.log(JSON.stringify(result, null, 2));
		if (!result.ok) process.exitCode = 1;
	} catch (error) {
		console.error(
			JSON.stringify(
				{
					ok: false,
					status: "failed",
					reason: error instanceof Error ? error.message : String(error),
				},
				null,
				2,
			),
		);
		process.exitCode = 1;
	}
}
