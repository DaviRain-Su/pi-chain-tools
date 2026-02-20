#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
	const rpc = process.env.BSC_TESTNET_RPC_URL || process.env.BSC_RPC_URL;
	const pk =
		process.env.BSC_TESTNET_PRIVATE_KEY || process.env.BSC_EXECUTE_PRIVATE_KEY;
	if (!rpc || !pk)
		throw new Error(
			"missing BSC_TESTNET_RPC_URL and/or BSC_TESTNET_PRIVATE_KEY",
		);

	const provider = new ethers.JsonRpcProvider(rpc);
	const signer = new ethers.Wallet(pk, provider);

	const routerAddress =
		process.env.BSC_AUTONOMOUS_ROUTER_ADDRESS || ethers.ZeroAddress;
	const maxAmountRaw = BigInt(
		process.env.BSC_AUTONOMOUS_CONTRACT_MAX_AMOUNT_RAW || "1000000000000000000",
	);
	const cooldown = Number(
		process.env.BSC_AUTONOMOUS_CONTRACT_COOLDOWN_SECONDS || "300",
	);
	const emergency =
		process.env.BSC_AUTONOMOUS_EMERGENCY_ADMIN || signer.address;

	const artifactPath = path.resolve(
		ROOT,
		"artifacts/contracts/BscAutonomousStrategy.sol/BscAutonomousStrategy.json",
	);
	const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
	const factory = new ethers.ContractFactory(
		artifact.abi,
		artifact.bytecode,
		signer,
	);
	const contract = await factory.deploy(
		routerAddress,
		maxAmountRaw,
		cooldown,
		signer.address,
		emergency,
	);
	const receipt = await contract.deploymentTransaction().wait();

	const deployment = {
		network: "bscTestnet",
		chainId: Number((await provider.getNetwork()).chainId),
		contract: "BscAutonomousStrategy",
		address: await contract.getAddress(),
		deployer: signer.address,
		routerAddress,
		txHash: receipt.hash,
		blockNumber: receipt.blockNumber,
		deployedAt: new Date().toISOString(),
	};

	const outDir = path.resolve(ROOT, "deployments");
	await mkdir(outDir, { recursive: true });
	const outPath = path.join(outDir, "bscTestnet.latest.json");
	await writeFile(outPath, `${JSON.stringify(deployment, null, 2)}\n`);
	console.log(JSON.stringify({ ok: true, outPath, deployment }, null, 2));
}

main().catch((err) => {
	console.error("[deploy] failed", err?.message || String(err));
	process.exitCode = 1;
});
