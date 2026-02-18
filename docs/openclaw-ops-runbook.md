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

### 3.3 deBridge MCP 就绪度（跨链扩展）

```bash
curl -s 'http://127.0.0.1:4173/api/crosschain/debridge/readiness'
```

返回 `canExecute/blockers/hints`，用于确认 deBridge MCP 入口是否可被 ACP 工作流接管。

plan readiness（先看 blockers/fixPack）：
```bash
curl -s -X POST 'http://127.0.0.1:4173/api/crosschain/debridge/plan' \
  -H 'content-type: application/json' \
  -d '{"originChain":"ethereum","destinationChain":"bsc","tokenIn":"ETH","tokenOut":"USDC","amount":"1000000000000000000"}'
```

quote dry-run（不执行资金）：
```bash
curl -s -X POST 'http://127.0.0.1:4173/api/crosschain/debridge/quote' \
  -H 'content-type: application/json' \
  -d '{"originChain":"ethereum","destinationChain":"bsc","tokenIn":"ETH","tokenOut":"USDC","amount":"1000000000000000000"}'
```

execute（强门禁，需 confirm=true）：
```bash
curl -s -X POST 'http://127.0.0.1:4173/api/crosschain/debridge/execute' \
  -H 'content-type: application/json' \
  -d '{"confirm":true,"originChain":"ethereum","destinationChain":"bsc","tokenIn":"ETH","tokenOut":"USDC","amount":"1000000000000000000"}'
```

执行结果会写入 dashboard actionHistory（`action=debridge_execute`，`status=ok|blocked|error`），并返回 `executionArtifact/executionReconciliation`，便于后续审计与回放。

运行时会对 artifact/reconciliation 做结构校验；若不合法将返回：
- `debridge_execution_artifact_invalid`
- `debridge_execution_reconciliation_invalid`

执行失败会返回归一化错误分类：
- `error`：如 `debridge_execute_timeout` / `debridge_execute_rate_limited` / `debridge_execute_network_error` / `debridge_execute_insufficient_funds` / `debridge_execute_invalid_request` / `debridge_execute_unauthorized` / `debridge_execute_unknown_error`
- `retryable`：是否可重试
- `category`：timeout/rate_limit/network/funds/request/auth/unknown

可观测性：
```bash
curl -s 'http://127.0.0.1:4173/api/ops/debridge-execute-metrics?limit=30'
```
返回 deBridge execute 的累计成功/失败、重试次数与最近执行记录（含分类错误码）。

建议最小配置：
```bash
export DEBRIDGE_MCP_ENABLED=true
export DEBRIDGE_MCP_COMMAND='npx @debridge-finance/debridge-mcp --help'
export DEBRIDGE_MCP_EXECUTE_ENABLED=false
export DEBRIDGE_MCP_EXECUTE_COMMAND=''
export DEBRIDGE_MCP_TIMEOUT_MS=120000
export DEBRIDGE_MCP_EXECUTE_RETRY_MAX_ATTEMPTS=1
export DEBRIDGE_MCP_EXECUTE_RETRY_BACKOFF_MS=1200
```

### 3.4 DLQ / 归档运维

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
- 统一走：`npm run check` / `npm run ci`（当前 `ci` 已切到 `ci:resilient`）。
- 本地一键稳态流程：`npm run ci:resilient`（内置 python 预检 + check 热修复重跑 + test 单次重试）。
- `npm run ci:retry` 现在会重试 `ci:resilient`（而不是裸 `ci`），进一步减少 `python missing` / biome io 漂移导致的误失败。
- `ci:resilient` 在 check 失败时会输出标准化 `checkFailureKind`（如 `python-missing|lint-biome-io|lint|typecheck|schema-validate|check-unknown`）并写入 CI signatures 便于后续聚类治理。

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

### 5.5 Monad Morpho v1.2 worker / replay

```bash
# dry-run worker
curl -s -X POST http://127.0.0.1:4173/api/monad/morpho/worker/start -H 'content-type: application/json' -d '{"confirm":true,"dryRun":true,"intervalMs":60000}'

# status
curl -s http://127.0.0.1:4173/api/monad/morpho/worker/status

# stop
curl -s -X POST http://127.0.0.1:4173/api/monad/morpho/worker/stop -H 'content-type: application/json' -d '{"confirm":true}'

# replay pack
npm run monad:morpho:replay
```

### 5.6 Monad Morpho SDK 模式异常排查（Phase-2：含 rewards）
- markets/strategy/rewards 支持双轨：
  - `MONAD_MORPHO_USE_SDK=true`：优先 SDK adapter（当前 provider-backed scaffold）
  - `MONAD_MORPHO_USE_SDK=false`：原生 native 路径
- SDK 分支异常时自动回退 native，并输出显式 warning：
  - markets/strategy：`morpho_sdk_fetch_failed_fallback_to_native`
  - rewards read：`morpho_sdk_rewards_fetch_failed_fallback_to_native`
  - rewards claim build：`morpho_sdk_rewards_claim_build_failed_fallback_to_native`
