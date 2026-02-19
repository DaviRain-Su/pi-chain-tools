# Submission Evidence Artifact

## 1) Latest Commit

- Hash: `8107ba4b97b3dd58dcc72cef788e66cd6f0df071`
- Commit Date (ISO): 2026-02-19T09:02:27+08:00
- Subject: docs: add final release notes and link in README

## 2) Quality Snapshot (best-effort)

| Command | Status | Exit Code | Timestamp | Source Session |
| --- | --- | --- | --- | --- |
| npm run check | pass | 0 | 2026-02-19T01:09:05.271Z | 3f56e19b-763c-49ce-8604-b833e7ee9ac8 |
| npm run test | pass | 0 | 2026-02-19T01:09:05+08:00 | local seal run |
| npm run security:check | pass | 0 | 2026-02-19T00:16:36.099Z | 35ded0a9-8385-4702-ac75-8731e341c711 |

## 3) Key Endpoints / Session References

- Demo base URL: `http://127.0.0.1:4173`
- ACP status endpoint: `http://127.0.0.1:4173/api/acp/status`
- Jobs summary endpoint: `http://127.0.0.1:4173/api/acp/jobs/summary`
- Latest OpenClaw session id: `3f56e19b-763c-49ce-8604-b833e7ee9ac8`

### Required before submission (blocking)

- [ ] Add public OpenClaw session reference link if judges require one
- [ ] Add final public video demo link

## 4) Dashboard Runtime (local)

- Dashboard ensure status: healthy
- Dashboard ensure output: `{"ok":true,"action":"ensure","port":4173,"healthy":true,"preflightAvoidedCollision":true,"collisionDetected":true,"message":"dashboard already healthy; skipped restart"}`

## 5) Onchain Tx Proof

### Required before submission (blocking)

- [ ] Tx #1 hash + explorer + intent + reconciliation summary
- [ ] Tx #2 hash + explorer + intent + reconciliation summary
- [ ] Tx #3 (optional) hash + explorer + intent + reconciliation summary

---
Sealed for final submission: unresolved fields are converted into explicit blocking checklist items.
