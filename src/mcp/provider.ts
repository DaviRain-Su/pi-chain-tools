export type McpCapability = "search" | "quote" | "plan";

export interface McpProviderContext {
	providerId: string;
	requestId?: string;
}

export interface McpProviderResult<T = Record<string, unknown>> {
	ok: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: Record<string, unknown>;
	};
	warnings?: string[];
	raw?: unknown;
}

export interface McpProvider {
	id: string;
	label: string;
	capabilities: readonly McpCapability[];
	search?(
		query: string,
		context: McpProviderContext,
	): Promise<McpProviderResult>;
	quote?(
		params: Record<string, unknown>,
		context: McpProviderContext,
	): Promise<McpProviderResult>;
	plan?(
		params: Record<string, unknown>,
		context: McpProviderContext,
	): Promise<McpProviderResult>;
}

export interface McpAdapterProviderMeta {
	id: string;
	label: string;
	capabilities: readonly McpCapability[];
}
