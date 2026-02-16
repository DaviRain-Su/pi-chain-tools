/**
 * LTV Decision MCP tool — exposes the LTV Manager as a callable tool.
 *
 * Pure compute: takes position data + config → returns action decision.
 * No chain interaction, no signing. Useful for OpenClaw playbook orchestration.
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { EVM_TOOL_PREFIX } from "../runtime.js";
import {
	type AgentConfig,
	DEFAULT_AGENT_CONFIG,
	decideLtvAction,
} from "./ltv-manager.js";

export function createLtvDecisionTools() {
	return [
		defineTool({
			name: `${EVM_TOOL_PREFIX}ltvDecide`,
			label: "LTV Decision",
			description:
				"Pure compute: given current position data and agent config, decide whether to hold, repay, or optimize. " +
				"No chain interaction. Returns action + suggested amounts. " +
				"Use in OpenClaw playbooks between position-read and execute steps.",
			parameters: Type.Object({
				collateralValueUsd: Type.Number({
					minimum: 0,
					description: "Current collateral value in USD",
				}),
				borrowValueUsd: Type.Number({
					minimum: 0,
					description: "Current borrow value in USD",
				}),
				supplyAPY: Type.Number({
					description: "Supply/yield APY (0..100 scale, e.g. 3.5 = 3.5%)",
				}),
				borrowAPR: Type.Number({
					description: "Borrow APR (0..100 scale)",
				}),
				maxLTV: Type.Optional(
					Type.Number({
						minimum: 0.01,
						maximum: 0.99,
						description: "Max LTV before auto-repay (default 0.75)",
					}),
				),
				targetLTV: Type.Optional(
					Type.Number({
						minimum: 0.01,
						maximum: 0.99,
						description: "Target LTV for normal operation (default 0.60)",
					}),
				),
				minYieldSpread: Type.Optional(
					Type.Number({
						minimum: 0,
						maximum: 1,
						description:
							"Min yield spread (APY - APR) for optimize (default 0.02)",
					}),
				),
				paused: Type.Optional(
					Type.Boolean({
						description: "Kill switch — suppress all actions (default false)",
					}),
				),
			}),
			async execute(_toolCallId, params) {
				const config: AgentConfig = {
					maxLTV: params.maxLTV ?? DEFAULT_AGENT_CONFIG.maxLTV,
					targetLTV: params.targetLTV ?? DEFAULT_AGENT_CONFIG.targetLTV,
					minYieldSpread:
						params.minYieldSpread ?? DEFAULT_AGENT_CONFIG.minYieldSpread,
					paused: params.paused ?? DEFAULT_AGENT_CONFIG.paused,
				};

				const decision = decideLtvAction({
					collateralValueUsd: params.collateralValueUsd,
					borrowValueUsd: params.borrowValueUsd,
					supplyAPY: params.supplyAPY,
					borrowAPR: params.borrowAPR,
					config,
				});

				return {
					content: [
						{
							type: "text",
							text: `LTV Decision: ${decision.action.toUpperCase()} — ${decision.reason}`,
						},
					],
					details: {
						schema: "evm.ltv.decision.v1",
						decision,
						config,
						input: {
							collateralValueUsd: params.collateralValueUsd,
							borrowValueUsd: params.borrowValueUsd,
							supplyAPY: params.supplyAPY,
							borrowAPR: params.borrowAPR,
						},
					},
				};
			},
		}),
	];
}
