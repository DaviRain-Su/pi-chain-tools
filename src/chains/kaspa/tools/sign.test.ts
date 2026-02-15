import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createKaspaComposeTools } from "./compose.js";
import { createKaspaSignTools } from "./sign.js";

vi.mock("@kaspa/wallet", () => {
	const signKaspaTransaction = (input: { privateKey?: string }) => {
		if (input && typeof input.privateKey === "string") {
			return `sig-wallet-${input.privateKey}`;
		}
		return "sig-wallet-unknown";
	};
	return {
		signKaspaTransaction,
		signTransaction: signKaspaTransaction,
		sign: signKaspaTransaction,
		default: {
			signKaspaTransaction,
			signTransaction: signKaspaTransaction,
			sign: signKaspaTransaction,
		},
	};
});

type KaspaComposeTool = {
	execute(
		_toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

type KaspaSignTool = {
	execute(
		_toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getComposeTool(name: string): KaspaComposeTool {
	const tool = createKaspaComposeTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as KaspaComposeTool;
}

function getSignTool(name: string): KaspaSignTool {
	const tool = createKaspaSignTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as KaspaSignTool;
}

function requestFromUnsignedBuild(): Promise<Record<string, unknown>> {
	const composeTool = getComposeTool("kaspa_buildTransferTransaction");
	return composeTool
		.execute("kaspa-sign-build", {
			fromAddress:
				"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
			toAddress:
				"kaspa:qtestreceiver11111111111111111111111111111111111111111111111111",
			amount: "1",
			utxos: [
				{
					txId: "txid-1",
					index: 0,
					amount: "2",
				},
			],
			feeRate: 1,
		})
		.then((composeResult) => {
			const details = composeResult.details as {
				request?: Record<string, unknown>;
			};
			if (!details.request || typeof details.request !== "object") {
				throw new Error("compose request missing");
			}
			return details.request;
		});
}

describe("kaspa sign tools", () => {
	it("attaches signatures and keeps request hash deterministic", async () => {
		const signTool = getSignTool("kaspa_signTransferTransaction");
		const request = await requestFromUnsignedBuild();
		const result = await signTool.execute("kaspa-sign", {
			request,
			signatures: ["sig-1", "sig-2", "sig-1"],
			signatureEncoding: "hex",
		});
		const details = result.details as {
			schema: string;
			request: { transaction: { signatures: string[] } };
			rawTransaction: string;
			requestHash: string;
			unsignedRequestHash: string;
			signingContext?: {
				mode: "manual";
				hashInput: {
					fingerprint: string;
					messageDigest: string;
					signatureEncoding: string;
					payloadPreview?: string;
					signaturePayload?: string;
				};
				metadata: { replaceExistingSignatures: boolean };
			};
		};
		expect(result.content[0]?.text).toContain("Kaspa signatures attached");
		expect(details.schema).toBe("kaspa.transaction.signed.v1");
		expect(details.requestHash).toMatch(/^[0-9a-f]{64}$/);
		expect(details.unsignedRequestHash).toMatch(/^[0-9a-f]{64}$/);
		const signedRaw = JSON.parse(details.rawTransaction) as {
			signatureEncoding: string;
			signatures: string[];
		};
		expect(signedRaw.signatureEncoding).toBe("hex");
		expect(signedRaw.signatures).toEqual(["sig-1", "sig-2"]);
		expect(details.request.transaction.signatures).toEqual(["sig-1", "sig-2"]);
		expect(details.signingContext?.mode).toBe("manual");
		expect(details.signingContext?.hashInput?.fingerprint).toMatch(
			/^[0-9a-f]{64}$/,
		);
		expect(details.signingContext?.hashInput?.messageDigest).toBe(
			details.signingContext?.hashInput?.fingerprint,
		);
		expect(details.signingContext?.hashInput?.hashAlgorithm).toBe("sha256");
		expect(details.signingContext?.hashInput?.payloadPreview).toContain("{");
		expect(details.signingContext?.hashInput?.signaturePayload).toContain('"');
		expect(details.signingContext?.hashInput?.signatureEncoding).toBe("hex");
	});

	it("replaces existing signatures when requested", async () => {
		const signTool = getSignTool("kaspa_signTransferTransaction");
		const request = await requestFromUnsignedBuild();
		request.transaction = {
			...JSON.parse(String(request.rawTransaction)),
			signatures: ["old-a", "old-b"],
		};
		(request as { rawTransaction?: unknown }).rawTransaction = undefined;
		const result = await signTool.execute("kaspa-sign-replace", {
			request,
			signatures: ["new-a"],
			replaceExistingSignatures: true,
		});
		const details = result.details as {
			request: { transaction: { signatures: string[] } };
		};
		expect(details.request.transaction.signatures).toEqual(["new-a"]);
	});

	it("requires at least one signature", async () => {
		const signTool = getSignTool("kaspa_signTransferTransaction");
		const request = await requestFromUnsignedBuild();
		await expect(
			signTool.execute("kaspa-sign-missing", {
				request,
				signatures: [],
			}),
		).rejects.toThrow("At least one signature is required");
	});

	it("supports wallet-backed signing path", async () => {
		const signTool = getSignTool("kaspa_signTransferTransactionWithWallet");
		const request = await requestFromUnsignedBuild();
		const result = await signTool.execute("kaspa-sign-wallet", {
			request,
			privateKey: "private-key-mock",
			signerProvider: "kaspa-wallet",
			signatureEncoding: "hex",
		});
		const details = result.details as {
			source?: string;
			rawTransaction: string;
			request: { transaction: { signatures: string[] } };
			signingContext?: {
				mode: "wallet";
				hashInput: {
					fingerprint: string;
					messageDigest: string;
					signatureEncoding: string;
					network?: string;
					payloadPreview?: string;
					signaturePayload?: string;
				};
				metadata: {
					provider?: string;
					providerApiShape?: string;
					providerResultShape?: string;
					replaceExistingSignatures?: boolean;
				};
			};
		};
		expect(details.source).toBe("kaspa-wallet:kaspa-wallet");
		expect(details.signingContext?.mode).toBe("wallet");
		expect(details.signingContext?.metadata?.provider).toBe("kaspa-wallet");
		expect(details.signingContext?.metadata?.replaceExistingSignatures).toBe(
			false,
		);
		expect(details.signingContext?.hashInput?.fingerprint).toMatch(
			/^[0-9a-f]{64}$/,
		);
		expect(details.signingContext?.hashInput?.messageDigest).toBe(
			details.signingContext?.hashInput?.fingerprint,
		);
		expect(details.signingContext?.hashInput?.payloadPreview).toContain("{");
		expect(details.signingContext?.hashInput?.signaturePayload).toContain("{");
		expect(details.signingContext?.hashInput?.hashAlgorithm).toBe("sha256");
		expect(details.signingContext?.metadata?.providerApiShape).toContain(
			"function:signKaspaTransaction",
		);
		expect(details.signingContext?.metadata?.providerResultShape).toBe(
			"string",
		);
		expect(details.signingContext?.hashInput?.signatureEncoding).toBe("hex");
		const signedRaw = JSON.parse(details.rawTransaction) as {
			signatures: string[];
		};
		expect(signedRaw.signatures).toEqual(["sig-wallet-private-key-mock"]);
	});

	it("supports resolving private key from env or file without inline privateKey", async () => {
		const signTool = getSignTool("kaspa_signTransferTransactionWithWallet");
		const request = await requestFromUnsignedBuild();
		const originalEnv = process.env.KASPA_PRIVATE_KEY;
		const originalPathEnv = process.env.KASPA_PRIVATE_KEY_PATH;
		const customPathEnvName = "KASPA_TEST_KEY_PATH";
		const originalCustomPathEnv = process.env[customPathEnvName];
		process.env.KASPA_PRIVATE_KEY = "private-key-env";
		const tempDir = mkdtempSync(path.join(tmpdir(), "kaspa-key-"));
		const tempKeyPath = path.join(tempDir, "kaspa-key.json");
		const customKeyPath = path.join(tempDir, "kaspa-key-custom.json");
		writeFileSync(
			tempKeyPath,
			JSON.stringify({ private_key: "private-key-file-json" }),
			"utf8",
		);
		writeFileSync(
			customKeyPath,
			JSON.stringify({ secret_key: "private-key-env-file" }),
			"utf8",
		);
		try {
			process.env.KASPA_PRIVATE_KEY_PATH = tempKeyPath;
			process.env.KASPA_PRIVATE_KEY = "";
			const resultFromPath = await signTool.execute("kaspa-sign-wallet-path", {
				request,
				signerProvider: "kaspa-wallet",
				signatureEncoding: "hex",
			});
			const signedFromPath = JSON.parse(
				(resultFromPath.details as { rawTransaction: string }).rawTransaction,
			) as { signatures: string[] };
			expect(signedFromPath.signatures).toEqual([
				"sig-wallet-private-key-file-json",
			]);

			process.env[customPathEnvName] = customKeyPath;
			process.env.KASPA_PRIVATE_KEY = "";
			const resultFromCustomPathEnv = await signTool.execute(
				"kaspa-sign-wallet-custom-path-env",
				{
					request,
					signerProvider: "kaspa-wallet",
					privateKeyPathEnv: customPathEnvName,
					signatureEncoding: "hex",
				},
			);
			const signedFromCustomPathEnv = JSON.parse(
				(resultFromCustomPathEnv.details as { rawTransaction: string })
					.rawTransaction,
			) as { signatures: string[] };
			expect(signedFromCustomPathEnv.signatures).toEqual([
				"sig-wallet-private-key-env-file",
			]);

			process.env.KASPA_PRIVATE_KEY = "private-key-env";
			const resultFromEnv = await signTool.execute("kaspa-sign-wallet-env", {
				request,
				signerProvider: "kaspa-wallet",
				signatureEncoding: "hex",
			});
			const signedFromEnv = JSON.parse(
				(resultFromEnv.details as { rawTransaction: string }).rawTransaction,
			) as { signatures: string[] };
			expect(signedFromEnv.signatures).toEqual(["sig-wallet-private-key-env"]);

			const resultFromFile = await signTool.execute("kaspa-sign-wallet-file", {
				request,
				signerProvider: "kaspa-wallet",
				privateKeyFile: tempKeyPath,
				signatureEncoding: "hex",
			});
			const signedFromFile = JSON.parse(
				(resultFromFile.details as { rawTransaction: string }).rawTransaction,
			) as { signatures: string[] };
			expect(signedFromFile.signatures).toEqual([
				"sig-wallet-private-key-file-json",
			]);

			const resultFromPathAlias = await signTool.execute(
				"kaspa-sign-wallet-path-alias",
				{
					request,
					signerProvider: "kaspa-wallet",
					privateKeyPath: tempKeyPath,
					signatureEncoding: "hex",
				},
			);
			const signedFromPathAlias = JSON.parse(
				(resultFromPathAlias.details as { rawTransaction: string })
					.rawTransaction,
			) as { signatures: string[] };
			expect(signedFromPathAlias.signatures).toEqual([
				"sig-wallet-private-key-file-json",
			]);

			const resultInlineBeatsFile = await signTool.execute(
				"kaspa-sign-wallet-inline-beats-file",
				{
					request,
					signerProvider: "kaspa-wallet",
					privateKey: "explicit-private-key",
					privateKeyPath: tempKeyPath,
					signatureEncoding: "hex",
				},
			);
			const signedInlineBeatsFile = JSON.parse(
				(resultInlineBeatsFile.details as { rawTransaction: string })
					.rawTransaction,
			) as { signatures: string[] };
			expect(signedInlineBeatsFile.signatures).toEqual([
				"sig-wallet-explicit-private-key",
			]);
		} finally {
			if (originalEnv === undefined) {
				process.env.KASPA_PRIVATE_KEY = "";
			} else {
				process.env.KASPA_PRIVATE_KEY = originalEnv;
			}
			if (originalPathEnv === undefined) {
				process.env.KASPA_PRIVATE_KEY_PATH = "";
			} else {
				process.env.KASPA_PRIVATE_KEY_PATH = originalPathEnv;
			}
			if (originalCustomPathEnv === undefined) {
				process.env[customPathEnvName] = "";
			} else {
				process.env[customPathEnvName] = originalCustomPathEnv;
			}
		}
	});
});
