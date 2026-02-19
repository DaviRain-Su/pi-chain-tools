import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverPath = path.resolve("apps", "dashboard", "server.mjs");
const serverSource = readFileSync(serverPath, "utf8");

describe("bsc direct swap endpoint", () => {
	it("enforces confirm gate and default token pair", () => {
		expect(serverSource).toContain(
			'url.pathname === "/api/bsc/swap" && req.method === "POST"',
		);
		expect(serverSource).toContain('error: "Missing confirm=true"');
		expect(serverSource).toContain(
			'const tokenIn = String(payload.tokenIn || "BNB").trim() || "BNB"',
		);
		expect(serverSource).toContain(
			'const tokenOut = String(payload.tokenOut || "USDT").trim() || "USDT"',
		);
	});

	it("returns txHash + receipt summary + boundary proof metadata", () => {
		expect(serverSource).toContain("receiptSummary");
		expect(serverSource).toContain("txHash: actionResult?.txHash || null");
		expect(serverSource).toContain("sdkBinding,");
		expect(serverSource).toContain("boundaryProof,");
	});
});
