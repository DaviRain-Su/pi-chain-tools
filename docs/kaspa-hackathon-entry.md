# Kaspa Pathathon Entry: Kaspa Agent Runtime Pack（OpenClaw 可集成）

## 1. 项目名称

**Kaspa Agent Runtime Pack for OpenClaw**

（中文名：**Kaspa AI Agent 工具包（含读写能力）**）

## 2. 项目一句话介绍

在 Pi/ACP 工具运行时里补齐 Kaspa 链条目，提供可直接被 Agent 使用的 Kaspa 查询 + 提交接口，并确保以 OpenClaw 可发现/可执行能力对接。

## 3. 参赛赛道定位

### 核心赛道（建议）

- **Payments & Commerce（支付与商业）**：支持交易提交与链上确认/接受度查询，适合支付、分账、商户验证场景。
- **Real-Time Data（实时数据）**：支持地址标签、地址交易、交易输出与接受度数据查询，支持事件驱动告警与实时风控。

### 可叠加赛道

- **Gaming & Interactive（游戏与交互）**：交易输出与确认事件可用于游戏中的链上动作回执。
- **Most Creative Use of Kaspa（最具创意应用）**：把 Kaspa 能力作为多链 AI 能力入口的一部分，和 Sui/NEAR/Solana/EVM 并行使用。
- **Best Beginner Project（最佳新秀）**：工具参数固定、返回摘要清晰，适合快速上手。
- **Best UX/UI（最佳体验）**：输出结构化 + 统一文本摘要，便于自然语言调用与日志展示。

## 4. 本次实现内容（已完成）

- `kaspa_getAddressTag`：地址标签查询。
- `kaspa_getAddressTransactions`：地址交易列表（分页、过滤）。
- `kaspa_getTransaction`：按交易 ID 查询交易详情。
- `kaspa_getTransactionOutput`：按交易 ID + output index 查询单条输出。
- `kaspa_getTransactionAcceptance`：按交易 ID/ID 集合查询 acceptance 相关数据。
- `kaspa_submitTransaction`：提交签名交易到 Kaspa RPC（主网执行需要 `confirmMainnet=true`）。

其中 `read` 与 `execute` 工具均注册在同一条链工具集，方便 OpenClaw 的分组发现与能力路由。

## 5. 技术实现要点

- Runtime：
  - `getKaspaApiBaseUrl`、`getKaspaApiKey`
  - `kaspaApiJsonGet`、`kaspaApiJsonPost`
  - `kaspaNetworkSchema`、`parseKaspaNetwork`
  - `parseKaspaPositiveInteger`
  - `assertKaspaMainnetExecution`（主网提交安全闸门）
- 读接口：
  - `src/chains/kaspa/tools/read.ts`
  - 覆盖地址与交易维度（含 outputs / acceptance）
  - 所有读取工具返回 `details + text summary`
- 执行接口：
  - `src/chains/kaspa/tools/execute.ts`
  - 支持 `rawTransaction` 或 `request`（完整 JSON body）两种提交方式
  - 主网提交必须 `confirmMainnet=true`
- 注册与 OpenClaw 能力：
  - `src/chains/kaspa/toolset.ts`：新增 `groups: [{name: "read"}, {name: "execute"}]`
  - `src/chains/meta/tools/read.ts`：把 Kaspa 的执行能力加入能力清单（`execution.executable=true`）

## 6. 与 OpenClaw 的集成关系

- Kaspa 已接入 `src/pi/kaspa-extension.ts`，并在 `src/pi/default-extension.ts` 统一加载。
- `createKaspaToolset()` 会通过 `execute` 组对外暴露 `kaspa_submitTransaction`。
- `meta` 能力计算会自动发现 `execute` 组，并将其标记为可执行工具。

## 7. 演示脚本（评委展示建议）

### 示例 1：查看地址资料

- 调用 `kaspa_getAddressTag`
- 输入：`address=kaspa:...`
- 输出：地址标签、类型、关联链接与标签集合

### 示例 2：查看交易活动

- 调用 `kaspa_getAddressTransactions`
- 输入：`address=kaspa:...`, `network=mainnet`, `limit=20`
- 输出：交易列表、分页标识、确认信息

### 示例 3：交易详情与确认链路

- 调用 `kaspa_getTransaction`
- 调用 `kaspa_getTransactionOutput`
- 调用 `kaspa_getTransactionAcceptance`
- 输出：交易完整信息、单笔 output 细节、acceptance 结果

### 示例 4：提交交易

- 调用 `kaspa_submitTransaction`
- 输入：`rawTransaction=<hex/base64>`, `network=mainnet`, `confirmMainnet=true`
- 输出：提交结果与返回详情（网络、请求、txid）

## 8. 交付与后续建议

- 代码清单（本次提交）：
  - `src/chains/kaspa/runtime.ts`
  - `src/chains/kaspa/tools/read.ts`
  - `src/chains/kaspa/tools/execute.ts`
  - `src/chains/kaspa/toolset.ts`
  - `src/chains/meta/tools/read.ts`
  - `src/index.ts`
  - `docs/kaspa-hackathon-entry.md`

### 后续可再加一版（冲刺高分）

- 补充 fee estimate、mempool/交易推送状态等支付体验。
- 增加 OpenClaw 工作流模板（payment-intent）封装，支持自然语言一键分析->执行。
