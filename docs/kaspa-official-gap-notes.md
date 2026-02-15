# Kaspa 官方能力对齐与缺口清单（kaspa.aspectron.org 对齐草案）

> 版本：2026-02-15
> 范围：pi-chain-tools Kaspa 工具链（`read` / `compose` / `execute`）
>
> 说明：以下内容用于展示当前实现与 Kaspa 官方钱包/交易构建语义的对齐状态，便于续阶段开发与赛事评审说明。

## 已落地能力（在项目当前版本中）

- ✅ `read` 读能力：地址、UTXO、交易、手续费估算、mempool、链状态、链上 RPC 透传。
- ✅ 交易提交双阶段：`kaspa_submitTransaction`（`analysis` -> `execute`）
  - `confirmToken` 幂等约束（`KASPA_SUBMIT_TOKEN_PREFIX = "kaspa-submit:v1:"`）
  - `confirmMainnet=true` 主网执行门禁（TTL：`20min`）
  - `skip*` 预检开关与 `kaspa_checkSubmitReadiness`。
- ✅ `compose` 交易组装闭环（新增）：
  - `kaspa_buildTransferTransaction`
  - `kaspa_signTransferTransaction`
  - `w3rt_run_kaspa_workflow_v0`
  - 支持 utxo 输入组装 + 输出拼装 + fee 估算 + change 处理 + 变更金额吸收
  - 产物包含 `request.rawTransaction` 与 `requestHash`（可直接喂给 `kaspa_submitTransaction` 的 `request` 入口）。

## 与官方 Kaspa 钱包工作流的对齐差距

> 以 `kaspa.aspectron.org` 的典型角色拆分（`UtxoContext` / `Generator` / `PendingTransaction` / `GeneratorSummary`）为参照点。

### 已实现（部分映射）

1. **UTXO 组装上下文（`UtxoContext`）**
   - ✅ 当前已支持：调用侧可显式传入 utxos 列表，工具完成本地选择与组装。
   - ⚠️ 差距：尚未封装 `getUtxos` 拉取 + 缓存 + 会话状态管理的 context 实体（`kaspa_read` 侧可单独查询）。

2. **Transaction 组装（`Generator`）**
   - ✅ 当前已支持：`kaspa_buildTransferTransaction` 生成可签名交易骨架。
   - ⚠️ 差距：未完全复刻官方 `Generator` 的流水线（如版本化策略切换、ScriptBuilder、跨脚本类型的输出兼容）。

3. **待签名载体（`PendingTransaction`）**
   - ✅ 当前已支持：返回 `tx`（unsigned skeleton）和 `request.rawTransaction`。
   - ⚠️ 差距：未输出可直接映射到官方钱包 SDK 的签名上下文（未内置签名/序列化器、签名哈希提取、DER/Schnorr 细节）。

4. **签名与广播流（本地签名入口）**
   - ✅ 当前：`request.rawTransaction` 与 `kaspa_signTransferTransaction` 支持签名附加/覆盖并输出可执行请求，同时返回 `signingContext`（`fingerprint`、`messageDigest`、`signaturePayload`、`payloadPreview`、`providerApiShape`、`providerResultShape` 等签名输入摘要与元数据字段）。
- ✅ 增补：`kaspa_signTransferTransactionWithWallet` 支持本地密钥来源可选链路（`privateKey` 直传 / `privateKeyFile`/`privateKeyPath` 本地文件 / `privateKeyEnv` / `KASPA_PRIVATE_KEY` / `KASPA_PRIVATE_KEY_PATH`，以及 `privateKeyPathEnv` 自定义文件路径变量名），支持在生产环境减少明文透传风险。
   - ✅ 已补齐：新增 `kaspa_signTransferTransactionWithWallet`，可挂接可选官方签名后端（`@kaspa/wallet`、`kaspa-wasm32-sdk`）或自定义 provider；输出仍为可提交 `request`。

5. **执行回执（`GeneratorSummary` / receipt）**
   - ✅ 当前：`kaspa_submitTransaction` 返回统一 receipt；compose 阶段返回 `requestHash`。
   - ⚠️ 差距：未按官方 `GeneratorSummary` 字段体系补齐字段（如 fee 分解明细、脚本成本明细、签名路径 trace）。

## 下一阶段建议清单（按优先级）

1. **高优先：提升官方签名对齐度**（本地或插件签名）
   - 当前新增 `kaspa_signTransferTransactionWithWallet` 已提供官方/插件签名入口；下一步细化签名输入摘要与官方签名上下文字段映射（hash 派生、消息摘要、签名元数据）。
2. **中优先：增强 UtxoContext 工具**
   - 提供 `fetchUtxos` + 自动排序策略（FIFO / 优先费率）+ 规则化策略参数。
3. **中优先：fee 与 change 模型对齐**
   - 补充主流网络参数（按网络/环境）驱动的 fee 估算与动态重估策略。
4. **低优先：Generator/ PendingTransaction 的官方字段映射层**
   - 输出可读性增强（`summary`/`inputs`/`outputs`/`fees` 分解字段）便于上层工作流持久化。

## 与当前提交语义的兼容保证（必须保持）

- `kaspa_submitTransaction` 的双阶段与风险栈保持不变。
- `confirmToken` 继续用于 execute 幂等核验。
- `mainnet` 继续保留 `confirmMainnet=true`。
- compose 阶段仅负责“组装+签名前准备”，不改变 execute 的安全/确认语义。
