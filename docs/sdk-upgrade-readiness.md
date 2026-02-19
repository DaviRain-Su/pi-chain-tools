# SDK Upgrade Readiness

Generated at: 2026-02-19T05:35:10.546Z

| Package | Installed | Execute Surface | Status | Next Action |
|---|---:|---:|---|---|
| @venusprotocol/chains | yes | no | blocked-no-execute-surface | Keep canonical fallback; watch upstream releases for signer/submit APIs |
| @wombat-exchange/configx | yes | no | blocked-no-execute-surface | Keep canonical fallback; watch upstream releases for signer/submit APIs |
| @morpho-org/blue-sdk | yes | no | blocked-no-execute-surface | Keep canonical fallback; watch upstream releases for signer/submit APIs |
| ethers | yes | yes | ready-to-promote | Run sdk-coverage promote workflow and replace canonical execute path |
| lista-candidates | no | no | blocked-not-installed | Install/resolve package first |

## Details

```json
{
  "now": "2026-02-19T05:35:10.546Z",
  "dependencies": [
    "@cetusprotocol/aggregator-sdk",
    "@cetusprotocol/cetus-sui-clmm-sdk",
    "@cetusprotocol/common-sdk",
    "@cetusprotocol/farms-sdk",
    "@cetusprotocol/sui-clmm-sdk",
    "@cetusprotocol/vaults-sdk",
    "@ethersproject/wallet",
    "@jup-ag/api",
    "@kaspa/wallet",
    "@lifi/sdk",
    "@morpho-org/blue-sdk",
    "@morpho-org/morpho-ts",
    "@mysten/bcs",
    "@mysten/sui",
    "@mysten/utils",
    "@polymarket/clob-client",
    "@sinclair/typebox",
    "@solana/spl-token",
    "@solana/web3.js",
    "@venusprotocol/chains",
    "@wombat-exchange/configx",
    "bs58",
    "near-api-js",
    "stable-layer-sdk"
  ],
  "checks": [
    {
      "package": "@venusprotocol/chains",
      "installed": true,
      "exportCount": 16,
      "hasExecuteSurface": false,
      "executeCandidates": [],
      "sampleExports": [
        "ChainId",
        "IMAGES_DIR_NAME",
        "IMAGES_DIR_PATH",
        "MS_PER_DAY",
        "MainnetChainId",
        "NATIVE_TOKEN_ADDRESS",
        "TestnetChainId",
        "bnb",
        "chains",
        "eth",
        "getBlockTimeByChainId",
        "getRpcUrls",
        "getToken",
        "tokens",
        "vTokens"
      ]
    },
    {
      "package": "@wombat-exchange/configx",
      "installed": true,
      "exportCount": 3,
      "hasExecuteSurface": false,
      "executeCandidates": [],
      "sampleExports": [
        "__esModule",
        "default",
        "module.exports"
      ]
    },
    {
      "package": "@morpho-org/blue-sdk",
      "installed": true,
      "exportCount": 82,
      "hasExecuteSurface": false,
      "executeCandidates": [],
      "sampleExports": [
        "AccrualPosition",
        "AccrualVault",
        "AccrualVaultV2",
        "AccrualVaultV2MorphoMarketV1Adapter",
        "AccrualVaultV2MorphoMarketV1AdapterV2",
        "AccrualVaultV2MorphoVaultV1Adapter",
        "AdaptiveCurveIrmLib",
        "AssetBalances",
        "BlueErrors",
        "CapacityLimitReason",
        "ChainId",
        "ChainUtils",
        "ConstantWrappedToken",
        "DEFAULT_SLIPPAGE_TOLERANCE",
        "EIP_712_FIELDS"
      ]
    },
    {
      "package": "ethers",
      "installed": true,
      "exportCount": 21,
      "hasExecuteSurface": true,
      "executeCandidates": [
        "Wallet"
      ],
      "sampleExports": [
        "BaseContract",
        "BigNumber",
        "Contract",
        "ContractFactory",
        "FixedNumber",
        "Signer",
        "VoidSigner",
        "Wallet",
        "Wordlist",
        "__esModule",
        "constants",
        "default",
        "errors",
        "ethers",
        "getDefaultProvider"
      ]
    },
    {
      "package": "lista-candidates",
      "installed": false,
      "hasExecuteSurface": false,
      "executeCandidates": [],
      "sampleExports": [],
      "details": [
        {
          "package": "@lista-dao/sdk",
          "installed": false,
          "error": "Cannot find package '@lista-dao/sdk' imported from /home/davirain/clawd/pi-chain-tools/scripts/sdk-upgrade-readiness.mjs",
          "hasExecuteSurface": false,
          "executeCandidates": [],
          "sampleExports": []
        },
        {
          "package": "@lista-dao/contracts",
          "installed": false,
          "error": "Cannot find package '@lista-dao/contracts' imported from /home/davirain/clawd/pi-chain-tools/scripts/sdk-upgrade-readiness.mjs",
          "hasExecuteSurface": false,
          "executeCandidates": [],
          "sampleExports": []
        },
        {
          "package": "@lista-dao/lista-sdk",
          "installed": false,
          "error": "Cannot find package '@lista-dao/lista-sdk' imported from /home/davirain/clawd/pi-chain-tools/scripts/sdk-upgrade-readiness.mjs",
          "hasExecuteSurface": false,
          "executeCandidates": [],
          "sampleExports": []
        }
      ]
    }
  ]
}
```

## Workflow

1. Run `node scripts/sdk-upgrade-readiness.mjs` (or `npm run sdk:upgrade-readiness`) after dependency updates.
2. Run `npm run sdk:capability-diff` to generate action-level promotion recommendations from binding proof + coverage artifacts.
3. Optional upstream metadata probe: `npm run sdk:capability-diff -- --upstream`.
4. If target protocol status is `ready-to-promote`, run sdk coverage promotion runbook and remove canonical fallback markers.
5. Keep readiness and capability-diff reports committed for release/audit traceability.