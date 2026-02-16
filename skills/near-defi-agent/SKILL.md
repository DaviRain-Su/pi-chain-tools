---
name: near-defi-agent
description: >
  Autonomous DeFi agent for NEAR Protocol. Covers stablecoin yield optimization on Burrow,
  token transfers, Ref Finance swaps and LP, NEAR Intents cross-chain, and Burrow lending.
  Use this skill when interacting with NEAR blockchain, managing DeFi positions, or running
  autonomous yield strategies. Provides step-by-step playbooks for OpenClaw orchestration.
---

# NEAR DeFi Agent Skill

Autonomous DeFi agent for NEAR Protocol — stablecoin yield optimization, lending, swaps, and cross-chain operations via structured MCP tools.

## Prerequisites

### 1. Install pi-chain-tools

```bash
pi install https://github.com/DaviRain-Su/pi-chain-tools
```

After install, reload extensions — all 43 NEAR tools become available.

### 2. Environment Setup

```bash
# Required for execute operations
export NEAR_ACCOUNT_ID=your-account.near
export NEAR_PRIVATE_KEY=ed25519:...

# Recommended: use fastnear RPC (higher rate limits than public RPC)
export NEAR_MAINNET_RPC_URL=https://free.rpc.fastnear.com

# Optional: webhook for autonomous worker notifications
export NEAR_YIELD_WORKER_WEBHOOK_URL=https://your-webhook.example.com

# Optional: custom testnet RPC
export NEAR_TESTNET_RPC_URL=https://rpc.testnet.near.org
```

### 3. Verify Setup

```
near_getBalance({ accountId: "your-account.near", network: "mainnet" })
```

If this returns a balance, you're ready.

---

## Tool Inventory (43 tools)

### Read Tools (no credentials needed)

| Tool | Purpose |
|------|---------|
| `near_getBalance` | Native NEAR balance |
| `near_getAccount` | Account state (storage, code hash) |
| `near_getFtBalance` | NEP-141 token balance |
| `near_getPortfolio` | Multi-token portfolio with USD valuation |
| `near_getLendingMarketsBurrow` | Burrow lending markets (APR, utilization) |
| `near_getLendingPositionsBurrow` | Burrow position snapshot (supplied/borrowed/health) |
| `near_getStableYieldPlan` | **Ranked stablecoin yield candidates** — core of yield strategy |
| `near_getRefDeposits` | Ref Finance deposited balances |
| `near_getRefLpPositions` | Ref LP share positions |
| `near_getSwapQuoteRef` | Ref swap quote (best route) |
| `near_getIntentsTokens` | NEAR Intents supported assets |
| `near_getIntentsQuote` | Cross-chain swap quote |
| `near_getIntentsStatus` | Intents execution status |
| `near_getIntentsExplorerTransactions` | Intents transaction history |
| `near_getIntentsAnyInputWithdrawals` | ANY_INPUT withdrawal records |

### Execute Tools (require credentials)

| Tool | Purpose |
|------|---------|
| `near_transferNear` | Send NEAR |
| `near_transferFt` | Send NEP-141 tokens |
| `near_supplyBurrow` | Supply token to Burrow (+ auto collateral) |
| `near_borrowBurrow` | Borrow from Burrow |
| `near_repayBurrow` | Repay Burrow debt |
| `near_withdrawBurrow` | Withdraw from Burrow |
| `near_swapRef` | Execute Ref Finance swap |
| `near_addLiquidityRef` | Add LP to Ref pool |
| `near_removeLiquidityRef` | Remove LP from Ref pool |
| `near_withdrawRefToken` | Withdraw deposited tokens from Ref |
| `near_submitIntentsDeposit` | Submit deposit for NEAR Intents swap |
| `near_broadcastSignedTransaction` | Broadcast pre-signed transaction |

### Autonomous Worker

| Tool | Purpose |
|------|---------|
| `near_yieldWorkerStart` | Start autonomous yield optimization loop |
| `near_yieldWorkerStop` | Stop a running worker |
| `near_yieldWorkerStatus` | Worker state + decision audit trail |

### Workflow Engine

| Tool | Purpose |
|------|---------|
| `w3rt_run_near_workflow_v0` | Unified analysis→compose→simulate→execute pipeline |

