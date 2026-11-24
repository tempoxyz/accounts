---
'accounts': minor
---

Added guest payments: `accounts.pay` with `guest: true` pays MACH from a non-extractable browser key without a Tempo ID session, buying MACH on Tempo ID when the guest holds too little, and `accounts.guest.get` and `accounts.guest.disconnect` read and forget the guest account.
