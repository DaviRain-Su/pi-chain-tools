import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	STARKNET_TOOL_PREFIX,
	getStarknetBtcRouteQuote,
	parseStarknetNetwork,
	starknetNetworkSchema,
} from "../runtime.js";

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
		defineTool({
			name: `${STARKNET_TOOL_PREFIX}_planBtcBridgeAction`,
			label: "Plan BTC Bridge Action (Starknet)",
			description:
				"Build actionable BTC bridge/swap plan with guardrails using route quote discovery.",
			parameters: Type.Object({
				network: Type.Optional(starknetNetworkSchema),
				amount: Type.Union([
					Type.String({ minLength: 1 }),
					Type.Number({ minimum: 0 }),
				]),
				riskLevel: Type.Optional(
					Type.Union([
						Type.Literal("low"),
						Type.Literal("medium"),
						Type.Literal("high"),
					]),
				),
				maxFeeBps: Type.Optional(Type.Number({ minimum: 0 })),
				minAmountOut: Type.Optional(
					Type.Union([
						Type.String({ minLength: 1 }),
						Type.Number({ minimum: 0 }),
					]),
				),
			}),
			execute: async (_id, params) => {
				const network = parseStarknetNetwork(params.network);
				const riskLevel = params.riskLevel || "low";
				const quote = await getStarknetBtcRouteQuote({
					network,
					amount: params.amount,
					sourceAsset: "BTC",
					targetAsset: "STRK",
				});
				const derivedDefaultMaxFee =
					riskLevel === "high" ? 120 : riskLevel === "medium" ? 80 : 50;
				const feeCapBps = Number(params.maxFeeBps ?? derivedDefaultMaxFee);
				const minAmountOut = String(
					params.minAmountOut !== undefined
						? params.minAmountOut
						: quote.amountOut,
				);
				const guardrails = {
					requireConfirm: true,
					maxAmountUsd:
						riskLevel === "high" ? 5000 : riskLevel === "medium" ? 2500 : 1000,
					maxFeeBps: feeCapBps,
					minAmountOut,
				};
				const policyCheck = {
					feeWithinCap: quote.feeBps <= feeCapBps,
					feeBps: quote.feeBps,
					feeCapBps,
				};
				const plan = {
					actionType: "btc_bridge_swap",
					network,
					riskLevel,
					route: quote,
					params: {
						routeId: quote.routeId,
						amount: quote.amountIn,
						minAmountOut,
					},
					guardrails,
					policyCheck,
					nextStep:
						"Call starknet_executeIntentGuarded with actionType=btc_bridge_swap, confirm=true and matching guard params when ready.",
				};
				return {
					content: [{ type: "text", text: JSON.stringify({ ok: true, plan }) }],
					details: { ok: true, plan },
				};
			},
		}),
	];
}
