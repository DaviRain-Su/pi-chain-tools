import { describe, expect, it } from "vitest";
import {
	buildCapabilityDiff,
	renderCapabilityDiffMarkdown,
} from "./sdk-capability-diff.mjs";

const bindingProof = `
| Protocol | Action path | npm package | Source file + function | Path type | Blocker (if not full SDK) |
|---|---|---|---|---|---|
| Venus | Execute supply | @venusprotocol/chains | x | Canonical execute with SDK metadata | No public official Venus tx executor SDK on npm |
| Lista | Execute supply | ethers | x | Canonical execute | No maintained official Lista execute SDK package |
`;

describe("sdk-capability-diff", () => {
	it("classifies readiness deterministically without upstream", async () => {
		const rows = await buildCapabilityDiff({
			bindingProofMd: bindingProof,
			coverageReport: {
				entries: [
					{
						protocol: "Venus",
						action: "yield.execute",
						endpoint: "POST /api/bsc/yield/execute",
						currentMode: "canonical-client",
						blockers: ["no sdk execute"],
						codeMarkers: ["venus_detector"],
					},
					{
						protocol: "Morpho",
						action: "earn.markets",
						endpoint: "GET /api/monad/morpho/earn/markets",
						currentMode: "official-sdk",
						blockers: [],
					},
				],
			},
			readinessMd:
				"| Package | Installed | Execute Surface | Status | Next Action |\n|---|---:|---:|---|---|\n| @venusprotocol/chains | yes | no | blocked-no-execute-surface | keep fallback |",
			dependencies: {
				"@venusprotocol/chains": "^0.22.0",
				ethers: "^5.8.0",
			},
			upstream: false,
		});

		expect(
			rows.map((r) => `${r.protocol}:${r.action}:${r.recommendation}`),
		).toEqual(["Morpho:earn.markets:ready", "Venus:yield.execute:partial"]);

		const md = renderCapabilityDiffMarkdown(rows, {
			generatedAt: "2026-02-19T00:00:00.000Z",
			upstreamEnabled: false,
		});
		expect(md).toContain("# SDK Capability Diff");
		expect(md).toContain("Upstream check: disabled");
		expect(md).toContain("upstream check unavailable");
		expect(md).toContain("promotion recommendation: **partial**");
	});

	it("returns blocked for unknown mode with blockers", async () => {
		const rows = await buildCapabilityDiff({
			bindingProofMd: bindingProof,
			coverageReport: {
				entries: [
					{
						protocol: "Lista",
						action: "yield.execute",
						endpoint: "POST /api/bsc/yield/execute",
						currentMode: "unknown",
						blockers: ["sdk missing", "package missing"],
					},
				],
			},
			readinessMd: "",
			dependencies: {
				ethers: "^5.8.0",
			},
			upstream: false,
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.recommendation).toBe("blocked");
	});
});
