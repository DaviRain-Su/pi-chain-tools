# Monad × Morpho Hackathon Submission

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
- **Execute**: run confirmed onchain actions (deposit/rebalance path) with execute guards.
- **Reconcile**: produce execution artifact + reconciliation summary.
- **Operate**: monitor reliability, rewards tracking, failures, and incident-ready summaries in dashboard.

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

## 5) Onchain Proof

- Network: `Monad`
- Proof artifact source: `docs/submission-evidence.md`

### Required before submission (blocking)

- [ ] Add at least 1 real Monad tx hash
- [ ] Add 2-3 tx hashes total if available (deposit/rebalance/reconcile coverage)
- [ ] Add explorer links for each hash
- [ ] Ensure each hash matches the described action

---

## 6) Demo

- Local demo base: `http://127.0.0.1:4173`
- Suggested demo flow:
  1. market read + plan generation,
  2. confirmed onchain execution,
  3. reconciliation + reliability panel update.

### Required before submission (blocking)

- [ ] Replace with public live or recorded demo URL

---

## 7) Repository

- Repo: `https://github.com/DaviRain-Su/pi-chain-tools`
- Submission branch: `main`
- Submission commit: `8107ba4b97b3dd58dcc72cef788e66cd6f0df071`

---

## 8) Reproduction Steps

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

Set env/config (example values):

```bash
export MONAD_RPC_URL=https://rpc.monad.xyz
export MONAD_CHAIN_ID=143
export MONAD_EXECUTE_ENABLED=true
export MONAD_EXECUTE_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HEX
export MONAD_MORPHO_VAULT=0xYOUR_TARGET_VAULT_ADDRESS
export MONAD_MORPHO_ASSET=0xYOUR_TARGET_ASSET_ADDRESS
export MONAD_MORPHO_MAX_AMOUNT_RAW=1000000000000000000000
export MONAD_MORPHO_COOLDOWN_SECONDS=30
export MONAD_MORPHO_DAILY_CAP_RAW=5000000000000000000000
export MONAD_MORPHO_REWARDS_JSON='[{"vault":"0xYOUR_TARGET_VAULT_ADDRESS","rewardToken":"0xYOUR_REWARD_TOKEN_ADDRESS","claimableRaw":"0"}]'
# optional claim execution wiring (safe default disabled)
export MONAD_MORPHO_REWARDS_CLAIM_ENABLED=false
export MONAD_MORPHO_REWARDS_CLAIM_COMMAND=''
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

## 11) Submission Compliance

- [x] Repo is public
- [x] Reproduction instructions are clear
- [x] No token-launch mechanics in scope
- [ ] Onchain tx hash(es) included
- [ ] Demo link works

---

## 12) Short Blurb (Copy/Paste)

Pi Chain Tools Monad Stable Yield Agent uses AI to discover and execute Morpho-based yield opportunities with risk-aware guardrails, onchain verifiability, and reproducible operations. The submission includes public code, real tx proofs, and a runnable demo flow.
