import { describe, expect, it } from "vitest";

import {
	collectVenusSdkMarketView,
	collectVenusSdkPositionView,
	createVenusSdkAdapter,
} from "./bsc-venus-sdk.mjs";

describe("bsc venus sdk scaffold adapter", () => {
	it("wires official venus package for sdk-first reads", async () => {
		const adapter = await createVenusSdkAdapter({
			rpcUrl: "http://127.0.0.1:8545",
			chainId: 56,
			sdkPackage: "@venusprotocol/chains",
		});
		expect(adapter.meta.officialSdkWired).toBe(true);
		expect(adapter.meta.client).toBe("venus-sdk");
		expect(adapter.meta.sdkPackage).toBe("@venusprotocol/chains");
		expect(adapter.meta.sdkBinding).toMatchObject({
			package: "@venusprotocol/chains",
			importMode: "static",
			loaded: true,
		});
	});
	it("normalizes market view into dashboard-compatible venus shape", async () => {
		const adapter = {
			provider: {
				call: async () => {
					throw new Error("rpc down");
				},
			},
			config: { comptroller: "" },
			meta: {
				officialSdkWired: false,
				sdkPackage: "@venusprotocol/chains",
			},
		};
		const view = await collectVenusSdkMarketView(adapter, {
			usdcVToken: "",
			usdtVToken: "",
			aprHints: {
				source: "venus-env-json",
				usdtSupplyAprBps: 101,
				usdcSupplyAprBps: 202,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		});
		expect(view.mode).toBe("sdk-scaffold");
		expect(view.venus.usdcSupplyAprBps).toBe(202);
		expect(view.venus.usdtSupplyAprBps).toBe(101);
		expect(view.venus.dataSource).toBe("sdk-scaffold");
		expect(Array.isArray(view.venus.warnings)).toBe(true);
		expect(view.venus.marketStats.usdc?.vToken).toBeTypeOf("string");
		expect(view.warnings).toContain(
			"venus_usdc_vtoken_defaulted_from_official_registry",
		);
	});

	it("normalizes position view with fallback-friendly token rows", async () => {
		const adapter = {
			provider: {
				call: async () => {
					throw new Error("rpc down");
				},
			},
			config: { comptroller: "" },
			meta: {
				officialSdkWired: false,
				sdkPackage: "@venusprotocol/chains",
			},
		};
		const view = await collectVenusSdkPositionView(adapter, {
			accountAddress: "0x000000000000000000000000000000000000dEaD",
			usdcVToken: "",
			usdtVToken: "",
		});
		expect(view.mode).toBe("sdk-scaffold");
		expect(view.venus.usdc.token).toBeTypeOf("string");
		expect(view.venus.usdt.token).toBeTypeOf("string");
		expect(view.venus.usdc.dataSource).toBe("sdk-scaffold");
		expect(Array.isArray(view.warnings)).toBe(true);
		expect(view.warnings).toContain(
			"venus_usdc_vtoken_defaulted_from_official_registry",
		);
		expect(view.warnings).toContain(
			"venus_usdt_vtoken_defaulted_from_official_registry",
		);
	});
});
