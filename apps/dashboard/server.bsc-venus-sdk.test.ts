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

describe("bsc venus sdk-first read/plan routing", () => {
	it("contains venus sdk feature switch + fallback markers", () => {
		expect(serverSource).toContain("BSC_VENUS_USE_SDK");
		expect(serverSource).toContain("BSC_VENUS_SDK_PACKAGE");
		expect(serverSource).toContain("BSC_VENUS_COMPTROLLER");
		expect(serverSource).toContain("createVenusSdkAdapter(");
		expect(serverSource).toContain("collectVenusSdkMarketView(");
		expect(serverSource).toContain("collectVenusSdkPositionView(");
		expect(serverSource).toContain(
			"venus_sdk_market_fetch_failed_fallback_to_native",
		);
		expect(serverSource).toContain(
			"venus_sdk_position_fetch_failed_fallback_to_native",
		);
		expect(serverSource).toContain('dataSource: "native-fallback"');
		expect(serverSource).toContain("warnings:");
		expect(serverSource).toContain("sdk:");
	});

	it("documents venus sdk config in dashboard config example", () => {
		expect(configExample?.bsc?.venus?.useSdk).toBeTypeOf("boolean");
		expect(configExample?.bsc?.venus?.comptroller).toBeTypeOf("string");
		expect(configExample?.bsc?.venus?.sdk?.package).toBeTypeOf("string");
	});
});
