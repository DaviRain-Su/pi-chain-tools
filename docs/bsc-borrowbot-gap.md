# BorrowBot Multi-Chain — Gap Analysis & Implementation Plan

> 将 BorrowBot（Base 链自主 DeFi Agent）以 BSC 为首站，构建可扩展到 Monad / Berachain / 任意 EVM 链的借贷 Agent 能力层。
>
> 基线：`pi-chain-tools` 现有 EVM 基础设施（`src/chains/evm/`）。

---

## 0. 架构核心判断

### 0.1 Agent 钱包方案：Privy Agentic Wallets

> **决策：采用 Privy 作为 Agent 钱包签名后端**，替代本地私钥管理（`ethers.Wallet` + `EVM_PRIVATE_KEY`）。
> Privy 提供 MPC/enclave 托管签名，消除 Agent 直接持有私钥的安全风险。

#### 0.1.1 Privy SDK 多链支持分析

基于 `@privy-io/node@0.9.0` SDK 类型定义（`resources/wallets/wallets.d.ts`），Privy 钱包支持以下链类型：

```typescript
// 钱包创建支持的完整链类型列表
type WalletChainType =
  | 'ethereum'        // ← 所有 EVM 链共用这一个 chain_type
  | 'solana'
  | 'cosmos'
  | 'stellar'
  | 'sui'
  | 'aptos'
  | 'movement'
  | 'tron'
  | 'bitcoin-segwit'
  | 'near'
  | 'ton'
  | 'starknet'
  | 'spark';

// 分级：
type FirstClassChainType = 'ethereum' | 'solana';                     // 完整 RPC 方法支持
type ExtendedChainType   = 'cosmos' | 'stellar' | 'sui' | ...;       // rawSign 签名支持
type CurveSigningChainType = 'cosmos' | 'stellar' | 'sui' | ...;     // 曲线级签名
```

**关键发现：EVM 多链通过 CAIP-2 标识符区分，而非独立 chain_type。**

```typescript
// EVM 交易发送接口
interface EthereumSendTransactionRpcInput {
  caip2: string;                    // ← CAIP-2 指定具体 EVM 链
  method: 'eth_sendTransaction';
  chain_type?: 'ethereum';          // ← 固定 'ethereum'
  sponsor?: boolean;                // ← gas 代付（需配 paymaster）
}
```

| CAIP-2 标识符 | 链 | BorrowBot 需要 |
|---|---|---|
| `eip155:1` | Ethereum Mainnet | Bridge 目标 |
| `eip155:56` | **BSC** | **首站** |
| `eip155:137` | Polygon | Polymarket 已有 |
| `eip155:8453` | Base | 原方案 |
| `eip155:42161` | Arbitrum | Bridge 目标 |
| `eip155:80094` | **Berachain** | **后续扩展** |
| `eip155:<N>` | **任意 EVM 链** | Monad 等 |

**核心结论：一个 Privy `ethereum` 钱包 = 同一 EOA 地址可在所有 EVM 链上签名和发送交易。**

#### 0.1.2 Privy vs 现有方案对比

| 维度 | 现有方案 (本地私钥) | Privy Agentic Wallets |
|---|---|---|
| 钱包创建 | 手动生成/导入私钥 | `privy.wallets.create({ chain_type: 'ethereum' })` |
| 密钥管理 | `EVM_PRIVATE_KEY` env 明文 | MPC/enclave 托管，Agent 不接触私钥 |
| 签名 | `ethers.Wallet.signTransaction()` 本地 | `privy.wallets.ethereum().sendTransaction()` 远程 |
| 多链 | 同一私钥手动配不同 RPC | 同一 walletId + `caip2` 切链 |
| 交易策略控制 | 无（或自建 allowlist） | Policy API（按 `chain_id` / 合约 / 金额限制） |
| Gas 代付 | 自付 BNB | `sponsor: true`（需 Dashboard 配 paymaster） |
| Smart Wallet | 无 | 内置 EIP-7702 支持（`sign7702Authorization`） |
| 非 EVM 链 | 各链独立密钥管理 | `privy.wallets.solana()` / NEAR / Sui 等统一 API |
| 安全风险 | 私钥泄露 = 资产丢失 | 密钥永不离开 enclave |

