# LI.FI Integration Hardening

## Scope

This hardening pass keeps LI.FI strictly in the **planning/quote** lane while preserving PI SDK as the only mutating execution authority.

## Architecture Boundary

- **LI.FI responsibility**
  - Route discovery / quote planning
  - Status querying (`/status`)
  - Route quality scoring metadata
- **PI SDK responsibility**
  - User confirmation gates
  - Policy checks
  - Mutation signing/broadcast
  - Reconciliation settlement records

`evm_lifiExecuteBridge` now returns planning artifacts in dry-run mode and rejects direct mutation requests.

## Deterministic Route Selection Policy

Route candidates are evaluated across LI.FI order modes: `RECOMMENDED`, `CHEAPEST`, `FASTEST`, `SAFEST`.

Scoring dimensions:

- effective cost (fees + gas + slippage + risk penalty) in bps
- hops count
- execution duration
- route risk hints (multi-hop / slow / high slippage / high cost)

Tie-break policy is deterministic:

1. higher score
2. lower effective cost bps
3. fewer hops
4. shorter ETA
5. lexicographic order label

## Fallback Behavior

When quote retrieval fails for one order mode, planner automatically retries other candidate orders.

- Fallback metadata is emitted in tool details:
  - `fallback.used`
  - `fallback.reason`
  - `fallback.failedOrders[]` with normalized error shape
- If all candidates fail, planner throws normalized LI.FI error code.

## Error Normalization

LI.FI errors are normalized to category/code:

- `LIFI_API_BAD_REQUEST`
- `LIFI_API_UNAUTHORIZED`
- `LIFI_API_NOT_FOUND`
- `LIFI_API_RATE_LIMIT`
- `LIFI_API_SERVER`
- `LIFI_NETWORK_ERROR`
- `LIFI_TIMEOUT`
- `LIFI_VALIDATION_ERROR`
- `LIFI_UNKNOWN_ERROR`

## Observability Added

Each quote/preview now includes:

- `routeSelection` rationale + candidate comparison
- `fallback` details
- `metrics.lifiQuote` counters:
  - `quoteAttempts`
  - `quoteSuccess`
  - `quoteFailure`
  - `fallbackUsed`
- `executionBoundary` marker showing PI SDK execution authority
- `reconciliation` preview fields for selected route rationale

## Troubleshooting Runbook

### Symptom: all LI.FI quote attempts fail

1. Check `details.fallback.failedOrders[]`
2. Verify `LIFI_API_KEY` and `LIFI_API_BASE`
3. Retry with same params to confirm transient rate-limit/network issues
4. If 4xx validation, verify token addresses and amount units

### Symptom: execution is blocked

Expected behavior. This tool no longer performs direct mutation. Use PI SDK execution path with confirm/policy/reconcile flow.

### Symptom: route appears suboptimal

Inspect `routeSelection.candidates[]` and compare:
- `effectiveCostBps`
- `hops`
- `durationSeconds`
- `riskHints`

If needed, pin `order` preference while still allowing fallback.
