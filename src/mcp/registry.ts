import type { McpProvider } from "./provider.js";

export const DEFAULT_MCP_PROVIDER_ID = "dflow" as const;

function normalizeProviderId(value: string | undefined | null): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	return normalized.length ? normalized : null;
}

export interface McpProviderRegistry {
	list(): McpProvider[];
	resolve(providerId?: string): McpProvider | null;
	getDefaultProviderId(): string;
}

export function createMcpProviderRegistry(args: {
	providers: McpProvider[];
	defaultProviderId?: string;
}): McpProviderRegistry {
	const map = new Map<string, McpProvider>();
	for (const provider of args.providers) {
		map.set(provider.id.toLowerCase(), provider);
	}

	const configuredDefault =
		normalizeProviderId(args.defaultProviderId) ??
		normalizeProviderId(process.env.PI_MCP_PROVIDER) ??
		DEFAULT_MCP_PROVIDER_ID;
	const defaultProviderId =
		(configuredDefault && map.has(configuredDefault)
			? configuredDefault
			: normalizeProviderId(args.providers[0]?.id)) ?? DEFAULT_MCP_PROVIDER_ID;

	return {
		list() {
			return Array.from(map.values());
		},
		resolve(providerId) {
			const target = normalizeProviderId(providerId) ?? defaultProviderId;
			return target ? (map.get(target) ?? null) : null;
		},
		getDefaultProviderId() {
			return defaultProviderId;
		},
	};
}
