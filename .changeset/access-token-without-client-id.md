---
'accounts': patch
---

Changed `AccessToken.create` to take a configuration without `clientId`, such as `{ url }`, for an API that is no OAuth app and names `clientIds`. Without `clientId` and `clientIds`, it throws.

```ts
const verifier = AccessToken.create(
  { url: 'https://id.tempo.xyz' },
  { audience: 'https://mcp.example.com/mcp', clientIds: 'any' },
)
```
