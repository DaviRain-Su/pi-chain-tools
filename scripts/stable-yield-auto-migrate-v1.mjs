#!/usr/bin/env node
import { ethers } from "ethers";

const BSC_BLOCKS_PER_YEAR = 10_512_000;
const CONFIRM_TOKEN = "I_ACKNOWLEDGE_AUTO_MIGRATE";

const TOKENS = {
	USDC: {
		symbol: "USDC",
		address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
		vToken: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
		decimals: 18,
	},
	USDT: {
		symbol: "USDT",
		address: "0x55d398326f99059ff775485246999027b3197955",
		vToken: "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
		decimals: 18,
	},
};

function parseArgs(argv) {
	const args = { _: [] };
	for (let i = 2; i < argv.length; i += 1) {
		const t = argv[i];
		if (!t.startsWith("--")) {
			args._.push(t);
			continue;
		}
		const [k, v] = t.split("=", 2);
		const key = k.slice(2);
		if (typeof v !== "undefined") {
			args[key] = v;
			continue;
		}
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args[key] = true;
			continue;
		}
		args[key] = next;
		i += 1;
	}
	return args;
}

function toBool(v, fallback = false) {
	if (typeof v === "boolean") return v;
	if (typeof v === "string") {
		const x = v.toLowerCase().trim();
		if (["1", "true", "yes", "y", "on"].includes(x)) return true;
		if (["0", "false", "no", "n", "off"].includes(x)) return false;
	}
	return fallback;
}

function apyFromRatePerBlock(ratePerBlockRaw) {
	const r = Number(ratePerBlockRaw) / 1e18;
	return r * BSC_BLOCKS_PER_YEAR * 100;
}

async function quoteSameChainSwap({
	fromToken,
	toToken,
	amountRaw,
	address,
	integrator,
}) {
	const url = new URL("https://li.quest/v1/quote");
	url.searchParams.set("fromChain", "56");
	url.searchParams.set("toChain", "56");
	url.searchParams.set("fromToken", fromToken);
	url.searchParams.set("toToken", toToken);
	url.searchParams.set("fromAmount", amountRaw);
	url.searchParams.set("fromAddress", address);
	url.searchParams.set("toAddress", address);
	url.searchParams.set("order", "RECOMMENDED");
	url.searchParams.set("slippage", "0.006");
	url.searchParams.set("integrator", integrator || "pi-chain-tools");
	const res = await fetch(url, { headers: { accept: "application/json" } });
	if (!res.ok)
		throw new Error(`LI.FI quote failed ${res.status}: ${await res.text()}`);
	return await res.json();
}

