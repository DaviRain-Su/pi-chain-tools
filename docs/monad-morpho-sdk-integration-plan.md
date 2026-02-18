# Monad + Morpho 官方 SDK 接入改造清单（文件级）

> 目标：在保留现有统一执行底座（risk/confirm/artifact/ops）的前提下，把 Morpho 能力逐步 SDK 化，提升协议深度与可维护性。

---

## 改造原则（双轨）

1. **平台底座不动**
- 保留现有：confirm gate、blockers/hints/fixPack、artifact/reconciliation、actionHistory、dashboard ops。

2. **协议能力 SDK 优先**
- read/plan/rewards 优先迁移到 Morpho 官方 SDK。
- execute 路径分阶段迁移，先兼容双实现（SDK + 现有 native）。

3. **渐进开关**
- 增加 `MONAD_MORPHO_USE_SDK=true|false`，支持灰度切换和回滚。

---

## Phase 1（优先，read/plan SDK 化）

### A. 新增 SDK 适配模块

#### 文件：`apps/dashboard/monad-morpho-sdk.mjs`（新）
- [ ] 初始化 Morpho SDK 客户端（网络、provider、必要配置）。
- [ ] `fetchMorphoVaults()`：获取 vault 列表与基础元数据。
- [ ] `fetchMorphoMarketMetrics()`：获取 APY/TVL/利用率/风险相关指标。
- [ ] `fetchUserPositions(account)`：获取用户仓位与份额。
- [ ] 输出统一为当前 dashboard 结构可消费的数据模型。

#### 文件：`apps/dashboard/server.mjs`
- [ ] 在 `GET /api/monad/morpho/earn/markets` 中加入 SDK 分支：
  - `MONAD_MORPHO_USE_SDK=true` 走 SDK 数据
  - 否则走现有实现
- [ ] 在 strategy 计算前统一归一化字段（apy/tvl/liquidity/risk）。
- [ ] 保留 fallback：SDK 失败时回落现有路径，并输出告警字段。

### B. 文档与配置

#### 文件：`apps/dashboard/config/dashboard.config.example.json`
- [ ] 增加 SDK 开关与必要配置（api base/network 等）。

#### 文件：`docs/near-dashboard.md`
- [ ] 增加 SDK 模式说明、开关与回退逻辑。

#### 文件：`docs/openclaw-ops-runbook.md`
- [ ] 增加 SDK 异常排查章节（切换开关、回退策略、日志定位）。

### C. 测试

#### 文件：`apps/dashboard/server.monad-morpho.test.ts`
- [ ] 新增：SDK 分支返回结构测试。
- [ ] 新增：SDK 失败 fallback 测试。
- [ ] 新增：strategy 输入归一化测试。

---

## Phase 2（rewards SDK 化）

### A. rewards read/claim

#### 文件：`apps/dashboard/monad-morpho-sdk.mjs`
- [ ] `fetchRewards(account, vault)`：claimable、campaign、token 维度信息。
- [ ] `buildClaimTx(...)`：生成 claim 交易参数/请求。

#### 文件：`apps/dashboard/server.mjs`
- [ ] `GET /api/monad/morpho/earn/rewards` 优先 SDK。
- [ ] `POST /api/monad/morpho/earn/rewards/claim` 优先 SDK claim 构建和发送。
- [ ] 保留 confirm gate 和风险校验。
- [ ] claim 后写入 artifact/reconciliation + metrics + actionHistory。

### B. Dashboard

#### 文件：`apps/dashboard/index.html`
- [ ] rewards 区展示 campaign + claimable 明细。
- [ ] claim 成功后显示 tx hash 与 reconciliation 摘要。

### C. 测试

#### 文件：`apps/dashboard/server.monad-morpho.test.ts`
- [ ] rewards read SDK path 测试
- [ ] claim execute SDK path 测试
- [ ] claim failure 分类测试（retryable/category）

---

## Phase 3（execute SDK 化，逐步替换）

### A. 执行抽象

#### 文件：`apps/dashboard/server.mjs`
- [x] 现有 execute 函数改为路由器：
  - sdk path（首选）
  - native fallback（兜底）
- [x] 用统一执行结果模型（txHash/status/error/reconcile）。

#### 文件：`apps/dashboard/monad-morpho-sdk.mjs`
- [x] `buildDepositTx(...)` / `sendDepositTx(...)`。
- [ ] gas/nonce/confirmations 策略配置化。

### B. 安全与风控
- [x] confirm gate 必须保留
- [x] delegation gate 必须保留
- [x] max amount / cooldown / daily cap 必须保留
- [x] SDK path 与 native path 错误码统一

### C. 测试
- [x] execute SDK success/failure/retryable 测试
- [x] fallback 触发条件测试
- [x] artifact/reconcile 一致性测试

---

## 里程碑验收（DoD）

### v1（SDK-read）
- [ ] markets/readiness/strategy 在 SDK 模式可跑
- [ ] `npm run check && npm test` 全绿
- [ ] fallback 可验证

### v1.1（SDK-rewards）
- [ ] rewards read/claim 在 SDK 模式可跑
- [ ] claim 有 tx hash + reconcile

### v1.2（SDK-execute）
- [ ] deposit execute SDK path 为默认
- [ ] native 仅保留应急 fallback
- [ ] dashboard 与 runbook 完整同步

---

## 推荐实施顺序（最快）

1. 先做 Phase 1（1-2 天）
2. 再做 Phase 2（1 天）
3. 最后做 Phase 3（1-2 天）

> 合计 3-5 天可以把 Monad + Morpho 从“能用”拉到“深度官方 SDK 集成”。
