# OpenClaw Ops Runbook (ACP / Payments / DLQ)

> 面向当前 `pi-chain-tools` 的可直接使用文档。目标：让 OpenClaw 环境可以稳定运行、排障和日常运维。

## 1) 快速启动

```bash
cd /home/davirain/clawd/pi-chain-tools
npm run dashboard:start
```

辅助命令（提交流程常用）：

```bash
# 生成执行证明（docs/execution-proofs/YYYY-MM-DD/*.md）
npm run execute:proof

# 生成提交证据文档（docs/submission-evidence.md，自动引用最新 proof）
npm run submission:evidence

# 一键 Demo（默认 dry-run；不会自动上链执行）
npm run demo:monad-bsc

# 仅在明确确认时启用 live execute
npm run demo:monad-bsc -- --execute --confirm-execute I_UNDERSTAND_THIS_WILL_EXECUTE_ONCHAIN
```

默认地址：
- `http://127.0.0.1:4173`

### 1.1 执行证明工作流（审计/复现）

```bash
# 1) 完成一次真实 execute（含 txHash）后生成 proof
npm run execute:proof

# 2) 可按协议缩小范围
npm run execute:proof:morpho
npm run execute:proof:bsc
npm run execute:proof:lifi

# 3) 生成 submission artifact（自动引用最新 proof 文档）
npm run submission:evidence
```

输出目录：`docs/execution-proofs/YYYY-MM-DD/`

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

## PI-MCP safe-only dashboard endpoints

- Discover (read/plan only task list + card counters):

```bash
curl -s 'http://127.0.0.1:4173/api/pi-mcp/discover?phase=read'
```

- Run (safe envelope; `phase=read|plan` only):

```bash
curl -s -X POST 'http://127.0.0.1:4173/api/pi-mcp/run' \
  -H 'content-type: application/json' \
  -d '{"id":"demo-1","phase":"plan","intent":"solana.plan.swap","payload":{"wallet":"demo"}}'
```

- Execute/mutate is hard-blocked at this boundary (`PI_MCP_EXECUTE_BLOCKED`) and does **not** bypass existing execute/risk/confirm policies.


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

### 5.0 Failure Playbook（最短恢复路径）

```bash
# 1) 先跑稳态 CI（带 python/sigterm/normalize 自愈与分类）
npm run ci:resilient
# 预期：输出 [ci-resilient] success + failure-signatures(JSON)

# 2) 如遇中断波动，走有预算重试
CI_RETRY_SIGTERM_MAX=3 npm run ci:retry
# 预期：最终 success；若 code=2 直接停止（python precheck 阻断，非盲重试）

# 3) 一键恢复 dashboard（预检端口冲突 + 健康检查）
npm run dashboard:restart
# 预期：输出 JSON，ok=true，healthy=true，preflightAvoidedCollision=true|false

# 4) 仅探测 dashboard 是否已健康（避免误报失败）
npm run dashboard:ensure
# 预期：若已健康，返回 ok=true + message="dashboard already healthy; skipped restart"

# 5) 低风险 one-shot 烟雾（cron 友好）
npm run ops:smoke
# 预期：check/security:check/test 全绿；若失败会给 ci:resilient 提示
```

