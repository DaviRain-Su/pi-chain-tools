# OpenClaw ACP Quickstart (Gradience)

This guide shows the minimal production-safe bootstrap for using `pi-chain-tools` with OpenClaw via ACP tools.

## 1) Install and load extension

```bash
pi install https://github.com/DaviRain-Su/pi-chain-tools
```

In Pi/OpenClaw session:

```text
/reload
```

## 2) ACP handshake and capability discovery

Call handshake tool first:

- tool: `w3rt_getCapabilityHandshake_v0`
- recommended params:

```json
{
  "clientName": "openclaw-agent",
  "clientVersion": "0.1.0",
  "includeCapabilities": true,
  "executableOnly": true,
  "maxRisk": "medium"
}
```

Read from `details`:

- `protocol`: discovery and summary schemas
- `capabilityDigest`: chain/workflow/intent counts
- `policyDigest`: current transfer policy mode
- `bootstrap`: recommended startup sequence for OpenClaw

## 3) Transfer policy hardening (recommended)

Before enabling execute on EVM transfer tools, apply production-safe template:

- tool: `w3rt_setPolicy_v0`

```json
{
  "scope": "evm.transfer",
  "template": "production_safe",
  "updatedBy": "openclaw-agent",
  "note": "production bootstrap"
}
```

Verify:

- tool: `w3rt_getPolicy_v0`
- optional audit verify tool: `w3rt_getPolicyAudit_v0` (for example `{"scope":"evm.transfer","limit":5}`)

Optional symbol map override (when a network token address differs from defaults):

```bash
export EVM_TRANSFER_TOKEN_MAP_BASE='{"USDT":"0x1111111111111111111111111111111111111111"}'
export EVM_TRANSFER_TOKEN_DECIMALS='{"USDT":6}'
```

Inspect effective mapping in agent:

- tool: `evm_getTransferTokenMap` (example params: `{"network":"base"}`)

## 4) First workflows

### Polymarket BTC 5m (trade + optional stale-requote)

For production-safe usage, run workflows in **analysis -> simulate -> execute** with a fixed `runId`.

1) Optional preflight reads to choose a market:

- `evm_polymarketGetBtc5mMarkets` (find active BTC 5m markets)
- `evm_polymarketGetBtc5mAdvice` (AI-style side/confidence)
- `evm_polymarketGetOrderbook` (validate orderbook and spread)
- `evm_polymarketBuildBtc5mOrder` (unsigned intent preview, no signer required)

2) Trade analysis:

```json
{
  "runMode": "analysis",
  "runId": "wf-btc5m-01",
  "network": "polygon",
  "intentType": "evm.polymarket.btc5m.trade",
  "stakeUsd": 20,
  "maxSpreadBps": 120,
  "minDepthUsd": 100,
  "minConfidence": 0.6,
  "useAiAssist": true,
  "requoteStaleOrders": true,
  "requotePriceStrategy": "aggressive",
  "requoteFallbackMode": "retry_aggressive",
  "maxFillRatio": 0.4,
  "maxAgeMinutes": 30,
  "requoteMaxAttempts": 5,
  "requoteMaxPriceDriftBps": 50
}
```

3) Simulate (same `runId`):

```json
{
  "runMode": "simulate",
  "runId": "wf-btc5m-01",
  "network": "polygon"
}
```

4) Execute (same `runId`, using confirm token from analysis/simulate details):

- response detail returns `confirmToken` (for example `EVM-...`) once analysis/simulate run succeeds

```json
{
  "runMode": "execute",
  "runId": "wf-btc5m-01",
  "network": "polygon",
  "confirmMainnet": true,
  "confirmToken": "EVM-..."
}
```

> On `polygon`, `confirmMainnet=true` is required for actual execute. OpenClaw can pass `confirmToken` via tool parameters or in free-form `intentText` like `确认码 EVM-...`.

### Polymarket BTC 5m cancel workflow

Use cancel intent to clear stale/open orders without manually selecting token pair again:

- analysis:

```json
{
  "runMode": "analysis",
  "runId": "wf-btc5m-cancel-01",
  "network": "polygon",
  "intentType": "evm.polymarket.btc5m.cancel",
  "marketSlug": "btc-5m-xxxx",
  "maxFillRatio": 0.2,
  "maxAgeMinutes": 15
}
```

- simulate/execute:

```json
{
  "runMode": "simulate",
  "runId": "wf-btc5m-cancel-01",
  "network": "polygon"
}
```

```json
{
  "runMode": "execute",
  "runId": "wf-btc5m-cancel-01",
  "network": "polygon",
  "confirmMainnet": true,
  "confirmToken": "EVM-..."
}
```

If you already have order IDs, you can replace `marketSlug` with:

- `orderId`: single id string
- `orderIds`: list of order IDs
- `cancelAll: true`: cancel all BTC5m open BTC orders in scope

### Transfer workflow

- analysis:

```json
{
  "runMode": "analysis",
  "network": "polygon",
  "intentType": "evm.transfer.native",
  "toAddress": "0x000000000000000000000000000000000000dEaD",
  "amountNative": 0.001
}
```

- execute requires:

  - `confirmMainnet=true`
  - correct `confirmToken`
  - recipient passes transfer policy (allowlist mode)

- symbol-based ERC20 analysis (no explicit tokenAddress needed for mapped symbols/networks):

```json
{
  "runMode": "analysis",
  "network": "base",
  "intentText": "把 2.5 USDC 转给 0x000000000000000000000000000000000000dEaD，先分析"
}
```

## 5) Natural-language prompts

