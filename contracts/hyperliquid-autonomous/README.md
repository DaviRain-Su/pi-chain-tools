# hyperliquid-autonomous contracts

Solidity package for contract-enforced autonomous BSC cycles (Hyperliquid route).

## Compile

```bash
npm run contracts:hyperliquid:compile
```

## Unit tests

```bash
npm run contracts:hyperliquid:test
```

## Deploy (testnet)

```bash
npm run contracts:hyperliquid:deploy:testnet
```

## Run one cycle tx

```bash
npm run contracts:hyperliquid:cycle:testnet -- --contract 0xYourStrategyAddress --transitionNonce 1
```

## End-to-end testnet evidence (guided)

```bash
npm run autonomous:hyperliquid:testnet:evidence
```

## Verify placeholder

```bash
npm run contracts:hyperliquid:verify:testnet
```
