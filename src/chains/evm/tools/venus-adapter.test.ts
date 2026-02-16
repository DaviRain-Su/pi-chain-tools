import { describe, expect, it } from "vitest";
import type { LendingProtocolAdapter } from "./lending-types.js";
import {
	BSC_BLOCKS_PER_YEAR,
	NATIVE_ADDRESS,
	VENUS_COMPTROLLER,
	VENUS_MARKET_REGISTRY,
	VENUS_VBNB,
	createVenusAdapter,
	decodeBool,
	decodeUint256,
	encodeUint256,
	formatUnits,
	padAddress,
	padUint256,
	ratePerBlockToAPY,
} from "./venus-adapter.js";

describe("venus-adapter ABI helpers", () => {
	it("padAddress pads to 64 hex chars", () => {
		const result = padAddress("0xA07c5b74C9B40447a954e1466938b865b6BBea36");
		expect(result).toHaveLength(64);
		expect(result).toBe(
			"000000000000000000000000a07c5b74c9b40447a954e1466938b865b6bbea36",
		);
	});

	it("padUint256 pads bigint hex string", () => {
		expect(padUint256("1")).toBe(
			"0000000000000000000000000000000000000000000000000000000000000001",
		);
		expect(padUint256("ff")).toBe(
			"00000000000000000000000000000000000000000000000000000000000000ff",
		);
	});

	it("encodeUint256 encodes decimal string to padded hex", () => {
		const result = encodeUint256("1000000000000000000");
		expect(result).toHaveLength(64);
		expect(BigInt(`0x${result}`)).toBe(1000000000000000000n);
	});

	it("decodeUint256 decodes hex to bigint", () => {
		expect(decodeUint256("0x0")).toBe(0n);
		expect(
			decodeUint256(
				"0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
			),
		).toBe(1000000000000000000n);
	});

	it("decodeUint256 handles empty/zero", () => {
		expect(decodeUint256("0x")).toBe(0n);
		expect(decodeUint256("0x0000")).toBe(0n);
	});

	it("decodeBool returns true for non-zero", () => {
		expect(
			decodeBool(
				"0x0000000000000000000000000000000000000000000000000000000000000001",
			),
		).toBe(true);
		expect(
			decodeBool(
				"0x0000000000000000000000000000000000000000000000000000000000000000",
			),
		).toBe(false);
	});
});

describe("venus-adapter rate helpers", () => {
	it("ratePerBlockToAPY converts correctly", () => {
		// Typical supply rate: ~2e-10 per block → ~2.1% APY
		const rate = 200000000n; // 2e8 (0.0000000002 in 1e18)
		const apy = ratePerBlockToAPY(rate);
		// 2e8 / 1e18 * 10512000 * 100 = ~0.0021 ... that's very small
		expect(apy).toBeGreaterThan(0);
		expect(apy).toBeLessThan(100);
	});

	it("ratePerBlockToAPY returns 0 for zero rate", () => {
		expect(ratePerBlockToAPY(0n)).toBe(0);
	});

	it("BSC_BLOCKS_PER_YEAR is reasonable", () => {
		expect(BSC_BLOCKS_PER_YEAR).toBe(10_512_000);
	});
});

describe("venus-adapter formatUnits", () => {
	it("formats 18-decimal token", () => {
		expect(formatUnits(1000000000000000000n, 18)).toBe("1");
		expect(formatUnits(1500000000000000000n, 18)).toBe("1.5");
		expect(formatUnits(100000000000000n, 18)).toBe("0.0001");
	});

	it("formats 6-decimal token", () => {
		expect(formatUnits(1000000n, 6)).toBe("1");
		expect(formatUnits(1500000n, 6)).toBe("1.5");
	});

	it("formats zero", () => {
		expect(formatUnits(0n, 18)).toBe("0");
	});
});

describe("venus-adapter constants", () => {
	it("VENUS_COMPTROLLER is correct BSC address", () => {
		expect(VENUS_COMPTROLLER).toBe(
			"0xfD36E2c2a6789Db23113685031d7F16329158384",
		);
	});

	it("VENUS_VBNB is correct", () => {
		expect(VENUS_VBNB).toBe("0xA07c5b74C9B40447a954e1466938b865b6BBea36");
	});

	it("NATIVE_ADDRESS is zero address", () => {
		expect(NATIVE_ADDRESS).toBe("0x0000000000000000000000000000000000000000");
	});

	it("market registry has expected entries", () => {
		expect(Object.keys(VENUS_MARKET_REGISTRY)).toContain("vBNB");
		expect(Object.keys(VENUS_MARKET_REGISTRY)).toContain("vUSDC");
		expect(Object.keys(VENUS_MARKET_REGISTRY)).toContain("vUSDT");
		expect(Object.keys(VENUS_MARKET_REGISTRY)).toContain("vBTCB");
		expect(Object.keys(VENUS_MARKET_REGISTRY)).toContain("vETH");
	});
});

