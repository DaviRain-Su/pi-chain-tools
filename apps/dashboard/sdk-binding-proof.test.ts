import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const proofPath = path.resolve("docs", "sdk-binding-proof.md");
const proof = readFileSync(proofPath, "utf8");
const serverSource = readFileSync(
	path.resolve("apps", "dashboard", "server.mjs"),
	"utf8",
);

describe("sdk-binding-proof coherence", () => {
	it("documents all required protocols and packages", () => {
		expect(proof).toContain("Morpho");
		expect(proof).toContain("Venus");
		expect(proof).toContain("Wombat");
		expect(proof).toContain("Lista");
		expect(proof).toContain("LI.FI");
		expect(proof).toContain("@morpho-org/blue-sdk");
		expect(proof).toContain("@venusprotocol/chains");
		expect(proof).toContain("@wombat-exchange/configx");
		expect(proof).toContain("ethers");
		expect(proof).toContain("@lifi/sdk");
	});

	it("tracks runtime sdkBinding exposure in dashboard routes", () => {
		expect(serverSource).toContain("sdkBinding: buildBscSdkBindings");
		expect(serverSource).toContain("sdkBinding: buildMorphoSdkBinding");
		expect(serverSource).toContain("normalizeSdkBinding(");
	});
});
