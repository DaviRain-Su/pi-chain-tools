# Morpho Earn 对接任务清单（按代码文件级别）

> 目标：在现有 `pi-chain-tools` 架构里，快速落地 **Monad + Morpho Earn** 最小可提交版本（read → plan → execute → reconcile → dashboard）。

---

## 0) 配置与常量层

### 文件：`apps/dashboard/server.mjs`

- [ ] 新增 Monad/Morpho 基础配置读取（`envOrCfg`）：
  - `MONAD_RPC_URL`
  - `MONAD_CHAIN_ID`
  - `MONAD_EXECUTE_ENABLED`
  - `MONAD_EXECUTE_PRIVATE_KEY`
  - `MONAD_MORPHO_VAULT`（或市场标识）
  - `MONAD_MORPHO_ASSET`
  - `MONAD_MORPHO_MAX_AMOUNT_RAW`
- [ ] 新增默认值与配置注释（保持和现有 BSC/NEAR 风格一致）。
- [ ] 新增最小“执行可用性”聚合对象（类似 `executeReadiness` 结构）：
  - `canExecute`
  - `blockers[]`
  - `hints[]`
  - `fixPack`

---

## 1) Read：Morpho Earn 市场读取

### 文件：`apps/dashboard/server.mjs`

- [ ] 新增 Morpho Earn 读侧函数（先 MVP）：
  - [ ] vault/market 基础信息读取
  - [ ] APY / TVL（至少一个可靠指标）
  - [ ] 用户当前仓位读取（可选 v1，建议做）
- [ ] 新增 API：
  - [ ] `GET /api/monad/morpho/earn/readiness`
  - [ ] `GET /api/monad/morpho/earn/markets`
- [ ] 统一错误格式（沿用现有 `ok/error/retryable/category` 风格）。

### 文件：`docs/near-dashboard.md`（后续可拆 monad 文档）

- [ ] 增加 Monad/Morpho read API 说明（参数、返回、示例）。

---

## 2) Plan：收益与风险计划层

### 文件：`apps/dashboard/server.mjs`

- [ ] 新增 API：`POST /api/monad/morpho/earn/plan`
- [ ] 计划输出包含：
  - [ ] `canExecute`
  - [ ] `blockers` / `hints`
  - [ ] `recommendedAmountRaw`（受 risk cap 限制）
  - [ ] `next`（指向 execute）
- [ ] 风险门禁最小集：
  - [ ] maxAmountRaw
  - [ ] confirm gate（执行前）
  - [ ] 必要配置完整性检查

### 文件：`docs/monad-morpho-build-plan.md`

- [ ] 将 plan 阶段接口示例补为可复制 `curl`。

---

## 3) Execute：真实上链执行（MVP 至少 1 条）

### 文件：`apps/dashboard/server.mjs`

- [ ] 新增 Monad Morpho native execute 函数（ethers provider + wallet）：
  - [ ] allowance 检查与 approve
  - [ ] deposit（或等效供应动作）
  - [ ] 等待 receipt + confirmations
- [ ] 新增 API：`POST /api/monad/morpho/earn/execute`
- [ ] 执行必须带 `confirm=true`。
- [ ] 错误规范统一：
  - [ ] 配置/输入类：`*_CONFIG retryable=false`
  - [ ] 运行时类：`*_FAILED retryable=true|false`

### 文件：`apps/dashboard/server.mjs`（既有执行历史/指标区）

- [ ] 将 monad/morpho 执行写入 actionHistory 与 metrics。
- [ ] 记录 txHash / runId / status / reason。

---

## 4) Reconcile：执行结果对账与工件

### 文件：`apps/dashboard/server.mjs`

- [ ] 新增 `executionArtifact` 结构（最小 v1）：
  - [ ] protocol = `morpho-earn`
  - [ ] chain = `monad`
  - [ ] txHash / asset / amountRaw / timestamp
- [ ] 新增 `executionReconciliation`（最小 v1）：
  - [ ] before/after balance 或 position delta
  - [ ] reconcileOk
  - [ ] mismatchReason（若失败）

### 文件：`docs/schemas/`（建议）

- [ ] 新增 schema：
  - [ ] `monad-morpho-execute-artifact.v1.schema.json`
  - [ ] `monad-morpho-execution-reconciliation.v1.schema.json`
- [ ] 更新：
  - [ ] `docs/schemas/README.md`
  - [ ] `scripts/validate-openclaw-schemas.mjs`
  - [ ] `scripts/validate-openclaw-schemas.test.ts`

---

## 5) Dashboard UI：可见可操作

### 文件：`apps/dashboard/index.html`

- [ ] 新增 Morpho Earn 卡片：
  - [ ] readiness
  - [ ] markets snapshot（APY/TVL）
  - [ ] last execute status
- [ ] 新增操作按钮：
  - [ ] Copy plan summary
  - [ ] Fill execute draft
  - [ ] Copy incident snippet
- [ ] 将执行结果并入现有 `Execution Quality` / action history 视图。

---

## 6) 测试与质量门

### 文件：`apps/dashboard/*.test.ts`

- [ ] 新增 `apps/dashboard/server.monad-morpho.test.ts`
  - [ ] readiness blocker 覆盖
  - [ ] execute 成功路径（mock provider）
  - [ ] execute 失败分类（retryable/non-retryable）
  - [ ] artifact/reconcile 结构校验

### 命令

- [ ] `npm run check`
- [ ] `npm test`

---

## 7) 提交材料联动（Hackathon）

### 文件：`docs/hackathon-monad-morpho-submission.md`

- [ ] 填充真实 tx hash
- [ ] 填充 demo URL
- [ ] 填充复现参数与提交 commit hash

### 文件：`README.md`

- [ ] 保持文档入口更新（已加，后续若路径变动同步）。

---

## 8) 建议执行顺序（最短路径）

1. `server.mjs` 配置 + read API
2. `server.mjs` plan API
3. `server.mjs` execute MVP（真实 tx）
4. `index.html` 最小卡片与执行入口
5. tests + docs + schema
6. 收尾：提交文档填实

---

## 9) Definition of Done（DoD）

- [ ] 至少 1 条 Monad Morpho Earn 真实上链 tx 可验证
- [ ] `read -> plan -> execute -> reconcile` 全链路可跑通
- [ ] Dashboard 可展示状态与最近执行
- [ ] `npm run check` / `npm test` 全绿
- [ ] 提交文档可直接用于比赛提交
