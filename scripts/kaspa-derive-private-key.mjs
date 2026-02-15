#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import process from "node:process";
import { createRequire } from "node:module";

const DEFAULT_DERIVATION_PATH = "m/44'/972'/0'/0'/0'";

function printUsage() {
	console.log(`
Usage:
  node scripts/kaspa-derive-private-key.mjs --mnemonic "<12/24 words>" [options]

Options:
  --mnemonic "<mnemonic>"     12 或 24 个词的助记词
  --network <network>         kaspa 网络: testnet-10 | testnet-11 | mainnet（默认 testnet-10）
  --path "<path>"             BIP32 派生路径（默认 ${DEFAULT_DERIVATION_PATH}）
  --mnemonic-file <path>      从文件读取助记词（首行优先）
  --output <path>             （可选）将私钥写入文件
  --format <json|raw>         输出格式，默认 json
  --scan-for <address>        给定目标地址时扫描常见 BIP44 派生路径，尝试找出匹配路径
  --account-limit <number>    扫描 account 上限（scan 模式，默认 20）
  --change-limit <number>     扫描 change 上限（scan 模式，默认 3）
  --index-limit <number>      扫描 index 上限（scan 模式，默认 20）
  --coin-type <number>        派生币种索引（默认 972）
  --help                      显示帮助
`);
}

function parseArgs(argv) {
	const out = {
		network: "testnet-10",
		path: DEFAULT_DERIVATION_PATH,
		format: "json",
		accountLimit: 20,
		changeLimit: 3,
		indexLimit: 20,
		coinType: 972,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg || typeof arg !== "string") continue;
		if (arg === "--help" || arg === "-h") {
			out.help = true;
			continue;
		}
		if (arg === "--mnemonic" || arg === "-m") {
			out.mnemonic = argv[index + 1];
			index += 1;
			continue;
		}
		if (arg === "--network" || arg === "-n") {
			out.network = argv[index + 1] ?? out.network;
			index += 1;
			continue;
		}
		if (arg === "--path" || arg === "-p") {
			out.path = argv[index + 1] ?? out.path;
			index += 1;
			continue;
		}
		if (arg === "--scan-for") {
			out.scanTarget = argv[index + 1];
			index += 1;
			continue;
		}
		if (arg === "--account-limit") {
			const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
			if (!Number.isNaN(parsed) && parsed > 0) out.accountLimit = parsed;
			index += 1;
			continue;
		}
		if (arg === "--change-limit") {
			const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
			if (!Number.isNaN(parsed) && parsed > 0) out.changeLimit = parsed;
			index += 1;
			continue;
		}
		if (arg === "--index-limit") {
			const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
			if (!Number.isNaN(parsed) && parsed > 0) out.indexLimit = parsed;
			index += 1;
			continue;
		}
		if (arg === "--coin-type") {
			const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
			if (!Number.isNaN(parsed) && parsed > 0) out.coinType = parsed;
			index += 1;
			continue;
		}
		if (arg === "--mnemonic-file") {
			out.mnemonicFile = argv[index + 1];
			index += 1;
			continue;
		}
		if (arg === "--output" || arg === "-o") {
			out.outputPath = argv[index + 1];
			index += 1;
			continue;
		}
		if (arg === "--format" || arg === "--fmt") {
			out.format = argv[index + 1] ?? out.format;
			index += 1;
			continue;
		}
	}
	return out;
}

function resolveKaspaWalletNetwork(network) {
	const normalized = String(network || "").toLowerCase().trim();
	if (normalized.includes("main")) return "kaspa";
	if (normalized.includes("dev")) return "kaspadev";
	if (normalized.includes("sim")) return "kaspasim";
	return "kaspatest";
}

function isRawFormat(format) {
	return String(format || "json").toLowerCase() === "raw";
}

async function readMnemonicFromFile(filePath) {
	if (!filePath) return null;
	const { readFileSync } = await import("node:fs");
	const raw = readFileSync(filePath, "utf8");
	const lines = raw.split(/\r?\n/).map((line) => line.trim());
	return lines.find((line) => line.length > 0) || "";
}

