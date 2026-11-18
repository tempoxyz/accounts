---
'accounts': patch
---

Fixed `token.transfer` and `token.transferSync` of the `viem` plugin, which sent a `memo` of an odd count of hex digits, such as `0xabc`, to the payment page, which then recorded it as text. Such a memo now goes as Viem's padded memo, the bytes that Viem's own transfer records.