- `帮我分析 BTC 5m，建议买涨还是买跌`
- `用 20 美元先分析 BTC5m 下单，spread<1.2%，深度要求 100 美元，最小置信 0.6`
- `先把刚才的 BTC5m 分析和模拟跑一遍`
- `继续执行刚才这笔，确认主网执行`
- `继续执行，确认码 EVM-...`
- `把超时 30 分钟且未成交率<40%的 BTC5m 挂单全部撤掉，再确认主网执行`

## 6) OpenClaw Agent Template (copy-paste)

Use this template in an OpenClaw system workflow or playbook engine:

### 1. Bootstrap

- `w3rt_getCapabilityHandshake_v0`
- `w3rt_getPolicy_v0`
- `w3rt_setPolicy_v0` (optional, set production-safe transfer policy)

### 2. BTC5m trade playbook (reliable 3-phase)

```json
{
  "steps": [
    {
      "name": "preflight-markets",
      "tool": "evm_polymarketGetBtc5mMarkets",
      "params": { "network": "polygon", "limit": 3 }
    },
    {
      "name": "preflight-advice",
      "tool": "evm_polymarketGetBtc5mAdvice",
      "params": { "network": "polygon" }
    },
    {
      "name": "analysis",
      "tool": "w3rt_run_evm_polymarket_workflow_v0",
      "params": {
        "runMode": "analysis",
        "runId": "wf-btc5m-01",
        "network": "polygon",
        "intentType": "evm.polymarket.btc5m.trade",
        "stakeUsd": 20,
        "maxSpreadBps": 120,
        "minDepthUsd": 100,
        "minConfidence": 0.6,
        "useAiAssist": true,
        "requoteStaleOrders": true
      }
    },
    {
      "name": "simulate",
      "tool": "w3rt_run_evm_polymarket_workflow_v0",
      "params": {
        "runMode": "simulate",
        "runId": "wf-btc5m-01",
        "network": "polygon"
      }
    },
    {
      "name": "execute",
      "tool": "w3rt_run_evm_polymarket_workflow_v0",
      "params": {
        "runMode": "execute",
        "runId": "wf-btc5m-01",
        "network": "polygon",
        "confirmMainnet": true,
        "confirmToken": "${analysis.confirmToken}"
      },
      "guard": [
        "analysis step must include details.confirmToken and not throw"
      ]
    }
  ]
}
```

### 3. BTC5m cancel playbook

```json
{
  "steps": [
    {
      "tool": "w3rt_run_evm_polymarket_workflow_v0",
      "params": {
        "runMode": "analysis",
        "runId": "wf-btc5m-cancel-01",
        "network": "polygon",
        "intentType": "evm.polymarket.btc5m.cancel",
        "maxFillRatio": 0.2,
        "maxAgeMinutes": 15,
        "cancelAll": true
      }
    },
    {
      "tool": "w3rt_run_evm_polymarket_workflow_v0",
      "params": {
        "runMode": "simulate",
        "runId": "wf-btc5m-cancel-01",
        "network": "polygon"
      }
    },
    {
      "tool": "w3rt_run_evm_polymarket_workflow_v0",
      "params": {
        "runMode": "execute",
        "runId": "wf-btc5m-cancel-01",
        "network": "polygon",
        "confirmMainnet": true,
        "confirmToken": "${analysis.confirmToken}"
      }
    }
  ]
}
```

### 4. Playbook run rules

- If `runMode:analysis` or `runMode:simulate` fails guard (`guard_blocked` / `no_liquidity` / `price_too_high`), stop and notify operator, do not execute.
- Read from artifact JSON paths:
  - `details.confirmToken`
  - `details.artifacts.analysis.summary`
  - `details.artifacts.simulate.summary`
- Keep `runId` stable per ticket:
  - one ticket = one `runId`, so `simulate/execute` can reuse context.
- For NL-driven follow-up, agent may pass `intentText` with `确认码 EVM-...` and/or `确认主网执行` instead of separate param fields.

## 7) OpenClaw 状态机模板（生产编排器可直接复用）

下面给出一个更贴近编排器的 JSON 状态机示例（可改造成你的 OpenClaw workflow DSL）：

