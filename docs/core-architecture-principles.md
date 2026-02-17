# Core Architecture Principles (AI-Native, Operable, Monetizable)

> This document captures the architecture mindset we are adopting into `pi-chain-tools` core.
> Goal: keep AI flexible at the edge, but deterministic and auditable in execution.

## 1) Core Positioning

`pi-chain-tools` is not just a tool bundle; it is becoming a **strategy execution platform**:

- **Intent Layer**: ACP / API / UI receives user goals and strategy requests.
- **Policy Layer**: validates risk, pricing, permissions, and chain constraints.
- **Execution Layer**: deterministic multi-chain execution (NEAR/BSC/EVM/Solana/Sui).
- **Settlement Layer**: payment gating + fee split + receipts (marketplace-ready).
- **Observability Layer**: job lifecycle, retries, metrics, alerts, audit trail.

---

## 2) Non-Negotiable Principles

### P1. Intent ≠ Execution
- AI can propose intent.
- AI must **not** directly execute arbitrary chain actions.
- Only typed, validated, policy-approved intents reach executors.

### P2. Constrain at Source (Schema First)
- Strategy definitions use constrained JSON schema/DSL.
- Reject invalid structure at ingress.
- Add semantic guards before execution (risk limits, chain support, min balances, slippage bounds).

### P3. Asynchronous by Default for Heavy Work
- Submission endpoint should return quickly with `jobId`.
- Long-running operations should execute in worker/queue mode.
- Status polling and lifecycle states are first-class APIs.

### P4. Determinism + Idempotency + Auditability
- Execution should be reproducible from request + policy snapshot.
- Every run has idempotency keys and lifecycle state transitions.
- Every state transition should be inspectable in history.

### P5. Policy Is Runtime Data (Not Hardcoded)
- Risk and monetization policies are persisted and patchable.
- Platform-level controls cannot be bypassed by strategy authors.

### P6. Cost-Driven Reliability
- Use retries/backoff/fallback where external dependencies are flaky.
- Scale expensive execution paths based on queue pressure.
- Keep storage/logging practical and queryable.

---

## 3) Canonical Runtime Boundaries

## Boundary A — Interface / Orchestration
Responsibilities:
- Request parsing
- user/session context
- lightweight validation
- job creation

Must not:
- run unbounded heavy chain work inline
- bypass policy checks

## Boundary B — Policy / Risk / Monetization
Responsibilities:
- risk limits (`minRebalanceUsd`, daily limits, exposure)
- pricing (`settlementToken`, `platformTakeRate`)
- payment entitlement check (paid/unpaid)

Must not:
- submit chain tx directly

## Boundary C — Execution Engines
Responsibilities:
- deterministic chain operations
- strict confirm and safety rails
- normalized receipts

Must not:
- mutate policy
- accept raw free-form prompts as execution instructions

## Boundary D — Settlement / Marketplace
Responsibilities:
- strategy registry
- purchase receipts
- fee split (`platformFee`, `creatorPayout`)
- entitlement windows for paid usage

---

## 4) Standard Job Lifecycle (Target)

`planned -> queued -> running -> (executed | planned | blocked | error)`

Minimum required fields per receipt:
- `runId`
- `intentType`
- `targetChain`
- `status`
- `amountRaw` / `amountUsd` (if applicable)
- `txHash` (if on-chain executed)
- `adapterMode` (execute / plan-only)
- timestamps (`createdAt`, `updatedAt`)

---

## 5) Strategy Marketplace Contract (v1)

Current bootstrap APIs already present:
- `GET/POST /api/strategies`
- `POST /api/strategies/purchase`
- `GET /api/strategies/purchases`
- `GET/POST /api/policy` (includes monetization)

v1 intent:
- strategy authors can publish metadata and pricing
- buyers can purchase strategy access
- platform takes fee (`platformTakeRate`)
- all purchases produce auditable receipts

---

## 6) Next Implementation Priorities

1. **Strategy DSL v1 + schema validation**
   - move from metadata-only to constrained executable intent schema

2. **Async job mode for ACP execute**
   - `POST /api/acp/job/execute` => return `jobId`
   - worker consumes and updates status
   - `GET /api/acp/jobs/:id`

3. **Semantic risk validator stage**
   - static schema check is not enough
   - block unsafe strategies before chain execution

4. **Payment gating + entitlement checks**
   - paid users can invoke purchased strategies
   - unpaid/expired entitlement blocked at policy boundary

5. **Unified observability panel**
   - job status, rpc quality, payment status, fee accounting

---

## 7) Definition of Done (Architecture Adoption)

A feature is “core-compliant” only if:
- it has explicit boundary ownership
- it has schema + semantic validation
- it records lifecycle transitions
- it is policy-controlled (risk + monetization)
- it is observable with actionable status/metrics

If any item is missing, the feature is not done.
