# Multi-Mono Migration (Federation) Plan

This repo is entering a transition from single-repo accumulation to a federated multi-repo model.

## Why now

- Chain adapters are growing quickly across EVM / Solana / NEAR / Sui / Starknet.
- Strategy products have distinct release/deploy cadences.
- CI noise and toolchain coupling increase as unrelated domains share one install/test lane.

## Immediate action (implemented)

- Added planner script: `npm run arch:federation:plan`
- Added scaffold generator: `npm run arch:federation:scaffold`
- Generates machine-readable plan at:
  - default: `docs/architecture/repo-federation-plan.json`
  - override: `FEDERATION_PLAN_OUTPUT_PATH=/tmp/plan.json`
- Generates repo bootstrap templates at:
  - default: `docs/architecture/federation-scaffold/`
  - override: `FEDERATION_SCAFFOLD_OUTPUT_DIR=/tmp/federation-scaffold`

## Phased rollout

1. **Core extraction**
   - shared interfaces/types/policy contracts (`w3rt-core`)
2. **Chain split**
   - one repo per chain family (`chain-*-tools`)
3. **Strategy split**
   - one repo per autonomous strategy product
4. **Composition layer**
   - unified plugin loader + dashboard integration

## Guardrails

- Keep `pi-chain-tools` as transition monolith until target repos have passing CI.
- Prioritize package-boundary extraction before git-history split.
- Preserve live-execution safeguards and policy checks across all split repos.
