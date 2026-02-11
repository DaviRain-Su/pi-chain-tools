import { vi } from "vitest";

vi.mock("@cetusprotocol/cetus-sui-clmm-sdk", () => ({
	initCetusSDK: vi.fn(),
}));

import { describe, expect, it } from "vitest";
import suiExtension from "./sui-extension.js";

describe("suiExtension", () => {
	it("registers minimal Sui tool surface", () => {
		const names: string[] = [];
		const registrar = {
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		};

		suiExtension(registrar);
		expect(names.sort()).toEqual([
			"sui_buildCetusAddLiquidityTransaction",
			"sui_buildCetusRemoveLiquidityTransaction",
			"sui_buildSwapCetusTransaction",
			"sui_buildTransferCoinTransaction",
			"sui_buildTransferSuiTransaction",
			"sui_cetusAddLiquidity",
			"sui_cetusRemoveLiquidity",
			"sui_getBalance",
			"sui_getPortfolio",
			"sui_getSwapQuote",
			"sui_rpc",
			"sui_swapCetus",
			"sui_transferCoin",
			"sui_transferSui",
			"w3rt_run_sui_workflow_v0",
		]);
	});
});
