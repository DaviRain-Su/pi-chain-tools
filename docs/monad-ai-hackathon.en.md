# Monad AI Hackathon Dossier: Gradience

> Focus: **AI-callable cross-chain payment, trading and settlement infrastructure**

## 1) Track Selection

We position **Gradience** as:

- **Primary track: Track 1 — Native Agent Payments & Infrastructure**
- Also extensible toward:
  - Track 2 (agent co-evolution/long-context ecosystems)
  - Track 3 (agent-driven prediction-market applications)

## 2) One-line Pitch

**Gradience is a cross-chain agent runtime that turns blockchain capabilities into structured, safe, composable services—so AI agents can execute payment, trade, settlement and DeFi actions through workflow intents instead of raw transaction parameters.**

## 3) Problems We Address

### 3.1 Can blockchain settlement be used by agents by default?

Agents today often still need chain-specific wrappers and manual logic.

Gradience abstracts chain actions into a unified runtime + workflow surface:

- `read`: balances, quotes, positions, orderbooks, token maps
- `compose`: unsigned payload builders for transfer/swap/lending/LP actions
- `execute`: sign/send simulation and mainnet execution flows
- `workflow`: deterministic `analysis → simulate → execute` orchestration

An agent can issue intent-like text such as:

- `先分析` / `先模拟` / `确认主网执行`

and the runtime handles validation, dry-run checks, and execution safety gates.

### 3.2 How do agents discover services and support subscription/per-use billing?

Gradience provides a service-discoverable toolset model (`toolset` + `intent` registry), where each capability is a structured capability endpoint. Service invocations produce explicit execution artifacts and phase summaries, making metering/charging straightforward.

A payment middleware (x402 / facilitator pattern) can charge on per-phase events such as `simulate`/`execute` and verify outcomes via structured summaries.

### 3.3 Can payment / investment actions be directly callable by agents?

Yes. Examples already implemented:

- **EVM**: Polymarket BTC 5m place/cancel/query orders, stale-order re-quote, status/fill tracking
- **NEAR**: FT transfer, Ref swap, Burrow lend/borrow/repay/withdraw, Intents cross-chain quote and status
- **Solana**: SOL/SPL transfer, staking, Jupiter/Raydium swap, Orca/Meteora LP flow
- **Sui**: read + basic workflow foundation (balance/defi positions)

## 4) Architecture for Judges

### 4.1 Layered Design

- **Core**: shared tool abstractions and registration
- **Chain runtime**: Solana / Sui / NEAR / EVM
- **PI adapter**: external agent ingress
- **Workflow runtime**: one consistent state machine for agent tasks
- **Quality & ops**: deterministic tests, CI guardrails, schema contracts

### 4.2 Critical Primitives

- Unified ability groups: `read / compose / execute / rpc`
- NL-capable workflow parser (`analysis/simulate/execute`, risk profiles, trade guards, dry-run mode)
- Mainnet safety policy: requires `confirmMainnet` + `confirmToken`
- Deterministic replayability: run IDs and phase outputs
- Machine-readable diagnostics and governance:
  - `schema:ci-check`
  - `schema:audit`
  - contract tests ensuring CI/docs/scripts consistency

## 5) Matching to Track 1 (How we score)

- ✅ **Agent-native settlement path**: chain-native signing/execution is abstracted behind tools
- ✅ **Discoverable service capability**: toolset + intent registry
- ✅ **Callable trade/payment primitives**: compose/execute entrypoints are already structured
- ✅ **Infrastructure-first**: not a single app, but a reusable foundation for future AI payment protocols

## 6) Integration with x402 / Facilitator-like middleware (future-ready)

- `simulate`/`execute` phases can emit meterable events
- Structured artifacts (`runId`, phase status, summary, errors) are suitable for settlement middleware
- Script and schema contracts ensure stable interface versioning for downstream policy/routing services

## 7) Current Demo-Ready Deliverables

- ✅ Multi-chain runtime foundation
- ✅ OpenClaw/ACP schema validation toolchain with CI enforcement
- ✅ AI-safe command helpers and strict manifest checks (`schema:ci-check`, `schema:audit`)
- ✅ Polymarket BTC 5m workflow with guard rails and re-quote controls

## 8) Demo Script (3-minute version)

1. Show supported capability registry in README/docs
2. Run a preflight check: `npm run schema:audit`
3. Submit a sample intent in `analysis`
4. Validate with `simulate`
5. Execute with `confirmToken` on test/mainnet guard branch
6. Show structured phase artifacts and status feedback

## 9) Next Evolution

- Add payment-provider adapter for per-call billing
- Add agent memory/context store for long-lived workflows
- Add direct Monad chain runtime (primary growth target)

