import { createHash } from "node:crypto";

import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../core/types.js";
import { KASPA_TOOL_PREFIX } from "../runtime.js";

type KaspaSignedSubmissionResult = {
	request: Record<string, unknown>;
	rawTransaction: string;
	requestHash: string;
	unsignedRequestHash: string;
	signatureCount: number;
	encoding: string;
	source?: string;
	signingContext?: KaspaSigningContext;
};

type KaspaSigningMethod = "manual" | "wallet";

type KaspaSigningContext = {
	mode: KaspaSigningMethod;
	hashInput: {
		fingerprint: string;
		messageDigest: string;
		signatureEncoding: string;
		network?: string;
		inputShape: string;
		payloadPreview?: string;
		schema: "kaspa-signing-input.v1";
	};
	metadata: {
		provider?: KaspaSignerProvider;
		providerModule?: string;
		replaceExistingSignatures: boolean;
	};
};

type KaspaSignerProvider =
	| "auto"
	| "kaspa-wallet"
	| "kaspa-wasm32-sdk"
	| "custom";

const DEFAULT_SIGNATURE_ENCODING = "hex";
const DEFAULT_SIGNER_PROVIDER = "auto" as const;

const KASPA_SIGNER_CACHE = new Map<string, KaspaWalletSignerResolution>();

interface KaspaWalletSignerInput {
	privateKey: string;
	request: Record<string, unknown>;
	transaction: Record<string, unknown>;
	rawTransaction: string;
	network?: string;
	signatureEncoding: string;
	hash: string;
}

type KaspaWalletSigner = (input: KaspaWalletSignerInput) => Promise<string[]>;
type KaspaSignMethod = (...args: unknown[]) => unknown | Promise<unknown>;

function getModuleExport<T>(value: unknown, key: string): T | undefined {
	if (value == null || typeof value !== "object") {
		return undefined;
	}
	try {
		const candidate = value as Record<string, unknown>;
		if (!Object.prototype.hasOwnProperty.call(candidate, key)) {
			return undefined;
		}
		return candidate[key] as T;
	} catch {
		return undefined;
	}
}