### 5.1 `python: 未找到命令`
- 本仓库流程使用 Node/npm；不要依赖 `python`。
- 统一走：`npm run check` / `npm run ci`（当前 `ci` 已切到 `ci:resilient`）。
- 本地一键稳态流程：`npm run ci:resilient`（内置 python 预检 + check 热修复重跑 + test 单次重试）。
- `npm run ci:retry` 现在会重试 `ci:resilient`（而不是裸 `ci`），进一步减少 `python missing` / biome io 漂移导致的误失败。
- `ci:resilient` 在 check 失败时会输出标准化 `checkFailureKind`（如 `python-missing|sigterm|lint-biome-io|lint|typecheck|schema-validate|check-unknown`）并写入 CI signatures 便于后续聚类治理。
- Python 预检现在为 fail-fast：若 `python` 和 `python3` 都缺失，会返回明确 precheck 阻断（退出码 `2`），`ci:retry` 将停止盲重试，避免失败循环。
- 运行前会先执行 `node scripts/normalize-runtime-metrics.mjs`，对 `apps/dashboard/data/rebalance-metrics.json` 做确定性格式化，减少 lint 漂移抖动。
- `ci:resilient` / `ci:retry` 均增强了 SIGTERM 处理：step 级一次重试 + retry 脚本信号预算（`CI_RETRY_SIGTERM_MAX`）。

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
export MONAD_MORPHO_SDK_PACKAGE='@morpho-org/blue-sdk'
```
- 如果线上波动，先切回：
```bash
export MONAD_MORPHO_USE_SDK=false
```

### 5.7 dashboard 进程出现 SIGTERM/SIGKILL / EADDRINUSE（轮换重启场景）
- 当前服务已支持 `SIGTERM/SIGINT` 的 graceful shutdown：先停 worker，再关闭 HTTP server。
- 在频繁部署轮换中看到 `Exec failed (signal SIGTERM)` 可能是旧进程被替换，不等同于业务异常。
- 推荐统一走 deterministic helper（端口预检 -> 安全清理旧进程 -> 拉起 -> health check）：
```bash
npm run dashboard:restart
# 预期: JSON 输出 ok=true, healthy=true
# 字段 preflightAvoidedCollision=true 表示预检发现并规避了端口冲突
```
- 若只是探活（避免“已健康却判失败”）：
```bash
npm run dashboard:ensure
# 预期: message="dashboard already healthy; skipped restart"
```

### 5.8 Sol Agent Bridge 批处理（cron/heartbeat 友好，默认 safe）
- 目标：对 bridge-discovered Solana 任务做**运营侧批处理筛选**，仅保留 read/plan；拒绝 execute/mutate。
- 默认模式 `safe`；可显式 `--mode research`，但仍不放行 execute/mutate。
- 所有真正的链上变更仍需走既有 confirm/policy/reconcile 流水线。

```bash
# 1) safe 模式批处理（推荐）
npm run solana:bridge:batch -- --input ./tmp/solana-bridge-tasks.json

# 2) research 模式（仅实验筛选，不执行）
npm run solana:bridge:batch -- --input ./tmp/solana-bridge-tasks.json --mode research

