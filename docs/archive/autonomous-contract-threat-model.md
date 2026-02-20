# Autonomous Contract Threat Model (BSC Hyperliquid Cycle)

## Scope
`contracts/hyperliquid-autonomous/contracts/BscAutonomousStrategy.sol` and its offchain invocation path (`scripts/hyperliquid-autonomous-cycle.mjs`, `contracts/hyperliquid-autonomous/scripts/run-cycle.mjs`).

## Trust Boundaries
- **Onchain strategy contract**: authoritative state machine + guards.
- **Router contract (Hyperliquid)**: external dependency; can fail, return malicious IDs, or execute unexpected logic.
- **EOA operator key**: submits cycle tx and can trigger emergency operations.
- **Offchain orchestrator**: prepares request payloads, confirms route hash, records evidence.
- **RPC provider / indexers**: observation layer only; should not be trusted for state truth beyond chain finality.

## Critical Invariants
1. `transitionNonce` must be strictly monotonic (`== lastTransitionNonce + 1`).
2. Route integrity is hash-locked (`keccak256(routeData) == routeDataHash`).
3. Cycle can execute only from `Idle` state.
4. `amountRaw` must be non-zero and bounded by `maxAmountRaw`.
5. Cooldown must pass between successful cycles.
6. Contract-caller path is blocked for non-emergency runs (`msg.sender == tx.origin`).
7. Halt recovery is emergency-role gated.

## Main Failure Modes
- **Router failure / partial execution**: strategy enters `Halted`; new cycle blocked until explicit recovery.
- **Compromised operator key**: attacker can submit valid-looking cycles within risk limits.
- **Bad route payload**: hash mismatch causes hard revert.
- **Config drift** (`maxAmountRaw`, cooldown, paused): can induce false blocks or unsafe windows.
- **Replay / duplicate attempts**: rejected by nonce invariant.

## Emergency Procedure (Operator Runbook)
1. `setEmergencyPause(true, reason)` by emergency role.
2. Verify latest tx/event trail (ExecutionDecision + CycleStateTransition).
3. If strategy is `Halted`, call `recoverFromHalt()`.
4. Tighten risk limits with `setRiskConfig()` (lower max amount, raise cooldown).
5. Rotate compromised keys and re-grant roles as needed.
6. Resume with `setEmergencyPause(false, reason)` only after route + balance reconciliation.

## Residual Risk Notes
- `tx.origin` checks reduce contract-forwarded calls but are not a full account-abstraction strategy.
- Router trust is concentrated; production should prefer auditable allowlist + adapter-level sanity checks.
- Evidence pipelines must be treated as observability aids, not consensus state.
