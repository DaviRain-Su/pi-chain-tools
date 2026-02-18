import { describe, expect, it } from "vitest";

import {
	collectListaSdkMarketView,
	collectListaSdkPositionView,
} from "./bsc-lista-sdk.mjs";
import {
	collectWombatSdkMarketView,
	collectWombatSdkPositionView,
} from "./bsc-wombat-sdk.mjs";

describe("bsc lista/wombat sdk-first read adapters", () => {
	const adapter = {
		provider: {
			call: async () => {
				throw new Error("rpc down");
			},
		},
		meta: {
			officialSdkWired: false,
			sdkPackage: "scaffold",
			warnings: [],
		},
	};

	it("normalizes lista market + position shape with sdk markers", async () => {
		const market = await collectListaSdkMarketView(adapter, {
			poolAddress: "",
			usdcToken: "",
			usdtToken: "",
			aprHints: {
				source: "lista-env-json",
				usdcSupplyAprBps: 123,
				usdtSupplyAprBps: 98,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		});
		expect(market.mode).toBe("sdk-scaffold");
		expect(market.lista.dataSource).toBe("sdk-scaffold");
		expect(market.lista.usdcSupplyAprBps).toBe(123);
		expect(market.warnings).toContain("lista_pool_missing_config");

		const position = await collectListaSdkPositionView(adapter, {
			accountAddress: "0x000000000000000000000000000000000000dEaD",
			usdcToken: "",
			usdtToken: "",
		});
		expect(position.mode).toBe("sdk-scaffold");
		expect(position.lista.usdc.dataSource).toBe("sdk-scaffold");
		expect(position.lista.usdc.balanceRaw).toBeTypeOf("string");
		expect(position.warnings).toContain("lista_usdc_token_missing_config");
	});

	it("normalizes wombat market + position shape with sdk markers", async () => {
		const market = await collectWombatSdkMarketView(adapter, {
			poolAddress: "",
			usdcToken: "",
			usdtToken: "",
			aprHints: {
				source: "wombat-env-json",
				usdcSupplyAprBps: 111,
				usdtSupplyAprBps: 77,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		});
		expect(market.mode).toBe("sdk-scaffold");
		expect(market.wombat.dataSource).toBe("sdk-scaffold");
		expect(market.wombat.usdtSupplyAprBps).toBe(77);
		expect(market.warnings).toContain("wombat_pool_missing_config");

		const position = await collectWombatSdkPositionView(adapter, {
			accountAddress: "0x000000000000000000000000000000000000dEaD",
			usdcToken: "",
			usdtToken: "",
		});
		expect(position.mode).toBe("sdk-scaffold");
		expect(position.wombat.usdc.dataSource).toBe("sdk-scaffold");
		expect(position.wombat.usdt.balanceRaw).toBeTypeOf("string");
		expect(position.warnings).toContain("wombat_usdt_token_missing_config");
	});
});
