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
	const source = String(text || "");
	const labeled =
		source.match(
			/(?:tx(?:_|\s|-)?hash|transaction(?:_|\s|-)?hash)\s*[:=]\s*(0x[a-fA-F0-9]{1,64})/i,
		) || source.match(/\b(0x[a-fA-F0-9]{64})\b/);
	if (labeled?.[1]) return labeled[1];
	const fallback = source.match(/\b0x[a-fA-F0-9]{1,64}\b/);
	return fallback ? fallback[0] : null;
}

function resolveExecuteCommand(network: "mainnet" | "sepolia") {
	const nativeSepolia = String(
		process.env.STARKNET_NATIVE_EXECUTE_COMMAND_SEPOLIA || "",
	).trim();
	const nativeMainnet = String(
		process.env.STARKNET_NATIVE_EXECUTE_COMMAND_MAINNET || "",
	).trim();
	const commandMode = String(process.env.STARKNET_EXECUTE_COMMAND || "").trim();

	if (network === "sepolia" && nativeSepolia) {
		return { mode: "native-sepolia", template: nativeSepolia } as const;
	}
	if (network === "mainnet" && nativeMainnet) {
		return { mode: "native-mainnet", template: nativeMainnet } as const;
	}
	if (commandMode) {
		return { mode: "command", template: commandMode } as const;
	}
	return { mode: "execute-ready", template: "" } as const;
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
					const boundaryProof = {
						confirmPassed: false,
						policyPassed: false,
						reconcilePassed: false,
						note: "blocked by amount policy cap",
					};
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
									boundaryProof,
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
							boundaryProof,
						},
					};
				}

				if (!dryRun && params.confirm !== true) {
					const boundaryProof = {
						confirmPassed: false,
						policyPassed: true,
						reconcilePassed: false,
						note: "missing explicit confirm=true",
					};
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: false,
									mode: "blocked",
									reason: "missing_confirm_true",
									network,
									boundaryProof,
								}),
							},
						],
						details: {
							ok: false,
							mode: "blocked",
							reason: "missing_confirm_true",
							network,
							boundaryProof,
						},
					};
				}

				if (dryRun) {
					const boundaryProof = {
						confirmPassed: true,
						policyPassed: true,
						reconcilePassed: true,
						note: "dry-run simulation only",
					};
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
									boundaryProof,
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
							boundaryProof,
						},
					};
				}

				const runId = String(params.runId || `starknet-${Date.now()}`);
				const commandSelection = resolveExecuteCommand(network);
				if (!commandSelection.template) {
					const boundaryProof = {
						confirmPassed: true,
						policyPassed: true,
						reconcilePassed: true,
						note: "set STARKNET_NATIVE_EXECUTE_COMMAND_SEPOLIA/STARKNET_NATIVE_EXECUTE_COMMAND_MAINNET or STARKNET_EXECUTE_COMMAND to enable execute",
					};
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									mode: "execute-ready",
									network,
									intent: params.intent,
									executeMode: commandSelection.mode,
									boundaryProof,
								}),
							},
						],
						details: {
							ok: true,
							mode: "execute-ready",
							network,
							intent: params.intent,
							executeMode: commandSelection.mode,
							boundaryProof,
						},
					};
				}

				const cmd = commandSelection.template
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
				const boundaryProof = {
					confirmPassed: true,
					policyPassed: true,
					reconcilePassed: txHash !== null,
					note: txHash
						? "tx hash detected from execute output"
						: "execute output returned without explicit tx hash; verify adapter output format",
				};
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								ok: true,
								mode: commandSelection.mode,
								network,
								intent: params.intent,
								txHash,
								runId,
								boundaryProof,
							}),
						},
					],
					details: {
						ok: true,
						mode: commandSelection.mode,
						network,
						intent: params.intent,
						txHash,
						runId,
						commandMode: true,
						output,
						boundaryProof,
					},
				};
			},
		}),
	];
}
