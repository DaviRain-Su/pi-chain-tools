# SDK Coverage Report (Monad+Morpho / Venus / Lista / Wombat)

Source of truth (machine-readable): `docs/sdk-coverage-report.json`.

Mode definitions:
- `official-sdk`: routed through an official protocol SDK package.
- `canonical-client`: routed through official canonical client package and/or ethers provider/signer path.
- `native-fallback`: explicit fallback route when sdk/canonical path fails.

## Replacement Matrix (endpoint + action)

| protocol | action | endpoint | current mode | completion status | blockers |
|---|---|---|---|---|---|
| Monad+Morpho | earn.markets | `GET /api/monad/morpho/earn/markets` | official-sdk | upgraded | — |
| Monad+Morpho | earn.strategy | `GET /api/monad/morpho/earn/strategy` | official-sdk | upgraded | — |
| Monad+Morpho | earn.rewards | `GET /api/monad/morpho/earn/rewards` | official-sdk | upgraded | — |
| Monad+Morpho | earn.execute.deposit | `POST /api/monad/morpho/earn/execute` | canonical-client | partial | blue-sdk currently has no full tx signer/executor flow for vault deposit |
| Venus | yield.markets | `GET /api/bsc/yield/markets` | canonical-client | partial | `@venusprotocol/sdk` not published on npm; using `@venusprotocol/chains` + ABI/provider |
| Venus | positions.read | `GET /api/bsc/positions` | canonical-client | partial | same as above |
| Venus | yield.execute | `POST /api/bsc/yield/execute` | canonical-client | partial | execution remains ethers-native path with fallback markers |
| Lista | yield.markets | `GET /api/bsc/yield/markets` | canonical-client | blocked | no maintained official npm SDK currently available |
| Lista | positions.read | `GET /api/bsc/positions` | canonical-client | blocked | no maintained official npm SDK currently available |
| Lista | yield.execute | `POST /api/bsc/yield/execute` | canonical-client | partial | native/command path retained for safe operation |
| Wombat | yield.markets | `GET /api/bsc/yield/markets` | canonical-client | partial | `@wombat-exchange/configx` is metadata-oriented, not full execute SDK |
| Wombat | positions.read | `GET /api/bsc/positions` | canonical-client | partial | no full official npm SDK for read/execute parity |
| Wombat | yield.execute | `POST /api/bsc/yield/execute` | canonical-client | partial | execution kept on ethers-native/command bridge |

## Notes

- Safety behavior remains default-safe: all sdk/canonical paths keep explicit fallback behavior and warning markers.
- Non-replaceable paths are now annotated in code (`apps/dashboard/bsc-venus-sdk.mjs`, `apps/dashboard/bsc-lista-sdk.mjs`, `apps/dashboard/bsc-wombat-sdk.mjs`, `apps/dashboard/monad-morpho-sdk.mjs`) and reflected in this report.