#### 0.1.3 集成架构

Privy 作为可替换的 **Signer Provider** 接入，Workflow / Adapter / LTV Manager 层完全不变：

```
┌──────────────────────────────────────────────────┐
│  Layer 4: Agent Orchestrator                     │  ← 链无关、签名无关
│  (LTV Manager, Worker Loop, Config)              │
├──────────────────────────────────────────────────┤
│  Layer 3: Workflow                               │  ← analysis→simulate→execute
│  (venus-workflow, transfer-workflow)             │
├──────────────────────────────────────────────────┤
│  Layer 2: Protocol Adapters                      │  ← 每链/每协议一个
│  (Venus, Morpho, Aave, Compound, ...)            │  ← 返回 EvmCallData（未签名）
├──────────────────────────────────────────────────┤
│  Layer 1: Signer Provider (可替换)               │  ← 签名 + 广播
│  ┌─────────────────┐  ┌──────────────────────┐  │
│  │ LocalKeySigner   │  │ PrivySigner          │  │
│  │ ethers.Wallet    │  │ privy.wallets.eth()  │  │
│  │ EVM_PRIVATE_KEY  │  │ walletId + caip2     │  │
│  └─────────────────┘  └──────────────────────┘  │
├──────────────────────────────────────────────────┤
│  Layer 0: EVM Runtime                            │  ← RPC/chainId/schema
│  (runtime.ts, policy.ts)                         │
└──────────────────────────────────────────────────┘
```

**Signer Provider 接口（新增）：**

```typescript
// src/chains/evm/tools/signer-types.ts

interface EvmSignerProvider {
  /** 签名并广播交易，返回 tx hash */
  signAndSend(params: {
    network: EvmNetwork;
    to: string;
    data: string;
    value?: string;        // wei（十六进制或十进制字符串）
    gasLimit?: string;
  }): Promise<{ txHash: string }>;

  /** 获取签名者地址 */
  getAddress(network: EvmNetwork): Promise<string>;
}

// 现有实现（向后兼容）
class LocalKeySigner implements EvmSignerProvider {
  constructor(private privateKey: string) {}
  async signAndSend(params) {
    const rpcUrl = getEvmRpcEndpoint(params.network);
    const wallet = new ethers.Wallet(this.privateKey);
    // ... 现有 ethers 签名逻辑
  }
  async getAddress() {
    return new ethers.Wallet(this.privateKey).address;
  }
}

// Privy 实现
class PrivyEvmSigner implements EvmSignerProvider {
  constructor(
    private privy: PrivyClient,
    private walletId: string,
  ) {}

  async signAndSend(params) {
    const caip2 = `eip155:${getEvmChainId(params.network)}`;
    const result = await this.privy.wallets.ethereum().sendTransaction(
      this.walletId,
      { params: { transaction: {
        to: params.to,
        data: params.data,
        value: params.value,
        gas: params.gasLimit,
      }}, caip2 },
    );
    return { txHash: result.hash };
  }

  async getAddress(network) {
    // Privy 钱包地址在所有 EVM 链上相同
    const wallet = await this.privy.wallets.get(this.walletId);
    return wallet.address;
  }
}
```

#### 0.1.4 非 EVM 链 Privy 适配（Future）

Privy 同样可用于项目中已有的非 EVM 链签名需求：

| 链 | 现有签名方式 | Privy 适配 |
|---|---|---|
| Solana | `Keypair.fromSecretKey()` | `privy.wallets.solana().signAndSendTransaction()` |
| NEAR | `KeyPairSigner.fromSecretKey()` | `privy.wallets.create({ chain_type: 'near' })` + rawSign |
| Sui | 本地 keystore / `SUI_PRIVATE_KEY` | `privy.wallets.create({ chain_type: 'sui' })` + rawSign |
| Kaspa | `KASPA_PRIVATE_KEY` / kaspa-wasm | ❌ 不支持（Privy 无 `kaspa` chain_type） |

**注意：Kaspa 不在 Privy 支持列表中，需继续使用现有本地密钥签名方案。**

#### 0.1.5 Privy Policy 层（安全策略）

