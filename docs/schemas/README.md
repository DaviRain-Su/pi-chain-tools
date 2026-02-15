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

## 常见失败与排查

- `schema_dir_missing`：检查仓库是否有 `docs/schemas` 目录。
- `missing_file`：检查对应文件是否存在且被提交。
- `invalid_json`：检查 JSON 语法（逗号/引号/括号）。
- `missing_schema_field`：补齐元信息（`$schema` / `title` / `$id`）。
- `unresolved_defs_ref`：检查 `$ref` 是否为 `#/$defs/...` 且目标 `$defs` 存在。
- `root_type_invalid`：检查 schema 文件顶层是否为对象。

```bash
# 严格输出（推荐）
npm run schema:validate -- --strict

# JSON 输出（适配系统）
# 成功返回：{ "status": "ok", "files": [...] }
# 失败返回：{ "status": "failed", "errors": [...] }
npm run schema:validate -- --json

# 列文件（机器可读，含存在性与字节数）
npm run schema:validate -- --list --json

# 列文件严格校验（任一 schema 缺失或不是文件 -> 失败并返回 status failed）
npm run schema:validate -- --list-strict --json

# 查看参数说明
npm run schema:validate -- --help
```
