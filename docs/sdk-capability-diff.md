# SDK Capability Diff

Generated at: 2026-02-19T07:57:08.176Z
Upstream check: disabled

| Protocol | Action | Package | Mode | Recommendation |
|---|---|---|---|---|
| Lista | positions.read | ethers | canonical-client | partial |
| Lista | yield.execute | ethers | canonical-client | partial |
| Lista | yield.markets | ethers | canonical-client | partial |
| Monad+Morpho | earn.execute.deposit | @morpho-org/blue-sdk | canonical-client | partial |
| Monad+Morpho | earn.markets | @morpho-org/blue-sdk | official-sdk | ready |
| Monad+Morpho | earn.rewards | @morpho-org/blue-sdk | official-sdk | ready |
| Monad+Morpho | earn.strategy | @morpho-org/blue-sdk | official-sdk | ready |
| Venus | positions.read | @venusprotocol/chains | official-sdk | ready |
| Venus | yield.execute | @venusprotocol/chains | canonical-client | partial |
| Venus | yield.markets | @venusprotocol/chains | official-sdk | ready |
| Wombat | positions.read | @wombat-exchange/configx | official-sdk | ready |
| Wombat | yield.execute | @wombat-exchange/configx | canonical-client | partial |
| Wombat | yield.markets | @wombat-exchange/configx | official-sdk | ready |

## Detailed Classification

### Lista · positions.read

- endpoint: `GET /api/bsc/positions`
- current protocol/action binding mode: `canonical-client`
- declared blockers: `No maintained official Lista SDK package is currently published for read/account surfaces; reads remain canonical ethers client path (marker-linked).`
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`ready-to-promote`, action=`Run sdk-coverage promote workflow and replace canonical execute path`
- promotion recommendation: **partial**
- suggested next command/check: `npm run sdk:upgrade-readiness && rg -n "official_lista_sdk_not_available_using_canonical_ethers_client_path" apps src`

### Lista · yield.execute

- endpoint: `POST /api/bsc/yield/execute`
- current protocol/action binding mode: `canonical-client`
- declared blockers: `No maintained official Lista execute SDK is published; tx submit remains canonical ethers signer/provider with explicit non-sdk + fallback markers.`
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`ready-to-promote`, action=`Run sdk-coverage promote workflow and replace canonical execute path`
- promotion recommendation: **partial**
- suggested next command/check: `npm run sdk:upgrade-readiness && rg -n "lista_execute_canonical_ethers_path_no_official_sdk_executor" apps src`

### Lista · yield.markets

- endpoint: `GET /api/bsc/yield/markets`
- current protocol/action binding mode: `canonical-client`
- declared blockers: `No maintained official Lista SDK package is currently published for read/account surfaces; reads remain canonical ethers client path (marker-linked).`
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`ready-to-promote`, action=`Run sdk-coverage promote workflow and replace canonical execute path`
- promotion recommendation: **partial**
- suggested next command/check: `npm run sdk:upgrade-readiness && rg -n "official_lista_sdk_not_available_using_canonical_ethers_client_path" apps src`

### Monad+Morpho · earn.execute.deposit

- endpoint: `POST /api/monad/morpho/earn/execute`
- current protocol/action binding mode: `canonical-client`
- declared blockers: ``@morpho-org/blue-sdk` still has no public tx signer/executor for vault deposits; execute submit must remain on canonical ethers signer path (marker-linked).`
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`blocked-no-execute-surface`, action=`Keep canonical fallback; watch upstream releases for signer/submit APIs`
- promotion recommendation: **partial**
- suggested next command/check: `npm run sdk:upgrade-readiness && rg -n "morpho_execute_canonical_ethers_path_no_official_sdk_executor" apps src`

### Monad+Morpho · earn.markets

- endpoint: `GET /api/monad/morpho/earn/markets`
- current protocol/action binding mode: `official-sdk`
- declared blockers: none
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`blocked-no-execute-surface`, action=`Keep canonical fallback; watch upstream releases for signer/submit APIs`
- promotion recommendation: **ready**
- suggested next command/check: `npm run sdk:upgrade-readiness && npm run sdk:capability-diff`

