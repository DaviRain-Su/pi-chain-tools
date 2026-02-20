import { describe, expect, it } from "vitest";

import {
	EVM_TRANSFER_POLICY_SCHEMA,
	EVM_TRANSFER_POLICY_STORE_SCHEMA,
	parseRunMode,
	resolveWorkflowRunMode,
} from "./index.js";

describe("w3rt-core index", () => {
	it("re-exports workflow helpers", () => {
		expect(parseRunMode("simulate")).toBe("simulate");
		expect(resolveWorkflowRunMode(undefined, "现在执行")).toBe("execute");
	});

	it("re-exports policy schema constants", () => {
		expect(EVM_TRANSFER_POLICY_SCHEMA).toBe("evm.transfer.policy.v1");
		expect(EVM_TRANSFER_POLICY_STORE_SCHEMA).toBe(
			"evm.transfer.policy.store.v1",
		);
	});
});
