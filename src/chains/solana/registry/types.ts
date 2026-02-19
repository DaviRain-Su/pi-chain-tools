import type { TSchema } from "@sinclair/typebox";
import type { RegisteredTool } from "../../../core/types.js";

export type SolanaBridgeOperationKind = "read" | "plan";

export interface SolanaBridgeOperationDescriptor {
	id: string;
	operationKind: SolanaBridgeOperationKind;
	group: "read" | "compose" | "workflow";
	toolName: string;
	label: string;
	description: string;
	tags: readonly string[];
	tool: RegisteredTool<TSchema, unknown>;
}