# 3) heartbeat 包装（固定 safe）
npm run solana:bridge:heartbeat -- --input ./tmp/solana-bridge-tasks.json
```

输入文件示例：
```json
{
  "tasks": [
    {
      "taskId": "read:solana_getPortfolio",
      "kind": "read",
      "metadata": { "operationKind": "read" }
    },
    {
      "taskId": "plan:solana_buildSolTransferTransaction",
      "kind": "task_discovery",
      "metadata": { "operationKind": "plan" }
    }
  ]
}
```

输出字段：
- `accepted`: 可进入 read/plan 处理队列
- `rejected`: 被 safe/research 过滤掉（含 execute/mutate 意图）
- `reason`: 拒绝原因（用于运营审计）

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
- Venus SDK-first（read/plan）开关：`BSC_VENUS_USE_SDK=true`（或 `bsc.venus.useSdk=true`）
- Venus SDK 分支带显式标记：`dataSource` / `sdk` / `warnings`；失败回退原生路径时标记 `dataSource=native-fallback`
- Venus SDK 故障排查：检查 `BSC_VENUS_VTOKEN_USDC/BSC_VENUS_VTOKEN_USDT`、`BSC_VENUS_COMPTROLLER`、`BSC_VENUS_SDK_PACKAGE`（默认 `@venusprotocol/chains`），并观察 warning `venus_sdk_market_fetch_failed_fallback_to_native` / `venus_sdk_position_fetch_failed_fallback_to_native`
- 包选择说明：`@venusprotocol/sdk` 目前无可用 npm 发布，Phase-1 改用 Venus 官方 `@venusprotocol/chains` 作为 canonical client package（链/市场/vToken 元数据），读链路继续由 provider ABI 调用承接。
- Wombat SDK Phase-1：默认尝试官方 `@wombat-exchange/configx`（按 optional peer 方式动态加载）；若包不存在或 SDK 读失败，自动回退 `sdk-scaffold/native-fallback`，响应显式标记 `dataSource` 并附带 `wombat_sdk_*_fallback_to_native` warning。
- Lista SDK Phase-1：官方 SDK 包当前未在 npm 发布，暂以 canonical client `ethers` + Lista/Wombat 统一 ABI 读路径承接，响应携带 `official_lista_sdk_not_available_using_canonical_ethers_client_path`，并在失败时输出 `lista_sdk_*_fallback_to_native` warning。
- Lista/Wombat execute 已补齐 SDK-first 路由（`mode=auto|sdk`）：优先 SDK 路径，失败后按 `*_SDK_FALLBACK_TO_NATIVE` 回退 native/command，并在返回与 actionHistory 中写入明确 fallback 标记（如 `bsc_lista_supply_fallback` / `bsc_wombat_supply_fallback`）。
- BSC post-action execute 返回模型统一：`status/txHash/error/artifact/reconcile/history/metrics` 在 sdk/native/command 分支下结构一致，便于审计与告警聚类。

Phase-2（下期，最小目标）
- native slot 协议级用例继续扩充（真实链路回放 + 异常分类覆盖）
- Dashboard readiness 卡片继续补齐协议级 fix pack 提示

### SDK upgrade-readiness workflow

```bash
npm run sdk:upgrade-readiness
# output -> docs/sdk-upgrade-readiness.md

npm run sdk:capability-diff
# output -> docs/sdk-capability-diff.md

# optional: best-effort npm upstream metadata/API marker probe
npm run sdk:capability-diff -- --upstream
```

执行后检查：
- `ready-to-promote`：可以进入 `sdk-coverage:promote <protocol> execute` 变更流程
- `partial`：保持 canonical fallback，继续跟踪 detector hook，并按 capability-diff 的 suggested next command/check 执行
- `blocked` / `blocked-not-installed`：先修复依赖/包源，再评估升级

运行态透明性：
- `/api/snapshot` -> `sdkExecuteDetectors`
- `/api/bsc/yield/markets` / `plan` -> `executionReadiness.detectors`
- execute 响应 -> `boundaryProof` + `executeDetectors` + `remainingNonSdkPath.checks`

### 6.1 Security exception policy（npm audit / security:check）

- 默认策略：优先升级直接依赖；其次通过兼容的 overrides/resolutions 拉升传递依赖；仅在无安全可行替代时进入 allowlist。
- allowlist 录入规范（`scripts/security-audit-policy.json`）：
  - 必须最小化范围（仅具体包名，不用通配）；
  - 必须写明 `reason`（风险、为何不可立即升级、影响面）；
  - 必须在 runbook 留存跟踪项（责任人 + 到期日 + 退出条件）。
- 2026-02-18 remediation（BSC SDK 集成后）：
  - 移除 `@wombat-exchange/configx` 的生产硬依赖，改为 `peerDependencies + optional`；
  - 保留运行时动态加载与 scaffold fallback，避免将 `viem`/`ws` 高危链路强制装入生产依赖树；
  - 退出条件：当官方 Wombat SDK 发布修复后，评估恢复为 direct dependency（需先通过 `npm run security:check`）。
- 当前残余高危均为既有 Solana 生态传递依赖（已在 policy 中显式列出）；目标窗口：`2026-03-31` 前完成上游版本评估并收敛 allowlist。

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

### 6.2 EVM Security Watch

用途：持续对关键 EVM 合约做只读安全漂移扫描（不发交易、不写链）。

关键文件：
- 配置模板：`apps/dashboard/config/security-watchlist.example.json`
- 状态快照：`apps/dashboard/data/security-state.json`
- 每日报告：`apps/dashboard/data/security-reports/YYYY-MM-DD/latest.json`

命令：
```bash
# 单次扫描
npm run security:scan:once

