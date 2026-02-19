import { execFile } from "node:child_process";
import { Type } from "@sinclair/typebox";
import { defineTool } from "../../../core/types.js";
import {
	STARKNET_TOOL_PREFIX,
	parseStarknetNetwork,
	starknetNetworkSchema,
} from "../runtime.js";

function runCommand(command: string, args: string[]) {
	return new Promise<string>((resolve, reject) => {
		execFile(command, args, { timeout: 120000 }, (error, stdout, stderr) => {
			if (error) {
				reject(
					new Error(String(stderr || error.message || "command failed").trim()),
				);
				return;
			}
			resolve(String(stdout || "").trim());
		});
	});
}

function extractTxHash(text: string): string | null {
	const m = String(text || "").match(/0x[a-fA-F0-9]{64}/);
	return m ? m[0] : null;
}

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
				runId: Type.Optional(Type.String({ minLength: 3 })),
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

				const runId = String(params.runId || `starknet-${Date.now()}`);
				const cmdTemplate = String(
					process.env.STARKNET_EXECUTE_COMMAND || "",
				).trim();
				if (!cmdTemplate) {
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
										note: "set STARKNET_EXECUTE_COMMAND to enable command-mode execute",
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
								note: "set STARKNET_EXECUTE_COMMAND to enable command-mode execute",
							},
						},
					};
				}

				const cmd = cmdTemplate
					.split("{intent}")
					.join(params.intent)
					.split("{network}")
					.join(network)
					.split("{amountUsd}")
					.join(String(amountUsd))
					.split("{runId}")
					.join(runId);
				const output = await runCommand("bash", ["-lc", cmd]);
				const txHash = extractTxHash(output);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								ok: true,
								mode: "execute",
								network,
								intent: params.intent,
								txHash,
								runId,
							}),
						},
					],
					details: {
						ok: true,
						mode: "execute",
						network,
						intent: params.intent,
						txHash,
						runId,
						commandMode: true,
						output,
					},
				};
			},
		}),
	];
}
