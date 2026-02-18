# SDK Coverage Report (Monad+Morpho / Venus / Lista / Wombat)

Source of truth (machine-readable): `docs/sdk-coverage-report.json`.

RAG definitions:
- 🟩 green = `official-sdk` (or official package + sdk-first as far as public APIs allow)
- 🟨 yellow = `canonical-client` with explicit blocker
- 🟥 red = `native-fallback` only

Mode definitions:
- `official-sdk`: routed through an official protocol SDK package.
- `canonical-client`: routed through official canonical client package and/or ethers provider/signer path.
- `native-fallback`: explicit fallback route when sdk/canonical path fails.

## Replacement Matrix (endpoint + action)

| protocol | action | endpoint | RAG | current mode | blocker | next action | code marker alignment |
|---|---|---|---|---|---|---|---|
| Monad+Morpho | earn.markets | `GET /api/monad/morpho/earn/markets` | 🟩 | official-sdk | — | Maintain route; monitor Morpho SDK API changes for execute parity. | `official_morpho_sdk_not_available_using_canonical_ethers_client_path` |
| Monad+Morpho | earn.strategy | `GET /api/monad/morpho/earn/strategy` | 🟩 | official-sdk | — | Keep strategy normalizer aligned with Morpho SDK release notes. | `official_morpho_sdk_not_available_using_canonical_ethers_client_path` |
| Monad+Morpho | earn.rewards | `GET /api/monad/morpho/earn/rewards` | 🟩 | official-sdk | — | Keep scaffold-compat warning behavior until official rewards-claim SDK flow exists. | `sdk_scaffold_mode_enabled` |
| Monad+Morpho | earn.execute.deposit | `POST /api/monad/morpho/earn/execute` | 🟨 | canonical-client | `@morpho-org/blue-sdk` has no public tx signer/executor for vault deposit. | Track Morpho Blue SDK execute signer pipeline; replace canonical signer submit path when available. | `morpho_execute_canonical_ethers_path_no_official_sdk_executor`, `morpho_execute_non_sdk_native_fallback_path`, `morpho_execute_tx_uses_canonical_ethers_signer_no_official_sdk_executor` |
| Venus | yield.markets | `GET /api/bsc/yield/markets` | 🟩 | official-sdk | — | Keep official `@venusprotocol/chains` wiring and sdk-first registry resolution aligned with upstream updates. | `venus_usdc_vtoken_defaulted_from_official_registry`, `venus_usdt_vtoken_defaulted_from_official_registry` |
| Venus | positions.read | `GET /api/bsc/positions` | 🟩 | official-sdk | — | Maintain sdk-first Venus position projection using official chain registry package while monitoring for native read-client additions. | `venus_usdc_vtoken_defaulted_from_official_registry`, `venus_usdt_vtoken_defaulted_from_official_registry` |
| Venus | yield.execute | `POST /api/bsc/yield/execute` | 🟨 | canonical-client | SDK-first market/vToken resolution exists, but tx submit is canonical ethers signer (no official execute SDK). | Migrate execute submit path when official Venus tx executor SDK is available. | `venus_execute_canonical_ethers_path_no_official_sdk_executor`, `venus_execute_non_sdk_native_fallback_path`, `venus_execute_tx_uses_canonical_ethers_signer_no_official_sdk_executor` |
| Lista | yield.markets | `GET /api/bsc/yield/markets` | 🟨 | canonical-client | No maintained official Lista npm SDK available. | Re-check official `@lista-dao/*` SDK candidates each release cycle; replace canonical reads when available. | `official_lista_sdk_not_available_using_canonical_ethers_client_path` |
| Lista | positions.read | `GET /api/bsc/positions` | 🟨 | canonical-client | No maintained official Lista npm SDK available. | Adopt official Lista position APIs when maintained package is published. | `official_lista_sdk_not_available_using_canonical_ethers_client_path` |
| Lista | yield.execute | `POST /api/bsc/yield/execute` | 🟨 | canonical-client | Execute still canonical ethers signer/provider; no maintained official execute SDK published. | Switch execute adapter to official Lista tx SDK once available. | `lista_execute_canonical_ethers_path_no_official_sdk_executor`, `lista_sdk_execute_failed_fallback_to_native`, `lista_execute_tx_uses_canonical_ethers_signer_no_official_sdk_executor` |
| Wombat | yield.markets | `GET /api/bsc/yield/markets` | 🟨 | canonical-client | `@wombat-exchange/configx` remains optional peer and is unavailable in default install; security gate also blocks promoting the package to hard dependency due high-severity advisories. | Keep scaffold-compatible provider read path; re-evaluate once official package can be consumed without policy exceptions. | `official_wombat_client_package_not_available_using_scaffold_provider_path`, `wombat_sdk_scaffold_mode_enabled` |
| Wombat | positions.read | `GET /api/bsc/positions` | 🟨 | canonical-client | Default runtime still lacks loadable official Wombat read package under current dependency/security policy. | Promote to green after official package is installable and policy-clean for default runtime. | `official_wombat_client_package_not_available_using_scaffold_provider_path`, `wombat_sdk_scaffold_mode_enabled` |
| Wombat | yield.execute | `POST /api/bsc/yield/execute` | 🟨 | canonical-client | Execute remains canonical ethers signer/provider; no official Wombat execute SDK published. | Replace canonical execute path when official Wombat tx executor SDK is production-ready. | `wombat_execute_canonical_ethers_path_no_official_sdk_executor`, `wombat_sdk_execute_failed_fallback_to_native`, `wombat_execute_tx_uses_canonical_ethers_signer_no_official_sdk_executor` |

## Replacement Completion Summary (Item 5)

- Total actions tracked: **13**
- Coverage split: **🟩 5 / 🟨 8 / 🟥 0**
- Unresolved blockers are execute-surface + package-availability/policy gaps (Morpho execute signer API, Venus execute SDK signer surface, Lista official SDK publish, Wombat official package availability/security-policy compatibility).
- Every non-green row now includes explicit **blocker + next action + code marker alignment**.

## CI Failure Playbook (tiny)

For recurring CI flakes/signature loops:
1. run `npm run check` (includes `node scripts/normalize-runtime-metrics.mjs` pre-step);
2. if transient host/network interruption appears (e.g. SIGTERM), run `npm run ci:retry`;
3. if local python alias mismatch appears (`python` missing), use `npm run ci:resilient` (auto python3 shim + bounded retries).

## Notes

- Safety behavior remains default-safe: all sdk/canonical paths keep explicit fallback behavior and warning markers.
- Non-replaceable paths are annotated in code (`apps/dashboard/bsc-venus-sdk.mjs`, `apps/dashboard/bsc-lista-sdk.mjs`, `apps/dashboard/bsc-wombat-sdk.mjs`, `apps/dashboard/bsc-wombat-execute.mjs`, `apps/dashboard/monad-morpho-sdk.mjs`) and reflected in this report.
