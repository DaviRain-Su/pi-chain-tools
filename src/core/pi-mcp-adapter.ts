export const PI_MCP_EXECUTE_BLOCKED = "PI_MCP_EXECUTE_BLOCKED" as const;
export const PI_MCP_ENVELOPE_INVALID = "PI_MCP_ENVELOPE_INVALID" as const;

export type PiMcpTaskPhase = "read" | "plan" | "execute";

export interface PiMcpTaskEnvelope {
	id: string;
	phase: PiMcpTaskPhase;
	intent: string;
	payload: Record<string, unknown>;
	meta?: Record<string, unknown>;
}

export interface PiMcpValidationResult {
	ok: boolean;
	errors: string[];
	envelope?: PiMcpTaskEnvelope;
}

export interface PiMcpRouteContext {
	envelope: PiMcpTaskEnvelope;
}

export interface PiMcpRouteResult {
	status: "accepted" | "rejected";
	message: string;
	details?: Record<string, unknown>;
}

export interface PiMcpRoute {
	id: string;
	description?: string;
	supports: readonly Exclude<PiMcpTaskPhase, "execute">[];
	canHandle(envelope: PiMcpTaskEnvelope): boolean;
	handleRead?(context: PiMcpRouteContext): Promise<PiMcpRouteResult>;
	handlePlan?(context: PiMcpRouteContext): Promise<PiMcpRouteResult>;
}

export interface PiMcpAdapter {
	discoverRoutes(phase?: Exclude<PiMcpTaskPhase, "execute">): PiMcpRoute[];
	normalizeEnvelope(input: unknown): PiMcpValidationResult;
	route(input: unknown): Promise<PiMcpRouteResult>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function asTaskPhase(value: unknown): PiMcpTaskPhase | null {
	if (value === "read" || value === "plan" || value === "execute") {
		return value;
	}
	return null;
}

export function validatePiMcpEnvelope(input: unknown): PiMcpValidationResult {
	if (!isObjectRecord(input)) {
		return {
			ok: false,
			errors: ["envelope must be an object"],
		};
	}

	const errors: string[] = [];
	const id = asNonEmptyString(input.id);
	const intent = asNonEmptyString(input.intent);
	const phase = asTaskPhase(input.phase);
	const payload = isObjectRecord(input.payload) ? input.payload : null;
	const meta = input.meta;

	if (!id) errors.push("id must be a non-empty string");
	if (!intent) errors.push("intent must be a non-empty string");
	if (!phase) errors.push("phase must be one of: read | plan | execute");
	if (!payload) errors.push("payload must be an object");
	if (meta !== undefined && !isObjectRecord(meta)) {
		errors.push("meta must be an object when provided");
	}

	if (errors.length > 0 || !id || !intent || !phase || !payload) {
		return { ok: false, errors };
	}

	return {
		ok: true,
		errors: [],
		envelope: {
			id,
			phase,
			intent,
			payload,
			meta: isObjectRecord(meta) ? meta : undefined,
		},
	};
}

export function createPiMcpAdapter(routes: PiMcpRoute[]): PiMcpAdapter {
	const normalizedRoutes = Array.isArray(routes) ? [...routes] : [];

	return {
		discoverRoutes(phase) {
			if (!phase) return [...normalizedRoutes];
			return normalizedRoutes.filter((route) => route.supports.includes(phase));
		},

		normalizeEnvelope(input) {
			return validatePiMcpEnvelope(input);
		},

		async route(input) {
			const validation = validatePiMcpEnvelope(input);
			if (!validation.ok || !validation.envelope) {
				return {
					status: "rejected",
					message: PI_MCP_ENVELOPE_INVALID,
					details: {
						errors: validation.errors,
					},
				};
			}

			const { envelope } = validation;
			if (envelope.phase === "execute") {
				return {
					status: "rejected",
					message: PI_MCP_EXECUTE_BLOCKED,
					details: {
						reason:
							"Execute is blocked at adapter boundary; use PI SDK execute path with confirm/risk/policy/reconcile safeguards.",
					},
				};
			}

			const nonExecutePhase = envelope.phase;
			const route = normalizedRoutes.find((candidate) => {
				if (nonExecutePhase !== "read" && nonExecutePhase !== "plan") {
					return false;
				}
				if (!candidate.supports.includes(nonExecutePhase)) return false;
				return candidate.canHandle(envelope);
			});

			if (!route) {
				return {
					status: "rejected",
					message: "PI_MCP_ROUTE_NOT_FOUND",
					details: {
						phase: envelope.phase,
						intent: envelope.intent,
					},
				};
			}

			if (envelope.phase === "read") {
				if (!route.handleRead) {
					return {
						status: "rejected",
						message: "PI_MCP_ROUTE_UNSUPPORTED_PHASE",
						details: { routeId: route.id, phase: envelope.phase },
					};
				}
				return route.handleRead({ envelope });
			}

			if (!route.handlePlan) {
				return {
					status: "rejected",
					message: "PI_MCP_ROUTE_UNSUPPORTED_PHASE",
					details: { routeId: route.id, phase: envelope.phase },
				};
			}
			return route.handlePlan({ envelope });
		},
	};
}