### Compose Tools (build unsigned transactions)

| Tool | Purpose |
|------|---------|
| `near_buildTransferNearTransaction` | Unsigned NEAR transfer |
| `near_buildTransferFtTransaction` | Unsigned FT transfer |
| `near_buildSupplyBurrowTransaction` | Unsigned Burrow supply |
| `near_buildBorrowBurrowTransaction` | Unsigned Burrow borrow |
| `near_buildRepayBurrowTransaction` | Unsigned Burrow repay |
| `near_buildWithdrawBurrowTransaction` | Unsigned Burrow withdraw |
| `near_buildSwapRefTransaction` | Unsigned Ref swap |
| `near_buildAddLiquidityRefTransaction` | Unsigned Ref add liquidity |
| `near_buildRemoveLiquidityRefTransaction` | Unsigned Ref remove liquidity |
| `near_buildRefWithdrawTransaction` | Unsigned Ref withdraw |
| `near_buildIntentsSwapDepositTransaction` | Unsigned Intents deposit |

### RPC

| Tool | Purpose |
|------|---------|
| `near_rpc` | Raw NEAR JSON-RPC (write methods blocked by default) |

---

## Playbooks

### Playbook 1: Check Portfolio & DeFi Positions

**When to use:** User asks "what's in my NEAR wallet" or "show my DeFi positions"

```
Step 1: near_getPortfolio
  params: { accountId: "<user>", network: "mainnet" }
  → Shows NEAR + all FT balances with USD valuation

Step 2: near_getLendingPositionsBurrow
  params: { accountId: "<user>", network: "mainnet" }
  → Shows Burrow supplied/borrowed/collateral with health factor

Step 3: near_getRefDeposits
  params: { accountId: "<user>", network: "mainnet" }
  → Shows tokens deposited in Ref exchange

Step 4: near_getRefLpPositions
  params: { accountId: "<user>", network: "mainnet" }
  → Shows Ref LP positions
```

Present results as a unified DeFi dashboard.

---

### Playbook 2: Stablecoin Yield Optimization (One-Shot)

**When to use:** User asks "optimize my stablecoin yield" or "where should I put my USDC"

**Phase 1 — Analyze:**

```
Step 1: Scan markets
  near_getStableYieldPlan
  params: { network: "mainnet", topN: 5 }
  → Returns ranked stablecoin candidates with APR

Step 2: Check current position
  near_getLendingPositionsBurrow
  params: { accountId: "<user>", network: "mainnet" }
  → Shows what user currently has supplied

Step 3: Present recommendation
  Compare current APR vs best available.
  If improvement > 0.5%, recommend rebalance.
  Show risk assessment from yield plan.
```

**Phase 2 — Execute (with user confirmation):**

```
Step 4: If rebalancing — withdraw current position
  w3rt_run_near_workflow_v0
  params: {
    intentType: "near.lend.burrow.withdraw",
    runMode: "analysis",
    network: "mainnet",
    tokenId: "<current-token>",
    amountRaw: "<amount>"
  }
  → Review analysis, get confirmToken

Step 5: Confirm and execute withdraw
  w3rt_run_near_workflow_v0
  params: {
    runMode: "execute",
    network: "mainnet",
    confirmMainnet: true,
    confirmToken: "<from step 4>"
  }

Step 6: Supply to better market
  w3rt_run_near_workflow_v0
  params: {
    intentType: "near.lend.burrow.supply",
    runMode: "analysis",
    network: "mainnet",
    tokenId: "<best-candidate-token>",
    amountRaw: "<amount>"
  }
  → Review analysis, get confirmToken

Step 7: Confirm and execute supply
  w3rt_run_near_workflow_v0
  params: {
    runMode: "execute",
    network: "mainnet",
    confirmMainnet: true,
    confirmToken: "<from step 6>"
  }
```

---

### Playbook 3: Autonomous Yield Worker (Continuous)

**When to use:** User asks "keep monitoring and optimizing my yield automatically"

**This is the autonomous agent — it keeps working after the user closes the tab.**

