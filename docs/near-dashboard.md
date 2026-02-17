# NEAR Dashboard (Local Web)

This is a lightweight local dashboard for quick visibility into your account state while running strategies.

## What it shows (current)

- NEAR wallet balance
- Tracked FT balances (USDt / USDC.e / USDC / wNEAR)
- Burrow registration + position rows (`collateral` / `supplied` / `borrowed`)
- Yield worker status (best-effort from latest local OpenClaw session log)
- Recent execution tx list (best-effort from latest local OpenClaw session log)
- Strategy view: current stable collateral APR ranking + quick recommendation
- Action Console: command builder + optional direct execution for selected actions (requires browser confirm)
- Action history panel: success/error timeline for dashboard-triggered actions
- Yield health panel: weighted APR + collateral composition summary
- Target allocation alert: configurable USDt/USDC.e targets + deviation threshold
- Rebalance suggestion: estimate transfer amount needed to move toward target mix
- Rebalance execution draft: one-click generate/copy 3-step withdraw/swap/supply command draft
- One-click fill Action Console from latest rebalance plan (with pre-execution checklist)
- Step runner helper: build Step1/Step2/Step3 commands and feed Step2 output raw into Step3 template
- Step2 parser helper: paste swap result text and auto-extract output raw for Step3
- Action History now supports optional `step` tag for execution traceability (e.g. step1/step2/step3)
- Action History includes txHash + explorer link when parsed from execution output
- One-click transactional rebalance action (`USDt -> USDC.e`): step1 withdraw -> step2 swap -> step3 supply, with automatic rollback (resupply USDt) when step2 fails
- Idempotency/state guard: optional `runId` support, duplicate run rejection, and single active rebalance lock
- Post-execution reconciliation: compares wallet residual USDt/USDC.e after step3 and records a reconcile entry in Action History
- Execution Quality panel: success/failure/rollback/reconcile-warning counters + recent run summary
- ACP Ops panel: ACP connectivity (`/api/acp/status`) + ACP job summary (`/api/acp/jobs/summary`) + recent ACP job list (`/api/acp/jobs`) in dashboard UI
- ACP Ops now includes async submit controls (strategyId/buyer/amountRaw) and live polling for submitted async job status (`/api/acp/job/submit` + `/api/acp/jobs/:jobId`)
- ACP async worker now supports retry backoff + max attempts and dead-letter state (`status=dead-letter`) for persistent failures
- ACP Ops UI now shows dead-letter table view with error-type grouping and retryability badges, plus batch actions (retry retryable / retry selected / dismiss selected)
- ACP Ops also surfaces dismissed-queue count so archived failures do not pollute active dead-letter triage
- ACP Ops supports archive hygiene: purge dismissed jobs older than N days via confirm-protected action
- Optional auto-purge scheduler can run in-process for dismissed archive retention control
- Dashboard includes Payments panel (`/api/payments`) with status breakdown (`pending/paid/failed`) and recent payment rows
- ACP recent jobs table supports status filtering and NEAR tx explorer links when `txHash` is present
- ACP recent jobs table now also shows `strategyId` / `buyer` / `remainingUses` to trace entitlement consumption during execution
- ACP recent jobs supports local filters by `status` + `buyer` + `strategyId` for faster ops triage
- ACP recent jobs includes `only failed` quick toggle (status in `error|blocked`)
- ACP filter state (`status/buyer/strategyId/onlyFailed`) is synced to URL query params for refresh/share persistence
- ACP filter/expand preferences are also persisted to localStorage (`near-dashboard-acp-filters-v1`) for cross-link personal continuity (`acpExpandErrors` included)
- ACP filters bar includes `Copy filter link` for one-click sharing of the current triage view
- ACP filters bar includes `Reset filters` to clear `status/buyer/strategyId/onlyFailed` and restore `auto-expand errors`, then clean URL query state
- ACP recent jobs row supports click-to-expand detail view (raw job JSON, including receipt/error-related fields when present)
- Expanded detail view includes quick actions: `Copy JSON`, `Copy runId/jobId`, `Copy txHash`, and `Open explorer` (NEAR/BSC tx links)
- Expanded detail now renders structured blocks (`receipt` / `result` / `error` / `raw`) for faster troubleshooting
- Error-focused readability: when a job is `error` (or has error payload), detail blocks auto-expand and the error section is visually marked (`⚠ error`)
- Execution Quality now also includes RPC reliability counters (attempts/retries/retryRate/HTTP 429/5xx), last successful endpoint / latest error snippet, and a basic endpoint health ranking (`score`) to indicate the currently best-performing RPC
- Execution Quality includes payment webhook health counters (`accepted/idempotent/rejected`, last provider/error) for callback operations
- Adaptive RPC routing: request loop prefers currently best-scored endpoint first (based on live endpoint health stats)
- ACP integration bootstrap (Virtual Base identity + multi-chain execution preview):
  - `GET /api/acp/status` -> best-effort `acp whoami` + `acp wallet balance` JSON output
  - `POST /api/acp/route-preview` -> returns execution route plan (`targetChain=near|bsc`, `intentType`, `riskProfile`) for router wiring
  - `POST /api/acp/job/submit` (`confirm=true`) -> async enqueue ACP job and return `jobId` immediately
  - `POST /api/acp/job/execute` (`confirm=true`) -> ACP job router entrypoint; supports `dryRun` (default true) and execute mode for `intentType=rebalance` via existing chain action pipeline
    - returns normalized `receipt` (`runId/identityChain/targetChain/intentType/amountRaw/amountUsd/status/txHash?/adapterMode`)
    - enforces policy `constraints.minRebalanceUsd`
    - entitlement gate: when execute request carries `strategyId`, it must include `buyer` and `paymentId`, and pass strict checks: payment exists, status is `paid`, and `strategyId+buyer` matches payment record
    - a valid active entitlement (`remainingUses > 0`, not expired) is still required; otherwise blocked
    - execute receipts/history include payment/entitlement trace fields (`paymentId`, `entitlementSourcePaymentId`)
    - replay/idempotency guard: repeated terminal run with same `runId + paymentId` is blocked (`reason=duplicate_run`)
    - for chains still in adapter plan-only mode (e.g. current bsc path), receipt `status=planned` and `adapterMode=plan-only`
  - `GET /api/acp/jobs` -> recent ACP job history (dry-run/executed/planned/blocked/error) + async queue snapshot (includes `attemptCount/maxAttempts/nextAttemptAt/lastErrorAt`)
  - `GET /api/acp/jobs/:jobId` -> async job status/result/error by id (includes retry/dead-letter metadata)
  - `GET /api/acp/jobs/dead-letter` -> async jobs exhausted after max attempts
  - `GET /api/acp/jobs/dismissed` -> archived dismissed jobs
  - `POST /api/acp/jobs/dismissed/purge` (`confirm=true`, `olderThanDays`) -> purge archived dismissed jobs older than N days
  - `POST /api/acp/jobs/retry` (`confirm=true`, `jobId`) -> manually requeue a dead-letter/error async job
  - `POST /api/acp/jobs/retry-batch` (`confirm=true`, `jobIds[]`) -> batch requeue dead-letter/error async jobs
  - `POST /api/acp/jobs/retry-retryable` (`confirm=true`) -> requeue all currently retryable dead-letter jobs
  - `POST /api/acp/jobs/dismiss` (`confirm=true`, `jobIds[]`) -> mark dead-letter jobs as dismissed (remove from active DLQ)
  - `GET /api/acp/jobs/summary` -> status distribution + queue status breakdown + daily execution counters/limit
  - execute mode applies policy daily guard `constraints.maxDailyRebalanceRuns`
