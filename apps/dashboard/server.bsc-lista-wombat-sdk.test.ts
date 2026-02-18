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
const wombatExecutePath = path.resolve(
	"apps",
	"dashboard",
	"bsc-wombat-execute.mjs",
);
const wombatExecuteSource = readFileSync(wombatExecutePath, "utf8");

describe("bsc lista/wombat sdk-first read/plan routing", () => {
	it("contains lista/wombat sdk switches + fallback markers", () => {
		expect(serverSource).toContain("BSC_LISTA_USE_SDK");
		expect(serverSource).toContain("BSC_LISTA_SDK_PACKAGE");
		expect(serverSource).toContain("BSC_WOMBAT_USE_SDK");
		expect(serverSource).toContain("BSC_WOMBAT_SDK_PACKAGE");
		expect(serverSource).toContain("createListaSdkAdapter(");
		expect(serverSource).toContain("collectListaSdkMarketView(");
		expect(serverSource).toContain("collectListaSdkPositionView(");
		expect(serverSource).toContain("createWombatSdkAdapter(");
		expect(serverSource).toContain("collectWombatSdkMarketView(");
		expect(serverSource).toContain("collectWombatSdkPositionView(");
		expect(serverSource).toContain(
			"lista_sdk_market_fetch_failed_fallback_to_native",
		);
		expect(serverSource).toContain(
			"lista_sdk_position_fetch_failed_fallback_to_native",
		);
		expect(serverSource).toContain(
			"wombat_sdk_market_fetch_failed_fallback_to_native",
		);
		expect(serverSource).toContain(
			"wombat_sdk_position_fetch_failed_fallback_to_native",
		);
		expect(serverSource).toContain("dataSource:");
		expect(serverSource).toContain("sdk:");
		expect(serverSource).toContain("warnings:");
	});

	it("contains lista/wombat sdk-first execute routing + explicit fallback markers", () => {
		expect(serverSource).toContain("executeBscListaSupplyViaSdk");
		expect(serverSource).toContain("executeListaSupplySdkFirst");
		expect(serverSource).toContain("executeBscWombatSupplyViaSdk");
		expect(serverSource).toContain("executeWombatSupplySdkFirst");
		expect(serverSource).toContain("BSC_LISTA_EXECUTE_MODE");
		expect(serverSource).toContain("BSC_WOMBAT_EXECUTE_MODE");
		expect(serverSource).toContain("BSC_LISTA_SDK_FALLBACK_TO_NATIVE");
		expect(serverSource).toContain("BSC_WOMBAT_SDK_FALLBACK_TO_NATIVE");
		expect(serverSource).toContain("bsc_lista_supply_fallback");
		expect(serverSource).toContain(
			"lista_execute_non_sdk_native_fallback_path",
		);
		expect(serverSource).toContain(
			"lista_execute_non_sdk_command_fallback_path",
		);
		expect(serverSource).toContain("bsc_wombat_supply_fallback");
		expect(serverSource).toContain(
			"wombat_execute_non_sdk_native_fallback_path",
		);
		expect(serverSource).toContain(
			"wombat_execute_non_sdk_command_fallback_path",
		);
		expect(wombatExecuteSource).toContain(
			"wombat_execute_canonical_ethers_path_no_official_sdk_executor",
		);
		expect(serverSource).toContain("adapterProtocol");
		expect(serverSource).toContain('status: "success"');
		expect(serverSource).toContain("metrics: { durationMs");
	});

	it("documents lista/wombat sdk config in dashboard config example", () => {
		expect(configExample?.bsc?.lista?.useSdk).toBeTypeOf("boolean");
		expect(configExample?.bsc?.lista?.sdk?.package).toBeTypeOf("string");
		expect(configExample?.bsc?.lista?.sdk?.fallbackToNative).toBeTypeOf(
			"boolean",
		);
		expect(configExample?.bsc?.wombat?.useSdk).toBeTypeOf("boolean");
		expect(configExample?.bsc?.wombat?.sdk?.package).toBeTypeOf("string");
		expect(configExample?.bsc?.wombat?.sdk?.fallbackToNative).toBeTypeOf(
			"boolean",
		);
	});
});