```json
{
  "version": "1.0",
  "workflow": {
    "id": "polymarket-btc5m-ticket",
    "description": "BTC5m trade with 3-phase safety check",
    "input": {
      "runId": "wf-btc5m-01",
      "network": "polygon",
      "stakeUsd": 20,
      "maxSpreadBps": 120,
      "minDepthUsd": 100,
      "minConfidence": 0.6,
      "intentType": "evm.polymarket.btc5m.trade",
      "useAiAssist": true,
      "requoteStaleOrders": true,
      "maxFillRatio": 0.4
    },
    "states": {
      "analysis": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": {
          "runMode": "analysis",
          "runId": "{{state.input.runId}}",
          "network": "{{state.input.network}}",
          "intentType": "{{state.input.intentType}}",
          "stakeUsd": "{{state.input.stakeUsd}}",
          "maxSpreadBps": "{{state.input.maxSpreadBps}}",
          "minDepthUsd": "{{state.input.minDepthUsd}}",
          "minConfidence": "{{state.input.minConfidence}}",
          "useAiAssist": "{{state.input.useAiAssist}}",
          "requoteStaleOrders": "{{state.input.requoteStaleOrders}}",
          "maxFillRatio": "{{state.input.maxFillRatio}}"
        },
        "onSuccess": {
          "to": "simulate",
          "assign": {
            "confirmToken": "{{result.details.confirmToken}}",
            "status": "{{result.details.artifacts.analysis.status}}"
          }
        },
        "onFailure": {
          "to": "alarm",
          "if": "true",
          "error": "analysis_failed"
        },
        "guard": {
          "stopIf": [
            "result.content[0].text includes 'blocked'",
            "result.details.artifacts.analysis.status in ['guard_blocked','no_liquidity','price_too_high']"
          ]
        }
      },
      "simulate": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": {
          "runMode": "simulate",
          "runId": "{{state.input.runId}}",
          "network": "{{state.input.network}}"
        },
        "onSuccess": {
          "to": "execute_guard",
          "assign": {
            "simulateStatus": "{{result.details.artifacts.simulate.status}}"
          }
        },
        "onFailure": {
          "to": "alarm",
          "if": "true",
          "error": "simulate_failed"
        }
      },
      "execute_guard": {
        "type": "condition",
        "expression": "Boolean(state.confirmToken) && !(state.simulateStatus in ['guard_blocked', 'no_liquidity', 'price_too_high'])",
        "onTrue": { "to": "execute" },
        "onFalse": { "to": "alarm" }
      },
      "execute": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": {
          "runMode": "execute",
          "runId": "{{state.input.runId}}",
          "network": "{{state.input.network}}",
          "confirmMainnet": true,
          "confirmToken": "{{state.confirmToken}}"
        },
        "onSuccess": {
          "to": "done"
        },
        "onFailure": {
          "to": "alarm",
          "if": "true",
          "error": "execute_failed"
        }
      },
      "alarm": {
        "type": "manual",
        "notify": "{{error.message}}",
        "needOperator": true
      },
      "done": {
        "type": "terminal",
        "result": "complete"
      }
    },
    "startAt": "analysis",
    "finalState": "done"
  }
}
```

### 可直接落地的执行约束

在上面的状态机里，建议在运行时加 3 条约束（可放在 OpenClaw 的节点中间件）：

1. **同一 runId 回放约束**：
   - `analysis/simulate/execute` 必须复用同一个 `runId`。
   - 不可在 execute 时换意图或网络。
2. **确认口令约束**：
   - execute 前必须检查 `state.confirmToken` 存在；
   - 如未通过，直接进入 `alarm` 并提示“确认码缺失/过期”。
3. **风险停摆约束**：
   - 在 `analysis` 和 `simulate` 任何出现 `guard_blocked/no_liquidity/price_too_high` 均阻断执行分支。

### 与现有工具参数的映射

| 状态机字段 | 对应工具字段 |
|---|---|
| `state.input.runId` | `runId` |
| `state.input.network` | `network` |
| `state.input.stakeUsd` | `stakeUsd` |
| `state.input.maxSpreadBps` | `maxSpreadBps` |
| `state.input.minDepthUsd` | `minDepthUsd` |
| `state.input.minConfidence` | `minConfidence` |
| `state.confirmToken` | `confirmToken` |
| `state.confirmToken` 缺失 | `alarm` |

### 适配到 OpenClaw 的最小规则示例（伪 YAML）

```yaml
- name: preflight_market
  tool: evm_polymarketGetBtc5mMarkets
  args: { network: polygon, limit: 3 }

- name: analyze
  tool: w3rt_run_evm_polymarket_workflow_v0
  args:
    runMode: analysis
    runId: "wf-btc5m-{{ticket.id}}"
    network: polygon
    intentType: evm.polymarket.btc5m.trade
    stakeUsd: 20
  on_success_set:
    - confirmToken: $.details.confirmToken
    - analyzeStatus: $.details.artifacts.analysis.status
  on_success_if: "result.details.artifacts.analysis.status in ['ready']"
  on_skip: notify_and_halt

- name: simulate
  depends_on: analyze
  tool: w3rt_run_evm_polymarket_workflow_v0
  args:
    runMode: simulate
    runId: "wf-btc5m-{{ticket.id}}"
    network: polygon
  on_success_set:
    - simulateStatus: $.details.artifacts.simulate.status

- name: execute
  depends_on: simulate
  if: "ctx.confirmToken != null"
  tool: w3rt_run_evm_polymarket_workflow_v0
  args:
    runMode: execute
    runId: "wf-btc5m-{{ticket.id}}"
    network: polygon
    confirmMainnet: true
    confirmToken: "{{ctx.confirmToken}}"
```

### 生产建议（高可用）

- 将模拟失败与防护失败归类为 `ALERT`；执行分支默认不自动重试。
- `requoteStaleOrders=true` 时执行时间变长，建议给 `simulate/execute` 预留 60~120s 超时窗。
- 可在成功 execute 后追加轮询 `evm_polymarketGetOrderStatus`，把 `orderStatus` 存档到工单上下文。

### 8) Agent-friendly artifact contract (for OpenClaw runtime)

Recommended context schema for each `runId`:

```json
{
  "runId": "wf-btc5m-01",
  "network": "polygon",
  "intentType": "evm.polymarket.btc5m.trade",
  "intent": {
    "type": "evm.polymarket.btc5m.trade",
    "side": "up",
    "stakeUsd": 20,
    "status": "ready"
  },
  "confirmToken": "EVM-...",
  "confirmMainnet": true,
  "phase": "analysis|simulate|execute",
  "analysisStatus": "ready|guard_blocked|no_liquidity|price_too_high",
  "simulateStatus": "ready|guard_blocked|no_liquidity|price_too_high",
  "guardEvaluation": {
    "passed": true,
    "issues": [],
    "metrics": {
      "spreadBps": 38,
      "depthUsdAtLimit": 120,
      "adviceConfidence": 0.72
    }
  },
  "order": {
    "tokenId": "...",
    "marketSlug": "btc-updown-5m-...",
    "limitPrice": 0.5123,
    "estimatedShares": 39.0438,
    "orderId": "optional-after-execute"
  },
  "riskProfile": "balanced",
  "requote": {
    "enabled": true,
    "status": "disabled|ready|throttled|max_attempts_reached|volatility_blocked",
    "referencePrice": 0.5121,
    "attemptsUsed": 1,
    "maxAttempts": 5
  },
  "lastError": null,
  "artifacts": {
    "analysis": {},
    "simulate": {},
    "execute": {}
  }
}
```

