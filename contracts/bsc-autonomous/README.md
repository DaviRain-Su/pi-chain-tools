# bsc-autonomous contracts

Solidity package for contract-enforced autonomous BSC cycles (Hyperliquid route).

## Compile

```bash
npm run contracts:bsc:compile
```

## Unit tests

```bash
npm run contracts:bsc:test
```

## Deploy (testnet)

```bash
npm run contracts:bsc:deploy:testnet
```

## Run one cycle tx

```bash
npm run contracts:bsc:cycle:testnet -- --contract 0xYourStrategyAddress --transitionNonce 1
```

## End-to-end testnet evidence (guided)

```bash
npm run autonomous:bsc:testnet:evidence
```

## Verify placeholder

```bash
npm run contracts:bsc:verify:testnet
```
