# EVM 集成架构记录（包含 Polymarket 与 BSC 对齐）

## 为什么目前不按 `evm/polygon`、`evm/bsc` 再切目录

本仓库目前将 EVM 相关能力统一放在 `src/chains/evm/*` 下，而不是按链再建子目录，原因是：

- `polymarket` 是**业务能力（应用层）**，不是一条链；它恰好默认使用 Polygon 的 CLOB/交易所能力，但本质仍依赖 EVM 通用签名/执行/网络参数能力。
- `evm` 的 read/compose/execute/workflow 逻辑有大量可复用部分：
  - `evmNetworkSchema`
  - `parseEvmNetwork`
  - `getEvmRpcEndpoint`
  - `getEvmChainId`
  - `isMainnetLikeEvmNetwork`
- 与其为每条链维护重复栈，不如采用「**一套 EVM 工具 + 网络枚举配置化参数**」方案：
  - 新增链只加网络配置（chainId/RPC/别名），减少重复实现。
  - 风控（`confirmMainnet`、`confirmToken`）集中统一治理。

## 当前 BSC 对齐做法（已落地）

已完成的 BSC 对齐为：

- 在 `EvmNetwork` 与 `evmNetworkSchema` 中加入 `bsc`
- `parseEvmNetwork` 支持 `bsc`
- 默认 RPC/chainId 覆盖（`https://bsc.publicnode.com`，chainId=56）
- 转账层补齐 BSC 别名（`parseEvmNetworkAlias` 支持 `bsc`/`bnb`）与主流地址映射（`USDT`/`WETH`）
- 新增 BSC DeFi 执行入口 `evm_pancakeV2Swap`（单跳 PancakeSwap V2 直连 pair 报价/交易）
- 新增对应 NL 工作流 `w3rt_run_evm_swap_workflow_v0`（分析→模拟→执行）
- 主网门禁统一改为 `isMainnetLikeEvmNetwork(network)`，避免逐工具重复写死

## BSC DeFi 接入优先级（当前阶段）

为了优先支持"主流 DeFi 产品"发现能力，当前先接入了 **DexScreener 聚合入口**（`evm_dexscreenerPairs` / `evm_dexscreenerTokenPairs`）：

- 优点：
  - 覆盖主流 DEX（包括 PancakeSwap）市场/交易对信息。
  - 提供按网络与 DEX 的过滤与按流动性排序，作为 BSC DeFi 入口。
  - 对外部单点源不稳定（如某些专网/API）有天然兜底能力：可优先退回到通用市场发现。
- 下一步可在该能力上增强：
  - 多跳路径与中间池路由（覆盖非直接 pair 场景）
  - 添加额度/滑点前置校验与可选签名前置授权（allowance）判断
  - 资产级别的 DEX 过滤策略和健康检查（如链上 TVL/稳定性）
  - 抽出可复用 `evm_deFi` 协议配置层，承接更多 BSC DEX（如 Biswap / MDEX）

## 签名后端：Signer Provider 抽象

> 详见 `docs/bsc-borrowbot-gap.md` § 0.1

EVM 签名从 `ethers.Wallet` 硬绑定改为 **`EvmSignerProvider` 接口**，支持两种后端：

1. **`LocalKeySigner`**（开发/测试）：封装 `ethers.Wallet` + `EVM_PRIVATE_KEY`，向后兼容现有行为。
2. **`PrivyEvmSigner`**（生产推荐）：通过 Privy Server SDK（`@privy-io/node`）远程签名，Agent 不接触私钥。

Privy 的 EVM 交易通过 CAIP-2 标识符选链（`eip155:56` = BSC, `eip155:80094` = Berachain, ...），一个钱包 ID 可在所有 EVM 链上操作。Protocol Adapter 只返回 `EvmCallData`（未签名 calldata），签名职责在 Signer Provider 层。

Privy 额外提供 **Policy 层**（合约白名单、chain_id 限制、金额上限），作为 workflow 层门控之外的密钥级安全防线。

## 何时考虑拆文件夹

当某条链出现"非共享行为"明显增大（如专用签名/交易构造/地址体系/鉴权流程）时，再按能力分层抽出子目录，例如：

- `src/chains/evm/networks/<network>/`（网络配置层）
- `src/chains/evm/apps/polymarket/`（应用能力层）
- `src/chains/evm/apps/defi/<protocol>/`（应用协议层）

在当前阶段，继续保持单一 EVM 工具层更易控、修改成本更低。