Privy 原生支持交易策略控制（`resources/policies.d.ts`）：

```typescript
// 可按链/合约/金额限制 Agent 行为
{
  chain_type: 'ethereum' | 'solana' | 'tron' | 'sui',
  // 条件字段：
  field: 'to' | 'value' | 'chain_id',  // ← 可按 chain_id 限制只允许 BSC
  // ...
}
```

这可以取代或增强我们现有的 `isMainnetLikeEvmNetwork` + `confirmMainnet` 门控：
- **Privy Policy**：在密钥托管层强制执行（即使 Agent 代码被绕过也无法越权）
- **现有门控**：在 workflow 层执行（代码级保护）
- **推荐：两层并用**——Privy Policy 作为最后防线，workflow 门控作为一线检查。

### 0.2 Privy 集成决策摘要

| 决策 | 结论 |
|---|---|
| 生产签名后端 | **Privy Agentic Wallets** |
| 开发/测试后端 | **LocalKeySigner**（`ethers.Wallet` + `EVM_PRIVATE_KEY`） |
| 多 EVM 链 | 同一 walletId，通过 `caip2` 切链（零签名层改动） |
| 非 EVM 链 | Solana / NEAR / Sui 可选接入；**Kaspa 不支持** |
| 集成模式 | `EvmSignerProvider` 接口抽象，Adapter 不感知签名方式 |
| 安全模型 | Workflow 门控 + Privy Policy 双层防线 |
| 实施阶段 | Phase 1.5（Signer Provider 抽象），Venus execute 之前 |

### 0.3 现有 EVM 架构的扩展性分析

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

### 0.4 多链扩展路径

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

### 0.5 BorrowBot 核心能力的链抽象层级

BorrowBot 的核心能力可以分为四层：

```
┌──────────────────────────────────────────────────┐
│  Layer 4: Agent Orchestrator                     │  ← 链无关、签名无关
│  (LTV Manager, Worker Loop, Config)              │
├──────────────────────────────────────────────────┤
│  Layer 3: Workflow                               │  ← analysis→simulate→execute
│  (venus-workflow, transfer-workflow)             │
├──────────────────────────────────────────────────┤
│  Layer 2: Protocol Adapters                      │  ← 每链/每协议一个
│  (Venus, Morpho, Aave, Compound, ...)            │  ← 返回 EvmCallData（未签名）
├──────────────────────────────────────────────────┤
│  Layer 1: Signer Provider (可替换)               │  ← 签名 + 广播
│  ┌─────────────────┐  ┌──────────────────────┐  │
│  │ LocalKeySigner   │  │ PrivyEvmSigner       │  │
│  │ ethers.Wallet    │  │ privy.wallets.eth()  │  │
│  └─────────────────┘  └──────────────────────┘  │
├──────────────────────────────────────────────────┤
│  Layer 0: EVM Runtime                            │  ← RPC/chainId/schema/policy
│  (runtime.ts, policy.ts)                         │
└──────────────────────────────────────────────────┘
```

**关键设计决策：**
1. **Protocol Adapter 层**用统一接口抽象，每个协议一个实现文件。
2. **Signer Provider 层**可替换——本地私钥（开发/测试）或 Privy（生产）。
3. Adapter 只返回 `EvmCallData`（未签名 calldata），签名职责在 Signer Provider。

---

## 1. 目标链生态与协议映射

### 1.1 BSC（chainId=56）— 首站

| BorrowBot 能力 | Base 原方案 | BSC 方案 | 成熟度 |
|---|---|---|---|
| Agent 钱包 | Coinbase CDP + EIP-7702 | **Privy Agentic Wallets** (`caip2: eip155:56`) | 生产级 |
| 借贷 | Morpho Blue | **Venus Protocol** | 生产级（$2B+ TVL） |
| Yield Vault | 40acres / YO | **Venus vUSDC 自带收益** | 生产级 |
| DEX | 无（直接借贷） | **PancakeSwap V2**（已集成） | 已就绪 |
| 跨链桥 | LI.FI | **LI.FI**（BSC 已支持） | 直接复用 |
| Gas 代付 | Coinbase Paymaster | **Privy `sponsor: true`**（需配 paymaster） | P1 |

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

