# NEAR Innovation Sandbox — Submission: Autonomous Stablecoin Yield Agent

> **One job, end-to-end: an AI agent that continuously monitors NEAR DeFi lending markets and autonomously rebalances your stablecoin position to maximize yield — while you sleep.**

---

## The Problem

You hold stablecoins on NEAR. Burrow lending protocol offers variable APR across USDC, USDT, DAI, and others. Rates change daily. The optimal strategy — always keep your stablecoins in the highest-yielding market — requires:

1. Checking multiple markets regularly
2. Comparing your current position against alternatives
3. Deciding whether the improvement justifies a rebalance
4. Executing withdraw + re-supply transactions
5. Doing this every few hours, forever

**Nobody does this manually.** The yield difference between "set and forget" and "actively optimized" can be 1-3% APR — real money on any meaningful position.

## The Solution

**An autonomous yield optimization agent that runs as a background service.** It uses NEAR's Burrow lending protocol and a structured MCP (Model Context Protocol) tool layer to:

1. **Scan** all stablecoin lending markets on Burrow
2. **Read** your current supplied position
3. **Compare** your APR against the best available
4. **Decide** whether to rebalance (configurable threshold)
5. **Execute** withdraw-old → supply-new atomically
6. **Notify** you via webhook (routed to Telegram/Slack/Discord)
7. **Repeat** on a configurable interval (default: every 5 minutes)

The agent starts with one command and **keeps working after you close the tab.**

```
near_yieldWorkerStart({
  network: "mainnet",
  accountId: "alice.near",
  dryRun: false,           // or true for observe-only
  intervalSeconds: 300,    // check every 5 min
  minAprDelta: 0.5,        // rebalance if improvement > 0.5%
  webhookUrl: "https://your-webhook.example.com/notify"
})
```

That's it. The agent handles everything else autonomously.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User / Orchestrator                   │
│  "Start yield agent for alice.near on mainnet"          │
└─────────────────┬───────────────────────────────────────┘
                  │ near_yieldWorkerStart
                  ▼
