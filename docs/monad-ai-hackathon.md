# Monad AI Hackathon 参赛文档：Gradience

> 作品方向：**AI 可调用的跨链支付/交易/结算基础设施（多链智能体执行层）**

## 1. 赛道选择

根据题目要求，我们将本项目定位为：

- **主赛道：赛道 1（原生智能体支付与基础设施）**
- 同时具备：
  - 可延展到**赛道 2（与智能体共生）**的长期记忆/上下文扩展空间
  - 可服务于**赛道 3（智能体驱动应用）**中的预测市场交易场景（BTC5m）

## 2. 项目一句话（Pitch）

**Gradience 提供一个“可调用的链上智能体能力集”——把读、组装、执行、风控与审计能力，统一封装为跨链工作流工具，让 AI Agent 能以“任务”而非“原始交易参数”完成支付、交易与结算。**

## 3. 我们解决的核心问题

### 3.1 支付与结算是否可被 AI 默认调用？

我们不是把 AI 绑定到单一合约，而是将链上能力抽象成**结构化工具 + 工作流**：

- `read`：链上数据读取（余额、报价、仓位、订单薄、代币映射）
- `compose`：预签名/预构建交易（转账、swap、借贷、LP 操作）
- `execute`：签名+广播（模拟模式/主网确认分离）
- `workflow`：analysis → simulate → execute 的 AI 任务编排

AI 可直接发起“业务意图”（如 `先分析/先模拟/确认主网执行`）并由 runtime 处理。

### 3.2 智能体如何发现服务与完成订阅/按次付费？

当前版本先支持“按次付费型执行能力”模型（可复用到订阅账单）：

- 以 `toolset/intent` 为服务发现单位
- 已内置可复用能力：转账、DEX quote、LP、借贷、Polymarket 竞猜订单等
- `workflow` 提供可追踪状态（`analysis`/`simulate`/`execute`）与确认流程，天然适配计费/审计系统对“服务调用”与“执行结果”的追踪。

> 这版可直接对接账单网关（metering）或 x402/支付中间件：每次 `simulate`/`execute` 都可作为可计费事件。

### 3.3 是否支持可直接调用的交易/投资能力？

**支持。** 已实现的典型能力包括（示例）：

- EVM：Polymarket BTC 5m 交易下单/撤单/状态查询（含 dry-run、模拟、过期订单重报）
- NEAR：FT 转账、Ref 交换、Burrow 供借贷、Intents 跨链兑换
- Solana：SOL/SPL 转账、质押、Jupiter/Raydium swap、Orca / Meteora LP 生命周期
- Sui：账户余额/DeFi 持仓读写基础能力（workflow 基础链路）

## 4. 作品架构（适合比赛评审展示）

### 4.1 分层模型

- **core**：统一工具抽象 + 注册体系
- **chain runtime**：Solana / Sui / NEAR / EVM 四套 runtime + tools
- **pi extension**：面向外部代理（PI）暴露的入口
- **workflow runtime**：AI 场景的一致执行态机（analysis/simulate/execute）
- **ops layer**：测试、CI、Schema 校验、安全审计

### 4.2 关键能力抽象

- **统一能力矩阵**：`read / compose / execute / rpc` 分组
- **AI-friendly 自然语言**：workflow 支持任务意图文本（先模拟/先分析/风险提示词/确认主网执行等）
- **安全闸门**：主网执行需要 `confirmMainnet` + confirmToken；高风险场景提供显式覆盖策略
- **幂等与重试**：runId、confirmToken、状态回放（execute summaries）
- **机器可读治理**：schema 校验、脚本契约、CI 一致性测试

## 5. 与 Monad AI Hackathon 的匹配（评审可读版）

### 5.1 与赛道 1 的对应

- ✅ **默认可用链上结算链路**：多链交易/签名/广播统一封装
- ✅ **服务可发现与可调用**：intent + workflow + toolset 注册
- ✅ **支付/交易可封装为能力**：compose/execute 工具化，支持 dry-run 与可确认执行
- ✅ **基础设施属性**：不是单点应用，而是可复用的 AI 工具运行时底座

### 5.2 对 x402 / facilitator 的可衔接点（愿景）

- 本仓库可作为**能力提供端（Capability Provider）**，将每次 `simulate` / `execute` 事件上报给支付中间件；
- `workflow` 的结构化阶段事件（含 runId、状态、summary）天然适配“按调用/按结果”计费；
- `schema:ci-check` / `schema:audit` 保证能力契约稳定，便于支付网关同步能力版本。

## 6. 里程碑与可演示成果（当前）

### 已完成（MVP）

- **跨链工具运行时**：Solana / Sui / NEAR / EVM
- **OpenClaw/ACP 路线**：BTC5m workflow/state/retry schema 完整验证链路
- **CI 质量门禁**：lint + typecheck + schema 校验 + security check + 全量测试
- **AI 友好脚本**：`schema:check-files` / `schema:check-files:json` / `schema:ci-check` / `schema:audit`
- **Polymarket BTC5m**：支持 5m 市场分析下单、撤单、状态回报、超时重报（stale order）

### 下一步可加（可作为赛后迭代）

- 引入订阅与结算网关适配器（x402/agent credits）
- 增加长期上下文层（任务记忆、偏好、风控偏好档案）
- 增加 Monad 链 runtime（作为首要增长目标）

## 7. 关键命令（比赛现场可复制）

### 快速环境检查

```bash
npm run lint
npm run typecheck
npm run schema:ci-check
npm test
```

### AI/自动化诊断（更推荐）

```bash
# 清单严格检查 + 严格结构化校验
npm run schema:audit
```

### 典型演示脚本（示例）

- 分析模式（不中断主网）：`intentText` 触发 `analysis`
- 模拟模式：`intentText` 触发 `simulate`
- 执行模式：带 `confirmMainnet` + `confirmToken` 的 `execute`

## 8. 演示故事线（可直接用于 PPT）

**故事线：AI 接受“交易意图”，自动完成决策前校验、执行模拟、并在确认后落链。**

1. 发现服务：读取可用链能力与参数映射
2. 预检能力：调用 schema manifest 与 schema 校验（结构化 fail-safe）
3. 发起任务：用户给自然语言意图（例如 BTC5m 下单 / 跨链转账）
4. analyze：生成可执行上下文和风险提示
5. simulate：完成预估、风控、参数齐备性检查
6. execute：确认后提交上链/交易，输出可追踪摘要

## 9. 结论

Gradience 已具备**“可被 AI 直接消费的链上支付与交易能力基础设施”**雏形：

- 可复用、可验证、可扩展、可审计
- 支持多链，不同链能力采用同一模型抽象
- 已有 CI 与安全/Schema 治理能力支撑比赛中的可复制性与稳定性

它不只是一个应用，而是一个能在未来承载订阅、按次付费、和智能体结算协议的基础设施起点。
