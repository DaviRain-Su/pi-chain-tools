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
