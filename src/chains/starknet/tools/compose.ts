import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import { STARKNET_TOOL_PREFIX } from "../runtime.js";

export function createStarknetComposeTools() {
	return [
		defineTool({
			name: `${STARKNET_TOOL_PREFIX}_planBtcPrivacyStrategy`,
			label: "Plan BTC/Privacy Strategy (Starknet)",
			description:
				"Create a non-executing strategy plan for Re{define} tracks (privacy + bitcoin)",
			parameters: Type.Object({
				track: Type.Union([
					Type.Literal("privacy"),
					Type.Literal("bitcoin"),
					Type.Literal("hybrid"),
				]),
				amountUsd: Type.Optional(Type.Number({ minimum: 1 })),
				riskLevel: Type.Optional(
					Type.Union([
						Type.Literal("low"),
						Type.Literal("medium"),
						Type.Literal("high"),
					]),
				),
			}),
			execute: async (_id, params) => {
				const riskLevel = params.riskLevel || "low";
				const amountUsd = Number(params.amountUsd || 100);
				const strategy = {
					track: params.track,
					riskLevel,
					amountUsd,
					steps: [
						"read Starknet chain/account status",
						"simulate route + slippage bounds",
						"enforce confirm=true and max amount policy",
						"execute only after explicit approval",
						"generate reconciliation + proof artifact",
					],
					executePolicy: {
						requireConfirm: true,
						maxAmountUsd:
							riskLevel === "high" ? 500 : riskLevel === "medium" ? 250 : 100,
						slippageBps:
							riskLevel === "high" ? 150 : riskLevel === "medium" ? 100 : 50,
					},
					status: "plan-only",
				};
				return {
					content: [
						{ type: "text", text: JSON.stringify({ ok: true, strategy }) },
					],
					details: { ok: true, strategy },
				};
			},
		}),
	];
}
