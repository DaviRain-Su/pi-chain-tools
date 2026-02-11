import { vi } from "vitest";

vi.mock("@cetusprotocol/cetus-sui-clmm-sdk", () => ({
	initCetusSDK: vi.fn(),
}));

import { describe, expect, it } from "vitest";
import suiExtension from "./sui-extension.js";

describe("suiExtension", () => {
	it("registers minimal Sui tool surface once", () => {
		const names: string[] = [];
		const registrar = {
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		};

		suiExtension(registrar);
		suiExtension(registrar);
		expect(names.sort()).toEqual([
			"sui_buildCetusAddLiquidityTransaction",
			"sui_buildCetusFarmsHarvestTransaction",
			"sui_buildCetusFarmsStakeTransaction",
			"sui_buildCetusFarmsUnstakeTransaction",
			"sui_buildCetusRemoveLiquidityTransaction",
			"sui_buildStableLayerBurnTransaction",
			"sui_buildStableLayerClaimTransaction",
			"sui_buildStableLayerMintTransaction",
			"sui_buildSwapCetusTransaction",
			"sui_buildTransferCoinTransaction",
			"sui_buildTransferSuiTransaction",
			"sui_cetusAddLiquidity",
			"sui_cetusFarmsHarvest",
			"sui_cetusFarmsStake",
			"sui_cetusFarmsUnstake",
			"sui_cetusRemoveLiquidity",
			"sui_getBalance",
			"sui_getCetusFarmsPools",
			"sui_getCetusFarmsPositions",
			"sui_getCetusVaultsBalances",
			"sui_getDefiPositions",
			"sui_getPortfolio",
			"sui_getStableLayerSupply",
			"sui_getSwapQuote",
			"sui_rpc",
			"sui_stableLayerBurn",
			"sui_stableLayerClaim",
			"sui_stableLayerMint",
			"sui_swapCetus",
			"sui_transferCoin",
			"sui_transferSui",
			"w3rt_run_sui_cetus_farms_workflow_v0",
			"w3rt_run_sui_defi_workflow_v0",
			"w3rt_run_sui_stablelayer_workflow_v0",
			"w3rt_run_sui_workflow_v0",
		]);
	});
});
