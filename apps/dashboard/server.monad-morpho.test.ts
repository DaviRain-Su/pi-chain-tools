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

describe("monad morpho earn mvp", () => {
	it("exposes readiness + markets + execute routes", () => {
		expect(serverSource).toContain("/api/monad/morpho/earn/readiness");
		expect(serverSource).toContain("/api/monad/morpho/earn/markets");
		expect(serverSource).toContain("/api/monad/morpho/earn/execute");
		expect(serverSource).toContain("Missing confirm=true");
	});

	it("contains native rpc deposit execution path + reconciliation", () => {
		expect(serverSource).toContain("function executeMonadMorphoDeposit(");
		expect(serverSource).toContain(
			"function deposit(uint256 assets,address receiver) returns (uint256 shares)",
		);
		expect(serverSource).toContain("executionArtifact");
		expect(serverSource).toContain("executionReconciliation");
		expect(serverSource).toContain('action: "monad_morpho_earn_execute"');
	});

	it("documents monad config in dashboard config example", () => {
		expect(configExample?.monad?.rpcUrl).toBeTypeOf("string");
		expect(configExample?.monad?.execute?.enabled).toBeTypeOf("boolean");
		expect(configExample?.monad?.morpho?.vault).toBeTypeOf("string");
		expect(configExample?.monad?.morpho?.asset).toBeTypeOf("string");
	});
});
