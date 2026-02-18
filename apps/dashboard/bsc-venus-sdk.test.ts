import { describe, expect, it } from "vitest";

import {
	collectVenusSdkMarketView,
	collectVenusSdkPositionView,
} from "./bsc-venus-sdk.mjs";

describe("bsc venus sdk scaffold adapter", () => {
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
				sdkPackage: "@venusprotocol/sdk",
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
		expect(view.venus.marketStats.usdc).toBeNull();
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
				sdkPackage: "@venusprotocol/sdk",
			},
		};
		const view = await collectVenusSdkPositionView(adapter, {
			accountAddress: "0x000000000000000000000000000000000000dEaD",
			usdcVToken: "",
			usdtVToken: "",
		});
		expect(view.mode).toBe("sdk-scaffold");
		expect(view.venus.usdc.missingConfig).toBe(true);
		expect(view.venus.usdt.missingConfig).toBe(true);
		expect(view.venus.usdc.dataSource).toBe("sdk-scaffold");
		expect(Array.isArray(view.warnings)).toBe(true);
	});
});
