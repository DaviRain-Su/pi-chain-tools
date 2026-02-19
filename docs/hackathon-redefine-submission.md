# Re{define} Hackathon Submission Draft (Starknet: Privacy + Bitcoin)

## Project Name
**PI Chain Tools — Private BTC Intent Agent on Starknet**

## One-line Pitch
A policy-gated AI execution agent that plans, simulates, executes, reconciles, and proves Starknet privacy/BTC DeFi operations with production-style safety controls.

## 500-word Description (ready to submit)
PI Chain Tools is a multi-chain agent runtime built for real onchain operations, not just strategy demos. For Re{define}, we extend our proven execution model into Starknet’s two core narratives: **Privacy** and **Bitcoin**.

Our core thesis is simple: crypto agents must be judged by execution quality, not chat quality. That means every operation should pass a strict lifecycle:

1. **Intent**: user goal in plain language (e.g., optimize BTC yield with bounded risk)
2. **Policy**: enforce limits (confirm gates, amount caps, slippage/risk bounds, chain constraints)
3. **Plan/Simulate**: deterministic pre-execution payload with expected outputs
4. **Execute**: explicit `confirm=true` mutation path only
5. **Reconcile**: compare expected vs onchain outcomes
6. **Proof**: output reproducible artifacts for reviewers and operators

For this track, we package these controls into a Starknet-focused flow:
- Privacy-aware strategy handling (clear read/plan vs execute boundary)
- BTC-oriented route planning and portfolio actions
- Safety-first execution with fallback visibility and detector markers
- Submission-ready proof artifacts and demo workflow

Why this matters for Starknet now:
- Privacy is moving from “nice-to-have” to institutional requirement
- Bitcoin liquidity and trust-minimized infra are converging on Starknet
- Builders need operational tooling that can scale from hackathon to production

Unlike many hackathon entries that stop at mocked UI or single-tx demos, PI Chain Tools emphasizes **operator-grade reliability**:
- strict execution guardrails,
- failure-tolerant runbooks,
- explicit fallback semantics,
- and machine-readable evidence.

This gives users confidence that actions are both automatable and auditable.

Our submission includes:
- Public repository with implementation and docs
- Working dashboard/runtime for read/plan/execute visibility
- Real execution patterns (with safe confirmation gates)
- A concise 3-minute demo showcasing intent → policy → execute → proof

In short, PI Chain Tools turns Starknet privacy/BTC narratives into a practical, governable agent execution product.

## 3-minute Demo Script (judge-friendly)
1. **Problem (20s)**: Agents are easy to demo, hard to trust.
2. **Architecture (35s)**: Intent/Policy/Execution/Settlement/Observability boundary.
3. **Live flow (70s)**: run plan → confirm execute → show tx + reconciliation.
4. **Safety (30s)**: show blocked path when confirm/risk limits fail.
5. **Proof (25s)**: generate artifact and show deterministic evidence output.
6. **Close (20s)**: why this is Starknet-ready and production-oriented.

## Implementation Scope (Phase-1 for this hackathon)
- [ ] Add Starknet runtime module with read/plan baseline tools
- [ ] Add BTC-oriented strategy template under Starknet track
- [ ] Add execute guards (`confirm=true`, risk + slippage + amount bounds)
- [ ] Add reconcile + proof schema for Starknet execution artifacts
- [ ] Add `docs/hackathon-redefine-demo.md` walkthrough

## Required Submission Checklist
- [ ] Working demo/prototype on Starknet testnet/mainnet
- [ ] Public GitHub repository
- [ ] 500-word description (use section above)
- [ ] 3-minute demo video
- [ ] Starknet wallet address for rewards

## Starknet Tx Proof Checklist (Execution Artifact)
- [ ] At least one Starknet tx hash captured from execute output (sepolia/mainnet)
- [ ] Generate proof file:
  - `npm run execute:proof:starknet -- --tx 0xYOUR_STARKNET_TX_HASH`
- [ ] Attach generated markdown:
  - `docs/execution-proofs/YYYY-MM-DD/proof-starknet.md`
- [ ] Verify links open on Starkscan (mainnet/sepolia)

## Notes
- Hackathon page: https://dorahacks.io/hackathon/redefine/detail
- Track focus: Privacy + Bitcoin on Starknet
