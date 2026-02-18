# Monad Agent Identity v1.4 Notes

## Scope

v1.4 extends the v1.3 identity/delegation scaffold with discovery + naming + delegation policy bridge:

1. Discovery profile endpoint
   - `GET /api/monad/agent/profile`
   - includes deterministic identity, A2A entrypoint, delegation gate status, name mapping snapshot, and Morpho strategy summary.
2. ENS-style alias mapping scaffold (local/stateful, confirm gated)
   - `POST /api/monad/agent/name/register`
   - `POST /api/monad/agent/name/update`
   - invalid requests return `artifact/history/blockers/hints/fixPack`.
3. Delegation policy bridge
   - live execute path and worker loop now check delegation status before execution.
   - blocked checks emit structured action-history/worker events.
4. Dashboard polish
   - new v1.4 card for profile + identity + delegation + name mapping.
   - includes copy profile JSON and alias register/update controls.

## Safety posture

- Name mapping endpoints are intentionally local scaffold only (no speculative chain write).
- All mutating endpoints remain `confirm=true` gated.
- Delegation gate blocks live execute when no active delegation for `monad:morpho:earn:execute`.

## Operational quick checks

```bash
curl -s http://127.0.0.1:4173/api/monad/agent/profile | jq
curl -s http://127.0.0.1:4173/api/monad/agent/identity | jq '.delegationGate'
curl -s -X POST http://127.0.0.1:4173/api/monad/agent/name/register \
  -H 'content-type: application/json' \
  -d '{"confirm":true,"alias":"pi-agent.monad"}' | jq
```