### 3.1 Signer Provider 层

```
src/chains/evm/tools/signer-types.ts             ← EvmSignerProvider 接口
src/chains/evm/tools/signer-local.ts             ← LocalKeySigner（ethers.Wallet，向后兼容）
src/chains/evm/tools/signer-privy.ts             ← PrivyEvmSigner（Privy SDK）
src/chains/evm/tools/signer-privy.test.ts
```

### 3.2 Protocol Adapter 层

```
src/chains/evm/tools/lending-types.ts           ← 统一借贷接口定义 (LendingProtocolAdapter)
src/chains/evm/tools/venus-adapter.ts            ← Venus Protocol 实现
src/chains/evm/tools/venus-adapter.test.ts
```

### 3.3 Venus Read / Execute / Workflow

```
src/chains/evm/tools/venus-read.ts               ← evm_venusGetMarkets / evm_venusGetPosition
src/chains/evm/tools/venus-read.test.ts
src/chains/evm/tools/venus-execute.ts             ← evm_venusSupply / Borrow / Repay / Withdraw
src/chains/evm/tools/venus-execute.test.ts
src/chains/evm/tools/venus-workflow.ts            ← w3rt_run_evm_venus_workflow_v0
src/chains/evm/tools/venus-workflow.test.ts
```

### 3.4 LTV Manager（链无关）

```
src/chains/evm/tools/ltv-manager.ts              ← 决策引擎
src/chains/evm/tools/ltv-manager.test.ts
```

### 3.5 LI.FI 跨链桥

```
src/chains/evm/tools/lifi-read.ts                ← evm_lifiGetQuote / evm_lifiGetStatus
src/chains/evm/tools/lifi-read.test.ts
src/chains/evm/tools/lifi-execute.ts              ← evm_lifiExecuteBridge
src/chains/evm/tools/lifi-execute.test.ts
```

### 3.6 需修改的现有文件

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
- **Execute（两种签名路径）**：
  - **本地私钥**：构建 calldata → `ethers.Wallet` 签名 → `eth_sendRawTransaction`
  - **Privy（推荐）**：构建 calldata → `privy.wallets.ethereum().sendTransaction(walletId, { caip2: 'eip155:56', params: { transaction } })` → Privy 远程签名+广播
- **BNB 特殊处理**：`vBNB.mint()` 需 `msg.value`，不走 `approve` + `mint(amount)` 模式
- **签名路径对 Adapter 透明**：Venus adapter 只返回 `EvmCallData`（to, data, value），由上层 Signer Provider 决定如何签名

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
- [x] BSC transfer 端到端：token map + decimals + SignerProvider 均已就绪

### Phase 1：Venus Protocol Adapter + Types ⏱ 1-2 天 ✅
- [x] `lending-types.ts` — 统一借贷接口（`LendingProtocolAdapter`）
- [x] `venus-adapter.ts` — Venus 合约读取 + calldata 构建
- [x] `venus-adapter.test.ts` — 27 个测试
- [x] `ltv-manager.ts` — 链无关 LTV 决策引擎
- [x] `ltv-manager.test.ts` — 22 个测试

### Phase 1.5：Signer Provider 抽象 ⏱ 1 天 ★ NEW ✅
- [x] `signer-types.ts` — `EvmSignerProvider` 接口 + `resolveSignerBackend()` 优先级解析
- [x] `signer-local.ts` — `LocalKeySigner`（封装 `ethers.Wallet` + nonce/gas 自动解析）
- [x] `signer-privy.ts` — `PrivyEvmSigner`（`@privy-io/node` 动态导入 + CAIP-2 多链）
- [x] `signer-resolve.ts` — `resolveEvmSigner()` 自动选择后端（Local > Privy）
- [x] `src/types/privy-io-node.d.ts` — 可选依赖类型 stub
- [x] 向后兼容：`fromPrivateKey` / `EVM_PRIVATE_KEY` → LocalKey；`PRIVY_*` → Privy
- [x] 测试 — 16 tests（后端解析 7 + LocalKey 3 + Privy 3 + 集成 3）
- [x] Workflow 层重构：Venus execute + workflow 从 `new Wallet(privateKey)` 迁移到 `signerProvider.signAndSend()`
  - `venus-execute.ts`：5 个工具全部迁移，删除 164 行重复代码
  - `venus-workflow.ts`：execute phase 迁移，删除 122 行
  - `execute.ts`（基础 transfer）：保留旧模式（Polymarket ClobClient 需要 Wallet 实例）

