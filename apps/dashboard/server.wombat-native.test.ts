import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverPath = path.resolve("apps", "dashboard", "server.mjs");
const serverSource = readFileSync(serverPath, "utf8");

const configPath = path.resolve(
	"apps",
	"dashboard",
	"config",
	"dashboard.config.example.json",
);
const configExample = JSON.parse(readFileSync(configPath, "utf8"));

describe("wombat native slot execution path", () => {
	it("uses direct native rpc path for wombat post-action supply", () => {
		expect(serverSource).toContain('provider: "wombat-native-rpc"');
		expect(serverSource).toContain("message=bsc_wombat_pool_missing");
		expect(serverSource).toContain("message=bsc_wombat_private_key_missing");
		expect(serverSource).toContain(
			"function deposit(address token,uint256 amount,uint256 minimumLiquidity,address to,uint256 deadline,bool shouldStake)",
		);
	});

	it("keeps native readiness model config-driven by pool+key", () => {
		expect(serverSource).toContain(
			"wombat: Boolean(BSC_WOMBAT_POOL && BSC_WOMBAT_EXECUTE_PRIVATE_KEY)",
		);
		expect(serverSource).not.toContain("wombat-native-slot-command");
	});

	it("documents config example fields for wombat native execution", () => {
		expect(configExample?.bsc?.wombat?.pool).toBeTypeOf("string");
		expect(configExample?.bsc?.wombat?.privateKey).toBeTypeOf("string");
		expect(configExample?.bsc?.wombat?.minLiquidityRaw).toBeTypeOf("string");
		expect(configExample?.bsc?.wombat?.deadlineSeconds).toBeTypeOf("number");
		expect(configExample?.bsc?.wombat?.shouldStake).toBeTypeOf("boolean");
		expect(configExample?.bsc?.wombat?.nativeExecuteCommand).toBeUndefined();
	});
});