async function main() {
	const args = parseArgs(process.argv);
	const execute = toBool(args.execute, false);
	const rpcUrl = String(
		process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
	);
	const privateKey =
		process.env.BSC_EXECUTE_PRIVATE_KEY ||
		process.env.EVM_PRIVATE_KEY ||
		process.env.POLYMARKET_PRIVATE_KEY;
	if (!privateKey) throw new Error("missing private key env");
	if (execute && String(args.confirm || "") !== CONFIRM_TOKEN) {
		console.log(
			JSON.stringify(
				{
					status: "blocked",
					reason: "missing confirm token",
					requiredToken: CONFIRM_TOKEN,
				},
				null,
				2,
			),
		);
		process.exit(2);
	}

	const provider = new ethers.JsonRpcProvider(rpcUrl);
	const wallet = new ethers.Wallet(privateKey, provider);

	const erc20Abi = [
		"function allowance(address owner,address spender) view returns(uint256)",
		"function approve(address spender,uint256 amount) returns(bool)",
		"function balanceOf(address owner) view returns(uint256)",
	];
	const vTokenAbi = [
		"function supplyRatePerBlock() view returns(uint256)",
		"function mint(uint256 mintAmount) returns(uint256)",
		"function redeemUnderlying(uint256 redeemAmount) returns(uint256)",
		"function balanceOfUnderlying(address owner) returns(uint256)",
		"function balanceOf(address owner) view returns(uint256)",
		"function exchangeRateStored() view returns(uint256)",
	];

	const usdc = new ethers.Contract(TOKENS.USDC.address, erc20Abi, wallet);
	const usdt = new ethers.Contract(TOKENS.USDT.address, erc20Abi, wallet);
	const vUsdc = new ethers.Contract(TOKENS.USDC.vToken, vTokenAbi, wallet);
	const vUsdt = new ethers.Contract(TOKENS.USDT.vToken, vTokenAbi, wallet);

	const [usdcRate, usdtRate] = await Promise.all([
		vUsdc.supplyRatePerBlock(),
		vUsdt.supplyRatePerBlock(),
	]);
	const apy = {
		USDC: apyFromRatePerBlock(usdcRate.toString()),
		USDT: apyFromRatePerBlock(usdtRate.toString()),
	};
	const targetSymbol = apy.USDC >= apy.USDT ? "USDC" : "USDT";
	const sourceSymbol = targetSymbol === "USDC" ? "USDT" : "USDC";
	const target = TOKENS[targetSymbol];
	const source = TOKENS[sourceSymbol];

	let sourceUnderlyingRaw = 0n;
	try {
		const vSource = sourceSymbol === "USDC" ? vUsdc : vUsdt;
		sourceUnderlyingRaw = BigInt(
			(await vSource.balanceOfUnderlying(wallet.address)).toString(),
		);
	} catch {
		try {
			const vSource = sourceSymbol === "USDC" ? vUsdc : vUsdt;
			const [vBal, exchangeRate] = await Promise.all([
				vSource.balanceOf(wallet.address),
				vSource.exchangeRateStored(),
			]);
			sourceUnderlyingRaw =
				(BigInt(vBal.toString()) * BigInt(exchangeRate.toString())) /
				10n ** 18n;
		} catch {
			sourceUnderlyingRaw = 0n;
		}
	}

	const maxMoveUsd = Number(args.maxMoveUsd || 5);
	const minMoveUsd = Number(args.minMoveUsd || 1);
	const minApyDeltaBps = Number(args.minApyDeltaBps || 20);
	const allowSwap = toBool(args.allowSwap, false);
	const maxMoveRaw = ethers.parseUnits(String(maxMoveUsd), source.decimals);
	const minMoveRaw = ethers.parseUnits(String(minMoveUsd), source.decimals);
	const amountToMoveRaw =
		sourceUnderlyingRaw > maxMoveRaw ? maxMoveRaw : sourceUnderlyingRaw;
	const apyDeltaBps = Math.round((apy[targetSymbol] - apy[sourceSymbol]) * 100);

	const plan = {
		status: "planned",
		address: wallet.address,
		apy,
		targetSymbol,
		sourceSymbol,
		sourceUnderlying: ethers.formatUnits(sourceUnderlyingRaw, source.decimals),
		amountToMove: ethers.formatUnits(amountToMoveRaw, source.decimals),
		execute,
		apyDeltaBps,
		thresholds: { minMoveUsd, minApyDeltaBps, allowSwap },
	};

	if (amountToMoveRaw < minMoveRaw) {
		console.log(
			JSON.stringify(
				{
					...plan,
					status: "noop",
					reason: `move amount below minMoveUsd (${ethers.formatUnits(amountToMoveRaw, source.decimals)} < ${minMoveUsd})`,
				},
				null,
				2,
			),
		);
		return;
	}

	if (apyDeltaBps < minApyDeltaBps) {
		console.log(
			JSON.stringify(
				{
					...plan,
					status: "noop",
					reason: `apy delta below threshold (${apyDeltaBps} bps < ${minApyDeltaBps} bps)`,
				},
				null,
				2,
			),
		);
		return;
	}

	if (
		!allowSwap &&
		source.address.toLowerCase() !== target.address.toLowerCase()
	) {
		console.log(
			JSON.stringify(
				{
					...plan,
					status: "noop",
					reason: "token migration requires swap but allowSwap=false",
				},
				null,
				2,
			),
		);
		return;
	}

	if (!execute) {
		console.log(JSON.stringify(plan, null, 2));
		return;
	}

	const receipts = [];

	const vSource = sourceSymbol === "USDC" ? vUsdc : vUsdt;
	const redeemTx = await vSource.redeemUnderlying(amountToMoveRaw);
	const redeemRcpt = await redeemTx.wait();
	receipts.push({
		step: "redeemUnderlying",
		txHash: redeemRcpt?.hash || redeemTx.hash,
	});

	let targetAmountRaw = amountToMoveRaw;
	if (source.address.toLowerCase() !== target.address.toLowerCase()) {
		const quote = await quoteSameChainSwap({
			fromToken: source.address,
			toToken: target.address,
			amountRaw: amountToMoveRaw.toString(),
			address: wallet.address,
			integrator: process.env.LIFI_INTEGRATOR,
		});
		const txReq = quote?.transactionRequest;
		if (!txReq?.to || !txReq?.data)
			throw new Error("quote missing transactionRequest");
		const sourceToken = sourceSymbol === "USDC" ? usdc : usdt;
		const spender = quote?.estimate?.approvalAddress || txReq.to;
		const allowance = await sourceToken.allowance(wallet.address, spender);
		if (allowance < amountToMoveRaw) {
			const approveTx = await sourceToken.approve(spender, ethers.MaxUint256);
			const approveRcpt = await approveTx.wait();
			receipts.push({
				step: "swapApprove",
				txHash: approveRcpt?.hash || approveTx.hash,
			});
		}
		const swapTx = await wallet.sendTransaction({
			to: txReq.to,
			data: txReq.data,
			value: BigInt(txReq.value || "0"),
		});
		const swapRcpt = await swapTx.wait();
		receipts.push({ step: "swap", txHash: swapRcpt?.hash || swapTx.hash });

		const targetToken = targetSymbol === "USDC" ? usdc : usdt;
		targetAmountRaw = BigInt(
			(await targetToken.balanceOf(wallet.address)).toString(),
		);
	}

	const targetToken = targetSymbol === "USDC" ? usdc : usdt;
	const targetVToken = targetSymbol === "USDC" ? vUsdc : vUsdt;
	const allowanceTarget = await targetToken.allowance(
		wallet.address,
		target.vToken,
	);
	if (allowanceTarget < targetAmountRaw) {
		const approveTx = await targetToken.approve(
			target.vToken,
			ethers.MaxUint256,
		);
		const approveRcpt = await approveTx.wait();
		receipts.push({
			step: "targetApprove",
			txHash: approveRcpt?.hash || approveTx.hash,
		});
	}

	const supplyTx = await targetVToken.mint(targetAmountRaw);
	const supplyRcpt = await supplyTx.wait();
	receipts.push({
		step: "targetSupply",
		txHash: supplyRcpt?.hash || supplyTx.hash,
	});

	console.log(
		JSON.stringify(
			{
				status: "executed",
				address: wallet.address,
				apy,
				targetSymbol,
				sourceSymbol,
				migratedAmount: ethers.formatUnits(amountToMoveRaw, source.decimals),
				receipts,
			},
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(
		JSON.stringify(
			{
				status: "error",
				error: error instanceof Error ? error.message : String(error),
			},
			null,
			2,
		),
	);
	process.exit(1);
});