### Phase 2：Venus Execute Tools + Workflow ⏱ 2-3 天 ✅
- [x] `venus-read.ts` — `evm_venusGetMarkets` / `evm_venusGetPosition`（MCP 工具）— 4 tests
- [x] `venus-execute.ts` — supply / borrow / repay / withdraw / enterMarkets（dryRun + confirmMainnet 门控）— 8 tests
- [x] `venus-workflow.ts` — `w3rt_run_evm_venus_workflow_v0`（analysis→simulate→execute + confirmToken）— 13 tests
- [x] approve 处理（ERC-20 approve + mint/repayBorrow 序列化发送）
- [x] BNB 特殊处理（vBNB 用 msg.value）
- [x] tokenSymbol 快捷方式（BNB/USDC/USDT/BTCB/ETH → 地址解析）
- [x] 注册到 `toolset.ts` — read 组 + execute 组

### Phase 3：LTV Manager 集成 ⏱ 1 天 ✅
- [x] `ltv-manager.ts` — 决策引擎（已完成）
- [x] `venus-agent.ts` — Agent 工具（`evm_venusAgentCheck` + `evm_venusAgentAuditLog`）— 11 tests
- [x] Agent 配置模型（env: `VENUS_AGENT_MAX_LTV` / `TARGET_LTV` / `MIN_YIELD_SPREAD` / `PAUSED`）
- [x] 集成 Venus adapter — `buildLtvInput()` 桥接 position→LTV input
- [x] 审计日志（内存 ring buffer，最近 100 条）

### Phase 4：LI.FI 跨链 ⏱ 1-2 天 ✅
- [x] `lifi-types.ts` — Quote/Status/TransactionRequest 类型
- [x] `lifi-read.ts` — `evm_lifiGetQuote` / `evm_lifiGetStatus` — 5 tests
- [x] `lifi-execute.ts` — `evm_lifiExecuteBridge`（approve + bridge，通过 EvmSignerProvider）— 3 tests
- [x] 注册到 `toolset.ts` — read 组 + execute 组

### Phase 5：Agent Worker Loop ⏱ 2-3 天 ✅
- [x] `agent-worker.ts` — 持续监控循环（`evm_agentWorkerStart/Stop/Status`）— 12 tests
- [x] 审计日志（WorkerCycleLog ring buffer，50 条）
- [x] 自动暂停（maxConsecutiveErrors 连续失败阈值）
- [x] dryRun 默认（observe-only 模式）
- [x] 使用 EvmSignerProvider 签名（Local/Privy）
- [x] 通知机制：webhook callback（替代内置 Telegram）
  - `fireWebhook()` — fire-and-forget POST，5s 超时，永不抛异常
  - 事件：action_executed / error_pause / ltv_critical / worker_stopped
  - OpenClaw 编排器在 webhook 接收端路由到 Telegram/Slack/Discord
  - 设计原则：Agent 是纯数据生产者，通知渠道零耦合
- [x] Privy Policy 配置（`privy-policy.ts`）
  - `getVenusBscPolicy()` — Venus-only 合约白名单
  - `getVenusLifiBscPolicy()` — Venus + LI.FI Diamond + 支出限额
  - `evm_privyPolicyRecommendation` MCP 工具（操作员审计用）
  - 双层安全模型：代码门控(Layer 1) + Privy enclave(Layer 2)

