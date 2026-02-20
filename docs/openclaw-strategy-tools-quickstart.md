# OpenClaw Strategy Tools Quickstart

面向 OpenClaw 会话直接调用（无需手写脚本）。

## 可用工具

- `pct_strategy_compile`
- `pct_strategy_validate`
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
