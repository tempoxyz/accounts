---
'accounts': patch
---

**Breaking:** `Accounts.from` and `Accounts.create` take `chain: 'mainnet' | 'testnet' | number`, which replaces `chainId` and `dev`. `'testnet'` replaces `dev: true`, and a number names a chain by its ID, as `chainId` did. The configuration still holds the chain's ID as `config.chainId`, and the wagmi connector still takes its own `chainId`. The options type `chainId` as `never`, so a spread that still carries it, such as one of a resolved configuration, does not compile.

```diff
-const accounts = Accounts.create({ dev: true })
+const accounts = Accounts.create({ chain: 'testnet' })
```

```diff
-const accounts = Accounts.create({ chainId: tempoDevnet.id })
+const accounts = Accounts.create({ chain: tempoDevnet.id })
```
