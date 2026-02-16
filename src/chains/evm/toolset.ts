import type { ChainToolset } from "../../core/types.js";
import { createAgentWorkerTools } from "./tools/agent-worker.js";
import { createEvmComposeTools } from "./tools/compose.js";
import { createEvmExecuteTools } from "./tools/execute.js";
import { createLifiExecuteTools } from "./tools/lifi-execute.js";
import { createLifiReadTools } from "./tools/lifi-read.js";
import { createPrivyPolicyTools } from "./tools/privy-policy.js";
import { createEvmReadTools } from "./tools/read.js";
import { createEvmRpcTools } from "./tools/rpc.js";
import { createEvmSwapWorkflowTools } from "./tools/swap-workflow.js";
import { createEvmTransferWorkflowTools } from "./tools/transfer-workflow.js";
import { createVenusAgentTools } from "./tools/venus-agent.js";
import { createVenusExecuteTools } from "./tools/venus-execute.js";
import { createVenusReadTools } from "./tools/venus-read.js";
import { createVenusWorkflowTools } from "./tools/venus-workflow.js";
import { createEvmWorkflowTools } from "./tools/workflow.js";

export function createEvmToolset(): ChainToolset {
	return {
		chain: "evm",
		groups: [
			{
				name: "read",
				tools: [
					...createEvmReadTools(),
					...createVenusReadTools(),
					...createLifiReadTools(),
					...createPrivyPolicyTools(),
				],
			},
			{ name: "compose", tools: createEvmComposeTools() },
			{
				name: "execute",
				tools: [
					...createEvmExecuteTools(),
					...createEvmWorkflowTools(),
					...createEvmSwapWorkflowTools(),
					...createEvmTransferWorkflowTools(),
					...createVenusExecuteTools(),
					...createVenusWorkflowTools(),
					...createVenusAgentTools(),
					...createLifiExecuteTools(),
					...createAgentWorkerTools(),
				],
			},
			{ name: "rpc", tools: createEvmRpcTools() },
		],
	};
}
