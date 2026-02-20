import {
	parseHyperliquidConfig,
	resolveHyperliquidExecuteBinding,
} from "./hyperliquid.js";

export type ExecutionTrack = "legacy" | "autonomous";
export type ExecutionGovernance = "onchain_only" | "hybrid";
export type ExecutionTrigger = "deterministic_contract_cycle" | "external";

export type ExecutionMarkers = {
	track: ExecutionTrack;
	governance: ExecutionGovernance;
	trigger: ExecutionTrigger;
};

export type AutonomousBlockerCode =
	| "AUTONOMOUS_CYCLE_CONFIG_MISSING"
	| "AUTONOMOUS_EXTERNAL_TRIGGER_BLOCKED"
	| "AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_UNAVAILABLE";

export type AutonomousBlocker = {
	code: AutonomousBlockerCode;
	reason: string;
	remediation: string;
};

export type DeterministicCycleConfig = {
	cycleId: string;
	intervalSeconds: number;
};

export type HyperliquidAutonomousDecisionEvidence = {
	autonomousMode: boolean;
	requestTrigger: ExecutionTrigger;
	requiredTrigger: "deterministic_contract_cycle";
	cycleConfigPresent: boolean;
	cycleConfig?: DeterministicCycleConfig;
	deterministicReady: boolean;
	coreYieldEngine: "hyperliquid";
	hyperliquidExecuteBinding: "none" | "prepared" | "active";
	hyperliquidExecuteBindingRequired: boolean;
	hyperliquidExecuteBindingReady: boolean;
};

export type HyperliquidAutonomousDecision = {
	markers: ExecutionMarkers;
	allowed: boolean;
	blockers: AutonomousBlocker[];
	actions: string[];
	evidence: HyperliquidAutonomousDecisionEvidence;
};

const warnedDeprecatedKeys = new Set<string>();

function readEnvWithDeprecatedFallback(
	env: Record<string, string | undefined>,
	canonicalKey: string,
	deprecatedKey: string,
): string | undefined {
	const canonicalValue = env[canonicalKey];
	if (canonicalValue != null && canonicalValue.trim() !== "")
		return canonicalValue;
	const deprecatedValue = env[deprecatedKey];
	if (deprecatedValue != null && deprecatedValue.trim() !== "") {
		if (!warnedDeprecatedKeys.has(deprecatedKey)) {
			warnedDeprecatedKeys.add(deprecatedKey);
			console.warn(
				`[deprecation] ${deprecatedKey} is deprecated. Use ${canonicalKey} instead.`,
			);
		}
		return deprecatedValue;
	}
	return undefined;
}

export function isHyperliquidAutonomousModeEnabled(input?: {
	env?: Record<string, string | undefined>;
	defaultValue?: boolean;
}): boolean {
	const env = input?.env ?? process.env;
	const raw = readEnvWithDeprecatedFallback(
		env,
		"HYPERLIQUID_AUTONOMOUS_MODE",
		"BSC_AUTONOMOUS_MODE",
	);
	if (raw == null || raw.trim() === "") {
		return input?.defaultValue ?? false;
	}
	return raw.trim().toLowerCase() === "true";
}

export function getHyperliquidExecutionMarkers(
	autonomous: boolean,
): ExecutionMarkers {
	if (autonomous) {
		return {
			track: "autonomous",
			governance: "hybrid",
			trigger: "deterministic_contract_cycle",
		};
	}
	return {
		track: "legacy",
		governance: "onchain_only",
		trigger: "external",
	};
}

export function parseDeterministicCycleConfig(input?: {
	env?: Record<string, string | undefined>;
}): DeterministicCycleConfig | null {
	const env = input?.env ?? process.env;
	const cycleId =
		readEnvWithDeprecatedFallback(
			env,
			"HYPERLIQUID_AUTONOMOUS_CYCLE_ID",
			"BSC_AUTONOMOUS_CYCLE_ID",
		)?.trim() ?? "";
	const intervalRaw =
		readEnvWithDeprecatedFallback(
			env,
			"HYPERLIQUID_AUTONOMOUS_CYCLE_INTERVAL_SECONDS",
			"BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS",
		)?.trim() ?? "";
	const intervalSeconds = Number.parseInt(intervalRaw, 10);
	if (!cycleId || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
		return null;
	}
	return { cycleId, intervalSeconds };
}