Use this state object as the minimum payload between nodes:

- `confirmToken` required for execute.
- `guardEvaluation.passed === false` => no-op/notify (do not execute).
- `simulateStatus` should be checked again before execute if operator has modified inputs.
- Store `orderId` and `orderStatus` after execute for audit/retry suppression logic.

### 9) 可直接复制的 OpenClaw 全链路 JSON（含预检+下单+撤单+结清）

> 说明：以下是一个可执行的“生产级可复制”草稿（按你的 OpenClaw 编排 DSL 语法微调即可），把 `ticketId`、`runId` 等替换为实际工单上下文字段。

```json
{
  "version": "1.0",
  "workflow": {
    "id": "btc5m-orchestrator-v1",
    "description": "Preflight -> BTC5m trade -> optional settle(cancel stale) -> optional cancel workflow",
    "startAt": "preflight_markets",
    "input": {
      "runId": "wf-btc5m-{{ticket.id}}",
      "network": "polygon",
      "intentType": "evm.polymarket.btc5m.trade",
      "stakeUsd": 20,
      "side": "up",
      "maxSpreadBps": 120,
      "minDepthUsd": 100,
      "maxStakeUsd": 300,
      "minConfidence": 0.6,
      "marketSlug": "",
      "settleAfterTrade": true,
      "settleMaxAgeMinutes": 30,
      "settleMaxFillRatio": 0.4,
      "cancelOnDemand": false
    },
    "states": {
      "preflight_markets": {
        "type": "tool",
        "tool": "evm_polymarketGetBtc5mMarkets",
        "params": { "network": "{{state.input.network}}", "limit": 5 },
        "onSuccess": { "to": "preflight_advice" },
        "onFailure": { "to": "alarm", "error": "market_list_failed" }
      },
      "preflight_advice": {
        "type": "tool",
        "tool": "evm_polymarketGetBtc5mAdvice",
        "params": { "network": "{{state.input.network}}" },
        "onSuccess": {
          "to": "route_intent",
          "assign": {
            "adviceSide": "{{result.details.advice?.side}}",
            "adviceConfidence": "{{result.details.confidence}}"
          }
        },
        "onFailure": { "to": "alarm", "error": "advice_failed" }
      },
      "route_intent": {
        "type": "condition",
        "expression": "state.input.intentType === 'evm.polymarket.btc5m.cancel' || state.input.cancelOnDemand === true",
        "onTrue": { "to": "cancel_analysis" },
        "onFalse": { "to": "trade_analysis" }
      },
      "trade_analysis": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": {
          "runMode": "analysis",
          "runId": "{{state.input.runId}}",
          "network": "{{state.input.network}}",
          "intentType": "evm.polymarket.btc5m.trade",
          "side": "{{state.input.side || state.adviceSide}}",
          "stakeUsd": "{{state.input.stakeUsd}}",
          "maxSpreadBps": "{{state.input.maxSpreadBps}}",
          "minDepthUsd": "{{state.input.minDepthUsd}}",
          "maxStakeUsd": "{{state.input.maxStakeUsd}}",
          "minConfidence": "{{state.input.minConfidence}}",
          "marketSlug": "{{state.input.marketSlug}}",
          "useAiAssist": true,
          "requoteStaleOrders": true,
          "requoteFallbackMode": "retry_aggressive",
          "requoteMaxAttempts": 5,
          "maxFillRatio": "{{state.input.maxFillRatio || 0.4}}",
          "maxAgeMinutes": "{{state.input.maxAgeMinutes || 30}}"
        },
        "onSuccess": {
          "to": "trade_simulate",
          "assign": {
            "confirmToken": "{{result.details.confirmToken}}",
            "analysisStatus": "{{result.details.artifacts.analysis.summary.status}}",
            "analysisGuardPassed": "{{result.details.artifacts.analysis.guardEvaluation.passed}}"
          }
        },
        "onFailure": { "to": "alarm", "error": "trade_analysis_failed" }
      },
      "trade_simulate": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": {
          "runMode": "simulate",
          "runId": "{{state.input.runId}}",
          "network": "{{state.input.network}}"
        },
        "onSuccess": {
          "to": "trade_execute_guard",
          "assign": {
            "simulateStatus": "{{result.details.artifacts.simulate.summary.status}}",
            "staleRequoteStatus": "{{result.details.artifacts.simulate.staleRequote.status}}"
          }
        },
        "onFailure": { "to": "alarm", "error": "trade_simulate_failed" }
      },
      "trade_execute_guard": {
        "type": "condition",
        "expression": "Boolean(state.confirmToken) && state.analysisStatus === 'ready' && state.simulateStatus === 'ready' && state.analysisGuardPassed === true",
        "onTrue": { "to": "trade_execute" },
        "onFalse": { "to": "alarm", "error": "trade_guard_blocked" }
      },
      "trade_execute": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": {
          "runMode": "execute",
          "runId": "{{state.input.runId}}",
          "network": "{{state.input.network}}",
          "confirmMainnet": true,
          "confirmToken": "{{state.confirmToken}}"
        },
        "onSuccess": {
          "to": "poll_order_status",
          "assign": {
            "orderId": "{{result.details.artifacts.execute.orderId}}",
            "orderStatus": "{{result.details.artifacts.execute.orderStatus}}",
            "executeSummary": "{{result.details.artifacts.execute.summary}}"
          }
        },
        "onFailure": { "to": "alarm", "error": "trade_execute_failed" }
      },
      "poll_order_status": {
        "type": "tool",
        "tool": "evm_polymarketGetOrderStatus",
        "params": {
          "network": "{{state.input.network}}",
          "orderId": "{{state.orderId}}",
          "includeTrades": true,
          "maxTrades": 20
        },
        "onSuccess": {
          "to": "trade_settle_gate",
          "assign": {
            "postOrderState": "{{result.details.orderState}}",
            "postFillRatio": "{{result.details.size ? result.details.fillAmount / result.details.size : null}}"
          }
        },
        "onFailure": { "to": "alarm", "error": "order_status_failed" }
      },
      "trade_settle_gate": {
        "type": "condition",
        "expression": "state.input.settleAfterTrade === true",
        "onTrue": { "to": "settle_cancel_analysis" },
        "onFalse": { "to": "done" }
      },
      "settle_cancel_analysis": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": {
          "runMode": "analysis",
          "runId": "{{state.input.runId}}-settle",
          "network": "{{state.input.network}}",
          "intentType": "evm.polymarket.btc5m.cancel",
          "maxFillRatio": "{{state.input.settleMaxFillRatio}}",
          "maxAgeMinutes": "{{state.input.settleMaxAgeMinutes}}"
        },
        "onSuccess": { "to": "settle_cancel_simulate", "assign": { "settleConfirmToken": "{{result.details.confirmToken}}" } },
        "onFailure": { "to": "alarm", "error": "settle_analysis_failed" }
      },
      "settle_cancel_simulate": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": { "runMode": "simulate", "runId": "{{state.input.runId}}-settle", "network": "{{state.input.network}}" },
        "onSuccess": { "to": "settle_cancel_execute" },
        "onFailure": { "to": "alarm", "error": "settle_simulate_failed" }
      },
      "settle_cancel_execute": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": {
          "runMode": "execute",
          "runId": "{{state.input.runId}}-settle",
          "network": "{{state.input.network}}",
          "confirmMainnet": true,
          "confirmToken": "{{state.settleConfirmToken}}"
        },
        "onSuccess": { "to": "done" },
        "onFailure": { "to": "alarm", "error": "settle_execute_failed" }
      },
      "cancel_analysis": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": {
          "runMode": "analysis",
          "runId": "{{state.input.runId}}-cancel",
          "network": "{{state.input.network}}",
          "intentType": "evm.polymarket.btc5m.cancel",
          "cancelAll": true,
          "maxFillRatio": "{{state.input.maxFillRatio || 0.2}}",
          "maxAgeMinutes": "{{state.input.maxAgeMinutes || 30}}"
        },
        "onSuccess": {
          "to": "cancel_simulate",
          "assign": {
            "cancelConfirmToken": "{{result.details.confirmToken}}"
          }
        },
        "onFailure": { "to": "alarm", "error": "cancel_analysis_failed" }
      },
      "cancel_simulate": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": {
          "runMode": "simulate",
          "runId": "{{state.input.runId}}-cancel",
          "network": "{{state.input.network}}"
        },
        "onSuccess": { "to": "cancel_execute" },
        "onFailure": { "to": "alarm", "error": "cancel_simulate_failed" }
      },
      "cancel_execute": {
        "type": "tool",
        "tool": "w3rt_run_evm_polymarket_workflow_v0",
        "params": {
          "runMode": "execute",
          "runId": "{{state.input.runId}}-cancel",
          "network": "{{state.input.network}}",
          "confirmMainnet": true,
          "confirmToken": "{{state.cancelConfirmToken}}"
        },
        "onSuccess": { "to": "done" },
        "onFailure": { "to": "alarm", "error": "cancel_execute_failed" }
      },
      "alarm": {
        "type": "manual",
        "message": "ALERT - action halted by policy/manual review",
        "needOperator": true
      },
      "done": {
        "type": "terminal",
        "result": "complete"
      }
    }
  }
}
```

