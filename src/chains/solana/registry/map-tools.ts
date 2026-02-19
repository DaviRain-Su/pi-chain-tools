import type { TSchema } from "@sinclair/typebox";
import type { RegisteredTool } from "../../../core/types.js";
import { createSolanaComposeTools } from "../tools/compose.js";
import { createSolanaReadTools } from "../tools/read.js";
import { createSolanaWorkflowTools } from "../tools/workflow.js";
import type {
	SolanaBridgeOperationDescriptor,
	SolanaBridgeOperationKind,
} from "./types.js";

function mapToolToDescriptor(args: {
	tool: RegisteredTool<TSchema, unknown>;
	operationKind: SolanaBridgeOperationKind;
	group: "read" | "compose" | "workflow";
	tags: readonly string[];
}): SolanaBridgeOperationDescriptor {
	const { tool, operationKind, group, tags } = args;
	return {
		id: `${operationKind}:${tool.name}`,
		operationKind,
		group,
		toolName: tool.name,
		label: tool.label,
		description: tool.description,
		tags,
		tool,
	};
}

export function createSolanaBridgeRegistryDescriptorsFromTools(args: {
	readTools: RegisteredTool<TSchema, unknown>[];
	composeTools: RegisteredTool<TSchema, unknown>[];
	workflowTools: RegisteredTool<TSchema, unknown>[];
}): SolanaBridgeOperationDescriptor[] {
	const readTools = args.readTools.map((tool) =>
		mapToolToDescriptor({
			tool,
			operationKind: "read",
			group: "read",
			tags: ["solana", "read", "bridge-discovery"],
		}),
	);
	const composeTools = args.composeTools.map((tool) =>
		mapToolToDescriptor({
			tool,
			operationKind: "plan",
			group: "compose",
			tags: ["solana", "plan", "bridge-discovery"],
		}),
	);
	const workflowTools = args.workflowTools.map((tool) =>
		mapToolToDescriptor({
			tool,
			operationKind: "plan",
			group: "workflow",
			tags: ["solana", "plan", "workflow", "bridge-discovery"],
		}),
	);
	return [...readTools, ...composeTools, ...workflowTools];
}

export function createSolanaBridgeRegistryDescriptors(): SolanaBridgeOperationDescriptor[] {
	return createSolanaBridgeRegistryDescriptorsFromTools({
		readTools: createSolanaReadTools(),
		composeTools: createSolanaComposeTools(),
		workflowTools: createSolanaWorkflowTools(),
	});
}

export function findSolanaBridgeDescriptorByTaskId(
	descriptors: readonly SolanaBridgeOperationDescriptor[],
	taskId: string,
): SolanaBridgeOperationDescriptor | null {
	return descriptors.find((descriptor) => descriptor.id === taskId) ?? null;
}
