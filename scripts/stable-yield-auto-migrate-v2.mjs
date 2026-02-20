#!/usr/bin/env node
import { spawn } from "node:child_process";
import { ethers } from "ethers";

const VENUS = {
	USDC: {
		key: "venus-usdc",
		symbol: "USDC",
		address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
		vToken: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
		decimals: 18,
	},
	USDT: {
		key: "venus-usdt",
		symbol: "USDT",
		address: "0x55d398326f99059ff775485246999027b3197955",
		vToken: "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
		decimals: 18,
	},
};

const BSC_BLOCKS_PER_YEAR = 10_512_000;

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) continue;
		const [k, v] = token.split("=", 2);
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

function apyFromRatePerBlock(raw) {
	return (Number(raw) / 1e18) * BSC_BLOCKS_PER_YEAR * 100;
}

async function runV1WithCurrentArgs(rawArgs) {
	const child = spawn(
		process.execPath,
		["scripts/stable-yield-auto-migrate-v1.mjs", ...rawArgs],
		{ stdio: "inherit", env: process.env },
	);
	await new Promise((resolve, reject) => {
		child.on("exit", (code) =>
			code === 0 ? resolve() : reject(new Error(`v1 exited ${code}`)),
		);
		child.on("error", reject);
	});
}

async function main() {
	const args = parseArgs(process.argv);
	const execute = toBool(args.execute, false);
	const minApyDeltaBps = Number(args.minApyDeltaBps || 20);
	const rpcUrl = String(
		process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
	);
	const privateKey =
		process.env.BSC_EXECUTE_PRIVATE_KEY ||
		process.env.EVM_PRIVATE_KEY ||
		process.env.POLYMARKET_PRIVATE_KEY;
	if (!privateKey) throw new Error("missing private key env");

	const provider = new ethers.JsonRpcProvider(rpcUrl);
	const wallet = new ethers.Wallet(privateKey, provider);
	const vTokenAbi = [
		"function supplyRatePerBlock() view returns(uint256)",
		"function balanceOfUnderlying(address owner) returns(uint256)",
		"function balanceOf(address owner) view returns(uint256)",
		"function exchangeRateStored() view returns(uint256)",
	];
	const vusdc = new ethers.Contract(VENUS.USDC.vToken, vTokenAbi, wallet);
	const vusdt = new ethers.Contract(VENUS.USDT.vToken, vTokenAbi, wallet);

	const [usdcRate, usdtRate] = await Promise.all([
		vusdc.supplyRatePerBlock(),
		vusdt.supplyRatePerBlock(),
	]);

	const venusUsdcApy = apyFromRatePerBlock(usdcRate.toString());
	const venusUsdtApy = apyFromRatePerBlock(usdtRate.toString());
	const listaUsdtApy = Number(
		args.listaUsdtApy || process.env.LISTA_USDT_APY || Number.NaN,
	);
	const wombatUsdtApy = Number(
		args.wombatUsdtApy || process.env.WOMBAT_USDT_APY || Number.NaN,
	);

	const candidates = [
		{ key: "venus-usdc", apy: venusUsdcApy, executable: true },
		{ key: "venus-usdt", apy: venusUsdtApy, executable: true },
		{ key: "lista-usdt", apy: listaUsdtApy, executable: false },
		{ key: "wombat-usdt", apy: wombatUsdtApy, executable: false },
	].filter((x) => Number.isFinite(x.apy));

	const best = [...candidates].sort((a, b) => b.apy - a.apy)[0] || null;
	const current = venusUsdcApy >= venusUsdtApy ? "venus-usdc" : "venus-usdt";
	const currentApy = current === "venus-usdc" ? venusUsdcApy : venusUsdtApy;
	const deltaBps = best ? Math.round((best.apy - currentApy) * 100) : 0;

	const plan = {
		status: "planned",
		version: "v2",
		address: wallet.address,
		current,
		currentApy,
		best,
		deltaBps,
		minApyDeltaBps,
		candidates,
		execute,
	};

	if (!best) {
		console.log(
			JSON.stringify(
				{ ...plan, status: "noop", reason: "no candidate APY data" },
				null,
				2,
			),
		);
		return;
	}
	if (deltaBps < minApyDeltaBps) {
		console.log(
			JSON.stringify(
				{
					...plan,
					status: "noop",
					reason: `delta below threshold (${deltaBps} < ${minApyDeltaBps})`,
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

	if (!best.executable) {
		console.log(
			JSON.stringify(
				{
					...plan,
					status: "planned",
					reason:
						"best market currently read-only in v2 (execution adapter pending)",
				},
				null,
				2,
			),
		);
		return;
	}

	// For executable routes (Venus-only in current v2), delegate execute path to v1.
	const passthroughArgs = process.argv.slice(2);
	await runV1WithCurrentArgs(passthroughArgs);
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