- Unified multi-chain portfolio bootstrap:
  - `GET /api/portfolio/unified` -> aggregates current NEAR execution portfolio + ACP identity layer status + BSC scaffold status in one schema
- Portfolio policy center (cross-chain target + constraints):
  - `GET /api/policy` -> current policy
  - `POST /api/policy` (`confirm=true`) -> patch `targetAllocation` / `constraints` / `monetization` and persist to disk
- Strategy marketplace bootstrap:
  - `GET /api/strategies` -> list strategies
  - `POST /api/strategies/validate` -> preflight validate strategy DSL without persisting
    - accepts either `dsl` object or legacy fields; returns `phase=schema|semantic|ready`
    - includes `errors[]`, `warnings[]`, and `normalized` DSL when available
    - dashboard UI now supports one-click `Validate -> Publish` flow (calls `/api/strategies` with `confirm=true` only after preflight success)
    - validation output includes simple field-level hints by parsing `field:`-prefixed errors/warnings (e.g., `risk.maxSlippageBps:`)
  - `POST /api/strategies` (`confirm=true`) -> create/update strategy metadata with Strategy DSL v1 + semantic policy validation
    - preferred: submit `dsl` object (validated against `docs/schemas/strategy-dsl.v1.schema.json` and policy semantics)
    - compatible: legacy top-level fields (`id/name/creator/priceUsd/...`) are auto-mapped into DSL v1 then validated
    - semantic checks include policy-aligned amount floor/limit (`minRebalanceUsd`, `maxDailyRebalanceRuns`), chain-intent compatibility, and execution risk warnings
  - `POST /api/strategies/purchase` (`confirm=true`) -> direct purchase path (legacy simulation) + entitlement grant (`entitlementUses`, `entitlementDays`, default 30/30)
  - `POST /api/payments/create` (`confirm=true`) -> create pending payment intent for `strategyId + buyer`
  - `POST /api/payments/confirm` (`confirm=true`) -> confirm payment status (`paid|failed`), and grant entitlement only when paid
  - `POST /api/payments/webhook` -> provider callback entry (optional signature verification via `PAYMENT_WEBHOOK_SECRET`; header `x-payment-signature`/`x-openclaw-signature`)
    - provider mapping supports `generic|ping|x402` via `?provider=...` or header `x-payment-provider`
    - event idempotency enabled by `eventId/id/event_id` de-duplication
  - `GET /api/payments` -> payment records (pending/paid/failed)
  - `GET /api/strategies/purchases` -> recent purchase receipts
  - `GET /api/strategies/entitlements?buyer=...&strategyId=...` -> entitlement snapshots (remaining uses + expiry)
