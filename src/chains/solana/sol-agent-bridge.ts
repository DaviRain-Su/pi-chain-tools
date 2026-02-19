import {
	type SolanaBridgeOperationDescriptor,
	createSolanaBridgeRegistryDescriptors,
	findSolanaBridgeDescriptorByTaskId,
} from "./registry/index.js";

export const SOL_AGENT_BRIDGE_VERSION =
	"phase-c-safe-orchestration-v1" as const;

/**
 * Safety contract:
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
 * Phase B routes discovered task ids back to existing handlers.
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

export function mapSolanaBridgeDescriptorToTaskEnvelope(
	descriptor: SolanaBridgeOperationDescriptor,
	context?: Record<string, unknown>,
): SolAgentTaskEnvelope {
	return {
		taskId: descriptor.id,
		kind: descriptor.operationKind === "read" ? "read" : "task_discovery",
		chain: "solana",
		title: descriptor.label,
		intent: descriptor.description,
		inputs: context,
		tags: descriptor.tags,
		metadata: {
			toolName: descriptor.toolName,
			group: descriptor.group,
			operationKind: descriptor.operationKind,
		},
	};
}

export function createSolanaBridgeAdapter(args?: {
	profile?: Partial<SolAgentProfileDescriptor>;
	toolCallId?: string;
}): SolAgentBridgeAdapter {
	const descriptors = createSolanaBridgeRegistryDescriptors();
	const toolCallId = args?.toolCallId ?? "sol-agent-bridge";
	return {
		getProfile: () => ({
			id: args?.profile?.id ?? "sol-agent-bridge",
			label: args?.profile?.label ?? "Sol Agent Bridge",
			description:
				args?.profile?.description ??
				"Registry-backed Solana task discovery mapped to existing handlers.",
			version: SOL_AGENT_BRIDGE_VERSION,
			capabilities: ["profile", "task_discovery", "read"],
			mode: args?.profile?.mode ?? "safe",
			metadata: {
				descriptorCount: descriptors.length,
				...(args?.profile?.metadata ?? {}),
			},
		}),
		listTasks: (context) =>
			descriptors.map((descriptor) =>
				mapSolanaBridgeDescriptorToTaskEnvelope(descriptor, context),
			),
		read: async (envelope) => {
			if (hasExecutePathOverride(envelope)) {
				throw new Error(
					"execute path overrides are not allowed in sol-agent bridge",
				);
			}
			const descriptor = findSolanaBridgeDescriptorByTaskId(
				descriptors,
				envelope.taskId,
			);
			if (!descriptor) {
				throw new Error(`sol-agent bridge task not found: ${envelope.taskId}`);
			}
			const result = await descriptor.tool.execute(
				toolCallId,
				(envelope.inputs ?? {}) as never,
			);
			return result;
		},
	};
}
