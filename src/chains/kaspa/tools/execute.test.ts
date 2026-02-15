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

beforeEach(() => {
	vi.clearAllMocks();
	global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
	global.fetch = ORIGINAL_FETCH as typeof fetch;
	fetchMock.mockReset();
});

describe("kaspa execute tools", () => {
	it("submits pre-signed transaction to testnet", async () => {
		mockFetchJson({
			status: 200,
			body: { txid: "tx-submitted-001", status: "accepted" },
		});
		const tool = getTool("kaspa_submitTransaction");
		const result = await tool.execute("kaspa-submit", {
			network: "testnet",
			rawTransaction: "00abccddee",
		});

		expect(result.content[0]?.text).toContain("Kaspa transaction submitted");
		expect(result.content[0]?.text).toContain("testnet");
		expect(result.details).toMatchObject({
			schema: "kaspa.transaction.submit.v1",
			network: "testnet",
			txId: "tx-submitted-001",
		});
		const calledUrl = new URL(fetchMock.mock.calls[0]?.[0]?.toString() ?? "");
		expect(calledUrl.pathname).toBe("/v1/rpc/submit-transaction");
		const calledBody = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
		expect(calledBody).toEqual({ rawTransaction: "00abccddee" });
	});

	it("merges request body and preserves rawTransaction", async () => {
		mockFetchJson({
			status: 200,
			body: { transactionId: "merged-tx", status: "accepted" },
		});
		const tool = getTool("kaspa_submitTransaction");
		await tool.execute("kaspa-submit-merge", {
			network: "testnet",
			rawTransaction: "raw-1",
			request: { payload: { key: "value" } },
		});

		const calledBody = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
		expect(calledBody).toEqual({ payload: { key: "value" }, rawTransaction: "raw-1" });
	});

	it("allows request-only payload", async () => {
		mockFetchJson({
			status: 200,
			body: { status: "accepted" },
		});
		const tool = getTool("kaspa_submitTransaction");
		await tool.execute("kaspa-submit-req", {
			network: "testnet",
			request: { rawTransaction: "should-be-overridden", extra: true },
		});

		const calledBody = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
		expect(calledBody).toEqual({ rawTransaction: "should-be-overridden", extra: true });
	});

	it("blocks mainnet submit without confirmMainnet", async () => {
		const tool = getTool("kaspa_submitTransaction");
		await expect(
			tool.execute("kaspa-submit-mainnet", {
				network: "mainnet",
				rawTransaction: "00abccddee",
			}),
		).rejects.toThrow("Mainnet Kaspa execution is blocked");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("requires body payload when request and rawTransaction are missing", async () => {
		const tool = getTool("kaspa_submitTransaction");
		await expect(
			tool.execute("kaspa-submit-empty", {
				network: "testnet",
			}),
		).rejects.toThrow("At least one of rawTransaction or request is required for Kaspa submit");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
