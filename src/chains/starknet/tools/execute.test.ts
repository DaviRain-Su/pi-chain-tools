import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

import { createStarknetExecuteTools } from "./execute.js";

type ExecuteTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{
		content: { type: string; text: string }[];
		details?: Record<string, unknown>;
	}>;
};

function getGuardedExecuteTool(): ExecuteTool {
	const tool = createStarknetExecuteTools().find(
		(entry) => entry.name === "starknet_executeIntentGuarded",
	);
	if (!tool) throw new Error("starknet_executeIntentGuarded not found");
	return tool as unknown as ExecuteTool;
}

describe("starknet guarded execute", () => {
	beforeEach(() => {
		execFileMock.mockReset();
		Reflect.deleteProperty(process.env, "STARKNET_EXECUTE_COMMAND");
		Reflect.deleteProperty(process.env, "STARKNET_EXECUTE_ADAPTER");
		Reflect.deleteProperty(
			process.env,
			"STARKNET_NATIVE_EXECUTE_COMMAND_MAINNET",
		);
		Reflect.deleteProperty(
			process.env,
			"STARKNET_NATIVE_EXECUTE_COMMAND_SEPOLIA",
		);
	});

	it("blocks execute without confirm=true and exposes guardrail marker", async () => {
		const tool = getGuardedExecuteTool();
		const out = await tool.execute("t1", {
			intent: "swap btc",
			dryRun: false,
			network: "sepolia",
		});
		expect(out.details?.ok).toBe(false);
		expect(out.details?.reason).toBe("missing_confirm_true");
		const execution = (out.details?.execution || {}) as Record<string, unknown>;
		expect(execution.resultMarker).toBe("guardrail_blocked");
		expect(execFileMock).not.toHaveBeenCalled();
	});

	it("falls back to command path when signer-native is requested", async () => {
		process.env.STARKNET_EXECUTE_ADAPTER = "signer-native";
		process.env.STARKNET_EXECUTE_COMMAND = "echo tx_hash:0xabc";
		execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
			cb(null, "tx_hash:0xabc", "");
		});
		const tool = getGuardedExecuteTool();
		const out = await tool.execute("t2", {
			intent: "swap btc",
			dryRun: false,
			confirm: true,
			network: "sepolia",
		});
		expect(out.details?.ok).toBe(true);
		expect(out.details?.execution).toMatchObject({
			adapterPreference: "signer-native",
			executeMode: "command",
			executePath: "command-fallback",
			resultMarker: "execute_success",
			fallbackReason:
				"signer_native_adapter_not_implemented_fallback_to_command",
		});
	});
});
