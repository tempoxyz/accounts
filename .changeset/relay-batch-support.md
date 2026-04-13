---
'accounts': patch
---

Added JSON-RPC batch request support to `Handler.relay`. The handler now accepts arrays of JSON-RPC request objects and returns an array of responses, matching the [JSON-RPC 2.0 batch spec](https://www.jsonrpc.org/specification#batch).
