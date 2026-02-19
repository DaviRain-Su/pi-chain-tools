# Final Release Notes (SDK-First + Sol-Agent Integration)

## Summary
This release cycle moved `pi-chain-tools` from feature-complete prototype to submission-ready, operator-safe execution platform across Monad, BSC, and Solana integration surfaces.

## Major outcomes

### 1) SDK-first architecture hardening
- Monad + Morpho upgraded to SDK-first paths with explicit non-SDK markers and fallback behavior.
- BSC Venus / Lista / Wombat paths consolidated into SDK-first + canonical client execution where official executor SDKs are unavailable.
- Coverage reporting finalized with machine-readable + human-readable matrices:
  - `docs/sdk-coverage-report.json`
  - `docs/sdk-coverage-report.md`

Current coverage status:
- 🟩 Green: 7
- 🟨 Yellow: 6
- 🟥 Red: 0

### 2) Evidence + demo automation
- Added `npm run submission:evidence` to generate submission artifact docs.
- Added guarded one-click demo runner:
  - `npm run demo:monad-bsc`
  - defaults to safe mode (no accidental execute)

### 3) CI and ops stability improvements
- Deterministic runtime-metrics normalization integrated into check flow.
- Resilient CI classification/retry for SIGTERM/interruption signatures.
- New dashboard process controls:
  - `npm run dashboard:restart`
  - `npm run dashboard:ensure`
- Added `npm run ops:smoke` for cron-friendly health verification.

### 4) Security posture updates
- Preserved `check/security:check/test` quality gates during SDK expansion.
- Reduced direct security risk from Wombat dependency chain via safer dependency boundary policy.
- Runbook updated with remediation and exception-handling policy.

### 5) Sol-Agent integration (phased, safety-first)
- Added integration plan:
  - `docs/sol-agent-integration-plan.md`
- Added risk boundary policy:
  - `docs/sol-agent-risk-boundary.md`
- Implemented Phase A/B/C with strict no-bypass guarantees:
  - read/plan bridge scaffold
  - registry mapping to existing handlers
  - safe-mode orchestration wrappers (execute/mutate rejected)

## What remains (intentional yellow items)
Remaining yellow rows are blocked by upstream SDK/public executor availability, not by internal integration debt:
- Morpho execute: no public official tx signer/executor pipeline
- Venus execute: no public official execute signer SDK surface
- Lista: no maintained official npm SDK package
- Wombat execute: no official execute SDK parity surface

## Recommended next step
When upstream SDK executor surfaces become available, promote yellow rows via existing detector-hook/runbook process and update `sdk-coverage-report` statuses.
