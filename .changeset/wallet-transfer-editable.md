---
'accounts': minor
---

**Breaking:** Renamed `wallet_send` to `wallet_transfer`. The method now defaults to "read-only" mode. 

For previous behavior, pass `editable: true` to open the editable flow.

```diff
provider.request({
- method: 'wallet_send',
- params: [{ token: '0x...' }],
+ method: 'wallet_transfer',
+ params: [{ editable: true, token: '0x...' }],
})
```
