# Kaspa Pathathon Entry: Kaspa Agent Runtime Pack（OpenClaw 可集成）

## 1. 项目名称

**Kaspa Agent Runtime Pack for OpenClaw**

（中文名：**Kaspa AI Agent 工具包（含读写能力）**）

## 2. 项目一句话介绍

在 Pi/ACP 工具运行时里补齐 Kaspa 链条目，提供可直接被 Agent 使用的 Kaspa 查询 + 提交接口，并确保以 OpenClaw 可发现/可执行能力对接。

## 3. 参赛赛道定位

### 核心赛道（建议）

- **Payments & Commerce（支付与商业）**：支持预检（`fee/mempool/read-state`）+ 提交式交易链路，适合支付、分账、商户验证场景。
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
- `kaspa_submitTransaction`：支持 `runMode=analysis` + `runMode=execute` 双阶段提交；主网执行需要 `confirmMainnet=true` 与 `confirmToken`。
- `kaspa_submitTransaction`：analysis 阶段增加预检开关（`skipFeePreflight` / `skipMempoolPreflight` / `skipReadStatePreflight`）和风险摘要（`riskLevel`/`readiness`）；
- `kaspa_submitTransaction`：execute 阶段返回标准化 `receipt`（含 `preflightRiskLevel` / `preflightReadiness` / `broadcastStatus`）。
- `kaspa_buildTransferTransaction`：新增 `compose` 组建模组，支持本地签名前的 UTXO 选择、输出拼装、手续费估算、找零策略与签名 payload 产出。
- `kaspa_signTransferTransaction`：新增签名承接工具，支持在请求对象/原始交易基础上附加或覆盖签名，返回可执行 `request`、`requestHash`，并补充签名上下文元数据（输入指纹/消息摘要/签名上下文预览/覆盖策略）。
- `kaspa_signTransferTransactionWithWallet`：新增钱包签名承接工具，支持可选官方签名后端（`@kaspa/wallet` / `kaspa-wasm32-sdk` / 自定义 provider module）进行签名生成，再自动拼接为可提交请求。
- `w3rt_run_kaspa_workflow_v0`：新增 Kaspa 工作流，支持 `analysis -> simulate -> execute` 三段闭环（可直接承接前置 preflight 与主网确认门禁）。
- `w3rt_run_kaspa_send_v0`：自然语言最少参数支付入口（一句话或 from/to/amount）。
- `w3rt_run_kaspa_transfer_v0`：带完整参数的高级一站式 transfer 入口，可复用同一套签名/预检/执行链路。
- `kaspa_getAddressBalance`：查询地址余额快照。
- `kaspa_getAddressUtxos`：查询地址 UTXO 集合（含分页）。
- `kaspa_getToken`：查询 token 元数据。
- `kaspa_getBlock`：查询区块详情。
- `kaspa_getFeeEstimate`：提交前查询 fee 预估。
- `kaspa_getMempool`：提交前查询 mempool 状态。
- `kaspa_readState`：提交前读取链上状态。
- `kaspa_rpc`：通用可配置 RPC 预检入口。
- `kaspa_getAddressHistoryStats`：地址历史聚合指标（最近页内收支净变动/通过率）。
- `kaspa_checkSubmitReadiness`：提交前纯预检入口（fee/mempool/read-state），输出 `riskLevel/readiness/preflight`，无主网执行副作用。

其中 `read`、`compose`、`execute` 工具均注册在同一条链工具集，形成可供 OpenClaw 分组发现的完整“查询+组装+签名提交”链路。

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
  - 支持 `runMode=analysis` 与 `runMode=execute`
  - analysis 返回 `preflight` + `requestHash` + `confirmToken`（20 分钟内有效）
  - 主网提交必须 `confirmMainnet=true`
  - 新增 `kaspa_checkSubmitReadiness` 作为独立无副作用预检工具（fee/mempool/read-state）
