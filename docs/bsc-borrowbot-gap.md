# BorrowBot Multi-Chain — Gap Analysis & Implementation Plan

> 将 BorrowBot（Base 链自主 DeFi Agent）以 BSC 为首站，构建可扩展到 Monad / Berachain / 任意 EVM 链的借贷 Agent 能力层。
>
> 基线：`pi-chain-tools` 现有 EVM 基础设施（`src/chains/evm/`）。

---

## 0. 架构核心判断

### 0.1 现有 EVM 架构的扩展性分析

当前 EVM 采用 **"单一工具层 + 网络枚举"** 模式（见 `docs/evm-integration-architecture-notes.md`）：

```
src/chains/evm/
  runtime.ts           ← EvmNetwork 联合类型 + RPC/chainId/schema 集中注册
  policy.ts            ← 主网安全策略（isMainnetLikeEvmNetwork）
  tools/
    read.ts            ← DexScreener + token map 查询
    execute.ts         ← native/ERC20 transfer + PancakeV2 swap
    transfer-workflow.ts ← transfer analysis→simulate→execute
    swap-workflow.ts   ← PancakeV2 swap workflow
    workflow.ts        ← Polymarket workflow
```

**添加一条新 EVM 链需要改动的地方（当前）：**

| 文件 | 改动 | 影响面 |
|---|---|---|
| `runtime.ts` | `EvmNetwork` 联合类型 + RPC + chainId + schema + parser | **~22 处**硬编码 |
| `transfer-workflow.ts` | token map env + 地址映射 + alias | **~15 处** |
| `read.ts` | EVM_NETWORKS_FOR_CONFIG_CHECK 数组 | 1 处 |
| `policy.ts` | `isMainnetLikeEvmNetwork` 仅排除 sepolia | 0 处（自动 ok） |

**结论：每加一条链约改 4 个文件、~40 处散点。核心 transfer/swap/workflow 逻辑完全复用，不需要任何改动。**

### 0.2 多链扩展路径

目前架构在 BSC 为止是 ok 的。但要继续加 Monad / Berachain / Linea / Scroll 等，有两个选择：

**选项 A（推荐，先做）**：继续现有模式——每条链手动加入 `EvmNetwork` 联合类型。
- 优点：改动集中、类型安全、无架构风险
- 缺点：每加一条链 ~40 处散点改动
- 适用：总链数 < 15

**选项 B（后续）**：将 `EvmNetwork` 改为注册表模式（`Map<string, EvmNetworkConfig>`）。
- 优点：加链零散点改动，只加一条配置
- 缺点：需重构 TypeBox schema 生成（运行时构建 Union）、改 parser、改所有 `Record<EvmNetwork, ...>` 为 Map
- 适用：总链数 > 15 或需要运行时动态注册

**本文档先按选项 A 执行 BSC，同时为 Monad/Bera 预留注册位。**

### 0.3 BorrowBot 核心能力的链抽象层级

BorrowBot 的核心能力可以分为三层：

```
┌────────────────────────────────────────────┐
│  Layer 3: Agent Orchestrator               │  ← 链无关
│  (LTV Manager, Worker Loop, Config)        │
├────────────────────────────────────────────┤
│  Layer 2: Protocol Adapters                │  ← 每链/每协议一个
│  (Venus, Morpho, Aave, Compound, ...)      │
├────────────────────────────────────────────┤
│  Layer 1: EVM Runtime                      │  ← 已有，跨链复用
│  (RPC, transfer, approve, call)            │
└────────────────────────────────────────────┘
```

**关键设计决策：Protocol Adapter 层用统一接口抽象，每个协议一个实现文件。**

---

## 1. 目标链生态与协议映射

### 1.1 BSC（chainId=56）— 首站

| BorrowBot 能力 | Base 原方案 | BSC 方案 | 成熟度 |
|---|---|---|---|
| 借贷 | Morpho Blue | **Venus Protocol** | 生产级（$2B+ TVL） |
| Yield Vault | 40acres / YO | **Venus vUSDC 自带收益** | 生产级 |
| DEX | 无（直接借贷） | **PancakeSwap V2**（已集成） | 已就绪 |
| 跨链桥 | LI.FI | **LI.FI**（BSC 已支持） | 直接复用 |
| Gas 代付 | Coinbase Paymaster | EOA 自付 → Biconomy（后续） | P2 |

