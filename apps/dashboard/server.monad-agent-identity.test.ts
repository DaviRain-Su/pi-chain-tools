import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
	buildAgentIdentity,
	createDelegationIntentPayload,
	verifyDelegationIntentPayload,
} from "./monad-agent.mjs";

const serverPath = path.resolve("apps", "dashboard", "server.mjs");
const serverSource = readFileSync(serverPath, "utf8");

describe("monad agent identity + delegation v1.3", () => {
	it("exposes identity + delegation routes with confirm gates", () => {
		expect(serverSource).toContain("/api/monad/agent/identity");
		expect(serverSource).toContain("/api/monad/agent/identity/register");
		expect(serverSource).toContain("/api/monad/agent/delegation/prepare");
		expect(serverSource).toContain("/api/monad/agent/delegation/submit");
		expect(serverSource).toContain("/api/monad/agent/delegation/revoke");
		expect(serverSource).toContain("Missing confirm=true");
	});

	it("builds deterministic identity id", () => {
		const one = buildAgentIdentity({
			accountId: "davirain8.near",
			operatorAddress: "0x1111111111111111111111111111111111111111",
			rpcUrl: "https://rpc.monad.xyz",
			chainId: 143,
			vault: "0x2222222222222222222222222222222222222222",
		});
		const two = buildAgentIdentity({
			accountId: "davirain8.near",
			operatorAddress: "0x1111111111111111111111111111111111111111",
			rpcUrl: "https://rpc.monad.xyz",
			chainId: 143,
			vault: "0x2222222222222222222222222222222222222222",
		});
		expect(one.agentId).toBe(two.agentId);
		expect(one.agentId.startsWith("monad-agent-")).toBe(true);
	});

	it("prepares + verifies delegation payload", () => {
		const payload = createDelegationIntentPayload({
			agentId: "monad-agent-demo",
			delegatee: "0x3333333333333333333333333333333333333333",
			scope: ["monad:morpho:earn:execute"],
			nonce: "n-1",
			now: 1_700_000_000,
			expiresAt: 1_900_000_000,
			revocable: true,
			chainId: 143,
			verifyingContract: "0x4444444444444444444444444444444444444444",
			signature: "demo-signature",
		});
		const verify = verifyDelegationIntentPayload({
			payload,
			now: 1_700_000_100,
		});
		expect(payload.digest.startsWith("0x")).toBe(true);
		expect(verify.ok).toBe(true);
		expect(verify.blockers.length).toBe(0);
	});
});
