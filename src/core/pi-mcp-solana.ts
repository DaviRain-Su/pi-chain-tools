import {
	type SolanaBridgeOperationDescriptor,
	createSolanaBridgeRegistryDescriptors,
	findSolanaBridgeDescriptorByTaskId,
} from "../chains/solana/registry/index.js";
import {
	PI_MCP_EXECUTE_BLOCKED,
	type PiMcpAdapter,
	type PiMcpRoute,
	type PiMcpRouteResult,
	createPiMcpAdapter,
} from "./pi-mcp-adapter.js";

const PI_MCP_TASK_NOT_FOUND = "PI_MCP_TASK_NOT_FOUND" as const;

export interface PiMcpDiscoverResponse {
	phase?: "read" | "plan";
	taskCount: number;
	tasks: Array<{
		taskId: string;
		phase: "read" | "plan";
		label: string;
		description?: string;
		toolName: string;
	}>;
}

export interface PiMcpRunResponse {
	status: "accepted" | "rejected";
	message: string;
	details?: Record<string, unknown>;
}

export interface PiMcpDashboardSummary {
	discoveredTaskCount: number;
	recentRuns: Array<{
		id: string;
		phase: string;
		intent: string;
		status: "accepted" | "rejected";
		message: string;
		at: string;
	}>;
	executeRejectionCount: number;
}

export interface PiMcpSolanaApi {
	discover(phase?: "read" | "plan"): PiMcpDiscoverResponse;
	run(input: unknown): Promise<PiMcpRunResponse>;
	getDashboardSummary(): PiMcpDashboardSummary;
}

function descriptorToTask(descriptor: SolanaBridgeOperationDescriptor) {
	return {
		taskId: descriptor.id,
		phase: descriptor.operationKind,
		label: descriptor.label,
		description: descriptor.description,
		toolName: descriptor.toolName,
	} as const;
}

function createSolanaPiMcpRoutes(
	descriptors: readonly SolanaBridgeOperationDescriptor[],
): PiMcpRoute[] {
	return [
		{
			id: "solana.registry.v1",
			description:
				"Routes PI-MCP read/plan envelopes into existing Solana read/compose/workflow handlers",
			supports: ["read", "plan"],
			canHandle(envelope) {
				return (
					typeof envelope.intent === "string" &&
					findSolanaBridgeDescriptorByTaskId(descriptors, envelope.intent) !==
						null
				);
			},
			async handleRead({ envelope }) {
				const descriptor = findSolanaBridgeDescriptorByTaskId(
					descriptors,
					envelope.intent,
				);
				if (!descriptor || descriptor.operationKind !== "read") {
					return {
						status: "rejected",
						message: PI_MCP_TASK_NOT_FOUND,
						details: {
							phase: envelope.phase,
							intent: envelope.intent,
						},
					};
				}
				const result = await descriptor.tool.execute(
					`pi-mcp:${envelope.id}`,
					envelope.payload as never,
				);
				return {
					status: "accepted",
					message: "PI_MCP_RUN_OK",
					details: {
						routeId: "solana.registry.v1",
						taskId: descriptor.id,
						phase: "read",
						result,
					},
				};
			},
			async handlePlan({ envelope }) {
				const descriptor = findSolanaBridgeDescriptorByTaskId(
					descriptors,
					envelope.intent,
				);
				if (!descriptor || descriptor.operationKind !== "plan") {
					return {
						status: "rejected",
						message: PI_MCP_TASK_NOT_FOUND,
						details: {
							phase: envelope.phase,
							intent: envelope.intent,
						},
					};
				}
				const result = await descriptor.tool.execute(
					`pi-mcp:${envelope.id}`,
					envelope.payload as never,
				);
				return {
					status: "accepted",
					message: "PI_MCP_RUN_OK",
					details: {
						routeId: "solana.registry.v1",
						taskId: descriptor.id,
						phase: "plan",
						result,
					},
				};
			},
		},
	];
}

export function createPiMcpSolanaApi(args?: {
	descriptors?: readonly SolanaBridgeOperationDescriptor[];
	adapter?: PiMcpAdapter;
	recentRunLimit?: number;
}): PiMcpSolanaApi {
	const descriptors =
		args?.descriptors ?? createSolanaBridgeRegistryDescriptors();
	const adapter =
		args?.adapter ?? createPiMcpAdapter(createSolanaPiMcpRoutes(descriptors));
	const recentRunLimit = Math.max(1, Math.min(50, args?.recentRunLimit ?? 10));
	let executeRejectionCount = 0;
	const recentRuns: PiMcpDashboardSummary["recentRuns"] = [];

	function pushRun(row: PiMcpDashboardSummary["recentRuns"][number]) {
		recentRuns.unshift(row);
		if (recentRuns.length > recentRunLimit) {
			recentRuns.length = recentRunLimit;
		}
	}

	return {
		discover(phase) {
			const tasks = descriptors
				.filter((descriptor) => !phase || descriptor.operationKind === phase)
				.map((descriptor) => descriptorToTask(descriptor));
			return {
				phase,
				taskCount: tasks.length,
				tasks,
			};
		},

		async run(input) {
			const routed = (await adapter.route(input)) as PiMcpRouteResult;
			const result =
				routed.message === "PI_MCP_ROUTE_NOT_FOUND"
					? {
							...routed,
							message: PI_MCP_TASK_NOT_FOUND,
						}
					: routed;
			const normalized = adapter.normalizeEnvelope(input);
			const envelope = normalized.envelope;
			if (result.message === PI_MCP_EXECUTE_BLOCKED) {
				executeRejectionCount += 1;
			}
			pushRun({
				id: envelope?.id ?? "invalid",
				phase: envelope?.phase ?? "invalid",
				intent: envelope?.intent ?? "invalid",
				status: result.status,
				message: result.message,
				at: new Date().toISOString(),
			});
			return result;
		},

		getDashboardSummary() {
			return {
				discoveredTaskCount: descriptors.length,
				recentRuns: [...recentRuns],
				executeRejectionCount,
			};
		},
	};
}

export { PI_MCP_TASK_NOT_FOUND };