**Venus Protocol 核心合约（Mainnet）：**
```
Comptroller:  0xfD36E2c2a6789Db23113685031d7F16329158384
vBNB:         0xA07c5b74C9B40447a954e1466938b865b6BBea36
vUSDC:        0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8
vUSDT:        0xfD5840Cd36d94D7229439859C0112a4185BC0255
vBTCB:        0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B
vETH:         0xf508fCD89b8bd15579dc79A6827cB4686A3592c8
```

### 1.2 Monad（chainId=TBD）— 后续

| BorrowBot 能力 | Monad 方案 | 备注 |
|---|---|---|
| 借贷 | **待定**（Monad 生态仍在早期，预计 Compound/Aave fork） | 需等 mainnet |
| DEX | **待定**（Monad 原生 DEX 或 Uniswap V3 fork） | |
| 跨链桥 | LI.FI / LayerZero / Wormhole | |

### 1.3 Berachain（chainId=80094）

| BorrowBot 能力 | Bera 方案 | 备注 |
|---|---|---|
| 借贷 | **Dolomite / BeraBorrow / Beraborrow** | Bera 原生借贷 |
| Yield | **Bera Vault + BGT staking** | PoL (Proof of Liquidity) 机制 |
| DEX | **BEX (Berachain native DEX)** | |
| 跨链桥 | LI.FI（已支持 Bera） | |

### 1.4 Protocol Adapter 统一接口

```typescript
// 链无关借贷协议适配器接口
interface LendingProtocolAdapter {
  // Read
  getMarkets(network: EvmNetwork): Promise<LendingMarket[]>
  getAccountPosition(network: EvmNetwork, account: string): Promise<LendingPosition>
  
  // Execute（返回未签名 tx calldata）
  buildSupplyTx(params: SupplyParams): Promise<EvmCallData>
  buildBorrowTx(params: BorrowParams): Promise<EvmCallData>
  buildRepayTx(params: RepayParams): Promise<EvmCallData>
  buildWithdrawTx(params: WithdrawParams): Promise<EvmCallData>
}

// 通用数据结构
interface LendingMarket {
  protocol: string           // "venus" | "aave" | "compound" | ...
  network: EvmNetwork
  asset: string              // underlying token address
  symbol: string
  supplyAPY: number
  borrowAPY: number
  totalSupply: string
  totalBorrow: string
  collateralFactor: number
  liquidationThreshold: number
}

interface LendingPosition {
  protocol: string
  network: EvmNetwork
  account: string
  supplies: { asset: string; symbol: string; balance: string; value: string }[]
  borrows: { asset: string; symbol: string; balance: string; value: string }[]
  totalCollateralValue: string
  totalBorrowValue: string
  currentLTV: number
  liquidationLTV: number
  healthFactor: number
}
```

这样 Venus / Aave / Compound / 任何新借贷协议只需要实现这个 adapter，LTV Manager 和 workflow 层完全复用。

---

## 2. 现有基础设施盘点

### 2.1 已就绪（BSC 直接可用）

| 模块 | 文件 | BSC 状态 |
|---|---|---|
| Network 注册 | `runtime.ts` | ✅ `"bsc"` RPC=`bsc.publicnode.com` chainId=56 |
| Native Transfer | `evm_transferNative` | ✅ BNB |
| ERC-20 Transfer | `evm_transferErc20` | ✅ BEP-20 |
| Transfer Workflow | `w3rt_run_evm_transfer_workflow_v0` | ✅ |
| PancakeSwap V2 | `evm_pancakeV2Swap` | ✅ factory/router/WBNB 已配置 |
| Swap Workflow | `w3rt_run_evm_swap_workflow_v0` | ✅ |
| DexScreener | `evm_dexscreenerPairs` | ✅ |
| Transfer Policy | `isMainnetLikeEvmNetwork("bsc")` | ✅ `true` |

### 2.2 Token Map 缺口