function summarize(output) {
	const payload = {
		network: output.network,
		walletNetwork: output.walletNetwork,
		coinType: output.coinType,
		derivationPath: output.path,
		rootXprvHead: output.rootXprv.slice(0, 30) + "...",
		privateKey: output.privateKey,
		receiveAddress: output.receiveAddress,
	};
	if (isRawFormat(output.format)) {
		return output.privateKey;
	}
	return JSON.stringify(payload, null, 2);
}

async function loadKaspaWalletModule() {
	const require = createRequire(import.meta.url);
	try {
		const module = require("@kaspa/wallet");
		return module;
	} catch {
		throw new Error(
			"未找到 @kaspa/wallet。请先执行：npm i @kaspa/wallet 或从项目依赖中确认安装。",
		);
	}
}

async function resolveKaspaAddressMatch({
	wallet,
	target,
	coinType,
	network,
	accountLimit,
	changeLimit,
	indexLimit,
	}) {
	for (let account = 0; account < accountLimit; account += 1) {
		for (let change = 0; change < changeLimit; change += 1) {
			for (let index = 0; index < indexLimit; index += 1) {
				const candidatePaths = [
					`m/44'/${coinType}'/${account}'/${change}/${index}`,
					`m/44'/${coinType}'/${account}'/${change}/${index}'`,
					`m/44'/${coinType}'/${account}'/${change}'/${index}`,
					`m/44'/${coinType}'/${account}'/${change}'/${index}'`,
				];
				for (const path of candidatePaths) {
					const child = wallet.HDWallet.deriveChild(path);
					const receiveAddress = child.privateKey.toAddress(network).toString();
					if (receiveAddress === target) {
						return {
							path,
							privateKey: child.privateKey.toString(),
						};
					}
				}
			}
		}
	}
	return null;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printUsage();
		return;
	}

	let mnemonic = opts.mnemonic;
	if (!mnemonic && opts.mnemonicFile) {
		mnemonic = await readMnemonicFromFile(opts.mnemonicFile);
	}
	mnemonic = typeof mnemonic === "string" ? mnemonic.trim() : "";
	if (!mnemonic) {
		throw new Error(
			"请传入 --mnemonic 或 --mnemonic-file。示例：--mnemonic \"battle zoo ...\"",
		);
	}

	const walletModule = await loadKaspaWalletModule();
	const { Wallet, initKaspaFramework } = walletModule;
	await initKaspaFramework();

	const walletNetwork = resolveKaspaWalletNetwork(opts.network);
	const wallet = Wallet.fromMnemonic(mnemonic, {
		network: walletNetwork,
	});
	if (opts.scanTarget) {
		const match = await resolveKaspaAddressMatch({
			wallet,
			target: opts.scanTarget,
			coinType: opts.coinType,
			network: walletNetwork,
			accountLimit: opts.accountLimit,
			changeLimit: opts.changeLimit,
			indexLimit: opts.indexLimit,
		});
		if (!match) {
			console.error(
				`\n未在扫描范围内命中目标地址（m/44'/${opts.coinType}'/account'/change/index*）\n` +
					`扫描范围: account 0-${opts.accountLimit - 1}, change 0-${opts.changeLimit - 1}, index 0-${opts.indexLimit - 1}`,
			);
		} else {
			console.log(
				`Found match for target address ${opts.scanTarget}: derivation path=${match.path}`,
			);
			console.log(`privateKey=${match.privateKey}`);
		}
		return;
	}
	const child = wallet.HDWallet.deriveChild(opts.path);
	const privateKey = child.privateKey.toString();
	const receiveAddress = child.privateKey.toAddress(walletNetwork).toString();

	const output = {
		network: opts.network || "testnet-10",
		walletNetwork,
		path: opts.path,
		privateKey,
		rootXprv: wallet.HDWallet.toString(),
		receiveAddress,
		format: opts.format,
		outputPath: opts.outputPath,
	};

	const rendered = summarize(output);
	console.log(rendered);

	if (opts.outputPath) {
		writeFileSync(opts.outputPath, `${privateKey}\n`, "utf8");
		console.log(`\n私钥已写入: ${opts.outputPath}`);
	}
}

main().catch((error) => {
	console.error(`\n错误: ${String(error?.message ?? error)}`);
	printUsage();
	process.exitCode = 1;
});
