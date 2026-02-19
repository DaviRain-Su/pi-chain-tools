# sol-agent Integration Plan (for pi-chain-tools)

> Target repo evaluated: `https://github.com/brimigs/sol-agent`
> 
> Goal: borrow useful runtime patterns for Solana integration **without** weakening current safety, auditability, and execution controls.

---

## 1) Integration stance

We will use a **selective integration** strategy:

- ✅ Reuse architecture ideas where they improve modularity and Solana DX.
- ✅ Keep existing risk/confirm/reconcile pipeline as execution source of truth.
- ❌ Do **not** import self-replication/self-modification behavior into production execution paths.

**Principle:** adopt components, not governance model.

---

## 2) What to adopt vs. avoid

### Adopt (high-value, low-risk)

1. **Registry/skills modularization pattern**
   - Borrow plugin-like registration ideas for Solana-specific adapters/tools.
   - Map into current strategy/adapter registry design.

2. **Identity/profile conventions**
   - Reuse profile/identity presentation patterns for Solana agent discovery in dashboard.

3. **Heartbeat/task orchestration ideas**
   - Reuse scheduling ergonomics, but route actual execution through our guarded pipelines.

### Avoid / sandbox only

1. **Self-replication flows** (`replication`-style)
2. **Self-modifying runtime paths** (`self-mod`-style)
3. **Unbounded autonomous mutation of execution logic**

These stay disabled in production; if needed, allow only in isolated research mode.

---

## 3) Compatibility map with current pi-chain-tools architecture

### Current strengths we keep unchanged

- `confirm=true` gates for mutating endpoints
- policy/risk controls (caps/cooldowns/blockers)
- artifact + reconciliation + actionHistory evidence chain
- dashboard observability and SDK coverage reporting

### New sol-agent-inspired additions

- **Solana adapter registry layer**
- **Solana profile descriptor** (human + machine readable)
- **Structured task envelopes** for Solana strategy tasks (read/plan/execute/reconcile)

---

## 4) File-level implementation plan

## Phase A — Design + read-only bridge (1 batch)

### New docs
- `docs/sol-agent-integration-plan.md` (this file)
- `docs/sol-agent-risk-boundary.md` (explicit forbidden behaviors + safe-mode policy)

### New code (scaffold)
- `src/chains/solana/sol-agent-bridge.ts`
  - adapter interface only (read/profile/task-envelope)
  - no execute mutation logic
- `src/chains/solana/sol-agent-bridge.test.ts`

### Dashboard (optional in A)
- Add read-only “Sol Agent Bridge” diagnostic section in dashboard data snapshot.

**DoD A**
- compile/test green
- no change to execute paths
- clear safety policy in docs

---

## Phase B — Registry mapping (1–2 batches)

### Code
- `src/chains/solana/registry/*`
  - map current Solana tools into registry descriptors
- `src/chains/solana/tools/*`
  - expose read/plan operations through bridge descriptors

### Runtime wiring
- route bridge-discovered operations to existing handlers
- preserve current signatures and validation

### Tests
- compatibility tests to ensure no behavior drift in existing endpoints

**DoD B**
- registry-backed discovery works
- existing Solana tests unchanged/green

---

## Phase C — Optional orchestrator ergonomics (safe-mode only)

### Add
- cron/heartbeat helper wrappers for Solana read/plan workflows

### Guardrails
- execute requires explicit confirm + policy pass
- no autonomous code mutation
- no dynamic remote code load in production mode

**DoD C**
- operator productivity gain without reducing control/safety

---

## 5) Security and governance policy

## Hard constraints

- Production mode must reject replication/self-mod execution intents.
- Any bridge-discovered mutating operation must pass existing policy gates.
- External runtime metadata can influence **discovery/UI**, not bypass execution authorization.

## Allowed modes

- `safe` (default): read/plan + guarded execute via existing engine
- `research` (opt-in): sandboxed experiments, isolated from production secrets

---

## 6) Risk register

1. **Concept drift** (runtime style mismatch)
   - Mitigation: adapter layer boundary + contract tests
2. **Security drift** (introducing autonomous mutation)
   - Mitigation: hard-deny list + safe-mode defaults + runbook checks
3. **Maintenance overhead**
   - Mitigation: keep bridge thin, avoid deep fork coupling

---

## 7) Success metrics

- No regression in existing Solana/BSC/Monad tests
- No decrease in security gate pass rate
- Improved Solana module discoverability and operator clarity
- Clear traceability of each mutating action to policy/reconcile artifacts

---

## 8) Implementation progress

- ✅ Phase A scaffold completed (bridge contract + risk boundary doc)
- ✅ Phase B registry mapping completed:
  - added `src/chains/solana/registry/*` mapping existing Solana read/plan handlers to bridge descriptors
  - bridge discovery now resolves descriptors back to existing handlers (no signature/validation drift)
  - safety boundary unchanged: execute override is still blocked in bridge path
  - added compatibility and no-behavior-drift tests for mapping/dispatch
- ⏳ Phase C remains optional and safe-mode only

This preserves existing guarded execution while improving Solana discovery ergonomics.
