# Autonomous BSC Submission Bundle

- Generated: 2026-02-20T04:30:33.921Z
- Cycle mode: dryrun
- Cycle decision: simulate_execute
- Tx hash: n/a
- Reconcile: dryrun_only
- Live-test status: ok
- Core funding route: hyperliquid_earn_core
- Verifiable transition: no

## Onchain evidence

- Strategy contract: n/a
- Router contract: n/a
- Entry function: runDeterministicCycle((bytes32,uint256,uint256,address,address,bytes,bytes32,bool))
- Tx hash: n/a
- Emitted events: 0
- State delta: n/a
- ABI path: contracts/bsc-autonomous/artifacts/contracts/BscAutonomousStrategy.sol/BscAutonomousStrategy.json

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
- Contract architecture: docs/autonomous-contract-architecture.md

## Included artifacts

- /home/davirain/clawd/pi-chain-tools/apps/dashboard/data/proofs/autonomous-cycle/latest.json
- /home/davirain/clawd/pi-chain-tools/apps/dashboard/data/proofs/live-test/latest.json
- /home/davirain/clawd/pi-chain-tools/docs/mainnet-readiness-matrix.md
- /home/davirain/clawd/pi-chain-tools/contracts/bsc-autonomous/deployments/bscTestnet.latest.json
- contracts/bsc-autonomous/artifacts/contracts/BscAutonomousStrategy.sol/BscAutonomousStrategy.json