function stableKaspaJson(value: unknown): string {
	if (value === null || value === undefined) {
		return "null";
	}
	if (typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableKaspaJson(entry)).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const sorted = Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableKaspaJson(record[key])}`)
		.join(",");
	return `{${sorted}}`;
}

function buildKaspaRequestFingerprint(payload: unknown): string {
	return createHash("sha256").update(stableKaspaJson(payload)).digest("hex");
}

function parseKaspaTransactionPayload(value?: string): unknown | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
}

function buildKaspaSigningContextInput(
	transaction: Record<string, unknown>,
	signatureEncoding: string,
	network?: string,
): {
	fingerprint: string;
	payload: {
		transaction: Record<string, unknown>;
		signatureEncoding: string;
		network?: string;
	};
} {
	const payload = {
		transaction: stripSignatures(transaction),
		signatureEncoding,
		network,
	};
	return {
		fingerprint: buildKaspaRequestFingerprint(payload),
		payload,
	};
}

const KASPA_SIGNING_PREVIEW_MAX_LENGTH = 1024;

function buildSigningInputPreview(payload: unknown): string {
	const serialized = stableKaspaJson(payload);
	return serialized.length > KASPA_SIGNING_PREVIEW_MAX_LENGTH
		? `${serialized.slice(0, KASPA_SIGNING_PREVIEW_MAX_LENGTH)}...`
		: serialized;
}

function resolveKaspaTransactionSubmissionRequest(
	rawTransaction?: string,
	request?: unknown,
): Record<string, unknown> {
	const requestBody =
		request === undefined
			? undefined
			: (() => {
					if (
						request === null ||
						typeof request !== "object" ||
						Array.isArray(request)
					) {
						throw new Error("request must be an object");
					}
					return request as Record<string, unknown>;
				})();
	const normalizedRawTransaction = parseKaspaTransactionPayload(rawTransaction);
	if (!requestBody && normalizedRawTransaction === undefined) {
		throw new Error(
			"At least one of rawTransaction or request is required to sign a Kaspa transaction",
		);
	}
	const body: Record<string, unknown> = requestBody ? { ...requestBody } : {};
	if (rawTransaction?.trim()) {
		body.transaction = normalizedRawTransaction;
	} else if (!("transaction" in body) && "rawTransaction" in body) {
		if (typeof body.rawTransaction === "string") {
			body.transaction = parseKaspaTransactionPayload(body.rawTransaction);
		} else {
			body.transaction = body.rawTransaction;
		}
	}
	if ("rawTransaction" in body) {
		body.rawTransaction = undefined;
	}
	if (body.transaction == null) {
		throw new Error("No transaction payload found in request");
	}
	if (typeof body.transaction === "string") {
		throw new Error(
			"transaction must be an object or array of unsigned tx data",
		);
	}
	return body;
}

function parseSignatureListFromInput(
	signature?: string,
	signatures?: string[],
): string[] {
	const collected: string[] = [];
	if (signature?.trim()) {
		collected.push(signature.trim());
	}
	if (Array.isArray(signatures)) {
		for (const item of signatures) {
			if (typeof item !== "string" || !item.trim()) {
				throw new Error("Each signature must be a non-empty string");
			}
			collected.push(item.trim());
		}
	}
	if (collected.length === 0) {
		throw new Error("At least one signature is required");
	}
	const unique = new Set<string>();
	for (const candidate of collected) {
		unique.add(candidate);
	}
	return [...unique];
}

function cloneTransactionPayload(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Transaction payload must be an object");
	}
	const record = value as Record<string, unknown>;
	const transaction = { ...record };
	if (record.signatures !== undefined) {
		transaction.signatures = cloneSignatures(record.signatures);
	}
	return transaction;
}

function cloneSignatures(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => Boolean(entry));
}

function stripSignatures(
	transaction: Record<string, unknown>,
): Record<string, unknown> {
	if (!("signatures" in transaction)) {
		return { ...transaction };
	}
	const { signatures: _, ...rest } = transaction;
	return rest;
}

function buildSignedKaspaRequest(params: {
	body: Record<string, unknown>;
	signatureEncoding: string;
	signatures: string[];
	source?: string;
	signingContext: KaspaSigningContext;
}): KaspaSignedSubmissionResult {
	const request = params.body;
	const transaction = cloneTransactionPayload(request.transaction);
	const unique = [...new Set((params.signatures || []).filter(Boolean))];
	if (unique.length === 0) {
		throw new Error("Unable to construct a non-empty signature list");
	}
	const signedTransaction = {
		...transaction,
		signatureEncoding: params.signatureEncoding,
		signatures: unique,
	};
	const signedBody = {
		...request,
		transaction: signedTransaction,
	};
	const unsignedBody = {
		...request,
		transaction: stripSignatures(transaction),
	};
	return {
		request: signedBody,
		rawTransaction: JSON.stringify(signedTransaction),
		requestHash: buildKaspaRequestFingerprint(signedBody),
		unsignedRequestHash: buildKaspaRequestFingerprint(unsignedBody),
		signatureCount: unique.length,
		encoding: params.signatureEncoding,
		source: params.source,
		signingContext: params.signingContext,
	};
}

function signKaspaSubmitTransaction(params: {
	rawTransaction?: string;
	request?: unknown;
	signature?: string;
	signatures?: string[];
	signatureEncoding?: string;
	replaceExistingSignatures?: boolean;
}): KaspaSignedSubmissionResult {
	const body = resolveKaspaTransactionSubmissionRequest(
		params.rawTransaction?.trim(),
		params.request,
	);
	const resolvedEncoding = (
		params.signatureEncoding || DEFAULT_SIGNATURE_ENCODING
	).trim();
	if (!resolvedEncoding) {
		raiseError();
	}
	if (!/^[a-zA-Z0-9_\-]+$/.test(resolvedEncoding)) {
		throw new Error("signatureEncoding must be an identifier string");
	}
	const resolvedSignatures = parseSignatureListFromInput(
		params.signature || undefined,
		params.signatures,
	);
	const resolvedExisting = params.replaceExistingSignatures
		? []
		: cloneSignatures((body.transaction as Record<string, unknown>).signatures);
	const nextSignatures = [...resolvedExisting, ...resolvedSignatures];
	if (!nextSignatures.length) {
		throw new Error("Unable to construct a non-empty signature list");
	}
	const signingTransaction = cloneTransactionPayload(body.transaction);
	const network = detectKaspaRequestNetwork(signingTransaction);
	const signingInput = buildKaspaSigningContextInput(
		signingTransaction,
		resolvedEncoding,
		network,
	);
	const signingContext: KaspaSigningContext = {
		mode: "manual",
		hashInput: {
			fingerprint: signingInput.fingerprint,
			messageDigest: signingInput.fingerprint,
			signatureEncoding: resolvedEncoding,
			network,
			inputShape: "transaction-without-signatures",
			payloadPreview: buildSigningInputPreview(signingInput.payload),
			schema: "kaspa-signing-input.v1",
		},
		metadata: {
			replaceExistingSignatures: Boolean(params.replaceExistingSignatures),
		},
	};
	return buildSignedKaspaRequest({
		body,
		signatureEncoding: resolvedEncoding,
		signatures: nextSignatures,
		source: "manual",
		signingContext,
	});
}

async function signKaspaSubmitTransactionWithWallet(params: {
	rawTransaction?: string;
	request?: unknown;
	signatureEncoding?: string;
	signerProvider?: KaspaSignerProvider;
	providerModule?: string;
	privateKey: string;
	replaceExistingSignatures?: boolean;
}): Promise<KaspaSignedSubmissionResult> {
	const resolvedProvider: KaspaSignerProvider =
		params.signerProvider ?? DEFAULT_SIGNER_PROVIDER;
	const body = resolveKaspaTransactionSubmissionRequest(
		params.rawTransaction?.trim(),
		params.request,
	);
	const signatureEncoding = (
		params.signatureEncoding || DEFAULT_SIGNATURE_ENCODING
	).trim();
	if (!signatureEncoding) {
		raiseError();
	}
	const normalizedEncoding = signatureEncoding;
	if (!/^[a-zA-Z0-9_\-]+$/.test(normalizedEncoding)) {
		throw new Error("signatureEncoding must be an identifier string");
	}
	const signerResolution = await resolveKaspaWalletSigner(
		resolvedProvider,
		params.providerModule?.trim(),
	);
	const signer = signerResolution.signer;
	const transaction = cloneTransactionPayload(body.transaction);
	const network = detectKaspaRequestNetwork(transaction);
	const signingInput = buildKaspaSigningContextInput(
		transaction,
		normalizedEncoding,
		network,
	);
	const signingHash = signingInput.fingerprint;
	const rawTransaction =
		typeof body.rawTransaction === "string"
			? body.rawTransaction
			: JSON.stringify(transaction);
	const signatures = await signer({
		privateKey: params.privateKey,
		request: body,
		transaction,
		rawTransaction,
		network,
		signatureEncoding: normalizedEncoding,
		hash: signingHash,
	});
	if (signatures.length === 0) {
		throw new Error("Unable to produce any signature from wallet backend");
	}
	const finalSignatures = params.replaceExistingSignatures
		? signatures
		: [...cloneSignatures(transaction.signatures), ...signatures];
	const source = `kaspa-wallet:${resolvedProvider}`;
	const signerResolutionModule = signerResolution.backend?.moduleName;
	const signingContext: KaspaSigningContext = {
		mode: "wallet",
		hashInput: {
			fingerprint: signingHash,
			messageDigest: signingHash,
			signatureEncoding: normalizedEncoding,
			network,
			inputShape: "transaction-without-signatures",
			payloadPreview: buildSigningInputPreview(signingInput.payload),
			schema: "kaspa-signing-input.v1",
		},
		metadata: {
			provider: resolvedProvider,
			providerModule: signerResolutionModule,
			replaceExistingSignatures: Boolean(params.replaceExistingSignatures),
		},
	};
	return buildSignedKaspaRequest({
		body,
		signatureEncoding: normalizedEncoding,
		signatures: finalSignatures,
		source,
		signingContext,
	});
}

function detectKaspaRequestNetwork(
	transaction: Record<string, unknown>,
): string | undefined {
	if (typeof transaction.network === "string" && transaction.network.trim()) {
		return transaction.network.trim();
	}
	return undefined;
}

type KaspaWalletSignerResolution = {
	signer: KaspaWalletSigner;
	backend: {
		provider: KaspaSignerProvider;
		moduleName: string;
		label: string;
	};
};

async function resolveKaspaWalletSigner(
	provider: KaspaSignerProvider,
	providerModule?: string,
): Promise<KaspaWalletSignerResolution> {
	const cacheKey = `${provider}::${providerModule || ""}`;
	const cached = KASPA_SIGNER_CACHE.get(cacheKey);
	if (cached) return cached;
	const attempts = buildKaspaSignerLoadPlan(provider, providerModule);
	let lastError: Error | undefined;
	for (const candidate of attempts) {
		try {
			const moduleValue = await import(candidate.moduleName);
			const signer = buildKaspaWalletSignerFromModule(moduleValue);
			if (signer) {
				const resolution: KaspaWalletSignerResolution = {
					signer,
					backend: {
						provider,
						moduleName: candidate.moduleName,
						label: candidate.label,
					},
				};
				KASPA_SIGNER_CACHE.set(cacheKey, resolution);
				return resolution;
			}
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
		}
	}
	const providerLabel = providerModule || provider;
	const hint = attempts.length
		? `Tried: ${attempts.map((entry) => entry.moduleName).join(", ")}`
		: "No provider configured";
	throw new Error(
		`No Kaspa wallet signing backend available for provider "${providerLabel}". ${hint}. ${(lastError ? `Last error: ${lastError.message}` : "").trim()}`,
	);
}

function buildKaspaSignerLoadPlan(
	provider: KaspaSignerProvider,
	providerModule?: string,
): { moduleName: string; label: string }[] {
	if (provider === "custom") {
		if (!providerModule) {
			throw new Error(
				"providerModule is required when signerProvider is 'custom'.",
			);
		}
		return [{ moduleName: providerModule, label: "custom-provider-module" }];
	}
	if (providerModule) {
		return [{ moduleName: providerModule, label: "custom-provider-module" }];
	}
	if (provider === "kaspa-wallet") {
		return [{ moduleName: "@kaspa/wallet", label: "@kaspa/wallet" }];
	}
	if (provider === "kaspa-wasm32-sdk") {
		return [{ moduleName: "kaspa-wasm32-sdk", label: "kaspa-wasm32-sdk" }];
	}
	return [
		{ moduleName: "@kaspa/wallet", label: "@kaspa/wallet" },
		{ moduleName: "kaspa-wasm32-sdk", label: "kaspa-wasm32-sdk" },
	];
}

function buildKaspaWalletSignerFromModule(
	moduleValue: unknown,
): KaspaWalletSigner | null {
	const defaultModule = getModuleExport<Record<string, unknown>>(
		moduleValue,
		"default",
	);
	const candidate = moduleValue as Record<string, unknown>;
	if (candidate == null || typeof candidate !== "object") {
		return null;
	}
	const directCandidates: unknown[] = [
		getModuleExport<(...args: unknown[]) => unknown>(
			candidate,
			"signKaspaTransaction",
		),
		getModuleExport<(...args: unknown[]) => unknown>(
			candidate,
			"signTransaction",
		),
		getModuleExport<(...args: unknown[]) => unknown>(candidate, "sign"),
		getModuleExport<(...args: unknown[]) => unknown>(
			defaultModule,
			"signKaspaTransaction",
		),
		getModuleExport<(...args: unknown[]) => unknown>(
			defaultModule,
			"signTransaction",
		),
		getModuleExport<(...args: unknown[]) => unknown>(defaultModule, "sign"),
	];
	for (const current of directCandidates) {
		if (typeof current === "function") {
			return makeFunctionKaspaSigner(
				current as (...args: unknown[]) => unknown,
			);
		}
	}
	const constructorCandidates = [
		"Account",
		"Wallet",
		"KaspaAccount",
		"KaspaWallet",
		"WalletAccount",
		"Signer",
	];
	for (const name of constructorCandidates) {
		const ctor = getModuleExport<KaspaSignerConstructor>(candidate, name);
		if (typeof ctor === "function") {
			const signer = makeConstructorKaspaSigner(ctor);
			if (signer) return signer;
		}
		const nested = getModuleExport<Record<string, unknown>>(
			candidate,
			"default",
		);
		const nestedCtor = getModuleExport<KaspaSignerConstructor>(nested, name);
		if (nestedCtor) {
			const signer = makeConstructorKaspaSigner(nestedCtor);
			if (signer) return signer;
		}
	}
	return null;
}

function makeFunctionKaspaSigner(
	fn: (...args: unknown[]) => unknown,
): KaspaWalletSigner {
	return async function signWithFunction(
		input: KaspaWalletSignerInput,
	): Promise<string[]> {
		const payload = {
			transaction: input.transaction,
			rawTransaction: input.rawTransaction,
			hash: input.hash,
			network: input.network,
			signatureEncoding: input.signatureEncoding,
			privateKey: input.privateKey,
		};
		const attempts: unknown[][] = [
			[payload],
			[
				input.transaction,
				input.privateKey,
				input.signatureEncoding,
				input.network,
			],
			[
				input.rawTransaction,
				input.privateKey,
				input.signatureEncoding,
				input.network,
			],
			[input.privateKey, input.transaction, input.signatureEncoding],
			[input.privateKey, input.rawTransaction, input.signatureEncoding],
			[input.transaction],
			[input.privateKey],
		];
		let lastError: Error | undefined;
		for (const args of attempts) {
			try {
				const raw = await Promise.resolve(fn(...args));
				const sigs = extractSignaturesFromValue(raw);
				if (sigs.length > 0) return sigs;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}
		}
		throw new Error(
			`Kaspa wallet function signer failed to emit signatures${lastError ? `: ${lastError.message}` : ""}`,
		);
	};
}

type KaspaSignerConstructor =
	| Record<string, unknown>
	| ((...args: unknown[]) => unknown);

function makeConstructorKaspaSigner(
	ctor: KaspaSignerConstructor,
): KaspaWalletSigner | null {
	const staticFactories = [
		"fromPrivateKey",
		"fromSeed",
		"fromKey",
		"fromHex",
		"from",
		"create",
		"build",
		"load",
	];
	const signMethods = [
		"signTransaction",
		"sign",
		"signTransfer",
		"signTransactionWithPrivateKey",
		"signTx",
		"signUnsignedTransaction",
	];
	for (const factoryName of staticFactories) {
		const factory = (ctor as Record<string, unknown>)[factoryName];
		if (typeof factory !== "function") {
			continue;
		}
		return createSignerFromFactory(
			factory as (...args: unknown[]) => unknown,
			factoryName,
			signMethods,
		);
	}
	return null;
}

function createSignerFromFactory(
	factory: (...args: unknown[]) => unknown,
	factoryName: string,
	signMethods: string[],
): KaspaWalletSigner | null {
	if (typeof factory !== "function") return null;
	return async (input: KaspaWalletSignerInput): Promise<string[]> => {
		let instance: unknown;
		const initAttemptList: unknown[][] = [
			[input.privateKey],
			[""],
			[],
			[undefined],
		];
		let initError: Error | undefined;
		for (const initArgs of initAttemptList) {
			try {
				instance = factory(...initArgs);
				if (instance && typeof instance === "object") {
					break;
				}
			} catch (error) {
				initError = error instanceof Error ? error : new Error(String(error));
			}
		}
		if (!instance || typeof instance !== "object") {
			throw new Error(
				`Kaspa wallet class factory (${factoryName}) cannot instantiate signer instance${initError ? `: ${initError.message}` : ""}`,
			);
		}
		const directSign = signMethods
			.map((name) => (instance as Record<string, unknown>)[name])
			.find((entry) => typeof entry === "function");
		if (!directSign) {
			throw new Error(
				`Kaspa wallet class signer (${factoryName}) missing sign method: [${signMethods.join(", ")}]`,
			);
		}
		const objectInput = {
			transaction: input.transaction,
			rawTransaction: input.rawTransaction,
			hash: input.hash,
			network: input.network,
			signatureEncoding: input.signatureEncoding,
			privateKey: input.privateKey,
		};
		const attempts = [
			[objectInput],
			[input.transaction, input.privateKey, input.signatureEncoding],
			[input.rawTransaction, input.privateKey, input.signatureEncoding],
		];
		let lastError: Error | undefined;
		for (const args of attempts) {
			try {
				const result = await Promise.resolve(
					(directSign as KaspaSignMethod).call(instance, ...args),
				);
				const signatures = extractSignaturesFromValue(result);
				if (signatures.length > 0) {
					return signatures;
				}
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}
		}
		throw new Error(
			`Kaspa wallet class signer (${factoryName}) failed to emit signatures${lastError ? `: ${lastError.message}` : ""}`,
		);
	};
}

function pickSignatureValue(candidate: unknown): string | null {
	if (typeof candidate === "string") {
		const signature = candidate.trim();
		return signature || null;
	}
	if (candidate && typeof candidate === "object") {
		const record = candidate as Record<string, unknown>;
		const direct =
			typeof record.signature === "string"
				? record.signature
				: typeof record.sig === "string"
					? record.sig
					: undefined;
		if (typeof direct === "string" && direct.trim()) {
			return direct.trim();
		}
		if (record.signature && Array.isArray(record.signature)) {
			const values = record.signature
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => entry.trim())
				.filter((entry) => Boolean(entry));
			if (values.length > 0) {
				return values[0] ?? null;
			}
		}
	}
	return null;
}

function collectSignatureValues(value: unknown): string[] {
	if (value == null) {
		return [];
	}
	if (typeof value === "string") {
		const signature = value.trim();
		return signature ? [signature] : [];
	}
	if (Array.isArray(value)) {
		const signatures: string[] = [];
		for (const entry of value) {
			if (typeof entry === "string") {
				const signature = entry.trim();
				if (signature) {
					signatures.push(signature);
				}
				continue;
			}
			signatures.push(...collectSignatureValues(entry));
		}
		return signatures;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const direct = pickSignatureValue(record);
		const signatures: string[] = [];
		if (direct) {
			signatures.push(direct);
		}
		if (Array.isArray(record.signatures)) {
			signatures.push(...collectSignatureValues(record.signatures));
		}
		return signatures;
	}
	return [];
}

function extractSignaturesFromValue(value: unknown): string[] {
	const signatures = collectSignatureValues(value).map((entry) => entry.trim());
	const unique = new Set<string>();
	for (const signature of signatures) {
		if (signature) {
			unique.add(signature);
		}
	}
	return [...unique];
}

function raiseError(): never {
	throw new Error("signatureEncoding must be a non-empty string");
}

export function createKaspaSignTools() {
	return [
		defineTool({
			name: `${KASPA_TOOL_PREFIX}signTransferTransaction`,
			label: "Kaspa Sign Transfer Transaction",
			description:
				"Attach one or more signatures to an unsigned Kaspa submit payload for local signing workflows.",
			parameters: Type.Object({
				rawTransaction: Type.Optional(
					Type.String({
						description: "Unsigned request JSON/string to sign.",
					}),
				),
				request: Type.Optional(
					Type.Unknown({
						description:
							"Unsigned submit request object (contains the transaction skeleton).",
					}),
				),
				signature: Type.Optional(
					Type.String({
						description: "Single signature if not passing signatures array.",
					}),
				),
				signatures: Type.Optional(
					Type.Array(
						Type.String({
							description: "Signature string.",
						}),
						{ minItems: 1 },
					),
				),
				signatureEncoding: Type.Optional(
					Type.String({
						description:
							"Optional signature encoding tag (hex/base64/compact/schnorr etc).",
					}),
				),
				replaceExistingSignatures: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as {
					rawTransaction?: string;
					request?: unknown;
					signature?: string;
					signatures?: string[];
					signatureEncoding?: string;
					replaceExistingSignatures?: boolean;
				};
				const signed = signKaspaSubmitTransaction(params);
				return {
					content: [
						{
							type: "text",
							text: `Kaspa signatures attached (${signed.signatureCount} total, encoding=${signed.encoding}). requestHash=${signed.requestHash}`,
						},
					],
					details: {
						schema: "kaspa.transaction.signed.v1",
						request: signed.request,
						rawTransaction: signed.rawTransaction,
						requestHash: signed.requestHash,
						unsignedRequestHash: signed.unsignedRequestHash,
						signatureEncoding: signed.encoding,
						encoding: signed.encoding,
						appliedSignatures: signed.signatureCount,
						source: "manual",
						signingContext: signed.signingContext,
					},
				};
			},
		}),
		defineTool({
			name: `${KASPA_TOOL_PREFIX}signTransferTransactionWithWallet`,
			label: "Kaspa Sign Transfer Transaction (Wallet)",
			description:
				"Sign Kaspa transfer request via optional official wallet backends, then attach signatures.",
			parameters: Type.Object({
				rawTransaction: Type.Optional(
					Type.String({
						description: "Unsigned request JSON/string to sign.",
					}),
				),
				request: Type.Optional(
					Type.Unknown({
						description:
							"Unsigned submit request object (contains the transaction skeleton).",
					}),
				),
				privateKey: Type.String({
					description:
						"Private key bytes/encoding for wallet signing. Forwarded to selected provider only.",
				}),
				signerProvider: Type.Optional(
					Type.Union([
						Type.Literal("auto"),
						Type.Literal("kaspa-wallet"),
						Type.Literal("kaspa-wasm32-sdk"),
						Type.Literal("custom"),
					]),
				),
				providerModule: Type.Optional(
					Type.String({
						description:
							"Optional custom module path exporting Kaspa signing API.",
					}),
				),
				signatureEncoding: Type.Optional(
					Type.String({
						description:
							"Optional signature encoding tag (hex/base64/compact/schnorr etc).",
					}),
				),
				replaceExistingSignatures: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, rawParams) {
				const params = rawParams as {
					rawTransaction?: string;
					request?: unknown;
					privateKey: string;
					signerProvider?: KaspaSignerProvider;
					providerModule?: string;
					signatureEncoding?: string;
					replaceExistingSignatures?: boolean;
				};
				const signed = await signKaspaSubmitTransactionWithWallet({
					rawTransaction: params.rawTransaction,
					request: params.request,
					privateKey: params.privateKey,
					signerProvider: params.signerProvider ?? "auto",
					providerModule: params.providerModule,
					signatureEncoding: params.signatureEncoding,
					replaceExistingSignatures: params.replaceExistingSignatures,
				});
				return {
					content: [
						{
							type: "text",
							text: `Kaspa wallet signature attached (${signed.signatureCount} total, encoding=${signed.encoding}, source=${signed.source}). requestHash=${signed.requestHash}`,
						},
					],
					details: {
						schema: "kaspa.transaction.signed.v1",
						request: signed.request,
						rawTransaction: signed.rawTransaction,
						requestHash: signed.requestHash,
						unsignedRequestHash: signed.unsignedRequestHash,
						signatureEncoding: signed.encoding,
						encoding: signed.encoding,
						appliedSignatures: signed.signatureCount,
						source: signed.source,
						signingContext: signed.signingContext,
					},
				};
			},
		}),
	];
}

export function signKaspaSubmitRequest(params: {
	rawTransaction?: string;
	request?: unknown;
	signature?: string;
	signatures?: string[];
	signatureEncoding?: string;
	replaceExistingSignatures?: boolean;
}): KaspaSignedSubmissionResult {
	return signKaspaSubmitTransaction(params);
}

export function signKaspaSubmitRequestWithWallet(params: {
	rawTransaction?: string;
	request?: unknown;
	privateKey: string;
	signerProvider?: KaspaSignerProvider;
	providerModule?: string;
	signatureEncoding?: string;
	replaceExistingSignatures?: boolean;
}): Promise<KaspaSignedSubmissionResult> {
	return signKaspaSubmitTransactionWithWallet(params);
}
