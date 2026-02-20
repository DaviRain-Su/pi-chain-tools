# Hyperliquid Offchain-Orchestrator 3-Min Demo Script

## 0:00 - 0:30 Setup + safety gates
- Show `HYPERLIQUID_AUTONOMOUS_MODE=false` as default operating posture (offchain orchestrator).
- Show Hyperliquid execute binding envs (`*_EXECUTE_BINDING_ENABLED`, router/executor, command) as optional guarded seam.
- Mention hard gates: confirm text + max amount cap + cooldown/replay lock + panic stop.

## 0:30 - 1:30 Dryrun cycle proof
Run:

```bash
npm run autonomous:hyperliquid:cycle -- --mode dryrun --run-id demo-dryrun-001
```

Show artifact:
- `apps/dashboard/data/proofs/autonomous-cycle/latest.json`
- Fields: `mode`, `decision`, `txEvidence`, `reconcileSummary`.

## 1:30 - 2:30 Guarded live path
Use a configured live executor command and active binding (offchain trigger, onchain evidence capture):

```bash
export HYPERLIQUID_AUTONOMOUS_EXECUTE_ACTIVE=true
export HYPERLIQUID_AUTONOMOUS_CONFIRM_TEXT=HYPERLIQUID_EXECUTE_LIVE
export HYPERLIQUID_AUTONOMOUS_LIVE_COMMAND='your-real-executor --intent {intent}'

npm run autonomous:hyperliquid:cycle -- --mode live --run-id demo-live-001
```

Highlight that missing env/confirm/cap violation returns explicit `status=blocked`.

## 2:30 - 3:00 Submission bundle
Run one-command evidence regeneration:

```bash
npm run autonomous:evidence:regen
```

This regenerates cycle proof + preflight/readiness + bundle in one reproducible flow.

Show outputs:
- `apps/dashboard/data/proofs/autonomous-cycle/latest.json`
- `docs/submission-bundles/autonomous-hyperliquid/bundle.json`
- `docs/submission-bundles/autonomous-hyperliquid/bundle.md`

These now include tx hash, emitted events, state delta, and command sequence for audit replay.
