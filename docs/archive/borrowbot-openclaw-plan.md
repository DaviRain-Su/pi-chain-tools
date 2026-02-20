# BorrowBot on OpenClaw — 基于现有 MCP 工具的实现方案

## 核心认知

BorrowBot 原版是一个全栈应用（Python FastAPI + React + Telegram）。
我们的路径不同：**pi-chain-tools 提供链上能力（MCP 工具），OpenClaw 提供编排 + 通知 + 前端**。

BorrowBot 的核心不是 UI/Telegram，而是这个循环：
```
读仓位 → LTV决策 → 执行操作 → 等待 → 循环
```
我们已经有 80% 的原子操作，缺的是把它们串成一个**可被 OpenClaw 编排的完整工作流**。

## 架构映射

```
BorrowBot 原版                    我们的方案
─────────────                    ─────────
FastAPI 后端服务     →  OpenClaw 编排器（定时触发工具调用）
PostgreSQL 数据库    →  OpenClaw 工单状态 + workflow session
CDP 钱包 + EIP-7702  →  Privy Agentic Wallet（已有）
ERC-4337 Paymaster   →  普通 EOA 交易（Privy 签名）⚠️ 用户需付 gas
ENS 治理             →  MCP 工具参数 (AgentConfig)（已有 ltv-manager.ts）
Telegram Bot         →  Webhook → OpenClaw → 任意通知渠道（已有）
React 前端           →  OpenClaw 前端
Gemini 对话          →  OpenClaw LLM agent（天然支持 MCP tool-calling）
```

## 现有组件状态 vs 需要的

| 能力 | 对应文件 | 状态 | 需要改什么 |
|------|---------|------|-----------|
| Morpho 市场读取 | `morpho-adapter.ts` getMarkets | ✅ 完成 | — |
| Morpho 仓位读取 | `morpho-adapter.ts` getAccountPosition | ✅ 完成 | — |
| LTV 决策引擎 | `ltv-manager.ts` decideLtvAction | ✅ 完成 | — |
| Worker 循环 | `agent-worker.ts` | ✅ 完成 | 需适配 Morpho（目前硬编码 Venus） |
| LI.FI 跨链报价 | `lifi-read.ts` | ✅ 完成 | — |
| LI.FI 跨链执行 | `lifi-execute.ts` | ✅ 完成 | — |
| Signer 抽象 | `signer-*.ts` | ✅ 完成 | — |
| Webhook 通知 | `agent-worker.ts` fireWebhook | ✅ 完成 | — |
| Privy Policy 模板 | `privy-policy.ts` | ✅ 完成 | 需加 Monad Morpho policy |
| **Morpho supply/borrow/repay/withdraw calldata** | `morpho-adapter.ts` | ❌ 占位符 | **P0: 需要填入真实 MarketParams** |
| **Morpho workflow (analysis→execute)** | 无 | ❌ 不存在 | **P0: 参照 venus-workflow.ts** |
| **Morpho execute tools (MCP)** | 无 | ❌ 不存在 | **P0: 参照 venus-execute.ts** |
| **ERC-4626 Vault deposit/withdraw** | 无 | ❌ 不存在 | **P1: 新建 vault-adapter.ts** |
| **Morpho BorrowBot workflow (MCP)** | 无 | ❌ 不存在 | **P1: 完整 borrow→vault→monitor 工作流** |
| Worker 支持多协议 | `agent-worker.ts` | ⚠️ 部分 | 需泛化（目前 Venus only） |
| Base 链 Morpho 部署 | 无 | ⚠️ 需要 | 加 Base Morpho 地址 |

## 实施计划（按优先级）

### P0: Morpho 真实 calldata（不做这个，链上什么都执行不了）

**问题**: `morpho-adapter.ts` 的 supply/borrow/repay/withdraw calldata 里 oracle/irm/collateralToken/lltv 全是 `0x000...` 占位符。

**解决**: Morpho Blue 的 MarketParams 可以从 GraphQL API 获取。需要：
1. `getMarkets()` 返回时已经拿到了 `oracleAddress` + `irmAddress`，存入 `market.extra`
2. calldata builder 接收完整的 MarketParams（从 market extra 传入）
3. 新增 `MorphoMarketParams` 参数到 supply/borrow/repay/withdraw tools

### P1: Morpho Execute Tools + Workflow

参照 `venus-execute.ts` + `venus-workflow.ts` 的模式：
- `evm_morphoSupply`: approve + supply calldata → sign → broadcast
- `evm_morphoBorrow`: borrow calldata → sign → broadcast
- `evm_morphoRepay`: approve + repay calldata → sign → broadcast
- `evm_morphoWithdraw`: withdraw calldata → sign → broadcast
- `evm_morphoSupplyCollateral`: supplyCollateral calldata → sign → broadcast
- `w3rt_run_evm_morpho_workflow_v0`: analysis → simulate → execute 三阶段

### P2: ERC-4626 Vault 集成

BorrowBot 借出 USDC 后存入 yield vault（40acres/YO）。需要：
- `vault-adapter.ts`: 通用 ERC-4626 deposit/withdraw/redeem
  - `deposit(assets)` → `0x6e553f65` 
  - `withdraw(assets)` → `0xb460af94`
  - `balanceOf(address)` → vault share 查询
  - `convertToAssets(shares)` → 实际价值
- MCP 工具: `evm_vaultDeposit`, `evm_vaultWithdraw`, `evm_vaultBalance`

### P3: BorrowBot 完整工作流 (OpenClaw Playbook)