```
Step 1: Start worker
  near_yieldWorkerStart
  params: {
    network: "mainnet",
    accountId: "<user>",
    dryRun: true,              ← Start in observe-only mode
    intervalSeconds: 300,      ← Check every 5 minutes
    minAprDelta: 0.5,          ← Only rebalance if improvement > 0.5%
    webhookUrl: "<webhook>"    ← Notifications
  }

Step 2: Monitor (periodic or on-demand)
  near_yieldWorkerStatus
  params: { network: "mainnet", accountId: "<user>" }
  → Shows cycle count, last decision, audit trail

Step 3: Switch to live mode (when user confirms)
  near_yieldWorkerStop
  params: { network: "mainnet", accountId: "<user>" }

  near_yieldWorkerStart
  params: {
    network: "mainnet",
    accountId: "<user>",
    dryRun: false,             ← Now actually executes
    intervalSeconds: 300,
    minAprDelta: 0.5,
    webhookUrl: "<webhook>"
  }

Step 4: Stop when done
  near_yieldWorkerStop
  params: { network: "mainnet", accountId: "<user>" }
```

**Worker decision cycle:**
```
scan Burrow stablecoin markets
  → read current position
    → compare APR (current vs best)
      → HOLD (already optimal or delta below threshold)
      → REBALANCE (withdraw current + supply new)
      → SUPPLY (no current position, first-time supply)
        → webhook notify
          → wait interval → repeat
```

---

### Playbook 4: Token Swap on Ref Finance

**When to use:** User asks "swap X for Y on NEAR"

```
Step 1: Get quote
  near_getSwapQuoteRef
  params: {
    tokenInId: "NEAR",       ← Symbols or contract IDs
    tokenOutId: "USDC",
    amountInRaw: "1000000000000000000000000",  ← 1 NEAR in yocto
    network: "mainnet"
  }

Step 2: Review and execute via workflow
  w3rt_run_near_workflow_v0
  params: {
    intentType: "near.swap.ref",
    runMode: "analysis",
    network: "mainnet",
    tokenInId: "NEAR",
    tokenOutId: "USDC",
    amountInRaw: "1000000000000000000000000"
  }

Step 3: Execute with confirmation
  w3rt_run_near_workflow_v0
  params: {
    runMode: "execute",
    network: "mainnet",
    confirmMainnet: true,
    confirmToken: "<from analysis>"
  }
```

**Natural language shortcut:**
```
w3rt_run_near_workflow_v0
params: {
  intentText: "swap 1 NEAR for USDC on Ref",
  runMode: "analysis",
  network: "mainnet"
}
```

---

### Playbook 5: Burrow Lending (Supply + Borrow)

**When to use:** User asks "lend my USDC on Burrow" or "borrow against my position"

```
Step 1: Check available markets
  near_getLendingMarketsBurrow
  params: { network: "mainnet", limit: 10 }

Step 2: Supply collateral
  near_supplyBurrow
  params: {
    tokenId: "USDC",
    amountRaw: "1000000",     ← 1 USDC (6 decimals)
    asCollateral: true,
    network: "mainnet",
    confirmMainnet: true
  }

Step 3: Borrow (if desired)
  near_borrowBurrow
  params: {
    tokenId: "NEAR",
    amountRaw: "100000000000000000000000",  ← ~0.1 NEAR
    network: "mainnet",
    confirmMainnet: true
  }

Step 4: Monitor health factor
  near_getLendingPositionsBurrow
  params: { accountId: "<user>", network: "mainnet" }
```

---

### Playbook 6: Cross-Chain via NEAR Intents

**When to use:** User asks "bridge USDC from NEAR to Ethereum"

```
Step 1: Check available assets
  near_getIntentsTokens
  params: { symbol: "USDC" }
  → Shows USDC on all supported chains with assetIds

Step 2: Get quote
  near_getIntentsQuote
  params: {
    originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    destinationAsset: "USDC",
    amount: "1000000",
    blockchainHint: "eth",
    network: "mainnet"
  }

Step 3: Execute via workflow
  w3rt_run_near_workflow_v0
  params: {
    intentType: "near.swap.intents",
    runMode: "analysis",
    network: "mainnet",
    originAsset: "USDC",
    destinationAsset: "USDC",
    amountInRaw: "1000000",
    blockchainHint: "eth"
  }
```

---

## Safety Model

All execute operations follow a layered safety model:

