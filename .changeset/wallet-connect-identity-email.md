---
"accounts": patch
---

Add opt-in verified-email identity capability to `wallet_connect`. Apps can request a verified email via `capabilities: { identity: { email: true } }`, and the wallet returns it (only when shared) on the authenticated account as `accounts[0].capabilities.identity.email`.
