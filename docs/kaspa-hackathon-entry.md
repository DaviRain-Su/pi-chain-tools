# Kaspa / KaspaPathon Submission: Multi-Chain Kaspa Read-Tools for AI Agent Operations

## 1. 项目名称

**Kaspa Read Tools Pack for Pi Agent Runtime**

（中文名：**Kaspa 链上即时数据工具包**）

## 2. 项目一句话介绍

为 Pi 工具链框架新增 Kaspa 支持，提供可直接在 AI/Agent 中调用的 Kaspa 链上实时读取工具（地址标签、地址交易），用于快速交易监控、合规风控、商户/应用告警与数据流水线构建。

## 3. 参赛赛道定位

### 推荐赛道（主推荐）：**Real-Time Data（实时数据）**

- 我们的工具围绕 Kaspa 的链上事件与地址维度数据展开（标签 + 交易列表），是面向“实时查询/锚定/监控”的基础层能力。
- 直接支撑 IoT、告警系统、事件驱动的支付风控、AI 工作流等场景的数据反应能力。

### 对应特殊提名（可叠加）

- **Most Creative Use of Kaspa（最具创意应用）**：把 Kaspa 作为 AI 工具层的统一链数据源，与 Solana/Sui/NEAR/EVM 的能力并列，降低应用接入链上实时数据难度。
- **Best UX/UI（最佳 UX/UI）**（如有配套前端/自然语言流程可加分）：工具名、参数、摘要输出都遵循 Pi 工具标准，AI 可直接消费。

## 4. 解决的问题

- 缺少“可直接被 AI Agent 读取”的 Kaspa 链上入口（查询标准化、参数统一、返回结构化）。
- Kaspa 链事件难以快速接入多链工作流。
- 现有工具生态以可执行为主，缺少“即插即用的可观测读取层”。

## 5. 我们的解决方案

本次提交新增一个独立链工具集，包含：

- `kaspa_getAddressTag`
  - 输入：`address`（Kaspa 地址）、`network`（mainnet/testnet，可选）
  - 输出：地址标签、类型、链接、标签集合等元信息
- `kaspa_getAddressTransactions`
  - 输入：`address`, `network`, 分页参数（limit, startingAfter, endingBefore）, 过滤参数（acceptedOnly, includePayload）
  - 输出：地址最近交易列表与分页元信息

### 技术实现要点

- 按项目既有规范接入 Pi 工具注册机制：
  - 新增 `src/chains/kaspa/toolset.ts`（read 组）
  - 新增 `src/pi/kaspa-extension.ts` 并加入 `src/pi/default-extension.ts`
  - 暴露标准入口导出（package + src/index）
- 统一参数解析与网络解析：
  - `kaspaNetworkSchema` / `parseKaspaNetwork`
- 统一远端请求层：
  - `kaspaApiJsonGet`（支持超时、错误处理、可选 API Key）
- 工具返回包含文本摘要 + `details`，便于 agent 在 UI/日志中直接展示。

## 6. 与其他已支持链的协同价值

- 复用现有多链架构，实现“Kaspa 也能像 Solana/Sui/NEAR/EVM 一样被注册到同一套 AI 运行时”。
- 用户可通过同一 AI 入口统一查询不同链状态，缩短跨链应用开发成本。

## 7. 真实应用场景（示例）

- **商户告警**：监控高频收款地址，实时拉取交易确认状态。
- **支付风控**：结合地址标签判断异常来源，快速风控预警。
- **事件驱动流程**：在流水线中根据交易历史触发 AI 操作。
- **数据锚定验证**：将外部事件与 Kaspa 地址交易对账与核验。
- **AI 助手问答**：支持自然语言查询某地址状态与交易动态。

## 8. 演示脚本（可在评委演示中直接使用）

### 示例 1：地址标签查询

- 调用 `kaspa_getAddressTag`
- 输入：`address=kaspa:...` `network=mainnet`
- 展示：返回地址标签、类型、关联链接、标签集合

### 示例 2：地址交易查看（分页）

- 调用 `kaspa_getAddressTransactions`
- 输入：`address=kaspa:...`, `network=mainnet`, `limit=20`
- 展示：返回交易数量、hasMore、最近一笔确认信息

### 示例 3：规则过滤

- 调用 `kaspa_getAddressTransactions`
- 输入：`acceptedOnly=true`, `startingAfter=<cursor>`
- 展示：快速查看确认后链上动作、支持分页流式加载

## 9. 赛道匹配总结（提交表述建议）

- **核心赛道：Real-Time Data**
  - “Kaspa 链上实时读路径，用于 AI 驱动的数据抓取、监控与决策场景。”
- **可叠加提名**
  - **Most Creative Use of Kaspa**：把 Kaspa 读取能力内生到统一多链 AI 工具运行时。
  - **Best UX/UI**：工具以可读性摘要返回 + 一致参数/命名风格，适合自然语言工作流。

## 10. 可交付清单（代码层）

- `src/chains/kaspa/runtime.ts`
- `src/chains/kaspa/tools/read.ts`
- `src/chains/kaspa/toolset.ts`
- `src/pi/kaspa-extension.ts`
- `src/pi/default-extension.ts`（新增调用）
- `src/index.ts`、`package.json`（统一导出）

## 11. 未来可继续增强（可选加分）

- 增加发送端/接收方地址归一化与更多统计字段（入账/出账金额总计、净额）。
- 提供 `kaspa_watch` 风格的订阅型适配（若后端支持事件流）。
- 增加 Demo Dashboard：输入地址即刻可视化交易热度、确认率与时间轴。

## 12. 版权与免责声明

- 本项目为本次竞赛用途的工程化提交，已按现有开源仓库风格集成，供展示 Kaspa 实时数据方向的技术可行性与可用性。
