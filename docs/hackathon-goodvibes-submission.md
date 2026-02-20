# Good Vibes Only: OpenClaw Edition（BSC）提交文档

> 赛事页面：<https://dorahacks.io/hackathon/goodvibes/detail>

---

## 1) Project Name

**Pi Chain Tools — Stable Yield Agent (BSC + NEAR)**

---

## 2) One-line Pitch

An offchain orchestrator stable-yield agent that can plan, execute, reconcile, and monitor cross-chain/BSC yield operations with production-style guardrails and onchain execution evidence.

---

## 3) What we built

We built a practical **AI-driven stable yield agent** focused on real execution and ops visibility:

- **Offchain orchestrator flow**: read market signals → plan → gated execution → post-action reconciliation.
- **BSC native execution**:
  - Lista native RPC execution path (real onchain tx path).
  - Wombat native RPC execution path (real onchain tx path).
- **Risk and policy gates**:
  - confirm gate, entitlement/payment checks, execution blockers and fix hints.
- **Ops dashboard**:
  - execution quality, deBridge reliability, CI failure signature summaries, quick-fix suggestions.
- **Artifact + reconciliation contracts**:
  - standardized execution artifact and reconciliation objects for traceability and review.

---


### Operating model choice (explicit)

We intentionally ship this track as **offchain orchestrator + onchain execution evidence + guardrails** instead of requiring fully onchain autonomous triggering.

Why:
- faster iteration and incident response during hackathon operations,
- more reliable execution in mixed local/demo environments,
- stronger human/operator control (explicit confirm, caps, cooldown, panic stop, local-key custody).

## 4) Track

Recommended track(s):

- **Agent** (primary)
- **DeFi** (secondary)

---

## 5) Onchain proof

- Network: `BSC mainnet` / `opBNB`
- Proof artifact source: `docs/submission-evidence.md`

### Required before submission (blocking)

- [ ] Add at least one valid BSC/opBNB tx hash
- [ ] Add explorer link(s) for every tx hash
- [ ] If contract addresses are referenced, add verified address(es)
- [ ] Ensure described action and tx content are consistent

---

## 6) Demo

- Local demo base: `http://127.0.0.1:4173`
- Demo should show:
  1. stable yield plan generation,
  2. native BSC execution (Lista/Wombat path),
  3. reconciliation and reliability/ops panel update.

### Required before submission (blocking)

- [ ] Replace with public live/recorded demo link

---

## 7) Repository

- Repo URL: `https://github.com/DaviRain-Su/pi-chain-tools`
- Branch used for submission: `main`
- Commit used for submission: `8107ba4b97b3dd58dcc72cef788e66cd6f0df071`

---

## 8) How to reproduce

## Prerequisites

- Node.js 20+
- npm
- BSC RPC endpoint
- funded test account with **local file-based private key** (for real execution path)

## Setup

```bash
git clone https://github.com/DaviRain-Su/pi-chain-tools.git
cd pi-chain-tools
npm install
```

Prepare env/config (example keys):

```bash
# dashboard
export NEAR_DASHBOARD_PORT=4173

# BSC execution base
export BSC_EXECUTE_ENABLED=true
export BSC_CHAIN_ID=56
export BSC_RPC_URL=https://bsc-dataseed.binance.org

# Lista native
export BSC_LISTA_EXECUTE_ENABLED=true
export BSC_LISTA_EXECUTE_MODE=native
export BSC_LISTA_NATIVE_EXECUTE_ENABLED=true
export BSC_LISTA_POOL=0xYOUR_LISTA_POOL_ADDRESS
export BSC_LISTA_EXECUTE_PRIVATE_KEY="$(cat ~/.keys/pi-chain-tools/bsc-lista.key)"

# Wombat native
export BSC_WOMBAT_EXECUTE_ENABLED=true
export BSC_WOMBAT_EXECUTE_MODE=native
export BSC_WOMBAT_NATIVE_EXECUTE_ENABLED=true
export BSC_WOMBAT_POOL=0xYOUR_WOMBAT_POOL_ADDRESS
export BSC_WOMBAT_EXECUTE_PRIVATE_KEY="$(cat ~/.keys/pi-chain-tools/bsc-wombat.key)"
```

Run quality checks:

```bash
npm run check
npm test
```

Start dashboard:

```bash
npm run dashboard:start
# open http://127.0.0.1:4173
```

Execute BSC yield workflow via dashboard/API and capture tx hashes for proof.

---

## 9) AI Build Log (Bonus)

We used AI-assisted development heavily for rapid iteration and reliability hardening:

- AI-assisted endpoint and dashboard implementation.
- AI-assisted test generation and regression guard additions.
- AI-assisted ops hardening:
  - CI resilient retry strategy,
  - failure signature clustering,
  - actionable quick-fix hints.

Representative AI-assisted outcomes:

- Native Lista execution path landed.
- Native Wombat execution path landed.
- Reliability dashboards + copy/export incident helper flows landed.

---

## 10) Why this matters

Most hackathon demos stop at planning or simulated execution. This project emphasizes **real onchain execution + reproducibility + operator-grade observability**, making it usable beyond demo day.

---

## 11) Submission compliance

- [x] Repo is public
- [x] Reproduction steps are clear and runnable
- [x] No token launch / liquidity opening / airdrop pumping during event window
- [x] Submission text includes what is built + judged requirement coverage
- [ ] At least one valid BSC/opBNB tx hash included
- [ ] Demo link works and shows end-to-end flow

---

## 12) Quick copy (short DoraHacks blurb)

Pi Chain Tools Stable Yield Agent is an AI-powered DeFi agent that performs real onchain stable-yield operations with guardrails, reconciliation, and ops visibility. Our BSC execution paths run natively (Lista + Wombat), and the project includes reproducible setup, public repo, and onchain tx proofs.
