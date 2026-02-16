import { describe, expect, it } from "vitest";
import {
	buildVaultDepositCalldata,
	buildVaultRedeemCalldata,
	buildVaultWithdrawCalldata,
} from "./vault-adapter.js";

describe("vault-adapter calldata builders", () => {
	it("buildVaultDepositCalldata returns approve + deposit", () => {
		const calls = buildVaultDepositCalldata({
			network: "monad",
			vaultAddress: "0x1111111111111111111111111111111111111111",
			underlyingTokenAddress: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
			account: "0x2222222222222222222222222222222222222222",
			amountRaw: "1000000",
		});

		expect(calls.length).toBe(2);
		// Approve
		expect(calls[0].to).toBe("0x754704Bc059F8C67012fEd69BC8A327a5aafb603");
		expect(calls[0].data).toContain("095ea7b3"); // approve selector
		expect(calls[0].description).toContain("Approve");
		// Deposit
		expect(calls[1].to).toBe("0x1111111111111111111111111111111111111111");
		expect(calls[1].data).toContain("6e553f65"); // deposit selector
		expect(calls[1].description).toContain("Deposit");
	});

	it("buildVaultWithdrawCalldata returns withdraw", () => {
		const call = buildVaultWithdrawCalldata({
			network: "monad",
			vaultAddress: "0x1111111111111111111111111111111111111111",
			account: "0x2222222222222222222222222222222222222222",
			amountRaw: "500000",
		});

		expect(call.to).toBe("0x1111111111111111111111111111111111111111");
		expect(call.data).toContain("b460af94"); // withdraw selector
		expect(call.description).toContain("Withdraw");
	});

	it("buildVaultRedeemCalldata returns redeem", () => {
		const call = buildVaultRedeemCalldata({
			network: "monad",
			vaultAddress: "0x1111111111111111111111111111111111111111",
			account: "0x2222222222222222222222222222222222222222",
			sharesRaw: "1000000000000000000",
		});

		expect(call.to).toBe("0x1111111111111111111111111111111111111111");
		expect(call.data).toContain("ba087652"); // redeem selector
		expect(call.description).toContain("Redeem");
	});

	it("deposit calldata encodes correct amount and receiver", () => {
		const calls = buildVaultDepositCalldata({
			network: "base",
			vaultAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			underlyingTokenAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
			account: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
			amountRaw: "42",
		});

		// Deposit data should contain the amount (42 = 0x2a)
		expect(calls[1].data).toContain("2a".padStart(64, "0"));
		// And the receiver address
		expect(calls[1].data.toLowerCase()).toContain(
			"cccccccccccccccccccccccccccccccccccccccc",
		);
	});

	it("withdraw calldata encodes owner and receiver as same account", () => {
		const call = buildVaultWithdrawCalldata({
			network: "ethereum",
			vaultAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			account: "0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
			amountRaw: "100",
		});

		const data = call.data.toLowerCase();
		// Account appears twice (receiver + owner)
		const addr = "dddddddddddddddddddddddddddddddddddddd";
		const first = data.indexOf(addr);
		const second = data.indexOf(addr, first + 1);
		expect(first).toBeGreaterThan(0);
		expect(second).toBeGreaterThan(first);
	});
});
