# OpenClaw Ops Runbook (ACP / Payments / DLQ)

> 面向当前 `pi-chain-tools` 的可直接使用文档。目标：让 OpenClaw 环境可以稳定运行、排障和日常运维。

## 1) 快速启动

```bash
cd /home/davirain/clawd/pi-chain-tools
npm run dashboard:start
```

默认地址：
- `http://127.0.0.1:4173`

---

## 2) 推荐环境变量（可直接复制）

### 2.1 保守生产档（建议先用）

```bash
export NEAR_RPC_URLS="https://1rpc.io/near,https://rpc.mainnet.near.org"
export NEAR_RPC_RETRY_ROUNDS=2
export NEAR_RPC_RETRY_BASE_MS=250

export ACP_DISMISSED_PURGE_ENABLED=true
export ACP_DISMISSED_PURGE_DAYS=7
export ACP_DISMISSED_PURGE_INTERVAL_MS=21600000

# 可选：支付回调签名校验
export PAYMENT_WEBHOOK_SECRET='replace-with-shared-secret'

export BSC_EXECUTE_ENABLED=false
```

### 2.2 激进执行档（BSC 执行适配器开启）

#### A) Native 模式（推荐）

```bash
export BSC_EXECUTE_ENABLED=true
export BSC_EXECUTE_MODE=native
export BSC_EXECUTE_PRIVATE_KEY='0x...'
# 可选：不填则默认回到 signer 地址
export BSC_EXECUTE_RECIPIENT='0xyourAddress'
```

#### B) Command 模式（兼容）

```bash
export BSC_EXECUTE_ENABLED=true
export BSC_EXECUTE_MODE=command
export BSC_EXECUTE_COMMAND='your-bsc-exec-cli --rpc {rpcUrl} --chain {chainId} --router {router} --token-in {tokenIn} --token-out {tokenOut} --amount-in {amountInRaw} --min-out {minAmountOutRaw} --run-id {runId}'
```

> `BSC_EXECUTE_COMMAND` 支持占位符：
> `{amountInRaw} {minAmountOutRaw} {tokenIn} {tokenOut} {router} {rpcUrl} {chainId} {runId}`

---

## 3) 核心 API（执行/支付/运维）

### 3.1 支付与授权

1. 创建支付意图：
```bash
curl -s -X POST http://127.0.0.1:4173/api/payments/create \
  -H 'content-type: application/json' \
  -d '{"confirm":true,"strategyId":"stb-usdc-v1","buyer":"demo-user"}'
```

2. 确认支付（paid 才会发 entitlement）：
```bash
curl -s -X POST http://127.0.0.1:4173/api/payments/confirm \
  -H 'content-type: application/json' \
  -d '{"confirm":true,"paymentId":"pay-REPLACE","txRef":"tx-demo"}'
```

2.1 Provider webhook（可选，建议配置签名）：
```bash
curl -s -X POST 'http://127.0.0.1:4173/api/payments/webhook?provider=ping' \
  -H 'content-type: application/json' \
  -H 'x-payment-provider: ping' \
  -H 'x-payment-signature: sha256=REPLACE' \
  -d '{"id":"evt-1","data":{"paymentId":"pay-REPLACE","status":"paid","txHash":"0xabc"}}'
```

> provider schema:
> - `generic`: `paymentId/status/txRef` (or common aliases)
> - `ping`: `id + data.paymentId + data.status + data.txHash`
> - `x402`: `event_id + payment_id + payment_status + tx_hash`

3. 查询支付记录：
```bash
curl -s http://127.0.0.1:4173/api/payments
```

### 3.2 ACP 执行

- 同步执行：`POST /api/acp/job/execute`
- 异步提交：`POST /api/acp/job/submit`

> 非 dry-run + strategy 执行门禁：
> 必须满足 `buyer + paymentId + payment=paid + strategy/buyer匹配 + entitlement有效`。

### 3.3 DLQ / 归档运维

- 查看 dead-letter：`GET /api/acp/jobs/dead-letter`
- 单条重试：`POST /api/acp/jobs/retry`
- 批量重试：`POST /api/acp/jobs/retry-batch`
- 一键重试可重试类：`POST /api/acp/jobs/retry-retryable`
- 批量归档：`POST /api/acp/jobs/dismiss`
- 查看归档：`GET /api/acp/jobs/dismissed`
- 清理归档：`POST /api/acp/jobs/dismissed/purge`

---

## 4) 标准运维流程（建议）

1. 看 ACP 概览：`/api/acp/jobs/summary`
2. 看 dead-letter：按 `errorType` + `retryable` 分组
3. 先执行 `retry-retryable`
4. 对明确不可重试错误（payment/entitlement/参数类）做 `dismiss`
5. 定期 purge dismissed（手动或自动调度）

---

## 5) 常见故障与处理模式

### 5.1 `python: 未找到命令`
- 本仓库流程使用 Node/npm；不要依赖 `python`。
- 统一走：`npm run check` / `npm run ci`。

### 5.2 `edit` 精确匹配失败
- 先 `rg` / `sed -n` 定位上下文，再缩小替换块。
- 避免一次替换过大段落。

### 5.3 `Formatted N files ... No files were processed`
- 说明目标路径不匹配。
- 用明确文件路径执行 format，避免空路径调用。

### 5.4 CI 连续失败
推荐顺序：
```bash
npx biome format --write apps/dashboard/data/rebalance-metrics.json
npm run check
npm run security:check
npm test
```

---

## 6) 当前能力边界（2026-02）

已完成：
- ACP async 持久化、重试退避、DLQ、批量运维、归档、归档清理
- payment -> entitlement -> execute 硬门禁
- BSC execute 外部适配器模式

待持续优化：
- BSC 原生执行器进一步产品化（非外部命令模板）
- 真实支付通道回调深度集成
- 归档策略与指标告警策略继续精炼
