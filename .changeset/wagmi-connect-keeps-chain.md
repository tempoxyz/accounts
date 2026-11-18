---
'accounts': patch
---

Fixed `connect` of the `tempoId` connector with `chainId` keeping the selected chain after a failed connection, such as a closed dialog or a denial. The connector selects its earlier chain again, also in the store, so the next `connect` signs in on the chain that wagmi reports.

```ts
// The user closes the dialog. The connector stays on its earlier chain.
await connect(config, { chainId: tempoModerato.id, connector }).catch(() => {})
```
