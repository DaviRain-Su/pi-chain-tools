# Monad × Morpho Build Plan (3-Day Sprint)

## Goal
Ship a hackathon-ready Monad stable yield agent using Morpho with:
- verifiable onchain execution,
- clear reproduction path,
- submission-ready docs/demo.

---

## Day 1 — Foundation + Read/Plan

## Deliverables
- Monad config surface (RPC/chain/account/keys).
- Morpho market read adapter (APR/capacity/basic health).
- Plan endpoint that outputs:
  - target allocation,
  - blockers,
  - fix hints,
  - suggested action.

## Acceptance
- `npm run check` and `npm test` pass.
- API can return a non-empty plan for at least one market.

---

## Day 2 — Execute + Reconcile

## Deliverables
- Execute endpoint for at least one real action path (deposit/rebalance).
- Confirm/risk gate (explicit confirm + amount bounds).
- Execution artifact + reconciliation output.
- Failure classification (`retryable` + category).

## Acceptance
- one successful onchain tx hash from test scenario,
- one failure-path scenario captured with normalized error,
- tests green.

---

## Day 3 — Ops + Submission Pack

## Deliverables
- Dashboard card(s): reliability summary + recent execution status.
- Incident/export helper text for quick judge verification.
- Submission docs completed:
  - `docs/hackathon-monad-morpho-submission.md`
  - demo script/checklist
- Final QA run and tagged commit.

## Acceptance
- `npm run check` ✅
- `npm test` ✅
- Demo link + tx proof + repro steps complete.

---

## Risk Controls (Must Keep)

- Confirm-gated execution only.
- No hidden auto-trading loop for hackathon demo.
- Guard max amount/slippage thresholds.
- Log all run ids and tx hashes for review.

---

## Demo Script (5–8 minutes)

1. Show market read and plan output.
2. Show blockers/hints handling.
3. Trigger confirmed execute.
4. Show tx hash on explorer.
5. Show reconciliation and reliability summary.
6. Show reproducibility commands from docs.

---

## Final Submission Checklist

- [ ] project description filled
- [ ] track selected (Agent/DeFi)
- [ ] onchain tx proof attached
- [ ] demo URL attached
- [ ] repo + commit hash attached
- [ ] reproduction instructions validated on clean environment
