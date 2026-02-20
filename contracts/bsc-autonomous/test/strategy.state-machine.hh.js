import assert from "node:assert/strict";
import hre from "hardhat";

const { ethers } = hre;

describe("BscAutonomousStrategy state transitions", () => {
	async function deployFixture() {
		const [deployer, emergency] = await ethers.getSigners();
		const routerFactory = await ethers.getContractFactory(
			"MockAsterDexEarnRouter",
		);
		const router = await routerFactory.deploy();
		await router.waitForDeployment();

		const strategyFactory = await ethers.getContractFactory(
			"BscAutonomousStrategy",
		);
		const strategy = await strategyFactory.deploy(
			await router.getAddress(),
			1_000_000n,
			60,
			deployer.address,
			emergency.address,
		);
		await strategy.waitForDeployment();
		return { deployer, emergency, strategy, router };
	}

	function cycleRequest(overrides = {}) {
		const routeData =
			overrides.routeData || ethers.toUtf8Bytes("ASTERDEX:USDC->USDT");
		return {
			cycleId:
				overrides.cycleId || ethers.keccak256(ethers.toUtf8Bytes("cycle-001")),
			transitionNonce: overrides.transitionNonce ?? 1,
			amountRaw: overrides.amountRaw ?? 1000,
			tokenIn:
				overrides.tokenIn || "0x0000000000000000000000000000000000000011",
			tokenOut:
				overrides.tokenOut || "0x0000000000000000000000000000000000000022",
			routeData,
			routeDataHash: overrides.routeDataHash || ethers.keccak256(routeData),
			emergencyOverride: overrides.emergencyOverride ?? false,
		};
	}

	it("executes deterministic cycle and returns to Idle", async () => {
		const { strategy } = await deployFixture();
		const tx = await strategy.runDeterministicCycle(cycleRequest());
		const receipt = await tx.wait();
		const state = await strategy.cycleState();
		assert.equal(state, 0n);
		assert.equal(await strategy.lastTransitionNonce(), 1n);

		const transitionEvents = receipt.logs.filter(
			(x) => x.fragment?.name === "CycleStateTransition",
		);
		assert.ok(transitionEvents.length >= 3);
	});

	it("enforces max amount guard", async () => {
		const { strategy } = await deployFixture();
		await assert.rejects(
			strategy.runDeterministicCycle(cycleRequest({ amountRaw: 2_000_000 })),
			/amount_above_guard/,
		);
	});

	it("enforces cooldown between cycles", async () => {
		const { strategy } = await deployFixture();
		await (await strategy.runDeterministicCycle(cycleRequest())).wait();
		await assert.rejects(
			strategy.runDeterministicCycle(cycleRequest({ transitionNonce: 2 })),
			/cooldown_active/,
		);
	});

	it("rejects manual override path when caller is contract", async () => {
		const { strategy } = await deployFixture();
		const forwarderFactory = await ethers.getContractFactory("MockForwarder");
		const forwarder = await forwarderFactory.deploy();
		await forwarder.waitForDeployment();
		await assert.rejects(
			forwarder.forward(await strategy.getAddress(), cycleRequest()),
			/manual_override_path_rejected/,
		);
	});

	it("allows emergency override while paused for emergency role", async () => {
		const { strategy, emergency } = await deployFixture();
		await (
			await strategy.connect(emergency).setEmergencyPause(true, "test")
		).wait();
		await (
			await strategy
				.connect(emergency)
				.runDeterministicCycle(cycleRequest({ emergencyOverride: true }))
		).wait();
		assert.equal(await strategy.cycleState(), 0n);
	});

	it("preserves nonce invariant across halt recovery", async () => {
		const { strategy, router, emergency } = await deployFixture();
		await (
			await router.setResult(
				false,
				ethers.keccak256(ethers.toUtf8Bytes("fail-1")),
			)
		).wait();
		await (await strategy.runDeterministicCycle(cycleRequest())).wait();

		assert.equal(await strategy.cycleState(), 3n);
		assert.equal(await strategy.lastTransitionNonce(), 1n);

		await (await strategy.connect(emergency).recoverFromHalt()).wait();
		assert.equal(await strategy.cycleState(), 0n);
		assert.equal(await strategy.lastTransitionNonce(), 1n);

		await assert.rejects(
			strategy.runDeterministicCycle(cycleRequest({ transitionNonce: 1 })),
			/invalid_transition_nonce/,
		);

		await (
			await router.setResult(true, ethers.keccak256(ethers.toUtf8Bytes("ok-2")))
		).wait();
		await (
			await strategy.runDeterministicCycle(cycleRequest({ transitionNonce: 2 }))
		).wait();
		assert.equal(await strategy.lastTransitionNonce(), 2n);
	});
});
