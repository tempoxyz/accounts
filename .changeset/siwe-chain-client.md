---
"accounts": patch
---

Added chain-aware SIWE signature verification and surfaced RPC failures separately from invalid signatures.

```ts
Handler.auth({
  getClient: (chainId) => clients.get(chainId)!,
})
```
