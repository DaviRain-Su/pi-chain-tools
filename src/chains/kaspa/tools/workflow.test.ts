import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createKaspaWorkflowTools } from "./workflow.js";

type WorkflowTool = {
	execute(
		_toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

function getTool(name: string): WorkflowTool {
	const tool = createKaspaWorkflowTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as WorkflowTool;
}

function mockFetchJson({
	status,
	body,
	statusText,
}: {
	status: number;
	body: unknown;
	statusText?: string;
}) {
	fetchMock.mockResolvedValueOnce({
		ok: status >= 200 && status < 300,
		status,
		statusText:
			statusText ?? (status >= 200 && status < 300 ? "OK" : "Bad Request"),
		text: vi.fn().mockResolvedValue(JSON.stringify(body)),
	} as unknown as Response);
}

beforeEach(() => {
	vi.clearAllMocks();
	global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
	global.fetch = ORIGINAL_FETCH as typeof fetch;
	fetchMock.mockReset();
});

const sampleAddressA =
	"kaspa:qtestsender11111111111111111111111111111111111111111111111111";
const sampleAddressB =
	"kaspa:qtestreceiver11111111111111111111111111111111111111111111111111";

function expectPreflightCallCount(expected: number): void {
	expect(fetchMock).toHaveBeenCalledTimes(expected);
}

function mockKaspaPreflight() {
	mockFetchJson({ status: 200, body: { minFee: 1 } });
	mockFetchJson({ status: 200, body: { mempool: [] } });
	mockFetchJson({
		status: 200,
		body: { chainState: "ready", blockCount: 100 },
	});
}

describe("kaspa workflow tools", () => {
	it("runs analysis with compose inputs and returns confirmToken", async () => {
		const tool = getTool("w3rt_run_kaspa_workflow_v0");
		mockKaspaPreflight();
		const result = await tool.execute("kaspa-wf-analysis", {
			runMode: "analysis",
			runId: "wf-compose-analysis",
			network: "testnet10",
			fromAddress: sampleAddressA,
			toAddress: sampleAddressB,
			amount: "1.23",
			utxos: [
				{
					txId: "txid-1",
					index: 0,
					amount: "2",
				},
			],
			feeRate: 2,
		});
		const details = result.details as {
			runMode: "analysis";
			confirmToken?: string;
			request?: Record<string, unknown>;
			artifacts: { analysis?: { confirmToken?: string; requestHash?: string } };
		};
		expect(details.runMode).toBe("analysis");
		expect(details.confirmToken).toBeDefined();
		expect(details.artifacts?.analysis?.confirmToken).toBe(
			details.confirmToken,
		);
		expect(details.request).toBeDefined();
		expect(details.artifacts?.analysis?.requestHash).toHaveLength(64);
		expectPreflightCallCount(3);
	});

	it("runs simulate with rawTransaction payload", async () => {
		const tool = getTool("w3rt_run_kaspa_workflow_v0");
		mockKaspaPreflight();
		const result = await tool.execute("kaspa-wf-sim", {
			runMode: "simulate",
			network: "testnet10",
			rawTransaction: JSON.stringify({
				version: 0,
				network: "kaspa-testnet10",
				inputs: [],
				outputs: [],
				mass: 120,
			}),
		});
		const details = result.details as {
			runMode: "simulate";
			runId: string;
		};
		expect(details.runMode).toBe("simulate");
		expect(details.runId).toBeTruthy();
		expectPreflightCallCount(3);
	});

	it("executes using prior workflow session and confirmToken", async () => {
		const tool = getTool("w3rt_run_kaspa_workflow_v0");
		mockKaspaPreflight();
		const analysis = await tool.execute("kaspa-wf-ana-exec", {
			runMode: "analysis",
			runId: "wf-session",
			network: "testnet10",
			rawTransaction: JSON.stringify({
				version: 0,
				network: "kaspa-testnet10",
				inputs: [{ txId: "txid", index: 0, amount: "1" }],
				outputs: [{ address: sampleAddressB, amount: "0.5" }],
			}),
		});
		const details = analysis.details as { confirmToken?: string };
		const token = details.confirmToken;
		expect(token).toBeTypeOf("string");
		fetchMock.mockReset();
		mockFetchJson({
			status: 200,
			body: { status: "accepted", txid: "tx-session" },
		});
		const executeResult = await tool.execute("kaspa-wf-exec", {
			runMode: "execute",
			runId: "wf-session",
			network: "testnet10",
			confirmToken: token,
		});
		expect(executeResult.content[0]?.text).toContain("Kaspa workflow executed");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const calledBody = JSON.parse(
			(fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}",
		);
		expect(calledBody.transaction).toBeDefined();
	});

	it("guards mainnet execute without confirmMainnet", async () => {
		const tool = getTool("w3rt_run_kaspa_workflow_v0");
		mockKaspaPreflight();
		const analysis = await tool.execute("kaspa-wf-mainnet-ana", {
			runMode: "analysis",
			runId: "wf-mainnet",
			network: "mainnet",
			rawTransaction: JSON.stringify({
				version: 0,
				network: "kaspa-mainnet",
				inputs: [{ txId: "txid", index: 0, amount: "1" }],
				outputs: [{ address: sampleAddressB, amount: "0.5" }],
			}),
		});
		const token = (analysis.details as { confirmToken?: string }).confirmToken;
		expect(token).toBeTypeOf("string");
		fetchMock.mockReset();
		await expect(
			tool.execute("kaspa-wf-mainnet-exec", {
				runMode: "execute",
				runId: "wf-mainnet",
				network: "mainnet",
				confirmToken: token,
			}),
		).rejects.toThrow("Mainnet Kaspa execution is blocked");
		expect(fetchMock).toHaveBeenCalledTimes(0);
	});
});
