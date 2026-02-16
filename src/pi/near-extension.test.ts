import { describe, expect, it } from "vitest";
import nearExtension from "./near-extension.js";

describe("nearExtension", () => {
	it("registers near tools once", () => {
		const names: string[] = [];
		const registrar = {
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		};

		nearExtension(registrar);
		nearExtension(registrar);

		expect(names.sort()).toEqual([
			"near_addLiquidityRef",
			"near_borrowBurrow",
			"near_broadcastSignedTransaction",
			"near_buildAddLiquidityRefTransaction",
			"near_buildBorrowBurrowTransaction",
			"near_buildIntentsSwapDepositTransaction",
			"near_buildRefWithdrawTransaction",
			"near_buildRemoveLiquidityRefTransaction",
			"near_buildRepayBurrowTransaction",
			"near_buildSupplyBurrowTransaction",
			"near_buildSwapRefTransaction",
			"near_buildTransferFtTransaction",
			"near_buildTransferNearTransaction",
			"near_buildWithdrawBurrowTransaction",
			"near_getAccount",
			"near_getBalance",
			"near_getFtBalance",
			"near_getIntentsAnyInputWithdrawals",
			"near_getIntentsExplorerTransactions",
			"near_getIntentsQuote",
			"near_getIntentsStatus",
			"near_getIntentsTokens",
			"near_getLendingMarketsBurrow",
			"near_getLendingPositionsBurrow",
			"near_getPortfolio",
			"near_getRefDeposits",
			"near_getRefLpPositions",
			"near_getStableYieldPlan",
			"near_getSwapQuoteRef",
			"near_removeLiquidityRef",
			"near_repayBurrow",
			"near_rpc",
			"near_submitIntentsDeposit",
			"near_supplyBurrow",
			"near_swapRef",
			"near_transferFt",
			"near_transferNear",
			"near_withdrawBurrow",
			"near_withdrawRefToken",
			"near_yieldWorkerStart",
			"near_yieldWorkerStatus",
			"near_yieldWorkerStop",
			"w3rt_run_near_workflow_v0",
		]);
	});
});
