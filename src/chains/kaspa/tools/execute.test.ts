import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKaspaExecuteTools } from "./execute.js";

type ExecuteTool = {
	execute(
		_toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

function getTool(name: string): ExecuteTool {
	const tool = createKaspaExecuteTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ExecuteTool;
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
		statusText: statusText ?? (status >= 200 && status < 300 ? "OK" : "Bad Request"),
		text: vi.fn().mockResolvedValue(JSON.stringify(body)),
	} as unknown as Response);
}

async function getAnalysisConfirmToken(
	tool: ExecuteTool,
	input: Record<string, unknown>,
): Promise<string> {
	mockFetchJson({ status: 200, body: { minFee: 1 } });
	mockFetchJson({ status: 200, body: { mempool: [] } });
	mockFetchJson({
		status: 200,
		body: { chainState: "ready", blockCount: 100 },
	});
	const result = await tool.execute("kaspa-submit-analysis", {
		network: "testnet",
		runMode: "analysis",
		...input,
	});
	const token = (result.details as { confirmToken?: string } | undefined)?.confirmToken;
	if (!token) {
		throw new Error("analysis confirmToken missing");
	}
	expect(fetchMock).toHaveBeenCalledTimes(3);
	return token;
}

beforeEach(() => {
	vi.clearAllMocks();
	global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
	global.fetch = ORIGINAL_FETCH as typeof fetch;
	fetchMock.mockReset();
});

describe("kaspa execute tools", () => {
	it("runs preflight in analysis mode and returns confirmToken", async () => {
		const tool = getTool("kaspa_submitTransaction");
		mockFetchJson({ status: 200, body: { minFee: 1 } });
		mockFetchJson({ status: 200, body: { mempool: [] } });
		mockFetchJson({
			status: 200,
			body: { chainState: "ready", blockCount: 100 },
		});
		const result = await tool.execute("kaspa-submit-analysis", {
			network: "testnet",
			runMode: "analysis",
			rawTransaction: "00abccddee",
		});
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(result.details).toMatchObject({
			schema: "kaspa.transaction.analysis.v1",
			network: "testnet",
			confirmToken: expect.any(String),
		});
		const firstCall = new URL(fetchMock.mock.calls[0]?.[0]?.toString() ?? "");
		const secondCall = new URL(fetchMock.mock.calls[1]?.[0]?.toString() ?? "");
		const thirdCall = new URL(fetchMock.mock.calls[2]?.[0]?.toString() ?? "");
		expect(firstCall.pathname).toBe("/info/fee-estimate");
		expect(secondCall.pathname).toBe("/info/kaspad");
		expect(thirdCall.pathname).toBe("/info/blockdag");
	});

	it("submits pre-signed transaction to testnet", async () => {
		const tool = getTool("kaspa_submitTransaction");
		const token = await getAnalysisConfirmToken(tool, { rawTransaction: "00abccddee" });
		fetchMock.mockReset();
		mockFetchJson({
			status: 200,
			body: { txid: "tx-submitted-001", status: "accepted" },
		});

		const result = await tool.execute("kaspa-submit", {
			network: "testnet",
			runMode: "execute",
			rawTransaction: "00abccddee",
			confirmToken: token,
		});

		expect(result.content[0]?.text).toContain("Kaspa transaction submitted");
		expect(result.content[0]?.text).toContain("testnet");
		expect(result.details).toMatchObject({
			schema: "kaspa.transaction.submit.v1",
			network: "testnet",
			txId: "tx-submitted-001",
			receipt: {
				kind: "kaspa-submit-receipt",
				submitPath: "/transactions",
				broadcastStatus: "submitted-without-id",
				preflightRiskLevel: expect.any(String),
				preflightReadiness: expect.any(String),
			},
		});
		const calledUrl = new URL(fetchMock.mock.calls[0]?.[0]?.toString() ?? "");
		expect(calledUrl.pathname).toBe("/transactions");
		const calledBody = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
		expect(calledBody).toMatchObject({ transaction: "00abccddee" });
	});

	it("supports skipping all preflight checks and still returns confirmToken", async () => {
		const tool = getTool("kaspa_submitTransaction");
		const result = await tool.execute("kaspa-submit-analysis-skip", {
			network: "testnet",
			runMode: "analysis",
			rawTransaction: "00abccddee",
			skipFeePreflight: true,
			skipMempoolPreflight: true,
			skipReadStatePreflight: true,
		});
		expect(fetchMock).toHaveBeenCalledTimes(0);
		expect(result.details).toMatchObject({
			schema: "kaspa.transaction.analysis.v1",
			network: "testnet",
			confirmToken: expect.any(String),
		});
		expect(result.details?.preflight?.readiness).toBe("ready");
		expect(result.details?.preflight?.riskLevel).toBe("low");
	});

	it("merges request body and preserves rawTransaction as transaction", async () => {
		const tool = getTool("kaspa_submitTransaction");
		const token = await getAnalysisConfirmToken(tool, { rawTransaction: "raw-1" });
		fetchMock.mockReset();
		mockFetchJson({
			status: 200,
			body: { txid: "merged-tx", status: "accepted" },
		});
		await tool.execute("kaspa-submit-merge", {
			network: "testnet",
			runMode: "execute",
			rawTransaction: "raw-1",
			request: { payload: { key: "value" } },
			confirmToken: token,
		});

		const calledBody = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
		expect(calledBody).toMatchObject({
			payload: { key: "value" },
			transaction: "raw-1",
		});
	});

	it("allows request-only payload and maps rawTransaction from request", async () => {
		const tool = getTool("kaspa_submitTransaction");
		const token = await getAnalysisConfirmToken(tool, {
			request: { rawTransaction: "should-be-mapped", extra: true },
		});
		fetchMock.mockReset();
		mockFetchJson({
			status: 200,
			body: { status: "accepted" },
		});
		await tool.execute("kaspa-submit-req", {
			network: "testnet",
			runMode: "execute",
			request: { rawTransaction: "should-be-mapped", extra: true },
			confirmToken: token,
		});

		const calledBody = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
		expect(calledBody).toMatchObject({
			extra: true,
			transaction: "should-be-mapped",
		});
	});

	it("blocks mainnet submit without confirmMainnet", async () => {
		const tool = getTool("kaspa_submitTransaction");
		const token = await getAnalysisConfirmToken(tool, {
			network: "mainnet",
			rawTransaction: "main-raw",
		});
		fetchMock.mockReset();
		await expect(
			tool.execute("kaspa-submit-mainnet", {
				network: "mainnet",
				runMode: "execute",
				rawTransaction: "00abccddee",
				confirmToken: token,
			}),
		).rejects.toThrow("Mainnet Kaspa execution is blocked");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("requires body payload when request and rawTransaction are missing", async () => {
		const tool = getTool("kaspa_submitTransaction");
		await expect(
			tool.execute("kaspa-submit-empty", {
				network: "testnet",
				runMode: "execute",
				confirmToken: "invalid",
			}),
		).rejects.toThrow("At least one of rawTransaction or request is required for Kaspa submit");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
