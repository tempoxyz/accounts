---
"accounts": patch
---

`Handler.relay` no longer checks a sponsored fill's sender against the fee token. The fee payer pays a sponsored fee, but every sponsored fill read the sender's fee-token balance after `eth_fillTransaction` (one more sequential round trip), and a sender holding none of the sponsor's token got an autoSwap into it prepended, which they then paid for. Fills that fall back to self-payment (for example when `feePayer.validate` rejects) still check, and read a fee token known before the fill alongside it. Recovering from `InsufficientBalance` in the transaction's own calls is unchanged.
