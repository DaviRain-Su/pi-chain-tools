import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const resilientPath = path.resolve("scripts", "ci-resilient.mjs");
const retryPath = path.resolve("scripts", "ci-retry.mjs");
const resilientSource = readFileSync(resilientPath, "utf8");
const retrySource = readFileSync(retryPath, "utf8");

describe("ci resilient hardening", () => {
	it("includes python precheck guard + deterministic metrics normalization", () => {
		expect(resilientSource).toContain("pythonPrecheckBlocked");
		expect(resilientSource).toContain(
			"precheck blocked: neither python nor python3 found in PATH",
		);
		expect(resilientSource).toContain("normalize-runtime-metrics.mjs");
	});

	it("adds SIGTERM retry handling in resilient and retry wrappers", () => {
		expect(resilientSource).toContain("runWithSigtermRetry");
		expect(resilientSource).toContain('signal === "SIGTERM"');
		expect(retrySource).toContain("CI_RETRY_SIGTERM_MAX");
		expect(retrySource).toContain("non-retryable precheck failure");
	});
});
