export const SOL_AGENT_BRIDGE_VERSION = "phase-a-readonly-v1" as const;

/**
 * Phase A safety contract:
 * - read/profile/task-discovery only
 * - no execute/mutate dispatch from this bridge
 * - mutating paths must continue through existing guarded runtime/tool pipeline
 */
export const SOL_AGENT_BRIDGE_ALLOWED_TASK_KINDS = [
	"read",
	"profile",
	"task_discovery",
] as const;

export type SolAgentBridgeTaskKind =
	(typeof SOL_AGENT_BRIDGE_ALLOWED_TASK_KINDS)[number];

export type SolAgentBridgeMode = "safe" | "research";

export interface SolAgentProfileDescriptor {
	id: string;
	label: string;
	description?: string;
	version?: string;
	capabilities: readonly SolAgentBridgeTaskKind[];
	mode: SolAgentBridgeMode;
	metadata?: Record<string, unknown>;
}

/**
 * Read-only task envelope for discovery/planning layers.
 * TODO(phase-b): map these envelopes to registry descriptors that still route
 * execution through existing compose/execute handlers with confirm+policy gates.
 */
export interface SolAgentTaskEnvelope {
	taskId: string;
	kind: SolAgentBridgeTaskKind;
	chain: "solana";
	title: string;
	intent?: string;
	inputs?: Record<string, unknown>;
	tags?: readonly string[];
	metadata?: Record<string, unknown>;
}

/**
 * Adapter boundary for sol-agent inspired discovery/profile surfaces.
 * Implementations must remain read-only in Phase A.
 */
export interface SolAgentBridgeAdapter {
	getProfile(): Promise<SolAgentProfileDescriptor> | SolAgentProfileDescriptor;
	listTasks(
		context?: Record<string, unknown>,
	): Promise<SolAgentTaskEnvelope[]> | SolAgentTaskEnvelope[];
	read(envelope: SolAgentTaskEnvelope): Promise<unknown> | unknown;
}

export function isSolAgentBridgeTaskKind(
	value: unknown,
): value is SolAgentBridgeTaskKind {
	return (
		typeof value === "string" &&
		(SOL_AGENT_BRIDGE_ALLOWED_TASK_KINDS as readonly string[]).includes(value)
	);
}

export function assertSolAgentBridgeTaskKind(
	value: unknown,
): SolAgentBridgeTaskKind {
	if (!isSolAgentBridgeTaskKind(value)) {
		throw new Error(
			`sol-agent bridge task kind must be one of: ${SOL_AGENT_BRIDGE_ALLOWED_TASK_KINDS.join(", ")}`,
		);
	}
	return value;
}

/**
 * Execute/mutation intents are intentionally not part of the bridge contract.
 * This helper exists to make tests and future call-site guards explicit.
 */
export function hasExecutePathOverride(
	envelope: { kind?: unknown; metadata?: Record<string, unknown> } | undefined,
): boolean {
	if (!envelope) {
		return false;
	}
	if (typeof envelope.kind === "string" && envelope.kind.includes("execute")) {
		return true;
	}
	const requestedPath = envelope.metadata?.executionPath;
	return typeof requestedPath === "string" && requestedPath === "override";
}