### Phase 6：Berachain 扩展 ✅ / Monad（待生态成熟）
- [x] Berachain 注册（EvmNetwork + RPC + chainId 80094）
- [x] WBERA / HONEY token map
- [x] 网络别名（berachain/bera/bartio）
- [x] Privy 签名零改动（caip2=eip155:80094）
- [ ] Berachain LendingProtocolAdapter（待 Dolomite/BeraBorrow 稳定）
- [x] Monad 注册（chainId 143，RPC `https://rpc.monad.xyz`）
  - WMON `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` (18 dec)
  - USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` (6 dec)
  - USDT `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` (6 dec)
  - WETH `0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242` (18 dec)
  - WBTC `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` (8 dec)
  - 网络别名：monad/mon
  - Privy caip2=eip155:143
- [x] Morpho Blue adapter（Monad mainnet `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee`）
  - GraphQL API 读取市场/仓位（blue-api.morpho.org）
  - getMarkets / getAccountPosition / buildSupply/Borrow/Repay/Withdraw
  - MCP 工具：evm_morphoGetMarkets, evm_morphoGetPosition
  - $66M+ TVL，18+ 活跃市场
- [x] Morpho execute tools（6 个 MCP 工具）
  - supply/borrow/repay/withdraw/supplyCollateral/withdrawCollateral
  - 全部 dryRun=true 默认 + confirmMainnet 门控
- [x] ERC-4626 Vault adapter + tools（5 个 MCP 工具）
  - getInfo/getBalance/deposit/withdraw/redeem
- [x] LTV decision tool（`evm_ltvDecide` 纯计算 MCP 工具）
- [x] Worker 泛化（protocol 参数化：venus/morpho）
- [x] Base / Ethereum Morpho 部署地址（`0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`）
- [x] 全部 BorrowBot P0-P4 完成 — 详见 `docs/borrowbot-progress.md`

---

## 8. 安全约束

### 8.1 双层安全模型

BorrowBot 采用 **Workflow 层 + Privy Policy 层** 双重安全门控：

```
交易请求
  │
  ▼
┌─────────────────────────────────┐
│  Layer 1: Workflow 门控 (代码级) │  ← confirmMainnet / dryRun / paused / LTV 检查
│  可被 Agent 代码 bug 绕过       │
└─────────────────┬───────────────┘
                  │ 通过
                  ▼
┌─────────────────────────────────┐
│  Layer 2: Privy Policy (密钥级) │  ← chain_id / to 白名单 / value 上限
│  密钥托管层强制执行，不可绕过    │
└─────────────────┬───────────────┘
                  │ 通过
                  ▼
            签名 + 广播
```

### 8.2 约束清单

| 约束 | Workflow 层 | Privy Policy 层 |
|---|---|---|
| BSC mainnet 执行 | `confirmMainnet=true` | `chain_id = 56` 白名单 |
| Venus execute 默认 | `dryRun=true` | — |
| 合约白名单 | 代码中校验 `to` 地址 | **`to` in [Comptroller, vTokens, LI.FI]** |
| 转账金额上限 | — | **`value` 上限（防单笔大额）** |
| auto-repay 免确认 | 清算保护优先（`maxLTV * 0.95`） | — |
| auto-optimize 门控 | `yieldSpread > minYieldSpread` + `!paused` | — |
| 重放保护 | 每次从链上读取最新状态 | — |
| Bridge 安全 | LI.FI Diamond 地址校验 | **`to` = LI.FI Diamond** |
| Agent 停止 | `config.paused=true` | 可在 Privy Dashboard 冻结钱包 |
| 私钥安全 | ~~EVM_PRIVATE_KEY env~~ | **密钥在 Privy enclave，Agent 不接触** |

---

## 9. 多链扩展对照表

| 维度 | BSC (Phase 0-5) | Monad | Berachain |
|---|---|---|---|
| Network | ✅ 已注册 | 待注册 | 待注册 |
| Privy CAIP-2 | `eip155:56` | `eip155:<chainId>` | `eip155:80094` |
| Privy 钱包 | **同一 walletId** | **同一 walletId** | **同一 walletId** |
| Lending | Venus | TBD (Compound fork?) | Dolomite / BeraBorrow |
| DEX | PancakeSwap V2 ✅ | TBD | BEX |
| Bridge | LI.FI ✅ | TBD | LI.FI ✅ |
| 复用层 | 100% EVM runtime | 100% EVM runtime | 100% EVM runtime |
| 新增层 | Venus adapter | 新 lending adapter | 新 lending adapter |
| LTV Manager | ✅ 直接复用 | ✅ 直接复用 | ✅ 直接复用 |
| Signer | ✅ PrivyEvmSigner | ✅ **零改动** | ✅ **零改动** |

**核心结论：每条新 EVM 链只需要做两件事：**
1. **注册 network**（~40 处散点改动）
2. **实现该链的 LendingProtocolAdapter**（一个文件 + 合约地址配置）

**Privy 签名层完全不需要改动** — 同一 walletId，只改 `caip2` 字符串（自动从 `getEvmChainId(network)` 派生）。

LTV Manager / Workflow / LI.FI / Transfer / **Signer** 全部直接复用。

---

## 10. 先决条件

### 10.1 基础设施
- BSC RPC 可用（`bsc.publicnode.com` 或自有节点）
- Venus Protocol ABI（公开）
- LI.FI API（免费 tier 即可）
- 未来扩展：Monad testnet RPC / Berachain mainnet RPC

### 10.2 Privy 配置 ★ NEW
- Privy 账户 + App 创建（[dashboard.privy.io](https://dashboard.privy.io)）
- `PRIVY_APP_ID` — App ID
- `PRIVY_APP_SECRET` — App Secret（服务端 SDK 认证）
- Agent 钱包创建：`privy.wallets.create({ chain_type: 'ethereum' })` → 获得 `walletId`
- `PRIVY_WALLET_ID` — Agent 钱包 ID（env 配置）
- **可选**：Dashboard 配置 Paymaster（BSC gas 代付）
- **可选**：Dashboard 配置 Policy（合约白名单 + chain_id 限制）

### 10.3 环境变量汇总

```bash
# Privy（生产推荐）
PRIVY_APP_ID=clxxxxxxxxxxxxx
PRIVY_APP_SECRET=xxxxxxxxxxxxx
PRIVY_WALLET_ID=wallet-id-from-create

