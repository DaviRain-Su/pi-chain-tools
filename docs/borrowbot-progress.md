# BorrowBot Multi-Chain — 实施进度总览

> 最后更新: 2026-02-16
> 代码库: `pi-chain-tools`
> 测试: **900 tests / 54 files** (全绿)

---

## 一、已完成的全部能力

### 1. EVM 基础设施 (Phase 0)

| 组件 | 文件 | 状态 |
|------|------|------|
| BSC 网络注册 | `runtime.ts` | ✅ chainId=56, RPC=bsc.publicnode.com |
| Monad 网络注册 | `runtime.ts` | ✅ chainId=143, RPC=rpc.monad.xyz |
| Berachain 网络注册 | `runtime.ts` | ✅ chainId=80094 |
| BSC Token Map | `transfer-workflow.ts` | ✅ USDC/USDT/WBNB/BTCB/WETH + 18-dec 覆盖 |
| Monad Token Map | `transfer-workflow.ts` | ✅ WMON/USDC/USDT/WETH/WBTC (链上验证) |
| Berachain Token Map | `transfer-workflow.ts` | ✅ WBERA/HONEY |
| Transfer/Swap Workflow | `transfer-workflow.ts`, `swap-workflow.ts` | ✅ 全链复用 |

### 2. 签名后端抽象 (Phase 1.5)

| 组件 | 文件 | 状态 |
|------|------|------|
| `EvmSignerProvider` 接口 | `signer-types.ts` | ✅ |
| `LocalKeySigner` (开发/测试) | `signer-local.ts` | ✅ ethers.Wallet 封装 |
| `PrivyEvmSigner` (生产) | `signer-privy.ts` | ✅ @privy-io/node 动态导入, CAIP-2 |
| 自动后端选择 | `signer-resolve.ts` | ✅ fromPrivateKey > EVM_PRIVATE_KEY > PRIVY_* |
| Privy Policy 模板 | `privy-policy.ts` | ✅ Venus/LI.FI 白名单 + MCP 审计工具 |
| 类型 stub | `types/privy-io-node.d.ts` | ✅ 可选依赖 |
| 测试 | `signer.test.ts` | ✅ 16 tests |

### 3. Venus Protocol — BSC (Phase 1-3)

| 组件 | 文件 | 测试 | 状态 |
|------|------|------|------|
| 统一借贷接口 | `lending-types.ts` | — | ✅ `LendingProtocolAdapter` + `EvmCallData` |
| Venus adapter | `venus-adapter.ts` | 27 | ✅ 全部 ABI 交互 |
| Venus read tools | `venus-read.ts` | 4 | ✅ `evm_venusGetMarkets`, `evm_venusGetPosition` |
| Venus execute tools | `venus-execute.ts` | 8 | ✅ supply/borrow/repay/withdraw/enterMarkets |
| Venus workflow | `venus-workflow.ts` | 13 | ✅ analysis→simulate→execute + confirmToken |
| LTV Manager | `ltv-manager.ts` | 22 | ✅ 链无关决策引擎 |

### 4. Morpho Blue — Monad / Base / Ethereum (Phase 6 + P0-P1)

| 组件 | 文件 | 测试 | 状态 |
|------|------|------|------|
| Morpho adapter | `morpho-adapter.ts` (~680 lines) | 24 | ✅ GraphQL reads + real MarketParams calldata |
| Morpho read tools | `morpho-read.ts` | — | ✅ `evm_morphoGetMarkets`, `evm_morphoGetPosition` |
| Morpho execute tools | `morpho-execute.ts` (~660 lines) | — | ✅ 6 tools: supply/borrow/repay/withdraw/supplyCollateral/withdrawCollateral |
| MarketParams 解析 | `morpho-adapter.ts` | — | ✅ `resolveMarketParams()`, `resolveMarketParamsForToken()` |
| 部署地址 | `morpho-adapter.ts` | — | ✅ Monad `0xD5D9...`, Base/ETH `0xBBBB...` |

### 5. ERC-4626 Vault (P2)

