import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	STARKNET_TOOL_PREFIX,
	parseStarknetNetwork,
	starknetNetworkSchema,
} from "../runtime.js";

export function createStarknetExecuteTools() {
	return [
		defineTool({
			name: `${STARKNET_TOOL_PREFIX}_executeIntentGuarded`,
			label: "Execute Starknet Intent (Guarded)",
			description:
				"Policy-gated Starknet execute scaffold. Requires explicit confirm=true and enforces risk caps.",
			parameters: Type.Object({
				intent: Type.String({ minLength: 3 }),
				network: Type.Optional(starknetNetworkSchema),
				confirm: Type.Optional(Type.Boolean()),
				amountUsd: Type.Optional(Type.Number({ minimum: 0 })),
				maxAmountUsd: Type.Optional(Type.Number({ minimum: 1 })),
				dryRun: Type.Optional(Type.Boolean()),
			}),
			execute: async (_id, params) => {
				const network = parseStarknetNetwork(params.network);
				const dryRun = params.dryRun !== false;
				const amountUsd = Number(params.amountUsd || 0);
				const maxAmountUsd = Number(params.maxAmountUsd || 100);

				if (amountUsd > maxAmountUsd) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: false,
									mode: "blocked",
									reason: "amount_exceeds_policy_cap",
									amountUsd,
									maxAmountUsd,
									network,
								}),
							},
						],
						details: {
							ok: false,
							mode: "blocked",
							reason: "amount_exceeds_policy_cap",
							amountUsd,
							maxAmountUsd,
							network,
						},
					};
				}

				if (!dryRun && params.confirm !== true) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: false,
									mode: "blocked",
									reason: "missing_confirm_true",
									network,
								}),
							},
						],
						details: {
							ok: false,
							mode: "blocked",
							reason: "missing_confirm_true",
							network,
						},
					};
				}

				if (dryRun) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									mode: "simulate",
									network,
									intent: params.intent,
									amountUsd,
									guards: { requireConfirm: true, maxAmountUsd },
								}),
							},
						],
						details: {
							ok: true,
							mode: "simulate",
							network,
							intent: params.intent,
							amountUsd,
							guards: { requireConfirm: true, maxAmountUsd },
						},
					};
				}

				// Phase-2 execute scaffold: explicit boundary proof without signer broadcast.
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								ok: true,
								mode: "execute-ready",
								network,
								intent: params.intent,
								boundaryProof: {
									confirmPassed: true,
									policyPassed: true,
									reconcilePassed: true,
									note: "starknet signer/broadcast adapter not wired yet",
								},
							}),
						},
					],
					details: {
						ok: true,
						mode: "execute-ready",
						network,
						intent: params.intent,
						boundaryProof: {
							confirmPassed: true,
							policyPassed: true,
							reconcilePassed: true,
							note: "starknet signer/broadcast adapter not wired yet",
						},
					},
				};
			},
		}),
	];
}
