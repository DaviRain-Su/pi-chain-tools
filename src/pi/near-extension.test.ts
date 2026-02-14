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
			"near_broadcastSignedTransaction",
			"near_buildAddLiquidityRefTransaction",
			"near_buildIntentsSwapDepositTransaction",
			"near_buildRefWithdrawTransaction",
			"near_buildRemoveLiquidityRefTransaction",
			"near_buildSwapRefTransaction",
			"near_buildTransferFtTransaction",
			"near_buildTransferNearTransaction",
			"near_getAccount",
			"near_getBalance",
			"near_getFtBalance",
			"near_getIntentsAnyInputWithdrawals",
			"near_getIntentsExplorerTransactions",
			"near_getIntentsQuote",
			"near_getIntentsStatus",
			"near_getIntentsTokens",
			"near_getPortfolio",
			"near_getRefDeposits",
			"near_getRefLpPositions",
			"near_getSwapQuoteRef",
			"near_removeLiquidityRef",
			"near_rpc",
			"near_submitIntentsDeposit",
			"near_swapRef",
			"near_transferFt",
			"near_transferNear",
			"near_withdrawRefToken",
			"w3rt_run_near_workflow_v0",
		]);
	});
});
