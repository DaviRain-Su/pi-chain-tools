type EnvMap = Record<string, string | undefined>;

export type AsterDexExecuteBinding = "none" | "prepared" | "active";

export type AsterDexConfig = {
	enabled: boolean;
	apiBaseUrl: string;
	timeoutMs: number;
	executeBindingEnabled: boolean;
	executeBindingRequired: boolean;
	executeActive: boolean;
	executeCommand: string;
	routerAddress: string;
	executorAddress: string;
};

export type AsterDexCapability = {
	canReadHealth: boolean;
	canExecute: boolean;
	executeBinding: AsterDexExecuteBinding;
	executionTodo?: string;
};

export type AsterDexHealthStatus = {
	ok: boolean;
	statusCode?: number;
	latencyMs?: number;
	message: string;
};

export type AsterDexExecuteIntentInput = {
	tokenIn: string;
	tokenOut: string;
	amountRaw: string;
	slippageBps?: number;
	maxFeeBps?: number;
	runId?: string;
};

export type AsterDexPreparedExecuteIntent = {
	protocol: "asterdex";
	chain: "bsc";
	runId: string;
	tokenIn: string;
	tokenOut: string;
	amountRaw: string;
	slippageBps: number;
	maxFeeBps: number;
	routerAddress: string;
	executorAddress: string;
	executeCommand: string;
	executeBinding: Exclude<AsterDexExecuteBinding, "none">;
};

export type AsterDexExecutePreparation = {
	ok: boolean;
	executeBinding: AsterDexExecuteBinding;
	prepared?: AsterDexPreparedExecuteIntent;
	blockers: string[];
	remediation: string[];
};

export type AsterDexReadiness = {
	config: AsterDexConfig;
	capability: AsterDexCapability;
	health: AsterDexHealthStatus;
	executePreparation: AsterDexExecutePreparation;
};

const DEFAULT_API_BASE_URL = "https://api.asterdex.com";
const DEFAULT_TIMEOUT_MS = 3000;

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
	if (raw == null || raw.trim() === "") return fallback;
	return raw.trim().toLowerCase() === "true";
}

function parsePositiveInteger(
	raw: string | undefined,
	fallback: number,
	minValue = 1,
): number {
	if (raw == null || raw.trim() === "") return fallback;
	const parsed = Number.parseInt(raw.trim(), 10);
	if (!Number.isFinite(parsed) || parsed < minValue) return fallback;
	return parsed;
}

export function parseAsterDexConfig(input?: { env?: EnvMap }): AsterDexConfig {
	const env = input?.env ?? process.env;
	return {
		enabled: parseBoolean(env.BSC_AUTONOMOUS_ASTERDEX_ENABLED, false),
		apiBaseUrl: String(
			env.BSC_AUTONOMOUS_ASTERDEX_API_BASE_URL || DEFAULT_API_BASE_URL,
		)
			.trim()
			.replace(/\/$/, ""),
		timeoutMs: parsePositiveInteger(
			env.BSC_AUTONOMOUS_ASTERDEX_TIMEOUT_MS,
			DEFAULT_TIMEOUT_MS,
		),
		executeBindingEnabled: parseBoolean(
			env.BSC_AUTONOMOUS_ASTERDEX_EXECUTE_BINDING_ENABLED,
			false,
		),
		executeBindingRequired: parseBoolean(
			env.BSC_AUTONOMOUS_ASTERDEX_EXECUTE_BINDING_REQUIRED,
			false,
		),
		executeActive: parseBoolean(
			env.BSC_AUTONOMOUS_ASTERDEX_EXECUTE_ACTIVE,
			false,
		),
		executeCommand: String(
			env.BSC_AUTONOMOUS_ASTERDEX_EXECUTE_COMMAND || "",
		).trim(),
		routerAddress: String(
			env.BSC_AUTONOMOUS_ASTERDEX_ROUTER_ADDRESS || "",
		).trim(),
		executorAddress: String(
			env.BSC_AUTONOMOUS_ASTERDEX_EXECUTOR_ADDRESS || "",
		).trim(),
	};
}

export function resolveAsterDexExecuteBinding(
	config: Pick<
		AsterDexConfig,
		| "enabled"
		| "executeBindingEnabled"
		| "executeActive"
		| "executeCommand"
		| "routerAddress"
		| "executorAddress"
	>,
): AsterDexExecuteBinding {
	if (!config.enabled || !config.executeBindingEnabled) return "none";
	const requiredFields = [
		config.executeCommand,
		config.routerAddress,
		config.executorAddress,
	];
	const prepared = requiredFields.every((raw) => raw.trim() !== "");
	if (!prepared) return "none";
	return config.executeActive ? "active" : "prepared";
}

export function getAsterDexCapability(input?: {
	config?: AsterDexConfig;
	env?: EnvMap;
}): AsterDexCapability {
	const config = input?.config ?? parseAsterDexConfig({ env: input?.env });
	const executeBinding = resolveAsterDexExecuteBinding(config);
	return {
		canReadHealth: true,
		canExecute: executeBinding === "active",
		executeBinding,
		executionTodo:
			executeBinding === "active"
				? undefined
				: "TODO(onchain-binding): activate signed onchain execution path only after explicit risk/confirmation gates.",
	};
}

