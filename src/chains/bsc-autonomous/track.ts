export type ExecutionTrack = "legacy" | "autonomous";
export type ExecutionGovernance = "onchain_only" | "hybrid";
export type ExecutionTrigger = "deterministic_contract_cycle" | "external";

export type ExecutionMarkers = {
	track: ExecutionTrack;
	governance: ExecutionGovernance;
	trigger: ExecutionTrigger;
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
