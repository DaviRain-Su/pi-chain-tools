import {
	parseAsterDexConfig,
	resolveAsterDexExecuteBinding,
} from "./asterdex.js";

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
	| "AUTONOMOUS_ASTERDEX_EXECUTE_BINDING_UNAVAILABLE";

export type AutonomousBlocker = {
	code: AutonomousBlockerCode;
	reason: string;
	remediation: string;
};

export type DeterministicCycleConfig = {
	cycleId: string;
	intervalSeconds: number;
};

export type BscAutonomousDecisionEvidence = {
	autonomousMode: boolean;
	requestTrigger: ExecutionTrigger;
	requiredTrigger: "deterministic_contract_cycle";
	cycleConfigPresent: boolean;
	cycleConfig?: DeterministicCycleConfig;
	deterministicReady: boolean;
	asterDexExecuteBinding: "none" | "prepared" | "active";
	asterDexExecuteBindingRequired: boolean;
	asterDexExecuteBindingReady: boolean;
};

export type BscAutonomousDecision = {
	markers: ExecutionMarkers;
	allowed: boolean;
	blockers: AutonomousBlocker[];
	actions: string[];
	evidence: BscAutonomousDecisionEvidence;
};

export function isBscAutonomousModeEnabled(input?: {
	env?: Record<string, string | undefined>;
	defaultValue?: boolean;
}): boolean {
	const env = input?.env ?? process.env;
	const raw = env.BSC_AUTONOMOUS_MODE;
	if (raw == null || raw.trim() === "") {
		return input?.defaultValue ?? false;
	}
	return raw.trim().toLowerCase() === "true";
}

export function getBscExecutionMarkers(autonomous: boolean): ExecutionMarkers {
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
	const cycleId = env.BSC_AUTONOMOUS_CYCLE_ID?.trim() ?? "";
	const intervalRaw = env.BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS?.trim() ?? "";
	const intervalSeconds = Number.parseInt(intervalRaw, 10);
	if (!cycleId || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
		return null;
	}
	return { cycleId, intervalSeconds };
}

export function evaluateBscAutonomousPolicy(input?: {
	env?: Record<string, string | undefined>;
	requestTrigger?: ExecutionTrigger;
	requireAsterDexExecuteBinding?: boolean;
}): BscAutonomousDecision {
	const env = input?.env ?? process.env;
	const autonomousMode = isBscAutonomousModeEnabled({ env });
	const requestTrigger = input?.requestTrigger ?? "external";
	const markers = getBscExecutionMarkers(autonomousMode);
	const cycleConfig = parseDeterministicCycleConfig({ env });
	const asterDexConfig = parseAsterDexConfig({ env });
	const asterDexExecuteBinding = resolveAsterDexExecuteBinding(asterDexConfig);
	const asterDexExecuteBindingRequired =
		(input?.requireAsterDexExecuteBinding ?? autonomousMode === true)
			? asterDexConfig.executeBindingRequired
			: false;
	const blockers: AutonomousBlocker[] = [];
	const actions: string[] = [];

	if (autonomousMode && !cycleConfig) {
		blockers.push({
			code: "AUTONOMOUS_CYCLE_CONFIG_MISSING",
			reason:
				"Autonomous mode requires deterministic cycle config (cycle id + interval seconds).",
			remediation:
				"Set BSC_AUTONOMOUS_CYCLE_ID and BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS to deterministic values.",
		});
		actions.push(
			"Define deterministic cycle env vars before autonomous rollout (BSC_AUTONOMOUS_CYCLE_ID, BSC_AUTONOMOUS_CYCLE_INTERVAL_SECONDS).",
		);
	}

	if (autonomousMode && requestTrigger !== "deterministic_contract_cycle") {
		blockers.push({
			code: "AUTONOMOUS_EXTERNAL_TRIGGER_BLOCKED",
			reason:
				"External/manual trigger paths are blocked while autonomous mode is enabled.",
			remediation:
				"Route execution through deterministic contract cycle, or disable BSC_AUTONOMOUS_MODE for manual/testing paths.",
		});
		actions.push(
			"Use deterministic cycle trigger path only in autonomous mode; keep manual trigger for legacy mode.",
		);
	}

	if (autonomousMode && asterDexExecuteBindingRequired) {
		const bindingReady =
			asterDexExecuteBinding === "prepared" ||
			asterDexExecuteBinding === "active";
		if (!bindingReady) {
			blockers.push({
				code: "AUTONOMOUS_ASTERDEX_EXECUTE_BINDING_UNAVAILABLE",
				reason:
					"Autonomous mode requires AsterDEX execute-binding readiness, but binding is unavailable.",
				remediation:
					"Enable and configure AsterDEX execute binding (BSC_AUTONOMOUS_ASTERDEX_EXECUTE_BINDING_ENABLED=true with *_EXECUTE_COMMAND, *_ROUTER_ADDRESS, *_EXECUTOR_ADDRESS).",
			});
			actions.push(
				"Set AsterDEX execute binding envs and re-run autonomous rollout gate to verify readiness.",
			);
		}
	}

	if (!autonomousMode) {
		actions.push(
			"Legacy path active. Enable BSC_AUTONOMOUS_MODE=true to validate deterministic autonomous controls.",
		);
	}

	const evidence: BscAutonomousDecisionEvidence = {
		autonomousMode,
		requestTrigger,
		requiredTrigger: "deterministic_contract_cycle",
		cycleConfigPresent: cycleConfig != null,
		cycleConfig: cycleConfig ?? undefined,
		deterministicReady:
			autonomousMode &&
			requestTrigger === "deterministic_contract_cycle" &&
			cycleConfig != null,
		asterDexExecuteBinding,
		asterDexExecuteBindingRequired: Boolean(
			autonomousMode && asterDexExecuteBindingRequired,
		),
		asterDexExecuteBindingReady:
			autonomousMode !== true ||
			asterDexExecuteBindingRequired !== true ||
			asterDexExecuteBinding !== "none",
	};

	return {
		markers,
		allowed: blockers.length === 0,
		blockers,
		actions,
		evidence,
	};
}