| Layer | Mechanism | Default |
|-------|-----------|---------|
| **Workflow** | `analysis → simulate → execute` three-phase | Always |
| **Mainnet gate** | `confirmMainnet: true` required for mainnet execution | Blocked |
| **Replay protection** | `confirmToken` from analysis must match at execute | Required |
| **Risk profiling** | `riskBand` (low/medium/high) + `confirmRisk` | Auto |
| **Worker safety** | `dryRun: true` default, `paused` kill-switch | Safe |
| **Worker auto-pause** | Stops after `maxConsecutiveErrors` (default 5) | Enabled |
| **Tool-level** | Execute tools require explicit network param | Required |
| **RPC safety** | `near_rpc` blocks write methods unless `allowDangerous` | Blocked |

### Key Safety Rules for OpenClaw Orchestration

1. **Never skip analysis phase.** Always run `runMode: "analysis"` before `"execute"`.
2. **Pass confirmToken verbatim.** The token from analysis must be passed unchanged to execute.
3. **Start workers in dryRun mode.** Observe decisions before enabling live execution.
4. **Set webhookUrl.** Route notifications to your alert channel for autonomous operations.
5. **Use fastnear RPC.** Public NEAR RPC has strict rate limits that can cause worker errors.

---

## Natural Language Examples

The workflow engine supports natural language via `intentText`:

| User Says | Maps To |
|-----------|---------|
| "查看我的 NEAR 余额" | `near_getBalance` |
| "我在 Burrow 的仓位怎么样" | `near_getLendingPositionsBurrow` |
| "帮我找最好的稳定币收益" | `near_getStableYieldPlan` |
| "把 1 NEAR 换成 USDC" | `w3rt_run_near_workflow_v0` (near.swap.ref) |
| "在 Burrow 存入 10 USDC" | `w3rt_run_near_workflow_v0` (near.lend.burrow.supply) |
| "启动自动收益优化" | `near_yieldWorkerStart` |
| "检查 worker 状态" | `near_yieldWorkerStatus` |
| "把收益优化停掉" | `near_yieldWorkerStop` |
| "转 5 NEAR 给 bob.near" | `w3rt_run_near_workflow_v0` (near.transfer.near) |

---

## OpenClaw Cron Integration

For fully autonomous operation, set up an OpenClaw cron job:

```yaml
# OpenClaw playbook: NEAR Yield Monitor
name: near-yield-monitor
trigger: cron("*/5 * * * *")   # every 5 minutes
steps:
  - tool: near_yieldWorkerStatus
    params:
      network: mainnet
      accountId: "{{env.NEAR_ACCOUNT_ID}}"
    on_error: alert

  - tool: near_getStableYieldPlan
    params:
      network: mainnet
      topN: 3
    save_as: plan

  - condition: plan.details.selected != null
    then:
      - tool: near_getLendingPositionsBurrow
        params:
          network: mainnet
          accountId: "{{env.NEAR_ACCOUNT_ID}}"
        save_as: position
      - evaluate: |
          Compare position APR vs plan best APR.
          If delta > 0.5%, proceed to rebalance.
          Otherwise, log and exit.
```

Alternatively, use the built-in yield worker which handles the full loop internally:

```yaml
name: near-yield-autostart
trigger: once
steps:
  - tool: near_yieldWorkerStart
    params:
      network: mainnet
      accountId: "{{env.NEAR_ACCOUNT_ID}}"
      dryRun: false
      intervalSeconds: 300
      minAprDelta: 0.5
      webhookUrl: "{{env.WEBHOOK_URL}}"
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `429 Too Many Requests` | Set `NEAR_MAINNET_RPC_URL=https://free.rpc.fastnear.com` |
| `NEAR RPC error (-32000)` on testnet | Burrow only exists on mainnet; use `network: "mainnet"` |
| Worker shows `error_pause` | Check `near_yieldWorkerStatus` for last error. Usually RPC issues. Restart with `near_yieldWorkerStart`. |
| `confirmToken` mismatch | Must use same `runId` across analysis→execute phases |
| No NEAR_PRIVATE_KEY | Read-only tools work without credentials. Execute tools need `NEAR_PRIVATE_KEY`. |
| Account not found | Verify account exists with `near_getAccount` |
