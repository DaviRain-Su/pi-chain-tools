# Live Test Runbook (Safety-first)

This runbook provides a guarded, one-command flow for:

1. **preflight** checks (env/config/network/dashboard readiness)
2. **dry-run** checks (non-mutating proofs + smoke/scans)
3. optional **execute** (small-amount live action; explicit confirmation required)

Script: `scripts/live-test-runner.mjs`

## Required env vars

At minimum:

- `DASHBOARD_BASE_URL` (default: `http://127.0.0.1:4173`)
- `BSC_EXECUTE_ENABLED=true` (for BSC live execute)
- `BSC_RPC_URL=<your rpc>`

Recommended for full dry-run visibility:

- `BREEZE_API_BASE_URL`
- `BREEZE_API_KEY`

Optional Hyperliquid execute-binding policy vars (offchain orchestrator seam, no direct unsafe execute):

- `HYPERLIQUID_AUTONOMOUS_ENABLED=true`
- `HYPERLIQUID_AUTONOMOUS_EXECUTE_BINDING_ENABLED=true`
- `HYPERLIQUID_AUTONOMOUS_EXECUTE_BINDING_REQUIRED=true` (enforce blocker when missing)
- `HYPERLIQUID_AUTONOMOUS_EXECUTE_COMMAND` (recommended: `node scripts/hyperliquid-exec-safe.mjs "{intent}"`)
- `HYPERLIQUID_AUTONOMOUS_ROUTER_ADDRESS`
- `HYPERLIQUID_AUTONOMOUS_EXECUTOR_ADDRESS`
- `HYPERLIQUID_AUTONOMOUS_EXECUTE_ACTIVE=true` (only when live execution is intentionally enabled)
- `HYPERLIQUID_AUTONOMOUS_LIVE_COMMAND` (actual tx broadcaster command template)
- `HYPERLIQUID_AUTONOMOUS_CONFIRM_TEXT` (default `HYPERLIQUID_EXECUTE_LIVE`)
- `HYPERLIQUID_AUTONOMOUS_MAX_AMOUNT_RAW` (default cap `1000000000000000000`)

## Guardrails

- `--confirm-live true` is mandatory for `--mode execute` and `--mode full`.
- `--max-usd` is a hard user-side budget cap; execute step uses tiny amount (`min(maxUsd, 1)`).
- `--panic-stop <file>` aborts execute before any mutating step if the file exists.
- Report always includes rollback/emergency guidance.

## Emergency stop (panic)

Example:

```bash
touch ./ops/PANIC_STOP
npm run live:test:full -- --confirm-live true --panic-stop ./ops/PANIC_STOP
```

The run aborts before mutate. Remove panic file only after manual review.

## Commands

### 1) Preflight only

```bash
npm run live:test:preflight
```

### 2) Dry-run only (non-mutating)

```bash
npm run live:test:dryrun -- --target-chain all --max-usd 5
```

### 3) Full flow (preflight + dryrun + execute)

> Execute is blocked unless you explicitly pass `--confirm-live true`.

```bash
npm run live:test:full -- --confirm-live true --max-usd 2 --target-chain bsc --panic-stop ./ops/PANIC_STOP
```

### 4) Execute only (expert/manual)

```bash
node scripts/live-test-runner.mjs --mode execute --confirm-live true --max-usd 1 --target-chain bsc
```

## Output artifacts

Always written to:

- `apps/dashboard/data/proofs/live-test/latest.json`
- `apps/dashboard/data/proofs/live-test/latest.md`

Optional custom JSON output:

```bash
node scripts/live-test-runner.mjs --mode preflight --out /tmp/live-test-report.json
```

## Rollback guidance

After any non-OK run:

1. Read `apps/dashboard/data/proofs/live-test/latest.json`
2. Verify any tx hash in explorer/logs before retries
3. Re-run in sequence:
   - `npm run live:test:preflight`
   - `npm run live:test:dryrun`
   - execute only with explicit confirmation


## Why offchain orchestrator mode

This repo uses offchain orchestration as the declared production/demo target because it improves:

- speed of setup and incident recovery,
- reliability across heterogeneous environments,
- operator control via explicit confirmation + local key custody.

Onchain evidence is still required where available (tx hash/events/state changes), but autonomous onchain trigger proof is not a release blocker in this mode.

## Mainnet readiness matrix (timely update)

Build/update readiness artifacts (JSON + markdown):

```bash
npm run readiness:build
```

Quick periodic refresh (runs preflight + rebuild matrix):

```bash
npm run readiness:refresh
```

Recommended cadence:

- Before shipping mainnet config changes
- After any execute-proof/security watch/live-test run
- At least every 24h during active operations

Artifacts generated:

- `docs/mainnet-readiness-matrix.md`
- `apps/dashboard/data/readiness/latest.json`
- Dashboard API: `GET /api/readiness/matrix`

## Offchain orchestrator observability + live safety lock

- Cycle proof latest: `apps/dashboard/data/proofs/autonomous-cycle/latest.json`
- Cycle proof history: `apps/dashboard/data/proofs/autonomous-cycle/runs/*.json`
- Live lock/replay state: `apps/dashboard/data/autonomous-cycle-state.json`
- Dashboard API: `GET /api/autonomous/cycle/runs?limit=8`

Operator commands:

```bash
npm run autonomous:hyperliquid:runs -- --limit 8
npm run doctor:paths
```

Live lock controls (default-safe):

- `HYPERLIQUID_AUTONOMOUS_CYCLE_MIN_LIVE_INTERVAL_SECONDS` (default `300`)
- `HYPERLIQUID_AUTONOMOUS_CYCLE_LOCK_TTL_SECONDS` (default `900`)

## Foundry crystallization note (targeted)

A targeted crystallization attempt was executed for recurring `exec/path/check` interruptions; current candidate output was not directly path/check relevant (it suggested an `edit` ambiguity pattern). Until a suitable candidate appears, keep deterministic prevention in code/scripts:

- normalize step fast-skip cache + ENOENT-safe fallback (`scripts/normalize-runtime-metrics.mjs`)
- cwd/path self-diagnosis command (`npm run doctor:paths`)
- autonomous live lock + replay state (`apps/dashboard/data/autonomous-cycle-state.json`)
