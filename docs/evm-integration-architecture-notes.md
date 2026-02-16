# EVM 集成架构记录（包含 Polymarket 与 BSC 对齐）

## 为什么目前不按 `evm/polygon`、`evm/bsc` 再切目录

本仓库目前将 EVM 相关能力统一放在 `src/chains/evm/*` 下，而不是按链再建子目录，原因是：

- `polymarket` 是**业务能力（应用层）**，不是一条链；它恰好目前默认使用 Polygon 的 CLOB/交易所能力，但本质仍依赖 EVM 通用签名/执行/网络参数能力。
- `evm` 的 read/compose/execute/workflow 逻辑有大量可复用部分（
  `evmNetworkSchema` / `parseEvmNetwork` / `getEvmRpcEndpoint` / `getEvmChainId` / `isMainnetLikeEvmNetwork` 等）。
- 与其为每条链维护重复工具，当前采用「**一套 EVM 工具 + 网络枚举与配置化参数**」方案：
  - 新增链时只加网络配置（chainId/RPC/别名），无需新建重复工具栈。
  - 风险控制（`confirmMainnet`、`confirmToken`）可在统一层进行统一治理。

## 本次 BSC 对齐的当前做法

- 在 `EvmNetwork` 中新增 `bsc`，并补齐：
  - `parseEvmNetwork` 支持
  - RPC 默认值（`EVM_RPC_BSC_URL` 可覆盖）
  - chainId（56）
- 交易映射/转账映射中补充 BSC 常见 token 地址入口（可由环境变量覆盖）。
- 主网确认门禁改为 `isMainnetLikeEvmNetwork(network)`，由统一策略控制。

## 何时考虑拆文件夹

当某条链出现“非共享行为”非常大（如专用签名/交易构造/地址体系/鉴权流程）时，再按能力分层抽出子目录，例如：

- `src/chains/evm/networks/<network>/`（网络配置层）
- `src/chains/evm/apps/polymarket/`（应用能力层）

在当前阶段，按现状保持单一 EVM 工具层更易控、修改成本更低。