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
- `NEAR_DASHBOARD_PORT` - web port (fallback: `4173`)

Example:

```bash
NEAR_ACCOUNT_ID=davirain8.near NEAR_RPC_URL=https://1rpc.io/near npm run dashboard:start
```

## Notes

- This dashboard is read-only and intended for monitoring.
- For strategy execution, continue using OpenClaw tools/workflows with explicit confirmations.
- If RPC returns `429 Too Many Requests`, switch to a less congested endpoint via `NEAR_RPC_URL`.
