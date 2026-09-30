---
'accounts': patch
---

Added OAuth and MCP handlers with schema-derived wallet approval tools and an optional `rpc_request` tool for non-wallet JSON-RPC methods.

```ts
Handler.mcp({
  deviceCode: { url: 'https://wallet.example.com/auth/device' },
  secret,
  rpc: {
    methods: Schema.schema.flatMap((item) => item.method.def.values),
    request: ({ chainId, ...request }) => provider.getClient({ chainId }).transport.request(request),
  },
})
```
