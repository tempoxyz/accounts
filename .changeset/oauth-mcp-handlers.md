---
'accounts': patch
---

Added `Handler.oauth` and `Handler.mcp` to `accounts/server`. `Handler.oauth` is an OAuth 2.1 authorization server whose consent step is a `wallet_connect` request on the device-code approval page. `Handler.mcp` is a Streamable HTTP MCP server whose tools mirror wallet JSON-RPC methods and route each request through that approval page.
