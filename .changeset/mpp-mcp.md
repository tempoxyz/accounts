---
'accounts': patch
---

Added `mcp` to the payer of `accounts.mpp()`. It returns a caller of an MCP server's tools, through an MCP SDK client, which pays each tool's charge in the JSON-RPC messages with the session's access key. Each call refuses a charge above `maxAmount` with `mpp.MaxAmountError`, and above the access key's limit with `mpp.LimitError`, before the access key signs.

```ts
const result = await accounts
  .mpp({ maxAmount: '0.1' })
  .mcp(client)
  .callTool({ arguments: {}, name: 'fortune' })
```
