---
'accounts': patch
---

Fixed the `connect` and wagmi's `reconnect` of `tempoId` outside a page: without a session, the connector reads the store again. A session that another instance saved to a shared store since, such as another process's, connects, and `connect` signs in no second time.

```ts
const store = Store.memory()
const config = createConfig({ chains: [tempo], connectors: [tempoId({ store })], transports })

// Another instance on `store` signs in.
await reconnect(config) // connected
```