- 组装/签名前处理：
  - `src/chains/kaspa/tools/compose.ts`
  - `kaspa_buildTransferTransaction`：支持 `utxos` 明细输入、输出数组/单收款人、手续费/找零策略、`requestHash` 生成与 `request.rawTransaction` 输出
  - 产物可直接作为 `kaspa_submitTransaction` 的 `request` 输入进行二段式（analysis/execute）提交验证链路
- 官方能力扩展：
  - 已确认 Kaspa 有官方 JS/TS 官方路线（Rusty Kaspa WASM 与钱包框架）可支持本地签名/交易构建能力
  - 官方方向示例：`kaspa-wasm32-sdk`、`@kaspa/wallet`
  - 已补齐 compose/execute 工具分离结构，并新增 `kaspa_signTransferTransaction` 处理签名承接（compose 仍聚焦交易拼装）
  - 当前提交策略：保持 `analysis/execute` 风险-确认模型不变，compose 只负责签名前准备
- 注册与 OpenClaw 能力：
  - `src/chains/kaspa/toolset.ts`：新增 `groups: [{name: "read"}, {name: "compose"}, {name: "execute"}]`
  - `src/chains/meta/tools/read.ts`：把 Kaspa 的执行能力加入能力清单（`execution.executable=true`）
  - `docs/kaspa-official-gap-notes.md`：官方能力对齐清单（含当前缺口与下一步计划）

## 6. 与 OpenClaw 的集成关系

- Kaspa 已接入 `src/pi/kaspa-extension.ts`，并在 `src/pi/default-extension.ts` 统一加载。
- `createKaspaToolset()` 会通过 `execute` 组对外暴露 `kaspa_submitTransaction`。
- `meta` 能力计算会自动发现 `execute` 组，并将其标记为可执行工具。
- OpenClaw 集成中，本条链能力面向两类场景：
  - 赛事当前版本：读取+提交工具链（analysis/execute + receipt）
  - 未来版本：钱包工具化（UTXO 组织、签名提案、账户发现）直接接入官方 JS/TS SDK

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

#### Step 0：本地签名前构建（compose）

- 调用 `kaspa_buildTransferTransaction`
- 输入：`fromAddress`, `toAddress/outputs`, `amount`, `utxos`, `feeRate`, `changeAddress`
- 输出：`request.rawTransaction`（可签名 payload）、`request.metadata.requestHash`（用于与后续提交体一致性核验）

#### Step 1：签名承接（可本地签名器）

- 调用 `kaspa_signTransferTransaction`
- 输入：`request=<compose返回.request>`, `signatures=[<sig1>, <sig2>]`，或 `signature=<sig>`
- 输出：`request`（含签名数组）与 `signatureEncoding`，以及 `requestHash`/`unsignedRequestHash`，并返回 `signingContext`（`hashInput.fingerprint`、`hashInput.messageDigest`、`hashInput.signaturePayload`、`hashInput.payloadPreview`、`metadata.providerApiShape`、`metadata.providerResultShape`、签名编码、是否覆盖签名）。
- 建议生产环境通过 `privateKeyFile`（或别名 `privateKeyPath`）或环境变量 `KASPA_PRIVATE_KEY`/`KASPA_PRIVATE_KEY_PATH` 提供签名密钥，避免在请求参数里明文传递 `privateKey`。如需自定义文件变量名，可传 `privateKeyPathEnv`。

#### Step A：analysis

- 调用 `kaspa_submitTransaction`
- 输入：`request=<compose返回.request 或已签名request>`, `runMode=analysis`, `network=mainnet`, `confirmMainnet=true`, 可选 `feeEndpoint/mempoolEndpoint/readStateEndpoint`
- 输出：`preflight` 明细、`riskLevel`、`readiness`、`requestHash` 与 `confirmToken`

#### Step B：execute

- 调用 `kaspa_submitTransaction`
- 输入：`request=<compose返回.request>`, `runMode=execute`, `network=mainnet`, `confirmMainnet=true`, `confirmToken=<analysis返回>`
- 输出：提交回执（含 `txId`、`network`、`requestHash`、`preflightRiskLevel`、`preflightReadiness`、`broadcastStatus`）

#### Step B'：演示 acceptance polling（重点）