说明：

- `cancelOnDemand=true` 时，直接走撤单分支。
- `settleAfterTrade=true` 时，trade 成功后会按 `maxAgeMinutes` / `maxFillRatio` 做一次结清清场（可选）。
- `poll_order_status` 中 `postFillRatio` 可用于你自定义 `filled/partial` 决策（例如：
  - 当 `fill<0.2` 且剩余 > 一段时间，触发另一个 `evm_polymarketCancelOrder`。
）

### 10) 失败恢复白名单（可直接贴到 OpenClaw 重试策略）

#### 白名单（建议允许自动重试）

| 失败类型 | 命中规则（error contains） | 重试次数 | 推荐动作 |
|---|---|---:|---|
| 上游网络抖动 | `timeout`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `fetch`, `network` | 3 | 指数退避（1s/2s/4s）重试 `analysis/simulate/execute` |
| 节点限流/临时不可用 | `429`, `502`, `503`, `504`, `service unavailable`, `temporarily` | 2~3 | 重试 `simulate/execute`，并拉长间隔到 10~20s |
| 签名路径抖动 | `nonce too low`, `replacement transaction underpriced` | 1~2 | 先等待一个区块再重试 `execute`（有手续费问题请转人工） |

#### 黑名单（不建议自动重试，直接告警/人工）

