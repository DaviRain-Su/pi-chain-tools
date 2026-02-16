# NEAR Dashboard (Local Web)

This is a lightweight local dashboard for quick visibility into your account state while running strategies.

## What it shows (current)

- NEAR wallet balance
- Tracked FT balances (USDt / USDC.e / USDC / wNEAR)
- Burrow registration + position rows (`collateral` / `supplied` / `borrowed`)
- Yield worker status (best-effort from latest local OpenClaw session log)
- Recent execution tx list (best-effort from latest local OpenClaw session log)
- Strategy view: current stable collateral APR ranking + quick recommendation
- Action Console: safe command builder for wrap/supply/worker start-stop (manual execution)
- Optional direct execution buttons for `wrap_near` and `supply_usdt_collateral` (requires browser confirm)
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