`transfer-workflow.ts` 中 BSC 地址缺失：

| Symbol | BSC 地址 | Decimals | 状态 |
|---|---|---|---|
| USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 | ❌ 缺 |
| USDT | `0x55d398326f99059fF775485246999027B3197955` | 6 (链上18) | ✅ 已有 |
| WETH | `0x2170Ed0880ac9A755fd29B2688956BD959F933f8` | 18 | ✅ 已有 |
| WBTC | — | — | ❌ BSC 用 BTCB 非 WBTC |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | 18 | ❌ 缺（execute.ts 已有但 token map 没有） |
| BTCB | `0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c` | 18 | ❌ 缺 |

**注意：BSC 上的 USDC/USDT 是 Binance-Peg 版本（18 decimals），与 Circle 原生版不同。需要支持按网络覆盖 decimals。**

---

## 3. 新增文件清单

### 3.1 Protocol Adapter 层

```
src/chains/evm/tools/lending-types.ts           ← 统一借贷接口定义 (LendingProtocolAdapter)
src/chains/evm/tools/venus-adapter.ts            ← Venus Protocol 实现
src/chains/evm/tools/venus-adapter.test.ts
```

### 3.2 Venus Read / Execute / Workflow

```
src/chains/evm/tools/venus-read.ts               ← evm_venusGetMarkets / evm_venusGetPosition
src/chains/evm/tools/venus-read.test.ts
src/chains/evm/tools/venus-execute.ts             ← evm_venusSupply / Borrow / Repay / Withdraw
src/chains/evm/tools/venus-execute.test.ts
src/chains/evm/tools/venus-workflow.ts            ← w3rt_run_evm_venus_workflow_v0
src/chains/evm/tools/venus-workflow.test.ts
```

### 3.3 LTV Manager（链无关）

```
src/chains/evm/tools/ltv-manager.ts              ← 决策引擎
src/chains/evm/tools/ltv-manager.test.ts
```

### 3.4 LI.FI 跨链桥

```
src/chains/evm/tools/lifi-read.ts                ← evm_lifiGetQuote / evm_lifiGetStatus
src/chains/evm/tools/lifi-read.test.ts
src/chains/evm/tools/lifi-execute.ts              ← evm_lifiExecuteBridge
src/chains/evm/tools/lifi-execute.test.ts
```

### 3.5 需修改的现有文件

```
src/chains/evm/tools/transfer-workflow.ts         ← BSC token map 补全
src/chains/evm/toolset.ts                         ← 注册 Venus / LI.FI 工具组
README.md                                         ← 文档
```

---

## 4. Venus Protocol 合约交互细节

### 4.1 ABI Function Selectors

```
// vToken (vBEP20)
mint(uint256)                  → 0xa0712d68    // 存入底层资产获得 vToken
redeem(uint256)                → 0xdb006a75    // 赎回 vToken
redeemUnderlying(uint256)      → 0x852a12e3    // 赎回指定数量底层资产
borrow(uint256)                → 0xc5ebeaec    // 借款
repayBorrow(uint256)           → 0x0e752702    // 还款
balanceOfUnderlying(address)   → 0x3af9e669    // 底层资产余额 (non-view, use eth_call)
borrowBalanceCurrent(address)  → 0x17bfdfbc    // 当前借款余额
supplyRatePerBlock()           → 0xae9d70b0    // 存款利率/块
borrowRatePerBlock()           → 0xf8f9da28    // 借款利率/块
exchangeRateCurrent()          → 0xbd6d894d    // vToken→underlying 兑换率
underlying()                   → 0x6f307dc3    // 底层资产地址

// Comptroller
enterMarkets(address[])        → 0xc2998238    // 启用资产作为抵押
getAccountLiquidity(address)   → 0x5ec88c79    // 账户流动性
getAllMarkets()                 → 0xb0772d0b    // 所有市场列表
markets(address)               → 0x8e8f294b    // 市场配置（collateralFactor 等）
```

### 4.2 交互模式