describe("venus-adapter createVenusAdapter", () => {
	it("returns adapter with correct protocolId", () => {
		const adapter = createVenusAdapter();
		expect(adapter.protocolId).toBe("venus");
	});

	it("rejects non-BSC network for getMarkets", async () => {
		const adapter = createVenusAdapter();
		await expect(adapter.getMarkets("ethereum")).rejects.toThrow(
			"Venus Protocol is only available on BSC",
		);
	});

	it("rejects non-BSC network for getAccountPosition", async () => {
		const adapter = createVenusAdapter();
		await expect(
			adapter.getAccountPosition(
				"polygon",
				"0x1234567890123456789012345678901234567890",
			),
		).rejects.toThrow("Venus Protocol is only available on BSC");
	});

	it("rejects non-BSC network for buildSupplyCalldata", async () => {
		const adapter = createVenusAdapter();
		await expect(
			adapter.buildSupplyCalldata({
				network: "ethereum",
				account: "0x1234567890123456789012345678901234567890",
				tokenAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
				amountRaw: "1000000000000000000",
			}),
		).rejects.toThrow("Venus Protocol is only available on BSC");
	});

	it("rejects unknown underlying for buildSupplyCalldata", async () => {
		const adapter = createVenusAdapter();
		await expect(
			adapter.buildSupplyCalldata({
				network: "bsc",
				account: "0x1234567890123456789012345678901234567890",
				tokenAddress: "0x0000000000000000000000000000000000000099",
				amountRaw: "1000000000000000000",
			}),
		).rejects.toThrow("No Venus market found for underlying");
	});

	it("builds supply calldata for ERC-20 (USDC) with approve + mint", async () => {
		const adapter = createVenusAdapter();
		const txs = await adapter.buildSupplyCalldata({
			network: "bsc",
			account: "0x1234567890123456789012345678901234567890",
			tokenAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
			amountRaw: "1000000000000000000",
		});
		expect(txs).toHaveLength(2);
		// First tx: approve
		expect(txs[0].to.toLowerCase()).toBe(
			"0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d".toLowerCase(),
		);
		expect(txs[0].data.startsWith("0x095ea7b3")).toBe(true);
		expect(txs[0].description).toContain("Approve");
		// Second tx: mint
		expect(txs[1].to.toLowerCase()).toBe(
			VENUS_MARKET_REGISTRY.vUSDC.vToken.toLowerCase(),
		);
		expect(txs[1].data.startsWith("0xa0712d68")).toBe(true);
		expect(txs[1].description).toContain("Supply");
		expect(txs[1].value).toBeUndefined();
	});

	it("builds supply calldata for native BNB with value", async () => {
		const adapter = createVenusAdapter();
		const txs = await adapter.buildSupplyCalldata({
			network: "bsc",
			account: "0x1234567890123456789012345678901234567890",
			tokenAddress: NATIVE_ADDRESS,
			amountRaw: "1000000000000000000",
		});
		// BNB: no approve, just mint with value
		expect(txs).toHaveLength(1);
		expect(txs[0].to.toLowerCase()).toBe(VENUS_VBNB.toLowerCase());
		expect(txs[0].value).toBeDefined();
		expect(txs[0].description).toContain("BNB");
	});

	it("builds enterMarket calldata", async () => {
		const adapter = createVenusAdapter();
		const tx = await adapter.buildEnterMarketCalldata({
			network: "bsc",
			account: "0x1234567890123456789012345678901234567890",
			marketAddresses: [VENUS_MARKET_REGISTRY.vUSDC.vToken],
		});
		expect(tx.to).toBe(VENUS_COMPTROLLER);
		expect(tx.data.startsWith("0xc2998238")).toBe(true);
		expect(tx.description).toContain("collateral");
	});

	it("builds borrow calldata", async () => {
		const adapter = createVenusAdapter();
		const tx = await adapter.buildBorrowCalldata({
			network: "bsc",
			account: "0x1234567890123456789012345678901234567890",
			marketAddress: VENUS_MARKET_REGISTRY.vUSDC.vToken,
			amountRaw: "500000000000000000000",
		});
		expect(tx.to.toLowerCase()).toBe(
			VENUS_MARKET_REGISTRY.vUSDC.vToken.toLowerCase(),
		);
		expect(tx.data.startsWith("0xc5ebeaec")).toBe(true);
		expect(tx.description).toContain("Borrow");
	});

	it("builds repay calldata for ERC-20 with approve + repayBorrow", async () => {
		const adapter = createVenusAdapter();
		const txs = await adapter.buildRepayCalldata({
			network: "bsc",
			account: "0x1234567890123456789012345678901234567890",
			tokenAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
			amountRaw: "500000000000000000000",
		});
		expect(txs).toHaveLength(2);
		expect(txs[0].data.startsWith("0x095ea7b3")).toBe(true);
		expect(txs[1].data.startsWith("0x0e752702")).toBe(true);
	});

	it("builds withdraw calldata", async () => {
		const adapter = createVenusAdapter();
		const tx = await adapter.buildWithdrawCalldata({
			network: "bsc",
			account: "0x1234567890123456789012345678901234567890",
			tokenAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
			amountRaw: "1000000000000000000",
		});
		expect(tx.to.toLowerCase()).toBe(
			VENUS_MARKET_REGISTRY.vUSDC.vToken.toLowerCase(),
		);
		expect(tx.data.startsWith("0x852a12e3")).toBe(true);
		expect(tx.description).toContain("Withdraw");
	});
});
