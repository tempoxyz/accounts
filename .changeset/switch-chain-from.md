---
'accounts': patch
---

Added `from` to `Accounts.switchChain`. A switch with `from` selects `chainId` only if the selected chain is still `from` when the switch runs, after the earlier switches.

```ts
await accounts.switchChain({ chainId: tempo.id, from: tempoModerato.id })
```
