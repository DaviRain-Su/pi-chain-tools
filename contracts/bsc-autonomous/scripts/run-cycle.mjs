#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
	const out = {};
	for (let i = 0; i < argv.length; i += 1) {
		const t = argv[i];
		if (!t.startsWith("--")) continue;
		out[t.slice(2)] = argv[i + 1];
		i += 1;
	}
	return out;
}

function normalizeStateDelta(transitions) {
	if (!Array.isArray(transitions) || transitions.length < 2) return null;
	const first = transitions[0].args;
	const last = transitions[transitions.length - 1].args;
	return {
		previousState: Number(first.previousState),
		nextState: Number(last.nextState),
		label: `${Number(first.previousState)}->${Number(last.nextState)}`,
	};
}

async function main() {
	const args = parseArgs();
	const rpc = process.env.BSC_TESTNET_RPC_URL || process.env.BSC_RPC_URL;
	const pk =
		process.env.BSC_TESTNET_PRIVATE_KEY || process.env.BSC_EXECUTE_PRIVATE_KEY;
	const address = args.contract || process.env.BSC_AUTONOMOUS_CONTRACT_ADDRESS;
	if (!rpc || !pk || !address)
		throw new Error("missing rpc/private key/contract address");

	const provider = new ethers.JsonRpcProvider(rpc);
	const signer = new ethers.Wallet(pk, provider);
	const artifactPath = path.resolve(
		ROOT,
		"artifacts/contracts/BscAutonomousStrategy.sol/BscAutonomousStrategy.json",
	);
	const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
	const contract = new ethers.Contract(address, artifact.abi, signer);

	const routeData = ethers.toUtf8Bytes(
		args.routeData || "HYPERLIQUID:USDC->USDT",
	);
	const req = {
		cycleId:
			args.cycleId ||
			ethers.keccak256(ethers.toUtf8Bytes(`cycle-${Date.now()}`)),
		transitionNonce: BigInt(
			args.transitionNonce ||
				process.env.BSC_AUTONOMOUS_CONTRACT_NEXT_NONCE ||
				"1",
		),
		amountRaw: BigInt(
			args.amountRaw ||
				process.env.BSC_AUTONOMOUS_HYPERLIQUID_AMOUNT_RAW ||
				"1000000000000000",
		),
		tokenIn:
			args.tokenIn ||
			process.env.BSC_AUTONOMOUS_HYPERLIQUID_TOKEN_IN_ADDRESS ||
			ethers.ZeroAddress,
		tokenOut:
			args.tokenOut ||
			process.env.BSC_AUTONOMOUS_HYPERLIQUID_TOKEN_OUT_ADDRESS ||
			ethers.ZeroAddress,
		routeData,
		routeDataHash: ethers.keccak256(routeData),
		emergencyOverride: String(args.emergencyOverride || "false") === "true",
	};

	const tx = await contract.runDeterministicCycle(req);
	const receipt = await tx.wait();
	const decoded = receipt.logs
		.map((log) => {
			try {
				return contract.interface.parseLog(log);
			} catch {
				return null;
			}
		})
		.filter(Boolean);

	const transitions = decoded.filter((d) => d.name === "CycleStateTransition");
	const decisions = decoded.filter((d) => d.name === "ExecutionDecision");

	const result = {
		ok: receipt.status === 1,
		txHash: receipt.hash,
		blockNumber: receipt.blockNumber,
		eventCount: decoded.length,
		emittedEvents: decoded.map((d) => d.name),
		stateDelta: normalizeStateDelta(transitions),
		transition: {
			cycleId: req.cycleId,
			transitionId: req.transitionNonce.toString(),
			eventName: "CycleStateTransition",
			emittedEvents: decoded.map((d) => d.name),
			stateDelta: normalizeStateDelta(transitions),
		},
		decision: decisions[0]
			? {
					executed: decisions[0].args.executed,
					reason: decisions[0].args.reason,
					routeExecutionId: decisions[0].args.routeExecutionId,
				}
			: null,
	};
	console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
	console.error(
		JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2),
	);
	process.exitCode = 1;
});