一个 MCP 工具或 OpenClaw playbook 编排：
```
1. 接收用户存款（LI.FI 跨链 → Base/Monad）
2. supply collateral to Morpho (WETH/WBTC)
3. borrow USDC from Morpho
4. deposit USDC to yield vault
5. 启动 monitoring worker loop
6. 每个 cycle:
   a. 读 Morpho position (GraphQL)
   b. 读 vault balance
   c. LTV Manager 决策
   d. if repay: withdraw vault → repay Morpho
   e. if optimize: borrow more → deposit vault
   f. webhook 通知
7. 用户提现: vault withdraw → repay → withdraw collateral → LI.FI 跨链
```

### P4: Base 链支持

Morpho Blue 在 Base 上也有部署（`0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`）。
BorrowBot 原版运行在 Base 上。只需要把 Base 地址加入 `MORPHO_DEPLOYMENTS`。

## OpenClaw 编排模板

```yaml
workflow: borrowbot-cycle
trigger: cron("*/5 * * * *")  # 每5分钟
steps:
  - name: read_position
    tool: evm_morphoGetPosition
    args:
      network: base  # 或 monad
      account: "{{agent.wallet}}"
    
  - name: read_vault
    tool: evm_vaultBalance  # P2 新增
    args:
      network: base
      vaultAddress: "0x..."
      account: "{{agent.wallet}}"
  
  - name: decide
    tool: evm_ltvDecide  # 纯计算，基于 ltv-manager.ts
    args:
      collateralValueUsd: "{{read_position.totalCollateralValueUsd}}"
      borrowValueUsd: "{{read_position.totalBorrowValueUsd}}"
      supplyAPY: "{{read_vault.apy}}"
      borrowAPR: "{{read_position.borrowAPR}}"
      config:
        maxLTV: 0.75
        targetLTV: 0.60
        minYieldSpread: 0.02
        paused: false
  
  - name: execute_repay
    if: "decide.action == 'repay'"
    steps:
      - tool: evm_vaultWithdraw  # 从 vault 取出 USDC
        args: { ... }
      - tool: w3rt_run_evm_morpho_workflow_v0  # repay Morpho
        args:
          runMode: execute
          intentType: evm.morpho.repay
          ...
  
  - name: execute_optimize
    if: "decide.action == 'optimize'"
    steps:
      - tool: w3rt_run_evm_morpho_workflow_v0  # borrow more
        args:
          runMode: execute
          intentType: evm.morpho.borrow
          ...
      - tool: evm_vaultDeposit  # 存入 vault
        args: { ... }
  
  - name: notify
    tool: webhook
    args:
      url: "{{agent.webhookUrl}}"
      payload:
        event: cycle_complete
        action: "{{decide.action}}"
        ltv: "{{decide.currentLTV}}"
```

## 与 BorrowBot 原版的差异

| 维度 | BorrowBot 原版 | 我们的方案 |
|------|---------------|-----------|
| Gas | Paymaster 代付，用户零 gas | 用户/agent 付 gas |
| 钱包 | CDP EOA + EIP-7702 Smart Wallet | Privy MPC wallet |
| 治理 | ENS on-chain constitution | MCP 参数 (AgentConfig) |
| 通知 | Telegram Bot + Gemini 对话 | Webhook → OpenClaw → 任意渠道 |
| 前端 | React SPA | OpenClaw 前端 |
| 编排 | Python asyncio worker | OpenClaw cron + MCP tools |
| 数据 | PostgreSQL | OpenClaw workflow state |
| 部署 | 单体 FastAPI | MCP server（pi-chain-tools） |

**我们不需要复刻那些部分** — OpenClaw 已经提供了编排、通知、前端、状态管理。
我们只需要确保**链上原子操作（MCP 工具）完整且正确**。

## 实施状态

- [x] **P0: 修复 Morpho calldata** — MarketParams 从 GraphQL API 实时解析
- [x] **P1: Morpho execute tools** — 6 个 MCP execute 工具
- [x] **P1: Worker 泛化** — protocol 参数化（venus/morpho）
- [x] **P2: ERC-4626 vault adapter** — deposit/withdraw/redeem + 2 read tools
- [x] **P3: LTV decision tool** — evm_ltvDecide 纯计算 MCP 工具
- [x] **P4: Base Morpho 部署** — 0xBBBBB... (Base + Ethereum)

### BorrowBot MCP 工具清单（16 个新工具）

| 工具 | 类型 | 说明 |
|------|------|------|
| `evm_morphoGetMarkets` | read | Morpho 市场列表 |
| `evm_morphoGetPosition` | read | 账户仓位 |
| `evm_morphoSupply` | execute | 供给（借出） |
| `evm_morphoBorrow` | execute | 借入 |
| `evm_morphoRepay` | execute | 还款 |
| `evm_morphoWithdraw` | execute | 取回供给 |
| `evm_morphoSupplyCollateral` | execute | 存入抵押品 |
| `evm_morphoWithdrawCollateral` | execute | 取回抵押品 |
| `evm_vaultGetInfo` | read | Vault 元数据 |
| `evm_vaultGetBalance` | read | Vault 余额 |
| `evm_vaultDeposit` | execute | 存入 Vault |
| `evm_vaultWithdraw` | execute | 从 Vault 取款 |
| `evm_vaultRedeem` | execute | 赎回 Vault 份额 |
| `evm_ltvDecide` | read | LTV 决策（纯计算） |
| `evm_lifiGetQuote` | read | 跨链报价 |
| `evm_lifiExecuteBridge` | execute | 跨链执行 |
