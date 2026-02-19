import { describe, expect, it } from "vitest";
import {
	PI_MCP_ENVELOPE_INVALID,
	PI_MCP_EXECUTE_BLOCKED,
	type PiMcpRoute,
	createPiMcpAdapter,
	validatePiMcpEnvelope,
} from "./pi-mcp-adapter.js";

function createMockRoute(): PiMcpRoute {
	return {
		id: "mock.read-plan",
		supports: ["read", "plan"],
		canHandle(envelope) {
			return envelope.intent === "near.balance.lookup";
		},
		async handleRead({ envelope }) {
			return {
				status: "accepted",
				message: `read:${envelope.intent}`,
			};
		},
		async handlePlan({ envelope }) {
			return {
				status: "accepted",
				message: `plan:${envelope.intent}`,
			};
		},
	};
}

describe("pi-mcp-adapter", () => {
	it("accepts valid read envelope via normalization", () => {
		const result = validatePiMcpEnvelope({
			id: "task-1",
			phase: "read",
			intent: "near.balance.lookup",
			payload: { accountId: "alice.near" },
		});

		expect(result.ok).toBe(true);
		expect(result.envelope?.phase).toBe("read");
		expect(result.envelope?.intent).toBe("near.balance.lookup");
	});

	it("rejects invalid envelope shape", () => {
		const result = validatePiMcpEnvelope({
			id: "",
			phase: "discover",
			intent: 42,
			payload: "invalid",
		});

		expect(result.ok).toBe(false);
		expect(result.errors).toContain("id must be a non-empty string");
		expect(result.errors).toContain(
			"phase must be one of: read | plan | execute",
		);
		expect(result.errors).toContain("intent must be a non-empty string");
		expect(result.errors).toContain("payload must be an object");
	});

	it("routes read/plan and rejects execute bypass", async () => {
		const adapter = createPiMcpAdapter([createMockRoute()]);

		const readResult = await adapter.route({
			id: "task-read",
			phase: "read",
			intent: "near.balance.lookup",
			payload: { accountId: "alice.near" },
		});
		expect(readResult.status).toBe("accepted");
		expect(readResult.message).toBe("read:near.balance.lookup");

		const planResult = await adapter.route({
			id: "task-plan",
			phase: "plan",
			intent: "near.balance.lookup",
			payload: { accountId: "alice.near" },
		});
		expect(planResult.status).toBe("accepted");
		expect(planResult.message).toBe("plan:near.balance.lookup");

		const executeResult = await adapter.route({
			id: "task-exec",
			phase: "execute",
			intent: "near.transfer.near",
			payload: { toAccountId: "bob.near", amountNear: "1" },
		});
		expect(executeResult.status).toBe("rejected");
		expect(executeResult.message).toBe(PI_MCP_EXECUTE_BLOCKED);
		expect(executeResult.details?.reason).toContain("Execute is blocked");
	});

	it("returns envelope-invalid when route input fails schema check", async () => {
		const adapter = createPiMcpAdapter([createMockRoute()]);

		const result = await adapter.route("not-an-envelope");
		expect(result.status).toBe("rejected");
		expect(result.message).toBe(PI_MCP_ENVELOPE_INVALID);
		expect(Array.isArray(result.details?.errors)).toBe(true);
	});

	it("supports route discovery for read/plan only", () => {
		const adapter = createPiMcpAdapter([createMockRoute()]);
		expect(adapter.discoverRoutes().length).toBe(1);
		expect(adapter.discoverRoutes("read").length).toBe(1);
		expect(adapter.discoverRoutes("plan").length).toBe(1);
	});
});
