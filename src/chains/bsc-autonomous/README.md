# BSC Autonomous Track (Template)

This module hosts additive, flag-gated autonomous-track metadata and routing helpers.

- Default: legacy track (`BSC_AUTONOMOUS_MODE=false`)
- Optional: autonomous track markers (`BSC_AUTONOMOUS_MODE=true`)

The design goal is incremental compatibility: no legacy interface breaking changes.

Hyperliquid execute-binding seam is additive and guarded:
- capability marker: `executeBinding: none|prepared|active`
- `prepared` = typed execute intent can be prepared
- `active` = explicit active marker set; still expected to pass risk/confirmation gates
