# Monad Agent Identity + Delegation v1.3 Notes

## Scope (batch v1.3)

This batch adds a reproducible, demo-first alignment layer inspired by Oikonomos:

1. Deterministic Monad agent identity model (backend + API)
2. Delegation intent scaffold with EIP-712-style payload + verifier utility
3. Action-history and dashboard status wiring
4. Explicit confirm gates for mutating endpoints

## Design choices

- **Deterministic identity**: `agentId` is derived from stable fields (`namespace/chainId/account/operator/rpc/vault`) via SHA-256.
- **Non-custodial delegation**: server prepares canonical payload and digest, but signing remains off-chain/external.
- **Mock-safe registration**: when chain write path is unavailable, register endpoint still emits artifact + history for reproducible demo traces.
- **Revocable model**: delegation records keep lifecycle status (`active` -> `revoked`) and timestamps.

## New APIs

- `GET /api/monad/agent/identity`
- `POST /api/monad/agent/identity/register` (`confirm=true`)
- `POST /api/monad/agent/delegation/prepare`
- `POST /api/monad/agent/delegation/submit` (`confirm=true`)
- `POST /api/monad/agent/delegation/revoke` (`confirm=true`)

## Persistence

- State file: `apps/dashboard/data/monad-agent-state.json`
- Override env/config: `MONAD_AGENT_STATE_PATH` / `paths.monadAgentState`

Stored sections:

- `identity` registration state
- `delegations[]` lifecycle rows
- `metrics` counters (get/register/prepare/submit/revoke)

## Safety and blockers

Mutating endpoints require explicit `confirm=true`.

Verifier returns structured response for invalid delegation submit:

- `blockers`
- `hints`
- `fixPack`

This preserves existing dashboard safety style and predictable operator remediation.

## Next step candidates (post-v1.3)

- Wire real onchain identity registry contract write path
- Replace demo signature placeholder with strict secp256k1 typed-data verification
- Add delegation scope templates for protocol-specific permissions
