---
'accounts': patch
---

Renamed `input` → `token` and `output` → `pairToken` in the `POST /exchange/quote` request and response, where `token` is the asset of interest and `pairToken` is the token being traded against. `amount` is now always denominated in `token` units (exact-out for `type: 'buy'`, exact-in for `type: 'sell'`). The `token` field on each response side has been renamed to `address`.