### Monad+Morpho · earn.rewards

- endpoint: `GET /api/monad/morpho/earn/rewards`
- current protocol/action binding mode: `official-sdk`
- declared blockers: none
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`blocked-no-execute-surface`, action=`Keep canonical fallback; watch upstream releases for signer/submit APIs`
- promotion recommendation: **ready**
- suggested next command/check: `npm run sdk:upgrade-readiness && npm run sdk:capability-diff`

### Monad+Morpho · earn.strategy

- endpoint: `GET /api/monad/morpho/earn/strategy`
- current protocol/action binding mode: `official-sdk`
- declared blockers: none
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`blocked-no-execute-surface`, action=`Keep canonical fallback; watch upstream releases for signer/submit APIs`
- promotion recommendation: **ready**
- suggested next command/check: `npm run sdk:upgrade-readiness && npm run sdk:capability-diff`

### Venus · positions.read

- endpoint: `GET /api/bsc/positions`
- current protocol/action binding mode: `official-sdk`
- declared blockers: none
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`blocked-no-execute-surface`, action=`Keep canonical fallback; watch upstream releases for signer/submit APIs`
- promotion recommendation: **ready**
- suggested next command/check: `npm run sdk:upgrade-readiness && npm run sdk:capability-diff`

### Venus · yield.execute

- endpoint: `POST /api/bsc/yield/execute`
- current protocol/action binding mode: `canonical-client`
- declared blockers: `Official `@venusprotocol/chains` covers market/vToken metadata, but there is still no public Venus execute SDK signer/tx-submit client; execute remains canonical ethers signer path (marker-linked).`
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`blocked-no-execute-surface`, action=`Keep canonical fallback; watch upstream releases for signer/submit APIs`
- promotion recommendation: **partial**
- suggested next command/check: `npm run sdk:upgrade-readiness && rg -n "venus_execute_canonical_ethers_path_no_official_sdk_executor" apps src`

### Venus · yield.markets

- endpoint: `GET /api/bsc/yield/markets`
- current protocol/action binding mode: `official-sdk`
- declared blockers: none
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`blocked-no-execute-surface`, action=`Keep canonical fallback; watch upstream releases for signer/submit APIs`
- promotion recommendation: **ready**
- suggested next command/check: `npm run sdk:upgrade-readiness && npm run sdk:capability-diff`

### Wombat · positions.read

- endpoint: `GET /api/bsc/positions`
- current protocol/action binding mode: `official-sdk`
- declared blockers: none
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`blocked-no-execute-surface`, action=`Keep canonical fallback; watch upstream releases for signer/submit APIs`
- promotion recommendation: **ready**
- suggested next command/check: `npm run sdk:upgrade-readiness && npm run sdk:capability-diff`

### Wombat · yield.execute

- endpoint: `POST /api/bsc/yield/execute`
- current protocol/action binding mode: `canonical-client`
- declared blockers: `No official Wombat execute SDK with signer/submit surface is published; execute remains canonical ethers signer/provider path with explicit fallback markers.`
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`blocked-no-execute-surface`, action=`Keep canonical fallback; watch upstream releases for signer/submit APIs`
- promotion recommendation: **partial**
- suggested next command/check: `npm run sdk:upgrade-readiness && rg -n "wombat_execute_canonical_ethers_path_no_official_sdk_executor" apps src`

### Wombat · yield.markets

- endpoint: `GET /api/bsc/yield/markets`
- current protocol/action binding mode: `official-sdk`
- declared blockers: none
- detected upstream signals: upstream check unavailable (reason: `upstream-check-disabled`)
- readiness hint: status=`blocked-no-execute-surface`, action=`Keep canonical fallback; watch upstream releases for signer/submit APIs`
- promotion recommendation: **ready**
- suggested next command/check: `npm run sdk:upgrade-readiness && npm run sdk:capability-diff`

