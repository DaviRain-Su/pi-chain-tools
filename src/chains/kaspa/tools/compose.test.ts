import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKaspaComposeTools } from "./compose.js";

type ComposeTool = {
	execute(
		_toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function getTool(name: string): ComposeTool {
	const tool = createKaspaComposeTools().find((entry) => entry.name === name);
	if (!tool) throw new Error(`${name} not found`);
	return tool as unknown as ComposeTool;
}

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

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

function expectHex64(value: string): void {
	expect(value).toHaveLength(64);
	expect(/^[0-9a-f]+$/.test(value)).toBe(true);
}

function getDetails<T>(value: unknown): T {
	return value as T;
}

describe("kaspa compose tools", () => {
	it("builds unsigned transfer request from toAddress + amount", async () => {
		const tool = getTool("kaspa_buildTransferTransaction");
		const result = await tool.execute("kaspa-build", {
			network: "testnet10",
			fromAddress:
				"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
			toAddress:
				"kaspa:qtestreceiver11111111111111111111111111111111111111111111111111",
			amount: "1.25",
			utxos: [
				{
					txId: "txid-1",
					index: 0,
					amount: "2", // 2 KAS
				},
				{
					txId: "txid-2",
					index: 1,
					amount: "1",
				},
			],
			feeRate: 2,
			requestMemo: "demo",
		});

		const details = getDetails<{
			schema: string;
			requestHash: string;
			requiresLocalSignature: boolean;
			tx: { from: string; inputs: unknown[]; outputs: unknown[] };
			request: {
				rawTransaction: string;
				metadata: { requestHash: string };
			};
		}>(result.details);

		expect(result.content[0]?.text).toContain(
			"Kaspa unsigned transaction built",
		);
		expect(details.schema).toBe("kaspa.transaction.compose.v1");
		expect(details.requiresLocalSignature).toBe(true);
		expect(details.requestHash).toMatch(/^[0-9a-f]{64}$/);
		expectHex64(details.requestHash);
		expect(details.request.metadata.requestHash).toBe(details.requestHash);
		expect(details.tx.from).toBe(
			"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
		);
		expect(details.tx.inputs.length).toBeGreaterThanOrEqual(1);
		expect(details.tx.outputs.length).toBeGreaterThanOrEqual(1);
		const raw = JSON.parse(details.request.rawTransaction) as Record<
			string,
			unknown
		>;
		expect(raw.version).toBe(0);
		expect(raw.network).toBe("kaspa-testnet10");
	});

	it("supports multi-output build and suppresses dust change when limit is high", async () => {
		const tool = getTool("kaspa_buildTransferTransaction");
		const result = await tool.execute("kaspa-build-2", {
			network: "testnet11",
			fromAddress:
				"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
			outputs: [
				{
					address:
						"kaspa:qtestreceiver11111111111111111111111111111111111111111111111111",
					amount: "0.4",
				},
				{
					address:
						"kaspa:qtestreceiver2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					amount: "0.3",
				},
			],
			utxos: [
				{
					txId: "utxo-a",
					index: 0,
					amount: "0.800001",
				},
			],
			dustLimit: 15000000,
			feeRate: "2",
		});

		const details = getDetails<{
			tx: { outputs: Array<{ address: string; amount: string }> };
			requestHash: string;
		}>(result.details);
		// With high dust limit, change is considered uneconomic and omitted.
		expect(details.tx.outputs.length).toBe(2);
		expect(details.requestHash).toHaveLength(64);
	});

	it("fails when outputs are missing and toAddress/amount not provided", async () => {
		const tool = getTool("kaspa_buildTransferTransaction");
		await expect(
			tool.execute("kaspa-build-missing-output", {
				fromAddress:
					"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
				utxos: [
					{
						txId: "txid-1",
						index: 0,
						amount: "1",
					},
				],
			}),
		).rejects.toThrow("toAddress is required when outputs is not provided");
	});

	it("rejects insufficient balance for amount + fee", async () => {
		const tool = getTool("kaspa_buildTransferTransaction");
		await expect(
			tool.execute("kaspa-build-insufficient", {
				fromAddress:
					"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
				toAddress:
					"kaspa:qtestreceiver11111111111111111111111111111111111111111111111111",
				amount: "5",
				utxos: [
					{
						txId: "txid-1",
						index: 0,
						amount: "0.5",
					},
				],
			}),
		).rejects.toThrow("Insufficient balance for amount + fee");
	});

	it("builds request suitable for execute-request flow", async () => {
		const tool = getTool("kaspa_buildTransferTransaction");
		const buildResult = await tool.execute("kaspa-build-submit", {
			fromAddress:
				"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
			toAddress:
				"kaspa:qtestreceiver11111111111111111111111111111111111111111111111111",
			amount: 1,
			utxos: [
				{
					txId: "txid-submit-1",
					index: 0,
					amount: "1.5",
				},
			],
		});
		const details = getDetails<{
			request: { rawTransaction: string };
			tx: unknown;
			requestHash: string;
		}>(buildResult.details);
		expect(() => JSON.parse(details.request.rawTransaction)).not.toThrow();
		const rawTransaction = JSON.parse(details.request.rawTransaction);
		expect(rawTransaction).toEqual(details.tx);
		expect(rawTransaction.version).toBe(0);
	});

	it("builds unsigned transfer from fetched UTXOs with selection strategy", async () => {
		mockFetchJson({
			status: 200,
			body: {
				utxos: [
					{ txId: "fetched-utxo-1", index: 1, amount: "0.6" },
					{
						txId: "fetched-utxo-2",
						index: 0,
						amount: "1.2",
						selectionPriority: 10,
					},
				],
			},
		});

		const tool = getTool("kaspa_buildTransferTransactionFromAddress");
		const result = await tool.execute("kaspa-build-from-address", {
			network: "testnet10",
			fromAddress:
				"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
			toAddress:
				"kaspa:qtestreceiver11111111111111111111111111111111111111111111111111",
			amount: "1",
			utxoSelectionStrategy: "fifo",
			utxoLimit: 2,
		});

		const details = getDetails<{
			network: string;
			schema: string;
			selectionStrategy: string;
			utxoSource: string;
			request: { rawTransaction: string };
		}>(result.details);

		expect(result.content[0]?.text).toContain(
			"Kaspa unsigned transaction built from address UTXOs",
		);
		expect(details.schema).toBe("kaspa.transaction.compose.v1");
		expect(details.selectionStrategy).toBe("fifo");
		expect(details.utxoSource).toBe("address");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const calledUrl = new URL(fetchMock.mock.calls[0]?.[0]?.toString() ?? "");
		expect(calledUrl.pathname).toContain("/v1/addresses/");
		expect(calledUrl.searchParams.get("limit")).toBe("2");
		const raw = JSON.parse(details.request.rawTransaction);
		expect(raw.from).toBe(
			"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
		);
		expect(Array.isArray(raw.inputs)).toBe(true);
	});

	it("supports fetched UTXO payload aliases (outputs/data + txId/value/satoshis aliases)", async () => {
		mockFetchJson({
			status: 200,
			body: {
				outputs: [
					{
						txHash: "fetched-utxo-txhash",
						vout: 3,
						satoshis: "2",
					},
				],
			},
		});

		const tool = getTool("kaspa_buildTransferTransactionFromAddress");
		const result = await tool.execute("kaspa-build-from-address-alias", {
			network: "testnet10",
			fromAddress:
				"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
			toAddress:
				"kaspa:qtestreceiver11111111111111111111111111111111111111111111111111",
			amount: "1",
			utxoSelectionStrategy: "feerate",
		});

		const details = getDetails<{
			network: string;
			schema: string;
			utxoSource: string;
			request: { rawTransaction: string };
		}>(result.details);
		expect(details.network).toBe("testnet10");
		expect(details.schema).toBe("kaspa.transaction.compose.v1");
		expect(details.utxoSource).toBe("address");
		const raw = JSON.parse(details.request.rawTransaction);
		expect(raw.inputs[0].txId).toBe("fetched-utxo-txhash");
		expect(raw.inputs[0].outputIndex).toBe(3);
		expect(raw.inputs[0].amount).toBe("200000000");
	});

	it("builds with data payload alias", async () => {
		mockFetchJson({
			status: 200,
			body: {
				data: [
					{
						txid: "alias-utxo",
						outputIndex: 1,
						value: "3",
					},
				],
			},
		});

		const tool = getTool("kaspa_buildTransferTransactionFromAddress");
		const result = await tool.execute("kaspa-build-from-address-data", {
			network: "testnet10",
			fromAddress:
				"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
			toAddress:
				"kaspa:qtestreceiver11111111111111111111111111111111111111111111111111",
			amount: "2",
		});

		const details = getDetails<{
			request: { rawTransaction: string };
			network: string;
		}>(result.details);
		expect(details.network).toBe("testnet10");
		const raw = JSON.parse(details.request.rawTransaction);
		expect(raw.inputs[0].txId).toBe("alias-utxo");
		expect(raw.inputs[0].outputIndex).toBe(1);
	});

	it("throws when fetched UTXO payload is empty", async () => {
		mockFetchJson({
			status: 200,
			body: {
				outputs: [],
			},
		});

		const tool = getTool("kaspa_buildTransferTransactionFromAddress");
		await expect(
			tool.execute("kaspa-build-empty-utxos", {
				network: "testnet10",
				fromAddress:
					"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
				toAddress:
					"kaspa:qtestreceiver11111111111111111111111111111111111111111111111111",
				amount: "1",
			}),
		).rejects.toThrow("kaspa_getAddressUtxos returned no UTXOs");
	});

	it("throws for invalid utxoSelectionStrategy", async () => {
		mockFetchJson({
			status: 200,
			body: {
				utxos: [
					{
						txId: "fetched-utxo",
						index: 0,
						amount: "2",
					},
				],
			},
		});

		const tool = getTool("kaspa_buildTransferTransactionFromAddress");
		await expect(
			tool.execute("kaspa-build-bad-strategy", {
				network: "testnet10",
				fromAddress:
					"kaspa:qtestsender11111111111111111111111111111111111111111111111111",
				toAddress:
					"kaspa:qtestreceiver11111111111111111111111111111111111111111111111111",
				amount: "1",
				utxoSelectionStrategy: "bad" as unknown as "feeRate",
			}),
		).rejects.toThrow("utxoSelectionStrategy must be 'fifo' or 'feeRate'");
	});
});
