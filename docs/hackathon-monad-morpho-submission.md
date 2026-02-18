# Monad × Morpho Hackathon Submission Template

> Draft for rapid submission. Replace placeholders before final submit.

---

## 1) Project Name

**Pi Chain Tools — Monad Stable Yield Agent (Morpho Edition)**

---

## 2) One-line Pitch

An AI-powered stable yield agent on Monad that discovers Morpho opportunities, proposes risk-aware allocations, executes onchain actions, and provides reproducible ops-grade evidence.

---

## 3) What We Built

We built a practical autonomous yield workflow tailored for Morpho on Monad:

- **Read**: fetch market opportunities and portfolio state.
- **Plan**: generate target allocation with risk/policy limits.
- **Execute**: run confirmed onchain actions (deposit/rebalance path).
- **Reconcile**: produce execution artifact + reconciliation summary.
- **Operate**: monitor reliability, failures, and incident-ready summaries in dashboard.

Key design principles:
- reproducibility first,
- verifiable onchain proof,
- guarded execution (confirm/risk limits),
- audit-friendly outputs.

---

## 4) Track

Recommended:
- **Agent** (primary)
- **DeFi** (secondary)

---

## 5) Onchain Proof (Required)

> Replace with real Monad tx hashes / explorer links.

- Network: `Monad`
- Transactions:
  - `0x...` (Morpho deposit)
  - `0x...` (rebalance/adjust)
  - `0x...` (optional second scenario)

Explorer links:
- `https://.../tx/0x...`
- `https://.../tx/0x...`

---

## 6) Demo (Required)

- Demo URL: `https://...`
- Demo should show:
  1. market read + plan generation,
  2. confirmed onchain execution,
  3. reconciliation + reliability panel update.

---

## 7) Repository (Required)

- Repo: `https://github.com/DaviRain-Su/pi-chain-tools`
- Submission commit/tag: `main @ <commit-hash>`

---

## 8) Reproduction Steps (Required)

## Prerequisites

- Node.js 20+
- npm
- Monad RPC endpoint
- funded wallet/private key for test execution

## Setup

```bash
git clone https://github.com/DaviRain-Su/pi-chain-tools.git
cd pi-chain-tools
npm install
```

Set env/config (example placeholders):

```bash
export MONAD_RPC_URL=https://...
export MONAD_CHAIN_ID=...
export MONAD_EXECUTE_ENABLED=true
export MONAD_EXECUTE_PRIVATE_KEY=0x...
export MORPHO_MARKET_ID=...
```

Run verification:

```bash
npm run check
npm test
```

Run dashboard/service:

```bash
npm run dashboard:start
# open http://127.0.0.1:4173
```

Execute one scenario, capture tx hash, and include it in submission.

---

## 9) AI Build Log (Bonus)

AI was used to accelerate implementation and hardening:

- endpoint/protocol adapter iteration,
- test generation and regression protection,
- ops reliability features (failure signatures + quick-fix hints),
- docs/runbook synchronization.

---

## 10) Why This Is Different

This is not only a strategy simulator: it emphasizes **real onchain execution + reproducibility + operational visibility**, so judges can verify both technical depth and practical usability.

---

## 11) Compliance Checklist

- [ ] onchain tx hash(es) included
- [ ] demo link works
- [ ] repo is public
- [ ] reproduction instructions are clear
- [ ] no disallowed token-launch behavior during event window

---

## 12) Short Blurb (Copy/Paste)

Pi Chain Tools Monad Stable Yield Agent uses AI to discover and execute Morpho-based yield opportunities with risk-aware guardrails, onchain verifiability, and reproducible operations. The submission includes public code, real tx proofs, and a runnable demo flow.
