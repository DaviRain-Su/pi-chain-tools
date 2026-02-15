# OpenClaw BTC5m Schema Artifacts

本目录包含 BTC5m（Polymarket）能力的三份可直接用于 OpenClaw 校验的 JSON Schema：

- `openclaw-btc5m-workflow.schema.json`
  - 验证 workflow 文档结构（章节 11 的 workflow schema）
- `openclaw-btc5m-runtime-state.schema.json`
  - 验证运行态状态对象（章节 11 的 runtime state schema）
- `openclaw-btc5m-retry-policy.schema.json`
  - 验证失败恢复策略（章节 10 的 retry 白名单/重试策略）

## 本地校验

建议在 CI 或提交前执行：

```bash
npm run schema:validate
```

脚本会检查：

- JSON 可解析
- Schema 顶层元信息（`$schema` / `title` / `$id`）
- `$ref` 到本地 `#/$defs/` 是否可解析
- 3 份约定文件是否都存在

## 在 CI 的挂载示例

参见仓库的 `.github/workflows/ci.yml`，或直接复用：

```yaml
- name: Validate OpenClaw BTC5m schemas
  run: npm run schema:validate
```