export function evaluateHyperliquidAutonomousPolicy(input?: {
	env?: Record<string, string | undefined>;
	requestTrigger?: ExecutionTrigger;
	requireHyperliquidExecuteBinding?: boolean;
}): HyperliquidAutonomousDecision {
	const env = input?.env ?? process.env;
	const autonomousMode = isHyperliquidAutonomousModeEnabled({ env });
	const requestTrigger = input?.requestTrigger ?? "external";
	const markers = getHyperliquidExecutionMarkers(autonomousMode);
	const cycleConfig = parseDeterministicCycleConfig({ env });
	const hyperliquidConfig = parseHyperliquidConfig({ env });
	const hyperliquidExecuteBinding =
		resolveHyperliquidExecuteBinding(hyperliquidConfig);
	const hyperliquidExecuteBindingRequired =
		(input?.requireHyperliquidExecuteBinding ?? autonomousMode === true)
			? hyperliquidConfig.executeBindingRequired
			: false;
	const blockers: AutonomousBlocker[] = [];
	const actions: string[] = [];

	if (autonomousMode && !cycleConfig) {
		blockers.push({
			code: "AUTONOMOUS_CYCLE_CONFIG_MISSING",
			reason:
				"Autonomous mode requires deterministic cycle config (cycle id + interval seconds).",
			remediation:
				"Set HYPERLIQUID_AUTONOMOUS_CYCLE_ID and HYPERLIQUID_AUTONOMOUS_CYCLE_INTERVAL_SECONDS to deterministic values.",
		});
		actions.push(
			"Define deterministic cycle env vars before autonomous rollout (HYPERLIQUID_AUTONOMOUS_CYCLE_ID, HYPERLIQUID_AUTONOMOUS_CYCLE_INTERVAL_SECONDS).",
		);
	}

	if (autonomousMode && requestTrigger !== "deterministic_contract_cycle") {
		blockers.push({
			code: "AUTONOMOUS_EXTERNAL_TRIGGER_BLOCKED",
			reason:
				"External/manual trigger paths are blocked while autonomous mode is enabled.",
			remediation:
				"Route execution through deterministic contract cycle, or disable HYPERLIQUID_AUTONOMOUS_MODE for manual/testing paths.",
		});
		actions.push(
			"Use deterministic cycle trigger path only in autonomous mode; keep manual trigger for legacy mode.",
		);
	}

	if (autonomousMode && hyperliquidExecuteBindingRequired) {
		const bindingReady =
			hyperliquidExecuteBinding === "prepared" ||
			hyperliquidExecuteBinding === "active";
		if (!bindingReady) {
			blockers.push({
				code: "AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_UNAVAILABLE",
				reason:
					"Autonomous mode requires Hyperliquid execute-binding readiness, but binding is unavailable.",
				remediation:
					"Enable and configure Hyperliquid execute binding (HYPERLIQUID_AUTONOMOUS_EXECUTE_BINDING_ENABLED=true with *_EXECUTE_COMMAND, *_ROUTER_ADDRESS, *_EXECUTOR_ADDRESS).",
			});
			actions.push(
				"Set Hyperliquid execute binding envs and re-run autonomous rollout gate to verify readiness.",
			);
		}
	}

	if (!autonomousMode) {
		actions.push(
			"Legacy path active. Enable HYPERLIQUID_AUTONOMOUS_MODE=true to validate deterministic autonomous controls.",
		);
	}

	const evidence: HyperliquidAutonomousDecisionEvidence = {
		autonomousMode,
		requestTrigger,
		requiredTrigger: "deterministic_contract_cycle",
		cycleConfigPresent: cycleConfig != null,
		cycleConfig: cycleConfig ?? undefined,
		deterministicReady:
			autonomousMode &&
			requestTrigger === "deterministic_contract_cycle" &&
			cycleConfig != null,
		coreYieldEngine: "hyperliquid",
		hyperliquidExecuteBinding,
		hyperliquidExecuteBindingRequired: Boolean(
			autonomousMode && hyperliquidExecuteBindingRequired,
		),
		hyperliquidExecuteBindingReady:
			autonomousMode !== true ||
			hyperliquidExecuteBindingRequired !== true ||
			hyperliquidExecuteBinding !== "none",
	};

	return {
		markers,
		allowed: blockers.length === 0,
		blockers,
		actions,
		evidence,
	};
}

// temporary one-release compatibility aliases
export type BscAutonomousDecisionEvidence =
	HyperliquidAutonomousDecisionEvidence;
export type BscAutonomousDecision = HyperliquidAutonomousDecision;
export const isBscAutonomousModeEnabled = isHyperliquidAutonomousModeEnabled;
export const getBscExecutionMarkers = getHyperliquidExecutionMarkers;
export const evaluateBscAutonomousPolicy = evaluateHyperliquidAutonomousPolicy;