所有 Venus 操作通过 EVM 已有基础设施执行：
- **Read**：`eth_call` 到 RPC endpoint（`getEvmRpcEndpoint("bsc")`）
- **Execute**：构建 calldata → 通过 `ethers.Wallet` 签名 → 发送 `eth_sendRawTransaction`
- **BNB 特殊处理**：`vBNB.mint()` 需 `msg.value`，不走 `approve` + `mint(amount)` 模式

### 4.3 利率计算

Venus 使用 Compound V2 利率模型：
```
blocksPerYear = 10512000  (BSC ~3s/block)
supplyAPY = ((supplyRatePerBlock / 1e18) * blocksPerYear) * 100
borrowAPY = ((borrowRatePerBlock / 1e18) * blocksPerYear) * 100
```

---

## 5. LTV Manager 设计

### 5.1 核心算法（链无关）

```typescript
interface LtvManagerInput {
  position: LendingPosition        // 从 adapter 读取
  config: AgentConfig               // 用户配置
  marketRates: {                    // 利率数据
    supplyAPY: number
    borrowAPY: number
  }
}

interface AgentConfig {
  maxLTV: number           // 默认 0.75（Venus liquidation ~0.80）
  targetLTV: number        // 默认 0.60
  minYieldSpread: number   // 默认 0.02（2%）
  paused: boolean          // kill switch
}

type LtvAction =
  | { action: "hold"; reason: string }
  | { action: "repay"; amount: string; reason: string }
  | { action: "optimize"; amount: string; reason: string }

function decideLtvAction(input: LtvManagerInput): LtvAction {
  if (input.config.paused) {
    return { action: "hold", reason: "Agent paused by owner" }
  }
  
  const { currentLTV } = input.position
  const { maxLTV, targetLTV, minYieldSpread } = input.config
  const yieldSpread = input.marketRates.supplyAPY - input.marketRates.borrowAPY
  
  // 紧急还款：LTV 接近清算线
  if (currentLTV > maxLTV * 0.95) {
    const repayAmount = calculateRepayToTarget(input.position, targetLTV)
    return { action: "repay", amount: repayAmount, reason: `LTV ${(currentLTV*100).toFixed(1)}% exceeds safety threshold ${(maxLTV*95).toFixed(1)}%` }
  }
  
  // 优化借贷：LTV 低且收益好
  if (currentLTV < targetLTV * 0.80 && yieldSpread > minYieldSpread) {
    const borrowMore = calculateBorrowToTarget(input.position, targetLTV)
    return { action: "optimize", amount: borrowMore, reason: `LTV ${(currentLTV*100).toFixed(1)}% below target, yield spread ${(yieldSpread*100).toFixed(2)}% > min ${(minYieldSpread*100).toFixed(2)}%` }
  }
  
  return { action: "hold", reason: `LTV ${(currentLTV*100).toFixed(1)}% in safe range, yield spread ${(yieldSpread*100).toFixed(2)}%` }
}
```

### 5.2 安全门控

- auto-repay 无需用户确认（清算保护优先）
- auto-optimize 需满足：`yieldSpread > minYieldSpread` AND `!config.paused` AND `currentLTV < targetLTV * 0.80`
- 所有操作记录到 `actionLog` 供审计

---

## 6. 跨链桥接（LI.FI）

LI.FI API 已支持所有目标链：

| 链 | LI.FI chainId | 状态 |
|---|---|---|
| BSC | 56 | ✅ |
| Ethereum | 1 | ✅ |
| Arbitrum | 42161 | ✅ |
| Optimism | 10 | ✅ |
| Base | 8453 | ✅ |
| Berachain | 80094 | ✅ |
| Monad | TBD | 待上线 |

### 6.1 Quote API

```
GET https://li.quest/v1/quote
  ?fromChain=56
  &toChain=1
  &fromToken=0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d  // BSC USDC
  &toToken=0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48    // ETH USDC
  &fromAmount=1000000000000000000000                       // 1000 USDC (18 dec)
  &fromAddress=<agent_wallet>
  &toAddress=<user_wallet>
```

### 6.2 执行流程

1. `approve(fromToken, lifiDiamond, amount)` — 授权 LI.FI 合约
2. 发送 quote 返回的 `transactionRequest` — 执行桥接
3. 轮询 `GET /v1/status?txHash=...` — 等待完成

