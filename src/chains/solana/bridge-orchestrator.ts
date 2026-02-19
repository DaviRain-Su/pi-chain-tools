import {
	type SolAgentBridgeAdapter,
	type SolAgentBridgeMode,
	type SolAgentTaskEnvelope,
	createSolanaBridgeAdapter,
} from "./sol-agent-bridge.js";

export type SolanaBridgeBatchMode = SolAgentBridgeMode;

export interface SolanaBridgeBatchTaskResult {
	taskId: string;
	accepted: boolean;
	status: "executed" | "rejected";
	reason?: string;
	result?: unknown;
}

export interface SolanaBridgeBatchRunResult {
	mode: SolanaBridgeBatchMode;
	totalTasks: number;
	executed: number;
	rejected: number;
	results: SolanaBridgeBatchTaskResult[];
}

function normalizeMode(mode: unknown): SolanaBridgeBatchMode {
	return mode === "research" ? "research" : "safe";
}

function hasMutatingIntent(task: SolAgentTaskEnvelope): boolean {
	const kind = String(task.kind || "").toLowerCase();
	const taskId = String(task.taskId || "").toLowerCase();
	const operationKind = String(
		task.metadata?.operationKind || "",
	).toLowerCase();
	const title = String(task.title || "").toLowerCase();
	const intent = String(task.intent || "").toLowerCase();
	const haystack = [kind, taskId, operationKind, title, intent].join(" ");
	return /(execute|mutate|transfer|swap|borrow|withdraw|supply|repay|bridge)/.test(
		haystack,
	);
}

function isReadPlanTask(task: SolAgentTaskEnvelope): boolean {
	const operationKind = task.metadata?.operationKind;
	if (operationKind === "read" || operationKind === "plan") {
		return true;
	}
	if (task.kind === "read" || task.kind === "task_discovery") {
		return true;
	}
	return false;
}

export function filterBridgeTasksForMode(args: {
	tasks: SolAgentTaskEnvelope[];
	mode?: SolanaBridgeBatchMode;
}): SolanaBridgeBatchTaskResult[] {
	const mode = normalizeMode(args.mode);
	return args.tasks.map((task) => {
		if (!isReadPlanTask(task)) {
			return {
				taskId: task.taskId,
				accepted: false,
				status: "rejected",
				reason: `task is not read/plan compatible in ${mode} mode`,
			};
		}
		if (hasMutatingIntent(task)) {
			return {
				taskId: task.taskId,
				accepted: false,
				status: "rejected",
				reason:
					"mutating/execute intents are blocked; use guarded confirm/policy/reconcile pipeline",
			};
		}
		return {
			taskId: task.taskId,
			accepted: true,
			status: "executed",
		};
	});
}

export async function runBridgeBatchReadPlanTasks(args?: {
	adapter?: SolAgentBridgeAdapter;
	tasks?: SolAgentTaskEnvelope[];
	mode?: SolanaBridgeBatchMode;
}): Promise<SolanaBridgeBatchRunResult> {
	const adapter = args?.adapter ?? createSolanaBridgeAdapter();
	const mode = normalizeMode(args?.mode);
	const tasks = args?.tasks ?? (await adapter.listTasks());
	const filtered = filterBridgeTasksForMode({ tasks, mode });
	const results: SolanaBridgeBatchTaskResult[] = [];

	for (const task of tasks) {
		const verdict = filtered.find((item) => item.taskId === task.taskId);
		if (!verdict?.accepted) {
			results.push(
				verdict ?? {
					taskId: task.taskId,
					accepted: false,
					status: "rejected",
					reason: "task rejected by safe-mode policy",
				},
			);
			continue;
		}
		const result = await adapter.read(task);
		results.push({
			taskId: task.taskId,
			accepted: true,
			status: "executed",
			result,
		});
	}

	const executed = results.filter((item) => item.status === "executed").length;
	const rejected = results.length - executed;
	return {
		mode,
		totalTasks: tasks.length,
		executed,
		rejected,
		results,
	};
}

export async function discoverBridgeReadPlanTasks(args?: {
	adapter?: SolAgentBridgeAdapter;
	mode?: SolanaBridgeBatchMode;
}): Promise<SolAgentTaskEnvelope[]> {
	const adapter = args?.adapter ?? createSolanaBridgeAdapter();
	const mode = normalizeMode(args?.mode);
	const tasks = await adapter.listTasks();
	const filtered = filterBridgeTasksForMode({ tasks, mode });
	const rejected = new Set(
		filtered.filter((item) => !item.accepted).map((item) => item.taskId),
	);
	return tasks.filter((task) => !rejected.has(task.taskId));
}
