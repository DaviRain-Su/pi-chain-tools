import { describe, expect, it } from "vitest";

import {
	parseRunMode as parseRunModeCompat,
	resolveWorkflowRunMode as resolveWorkflowRunModeCompat,
} from "../src/chains/shared/workflow-runtime.js";
import { defineTool as defineToolCoreCompat } from "../src/core/types.js";
import {
	EVM_TRANSFER_POLICY_SCHEMA,
	type EvmTransferPolicy,
} from "../src/w3rt-core/index.js";
import { defineTool as defineToolW3rt } from "../src/w3rt-core/tool-types.js";
import {
	parseRunMode as parseRunModeW3rt,
	resolveWorkflowRunMode as resolveWorkflowRunModeW3rt,
} from "../src/w3rt-core/workflow-run-mode.js";

describe("w3rt-core phase-1 extraction", () => {
	it("keeps core/types and shared/workflow-runtime compatibility exports", () => {
		expect(defineToolCoreCompat).toBeTypeOf("function");
		expect(defineToolW3rt).toBeTypeOf("function");
		expect(parseRunModeCompat("execute")).toBe(parseRunModeW3rt("execute"));
		expect(resolveWorkflowRunModeCompat(undefined, "先模拟")).toBe(
			resolveWorkflowRunModeW3rt(undefined, "先模拟"),
		);
	});

	it("exports transfer policy schema/types from w3rt-core", () => {
		const policy: EvmTransferPolicy = {
			schema: EVM_TRANSFER_POLICY_SCHEMA,
			version: 1,
			updatedAt: new Date().toISOString(),
			updatedBy: null,
			note: null,
			mode: "open",
			enforceOn: "mainnet_like",
			allowedRecipients: [],
		};
		expect(policy.schema).toBe("evm.transfer.policy.v1");
	});
});
