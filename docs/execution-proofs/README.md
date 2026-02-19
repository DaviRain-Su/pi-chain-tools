# Execution Proof Artifacts

Deterministic execution proof markdown files are generated under:

- `docs/execution-proofs/YYYY-MM-DD/proof-latest.md`
- protocol-scoped variants (optional):
  - `proof-morpho.md`
  - `proof-bsc.md`
  - `proof-lifi.md`

## Commands

```bash
npm run execute:proof
npm run execute:proof:morpho
npm run execute:proof:bsc
npm run execute:proof:lifi
```

## Included proof fields

Each record includes:

- tx hash
- explorer link
- intent summary
- sdkBinding snapshot
- boundaryProof (`confirm/policy/reconcile`)
- fallback reason (if any)
- reconciliation summary
- source session/tool/timestamp

If no tx is found in recent artifacts, output includes `## Missing proof inputs` with checked sources.

## Verification checklist

1. Run `npm run execute:proof` after a real execute flow.
2. Confirm proof path under current date folder.
3. Open proof markdown and verify tx hash + explorer link resolve correctly.
4. Ensure boundaryProof and reconciliation fields are present for audited executions.
5. Run `npm run submission:evidence` and confirm section `Auto-linked Execution Proof Docs` references latest proof files.
