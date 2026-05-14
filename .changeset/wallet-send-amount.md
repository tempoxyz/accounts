---
'accounts': minor
---

Renamed the `wallet_send` `value` parameter to `amount`.

```diff
 await provider.request({
   method: 'wallet_send',
   params: [{
     to: '0x...',
     token: '0x20c0000000000000000000000000000000000001',
-    value: '1.5',
+    amount: '1.5',
   }],
 })
```
