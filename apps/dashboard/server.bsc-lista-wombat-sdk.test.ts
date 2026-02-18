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
