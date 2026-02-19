import type {
	McpAdapterProviderMeta,
	McpProvider,
	McpProviderResult,
} from "../mcp/provider.js";
import { createDflowMcpProvider } from "../mcp/providers/dflow.js";
import {
	type McpProviderRegistry,
	createMcpProviderRegistry,
} from "../mcp/registry.js";

export interface McpAdapterResponse<T = Record<string, unknown>> {
	action: "mcp.search" | "mcp.quote" | "mcp.plan";
	ok: boolean;
	provider: McpAdapterProviderMeta;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: Record<string, unknown>;
	};
	warnings: string[];
	safety: {
		mode: "read_plan_only";
		note: string;
	};
}

export interface McpAdapter {
	registry: McpProviderRegistry;
	search(args: {
		query: string;
		providerId?: string;
		requestId?: string;
	}): Promise<McpAdapterResponse>;
	quote(args: {
		params: Record<string, unknown>;
		providerId?: string;
		requestId?: string;
	}): Promise<McpAdapterResponse>;
	plan(args: {
		params: Record<string, unknown>;
		providerId?: string;
		requestId?: string;
	}): Promise<McpAdapterResponse>;
}

const SAFETY_NOTE =
	"MCP adapter is read/plan-only by default. Execution must go through PI SDK confirm/risk/policy/reconcile safeguards.";

function buildProviderMeta(provider: McpProvider): McpAdapterProviderMeta {
	return {
		id: provider.id,
		label: provider.label,
		capabilities: provider.capabilities,
	};
}

function notSupportedResponse(args: {
	action: McpAdapterResponse["action"];
	provider: McpProvider;
	reason: string;
}): McpAdapterResponse {
	return {
		action: args.action,
		ok: false,
		provider: buildProviderMeta(args.provider),
		error: {
			code: "not_supported",
			message: args.reason,
		},
		warnings: [`${args.provider.id} does not support ${args.action}`],
		safety: {
			mode: "read_plan_only",
			note: SAFETY_NOTE,
		},
	};
}

function normalizeResponse(args: {
	action: McpAdapterResponse["action"];
	provider: McpProvider;
	result: McpProviderResult;
}): McpAdapterResponse {
	return {
		action: args.action,
		ok: args.result.ok,
		provider: buildProviderMeta(args.provider),
		data: args.result.data,
		error: args.result.error,
		warnings: args.result.warnings ?? [],
		safety: {
			mode: "read_plan_only",
			note: SAFETY_NOTE,
		},
	};
}

function resolveProviderOrThrow(
	registry: McpProviderRegistry,
	providerId?: string,
): McpProvider {
	const provider = registry.resolve(providerId);
	if (provider) return provider;
	throw new Error(`MCP provider not found: ${providerId || "<default>"}`);
}

export function createMcpAdapter(args?: {
	providers?: McpProvider[];
	defaultProviderId?: string;
	registry?: McpProviderRegistry;
}): McpAdapter {
	const registry =
		args?.registry ??
		createMcpProviderRegistry({
			providers: args?.providers?.length
				? args.providers
				: [createDflowMcpProvider()],
			defaultProviderId: args?.defaultProviderId,
		});

	return {
		registry,
		async search({ query, providerId, requestId }) {
			const provider = resolveProviderOrThrow(registry, providerId);
			if (!provider.search) {
				return notSupportedResponse({
					action: "mcp.search",
					provider,
					reason: "search capability is not supported by provider",
				});
			}
			const result = await provider.search(query, {
				providerId: provider.id,
				requestId,
			});
			return normalizeResponse({
				action: "mcp.search",
				provider,
				result,
			});
		},
		async quote({ params, providerId, requestId }) {
			const provider = resolveProviderOrThrow(registry, providerId);
			if (!provider.quote) {
				return notSupportedResponse({
					action: "mcp.quote",
					provider,
					reason: "quote capability is not supported by provider",
				});
			}
			const result = await provider.quote(params, {
				providerId: provider.id,
				requestId,
			});
			return normalizeResponse({
				action: "mcp.quote",
				provider,
				result,
			});
		},
		async plan({ params, providerId, requestId }) {
			const provider = resolveProviderOrThrow(registry, providerId);
			if (!provider.plan) {
				return notSupportedResponse({
					action: "mcp.plan",
					provider,
					reason: "plan capability is not supported by provider",
				});
			}
			const result = await provider.plan(params, {
				providerId: provider.id,
				requestId,
			});
			return normalizeResponse({
				action: "mcp.plan",
				provider,
				result,
			});
		},
	};
}
