type EnvMap = Record<string, string | undefined>;

export type AsterDexConfig = {
	enabled: boolean;
	apiBaseUrl: string;
	timeoutMs: number;
};

export type AsterDexCapability = {
	canReadHealth: boolean;
	canExecute: false;
	executionTodo: string;
};

export type AsterDexHealthStatus = {
	ok: boolean;
	statusCode?: number;
	latencyMs?: number;
	message: string;
};

export type AsterDexReadiness = {
	config: AsterDexConfig;
	capability: AsterDexCapability;
	health: AsterDexHealthStatus;
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
	};
}

export function getAsterDexCapability(): AsterDexCapability {
	return {
		canReadHealth: true,
		canExecute: false,
		executionTodo:
			"TODO(onchain-binding): wire signed onchain execution path with explicit risk/confirmation gates.",
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

export async function getAsterDexReadiness(input?: {
	env?: EnvMap;
	fetchImpl?: typeof fetch;
}): Promise<AsterDexReadiness> {
	const config = parseAsterDexConfig({ env: input?.env });
	return {
		config,
		capability: getAsterDexCapability(),
		health: await readAsterDexHealth({ config, fetchImpl: input?.fetchImpl }),
	};
}