- Metrics persistence: rebalance + rpc reliability metrics survive dashboard restarts via local json file (`NEAR_DASHBOARD_METRICS_PATH`)
- ACP async queue persistence: queued/running jobs are persisted and restored on restart (running jobs re-queued for safe resume)
- ACP async retry policy: exponential backoff (1s,2s,4s...) with per-job `maxAttempts` (default 3); retry now only applies to retryable failures, non-retryable failures enter `dead-letter` immediately
- Basic PnL trend proxy: tracks stable collateral total delta before/after each successful rebalance
- Multi-chain UX skeleton: draft/action-console supports `near|bsc` selector
- BSC mode supports quote+minOut planning for `rebalance_usdt_to_usdce_txn` (`chain=bsc`), and can execute in two built-in adapter modes:
  - includes stable-yield agent v1 APIs:
    - `GET /api/bsc/yield/plan`
    - `POST /api/bsc/yield/execute` (`confirm=true`)
    - `POST /api/bsc/yield/worker/start` (`confirm=true`, `dryRun` default true)
    - `POST /api/bsc/yield/worker/stop` (`confirm=true`)
    - `GET /api/bsc/yield/worker/status`
  - `BSC_EXECUTE_MODE=native` (recommended): uses in-process native RPC signer path with `BSC_EXECUTE_PRIVATE_KEY`
  - `BSC_EXECUTE_MODE=command`: uses `BSC_EXECUTE_COMMAND` template placeholders `{amountInRaw} {minAmountOutRaw} {tokenIn} {tokenOut} {router} {rpcUrl} {chainId} {runId}`
  - `BSC_EXECUTE_MODE=auto` (default): prefer native when key exists, otherwise command
  - when configured, response returns `mode=execute` with `txHash` and BscScan link; otherwise explicit `mode=plan-only`
  - quote now supports dual-source validation (Dexscreener + onchain router), returns conservative quote, and enforces divergence guard
  - native mode includes post-trade reconciliation fields (`tokenInDeltaRaw`, `tokenOutDeltaRaw`, `reconcileOk`, `minAmountOutRaw`) in receipt
  - execute failures are normalized as `BSC_EXECUTE_FAILED retryable=true|false ...` for async retry/dead-letter classification
- Optional alert push on rollback/failure/reconcile-warning:
  - `NEAR_REBAL_ALERT_WEBHOOK_URL`
  - `NEAR_REBAL_ALERT_TELEGRAM_BOT_TOKEN`
  - `NEAR_REBAL_ALERT_TELEGRAM_CHAT_ID`
  - `NEAR_REBAL_ALERT_SUCCESS=true` (send success/info alerts)
  - `NEAR_REBAL_ALERT_DEDUPE_MS=300000` (same-alert dedupe window)
- Dashboard alert test endpoint/button:
  - API: `POST /api/alerts/test` (requires `confirm=true`)
  - UI: `Action Console -> Test alerts`
- Rebalance risk guards (env-tunable): max amount, min quote out, max slippage, cooldown, and daily execution cap (`NEAR_REBAL_*`)
  - `NEAR_REBAL_MAX_AMOUNT_RAW` (default `5000000`)
  - `NEAR_REBAL_MIN_QUOTE_OUT_RAW` (default `500000`)
  - `NEAR_REBAL_MAX_SLIPPAGE_BPS` (default `100`)
  - `NEAR_REBAL_MIN_EFFECTIVE_RATE` (default `0.5`, blocks poor quote quality)
  - `NEAR_REBAL_COOLDOWN_SECONDS` (default `120`)
  - `NEAR_REBAL_DAILY_MAX` (default `6`)
