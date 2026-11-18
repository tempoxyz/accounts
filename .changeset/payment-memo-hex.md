---
'accounts': patch
---

Fixed `accounts.pay` and `Actions.account.pay`, which sent a text memo that starts with `0x`, such as `0xINV-1042`, as hex that holds no bytes. A memo is hex only for `0x` and an even count of hex digits. Any other memo is text, sent as its UTF-8 bytes.
