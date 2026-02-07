import { describe, expect, it } from "vitest";
import { toLamports } from "./runtime.js";

describe("toLamports", () => {
	it("converts valid SOL amounts to lamports", () => {
		expect(toLamports(1)).toBe(1_000_000_000);
		expect(toLamports(0.000000001)).toBe(1);
	});

	it("rejects non-positive amounts", () => {
		expect(() => toLamports(0)).toThrow("positive");
		expect(() => toLamports(-1)).toThrow("positive");
	});

	it("rejects amounts with more than 9 decimal places", () => {
		expect(() => toLamports(0.0000000011)).toThrow("9 decimal places");
	});

	it("rejects amounts that overflow safe integer lamports", () => {
		expect(() => toLamports(9_007_199.254740993)).toThrow("too large");
	});
});
