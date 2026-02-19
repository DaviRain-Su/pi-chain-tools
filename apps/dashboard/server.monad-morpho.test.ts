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
	it("exposes readiness + plan + markets + rewards + execute routes", () => {
		expect(serverSource).toContain("/api/monad/morpho/earn/readiness");
		expect(serverSource).toContain("/api/monad/morpho/earn/plan");
		expect(serverSource).toContain("/api/monad/morpho/earn/markets");
		expect(serverSource).toContain("/api/monad/morpho/earn/strategy");
		expect(serverSource).toContain("/api/monad/morpho/earn/rewards");
		expect(serverSource).toContain("/api/monad/morpho/earn/rewards/claim");
		expect(serverSource).toContain("/api/monad/morpho/earn/execute");
		expect(serverSource).toContain("/api/monad/morpho/worker/start");
		expect(serverSource).toContain("/api/monad/morpho/worker/stop");
		expect(serverSource).toContain("/api/monad/morpho/worker/status");
		expect(serverSource).toContain("Missing confirm=true");
	});

	it("contains sdk-first execute routing with native emergency fallback + unified model", () => {
		expect(serverSource).toContain("function executeMonadMorphoDeposit(");
		expect(serverSource).toContain("executeMorphoDepositWithSdk(");
		expect(serverSource).toContain(
			"MONAD_MORPHO_SDK_EXECUTE_FALLBACK_TO_NATIVE",
		);
		expect(serverSource).toContain(
			"morpho_sdk_execute_failed_fallback_to_native",
		);
		expect(serverSource).toContain('mode: "native-fallback"');
		expect(serverSource).toContain("fallback: {");
		expect(serverSource).toContain("remainingNonSdkPath");
		expect(serverSource).toContain(
			"morpho_execute_tx_uses_canonical_ethers_signer_no_official_sdk_executor",
		);
		expect(serverSource).toContain(
			"morpho_execute_non_sdk_native_fallback_path",
		);
		expect(serverSource).toContain("morpho_execute_non_sdk_native_mode");
		expect(serverSource).toContain("function executeMonadMorphoDepositNative(");
		expect(serverSource).toContain("MONAD_DELEGATION_GATE_BLOCKED");
		expect(serverSource).toContain("delegation_gate_blocked");
		expect(serverSource).toContain("executionArtifact");
		expect(serverSource).toContain("executionReconciliation");
		expect(serverSource).toContain('action: "monad_morpho_earn_execute"');
		expect(serverSource).toContain("boundaryProof");
		expect(serverSource).toContain("buildExecutionBoundaryProof(");
		expect(serverSource).toContain("executeDetectors");
	});

	it("contains sdk markets/strategy branch with fallback warnings", () => {
		expect(serverSource).toContain("sdkBinding: buildMorphoSdkBinding(");
		expect(serverSource).toContain("MONAD_MORPHO_USE_SDK");
		expect(serverSource).toContain("collectMonadMorphoMarketsWithSdkFallback");
		expect(serverSource).toContain("collectMonadMorphoSdkSnapshot");
		expect(serverSource).toContain(
			"morpho_sdk_fetch_failed_fallback_to_native",
		);
		expect(serverSource).toContain("dataSource: marketView.mode");
		expect(serverSource).toContain("dataSource: strategyView.mode");
	});

	it("contains sdk rewards read/claim branch with fallback + normalized errors", () => {
		expect(serverSource).toContain("collectMonadMorphoRewardsWithSdkFallback");
		expect(serverSource).toContain("fetchRewards(");
		expect(serverSource).toContain("buildRewardsClaimRequest(");
		expect(serverSource).toContain(
			"morpho_sdk_rewards_fetch_failed_fallback_to_native",
		);
		expect(serverSource).toContain(
			"morpho_sdk_rewards_claim_build_failed_fallback_to_native",
		);
		expect(serverSource).toContain("classifyMonadMorphoRewardsClaimError");
		expect(serverSource).toContain("executionArtifact");
		expect(serverSource).toContain("executionReconciliation");
		expect(serverSource).toContain("monadMorphoRewardsClaimMetrics");
		expect(serverSource).toContain(
			'action: "monad_morpho_rewards_claim_execute"',
		);
	});

	it("documents monad config in dashboard config example", () => {
		expect(configExample?.monad?.rpcUrl).toBeTypeOf("string");
		expect(configExample?.monad?.execute?.enabled).toBeTypeOf("boolean");
		expect(configExample?.monad?.morpho?.vault).toBeTypeOf("string");
		expect(configExample?.monad?.morpho?.asset).toBeTypeOf("string");
		expect(configExample?.monad?.morpho?.useSdk).toBeTypeOf("boolean");
		expect(configExample?.monad?.morpho?.sdk?.apiBaseUrl).toBeTypeOf("string");
		expect(configExample?.monad?.morpho?.sdk?.package).toBeTypeOf("string");
		expect(
			configExample?.monad?.morpho?.sdk?.executeFallbackToNative,
		).toBeTypeOf("boolean");
		expect(configExample?.monad?.morpho?.sdk?.rewardsSource).toBeTypeOf(
			"string",
		);
		expect(configExample?.monad?.morpho?.sdk?.claimMode).toBeTypeOf("string");
		expect(configExample?.monad?.morpho?.maxAmountRaw).toBeTypeOf("string");
		expect(configExample?.monad?.morpho?.cooldownSeconds).toBeTypeOf("number");
		expect(configExample?.monad?.morpho?.dailyCapRaw).toBeTypeOf("string");
		expect(configExample?.monad?.morpho?.rewardsJson).toBeTypeOf("string");
		expect(configExample?.monad?.morpho?.rewardsClaim?.enabled).toBeTypeOf(
			"boolean",
		);
		expect(configExample?.monad?.morpho?.rewardsClaim?.command).toBeTypeOf(
			"string",
		);
		expect(configExample?.monad?.morpho?.strategyWeights?.apy).toBeTypeOf(
			"number",
		);
		expect(configExample?.monad?.morpho?.worker?.minIntervalMs).toBeTypeOf(
			"number",
		);
	});
});