- rewards claim 成功后必须检查：`txHash`、`executionArtifact`、`executionReconciliation.reconcileOk`、以及 actionHistory 是否写入 `monad_morpho_rewards_claim_execute`
- earn execute 现在为 SDK-first：若发生应急回退，必须检查响应中 `mode=native-fallback`、`warnings` 包含 `morpho_sdk_execute_failed_fallback_to_native`，且 actionHistory 对应项包含 `fallback.used=true` 与 `fallback.reason`
- 快速核验：
```bash
curl -s 'http://127.0.0.1:4173/api/monad/morpho/earn/markets' | jq '.dataSource,.sdk,.warnings'
curl -s 'http://127.0.0.1:4173/api/monad/morpho/earn/strategy' | jq '.dataSource,.sdk,.warnings'
curl -s 'http://127.0.0.1:4173/api/monad/morpho/earn/rewards' | jq '.dataSource,.sdk,.warnings,.tracking'
curl -s -X POST 'http://127.0.0.1:4173/api/monad/morpho/earn/execute' -H 'content-type: application/json' -d '{"confirm":true,"amountRaw":"1000"}' | jq '.mode,.warnings,.fallback,.executionArtifact,.executionReconciliation'
```
- claim 核验（需 confirm=true）：
```bash
curl -s -X POST 'http://127.0.0.1:4173/api/monad/morpho/earn/rewards/claim' \
  -H 'content-type: application/json' \
  -d '{"confirm":true}' | jq '.ok,.txHash,.dataSource,.warnings,.executionReconciliation'
```
- 建议配置：
```bash
export MONAD_MORPHO_USE_SDK=true
export MONAD_MORPHO_SDK_API_BASE_URL=''
export MONAD_MORPHO_SDK_PACKAGE=''
```
- 如果线上波动，先切回：
```bash
export MONAD_MORPHO_USE_SDK=false
```

### 5.7 dashboard 进程出现 SIGTERM/SIGKILL（轮换重启场景）
- 当前服务已支持 `SIGTERM/SIGINT` 的 graceful shutdown：先停 worker，再关闭 HTTP server。
- 在频繁部署轮换中看到 `Exec failed (signal SIGTERM)` 可能是旧进程被替换，不等同于业务异常。
- 仍建议确认最新会话已正常监听：
```bash
npm run dashboard:start
# 看到: NEAR dashboard listening on http://127.0.0.1:4173
```

---

## 6) 当前能力边界（2026-02）

已完成：
- ACP async 持久化、重试退避、DLQ、批量运维、归档、归档清理
- payment -> entitlement -> execute 硬门禁
- BSC execute 双模式（native RPC signer + command fallback）
- BSC native 执行稳健化（gas/nonce/confirmations）+ post-trade reconciliation
- BSC quote 双源校验（Dexscreener + onchain router）与 divergence 风险门限

待持续优化：
- provider-specific 支付签名/回调契约再细化（生产级验签规范）
- BSC 多跳路径与更复杂路由策略
- 归档策略与指标告警策略继续精炼

### BSC 分期状态（收尾）

Phase-1（本期，已完成）
- BSC yield 四协议（venus/aave/lista/wombat）读侧接入 + APR/health/risk 汇总
- `POST /api/bsc/yield/execute` + post-action artifact/reconcile 统一链路
- Lista/Wombat command-mode 执行守卫（mode/timeout/max/token/placeholders）
- 执行与 reconcile 双 registry（便于替换单协议 adapter）
- Lista native RPC 执行路径已落地（ethers provider+wallet，approve+supply 上链发送）
- Wombat native RPC 执行路径已落地（ethers provider+wallet，approve+deposit 上链发送）
- native readiness 公开：`executionReadiness.nativeSlotImplemented`（Lista/Wombat 均由 `POOL + 协议私钥` 配置驱动）
- CI resilient 自愈 + signature telemetry（JSONL + `/api/ops/ci-signatures`）

Phase-2（下期，最小目标）
- native slot 协议级用例继续扩充（真实链路回放 + 异常分类覆盖）
- Dashboard readiness 卡片继续补齐协议级 fix pack 提示

### 5.6 Monad v1.4 quick ops (profile / name / delegation gate)

```bash
# profile discovery (A2A + identity + strategy summary)
curl -s http://127.0.0.1:4173/api/monad/agent/profile | jq

# register alias (confirm-gated, local scaffold)
curl -s -X POST http://127.0.0.1:4173/api/monad/agent/name/register \
  -H 'content-type: application/json' \
  -d '{"confirm":true,"alias":"pi-agent.monad","note":"ops-register"}' | jq

# update alias mapping
curl -s -X POST http://127.0.0.1:4173/api/monad/agent/name/update \
  -H 'content-type: application/json' \
  -d '{"confirm":true,"alias":"pi-agent.monad","nextAlias":"pi-agent-v2.monad","note":"ops-update"}' | jq

# delegation gate preflight (identity returns gate summary)
curl -s http://127.0.0.1:4173/api/monad/agent/identity | jq '.delegationGate'

# if blocked before execute: prepare + submit delegation intent
curl -s -X POST http://127.0.0.1:4173/api/monad/agent/delegation/prepare \
  -H 'content-type: application/json' \
  -d '{"delegatee":"0x0000000000000000000000000000000000000001","scope":["monad:morpho:earn:execute"],"revocable":true}' | jq
```

> 说明：v1.4 的 name/profile 为安全可复现的本地状态脚手架，默认不做风险链上写入；涉及链上执行的动作仍需 `confirm=true`。
