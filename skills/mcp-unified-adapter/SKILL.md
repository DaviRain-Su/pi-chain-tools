---
name: mcp-unified-adapter
description: Provider-pluggable MCP access via a single pi-chain-tools adapter (search/quote/plan).
---

# MCP Unified Adapter

Use `createMcpAdapter()` as the single entrypoint for MCP provider access.

## Safety boundary

- Default mode is **read + plan only**.
- Mutation/execution must stay in PI SDK execute paths with confirm/risk/policy/reconcile checks.

## Quick usage

```ts
import { createMcpAdapter } from "pi-chain-tools";

const adapter = createMcpAdapter();

const search = await adapter.search({
  query: "imperative trade",
});

const quote = await adapter.quote({
  providerId: "dflow",
  params: { pair: "SOL/USDC", amount: "100" },
});

const plan = await adapter.plan({
  providerId: "dflow",
  params: { intent: "best route for stable swap" },
});
```

## Notes

- `providerId` is optional. If omitted, adapter resolves the configured default provider.
- Current default provider: `dflow` (when configured/available).
- Unsupported capabilities return normalized `{ error.code: "not_supported" }`.
