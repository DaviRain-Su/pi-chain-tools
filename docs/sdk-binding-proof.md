# SDK Binding Proof

This document records explicit SDK/client bindings for Morpho, Venus, Wombat, Lista, and LI.FI, including source-level call sites and fallback blockers.

## Matrix

| Protocol | Action path | npm package | Source file + function | Path type | Blocker (if not full SDK) |
|---|---|---|---|---|---|
| Morpho | Read markets/strategy/rewards | `@morpho-org/blue-sdk` | `apps/dashboard/monad-morpho-sdk.mjs#createMorphoSdkAdapter`, `collectMonadMorphoSdkSnapshot` (wired via `apps/dashboard/server.mjs#collectMonadMorphoMarketsWithSdkFallback`) | SDK-first + canonical read fallback | None for read wiring; fallback remains for runtime fault tolerance |
| Morpho | Execute deposit | `@morpho-org/blue-sdk` (+ canonical signer `ethers`) | `apps/dashboard/monad-morpho-sdk.mjs#executeMorphoDepositWithSdk` (`VaultUtils.toShares`) | Partial SDK (math) + canonical execute | Official Morpho Blue SDK has no public signer/tx-submit executor surface |
| Venus | Read markets/positions | `@venusprotocol/chains` | `apps/dashboard/bsc-venus-sdk.mjs#createVenusSdkAdapter`, `collectVenusSdkMarketView`, `collectVenusSdkPositionView` | SDK-first + provider ABI reads | No official full read client beyond chain registry package |
| Venus | Execute supply | `@venusprotocol/chains` (+ canonical signer `ethers`) | `apps/dashboard/bsc-venus-execute.mjs#executeVenusSupplySdkFirst` / `executeVenusSupplyViaCanonicalEthers` | Canonical execute with SDK metadata | No public official Venus tx executor SDK on npm |
| Wombat | Read markets/positions | `@wombat-exchange/configx` | `apps/dashboard/bsc-wombat-sdk.mjs#createWombatSdkAdapter`, `collectWombatSdkMarketView`, `collectWombatSdkPositionView` | SDK-first metadata + canonical RPC reads | Package is config/metadata-focused; no full read+execute client API |
| Wombat | Execute supply | `@wombat-exchange/configx` (+ canonical signer `ethers`) | `apps/dashboard/bsc-wombat-execute.mjs#executeWombatSupplySdkFirst` | Canonical execute with SDK metadata | No official tx executor SDK surface |
| Lista | Read markets/positions | `ethers` (canonical client), detector checks `@lista-dao/*` candidates | `apps/dashboard/bsc-lista-sdk.mjs#createListaSdkAdapter`, `collectListaSdkMarketView`, `collectListaSdkPositionView` | Canonical client fallback | No maintained official Lista SDK package available on npm |
| Lista | Execute supply | `ethers` (canonical signer) | `apps/dashboard/bsc-lista-execute.mjs#executeListaSupplySdkFirst` | Canonical execute | No maintained official Lista execute SDK package |
| LI.FI | Quote/status/bridge planning | `@lifi/sdk` (explicit dependency), current implementation uses official HTTP API client path | `src/chains/evm/tools/lifi-planning.ts#lifiGet`, `src/chains/evm/tools/lifi-read.ts#createLifiReadTools`, `src/chains/evm/tools/lifi-execute.ts#createLifiExecuteTools` | Canonical official API client path (read/plan only) | Mutation is intentionally blocked by policy; execute remains PI SDK confirm/policy/reconcile gated |

## Runtime proof fields

Dashboard read/plan/execute responses now include `sdkBinding` with this shape:

```json
{
  "package": "<npm package>",
  "versionHint": "<package/version hint>",
  "importMode": "static | dynamic",
  "loaded": true
}
```

Where applicable, BSC aggregate routes expose per-protocol bindings:

```json
{
  "sdkBinding": {
    "venus": { "package": "@venusprotocol/chains", "importMode": "static", "loaded": true },
    "lista": { "package": "ethers", "importMode": "static", "loaded": true },
    "wombat": { "package": "@wombat-exchange/configx", "importMode": "static", "loaded": true },
    "lifi": { "package": "@lifi/sdk", "importMode": "static", "loaded": true }
  }
}
```

Safety boundaries are unchanged: mutating paths still require explicit confirm/policy/reconcile gates and do not bypass existing controls.