| 组件 | 文件 | 测试 | 状态 |
|------|------|------|------|
| Vault adapter | `vault-adapter.ts` (~280 lines) | 5 | ✅ getInfo/getBalance/deposit/withdraw/redeem |
| Vault MCP tools | `vault-tools.ts` (~420 lines) | — | ✅ 5 tools (2 read + 3 execute) |

### 6. 跨链桥 LI.FI (Phase 4)

| 组件 | 文件 | 测试 | 状态 |
|------|------|------|------|
| 类型 | `lifi-types.ts` | — | ✅ |
| 报价 + 状态 | `lifi-read.ts` | 5 | ✅ `evm_lifiGetQuote`, `evm_lifiGetStatus` |
| 跨链执行 | `lifi-execute.ts` | 3 | ✅ `evm_lifiExecuteBridge` |

### 7. Agent Worker + 通知 (Phase 5)

| 组件 | 文件 | 测试 | 状态 |
|------|------|------|------|
| Worker 循环 | `agent-worker.ts` | 12 | ✅ start/stop/status, protocol 可选 (venus/morpho) |
| Webhook 通知 | `agent-worker.ts` fireWebhook | — | ✅ 4 event types, fire-and-forget |
| LTV decision tool | `ltv-decision-tool.ts` | — | ✅ `evm_ltvDecide` (纯计算) |

### 8. NEAR 稳定收益 (独立线)

| 组件 | 文件 | 测试 | 状态 |
|------|------|------|------|
| 稳定收益计划 | `workflow.ts` | 93 | ✅ planning + proposal-first execute |
| Burrow 借贷 | `execute.ts` / `read.ts` | — | ✅ supply/borrow/repay/withdraw |
| Ref swap/LP | `execute.ts` / `read.ts` | — | ✅ |

---

## 二、MCP 工具全清单 (BorrowBot 相关: 30+ 工具)

### Read Tools (无链上写入)

| 工具名 | 说明 | 支持链 |
|--------|------|--------|
| `evm_venusGetMarkets` | Venus 市场列表 | BSC |
| `evm_venusGetPosition` | Venus 账户仓位 | BSC |
| `evm_morphoGetMarkets` | Morpho Blue 市场列表 | Monad, Base, ETH |
| `evm_morphoGetPosition` | Morpho 账户仓位 | Monad, Base, ETH |
| `evm_vaultGetInfo` | ERC-4626 vault 元数据 | 全 EVM |
| `evm_vaultGetBalance` | Vault 份额余额 | 全 EVM |
| `evm_ltvDecide` | LTV 决策 (纯计算) | N/A |
| `evm_lifiGetQuote` | 跨链桥报价 | 全 EVM |
| `evm_lifiGetStatus` | 跨链状态查询 | 全 EVM |
| `evm_privyPolicyRecommendation` | Privy 策略审计 | N/A |

### Execute Tools (链上写入, 默认 dryRun=true)

| 工具名 | 说明 | 支持链 |
|--------|------|--------|
| `evm_venusSupply` | Venus 存款 | BSC |
| `evm_venusBorrow` | Venus 借款 | BSC |
| `evm_venusRepay` | Venus 还款 | BSC |
| `evm_venusWithdraw` | Venus 取款 | BSC |
| `evm_venusEnterMarkets` | Venus 启用抵押 | BSC |
| `evm_morphoSupply` | Morpho 供给 (借出) | Monad, Base, ETH |
| `evm_morphoBorrow` | Morpho 借入 | Monad, Base, ETH |
| `evm_morphoRepay` | Morpho 还款 | Monad, Base, ETH |
| `evm_morphoWithdraw` | Morpho 取回 | Monad, Base, ETH |
| `evm_morphoSupplyCollateral` | Morpho 存入抵押品 | Monad, Base, ETH |
| `evm_morphoWithdrawCollateral` | Morpho 取回抵押品 | Monad, Base, ETH |
| `evm_vaultDeposit` | Vault 存入 | 全 EVM |
| `evm_vaultWithdraw` | Vault 取款 | 全 EVM |
| `evm_vaultRedeem` | Vault 赎回份额 | 全 EVM |
| `evm_lifiExecuteBridge` | 跨链执行 | 全 EVM |

