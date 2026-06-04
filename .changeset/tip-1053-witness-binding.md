---
"accounts": minor
---

Added TIP-1053 witness binding so a single passkey ceremony produces both the on-chain access-key authorization and the off-chain auth proof. When a `wallet_connect` request includes both a `personalSign`/`auth` challenge and `authorizeAccessKey` on a chain at the T5 hardfork or later, the auth message is folded into the key authorization's `witness` field, collapsing what was previously two passkey prompts into one.
