---
title: 'Tempo actions force deployless multicalls and extra decimals reads'
severity: 'minor'
target: 'viem'
---

## What happened

Making `Handler.relay` batch its reads through Tempo's genesis Multicall3 (tempoxyz/accounts#952) did not cover its fee-pool reads. `Actions.amm.getPool` calls `multicall(client, { deployless: true, ... })`, so it ignores the client's `batch.multicall` settings and the chain's `contracts.multicall3`: every batch ships Multicall3's ~6.6 KB of bytecode, and it also reads each pool's LP `totalSupply`. `Actions.token.getBalance` without `decimals` also reads `decimals()` for every token, doubling a 37-token balance multicall.

## Workaround

Read `Actions.amm.getPool.calls(...)[0]` with `readContract`, and `balanceOf` with `readContract` directly.

## Expected

Tempo actions honor the client's multicall configuration, and `getBalance` can skip the decimals read when the caller only needs the amount.
