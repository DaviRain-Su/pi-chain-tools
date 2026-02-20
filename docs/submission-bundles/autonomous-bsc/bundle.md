# Autonomous BSC Submission Bundle

- Generated: 2026-02-20T02:16:29.159Z
- Cycle mode: dryrun
- Cycle decision: simulate_execute
- Tx hash: 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
- Reconcile: dryrun_only
- Live-test status: ok
- Core funding route: asterdex_earn_core
- Verifiable transition: yes

## Onchain evidence

- Tx hash: 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
- Emitted events: 1
- State delta: {"previousState":"IDLE","nextState":"EXECUTING","label":"IDLE->EXECUTING"}

## Reproducibility

- One command: `npm run autonomous:evidence:regen`
- `npm run autonomous:bsc:cycle -- --mode dryrun --run-id submission-proof-001`
- `npm run live:test:preflight`
- `npm run readiness:refresh`
- `npm run autonomous:submission:bundle`

## Key links

- Repo: https://github.com/davirain/pi-chain-tools
- Demo script: docs/autonomous-bsc-demo.md
- Readiness matrix: docs/mainnet-readiness-matrix.md

## Included artifacts

- /home/davirain/clawd/pi-chain-tools/apps/dashboard/data/proofs/autonomous-cycle/latest.json
- /home/davirain/clawd/pi-chain-tools/apps/dashboard/data/proofs/live-test/latest.json
- /home/davirain/clawd/pi-chain-tools/docs/mainnet-readiness-matrix.md

