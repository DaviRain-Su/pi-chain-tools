# OpenClaw Strategy Tools Quickstart

面向 OpenClaw 会话直接调用（无需手写脚本）。

## 可用工具

- `pct_strategy_compile`
- `pct_strategy_validate`
- `pct_strategy_templates`
- `pct_strategy_run`
- `pct_strategy_track`

## 1) 生成策略

调用 `pct_strategy_compile`：

```json
{
  "template": "rebalance-crosschain-v0",
  "payload": {
    "asset": "USDC",
    "fromChain": "base",
    "toChain": "bsc",
    "maxPerRunUsd": 100
  }
}
```

## 2) 校验策略

把上一步返回的 `strategy` 对象传给 `pct_strategy_validate`：

```json
{
  "spec": { "...": "strategy object from compile" }
}
```

## 3) 执行前准备（推荐）

`pct_strategy_run` 使用 `mode=execute` 但不 live：

```json
{
  "spec": { "...": "validated strategy" },
  "mode": "execute",
  "confirmExecuteToken": "I_ACKNOWLEDGE_EXECUTION",
  "prepareQuote": true,
  "quoteContext": {
    "fromToken": "0x...",
    "toToken": "0x...",
    "fromAmount": "1000000",
    "fromAddress": "0x...",
    "toAddress": "0x...",
    "slippage": 0.03,
    "order": "RECOMMENDED"
  }
}
```

返回包含：
- `status: ready|blocked`
- `executeIntent`
- `quotePlan`（当 `prepareQuote=true` 且 ready）

## 4) live 模式（小额受控）

当前策略：
- 单次上限：`100 USD`
- 双确认 token：
  - `confirmExecuteToken = I_ACKNOWLEDGE_EXECUTION`
  - `liveConfirmToken = I_ACKNOWLEDGE_LIVE_EXECUTION`

若超限或 token 缺失，会返回 `status=blocked`。

## 5) 状态跟踪

拿到链上 txHash 后调用 `pct_strategy_track`：

```json
{
  "txHash": "0x...",
  "fromNetwork": "base",
  "toNetwork": "bsc"
}
```

返回 LI.FI 状态对象（PENDING / DONE / FAILED / REFUNDED 等）。


## 6) stable-yield-v1（默认闭环）

当 `spec.metadata.template = "stable-yield-v1"` 且 `mode=execute + live=true` 时：

- 默认会走 `prepareQuote`
- 默认优先 `autoSign`（若未提供 `signedTxHex`）
- 默认 `trackAfterBroadcast`
- 默认 evidence 落盘到 `docs/execution-proofs/YYYY-MM-DD/*.json`

CLI 快速烟测：

```bash
npm run stable-yield:smoke
```

自动迁移 v1（BSC，Venus USDC/USDT 二选一，按 supply APY 迁移）：

```bash
# 先看计划（默认 dry-run）
npm run stable-yield:auto-migrate:v1

# 真执行（带确认 token）
npm run stable-yield:auto-migrate:v1 -- --execute true --confirm I_ACKNOWLEDGE_AUTO_MIGRATE --maxMoveUsd 5 --allowSwap true

# 建议阈值（避免频繁抖动迁移）
# minApyDeltaBps: 至少高 20 bps 才迁
# minMoveUsd: 少于 1U 不迁
npm run stable-yield:auto-migrate:v1 -- --maxMoveUsd 5 --minApyDeltaBps 20 --minMoveUsd 1 --allowSwap true
```

每 30 分钟自动评估并在满足阈值时执行：

```bash
npm run stable-yield:auto-migrate:v1:cron-install
# logs: logs/stable-yield-auto-migrate.log
```

v2 增强（多协议比较入口）：

```bash
# v2 支持读取 Venus + 外部注入 APY（Lista/Wombat），并给出最优市场建议
npm run stable-yield:auto-migrate:v2 -- --maxMoveUsd 5 --minApyDeltaBps 20

# 可通过参数/环境注入外部APY用于比较
npm run stable-yield:auto-migrate:v2 -- --listaUsdtApy 1.8 --wombatUsdtApy 1.2

# 当 best market 是 lista/wombat，且对应 execute enabled 时，v2 会调用 dashboard 执行端点自动实盘迁移
# 可指定 dashboard 地址
npm run stable-yield:auto-migrate:v2 -- --execute true --dashboardBaseUrl http://127.0.0.1:4173

# 安装 v2 cron（每30分钟评估一次）
npm run stable-yield:auto-migrate:v2:cron-install
# logs: logs/stable-yield-auto-migrate-v2.log
# last json: logs/stable-yield-auto-migrate-v2-last.json
```

BSC 配置向导支持自动发现候选池（需提前配置候选地址列表）：

```bash
# 逗号分隔多个候选池
BSC_LISTA_POOL_CANDIDATES=0x...,0x...
BSC_WOMBAT_POOL_CANDIDATES=0x...,0x...
```


## 0) 查看可上架策略模板（Market Manifests）

调用 `pct_strategy_templates`：

```json
{}
```

查看某个模板：

```json
{ "template": "stable-yield-v1" }
```


模板 manifest 现在包含市场筛选字段：
- `visibility`
- `status`
- `riskTier`
- `recommendedMinUsd` / `recommendedMaxUsd`
- `strategyType`

可过滤列表：
```json
{ "riskTier": "low", "strategyType": "yield", "status": "active" }
```

支持排序与分页：
```json
{ "sortBy": "recommendedMinUsd", "sortOrder": "asc", "limit": 10, "offset": 0 }
```

支持关键词搜索：
```json
{ "q": "stable" }
```