| 失败类型 | 示例错误 | 处理 |
|---|---|---|
| 资金安全停摆 | `no_liquidity`, `price_too_high`, `guard_blocked` | 进入 `ALERT`，不自动重试。需人工确认是否放宽风险参数后重新分析。 |
| 主网确认缺失 | `Mainnet execute blocked`, `Invalid confirmToken` | 需人工确认 `confirmMainnet=true` + 正确 `confirmToken` |
| 签名/密钥缺失 | `No Polymarket private key`, `funder`, `POLYMARKET_PRIVATE_KEY` | 需补齐凭证后重试 |
| 环境限制 | `geoblock`, `region blocked`, `country` | 先确认执行环境 IP/region 后再手工恢复 |
| 入参不合法 | `market slug is required`, `orderId cannot be empty`, `Cannot resolve tokenId`, `Invalid order size`, `bestAsk exceeds` | 按错误修复参数后再发起新 run（一般不重试） |
| 交易受阻（可重复触发） | `requires maxEntryPrice` / `orderbook missing` / `spread is too wide` | 不自动重试，需更新策略参数后回到 `analysis` |
| 依赖问题 | `createauthedclobclient`, `CLOB client method` | 检查本地依赖/运行环境，修复后再试 |

#### 推荐的 OpenClaw 失败路由（可直接实现）

```json
{
  "retryPolicy": {
    "retryableErrorRegex": [
      "timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|429|5\\d\\d|temporarily",
      "fetch failed|service unavailable|temporarily unavailable"
    ],
    "nonRetryableErrorRegex": [
      "no_liquidity|price_too_high|guard_blocked|Mainnet execute blocked|Invalid confirmToken|No Polymarket private key|geoblock|Unable to resolve tokenId|No market price available|max entry price|Invalid order size"
    ],
    "retry": { "maxAttempts": 2, "backoffMs": [1000, 2000, 4000] },
    "cooldownBeforeRetrySec": 2,
    "humanReviewState": "alarm"
  }
}
```

### 11) 严格 JSON Schema（可直接用于生产编排校验）

为了让 OpenClaw 编排引擎可直接做结构校验，建议将以下两个 Schema 内嵌到平台校验层：

- `workflow`: 上一节可复制 JSON 的结构校验
- `runtime_state`: 工单/执行上下文校验（跨节点传递）

