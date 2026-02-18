# Hackathon Final Submission Checklist (Monad + Morpho)

> 目标：在提交前 30 分钟内快速确认“可验证、可复现、可讲清楚”。

## A. 必填信息（DoraHacks/报名页）

- [ ] Project Name 已最终确定
- [ ] Track 已选择（建议 Agent 主轨 + DeFi 辅轨）
- [ ] 项目一句话描述已更新为最新版本
- [ ] Repo URL 已填写
- [ ] 提交 Commit Hash 已填写
- [ ] Demo 链接可访问

## B. Onchain Proof（最关键）

- [ ] 至少 1 条 Monad 真实 tx hash
- [ ] 建议 2-3 条 tx hash（read/execute/reconcile场景更完整）
- [ ] Explorer 链接全部可打开
- [ ] tx 对应操作与文案一致（避免“写了 claim，链上是 deposit”）

## C. Reproducibility（评审高权重）

- [ ] `npm install` 可在新环境通过
- [ ] `npm run check` 通过
- [ ] `npm test` 通过
- [ ] `npm run dashboard:start` 可正常启动
- [ ] 复现步骤文档已从“占位符”改成真实可执行命令
- [ ] 必要环境变量有示例值和说明

## D. Demo 内容（5-8 分钟）

- [ ] 展示 read：vault/APY/TVL/risk
- [ ] 展示 strategy：多 vault 评分/分配
- [ ] 展示 execute：confirm 后真实上链
- [ ] 展示 proof：tx hash + reconciliation
- [ ] 展示 worker（dry-run）和事件记录
- [ ] 展示 delegation gate / identity/profile（v1.3+）

## E. 安全与风控说明

- [ ] 明确写出 confirm gate
- [ ] 明确写出 delegation gate（未授权阻断）
- [ ] 明确写出 max amount / cooldown / daily cap
- [ ] 明确写出 dry-run 默认策略（如果有）

## F. 文档落位（docs/）

- [ ] `docs/hackathon-monad-morpho-submission.md` 已填实
- [ ] `docs/monad-morpho-build-plan.md`（可保留）
- [ ] `docs/monad-morpho-integration-checklist.md`（可保留）
- [ ] `docs/monad-agent-identity-v1.4-notes.md`（可保留）
- [ ] 本清单文档已加入 README 索引

## G. 提交前最后 5 分钟

- [ ] 所有链接再点一遍
- [ ] commit hash 与线上仓库一致
- [ ] demo 视频可播放（无权限问题）
- [ ] 文案无“将来时”描述（尽量写已完成）
- [ ] 已运行 `npm run submission:evidence` 并核对 `docs/submission-evidence.md`
- [ ] 已运行 `npm run demo:monad-bsc`（默认 dry-run）并保存输出摘要
- [ ] 如需展示真实执行，使用显式确认参数运行 demo execute（并保留 tx proof）

---

## 建议附加材料（加分）

- 1 页架构图（Identity → Delegation → Strategy → Execute → Reconcile）
- 1 页稳定性摘要（replay/pressure 输出）
- 1 页风险控制清单（blockers/hints/fixPack）