┌─────────────────────────────────────────────────────────┐
│              Yield Worker (autonomous loop)              │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐           │
│  │  1. Scan  │──▶│ 2. Read  │──▶│ 3. Decide│           │
│  │  Markets  │   │ Position │   │  Action  │           │
│  └──────────┘   └──────────┘   └────┬─────┘           │
│                                      │                  │
│                      ┌───────────────┼───────────┐      │
│                      ▼               ▼           ▼      │
│                   [HOLD]        [REBALANCE]  [SUPPLY]   │
│                      │          withdraw old     │      │
│                      │          supply new        │      │
│                      ▼               ▼           ▼      │
│                 ┌──────────┐                            │
│                 │ 4.Notify │──▶ webhook → Telegram      │
│                 └──────────┘                            │
│                      │                                  │
│                      ▼                                  │
│                 wait 5 min → repeat                     │
└─────────────────────────────────────────────────────────┘
```

### Tool Layer (MCP)

The agent is built on a structured tool layer — 43 NEAR MCP tools covering the full DeFi stack:

| Category | Tools | Examples |
|----------|-------|---------|
| **Yield Worker** | 3 | `near_yieldWorkerStart`, `Stop`, `Status` |
| **Stable Yield Planning** | 1 | `near_getStableYieldPlan` — ranked APR scan |
| **Burrow Lending** | 11 | supply, borrow, repay, withdraw + compose + read |
| **Ref Finance** | 12 | swap, LP add/remove, withdraw + compose + read |
| **NEAR Intents** | 8 | cross-chain quotes, deposits, status tracking |
| **Core** | 5 | balance, account, FT balance, portfolio, transfer |
| **Workflow** | 1 | `w3rt_run_near_workflow_v0` — analysis→simulate→execute |
| **RPC** | 1 | raw JSON-RPC with safety guard |

Every tool is independently callable by any MCP-compatible AI agent. The yield worker composes them into an autonomous workflow.

---

## How It Matches the Challenge

### ✅ "Autonomous systems that keep working after the user closes the tab"

The yield worker is a long-running background process:
- Starts immediately, runs indefinitely
- Self-healing: auto-pauses after N consecutive errors, restartable
- Kill switch: `paused: true` halts all actions instantly
- Status inspection: `near_yieldWorkerStatus` shows full audit trail

### ✅ "Payments as part of the workflow, not a checkout screen"

Every on-chain action (supply, withdraw, swap, transfer) flows through the workflow engine:
- `analysis → simulate → execute` three-phase pipeline
- `confirmMainnet` safety gate for mainnet execution
- `confirmToken` replay protection
- `dryRun=true` default on all execute tools
- Risk profiling: `riskBand` (low/medium/high) + `confirmRisk` for dangerous operations

**Payments are not a separate step — they're embedded actions within a decision pipeline.**

### ✅ "One bounded job end-to-end"

The yield worker does exactly one job:
> Keep my stablecoins in the highest-yielding Burrow market at all times.

Clear boundaries:
- Only operates on configured stablecoin symbols (USDC, USDT, DAI, etc.)
- Only interacts with Burrow lending protocol
- Only rebalances when APR delta exceeds configured threshold
- Only notifies — never makes decisions outside its scope

### ✅ "Auditable and constrained"

Every cycle produces a structured audit log:

```json
{
  "cycleNumber": 42,
  "decision": {
    "action": "rebalance",
    "currentSymbol": "USDT",
    "currentApr": "3.10",
    "bestSymbol": "USDC",
    "bestApr": "4.25",
    "aprDelta": 1.15,
    "reason": "Better APR available: USDC at 4.25% vs current USDT at 3.10%"
  },
  "executed": true,
  "executionResult": {
    "actions": ["withdraw:usdt.token.near:USDT", "supply:usdc.token.near:USDC"]
  },
  "durationMs": 2340
}
```

The last 50 cycles are retained in-memory and inspectable via `near_yieldWorkerStatus`.

---

## Demo Flow (3 minutes)

### Step 1: Scan the market (30s)

```
Tool: near_getStableYieldPlan
Input: { network: "mainnet", topN: 5 }
Output: Ranked stablecoin candidates with APR, deposit/withdraw flags
```

### Step 2: Check current position (30s)

```
Tool: near_getLendingPositionsBurrow
Input: { network: "mainnet", accountId: "demo.near" }
Output: Supplied/borrowed assets, health factor, USD valuation
```

### Step 3: Start the autonomous agent (30s)

```
Tool: near_yieldWorkerStart
Input: {
  network: "mainnet",
  accountId: "demo.near",
  dryRun: true,
  intervalSeconds: 60,
  minAprDelta: 0.5
}
Output: "NEAR yield worker started. Mode: dry-run. Scanning USDC/USDT/DAI on Burrow."
```

### Step 4: Observe autonomous decisions (60s)

```
Tool: near_yieldWorkerStatus
Output: Cycle logs showing hold/rebalance decisions with APR comparisons
```

### Step 5: Show the full workflow pipeline (30s)

```
Tool: w3rt_run_near_workflow_v0
Input: { intentText: "在 Burrow 存入 1 USDC，先模拟", runMode: "simulate" }
Output: Simulation with risk profile, confirmToken for execution gate
```

---

## Safety Model

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| **Worker config** | `paused: true` | Instant kill switch |
| **Worker config** | `dryRun: true` (default) | Observe without executing |
| **Worker config** | `maxConsecutiveErrors: 5` | Auto-pause on persistent failures |
| **Worker config** | `minAprDelta: 0.5` | Don't rebalance for trivial improvements |
| **Workflow engine** | `confirmMainnet` | Explicit mainnet execution gate |
| **Workflow engine** | `confirmToken` | Replay protection |
| **Workflow engine** | `riskBand` + `confirmRisk` | High-risk operation gating |
| **Tool layer** | `dryRun=true` default | All execute tools preview-first |
| **Notification** | Webhook → any channel | User always knows what happened |

---

## Technical Stats

| Metric | Value |
|--------|-------|
| NEAR MCP tools | **43** |
| NEAR test cases | **194** |
| NEAR code (tools + runtime) | **~36,000 lines** |
| Total project tests | **910 across 55 files** |
| Supported protocols | Burrow lending, Ref Finance, NEAR Intents |
| Languages | TypeScript (strict mode) |
| CI gates | lint + typecheck + tests (all green) |

## Repository Structure

```
src/chains/near/
├── tools/
│   ├── yield-worker.ts          ← Autonomous yield optimization (746 lines)
│   ├── yield-worker.test.ts     ← 10 tests
│   ├── read.ts                  ← 16 read tools (5,928 lines)
│   ├── compose.ts               ← 11 compose tools (3,755 lines)
│   ├── execute.ts               ← 12 execute tools (3,133 lines)
│   ├── workflow.ts              ← Workflow engine (8,056 lines)
│   ├── workflow.test.ts         ← 93 workflow tests
│   └── rpc.ts                   ← Raw RPC tool
├── runtime.ts                   ← NEAR network config
├── toolset.ts                   ← Tool registration
└── ref.ts                       ← Ref Finance helpers
```

---

## What Makes This Different

**We didn't build a chatbot.** We built infrastructure.

Every tool in this project is a standalone, composable MCP endpoint. The yield worker is one composition of these tools — but the same tools can power:

- A portfolio dashboard that auto-discovers DeFi positions
- A risk monitor that alerts on health factor changes
- A cross-chain settlement agent using NEAR Intents
- A liquidity management agent for Ref Finance LP positions

The yield worker is the **"one bounded job"** we're submitting. The tool layer is the **platform** it runs on.

---

## Running It

```bash
# Install
npm install

# Verify everything works
npm run lint && npm run typecheck && npm test

# Start as MCP server (for AI agent integration)
npx pi-chain-tools

# Or use individual tools programmatically
```

### Environment Setup (NEAR)

```bash
# Account credentials (for execute tools)
NEAR_ACCOUNT_ID=your-account.near
NEAR_PRIVATE_KEY=ed25519:...

# Optional: webhook for notifications
NEAR_YIELD_WORKER_WEBHOOK_URL=https://your-webhook.example.com

# Optional: custom RPC
NEAR_RPC_URL=https://rpc.mainnet.near.org
```

---

## Future Direction (Post-Hackathon)

1. **Multi-protocol yield scanning** — Extend beyond Burrow to include other NEAR lending protocols as they launch
2. **Cross-chain yield optimization** — Use NEAR Intents to bridge stablecoins to higher-yielding chains and back
3. **User-owned strategy memory** — Store yield history and strategy preferences as portable, inspectable data
4. **Agent marketplace** — Publish yield strategies as composable MCP workflows that other agents can discover and subscribe to
5. **x402 / facilitator integration** — Per-cycle billing where each `simulate`/`execute` event is a meterable service call

---

## Team

**Gradience** — building AI-native blockchain infrastructure.

- Multi-chain runtime: Solana, Sui, NEAR, EVM (6 networks)
- 910 tests, 55 files, strict TypeScript
- Production-grade safety model (dual-layer: workflow gates + key-level policies)
