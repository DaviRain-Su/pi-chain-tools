import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKaspaReadTools } from "./read.js";

type ReadTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

function getTool(name: string): ReadTool {
	const tool = createKaspaReadTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ReadTool;
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

describe("kaspa read tools", () => {
	it("gets address tag", async () => {
		mockFetchJson({
			status: 200,
			body: {
				tag: {
					address: "kaspa:abc123",
					name: "merchant",
					labels: ["shop", "vip"],
					type: "entity",
				},
			},
		});

		const tool = getTool("kaspa_getAddressTag");
		const result = await tool.execute("kaspa-get-address-tag", {
			address: "kaspa:abc123",
			network: "mainnet",
		});

		expect(result.content[0]?.text).toContain("Kaspa address tag");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const calledUrl = fetchMock.mock.calls[0]?.[0]?.toString() ?? "";
		expect(calledUrl).toContain("/v1/addresses/kaspa%3Aabc123/tag");
	});

	it("gets address transactions with pagination filters", async () => {
		mockFetchJson({
			status: 200,
			body: {
				transactions: [{ transactionId: "tx-001", confirmations: 5 }],
				metadata: { hasMore: true, count: 1 },
			},
		});

		const tool = getTool("kaspa_getAddressTransactions");
		const result = await tool.execute("kaspa-get-address-transactions", {
			address: "kaspa:abc123",
			limit: 10,
			acceptedOnly: true,
			includePayload: false,
			startingAfter: "cursor-a",
		});

		expect(result.content[0]?.text).toContain("Kaspa transactions");
		const calledUrl = new URL(fetchMock.mock.calls[0]?.[0]?.toString() ?? "");
		expect(calledUrl.pathname).toBe("/v1/addresses/kaspa%3Aabc123/transactions");
		expect(calledUrl.searchParams.get("limit")).toBe("10");
		expect(calledUrl.searchParams.get("starting_after")).toBe("cursor-a");
		expect(calledUrl.searchParams.get("accepted_only")).toBe("true");
		expect(calledUrl.searchParams.get("include_payload")).toBe("false");
	});

	it("gets transaction detail", async () => {
		mockFetchJson({
			status: 200,
			body: { transaction: { id: "tx-001" } },
		});

		const tool = getTool("kaspa_getTransaction");
		const result = await tool.execute("kaspa-get-tx", {
			transactionId: "tx-001",
		});
		expect(result.content[0]?.text).toContain("Kaspa transaction lookup");
		const calledUrl = fetchMock.mock.calls[0]?.[0]?.toString() ?? "";
		expect(calledUrl).toContain("/v1/transactions/tx-001");
	});

	it("gets transaction output", async () => {
		mockFetchJson({
			status: 200,
			body: { output: { index: 0, value: "test" } },
		});

		const tool = getTool("kaspa_getTransactionOutput");
		const result = await tool.execute("kaspa-get-output", {
			transactionId: "tx-001",
			outputIndex: 0,
		});

		expect(result.content[0]?.text).toContain("Kaspa transaction output");
		const calledUrl = fetchMock.mock.calls[0]?.[0]?.toString() ?? "";
		expect(calledUrl).toContain("/v1/transactions/outputs/tx-001/0");
	});

	it("gets transaction acceptance with combined ids", async () => {
		mockFetchJson({
			status: 200,
			body: {
				acceptance: [{ transactionId: "tx-001", accepted: true }],
			},
		});

		const tool = getTool("kaspa_getTransactionAcceptance");
		const result = await tool.execute("kaspa-get-acceptance", {
			transactionId: "tx-001",
			transactionIds: ["tx-001", "tx-002"],
		});
		expect(result.content[0]?.text).toContain("Kaspa transaction acceptance");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const calledBody = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
		expect(calledBody).toMatchObject({
			transactionIds: ["tx-001", "tx-002"],
		});
	});

	it("gets fee estimate", async () => {
		mockFetchJson({
			status: 200,
			body: { estimate: { minFee: "1", maxFee: "2" } },
		});
		const tool = getTool("kaspa_getFeeEstimate");
		const result = await tool.execute("kaspa-get-fee-estimate", {});
		expect(result.content[0]?.text).toContain("Kaspa fee estimate");
		const calledUrl = fetchMock.mock.calls[0]?.[0]?.toString() ?? "";
		expect(calledUrl).toContain("/info/fee-estimate");
	});

	it("gets mempool info", async () => {
		mockFetchJson({
			status: 200,
			body: { mempoolSize: 12 },
		});
		const tool = getTool("kaspa_getMempool");
		await tool.execute("kaspa-get-mempool", {});
		const calledUrl = fetchMock.mock.calls[0]?.[0]?.toString() ?? "";
		expect(calledUrl).toContain("/info/kaspad");
	});

	it("gets coin supply with in_billion query", async () => {
		mockFetchJson({
			status: 200,
			body: { totalSupply: "100" },
		});
		const tool = getTool("kaspa_getCoinSupply");
		await tool.execute("kaspa-get-supply", {
			includeInBillion: true,
		});
		const calledUrl = new URL(fetchMock.mock.calls[0]?.[0]?.toString() ?? "");
		expect(calledUrl.searchParams.get("in_billion")).toBe("true");
		expect(calledUrl.pathname).toContain("/info/coinsupply");
	});

	it("gets network info from blockdag endpoint", async () => {
		mockFetchJson({
			status: 200,
			body: { difficulty: 1 },
		});
		const tool = getTool("kaspa_getNetworkInfo");
		await tool.execute("kaspa-get-network-info", {});
		const calledUrl = fetchMock.mock.calls[0]?.[0]?.toString() ?? "";
		expect(calledUrl).toContain("/info/blockdag");
	});

	it("gets read-state", async () => {
		mockFetchJson({
			status: 200,
			body: { ready: true },
		});
		const tool = getTool("kaspa_readState");
		await tool.execute("kaspa-read-state", {});
		const calledUrl = fetchMock.mock.calls[0]?.[0]?.toString() ?? "";
		expect(calledUrl).toContain("/info/blockdag");
	});

	it("estimates transaction mass", async () => {
		mockFetchJson({
			status: 200,
			body: { mass: 1234 },
		});
		const tool = getTool("kaspa_getTransactionMass");
		await tool.execute("kaspa-get-transaction-mass", {
			transaction: { version: 0, inputs: [], outputs: [] },
		});
		const calledUrl = new URL(fetchMock.mock.calls[0]?.[0]?.toString() ?? "");
		expect(calledUrl.pathname).toContain("/transactions/mass");
		const calledBody = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
		expect(calledBody).toMatchObject({ transaction: { version: 0, inputs: [], outputs: [] } });
	});

	it("enforces strict address checks for testnet prefix when requested", async () => {
		const tool = getTool("kaspa_getAddressTag");
		await expect(
			tool.execute("kaspa-get-address-tag-strict", {
				address: "kaspa:qtestmainnetaddress",
				network: "testnet",
				strictAddressCheck: true,
			}),
		).rejects.toThrow("Kaspa address");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("throws if transaction acceptance ids missing", async () => {
		const tool = getTool("kaspa_getTransactionAcceptance");
		await expect(
			tool.execute("kaspa-get-acceptance-empty", {}),
		).rejects.toThrow("At least one transactionId or transactionIds is required");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
