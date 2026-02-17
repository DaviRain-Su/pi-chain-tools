# OpenClaw BTC5m Schema Artifacts

本目录包含 BTC5m（Polymarket）能力与策略平台能力的 JSON Schema：

- `openclaw-btc5m-workflow.schema.json`
  - 验证 workflow 文档结构（章节 11 的 workflow schema）
- `openclaw-btc5m-runtime-state.schema.json`
  - 验证运行态状态对象（章节 11 的 runtime state schema）
- `openclaw-btc5m-retry-policy.schema.json`
  - 验证失败恢复策略（章节 10 的 retry 白名单/重试策略）
- `strategy-dsl.v1.schema.json`
  - 验证策略市场 Strategy DSL v1 的结构（发布与执行前置约束）
- `bsc-post-action-supply-artifact.v1.schema.json`
  - 验证 BSC post-action 统一工件（`bsc_post_action_supply@v1`）结构，供协议无关 reconciliation 路由使用

## 本地校验

建议在 CI 或提交前执行：

```bash
npm run schema:validate
```

以及文件清单**严格**校验（便于“文件缺失/缺失目录”提前拦截）：

```bash
npm run schema:check-files         # 人类可读输出（严格清单检查，失败即退出 1）
npm run schema:check-files:json    # JSON 输出（推荐用于 CI 机器消费，严格清单检查）
npm run schema:ci-check            # 一步到位：清单 + 全量 schema 内容校验
npm run schema:audit              # 一步到位：清单 + 严格诊断（适配 AI/自动化）
```

> 注：`npm run schema:validate` 当前 CI gate 重点校验 OpenClaw BTC5m 三份基线 schema。
> `strategy-dsl.v1.schema.json` 由策略发布接口在运行时消费（`/api/strategies` 的 DSL v1 校验）。

脚本会检查：

- JSON 可解析
- Schema 顶层元信息（`$schema` / `title` / `$id`）
- `$ref` 到本地 `#/$defs/` 是否可解析
- 3 份约定文件是否都存在

## 在 CI 的挂载示例

参见仓库的 `.github/workflows/ci.yml`，或直接复用：

```yaml
- name: Validate OpenClaw BTC5m schema artifacts
  id: validate-openclaw-schema-artifacts
  run: npm run schema:ci-check
  # 或 CI/AI 直接取用结构化诊断：
  # run: npm run schema:audit

# 细分步骤（可选）
- name: Validate OpenClaw BTC5m schema file manifest
  id: validate-openclaw-schema-manifest
  run: |
    set -euo pipefail
    manifest_json="$(npm run -s schema:check-files:json)"
    echo "$manifest_json" > /tmp/openclaw-schema-manifest.json
    node - <<'NODE'
    const fs = require('fs');
    const payload = JSON.parse(fs.readFileSync('/tmp/openclaw-schema-manifest.json', 'utf8'));
    if (payload.status !== 'list') {
      console.error('schema manifest failed');
      for (const e of payload.errors || []) {
        console.error(` - ${e.code}: ${e.file} -> ${e.message}`);
      }
      process.exit(1);
    }
    console.log(`schema manifest ok: ${payload.summary.existingFiles}/${payload.summary.totalFiles}`);
    NODE

- name: Validate OpenClaw BTC5m schema content
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
# 或者统一使用 --strict + --list 也会触发严格行为：
npm run schema:validate -- --list --strict --json

# 文件清单入口（推荐用于 CI 与机器消费）
npm run schema:check-files:json
# 成功示例：{ "status": "list", "summary": { ... } }
# 失败示例：{ "status": "failed", "errors": [ { "code": "missing_file", "file": "..." } ] }

# 查看参数说明
npm run schema:validate -- --help
```