### Workflow Tools (多步骤编排)

| 工具名 | 说明 |
|--------|------|
| `w3rt_run_evm_venus_workflow_v0` | Venus analysis→simulate→execute |
| `evm_agentWorkerStart` | 启动 worker 循环 (venus/morpho) |
| `evm_agentWorkerStop` | 停止 worker |
| `evm_agentWorkerStatus` | Worker 状态 + 最近 logs |

---

## 三、OpenClaw BorrowBot 工作流

完整的 BorrowBot 循环现在可以用以下 MCP 工具编排：

```
[初始化]
1. evm_morphoGetMarkets          → 选择最佳市场
2. evm_morphoSupplyCollateral    → 存入 WETH/WBTC 抵押品
3. evm_morphoBorrow              → 借出 USDC
4. evm_vaultDeposit              → USDC 存入 yield vault

[监控循环] (OpenClaw cron 每 5 分钟)
5. evm_morphoGetPosition         → 读仓位
6. evm_vaultGetBalance           → 读 vault 余额
7. evm_ltvDecide                 → LTV 决策

8a. if repay:
    evm_vaultWithdraw → evm_morphoRepay

8b. if optimize:
    evm_morphoBorrow → evm_vaultDeposit

[用户提现]
9.  evm_vaultWithdraw            → 从 vault 取出 USDC
10. evm_morphoRepay              → 还清贷款
11. evm_morphoWithdrawCollateral → 取回 WETH
12. evm_lifiExecuteBridge        → 跨链到用户目标链
```

---

## 四、还缺什么

### 4.1 外部依赖阻塞 (无法推进)

| 项目 | 阻塞原因 | 优先级 |
|------|---------|--------|
| Berachain LendingProtocolAdapter | Dolomite / BeraBorrow 协议 API 不稳定 | P3 |

### 4.2 可选增强 (非阻塞, 可按需实施)

| 项目 | 说明 | 工作量 | 优先级 |
|------|------|--------|--------|
| Morpho execute tests | morpho-execute.ts 的 mock 单元测试 | ~1h | P2 |
| Vault execute tests | vault-tools.ts 的 mock 单元测试 | ~1h | P2 |
| Morpho workflow | `w3rt_run_evm_morpho_workflow_v0` 三阶段 (类似 Venus workflow) | ~2h | P2 |
| Monad Morpho Privy Policy | privy-policy.ts 加 Morpho 合约白名单 | ~30min | P2 |
| LTV decision tool tests | ltv-decision-tool.ts 单元测试 | ~30min | P3 |
| Agent worker Morpho test | agent-worker 用 morpho adapter 的集成测试 | ~1h | P3 |
| ERC-4626 vault discovery | 自动发现 vault 地址 (链上扫描或 API) | ~2h | P3 |
| Polymarket 止盈止损 | Polymarket 持仓监控 + 自动下单 | ~3h | P3 |

### 4.3 与 OpenClaw 的集成工作 (OpenClaw 侧)

以下工作在 **OpenClaw 平台侧**完成，不在 pi-chain-tools 内：

| 项目 | 说明 |
|------|------|
| Playbook YAML 模板 | 将上述工作流编排为 OpenClaw playbook |
| Cron 触发器 | 每 5 分钟触发监控循环 |
| Webhook 接收 | 接收 agent-worker 通知 → 路由到 Telegram/Slack |
| 前端 UI | 仓位展示、参数配置、历史记录 |
| 用户钱包绑定 | Privy wallet 创建/绑定 |
| 多用户隔离 | 每个用户独立 worker + wallet |

---

## 五、代码量统计

### 新增文件 (BorrowBot 相关)