#### 11.1 Workflow Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "OpenClaw BTC5m Workflow",
  "type": "object",
  "required": ["version", "workflow"],
  "properties": {
    "version": { "const": "1.0" },
    "workflow": {
      "type": "object",
      "required": ["id", "description", "startAt", "input", "states"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "description": { "type": "string", "minLength": 1 },
        "startAt": { "type": "string", "minLength": 1 },
        "input": { "$ref": "#/$defs/WorkflowInput" },
        "states": {
          "type": "object",
          "minProperties": 1,
          "patternProperties": {
            "^[A-Za-z_][A-Za-z0-9_]*$": { "$ref": "#/$defs/State" }
          },
          "additionalProperties": false
        },
        "finalState": { "type": "string" }
      },
      "allOf": [
        {
          "if": {
            "required": ["finalState"]
          },
          "then": {
            "properties": {
              "states": {
                "required": ["finalState"]
              }
            }
          }
        }
      ]
    }
  },
  "$defs": {
    "WorkflowInput": {
      "type": "object",
      "required": ["runId", "network", "intentType", "stakeUsd"],
      "additionalProperties": false,
      "properties": {
        "runId": { "type": "string", "pattern": "^[A-Za-z0-9_\-]+$" },
        "network": { "type": "string", "enum": ["base", "polygon", "arbitrum", "optimism", "bsc", "ethereum", "other"] },
        "intentType": { "type": "string", "enum": ["evm.polymarket.btc5m.trade", "evm.polymarket.btc5m.cancel", "evm.transfer.native", "evm.transfer.erc20"] },
        "side": { "type": "string", "enum": ["up", "down"] },
        "stakeUsd": { "type": "number", "minimum": 0.01 },
        "maxSpreadBps": { "type": "number", "minimum": 0.01 },
        "minDepthUsd": { "type": "number", "minimum": 0.01 },
        "maxStakeUsd": { "type": "number", "minimum": 0.01 },
        "minConfidence": { "type": "number", "minimum": 0.01, "maximum": 0.99 },
        "marketSlug": { "type": "string" },
        "settleAfterTrade": { "type": "boolean" },
        "settleMaxAgeMinutes": { "type": "number", "minimum": 0.1 },
        "settleMaxFillRatio": { "type": "number", "minimum": 0, "maximum": 1 },
        "cancelOnDemand": { "type": "boolean" }
      }
    },
    "State": {
      "oneOf": [
        { "$ref": "#/$defs/ToolState" },
        { "$ref": "#/$defs/ConditionState" },
        { "$ref": "#/$defs/ManualState" },
        { "$ref": "#/$defs/TerminalState" }
      ]
    },
    "ToolState": {
      "type": "object",
      "required": ["type", "tool", "params"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "tool" },
        "tool": { "type": "string", "minLength": 1 },
        "params": { "type": "object", "additionalProperties": true },
        "onSuccess": { "$ref": "#/$defs/Transition" },
        "onFailure": { "$ref": "#/$defs/Transition" },
        "guard": { "type": "object", "additionalProperties": false }
      }
    },
    "ConditionState": {
      "type": "object",
      "required": ["type", "expression", "onTrue", "onFalse"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "condition" },
        "expression": { "type": "string", "minLength": 1 },
        "onTrue": { "$ref": "#/$defs/TransitionState" },
        "onFalse": { "$ref": "#/$defs/TransitionState" }
      }
    },
    "ManualState": {
      "type": "object",
      "required": ["type", "needOperator"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "manual" },
        "needOperator": { "const": true },
        "message": { "type": "string" },
        "notify": { "type": ["string", "null"] },
        "onFailure": { "$ref": "#/$defs/Transition" },
        "onSuccess": { "$ref": "#/$defs/Transition" },
        "assign": { "type": "object", "additionalProperties": true }
      }
    },
    "TerminalState": {
      "type": "object",
      "required": ["type", "result"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "terminal" },
        "result": { "type": "string", "minLength": 1 }
      }
    },
    "Transition": {
      "type": "object",
      "required": ["to"],
      "additionalProperties": false,
      "properties": {
        "to": { "type": "string", "minLength": 1 },
        "error": { "type": "string" },
        "if": { "type": "string" },
        "assign": { "type": "object", "additionalProperties": true }
      }
    },
    "TransitionState": {
      "type": "object",
      "required": ["to"],
      "additionalProperties": false,
      "properties": {
        "to": { "type": "string", "minLength": 1 }
      }
    }
  }
}
```

#### 11.2 Runtime Context Schema（用于 state 回传）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "BTC5m OpenClaw Runtime State",
  "type": "object",
  "required": ["runId", "network", "intentType", "phase", "confirmToken", "analysisStatus", "simulateStatus"],
  "additionalProperties": false,
  "properties": {
    "runId": { "type": "string" },
    "network": { "type": "string" },
    "intentType": {
      "type": "string",
      "enum": ["evm.polymarket.btc5m.trade", "evm.polymarket.btc5m.cancel"]
    },
    "phase": { "type": "string", "enum": ["analysis", "simulate", "execute"] },
    "confirmToken": { "type": ["string", "null"] },
    "analysisStatus": { "type": "string", "enum": ["ready", "guard_blocked", "no_liquidity", "price_too_high"] },
    "simulateStatus": { "type": "string", "enum": ["ready", "guard_blocked", "no_liquidity", "price_too_high", "disabled"] },
    "guardEvaluation": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "passed": { "type": "boolean" },
        "issues": {
          "type": "array",
          "items": { "type": "object", "required": ["code", "message"], "properties": { "code": { "type": "string" }, "message": { "type": "string" } } }
        },
        "metrics": {
          "type": "object",
          "properties": {
            "spreadBps": { "type": ["number", "null"] },
            "depthUsdAtLimit": { "type": ["number", "null"] },
            "adviceConfidence": { "type": ["number", "null"] }
          }
        }
      },
      "required": ["passed", "issues", "metrics"]
    },
    "orderId": { "type": ["string", "null"] },
    "orderStatus": {
      "type": ["object", "null"],
      "additionalProperties": true
    },
    "artifacts": {
      "type": "object",
      "additionalProperties": true
    },
    "lastError": { "type": ["string", "null"] },
    "lastErrorAt": { "type": ["string", "null"], "format": "date-time" }
  }
}
```

#### 11.3 运行校验接入建议（最小实现）

```ts
// 简要示例：先 schema 校验，再交给执行器
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });
const validWorkflow = ajv.validate(workflowSchema, doc);
if (!validWorkflow) {
  throw new Error(`workflow schema invalid: ${ajv.errorsText(ajv.errors)}`);
}

const validState = ajv.validate(runtimeStateSchema, state);
if (!validState) {
  throw new Error(`state schema invalid: ${ajv.errorsText(ajv.errors)}`);
}
```

#### 11.4 可直接加载的 Schema 文件（可贴入 OpenClaw validator）

仓库内已提供可直接加载的三份 schema，建议与上文规则一起挂接到 OpenClaw 或编排服务：

- `docs/schemas/openclaw-btc5m-workflow.schema.json`
- `docs/schemas/openclaw-btc5m-runtime-state.schema.json`
- `docs/schemas/openclaw-btc5m-retry-policy.schema.json`

示例（Node/TS，读取文件后先校验再执行）：

```ts
import { readFileSync } from "node:fs";
import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true });

const workflowSchema = JSON.parse(
  readFileSync("docs/schemas/openclaw-btc5m-workflow.schema.json", "utf8"),
);
const runtimeSchema = JSON.parse(
  readFileSync("docs/schemas/openclaw-btc5m-runtime-state.schema.json", "utf8"),
);
const retrySchema = JSON.parse(
  readFileSync("docs/schemas/openclaw-btc5m-retry-policy.schema.json", "utf8"),
);

ajv.addSchema(workflowSchema);
ajv.addSchema(runtimeSchema);
ajv.addSchema(retrySchema);

const validWorkflow = ajv.validate(workflowSchema, workflowDoc);
if (!validWorkflow) {
  throw new Error(`workflow schema invalid: ${ajv.errorsText(ajv.errors)}`);
}

const validState = ajv.validate(runtimeSchema, state);
if (!validState) {
  throw new Error(`state schema invalid: ${ajv.errorsText(ajv.errors)}`);
}

const validRetry = ajv.validate(
  retrySchema,
  { retryPolicy: retryPolicy },
);
if (!validRetry) {
  throw new Error(`retry policy schema invalid: ${ajv.errorsText(ajv.errors)}`);
}
```

#### 11.5 CI 约束建议（防回归，开箱即用）