---

## 7. 实施阶段

### Phase 0：BSC Token Map 补全 ⏱ 0.5 天
- [x] 补 USDC(BSC) / WBNB / BTCB 到 token map
- [x] 处理 BSC USDC 18 decimals 差异（按网络覆盖 decimals）
- [ ] 确认 BSC transfer 端到端可用

### Phase 1：Venus Protocol Read ⏱ 1-2 天
- [ ] `lending-types.ts` — 统一借贷接口
- [ ] `venus-adapter.ts` — Venus 合约读取实现
- [ ] `venus-read.ts` — `evm_venusGetMarkets` / `evm_venusGetPosition`
- [ ] 测试

### Phase 2：Venus Protocol Execute + Workflow ⏱ 2-3 天
- [ ] `venus-execute.ts` — supply / borrow / repay / withdraw
- [ ] `venus-workflow.ts` — `w3rt_run_evm_venus_workflow_v0`
- [ ] approve 处理（ERC-20 allowance 检查 + approve tx）
- [ ] BNB 特殊处理（vBNB 用 msg.value）
- [ ] 测试

### Phase 3：LTV Manager ⏱ 1-2 天
- [ ] `ltv-manager.ts` — 决策引擎
- [ ] Agent 配置模型（先内存/DB，后续可链上）
- [ ] 集成 Venus adapter
- [ ] 测试

### Phase 4：LI.FI 跨链 ⏱ 1-2 天
- [ ] `lifi-read.ts` — quote + status
- [ ] `lifi-execute.ts` — approve + bridge
- [ ] 测试

### Phase 5：Agent Worker Loop ⏱ 2-3 天
- [ ] 持续监控循环（定时读取仓位 → 决策 → 执行）
- [ ] 审计日志
- [ ] Telegram 通知（可选）

### Phase 6：Monad / Berachain 扩展 ⏱ 视生态成熟度
- [ ] 注册 network（EvmNetwork 联合类型 + RPC + chainId）
- [ ] 实现该链的 LendingProtocolAdapter
- [ ] 复用 LTV Manager + LI.FI + Workflow

---

## 8. 安全约束

| 约束 | 实现 |
|---|---|
| BSC mainnet 执行 | 需要 `confirmMainnet=true` |
| Venus execute 默认 | `dryRun=true` |
| auto-repay 免确认 | 清算保护优先（`maxLTV * 0.95` 触发） |
| auto-optimize 门控 | `yieldSpread > minYieldSpread` + `!paused` |
| 合约白名单 | Venus Comptroller / vTokens / LI.FI Diamond |
| 重放保护 | 每次从链上读取最新状态，基于实时 LTV 决策 |
| Bridge 安全 | LI.FI Diamond 地址白名单 |
| Agent 停止 | `config.paused=true` → 所有操作暂停 |

---

## 9. 多链扩展对照表

| 维度 | BSC (Phase 0-5) | Monad | Berachain |
|---|---|---|---|
| Network | ✅ 已注册 | 待注册 | 待注册 |
| Lending | Venus | TBD (Compound fork?) | Dolomite / BeraBorrow |
| DEX | PancakeSwap V2 ✅ | TBD | BEX |
| Bridge | LI.FI ✅ | TBD | LI.FI ✅ |
| 复用层 | 100% EVM runtime | 100% EVM runtime | 100% EVM runtime |
| 新增层 | Venus adapter | 新 lending adapter | 新 lending adapter |
| LTV Manager | ✅ 直接复用 | ✅ 直接复用 | ✅ 直接复用 |

**核心结论：每条新 EVM 链只需要做两件事：**
1. **注册 network**（~40 处散点改动）
2. **实现该链的 LendingProtocolAdapter**（一个文件 + 合约地址配置）

LTV Manager / Workflow / LI.FI / Transfer 全部直接复用。

---

## 10. 先决条件

- BSC RPC 可用（`bsc.publicnode.com` 或自有节点）
- 测试用 BSC 账户 + BNB gas
- Venus Protocol ABI（公开）
- LI.FI API（免费 tier 即可）
- 未来扩展：Monad testnet RPC / Berachain mainnet RPC
