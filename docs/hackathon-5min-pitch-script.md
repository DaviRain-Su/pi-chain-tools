# 5-Minute Pitch Script (Monad + Morpho Stable Yield Agent)

## 0:00 - 0:30 Problem
“Stablecoin yield tools are either too manual or too opaque. Users can’t easily verify execution quality, and teams struggle to operate strategies safely.”

## 0:30 - 1:15 Solution
“We built an AI-powered stable yield agent on Monad + Morpho that does end-to-end:
read markets, plan allocations, execute onchain with safety gates, reconcile outcomes, and expose operations in a dashboard.”

## 1:15 - 2:15 Live capability highlights
- Read: vault discovery with APY/TVL/risk
- Strategy: multi-vault scoring and allocation recommendation
- Execute: confirm-gated deposit path (real tx)
- Proof: tx hash + reconciliation artifact

## 2:15 - 3:00 Agent architecture edge
- Deterministic agent identity
- Delegation prepare/submit/revoke scaffold (EIP-712 style)
- Delegation gate integrated with worker/execute path
- Name mapping + profile endpoint for self-describing agent discovery

## 3:00 - 3:45 Safety and reliability
- confirm gate, cooldown, max amount, daily cap
- dry-run-first worker controls
- replay/pressure pack to show reliability trends
- incident/export tooling for operator workflows

## 3:45 - 4:30 Why this is different
“We’re not presenting a simulation. We provide verifiable onchain execution, reproducible setup, and operational controls that make this usable beyond demo day.”

## 4:30 - 5:00 Close
“Today we’re submitting a production-minded hackathon build:
agent identity + delegation + strategy + execution + proof.
Next step is expanding reward claim depth and cross-vault automation policies.”

---

## Quick Q&A bullets
- **How do you prove execution?** tx hash + reconciliation artifact + action history.
- **How do you prevent unsafe actions?** confirm gate + policy blockers + delegation gate.
- **Can this scale to more strategies?** yes, strategy layer is modular (weights/policies/vault sets).
- **What’s next?** deeper rewards flow + broader protocol adapters + stress-test automation.