- 推荐在 `kaspa_submitTransaction` 的 `runMode=execute` 中叠加：
  - `pollAcceptance=true`
  - `acceptancePollIntervalMs=2000`
  - `acceptancePollTimeoutMs=30000`
- 观测返回：
  - `acceptanceChecked=true`（有无触发轮询）
  - `acceptanceCheckedAttempts`（轮询次数）
  - `acceptanceTimedOut`（是否超时）
  - `acceptanceStatus`（`accepted` / `pending` / `rejected` / `unknown`）
- 在 `network=testnet` 中演示更快，可直接复用 `compose/request`，把 `confirmMainnet` 设置为 `false` 以方便多轮演示。

#### Step C：workflow 一体化（推荐演示）

- 调用 `w3rt_run_kaspa_workflow_v0`
- 输入：`runMode=analysis` 或 `runMode=simulate`，使用 compose 参数/或 `request` + `runId`
- 输入 `runMode=execute` 时带上 `confirmToken`
- 输出：`artifacts.analysis/simulate/execute` 与统一 summary，支持演示脚本闭环。

#### Step D：自然语言最小参数演示（推荐比赛现场）

- 调用 `w3rt_run_kaspa_send_v0`，只提供一句话
  - `intentText="从 kaspa:from... 转给 kaspa:to... 0.01"`
  - `runMode=analysis`
  - `network=testnet11`
- 拿到 `confirmToken` 后直接执行同一个请求：`runMode=execute`
- 用同一工具开启 acceptance 轮询观察结果
  - `pollAcceptance=true`
  - `acceptancePollIntervalMs=2000`
  - `acceptancePollTimeoutMs=30000`
- 观察返回字段
  - `acceptanceChecked`
  - `acceptanceCheckedAttempts`
  - `acceptanceStatus`

#### Step E：自然语言与参数式对比

- `w3rt_run_kaspa_send_v0`：`intentText` 模式（最少参数，演示用）
- `w3rt_run_kaspa_transfer_v0`：参数式模式（可传 `fromAddress`/`toAddress`/`amount`/`request`/签名参数）

#### Step A'：只做预检（推荐用于演示前置风控）

- 调用 `kaspa_checkSubmitReadiness`
- 输入：`rawTransaction=<hex/base64>`, `network=testnet`, 可选 `feeEndpoint/mempoolEndpoint/readStateEndpoint`
- 输出：`kaspa.transaction.preflight.v1`（`readiness`、`riskLevel`、`preflight` 报告）

#### Step F：read 结果统一消费（展示层模板）

- 调用 `kaspa_getTransaction`、`kaspa_getTransactionOutput` 或 `kaspa_getAddressUtxos`
- 每个 read 结果会返回统一字段：
  - `standardized.summary`
  - `standardized.inputs`
  - `standardized.outputs`
  - `standardized.fees`
  - 并且同步展开到顶层 `summary` / `inputs` / `outputs` / `fees`，便于直接展示。

## 8. 交付与后续建议

- 代码清单（本次提交）：
  - `src/chains/kaspa/runtime.ts`
  - `src/chains/kaspa/tools/read.ts`
  - `src/chains/kaspa/tools/compose.ts`
  - `src/chains/kaspa/tools/sign.ts`
  - `src/chains/kaspa/tools/execute.ts`
  - `src/chains/kaspa/tools/workflow.ts`
  - `src/chains/kaspa/toolset.ts`
  - `src/chains/meta/tools/read.ts`
  - `src/index.ts`
  - `docs/kaspa-official-gap-notes.md`
  - `docs/kaspa-hackathon-entry.md`

### 后续可再加一版（冲刺高分）

- 下一步可补齐官方签名能力内置链路（可对接 kaspa-sdk `Account/Wallet` 完成私钥托管与签名哈希对齐）。
- 补齐 `execute` 结果对接官方交易摘要/Generator 风格字段（fee 成本分解、签名上下文快照）。
- 增加 OpenClaw 专属工作流模板（payment-intent/merchant-settlement），支持自然语言“一键分析 -> 执行”展示链路闭环。