export async function readAsterDexHealth(input?: {
	config?: AsterDexConfig;
	env?: EnvMap;
	fetchImpl?: typeof fetch;
}): Promise<AsterDexHealthStatus> {
	const config = input?.config ?? parseAsterDexConfig({ env: input?.env });
	if (!config.enabled) {
		return {
			ok: true,
			message: "AsterDEX seam disabled (feature flag off).",
		};
	}

	const fetchImpl = input?.fetchImpl ?? fetch;
	const startedAt = Date.now();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
	try {
		const response = await fetchImpl(`${config.apiBaseUrl}/health`, {
			method: "GET",
			headers: { accept: "application/json" },
			signal: controller.signal,
		});
		return {
			ok: response.ok,
			statusCode: response.status,
			latencyMs: Date.now() - startedAt,
			message: response.ok
				? "AsterDEX health endpoint reachable."
				: `AsterDEX health returned non-OK status ${response.status}.`,
		};
	} catch (error) {
		return {
			ok: false,
			latencyMs: Date.now() - startedAt,
			message:
				error instanceof Error
					? `AsterDEX health check failed: ${error.message}`
					: "AsterDEX health check failed.",
		};
	} finally {
		clearTimeout(timeout);
	}
}

export function prepareAsterDexExecuteIntent(input: {
	intent: AsterDexExecuteIntentInput;
	config?: AsterDexConfig;
	env?: EnvMap;
}): AsterDexExecutePreparation {
	const config = input.config ?? parseAsterDexConfig({ env: input.env });
	const executeBinding = resolveAsterDexExecuteBinding(config);
	const blockers: string[] = [];
	const remediation: string[] = [];

	if (!config.enabled) {
		blockers.push("AsterDEX feature flag is disabled.");
		remediation.push("Set BSC_AUTONOMOUS_ASTERDEX_ENABLED=true.");
	}
	if (!config.executeBindingEnabled) {
		blockers.push("AsterDEX execute binding is disabled.");
		remediation.push(
			"Set BSC_AUTONOMOUS_ASTERDEX_EXECUTE_BINDING_ENABLED=true.",
		);
	}
	if (!config.executeCommand) {
		blockers.push("AsterDEX execute command is missing.");
		remediation.push("Set BSC_AUTONOMOUS_ASTERDEX_EXECUTE_COMMAND.");
	}
	if (!config.routerAddress) {
		blockers.push("AsterDEX router address is missing.");
		remediation.push("Set BSC_AUTONOMOUS_ASTERDEX_ROUTER_ADDRESS.");
	}
	if (!config.executorAddress) {
		blockers.push("AsterDEX executor address is missing.");
		remediation.push("Set BSC_AUTONOMOUS_ASTERDEX_EXECUTOR_ADDRESS.");
	}

	if (executeBinding === "none") {
		return {
			ok: false,
			executeBinding,
			blockers,
			remediation,
		};
	}

	const tokenIn = input.intent.tokenIn.trim();
	const tokenOut = input.intent.tokenOut.trim();
	const amountRaw = input.intent.amountRaw.trim();
	const slippageBps = input.intent.slippageBps ?? 50;
	const maxFeeBps = input.intent.maxFeeBps ?? 100;
	const runId = (input.intent.runId || `asterdex-${Date.now()}`).trim();

	if (!tokenIn || !tokenOut || !amountRaw) {
		return {
			ok: false,
			executeBinding,
			blockers: [
				"Invalid execute intent input (tokenIn, tokenOut, amountRaw are required).",
			],
			remediation: ["Provide non-empty tokenIn/tokenOut/amountRaw."],
		};
	}

	return {
		ok: true,
		executeBinding,
		blockers,
		remediation,
		prepared: {
			protocol: "asterdex",
			chain: "bsc",
			runId,
			tokenIn,
			tokenOut,
			amountRaw,
			slippageBps,
			maxFeeBps,
			routerAddress: config.routerAddress,
			executorAddress: config.executorAddress,
			executeCommand: config.executeCommand,
			executeBinding,
		},
	};
}

export async function getAsterDexReadiness(input?: {
	env?: EnvMap;
	fetchImpl?: typeof fetch;
	executeIntent?: AsterDexExecuteIntentInput;
}): Promise<AsterDexReadiness> {
	const config = parseAsterDexConfig({ env: input?.env });
	return {
		config,
		capability: getAsterDexCapability({ config }),
		health: await readAsterDexHealth({ config, fetchImpl: input?.fetchImpl }),
		executePreparation: prepareAsterDexExecuteIntent({
			config,
			intent:
				input?.executeIntent ??
				({
					tokenIn: "",
					tokenOut: "",
					amountRaw: "",
				} as AsterDexExecuteIntentInput),
		}),
	};
}
