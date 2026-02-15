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
  --help                      显示帮助
`);
}

function parseArgs(argv) {
	const out = {
		network: "testnet-10",
		path: DEFAULT_DERIVATION_PATH,
		format: "json",
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