建议把 schema 校验加入仓库 CI，避免后续改动破坏可验证产物：

- 已在 `npm run check` 增加 `npm run schema:validate`
- 本地快速校验：

```bash
npm run schema:validate
```

- 建议在 CI 增加独立 step（仓库已落地在 `.github/workflows/ci.yml`）：

```yaml
- name: Validate OpenClaw BTC5m schema file manifest
  run: npm run schema:check-files:json

- name: Validate OpenClaw BTC5m schema content
  run: npm run schema:validate
```

- 如果 manifest 步骤报错（step 1 失败），可快速摘出错误码：

```bash
# 保存 JSON 输出用于快速定位
npm run schema:check-files:json | tee /tmp/openclaw-schema-manifest.json
node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/openclaw-schema-manifest.json', 'utf8'));
if (payload.status !== 'list') {
  console.error('manifest fail', payload.status);
  for (const e of payload.errors || []) {
    console.error(`- ${e.code}: ${e.file} -> ${e.message}`);
  }
  process.exit(1);
}
console.log('manifest ok', payload.summary);
NODE
```

- 三份 schema 说明见：`docs/schemas/README.md`

#### 11.6 失败排障速查（`schema:validate`）

当 CI/本地校验报错时，可按下面快速定位：

| 错误码 | 含义 | 处理方式 |
|---|---|---|
| `schema_dir_missing` | `docs/schemas` 目录不存在或路径不正确 | 检查仓库是否包含该目录；确保工作流在仓库根目录运行。 |
| `missing_file` | 某个 schema 文件未提交/未拉取 | 补齐 `docs/schemas/openclaw-btc5m-*.json` 文件，或检查 CI checkout 是否正确。 |
| `invalid_json` | JSON 语法错误（多见于逗号、引号、尾随逗号） | 用 JSON 格式化工具修复，或执行 `node -e "console.log(JSON.parse(require('fs').readFileSync('docs/schemas/openclaw-btc5m-workflow.schema.json','utf8')));"`。
| `missing_schema_field` | 缺少 `SCHEMA` 顶层元信息（`$schema` / `title` / `$id`） | 在 schema 文件中补齐对应字段。 |
| `root_type_invalid` | 根对象不是 JSON 对象 | 确认 schema 文件是对象结构，而不是数组。 |
| `unresolved_defs_ref` | `$ref` 指向不存在的本地定义 | 常见是写成 `#/defs/...` 而不是 `#/$defs/...`，或拼写 `$defs` 名称。 |

- 默认输出（快速）与严格输出（可读性更高）：

```bash
# 快速
npm run schema:validate

# 严格（按错误码分组 + 修复建议）
npm run schema:validate -- --strict

# JSON 机器可读输出
npm run schema:validate -- --json
# 成功返回示例：{ "status": "ok", "files": [...] }
# 失败返回示例：{ "status": "failed", "errors": [...] }

# 列出内置校验文件（含路径/存在性）
npm run schema:validate -- --list
# 返回示例（文本）：每条含文件名、路径、状态(found/missing/not-a-file)及大小
# 使用 JSON：
npm run schema:validate -- --list --json

# 列表严格校验（列表里任一文件缺失或不是文件则退出 1）
# --list --strict 也会触发严格行为（便于统一调用习惯）
npm run schema:validate -- --list-strict
npm run schema:validate -- --list-strict --json
npm run schema:validate -- --list --strict --json
# 返回示例（失败）：{ "status": "failed", "errors": [...] }

# 生产环境推荐：使用脚本入口（清晰/可复制）
npm run schema:check-files         # 人类可读版本（默认文本）
npm run schema:check-files:json    # 机器可读 JSON 版本

# 推荐的 CI 片段（可直接复用）
# 验证文件清单（manifest）与内容（schema 结构）
# - name: Validate OpenClaw BTC5m schema manifest
#   id: validate-openclaw-schema-manifest
#   run: |
#     set -euo pipefail
#     manifest_json="$(npm run -s schema:check-files:json)"
#     echo "$manifest_json" > /tmp/openclaw-schema-manifest.json
#     node - <<'NODE'
#     const fs = require('fs');
#     const payload = JSON.parse(fs.readFileSync('/tmp/openclaw-schema-manifest.json', 'utf8'));
#     if (payload.status !== 'list') {
#       console.error('openclaw schema manifest failed');
#       if (Array.isArray(payload.errors) && payload.errors.length > 0) {
#         for (const e of payload.errors) {
#           console.error(` - ${e.code}: ${e.file || e.detail || 'schema'} -> ${e.message}`);
#         }
#       }
#       process.exit(1);
#     }
#     console.log(`openclaw schema manifest ok: ${payload.summary.existingFiles}/${payload.summary.totalFiles}`);
#     NODE
# - name: Validate OpenClaw BTC5m schema content
#   run: npm run schema:validate

# 查看参数说明
npm run schema:validate -- --help
```

- 若仅怀疑某一条 schema，可临时注释 `schemaFiles` 列表进行快速定位。

### 12) 状态读取速查（执行器实现更稳）

| 节点 | 读 | 写 |
|---|---|---|
| `analysis` 成功 | `result.content[0].text`（通知/日志） | `confirmToken`, `analysisStatus`, `analyzeSummary` |
| `simulate` 成功 | `result.details.artifacts.simulate` | `simulateStatus`, `simulateSummary`, `staleSummary` |
| `execute` 成功 | `result.details.artifacts.execute.orderId` | `orderId`, `orderStatus`, `executeSummary` |
| 失败 | `error.message` | `lastError`, `lastErrorAt` |