# 常驻 worker（默认 300s 一轮）
npm run security:watch

# 自定义间隔（秒）
node scripts/evm-security-worker.mjs --interval 120

# 仅测试通知链路（不依赖真实告警，可回放 latest report）
npm run security:watch:notify:test
```

支持的检测（best-effort）：
- 合约 bytecode hash 漂移（critical）
- EIP-1967 implementation slot 漂移（critical）
- `owner()` 变更或偏离预期（critical）
- `paused()` 状态切换（warn/info）
- ERC20 Approval 异常大额（allowance spike，info/warn）

配置说明：
- `chains[].rpcUrlEnv` 必须映射到环境变量（例如 `ETHEREUM_RPC_URL`）。
- 若某链 RPC 环境变量缺失，本轮会记录 `missing_rpc_env`（warn）并跳过该链，不会导致 worker 崩溃。
- 通知支持 provider 抽象：`telegram` / `noop`（默认）。
- 环境变量：
  - `EVM_SECURITY_NOTIFY_PROVIDER=telegram|noop`
  - `TELEGRAM_BOT_TOKEN=<bot token>`
  - `TELEGRAM_CHAT_ID=<chat id>`
  - 可选：`EVM_SECURITY_NOTIFY_INFO=true`（默认关闭 info 级别推送）
- 推送策略：
  - `critical`：逐条即时推送（按 fingerprint + cooldown 去重，状态持久化在 `security-state.json`）
  - `warn`：每轮扫描聚合为一条 summary
  - `info`：可选（默认 off）
- 推送失败不会中断 scan/watch 循环（日志记录为 non-fatal）。

运维建议：
- 先复制模板为实际配置：
  `cp apps/dashboard/config/security-watchlist.example.json apps/dashboard/config/security-watchlist.json`
- 每次修改 watchlist 后先跑 `npm run security:scan:once` 校验格式与连通性。
- 常驻模式建议配合 systemd/cron（见 `docs/evm-security-watch-cron.md`）。

### 6.3 Compact posture snapshot (security + stale + last good check)

```bash
npm run ops:posture
```

输出为单个 JSON，聚合：
- `securityWatch.health`（ok/warn/critical/stale/missing）
- `checkStatus.freshness`（fresh/stale/unknown）
- `checkStatus.lastSuccessfulCheck`

Graceful degradation：
- 若 `security-state`/`security-reports` 缺失，返回 `health=missing` 而非报错退出。
- 若 `ci-signatures.jsonl` 缺失，返回 `lastCheck=null`/`lastSuccessfulCheck=null`。

### 6.4 Foundry crystallization fallback（当无匹配候选）

若 `foundry_overseer` + `foundry_crystallize` 本轮没有给出直接匹配（python/cwd/check-churn）候选，先按以下本地模式兜底：
1. 固定入口：优先 `npm run ci:resilient`，避免直接裸跑 `npm run ci`。
2. 失败分类：读取 `apps/dashboard/data/ci-signatures.jsonl`，按 `checkFailureKind` 聚类。
3. 快速处置：
   - `python-missing`：安装/暴露 `python3`（或保留 shim），再跑 `npm run ci:resilient`。
   - `normalize-runtime-metrics*`：先执行 `node scripts/normalize-runtime-metrics.mjs`，确认目标 JSON 可写。
   - `check-interrupted/sigterm`：避免并发 CI，执行一次 `npm run ci:retry`。
4. 复盘沉淀：将重复簇（>=3 次）回写到 runbook 并在下一轮再次尝试 crystallize。
