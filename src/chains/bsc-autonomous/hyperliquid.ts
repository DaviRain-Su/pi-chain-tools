type EnvMap = Record<string, string | undefined>;

export type HyperliquidExecuteBinding = "none" | "prepared" | "active";

export type HyperliquidConfig = {
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

export type HyperliquidCapability = {
	canReadHealth: boolean;
	canExecute: boolean;
	executeBinding: HyperliquidExecuteBinding;
	executionTodo?: string;
};

export type HyperliquidHealthStatus = {
	ok: boolean;
	statusCode?: number;
	latencyMs?: number;
	message: string;
};

export type HyperliquidExecuteIntentInput = {
	tokenIn: string;
	tokenOut: string;
	amountRaw: string;
	slippageBps?: number;
	maxFeeBps?: number;
	runId?: string;
};

export type HyperliquidPreparedExecuteIntent = {
	protocol: "hyperliquid";
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
	executeBinding: Exclude<HyperliquidExecuteBinding, "none">;
};

export type HyperliquidExecutePreparation = {
	ok: boolean;
	executeBinding: HyperliquidExecuteBinding;
	prepared?: HyperliquidPreparedExecuteIntent;
	blockers: string[];
	remediation: string[];
};

export type HyperliquidReadiness = {
	config: HyperliquidConfig;
	capability: HyperliquidCapability;
	health: HyperliquidHealthStatus;
	executePreparation: HyperliquidExecutePreparation;
};

const DEFAULT_API_BASE_URL = "https://api.hyperliquid.com";
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

export function parseHyperliquidConfig(input?: {
	env?: EnvMap;
}): HyperliquidConfig {
	const env = input?.env ?? process.env;
	return {
		enabled: parseBoolean(env.BSC_AUTONOMOUS_HYPERLIQUID_ENABLED, false),
		apiBaseUrl: String(
			env.BSC_AUTONOMOUS_HYPERLIQUID_API_BASE_URL || DEFAULT_API_BASE_URL,
		)
			.trim()
			.replace(/\/$/, ""),
		timeoutMs: parsePositiveInteger(
			env.BSC_AUTONOMOUS_HYPERLIQUID_TIMEOUT_MS,
			DEFAULT_TIMEOUT_MS,
		),
		executeBindingEnabled: parseBoolean(
			env.BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_ENABLED,
			false,
		),
		executeBindingRequired: parseBoolean(
			env.BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_REQUIRED,
			false,
		),
		executeActive: parseBoolean(
			env.BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_ACTIVE,
			false,
		),
		executeCommand: String(
			env.BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_COMMAND || "",
		).trim(),
		routerAddress: String(
			env.BSC_AUTONOMOUS_HYPERLIQUID_ROUTER_ADDRESS || "",
		).trim(),
		executorAddress: String(
			env.BSC_AUTONOMOUS_HYPERLIQUID_EXECUTOR_ADDRESS || "",
		).trim(),
	};
}

export function resolveHyperliquidExecuteBinding(
	config: Pick<
		HyperliquidConfig,
		| "enabled"
		| "executeBindingEnabled"
		| "executeActive"
		| "executeCommand"
		| "routerAddress"
		| "executorAddress"
	>,
): HyperliquidExecuteBinding {
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

export function getHyperliquidCapability(input?: {
	config?: HyperliquidConfig;
	env?: EnvMap;
}): HyperliquidCapability {
	const config = input?.config ?? parseHyperliquidConfig({ env: input?.env });
	const executeBinding = resolveHyperliquidExecuteBinding(config);
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

export async function readHyperliquidHealth(input?: {
	config?: HyperliquidConfig;
	env?: EnvMap;
	fetchImpl?: typeof fetch;
}): Promise<HyperliquidHealthStatus> {
	const config = input?.config ?? parseHyperliquidConfig({ env: input?.env });
	if (!config.enabled) {
		return {
			ok: true,
			message: "Hyperliquid seam disabled (feature flag off).",
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
				? "Hyperliquid health endpoint reachable."
				: `Hyperliquid health returned non-OK status ${response.status}.`,
		};
	} catch (error) {
		return {
			ok: false,
			latencyMs: Date.now() - startedAt,
			message:
				error instanceof Error
					? `Hyperliquid health check failed: ${error.message}`
					: "Hyperliquid health check failed.",
		};
	} finally {
		clearTimeout(timeout);
	}
}

export function prepareHyperliquidExecuteIntent(input: {
	intent: HyperliquidExecuteIntentInput;
	config?: HyperliquidConfig;
	env?: EnvMap;
}): HyperliquidExecutePreparation {
	const config = input.config ?? parseHyperliquidConfig({ env: input.env });
	const executeBinding = resolveHyperliquidExecuteBinding(config);
	const blockers: string[] = [];
	const remediation: string[] = [];

	if (!config.enabled) {
		blockers.push("Hyperliquid feature flag is disabled.");
		remediation.push("Set BSC_AUTONOMOUS_HYPERLIQUID_ENABLED=true.");
	}
	if (!config.executeBindingEnabled) {
		blockers.push("Hyperliquid execute binding is disabled.");
		remediation.push(
			"Set BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_BINDING_ENABLED=true.",
		);
	}
	if (!config.executeCommand) {
		blockers.push("Hyperliquid execute command is missing.");
		remediation.push("Set BSC_AUTONOMOUS_HYPERLIQUID_EXECUTE_COMMAND.");
	}
	if (!config.routerAddress) {
		blockers.push("Hyperliquid router address is missing.");
		remediation.push("Set BSC_AUTONOMOUS_HYPERLIQUID_ROUTER_ADDRESS.");
	}
	if (!config.executorAddress) {
		blockers.push("Hyperliquid executor address is missing.");
		remediation.push("Set BSC_AUTONOMOUS_HYPERLIQUID_EXECUTOR_ADDRESS.");
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
	const runId = (input.intent.runId || `hyperliquid-${Date.now()}`).trim();

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
			protocol: "hyperliquid",
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

export async function getHyperliquidReadiness(input?: {
	env?: EnvMap;
	fetchImpl?: typeof fetch;
	executeIntent?: HyperliquidExecuteIntentInput;
}): Promise<HyperliquidReadiness> {
	const config = parseHyperliquidConfig({ env: input?.env });
	return {
		config,
		capability: getHyperliquidCapability({ config }),
		health: await readHyperliquidHealth({
			config,
			fetchImpl: input?.fetchImpl,
		}),
		executePreparation: prepareHyperliquidExecuteIntent({
			config,
			intent:
				input?.executeIntent ??
				({
					tokenIn: "",
					tokenOut: "",
					amountRaw: "",
				} as HyperliquidExecuteIntentInput),
		}),
	};
}