# 本地私钥（开发/测试，与 Privy 二选一）
EVM_PRIVATE_KEY=0x...

# 通用
BSC_RPC_URL=https://bsc.publicnode.com    # 可选覆盖默认 RPC
LIFI_API_KEY=...                           # 可选
```

---

## 11. 附录：Privy SDK 类型参考

> 来源：`@privy-io/node@0.9.0`（`resources/wallets/wallets.d.ts`）

```typescript
// 完整钱包链类型
type WalletChainType =
  | 'ethereum' | 'solana' | 'cosmos' | 'stellar' | 'sui'
  | 'aptos' | 'movement' | 'tron' | 'bitcoin-segwit'
  | 'near' | 'ton' | 'starknet' | 'spark';

// 分级支持
type FirstClassChainType = 'ethereum' | 'solana';             // 完整 RPC 方法
type ExtendedChainType   = 'cosmos' | 'stellar' | 'sui' | …; // rawSign 签名
type CurveSigningChainType = 'cosmos' | 'stellar' | 'sui' | …;

// 发送 EVM 交易（核心接口）
interface EthereumSendTransactionRpcInput {
  caip2: string;                // "eip155:56" | "eip155:1" | ...
  method: 'eth_sendTransaction';
  params: { transaction: { to, data, value, gas, ... } };
  chain_type?: 'ethereum';
  sponsor?: boolean;            // gas 代付
}

// SDK 入口
privy.wallets.ethereum().sendTransaction(walletId, input)
privy.wallets.ethereum().signTransaction(walletId, input)
privy.wallets.ethereum().signMessage(walletId, input)
privy.wallets.ethereum().signTypedData(walletId, input)
privy.wallets.ethereum().sign7702Authorization(walletId, input)  // Smart Wallet
privy.wallets.solana().signTransaction(walletId, input)          // Solana
privy.wallets.rawSign(walletId, input)                           // 任意链曲线签名

// Policy（交易策略控制）
{
  chain_type: 'ethereum' | 'solana' | 'tron' | 'sui',
  // 条件字段：
  field: 'to' | 'value' | 'chain_id',
  // 运算符：eq / neq / in / not_in / gt / lt / gte / lte / ...
}
```

**Privy 不支持的链（需继续用现有方案）：** Kaspa。
