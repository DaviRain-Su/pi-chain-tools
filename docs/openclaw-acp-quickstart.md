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

Before enabling execute on EVM transfer tools, set policy to allowlist:

- tool: `w3rt_setPolicy_v0`

```json
{
  "scope": "evm.transfer",
  "mode": "allowlist",
  "enforceOn": "mainnet_like",
  "allowedRecipients": [
    "0x000000000000000000000000000000000000dEaD"
  ],
  "updatedBy": "openclaw-agent",
  "note": "production bootstrap"
}
```

Verify:

- tool: `w3rt_getPolicy_v0`

## 4) First workflows

### Polymarket BTC 5m

- analysis:

```json
{
  "runMode": "analysis",
  "network": "polygon",
  "intentType": "evm.polymarket.btc5m.trade",
  "stakeUsd": 20
}
```

- simulate (same `runId`):

```json
{
  "runMode": "simulate",
  "network": "polygon",
  "runId": "wf-btc5m-01"
}
```

- execute:

```json
{
  "runMode": "execute",
  "network": "polygon",
  "runId": "wf-btc5m-01",
  "confirmMainnet": true,
  "confirmToken": "EVM-..."
}
```

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

## 5) Natural-language prompts

- `帮我分析 BTC 5m，建议买涨还是买跌`
- `把 0.001 MATIC 转到 0x...，先模拟`
- `继续执行刚才这笔，确认主网执行`

