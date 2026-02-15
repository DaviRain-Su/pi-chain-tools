# Dependency Security Audit Strategy

`pi-chain-tools` uses a **policy-gated dependency audit** in CI to keep dependency risk explicit and traceable.

## What runs in CI

The `ci` script runs:

```bash
npm run check
npm run security:check
npm test
```

`security:check` executes `scripts/security-audit.mjs` which:

1. runs `npm audit --omit=dev --json --audit-level=<threshold>`
2. loads `scripts/security-audit-policy.json`
3. fails only when an issue is above threshold **and** not allowed by policy
4. prints a compact blocked list with optional `reason`

## Current policy file

- path: `scripts/security-audit-policy.json`
- default threshold: `high` (can be overridden by `--threshold` or `AUDIT_THRESHOLD`)

## High-risk exposure groups (current)

### 1) Solana token stack (transitive)

- `@solana/spl-token`
- `@solana/buffer-layout-utils`
- `bigint-buffer`
- `@solana/spl-stake-pool`

These are pulled in by Solana liquidity/lending integrations and are currently the
largest shared exposure path in this repo.

### 2) Kamino / Raydium / Meteora transitive graph

- `@kamino-finance/farms-sdk`
- `@kamino-finance/kliquidity-sdk`
- `@kamino-finance/klend-sdk`
- `@raydium-io/raydium-sdk-v2`
- `@meteora-ag/dlmm`

These appear because of Solana DeFi feature integrations and are currently allowed by policy until upstreams provide non-breaking patched ranges.

## Planned remediation roadmap

1. **Short term (now):** keep explicit allowlist and avoid unapproved growth via CI gating.
2. **Medium term:** track upstream security releases for each package family weekly.
3. **Medium/long term:** evaluate decoupling Solana DeFi integrations behind optional install path(s).
4. **Long term:** migrate to patched upstream versions once available, then remove allowlist entries in a single PR.

## Policy update workflow

When a new vulnerability is discovered:

- Determine whether it is currently allowed in `scripts/security-audit-policy.json`.
- If allowed, add/adjust:
  - package name
  - max accepted severity
  - remediation reason
- If disallowed, either:
  - fix through dependency upgrade/migration, or
  - consciously accept by raising policy (with reason and planned removal date)
- Re-run `npm run security:check` to verify.

## Local usage

Run a custom threshold without editing the policy:

```bash
node scripts/security-audit.mjs --threshold=critical
```

Use alternate policy file:

```bash
node scripts/security-audit.mjs --policy ./scripts/security-audit-policy.json
```