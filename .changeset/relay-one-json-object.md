---
'accounts': patch
---

Fixed `relay` relaying a body that fails its JSON parse after one `authorize` decision, such as a JSON-RPC batch behind byte order marks. A route that verifies now returns 400 with the reason `invalid_request` unless the body is one JSON object that the runtime can encode.

**Breaking:** the request of `authorize` holds that object in the route's own encoding, and no `content-length`. Before, it held the bytes of the caller's body. The relay receives the same encoding.

```diff
 relay({
   account: feePayer,
   async authorize(options) {
-    if (Number(options.request.headers.get('content-length')) > 16_384)
+    if ((await options.request.text()).length > 16_384)
       return new Response(null, { status: 413 })
   },
 })
```
