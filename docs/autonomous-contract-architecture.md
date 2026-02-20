# BSC Autonomous Contracts Architecture (AsterDEX Track)

## Goal

Move autonomous execution from script-only guardrails to **contract-enforced deterministic state transitions** suitable for pure onchain autonomy demos and hackathon review.

## Contract Package

Path: `contracts/bsc-autonomous/`

### Core contracts

- `BscAutonomousStrategy.sol`
  - Deterministic cycle state machine: `Idle -> Triggered -> Executed -> Idle` (or `Halted` on failure)
  - Onchain cycle entrypoint: `runDeterministicCycle(CycleRequest)`
  - Deterministic constraints checked onchain:
    - strict transition nonce (`n + 1`)
    - route data hash integrity
    - idle-state gate
    - cooldown window
    - max amount guard
  - Rejects manual override-style contract forwarding by default (`msg.sender == tx.origin` path check)
  - Emergency-only override path with explicit event evidence

- `IAsterDexEarnRouter.sol`
  - Router interface binding for AsterDEX Earn execution route

- `MockAsterDexEarnRouter.sol`
  - Test mock for deterministic success/failure simulation

### Risk guard controls (in strategy contract)

- `maxAmountRaw`
- `cooldownSeconds`
- `paused`
- emergency pause / unpause with emergency role

### Key events

- `CycleStateTransition`
- `ExecutionDecision`
- `EmergencyPauseSet`
- `RiskConfigUpdated`

These are consumed by scripts as submission evidence (tx hash + decoded events + state delta).

## Script Integration

Autonomy scripts continue to support legacy/offchain flow, but now support contract-first execution:

- `scripts/bsc-autonomous-cycle.mjs`
  - accepts contract entrypoint mode via env
  - merges runtime transition evidence from decoded contract events
- `scripts/asterdex-exec-safe.mjs`
  - parses structured JSON output from contract interaction scripts
  - surfaces `decodedEvents`, `stateDelta`, and `transition` in execution evidence

Contract interaction scripts:

- `contracts/bsc-autonomous/scripts/deploy.mjs`
- `contracts/bsc-autonomous/scripts/run-cycle.mjs`
- `contracts/bsc-autonomous/scripts/verify-placeholder.mjs`

## Required env placeholders

See `.env.bsc.example` for:

- testnet/mainnet RPC + keys
- strategy contract address
- router address
- risk guard defaults
- token addresses for deterministic route

## ABI + function path for review

- ABI: `contracts/bsc-autonomous/artifacts/contracts/BscAutonomousStrategy.sol/BscAutonomousStrategy.json`
- Function: `runDeterministicCycle((bytes32,uint256,uint256,address,address,bytes,bytes32,bool))`
- Primary events: `CycleStateTransition`, `ExecutionDecision`

## Test coverage

- Unit/state tests: `contracts/bsc-autonomous/test/strategy.state-machine.test.js`
  - successful deterministic cycle
  - max amount guard
  - cooldown enforcement
  - forwarder/manual override rejection
  - emergency override on paused state

## Operational flow

1. Compile contracts
2. Deploy to BSC testnet
3. Run one deterministic cycle tx through contract entrypoint
4. Decode events and derive state delta
5. Regenerate submission evidence bundle
