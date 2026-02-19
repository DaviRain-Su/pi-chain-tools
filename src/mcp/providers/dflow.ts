import type {
	McpProvider,
	McpProviderContext,
	McpProviderResult,
} from "../provider.js";

const DEFAULT_DFLOW_MCP_URL = "https://pond.dflow.net/mcp";

type FetchLike = typeof fetch;

function resolveDflowMcpUrl(explicit?: string): string {
	const fromEnv = process.env.DFLOW_MCP_URL || process.env.PI_MCP_DFLOW_URL;
	const candidate = explicit || fromEnv || DEFAULT_DFLOW_MCP_URL;
	return candidate.trim();
}

async function callDflowSearch(args: {
	query: string;
	endpoint: string;
	fetchImpl: FetchLike;
	context: McpProviderContext;
}): Promise<McpProviderResult> {
	const base = args.endpoint.replace(/\/$/, "");
	const endpoint = `${base}.fetch`;
	const requestBody = {
		query: args.query,
		meta: {
			requestId: args.context.requestId,
			providerId: args.context.providerId,
		},
	};

	const response = await args.fetchImpl(endpoint, {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify(requestBody),
	});

	const rawText = await response.text();
	let parsed: unknown = rawText;
	try {
		parsed = rawText ? JSON.parse(rawText) : null;
	} catch {
		// keep raw text
	}

	if (!response.ok) {
		return {
			ok: false,
			error: {
				code: "provider_http_error",
				message: `DFlow MCP search failed with status ${response.status}`,
				details: {
					status: response.status,
					endpoint,
				},
			},
			raw: parsed,
		};
	}

	return {
		ok: true,
		data: {
			query: args.query,
			result: parsed,
		},
		raw: parsed,
	};
}

export function createDflowMcpProvider(args?: {
	endpoint?: string;
	fetchImpl?: FetchLike;
}): McpProvider {
	const endpoint = resolveDflowMcpUrl(args?.endpoint);
	const fetchImpl = args?.fetchImpl ?? fetch;

	return {
		id: "dflow",
		label: "DFlow MCP",
		capabilities: ["search"],
		async search(query, context) {
			if (!query.trim()) {
				return {
					ok: false,
					error: {
						code: "invalid_query",
						message: "query must be a non-empty string",
					},
				};
			}
			return callDflowSearch({
				query,
				endpoint,
				fetchImpl,
				context,
			});
		},
	};
}

export { DEFAULT_DFLOW_MCP_URL };
