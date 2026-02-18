# Monad Morpho v1.2 Advanced Polish Notes

## New APIs
- `GET /api/monad/morpho/earn/strategy`
- `POST /api/monad/morpho/worker/start`
- `POST /api/monad/morpho/worker/stop`
- `GET /api/monad/morpho/worker/status`

## Strategy scorer
Scorer computes normalized factor scores per vault:
- APY factor (`apyBps`)
- Liquidity factor (`tvlRaw`)
- Risk factor (`risk.score`, inverse)

Weights (env/config):
- `MONAD_MORPHO_WEIGHT_APY` (default `0.5`)
- `MONAD_MORPHO_WEIGHT_LIQUIDITY` (default `0.3`)
- `MONAD_MORPHO_WEIGHT_RISK` (default `0.2`)

## Worker guardrails
- Dry-run by default
- Minimum interval clamp (`MONAD_MORPHO_WORKER_MIN_INTERVAL_MS`, default 30000)
- Writes decision traces into action history as `monad_morpho_worker_tick`

## Replay/pressure pack
Run:
```bash
npm run monad:morpho:replay
```
Output:
- `apps/dashboard/data/monad-morpho-replay-trend.json`

Contains deterministic scenario outcomes (success/failure/retry) and reliability trend summary.

## Rewards claim hardening
- Enforces vault address validation
- Executes through `bash -lc` command template only after config gate
- Adds reconciliation + telemetry payload to response/action history
