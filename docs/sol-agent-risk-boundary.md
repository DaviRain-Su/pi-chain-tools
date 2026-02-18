# sol-agent Risk Boundary (Production Safety Contract)

This document defines the **non-negotiable safety boundary** for integrating sol-agent-inspired patterns into `pi-chain-tools`.

## 1) Explicitly forbidden in production

The following behaviors are **forbidden** in production execution paths:

1. **Replication behaviors**
   - No self-replication, self-cloning, or runtime copy-spawn loops.
2. **Self-modifying runtime paths**
   - No code generation or code patching that can alter live execution behavior.
3. **Autonomous mutation without operator confirmation**
   - No unbounded autonomous action that mutates funds, state, policy, or execution routing.

If any discovered capability implies one of the above, it must be hard-rejected in production mode.

## 2) Safe mode vs research mode

### `safe` mode (default, production)

Allowed:
- Read-only discovery/profile/introspection
- Plan/simulate outputs
- Mutating actions only through existing guarded pipeline

Required controls:
- `confirm=true` and existing confirm token flow where applicable
- Policy/risk checks (caps/cooldowns/blockers)
- Reconciliation/artifact recording after mutation

Disallowed:
- Any replication/self-mod/autonomous mutation behavior
- Dynamic remote logic that bypasses the existing execution engine

### `research` mode (opt-in, isolated)

Allowed:
- Experimental mapping/evaluation of agent patterns in sandboxed environments

Mandatory boundaries:
- No production key material
- No direct production execution endpoints
- Explicit operator opt-in and environment isolation

Research outputs are advisory until promoted through normal review and release flow.

## 3) Mutation operation requirements

For any mutating operation (transfer/swap/lend/withdraw/borrow/etc.), all of the following are required:

1. **Confirm requirement**
   - Explicit operator confirmation (`confirm=true` and chain-specific safeguards).
2. **Policy requirement**
   - Existing risk policy gates must pass before execution.
3. **Reconcile requirement**
   - Action history + reconcile artifacts must be persisted for auditability.

If any requirement fails, execution must be blocked.

## 4) Integration contract for Phase A bridge

Phase A bridge is read-only scaffold:
- read/profile/task-discovery envelopes only
- no execute-path override logic
- no mutation dispatching

Any future Phase B/Phase C extensions must preserve this boundary unless explicitly updated via reviewed design + tests.
