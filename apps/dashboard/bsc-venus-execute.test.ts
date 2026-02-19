import { describe, expect, it, vi } from "vitest";

class FakeBN {
	value: bigint;
	constructor(value: bigint | string | number) {
		this.value = BigInt(value);
	}
	lt(other: bigint | string | number) {
		return this.value < BigInt(other);
	}
	sub(other: FakeBN) {
		return new FakeBN(this.value - other.value);
	}
	toString() {
		return this.value.toString();
	}
}

const { createVenusSdkAdapterMock, resolveDefaultBscVTokenMock } = vi.hoisted(
	() => ({
		createVenusSdkAdapterMock: vi.fn(),
		resolveDefaultBscVTokenMock: vi.fn(),
	}),
);

vi.mock("./bsc-venus-sdk.mjs", () => ({
	createVenusSdkAdapter: createVenusSdkAdapterMock,
	resolveDefaultBscVToken: resolveDefaultBscVTokenMock,
}));

let sendIndex = 0;

vi.mock("@ethersproject/abi", () => ({
	Interface: class {
		encodeFunctionData(method: string, args: unknown[] = []) {
			return `${method}:${JSON.stringify(args)}`;
		}
		decodeFunctionResult(method: string, raw: string) {
			if (method === "allowance" || method === "balanceOf") {
				return [new FakeBN(raw || "0")];
			}
			return [raw || "0"];
		}
	},
}));

vi.mock("@ethersproject/constants", () => ({
	MaxUint256: "0xffff",
}));

vi.mock("@ethersproject/providers", () => ({
	JsonRpcProvider: class {
		balanceCalls = 0;
		async call({ data }: { data: string }) {
			if (data.startsWith("allowance:")) return "1000000000000000000000";
			if (data.startsWith("balanceOf:")) {
				this.balanceCalls += 1;
				return this.balanceCalls === 1 ? "1000" : "0";
			}
			return "0";
		}
	},
}));

vi.mock("@ethersproject/wallet", () => ({
	Wallet: class {
		address = "0x000000000000000000000000000000000000dEaD";
		async sendTransaction() {
			sendIndex += 1;
			return {
				hash: `0xtx${sendIndex}`,
				wait: async () => ({ status: 1, blockNumber: 12345 }),
			};
		}
	},
}));

import { executeVenusSupplySdkFirst } from "./bsc-venus-execute.mjs";

describe("bsc venus execute sdk-first", () => {
	it("uses sdk routing + canonical ethers execute path when sdk is enabled", async () => {
		createVenusSdkAdapterMock.mockResolvedValueOnce({
			provider: {
				balanceCalls: 0,
				call: vi.fn(async ({ data }: { data: string }) => {
					if (data.startsWith("allowance:")) return "1000000000000000000000";
					if (data.startsWith("balanceOf:")) {
						return data.includes('"0x000000000000000000000000000000000000dEaD"')
							? "1000"
							: "0";
					}
					return "0";
				}),
			},
			meta: { officialSdkWired: true, sdkPackage: "@venusprotocol/chains" },
		});
		resolveDefaultBscVTokenMock.mockReturnValueOnce({
			address: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
		});

		const result = await executeVenusSupplySdkFirst({
			sdkEnabled: true,
			fallbackToNative: true,
			rpcUrl: "http://127.0.0.1:8545",
			chainId: 56,
			privateKey: "0xabc",
			tokenAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
			tokenSymbol: "USDC",
			amountRaw: "1000",
			confirmations: 1,
		});

		expect(result.mode).toBe("sdk");
		expect(result.executePath).toBe("canonical-ethers");
		expect(result.sdk?.used).toBe(true);
		expect(result.fallback?.used).toBe(false);
		expect(result.warnings).toContain(
			"venus_execute_tx_uses_canonical_ethers_signer_no_official_sdk_executor",
		);
		expect(result.remainingNonSdkPath?.active).toBe(false);
		expect(result.executeDetectors?.machineReadable).toBe(true);
		expect(result.remainingNonSdkPath?.checks).toMatchObject({
			sdkEnabled: true,
			sdkAdapterResolved: true,
			fallbackUsed: false,
		});
	});

	it("marks explicit native-fallback path when sdk resolution fails", async () => {
		createVenusSdkAdapterMock.mockRejectedValueOnce(
			new Error("sdk unavailable"),
		);
		resolveDefaultBscVTokenMock.mockReturnValueOnce(null);

		const result = await executeVenusSupplySdkFirst({
			sdkEnabled: true,
			fallbackToNative: true,
			rpcUrl: "http://127.0.0.1:8545",
			chainId: 56,
			privateKey: "0xabc",
			tokenAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
			vTokenAddress: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
			amountRaw: "1000",
			confirmations: 1,
		});

		expect(result.mode).toBe("native-fallback");
		expect(result.warnings).toContain(
			"venus_sdk_execute_failed_fallback_to_native",
		);
		expect(result.warnings).toContain(
			"venus_execute_path_native_fallback_active",
		);
		expect(result.remainingNonSdkPath?.marker).toBe(
			"venus_execute_non_sdk_native_fallback_path",
		);
	});
});
