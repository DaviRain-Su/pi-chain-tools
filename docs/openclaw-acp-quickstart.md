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
        "if": "{{state.executeAllowed}}",
        "expression": "!(state.confirmToken && state.simulateStatus in ['guard_blocked','no_liquidity','price_too_high'])",
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
