import type { Static, TSchema } from "@sinclair/typebox";

export interface RegisteredTool<
	TParams extends TSchema = TSchema,
	TDetails = unknown,
> {
	name: string;
	label: string;
	description: string;
	parameters: TParams;
	execute(
		toolCallId: string,
		params: Static<TParams>,
		...rest: unknown[]
	): Promise<{
		content: { type: string; text: string }[];
		details?: TDetails;
	}>;
}

export function defineTool<TParams extends TSchema>(
	tool: RegisteredTool<TParams, unknown>,
): RegisteredTool<TParams, unknown> {
	return tool;
}

export interface ToolRegistrar {
	registerTool<TParams extends TSchema = TSchema>(
		tool: RegisteredTool<TParams, unknown>,
	): void;
}

export type ChainToolGroupName = "read" | "compose" | "execute" | "rpc";

export interface ChainToolGroup {
	name: ChainToolGroupName;
	tools: RegisteredTool<TSchema, unknown>[];
}

export interface ChainToolset {
	chain: string;
	groups: ChainToolGroup[];
}
