import { describe, expect, it } from "vitest";
import { parseSuiNetwork, toMist } from "./runtime.js";

describe("toMist", () => {
	it("converts valid SUI amounts to MIST", () => {
		expect(toMist(1)).toBe(1_000_000_000n);
		expect(toMist(0.000000001)).toBe(1n);
	});

	it("rejects non-positive amounts", () => {
		expect(() => toMist(0)).toThrow("positive");
		expect(() => toMist(-1)).toThrow("positive");
	});

	it("rejects amounts with more than 9 decimal places", () => {
		expect(() => toMist(0.0000000011)).toThrow("9 decimal places");
	});
});

describe("parseSuiNetwork", () => {
	it("normalizes mainnet aliases and defaults", () => {
		expect(parseSuiNetwork("mainnet-beta")).toBe("mainnet");
		expect(parseSuiNetwork("unknown")).toBe("mainnet");
		expect(parseSuiNetwork(undefined)).toBe("mainnet");
	});
});
