import type { ChainToolset, RegisteredTool, ToolRegistrar } from "./types.js";

type ToolExecutionResult = Awaited<ReturnType<RegisteredTool["execute"]>>;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkflowToolName(name: string): boolean {
	return /^w3rt_run_/.test(name);
}

function resolveWorkflowSummaryLine(details: unknown): string | null {
	if (!isObjectRecord(details)) return null;
	const artifacts = isObjectRecord(details.artifacts)
		? details.artifacts
		: null;
	if (!artifacts) return null;

	const runMode =
		typeof details.runMode === "string" && details.runMode.trim()
			? details.runMode.trim()
			: null;
	const phaseFromRunMode =
		runMode === "analysis" || runMode === "simulate" || runMode === "execute"
			? runMode
			: null;
	const phaseOrder = phaseFromRunMode
		? [phaseFromRunMode, "execute", "simulate", "analysis"]
		: ["execute", "simulate", "analysis"];

	for (const phase of phaseOrder) {
		const phaseArtifact = artifacts[phase];
		if (!isObjectRecord(phaseArtifact)) continue;
		if (
			isObjectRecord(phaseArtifact.summary) &&
			typeof phaseArtifact.summary.line === "string" &&
			phaseArtifact.summary.line.trim()
		) {
			return phaseArtifact.summary.line.trim();
		}
		if (
			typeof phaseArtifact.summaryLine === "string" &&
			phaseArtifact.summaryLine.trim()
		) {
			return phaseArtifact.summaryLine.trim();
		}
	}

	return null;
}

function prioritizeWorkflowSummary(
	result: ToolExecutionResult,
): ToolExecutionResult {
	const summaryLine = resolveWorkflowSummaryLine(result.details);
	if (!summaryLine) return result;

	const originalContent = Array.isArray(result.content) ? result.content : [];
	if (
		originalContent[0]?.type === "text" &&
		typeof originalContent[0].text === "string" &&
		originalContent[0].text.trim() === summaryLine
	) {
		return result;
	}

	if (originalContent[0]?.type === "text") {
		return {
			...result,
			content: [
				{ ...originalContent[0], text: summaryLine },
				...originalContent.slice(1),
			],
		};
	}

	return {
		...result,
		content: [{ type: "text", text: summaryLine }, ...originalContent],
	};
}

function wrapToolForPiDisplay<T extends RegisteredTool>(tool: T): T {
	if (!isWorkflowToolName(tool.name)) {
		return tool;
	}

	return {
		...tool,
		async execute(toolCallId, params, ...rest) {
			const result = await tool.execute(toolCallId, params, ...rest);
			return prioritizeWorkflowSummary(result);
		},
	} as T;
}

export function registerChainToolsets(
	registrar: ToolRegistrar,
	toolsets: ChainToolset[],
): void {
	for (const toolset of toolsets) {
		for (const group of toolset.groups) {
			for (const tool of group.tools) {
				registrar.registerTool(wrapToolForPiDisplay(tool));
			}
		}
	}
}
