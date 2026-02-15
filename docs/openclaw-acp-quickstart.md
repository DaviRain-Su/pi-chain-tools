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