- CSV export for latest snapshot
- Best-effort USD estimates from NEAR Intents token feed

## Start

From repository root:

```bash
npm run dashboard:start
```

Open:

- `http://127.0.0.1:4173`

## Optional environment variables

- `NEAR_ACCOUNT_ID` - default account loaded in UI (fallback: `davirain8.near`)
- `NEAR_RPC_URL` - single JSON-RPC endpoint
- `NEAR_RPC_URLS` - comma-separated RPC list with automatic 429 fallback (recommended)
- `NEAR_RPC_RETRY_ROUNDS` - extra retry rounds across endpoint list for transient 429/5xx (default: `2`)
- `NEAR_RPC_RETRY_BASE_MS` - backoff base in milliseconds between retry rounds (default: `250`)
- `NEAR_RPC_WARMUP_CALLS` - cold-start rotation call count before score-based routing (default: `max(2, rpcCount*2)`)
- `NEAR_RPC_ALERT_RETRY_RATE` - warn-alert threshold for retry rate (default: `0.2`)
- `NEAR_RPC_ALERT_429_COUNT` - warn-alert threshold for cumulative HTTP 429 count (default: `10`)
- `NEAR_DASHBOARD_PORT` - web port (fallback: `4173`)
- `ACP_BIN` - ACP CLI binary name/path (default: `acp`)
- `ACP_WORKDIR` - working directory to run ACP CLI from (default: current repo root)
- `NEAR_DASHBOARD_METRICS_PATH` - metrics persistence path (default: `apps/dashboard/data/rebalance-metrics.json`)
- `NEAR_DASHBOARD_POLICY_PATH` - policy persistence path (default: `apps/dashboard/data/portfolio-policy.json`)
- `NEAR_DASHBOARD_MARKETPLACE_PATH` - strategy marketplace persistence path (default: `apps/dashboard/data/strategy-marketplace.json`)
- `BSC_EXECUTE_ENABLED` - enable BSC execute adapter path (`true|false`, default: `false`)
- `BSC_EXECUTE_MODE` - `auto|native|command` (default: `auto`)
- `BSC_EXECUTE_PRIVATE_KEY` - private key for native BSC executor signer (used by `native`/`auto` mode)
- `BSC_EXECUTE_RECIPIENT` - optional recipient for BSC swap output (default signer address)
- `BSC_EXECUTE_CONFIRMATIONS` - receipt confirmation count for native mode (default: `1`)
- `BSC_EXECUTE_GAS_BUMP_PERCENT` - gas bump percentage over fee data for native mode (default: `15`)
- `BSC_EXECUTE_NONCE_RETRY` - nonce/underpriced retry count for native mode (default: `1`)
- `BSC_QUOTE_MAX_DIVERGENCE_BPS` - max allowed quote divergence between Dexscreener and onchain router (default: `800`)
- `BSC_EXECUTE_COMMAND` - command template for command-mode BSC swap execution (supports placeholders listed above)
- Worker runtime options (request payload, not env): `dryRun`, `intervalMs`, `targetUsdcBps`, `minDriftBps`, `maxStepUsd`
- `ACP_DISMISSED_PURGE_ENABLED` - enable automatic dismissed-archive purge scheduler (`true|false`, default: `false`)
- `ACP_DISMISSED_PURGE_DAYS` - purge threshold in days for dismissed jobs (default: `7`)
- `ACP_DISMISSED_PURGE_INTERVAL_MS` - purge scheduler interval in milliseconds (default: `21600000` = 6h)
- `PAYMENT_WEBHOOK_SECRET` - optional HMAC secret for `/api/payments/webhook` signature verification (`sha256=<hex>`)
- `PAYMENT_WEBHOOK_PROVIDER` - default webhook provider schema (`generic|ping|x402`, default `generic`)

Example:

```bash
NEAR_ACCOUNT_ID=davirain8.near NEAR_RPC_URL=https://1rpc.io/near npm run dashboard:start
```

## Notes

- This dashboard is read-only and intended for monitoring.
- For strategy execution, continue using OpenClaw tools/workflows with explicit confirmations.
- If RPC returns `429 Too Many Requests`, switch to a less congested endpoint via `NEAR_RPC_URL`.
