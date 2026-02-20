# Strategy Compiler v0

目标：把“用户参数”编译成可执行 `strategy-spec.v0`，并在执行前校验策略步骤是否可被已注册组件能力满足。

## 已实现能力

位置：`apps/dashboard/strategy-compiler.mjs`

- `compileStrategySpecV0(input)`
  - 支持模板：
    - `rebalance-crosschain-v0`
    - `lending-risk-balance-v0`
  - 输出：`{ ok, spec }` 或 `{ ok:false, errors }`

- `validatePlanAgainstCapabilities(spec, manifests)`
  - 校验每个 `plan.steps[i]`：
    - `component` 是否存在 manifest
    - `action` 是否在 manifest.actions 内

## 使用方式（当前）

1. 选择模板 + 参数
2. 调 `compileStrategySpecV0`
3. 用 capability manifests 调 `validatePlanAgainstCapabilities`
4. 通过后进入执行编排层

## 下一步

- 接入 `strategy-spec.v0.schema.json` 结构校验
- 从 `docs/schemas/examples/capability-*.json` 自动装载 manifests
- 增加模板版本管理（`template@version`）
- 加入链约束校验（strategy allow.chains 与 capability chains 交集）
