# PI SDK–First MCP Adapter Architecture (Phase 1 Scaffold)

## Purpose

This document defines a **MCP-style orchestration adapter** for `pi-chain-tools` that improves discovery/normalization ergonomics while preserving one hard rule:

> **All mutating actions must flow through the existing PI SDK confirm/risk/policy/reconcile execution path.**

The adapter introduced in this phase is **read/plan only**. It must not execute signer, RPC broadcast, or on-chain state mutations.

## Boundary Model

### 1) Orchestration Layer (`src/core/pi-mcp-adapter.ts`)

Responsibilities:
- Accept MCP-style task envelopes.
- Validate and normalize envelope shape (id, phase, intent, payload).
- Support discovery for read/plan-capable routes.
- Route read/plan tasks to registered route handlers.
- Return deterministic rejection for execute/broadcast attempts.

Non-responsibilities:
- No key handling.
- No transaction signing.
- No raw RPC broadcast.
- No policy override.
- No reconciliation finalization.

### 2) Execution Core (existing PI SDK tool/runtime path)

Responsibilities (already implemented elsewhere):
- Confirmation gates (`confirmMainnet`, deterministic `confirmToken`, etc.).
- Risk checks and policy checks.
- Execute-mode safety constraints.
- Reconciliation/status shaping after execution.

All state-changing behavior remains here.

## Mandatory Enforcement Rules

1. **Mutating path lock-in**  
   Any `phase=execute` envelope received by adapter must be rejected with explicit boundary error (`PI_MCP_EXECUTE_BLOCKED`).

2. **No bypass of PI safety chain**  
   The adapter cannot call direct signer APIs or direct RPC mutation methods.

3. **No runtime self-modification from adapter code path**  
   Adapter routes cannot alter this process's guardrails, plugin config, or policy state at runtime.

4. **Schema-first acceptance**  
   Envelopes must pass structural validation before routing.

5. **Deterministic error semantics**  
   Boundary violations must return stable, machine-checkable error codes.

## Anti-Bypass / Anti-Self-Mod Constraints

The adapter treats the following as violations:
- Any attempt to route `execute` through read/plan handlers.
- Any envelope attempting to override `phase` semantics via payload shadow fields.
- Any attempt to pass signer/private key/RPC-broadcast directives through adapter-level metadata.
- Any behavior that mutates adapter route table post-instantiation without explicit construction-time registration.

Operationally, this means:
- Route discovery exposes only read/plan capabilities.
- Execute requests fail fast before route resolution.
- Normalization strips ambiguity and pins phase semantics to validated top-level fields.

## Current Scope (read/plan routed, execute blocked)

Implemented now:
- Envelope schema/shape validation helpers.
- Discovery + normalization for read/plan tasks.
- Real Solana routing via `createPiMcpSolanaApi()` + Solana registry descriptors.
- Stable execute rejection at adapter boundary (`PI_MCP_EXECUTE_BLOCKED`).
- Lightweight dashboard summary fields for operators:
  - discovered task count
  - recent run summary
  - execute rejection count

Deferred to later phases:
- Policy-aware handoff contracts into PI SDK execution core.
- Rich intent-level type registries.
- Multi-chain capability catalogs and negotiated routing profiles.

## Usage Runbook (internal discover/run routes)

```ts
import { createPiMcpSolanaApi } from "pi-chain-tools";

const piMcp = createPiMcpSolanaApi();

// discover (read/plan only)
const discovered = piMcp.discover();

// run read/plan via envelope
const result = await piMcp.run({
  id: "task-1",
  phase: "read",
  intent: "read:solana_getPortfolio",
  payload: { account: "..." },
});

// lightweight dashboard visibility
const summary = piMcp.getDashboardSummary();
```

Safe-mode semantics:
- `phase=read|plan` → routed to existing Solana handlers with no behavior drift.
- `phase=execute` → always rejected with `PI_MCP_EXECUTE_BLOCKED`.
- Unknown task ids return `PI_MCP_TASK_NOT_FOUND`.

## Security Invariant

Even with MCP-style orchestration ergonomics, **the PI SDK execution boundary remains the only execution authority**.

If execution is required, callers must use existing PI SDK execute tools/workflows that enforce confirm/risk/policy/reconcile controls.
