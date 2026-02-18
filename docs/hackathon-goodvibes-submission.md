# Good Vibes Only: OpenClaw Edition（BSC）提交文档模板

> 赛事页面：<https://dorahacks.io/hackathon/goodvibes/detail>
>
> 本文档用于直接整理 DoraHacks 提交材料，覆盖：
> - Onchain proof
> - Demo + Repo + Repro steps
> - AI Build Log（加分项）

---

## 1) Project Name

**Pi Chain Tools — Stable Yield Agent (BSC + NEAR)**

---

## 2) One-line Pitch

An autonomous stable yield agent that can plan, execute, reconcile, and monitor cross-chain/BSC yield operations with production-style guardrails and onchain execution proof.

---

## 3) What we built

We built a practical **AI-driven stable yield agent** focused on real execution and ops visibility:

- **Autonomous strategy flow**: read market signals → plan → gated execution → post-action reconciliation.
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

## 4) Track

Recommended track(s):

- **Agent** (primary)
- **DeFi** (secondary)

---

## 5) Onchain proof (Required)

> Replace placeholders with your real BSC/opBNB proofs.

- Network: `BSC mainnet` / `opBNB`
- Key transaction hashes:
  - `0x...` (Lista native supply)
  - `0x...` (Wombat native deposit)
  - `0x...` (rebalance-related swap/supply flow)
- Optional contract addresses (if any):
  - `0x...`

Explorer links:
- <https://bscscan.com/tx/0x...>
- <https://bscscan.com/tx/0x...>
- <https://bscscan.com/tx/0x...>

---

## 6) Demo (Required)

- Live / recorded demo link:
  - `https://...`
- What demo shows (keep it short):
  1. Stable yield plan generation.
  2. Native BSC execution (Lista/Wombat path).
  3. Reconciliation and reliability/ops panel update.

---

## 7) Repository (Required)

- Repo URL:
  - `https://github.com/DaviRain-Su/pi-chain-tools`
- Branch/commit used for submission:
  - `main @ <commit-hash>`

---

## 8) How to reproduce (Required)

## Prerequisites

- Node.js 20+
- npm
- BSC RPC endpoint
- funded test account/private key (for real execution path)

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
export BSC_LISTA_POOL=0x...
export BSC_LISTA_EXECUTE_PRIVATE_KEY=0x...

# Wombat native
export BSC_WOMBAT_EXECUTE_ENABLED=true
export BSC_WOMBAT_EXECUTE_MODE=native
export BSC_WOMBAT_NATIVE_EXECUTE_ENABLED=true
export BSC_WOMBAT_POOL=0x...
export BSC_WOMBAT_EXECUTE_PRIVATE_KEY=0x...
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

## 11) Compliance checklist (before submit)

- [ ] At least one valid BSC/opBNB tx hash included
- [ ] Demo link works and shows end-to-end flow
- [ ] Repo is public
- [ ] Reproduction steps are clear and runnable
- [ ] No token launch / liquidity opening / airdrop pumping during event window
- [ ] Submission text includes what is built + how judged requirements are met

---

## 12) Quick copy (short DoraHacks blurb)

Pi Chain Tools Stable Yield Agent is an AI-powered DeFi agent that performs real onchain stable-yield operations with guardrails, reconciliation, and ops visibility. Our BSC execution paths run natively (Lista + Wombat), and the project includes reproducible setup, public repo, and onchain tx proofs.
