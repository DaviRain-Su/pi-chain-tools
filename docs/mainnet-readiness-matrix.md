# Mainnet Readiness Matrix

- Generated at: 2026-02-20T02:15:55.566Z
- Overall status: 🔴 RED
- Autonomous track: healthy

## Summary

| Module | Status | Last validated | Top blocker | Next action |
| --- | --- | --- | --- | --- |
| BSC autonomous track | 🟢 GREEN | 2026-02-20T02:15:55.566Z | - | Legacy track active; set BSC_AUTONOMOUS_MODE=true to run autonomous rollout checks. |
| BSC execute | 🟡 YELLOW | 2026-02-19T14:05:18.982Z | preflight missing env: BSC_EXECUTE_ENABLED,BSC_RPC_URL | Run npm run execute:proof:bsc and refresh matrix |
| Starknet execute | 🔴 RED | - | no Starknet execution proof found in docs/execution-proofs/*/proof-starknet.md | Run npm run execute:proof:starknet and refresh matrix |
| NEAR flows | 🟡 YELLOW | 2026-02-20T02:15:55.552Z | latest evidence is preflight/readiness only; no recent mutate proof attached | Run targeted NEAR flow (dryrun/execute-safe) and save proof artifact for green |
| MCP providers (DFlow/Breeze) | 🟡 YELLOW | - | missing breeze smoke artifact (apps/dashboard/data/proofs/breeze/latest.json) | Run npm run breeze:smoke and add equivalent DFlow smoke proof |
| Security watch/alerts/dashboard | 🔴 RED | - | no security watch report found | Run npm run security:scan:once and verify dashboard security endpoints |
| Live test runner | 🟡 YELLOW | 2026-02-20T02:15:55.552Z | live-test dryrun/execute evidence missing in latest artifact | Run npm run live:test:preflight then npm run live:test:dryrun |

## Evidence details

### BSC autonomous track

- Status: green
- Last validated: 2026-02-20T02:15:55.566Z
- Next action: Legacy track active; set BSC_AUTONOMOUS_MODE=true to run autonomous rollout checks.
- Evidence:
  - autonomous mode disabled
  - AsterDEX execute binding: none
- Blockers:
  - (none)

### BSC execute

- Status: yellow
- Last validated: 2026-02-19T14:05:18.982Z
- Next action: Run npm run execute:proof:bsc and refresh matrix
- Evidence:
  - execution proof found: docs/execution-proofs/2026-02-19/proof-bsc.md
- Blockers:
  - preflight missing env: BSC_EXECUTE_ENABLED,BSC_RPC_URL

### Starknet execute

- Status: red
- Last validated: -
- Next action: Run npm run execute:proof:starknet and refresh matrix
- Evidence:
  - (none)
- Blockers:
  - no Starknet execution proof found in docs/execution-proofs/*/proof-starknet.md

### NEAR flows

- Status: yellow
- Last validated: 2026-02-20T02:15:55.552Z
- Next action: Run targeted NEAR flow (dryrun/execute-safe) and save proof artifact for green
- Evidence:
  - dashboard /api/health reachable in latest live-test preflight
  - near setup runbook present: docs/openclaw-near-setup.md
- Blockers:
  - latest evidence is preflight/readiness only; no recent mutate proof attached

### MCP providers (DFlow/Breeze)

- Status: yellow
- Last validated: -
- Next action: Run npm run breeze:smoke and add equivalent DFlow smoke proof
- Evidence:
  - dflow provider module present: src/mcp/providers/dflow.ts
  - breeze provider module present: src/mcp/providers/breeze.ts
- Blockers:
  - missing breeze smoke artifact (apps/dashboard/data/proofs/breeze/latest.json)

### Security watch/alerts/dashboard

- Status: red
- Last validated: -
- Next action: Run npm run security:scan:once and verify dashboard security endpoints
- Evidence:
  - security runbook present: docs/evm-security-watch-cron.md
- Blockers:
  - no security watch report found

### Live test runner

- Status: yellow
- Last validated: 2026-02-20T02:15:55.552Z
- Next action: Run npm run live:test:preflight then npm run live:test:dryrun
- Evidence:
  - live-test artifact mode=preflight ok=true
- Blockers:
  - live-test dryrun/execute evidence missing in latest artifact