| 文件 | 行数 | 用途 |
|------|------|------|
| `lending-types.ts` | 161 | 统一借贷接口 |
| `venus-adapter.ts` | 574 | Venus Protocol |
| `venus-read.ts` | 165 | Venus MCP read |
| `venus-execute.ts` | 430 | Venus MCP execute |
| `venus-workflow.ts` | 320 | Venus workflow |
| `morpho-adapter.ts` | 682 | Morpho Blue |
| `morpho-read.ts` | 115 | Morpho MCP read |
| `morpho-execute.ts` | 658 | Morpho MCP execute |
| `vault-adapter.ts` | 282 | ERC-4626 Vault |
| `vault-tools.ts` | 422 | Vault MCP tools |
| `ltv-manager.ts` | 207 | LTV 决策引擎 |
| `ltv-decision-tool.ts` | 108 | LTV MCP tool |
| `agent-worker.ts` | 726 | Worker 循环 + webhook |
| `signer-types.ts` | 87 | Signer 接口 |
| `signer-local.ts` | 130 | LocalKey 签名 |
| `signer-privy.ts` | 157 | Privy 签名 |
| `signer-resolve.ts` | 86 | 自动选择 |
| `privy-policy.ts` | 176 | Policy 模板 |
| `lifi-types.ts` | 120 | LI.FI 类型 |
| `lifi-read.ts` | 200 | LI.FI read tools |
| `lifi-execute.ts` | 150 | LI.FI execute |
| **合计** | **~5,956** | |

### 测试文件

| 文件 | 测试数 |
|------|--------|
| `venus-adapter.test.ts` | 27 |
| `ltv-manager.test.ts` | 22 |
| `morpho-adapter.test.ts` | 24 |
| `vault-adapter.test.ts` | 5 |
| `signer.test.ts` | 16 |
| `venus (workflow/execute/read) tests` | 25 |
| `lifi.test.ts` | 8 |
| `agent-worker.test.ts` | 12 |
| `privy-policy.test.ts` | 4 |
| **合计 BorrowBot 相关** | **~143** |
| **项目总计** | **900** |

---

## 六、Git 提交历史 (按时间倒序)

```
29bb818 docs: mark all BorrowBot P0-P4 complete with tool inventory
c570391 feat(evm): P3+P4 — Base Morpho, LTV decision tool, BorrowBot ready
f851772 feat(evm): P1+P2 — Morpho execute tools, vault adapter, worker generalization
55f6dbb fix(evm/morpho): real MarketParams in calldata + supplyCollateral/withdrawCollateral
93d7a4a docs: BorrowBot on OpenClaw implementation plan
59c8683 feat(evm/morpho): Morpho Blue adapter + read tools for Monad
a2cfd0d fix(evm/monad): add verified Monad mainnet token addresses
6731991 feat(evm): Monad mainnet network registration (chainId 143)
92f2e52 feat(evm): Privy Policy templates + MCP audit tool
ea9a4b1 feat(evm/agent): webhook notifications for OpenClaw integration
d9316bd fix(evm/venus): implement real totalSupply and totalBorrow reads
b746489 refactor(evm/venus): migrate execute paths to EvmSignerProvider
651f3ca feat(evm): Signer Provider abstraction (Local + Privy)
3a7ff5b feat(evm/venus): Venus Agent with LTV Manager integration
02faf79 feat(evm/venus): Venus execute tools + workflow
... (更早的 BSC/Venus/LI.FI 提交)
```

---

## 七、结论

**BorrowBot 核心能力层已经 feature-complete。**

pi-chain-tools 作为 MCP 服务器，提供了完整的链上原子操作工具集：
- 2 个借贷协议 (Venus on BSC, Morpho on Monad/Base/ETH)
- 通用 Vault adapter (任意 ERC-4626)
- 跨链桥 (LI.FI, 支持所有 EVM 链)
- LTV 决策引擎 (纯计算, 可独立调用)
- 自主 Worker 循环 (多协议, webhook 通知)
- 双签名后端 (Local + Privy MPC)

**唯一外部阻塞**: Berachain 借贷协议 API 稳定性 (P3, 非关键路径)。

**下一步由 OpenClaw 侧完成**: playbook 编排、cron 触发、前端 UI、多用户管理。
